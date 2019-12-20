const fs = require('fs')
const path = require('path')

const request = require('request-promise')
const { HttpClient, contentCensor: Client } = require('baidu-aip-sdk')
const io = require('socket.io-client')
const bunyan = require('bunyan')

const DEBUG = !!process.env.DEBUG

const log = bunyan.createLogger({
  name: 'qqcensorbot',
  streams: [{
    level: DEBUG ? 'debug' : 'info',
    stream: process.stdout
  }, {
    level: 'debug',
    path: path.join(__dirname, 'qqcensorbot.log')
  }]
})

const REQ_CONF = {
  proxy: DEBUG ? 'http://127.0.0.1:8888' : undefined, // Fiddler
  rejectUnauthorized: !DEBUG, // 配合Fiddler抓包
  gzip: true,
  timeout: 5000
}

// 如给定配置文件路径，则读取之，否则读取index.js同路径下的config.json
const confPath = process.argv[2] || path.join(__dirname, 'config.json')
const config = JSON.parse(fs.readFileSync(confPath, 'utf8'))
// 设置百度AIP底层request库的一些参数，例如代理服务地址，超时时间等
HttpClient.setRequestOptions(REQ_CONF)
// 初始化百度内容审查引擎
const { APP_ID, API_KEY, SECRET_KEY } = config.BAIDU
const AIP = new Client(APP_ID, API_KEY, SECRET_KEY)

// 初始化IOTQQ相关常量
const { WEB_API, WEB_API_AUTH, WS_API, LOGIN_QQ, REPORT_QQ } = config.IOTQQ
// 设置IOTQQ Web API的默认请求设置
const rpConf = { ...REQ_CONF, auth: WEB_API_AUTH, json: true }
const rp = request.defaults(rpConf)

const Authorization = WEB_API_AUTH && 'Basic ' + Buffer.from(`${WEB_API_AUTH.user}:${WEB_API_AUTH.pass}`).toString('base64')
const opts = {
  // reconnection: true,
  // secure: true,
  // rejectUnauthorized: false,
  // agent: new (require('https-proxy-agent'))('http://localhost:8888'),
  agent: DEBUG && new (require('proxy-agent'))('http://127.0.0.1:8888'),
  transports: ['websocket'],
  extraHeaders: Authorization && { Authorization }
}

// 私聊支持的配置指令，val: 默认值, type: 类型, get: 保存值->显示值, set: 输入值->保存值
const COMMAND = {
  白名单: { val: [], type: 'QQ号', get: v => Array.from(v) + '', set: (s, v) => s['白名单'].has(~~v) ? s['白名单'].delete(~~v) : s['白名单'].add(~~v) }, // QQ号白名单
  执行撤回: { val: true, type: '开/关', get: v => v ? '开' : '关', set: (s, v) => { s['执行撤回'] = v === '开' } }, // 是否执行撤回，否则只报告
  审查所有: { val: false, type: '开/关', get: v => v ? '开' : '关', set: (s, v) => { s['审查所有'] = v === '开' } }, // 是否处理非广告推广类消息
  处理疑似: { val: false, type: '开/关', get: v => v ? '开' : '关', set: (s, v) => { s['处理疑似'] = v === '开' } }, // 是否处理疑似信息
  文本长度: { val: 8, type: '数字', get: v => v, set: (s, v) => { s['文本长度'] = ~~v } } // 启动审查的最少字符数
}
// 配置初始值（默认值）
const settings = Object.entries(COMMAND).reduce((o, [k, v]) => (o[k] = v.val, o), {}) // eslint-disable-line
// 帮助信息（收到不可识别的指令）
const HELP = `命令列表：\n${Object.entries(COMMAND).map(([k, v]) => k + ' ' + v.type).join('\n')}`

async function main () {
  const settingsPath = path.join(__dirname, 'settings.json')
  try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsPath, 'utf8'))) } catch (err) {}
  settings['白名单'] = new Set(settings['白名单'])
  settings['白名单'].add(REPORT_QQ).add(LOGIN_QQ)
  const saveSettings = () => {
    const o = Object.assign({}, settings)
    o['白名单'] = Array.from(o['白名单'])
    fs.writeFileSync(settingsPath, JSON.stringify(o, null, 2), 'utf8')
  }

  // 开始连接websocket
  const socket = io(WS_API, opts)
  // socket.emit('GetWebConn', '' + LOGIN_QQ, (data) => log.info(data))
  socket.on('connect', e => {
    log.info('WebSocket已连接')
    // 每次重连都必须发出这个事件，否则无法收到事件
    socket.emit('GetWebConn', '' + LOGIN_QQ, data => log.info({ data }, 'GetWebConn响应'))
  })
  socket.on('disconnect', data => log.info({ data }, 'WebSocket已断开'))
  // 处理群消息
  socket.on('OnGroupMsgs', async data => {
    log.debug({ data }, '收到群消息')
    const { FromGroupId, FromGroupName, FromUserId, FromNickName, Content, MsgType, MsgSeq, MsgRandom } = data.CurrentPacket.Data
    if (MsgType !== 'TextMsg') return
    if (Content.length < settings['文本长度']) return log.debug('内容过短不审查')
    if (settings['白名单'].has(~~FromUserId)) return log.debug('白名单用户不审查')
    const result = await textCensor(Content)
    if (result.conclusion !== '合规') { // '合规', '疑似', '不合规'
      const revoke = settings['执行撤回'] && (result.conclusion === '不合规' || (result.conclusion === '疑似' && settings['处理疑似'])) && (settings['审查所有'] || /恶意推广/.test(result.msg))
      let msg = `${FromNickName}(${FromUserId})发表于${FromGroupName}(${FromGroupId})的内容不合规。原因：${result.msg}；原文：\n${Content}`
      msg += `\n处理方式：${revoke ? '撤回' : '无'}`
      let params = { toUser: REPORT_QQ, sendToType: 1, sendMsgType: 'TextMsg', content: msg, groupid: FromGroupId, atUser: 0, replayInfo: null }
      let resp = await callApi('SendMsg', params)
      log.info({ resp }, '给管理员发送通知')
      if (revoke) {
        params = { GroupID: FromGroupId, MsgSeq, MsgRandom }
        resp = await callApi('RevokeMsg', params)
        log.info({ resp }, '撤回恶意推广消息')
        // if (resp.Ret === 1001) {
        //   // {"Msg":"No message meets the requirements","Ret":1001}
        //   settings['白名单'].add(FromUserId)
        //   saveSettings()
        // }
      }
    }
  })
  // 处理私聊消息
  socket.on('OnFriendMsgs', async data => {
    log.debug({ data }, '收到私聊消息')
    const { FromUin, MsgType, Content } = data.CurrentPacket.Data
    if (FromUin !== REPORT_QQ || MsgType !== 'TextMsg') return log.debug('非文本消息或管理员消息')
    const cmd = Content.split(/\s+/)
    const cmdArr = Object.entries(COMMAND)
    const idx = cmdArr.map(([k]) => k).findIndex(v => v === cmd[0])
    let reply = HELP
    if (idx >= 0) {
      if (cmd[1]) {
        cmdArr[idx][1].set(settings, cmd[1])
        reply = `${cmd[0]} - 设定修改成功`
        saveSettings()
      } else {
        reply = `${cmd[0]} - 当前设定值为${cmdArr[idx][1].get(settings[cmdArr[idx][0]])}`
      }
    }
    const params = { toUser: FromUin, sendToType: 1, sendMsgType: 'TextMsg', content: reply, groupid: 0, atUser: 0, replayInfo: null }
    const resp = await callApi('SendMsg', params)
    log.debug({ resp, reply }, '回复私聊信息')
  })
  // 其它事件
  socket.on('OnEvents', async data => {
    log.debug({ data }, '收到事件通知')
  })
}

// 调用IOTQQ WebAPI
async function callApi (name, params) {
  const url = `${WEB_API}/LuaApiCaller?qq=${LOGIN_QQ}&funcname=${name}&timeout=10`
  if (params) return rp.post(url, { body: params })
  return rp.get(url)
}

// 调用百度内容审查引擎
async function textCensor (text) {
  const result = await AIP.textCensorUserDefined(text)
  log.info({ text, result }, '调用百度内容审查')
  // {"conclusion":"疑似","log_id":15758897400554284,"data":[{"msg":"疑似存在恶意推广不合规","conclusion":"疑似","hits":[{"probability":0.9293495,"datasetName":"百度默认文本反作弊库","words":[]}],"subType":4,"conclusionType":3,"type":12}],"conclusionType":3}
  const conclusion = { conclusion: result.conclusion }
  if (result.conclusion !== '合规' && result.data && result.data[0] && result.data[0].msg) conclusion.msg = result.data[0].msg
  return conclusion
}

main()

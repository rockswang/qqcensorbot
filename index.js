const fs = require('fs')
const path = require('path')

const request = require('request-promise')
const { HttpClient, contentCensor: Client } = require('baidu-aip-sdk')
const io = require('socket.io-client')

const DEBUG = !!process.env.DEBUG

const REQ_CONF = {
  proxy: DEBUG ? 'http://127.0.0.1:8888' : undefined, // Fiddler
  rejectUnauthorized: !DEBUG, // 配合Fiddler抓包
  gzip: true,
  timeout: 5000
}

// 设置百度AIP底层request库的一些参数，例如代理服务地址，超时时间等
HttpClient.setRequestOptions(REQ_CONF)
let AIP

// 设置IOTQQ Web API的默认请求设置
const rp = request.defaults({ ...REQ_CONF, json: true })
let WEB_API
let WS_API
let LOGIN_QQ
let REPORT_QQ

async function main () {
  const confPath = process.argv[2] || path.join(__dirname, 'config.json')
  const config = JSON.parse(fs.readFileSync(confPath, 'utf8'))
  // 初始化百度AI引擎
  const { APP_ID, API_KEY, SECRET_KEY } = config.BAIDU
  AIP = new Client(APP_ID, API_KEY, SECRET_KEY)

  ;({ WEB_API, WS_API, LOGIN_QQ, REPORT_QQ } = config.IOTQQ)

  const socket = io(WS_API, { transports: ['websocket'] })
  socket.emit('GetWebConn', '' + LOGIN_QQ, (data) => console.log(data))
  socket.on('connect', e => console.log('WS已连接'))
  socket.on('disconnect', e => console.log('WS已断开', e))
  socket.on('OnGroupMsgs', async data => {
    console.log('>>OnGroupMsgs', JSON.stringify(data, null, 2))
    const { FromGroupId, FromGroupName, FromUserId, FromNickName, Content, MsgType, MsgSeq, MsgRandom } = data.CurrentPacket.Data
    if (MsgType !== 'TextMsg') return
    const result = await textCensor(Content)
    if (result.conclusion !== '合规') { // '合规', '疑似', '不合规'
      const msg = `${FromNickName}(${FromUserId})发表于${FromGroupName}(${FromGroupId})的内容不合规。原因：${result.msg}；原文：\n${Content}`
      let params = { toUser: REPORT_QQ, sendToType: 1, sendMsgType: 'TextMsg', content: msg, groupid: 0, atUser: 0, replayInfo: null }
      let apiRes = await callApi('SendMsg', params)
      console.log('给管理员发送通知', apiRes)
      if (result.conclusion === '不合规') {
        params = { GroupID: FromGroupId, MsgSeq, MsgRandom }
        apiRes = await callApi('RevokeMsg', params)
        console.log('自动撤回消息', apiRes)
      }
    }
  })
  socket.on('OnFriendMsgs', async data => {
    console.log('>>OnFriendMsgs', JSON.stringify(data, null, 2))
    const { FromUin, MsgType, Content } = data.CurrentPacket.Data
    if (MsgType !== 'TextMsg') return
    const reply = Content.replace(/你/g, '我').replace(/(?:么？|么\?|吗？|吗\?|？|\?)?$/, '！')
    const params = { toUser: FromUin, sendToType: 1, sendMsgType: 'TextMsg', content: reply, groupid: 0, atUser: 0, replayInfo: null }
    const apiRes = await callApi('SendMsg', params)
    console.log('callApi.result', apiRes)
  })
  socket.on('OnEvents', data => console.log('>>OnEvents', JSON.stringify(data, null, 2)))
}

async function callApi (name, params) {
  return rp.post(`${WEB_API}/LuaApiCaller?qq=${LOGIN_QQ}&funcname=${name}&timeout=10`, { body: params })
}

async function textCensor (text) {
  const result = await AIP.textCensorUserDefined(text)
  console.log('censor.result', result)
  // {"conclusion":"疑似","log_id":15758897400554284,"data":[{"msg":"疑似存在恶意推广不合规","conclusion":"疑似","hits":[{"probability":0.9293495,"datasetName":"百度默认文本反作弊库","words":[]}],"subType":4,"conclusionType":3,"type":12}],"conclusionType":3}
  const conclusion = { conclusion: result.conclusion }
  if (result.conclusion !== '合规' && result.data && result.data[0] && result.data[0].msg) conclusion.msg = result.data[0].msg
  return conclusion
}

main()

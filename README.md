## 概述
* qqcensorbot是一个QQ群反垃圾机器人，基于IOTQQ和百度文本审核API。
* IOTQQ项目链接[在此](https://github.com/IOTQQ/IOTQQ)
* 关于IOTQQ的安装部署，请参见[这篇文章](https://segmentfault.com/a/1190000021259760)

## 使用说明
* 克隆本项目
* 构建：在项目目录执行`npm install`
* 启动：在项目目录执行`npm start`

## 配置说明
* BAIDU配置段，需要到[百度智能云](https://console.bce.baidu.com/ai/)后台申请一个新的内容审核应用
* IOTQQ.WEB_API: IOTQQ的Web API地址，用来主动发送消息
* IOTQQ.WEB_API_AUTH: 如需添加basic auth，请添加，格式为 { "user": "xxxx", "pass": "xxxx" }
* IOTQQ.WS_API: IOTQQ的websocket推送地址，用来监听消息推送
* IOTQQ.LOGIN_QQ: 登录者QQ号，也就是机器人的QQ号
* IOTQQ.REPORT_QQ: 管理员QQ号，必须和机器人是好友，每次撤回不合规内容，都会给此QQ号发送通知，可以通过和机器人QQ私聊来修改审查配置

## 审查配置
* 管理员QQ可以和机器人QQ私聊以查看和修改审查配置
* 输入“帮助”或其它不支持指令，会回复帮助信息
* 白名单 - 可以增加或删除白名单QQ号，白名单中的QQ号的发言不审查；如果因为权限不足撤回失败，也会自动添加白名单
* 执行撤回 - 是否对不合规消息执行撤回，默认开
* 审查所有 - 是否审查非广告推广类垃圾消息（政治敏感、涉黄、灌水等），默认关
* 处理疑似 - 是否处理疑似垃圾信息，默认关
* 文本长度 - 启动审查的最少字符数

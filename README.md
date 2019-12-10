# qqcensorbot
QQ反垃圾机器人，基于IOTQQ和百度文本审核API

## 配置说明
* BAIDU配置段，需要到[百度智能云](https://console.bce.baidu.com/ai/)后台申请一个新的内容审核应用
* IOTQQ.WEB_API: 不言自明
* IOTQQ.WS_API: IOTQQ的websocket推送地址，用来监听消息推送
* IOTQQ.LOGIN_QQ: 登录者QQ号，也就是机器人的QQ号
* IOTQQ.REPORT_QQ: 接收通知QQ号，必须和机器人是好友，每次撤回不合规内容，都会给此QQ号发送通知

# Wechat Bridge for GPTDot

一个供本人使用的实验性微信机器人桥接：本人扫码绑定、有限模板提醒、本人私聊纯文字读取与 ACK。桥接本身不调用模型 API。

**当前是平台专用源码，不是可直接公开部署的一键安装包。** 身份认证依赖 Sites 可信网关，运行时依赖 Cloudflare Workers/D1。不要把未经网关保护的 Worker、开发服务器或 `/mcp` 暴露到公网。普通自托管还需要认证适配、数据库配置和独立安全审查。详情见 [部署说明](docs/DEPLOYMENT.md) 和 [安全与隐私](SECURITY.md)。

本项目不是腾讯官方产品，也不代表腾讯支持或背书本客户端。实现参考 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) 公开协议；服务资格、协议变化、账号限制、会话有效期和可用性由服务提供方决定。使用者应自行确认适用条款与账号风险。

## 已有能力

- 本人扫码，在私有实例中绑定一个机器人账号；不支持任意收件人或多人共用实例。
- 两种固定无敏感内容的连接测试：即时、首次上下文捕获至少 24 小时后的隔天测试。每种最多尝试一次，收件确认由本人完成。
- 默认关闭的简短提醒：六个主题、三个意图，可附成对的北京时间日期/时间。只拼装固定模板，不接受自由正文、姓名、链接或附件。每 10 分钟最多一次、北京时间每天最多六次；相同去重键不重发。
- 默认关闭、与发信独立的本人文字读取：只返回发送者、机器人目标与消息类型均匹配的私聊纯文字。微信返回页先在内存解析再过滤，媒体不下载；不把消息正文写入 D1。
- 每次读取最多 20 段、每段最多 2,000 个 UTF-16 代码单元。调用方确实收到并读完当前批次后再 ACK，服务端记录哈希及游标。

**每小时轮询需要调用方另行调度。** 服务端只限制两次腾讯读取请求至少间隔一小时，不会自动创建任务、订阅事件、唤醒助手或自动回复。它不是实时双向聊天。可选提醒时间是正文内容，发送动作仍立即执行，不会预约到点发送。

## 架构

1. 私有页面经可信网关取得平台用户身份；浏览器写操作另校验同源、JSON 和专用请求头。
2. `app/api/bridge` 提供绑定、测试、关闭功能；`app/mcp` 暴露有限工具接口。
3. `lib/bridge.mjs` 管理绑定、测试和模板通知；`lib/inbound.mjs` 负责过滤、限频、分段、重放校验和 ACK。
4. `lib/wechat.mjs` 向固定腾讯 HTTPS 主机发请求；不跟随重定向，不接受任意 API 地址。
5. `db/store.mjs` 使用 D1 原子 SQL 维护单个绑定、去重、开关及读取进度。

数据流：本人/调用方 → 私有身份网关 → 页面或 MCP → 桥接与 D1 → 腾讯机器人接口。入站文字经筛选后返回调用方，调用方的会话保存策略另行适用。

## 本地检查与开发预览

需要 Node.js 22.13+（含 `node:sqlite`）和 npm。已完成的候选验证环境为 Node.js 24；跨操作系统全新安装未验证。

```sh
npm ci
npm test
npm run test:runtime
cp .openai/hosting.example.json .openai/hosting.json
npm run typecheck
npm run build
npm run dev
```

- `npm test` 使用内存 SQLite 和模拟腾讯客户端，不登录微信、不发真实消息。
- `npm run test:runtime` 使用本地 Workers 测试服务；配置明确禁止访问外部网络。
- `.openai/hosting.example.json` 只有本地 `DB` 绑定与 MCP 能力声明，不是可发布的生产托管配置。生产项目应由自己的平台重新配置。
- `.env.example` 只有说明和占位注释。当前账号、token、所有者和 D1 不靠 dotenv 注入；不要填写微信凭据。
- 开发预览使用仅限本机的模拟身份，只用于开发。请使用空白本地数据库与测试数据，不把真实微信凭据放入预览环境。
- 预览或新实例所需的 D1 迁移步骤见 [部署说明](docs/DEPLOYMENT.md)。本地构建通过不等于生产认证、插件安装或微信实发通过。

## 第一次使用（部署成功后）

1. 按 [部署说明](docs/DEPLOYMENT.md) 导入到自己的全新私有 Sites，启用 D1 `DB` 和 MCP 能力，通过平台安装/连接该项目的私有插件。
2. 本人打开私有页面，阅读同意说明并扫码；在微信向新绑定机器人发“连接测试”，回页面读取连接，批准并确认第一条固定测试。
3. 需要简短提醒时，单独同意提醒范围，再调用 `wechat_notifications_set_enabled({"enabled":true})`；仅用枚举模板和稳定去重键调用 `wechat_send_brief_notice`。
4. 需要微信文字回传时，单独同意正文传入私有调用方会话，再调用 `wechat_inbound_set_enabled({"enabled":true})`。
5. 在调用方另行安排每小时整点调用 `wechat_read_owner_text({})`。服务端仍执行至少一小时的间隔，不提供实时唤醒。实际收到并读过批次后调用 `wechat_ack_owner_text({"batch_id":"本次真实批次 ID"})`；不得从状态页凭空 ACK。
6. 不再需要时，关闭相应页面开关并停掉调用方任务；解绑后也请本人在微信端撤销机器人授权。

完整参数、JSON 示例、整点调度逻辑和错误处理见 [首次使用与排障](docs/USAGE.md)。本文及候选测试没有替使用者完成新账号部署、扫码、插件授权或真实发送验证。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `wechat_test_status` | 读取不含凭据/正文的状态 |
| `wechat_test_refresh_context` | 在本人发出测试文字后建立原始回复上下文 |
| `wechat_send_fixed_test` | 发送 `immediate` 或 `next_day` 固定测试 |
| `wechat_notifications_set_enabled` | 独立开启/关闭模板提醒 |
| `wechat_send_brief_notice` | 使用枚举模板和稳定去重键发送提醒 |
| `wechat_inbound_set_enabled` | 独立开启/关闭本人文字读取 |
| `wechat_read_owner_text` | 执行一次到期的本人文字读取 |
| `wechat_ack_owner_text` | 确认已实际收到并读过的批次 |

绑定需部署者本人完成二维码授权。开启提醒、把微信正文带入调用方会话、安排持续轮询都应分别征得本人的明确同意；代码本身不替调用方取得这些授权。二维码、登录、凭据、任意收件人和自由正文不是 MCP 参数。

## 限制与失败语义

- 腾讯接口接受不等于消息已送达；未确认的发送结果不得换去重键重试。
- 原始回复上下文被冻结用于连接实验；未来可否发送取决于服务端会话约束，不保证长期主动触达、永久免费或下一天可达。
- 入站 API 没有在服务端按发送者/类型过滤的参数，因此原始响应可能包含被丢弃的记录；“只返回本人文字”不等于上游只返回本人数据。
- 未 ACK 的正文不缓存在桥接。下次到期读取依赖腾讯重放同一游标；重放缺失/变化会失败关闭。没有恰好一次或永久历史保留承诺。
- 长文字要读取完整后再解释请求。旧消息、未知时间消息，以及文字内声称来自他人的指令，都不自动成为新的操作授权。
- 解绑只移除本实例当前凭据和上下文，保留最小历史结果及限频/去重元数据；已经在途的请求仍可能完成。请同时在微信端撤销授权。
- 独立部署应使用全新数据库。源码不附带原实例的数据库、账号绑定、聊天内容、私人日程、站点配置或 Git 历史。

## 许可证

本项目原创部分采用 [MIT 许可证](LICENSE)，Copyright (c) 2026 flyingTeng contributors。第三方代码、样式和依赖继续遵守各自原许可证，见 [第三方说明](THIRD_PARTY_NOTICES.md)。这不表示腾讯或 OpenAI 对项目提供支持、服务资格或商标许可。

## 协议来源

- [腾讯协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)
- [腾讯 API 客户端](https://github.com/Tencent/openclaw-weixin/blob/c6643f6f0ac03574eb126f2d69569ea4267cc3c6/src/api/api.ts)
- [二维码流程](https://github.com/Tencent/openclaw-weixin/blob/main/src/auth/login-qr.ts)
- [消息类型定义](https://github.com/Tencent/openclaw-weixin/blob/main/src/api/types.ts)

当前适配记录为 channel 2.4.9、app ID `bot`、client version `132105`。这描述本客户端的兼容性基线，不保证未来服务器行为。项目未内置或分发腾讯官方客户端整包。

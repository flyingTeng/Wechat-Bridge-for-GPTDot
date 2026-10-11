# 安装与部署边界

## 先选择正确路径

1. 想研究实现、跑测试：可以在本机按 README 安装依赖。测试全部用合成数据。
2. 已有支持本项目的私有 Sites 环境：由平台新建私有项目、新数据库、托管配置、身份网关和插件入口，再进行验证。不能复用原作者站点身份或数据库。
3. 想部署到一般 VPS、Vercel 或裸 Cloudflare Worker：当前没有完整支持路径。需要新增/审查认证适配、会话/CSRF 保护、可信代理边界、D1 或其他数据库适配、构建与 MCP 接入；不能靠改一个 URL 或加几项 `.env` 完成。

## 本地只读检查

```sh
npm ci
npm test
npm run test:runtime
```

Node 内存测试无第三方请求；native Workers 测试将所有外发路由到本地 fixture，并禁止互联网。它们不会登录微信或发送真实消息。

## 本地页面预览

```sh
cp .openai/hosting.example.json .openai/hosting.json
npm run build
```

示例仅包含本地 `DB` 绑定和 MCP 能力声明，不含生产项目 ID 或账户。先 `npm run build` 生成 `dist/server/wrangler.json`，再对全新本地数据库按顺序执行以下迁移：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_slimy_changeling.sql
```

把最后的文件名依次替换为 `0001_purple_vector.sql`、`0002_melted_ted_forrester.sql`、`0003_lively_chronomancer.sql`、`0004_brief_the_order.sql`、`0005_cloudy_celestials.sql`、`0006_easy_gravity.sql`（路径均在 `drizzle/`）。**只执行尚未应用的迁移，不能在已有数据上盲目重放。** 保持 `--local` 与 `.wrangler/state`，不要改为 `--remote`。本地与生产数据库独立，SQL 文件不含业务记录。

随后 `npm run dev`，打开终端打印的回环地址（通常 `http://localhost:5173`）。本地 `/signin-with-chatgpt?return_to=/` 仅设置固定开发模拟身份，并非真实个人账号登录；本机 cookie 可跨重启保留。不要映射端口到公网。

本地预览只用于空白数据库及合成数据。不要在共享开发环境用真实微信扫码，也不要把回环模拟认证当作保护真实 token 的足够措施。

## 私有 Sites 生产路径的前置条件

- 拥有支持此模板运行时、D1 和私有身份网关的 Sites 项目。平台入口、配额和插件安装权限因环境而异，此代码不发放这些能力。
- `.openai/hosting.json` 必须由自己项目的实际配置生成，保留平台返回的 `project_id`，逻辑绑定为 `"d1": "DB"`、`"r2": null`，并声明 `"capabilities": ["mcp"]`。访问范围须在平台设置为仅本人；example 本身不设置访问权限，不能直接作为生产身份配置。
- 平台必须移除外部传入的 `oai-authenticated-user-*` 头并仅注入已认证本人身份；Worker 不可绕过平台直连。
- 给自己的项目声明全新 D1；标准 Sites 发布路径会在上传 Worker 前应用打包的待执行迁移，需检查部署结果。不要导入别人绑定数据库，也不要额外手动重复执行平台已应用的迁移。`owner_notices` 表保留为历史 schema 兼容空表，公开候选没有个人固定日程发送工具。
- 构建产物、站点配置和数据库迁移由该环境支持的部署路径发布；本仓库不包含 deploy 命令、云凭据、真实资源 ID 或已连接插件。
- MCP 入口在 `/mcp`，使用 JSON-RPC POST；不内置独立 OAuth 服务器。支持此能力的 Sites 发布后会提供应用/私有插件。通过平台展示的安装入口连接；若界面支持，可在 Plugins → Personal → Created by you 中找到自己的项目并 Install/Connect。以实际账户界面为准，不使用手工注入身份头、`codex mcp add` 或 `codex mcp login` 代替平台托管认证。
- 最后由部署者本人完成扫码，建立上下文，单独批准真实测试与所需通知/读取功能。没有完成这些步骤之前，不得声称已能收发微信。

## 轮询由谁执行

此应用没有 Cron、常驻循环或自动回复。调用方在本人批准后，最多每小时调用 `wechat_read_owner_text`。`not_due`、`awaiting_ack` 或空 `messages` 不代表收到了正文；只有实际收到并读过的批次才可 ACK。不得仅根据状态页的 batch ID ACK。

一次返回可能只有长消息的一部分，应依赖 `source_message_key`、`part_index`、`part_count` 等字段收齐后再解释请求。所有分段 ACK 后才推进该页游标。不确定或缺失重放时报告问题，不重置游标掩盖遗漏。

## 已知可移植性限制

- `cloudflare:workers`、D1、workerd、vinext 和 Sites 网关都是明确运行时依赖。常规 `next start` 不是本项目支持的生产方式。
- 开源候选移除了微信桥接不使用的 CONNECTORS/connector-preview 模板设施；保留最小 vinext Worker 适配器。身份网关与 D1 仍是必需依赖。
- `.sites-runtime` 中的机器执行档案不随源码分发；没有此档案时脚本走 portable 开发/构建分支。
- managed-linux 安装辅助脚本依赖 Bash/GNU timeout 等工具；Windows 原生路径、ARM 与新装依赖未完整验证。
- `npm run start` 是本地 Wrangler 运行方式，不提供生产认证。不要为公网改成 `0.0.0.0` 后直接使用。
- 锁文件固定已使用的依赖版本，但不是未来安全更新保证。维护者仍需跟进版本和安全公告。

## 从候选导入到自己的 Sites

1. 在支持 Sites 的环境创建一个全新、仅本人可访问的项目，将本源码作为保留模板导入。给项目独立名称，不覆盖已有微信实例。
2. 由平台生成项目标识与私有访问设置；将 `.openai/hosting.example.json` 的逻辑绑定/MCP 声明合并到该项目真实 manifest，不复制他人的标识。
3. 安装锁定依赖，运行本仓库测试、类型检查与构建。打包源码时保留 `drizzle/` SQL 及元数据，使平台能应用迁移。
4. 通过目标环境的标准私有 Sites 发布流程上传并等待成功；检查 D1 迁移、Worker 部署和私有访问状态，失败时先诊断，勿重复创建账号或重新绑定。
5. 打开自己的私有站点，确认匿名/其他账号不能读取状态或绑定。再通过平台连接自己项目的私有插件，调用 `wechat_test_status` 验证，期望全新实例为未连接状态。
6. 按 [首次使用](USAGE.md) 本人扫码，再按实际需求分别授权通知与接收。

这六步依赖目标账户拥有 Sites、私有托管和插件能力，候选制作没有在另一个新账户重复实测全部部署流程。若缺少这些入口，应先确认平台支持，不应把源码放到普通公网主机冒充等效部署。

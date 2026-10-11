# 第三方来源与许可说明（待发布核验）

核验日期：2026-10-11。本文覆盖候选源码包内已知的第三方来源、45 个直接 npm 依赖，以及锁文件中需要单独注意的传递依赖。候选包不包含 `node_modules`、构建输出或预编译依赖。

**本项目原创部分采用根目录 LICENSE 中的 MIT 许可。本文不替代该许可，也不替代各第三方组件的原始许可。第三方来源核验不等于对原创代码权属的法律认定；最终发布前仍应完成末尾检查清单。**

## 1. 已随源码保留的第三方内容

### OpenAI Sites Vite 插件

- 本地文件：`build/sites-vite-plugin.ts`。
- 文件头标明来源：`@openai/sites-vite-plugin` 0.2.0，参考 [openai/sites #9](https://github.com/openai/sites/pull/9)。
- 原作者与许可：Copyright (c) 2026 OpenAI；MIT。
- 完整许可保留在 [`build/sites-vite-plugin.LICENSE`](build/sites-vite-plugin.LICENSE)。它与核验时 [官方 LICENSE](https://github.com/openai/sites/blob/7eb9d4b9cf93ad7e64aebc8a5ca70e29ec2cfb94/LICENSE) 内容一致。
- 与 [官方插件源码](https://github.com/openai/sites/blob/7eb9d4b9cf93ad7e64aebc8a5ca70e29ec2cfb94/packages/sites-vite-plugin/src/index.ts) 比较，候选包含格式调整、来源注释及 `mockAuth` 开关适配。此对比确认了明显的源码来源，但不是对原始导入时间或全部修改历史的证明。
- 发布和后续修改必须保留 OpenAI 的版权及 MIT 许可；不能用项目主许可证覆盖或移除它们。

### shadcn 样式及界面组件

- 样式文件：`vendor/shadcn-tailwind-4.13.0.css`。与 [shadcn 官方 4.13.0 相关提交中的源码](https://github.com/shadcn-ui/ui/blob/f3e7de11752b087b1c4bf61f4035a866f3a4f9ed/packages/shadcn/src/tailwind.css) 逐字节一致；[官方版本记录](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/CHANGELOG.md)。
- CSS SHA-256：`bc7d83425702955b4cb67cb14ede9d603f9d912376d57a2d81d661094d2a782a`。
- 桥接界面实际使用的三个组件已与 shadcn 官方快照 `c2a67849be260701852b0977ba15eb5f3a0ce2a4` 比较：[button](https://github.com/shadcn-ui/ui/blob/c2a67849be260701852b0977ba15eb5f3a0ce2a4/apps/v4/registry/new-york-v4/ui/button.tsx)、[checkbox](https://github.com/shadcn-ui/ui/blob/c2a67849be260701852b0977ba15eb5f3a0ce2a4/apps/v4/registry/new-york-v4/ui/checkbox.tsx)、[alert-dialog](https://github.com/shadcn-ui/ui/blob/c2a67849be260701852b0977ba15eb5f3a0ce2a4/apps/v4/registry/new-york-v4/ui/alert-dialog.tsx)。主体相同，仅 `cn` 及组件导入路径/排序调整为本地结构。
- 原作者与许可：Copyright (c) 2023 shadcn；MIT。
- 完整许可保留在 [`vendor/shadcn-tailwind-4.13.0.LICENSE.md`](vendor/shadcn-tailwind-4.13.0.LICENSE.md)，与 [官方快照许可](https://github.com/shadcn-ui/ui/blob/c2a67849be260701852b0977ba15eb5f3a0ce2a4/LICENSE.md) 完全一致；该通知同时覆盖上述 shadcn 派生 UI 源码和样式，而非仅 CSS。

### OpenAI Sites 模板适配

- `app/chatgpt-auth.ts` 已与 [OpenAI 官方 auth 模板](https://github.com/openai/sites/blob/7eb9d4b9cf93ad7e64aebc8a5ca70e29ec2cfb94/packages/create-sites/templates/addons/auth/app/chatgpt-auth.ts) 比较，仅有单双引号格式差异。
- `lib/utils.ts` 与 [OpenAI 官方 shadcn 工具模板](https://github.com/openai/sites/blob/7eb9d4b9cf93ad7e64aebc8a5ca70e29ec2cfb94/packages/create-sites/templates/addons/shadcn/lib/utils.ts) 比较，仅有引号格式及显式 `string` 返回类型的调整。
- 保留 Copyright (c) 2026 OpenAI 和 [MIT 许可](build/sites-vite-plugin.LICENSE)；它与该官方仓库根许可证内容完全一致。shadcn 来源内容另遵守上节归属。

### Tencent openclaw-weixin 协议参考与适配

- 本地关联实现：`lib/wechat.mjs` 中的定制协议客户端；源码注释标明 wire format 参考 Tencent/openclaw-weixin 2.4.9。它不是本项目的直接 npm 依赖，也不是原仓库整文件原样引入。
- 原始项目记录的参考版本：`c6643f6f0ac03574eb126f2d69569ea4267cc3c6`。
- 已记录的参考内容：[src/api/api.ts](https://github.com/Tencent/openclaw-weixin/blob/c6643f6f0ac03574eb126f2d69569ea4267cc3c6/src/api/api.ts#L579-L596)、[docs/protocol.md](https://github.com/Tencent/openclaw-weixin/blob/c6643f6f0ac03574eb126f2d69569ea4267cc3c6/docs/protocol.md#L67-L84)、[src/auth/login-qr.ts](https://github.com/Tencent/openclaw-weixin/blob/c6643f6f0ac03574eb126f2d69569ea4267cc3c6/src/auth/login-qr.ts)、[src/api/types.ts](https://github.com/Tencent/openclaw-weixin/blob/c6643f6f0ac03574eb126f2d69569ea4267cc3c6/src/api/types.ts)。
- 原作者与许可：Copyright (C) 2026 Tencent. All rights reserved.；MIT。
- 已从该固定提交读取 [官方 LICENSE](https://github.com/Tencent/openclaw-weixin/blob/c6643f6f0ac03574eb126f2d69569ea4267cc3c6/LICENSE)，完整保留在 [`vendor/tencent-openclaw-weixin.LICENSE`](vendor/tencent-openclaw-weixin.LICENSE)。
- 本次未审阅修改历史，也未证明逐行复制或独立创作的边界；按“参考/适配”保守保留上游归属与许可。此说明不表示腾讯参与、认可或提供本项目，也不构成微信服务使用权限或商标许可。

## 2. 已排除的辅助程序与来源边界

本候选已移除未能确认独立许可来源的 connector preview 辅助程序，包括 `build/connector-preview-plugin.mjs`、`build/connector-preview-worker.mjs`、`lib/connector*`、`scripts/connector-preview*` 和 `components/connector-error.tsx`；这些文件不在本候选分发范围内，不列为候选的未决许可依赖。

`build/sites-worker.ts` 已替换为仅转发 `handler.fetch(request, env, ctx)` 的最小 vinext Worker 适配层，不再包含平台 CONNECTORS 逻辑。其依赖 vinext 的 MIT 许可见下表；本项目新写部分采用根目录 MIT 许可证。

`components/ui/` 仅保留上节已核验的三个实际使用组件；其它未用 UI 模板不在候选分发范围内。

## 3. 直接 npm 依赖

下表版本以本候选的 `package-lock.json` 为准，许可与核验环境中相同版本的已安装 `package.json` 一致。官方仓库链接来自各包发布元数据；并未逐一证明下载包与所有上游提交逐字节一致。

汇总：25 个运行依赖 + 20 个开发依赖；39 个声明 MIT、3 个 Apache-2.0、2 个 MIT OR Apache-2.0、1 个 ISC。**这些是包级声明，不代表包内所有图标、数据、二进制和内嵌代码只有一种许可。**

### 运行依赖

| 包 | 锁定版本 | 包声明许可 | 来源 |
| --- | --- | --- | --- |
| `@base-ui/react` | `1.7.0` | `MIT` | [官方仓库](https://github.com/mui/base-ui) |
| `@hookform/resolvers` | `5.7.1` | `MIT` | [官方仓库](https://github.com/react-hook-form/resolvers) |
| `@shadcn/react` | `0.3.0` | `MIT` | [官方仓库](https://github.com/shadcn-ui/ui) |
| `class-variance-authority` | `0.7.1` | `Apache-2.0` | [官方仓库](https://github.com/joe-bell/cva) |
| `clsx` | `2.1.1` | `MIT` | [官方仓库](https://github.com/lukeed/clsx) |
| `cmdk` | `1.1.1` | `MIT` | [官方仓库](https://github.com/pacocoursey/cmdk) |
| `date-fns` | `4.4.0` | `MIT` | [官方仓库](https://github.com/date-fns/date-fns) |
| `drizzle-orm` | `0.45.2` | `Apache-2.0` | [官方仓库](https://github.com/drizzle-team/drizzle-orm) |
| `embla-carousel-react` | `8.6.0` | `MIT` | [官方仓库](https://github.com/davidjerleke/embla-carousel) |
| `input-otp` | `1.4.2` | `MIT` | [官方仓库](https://github.com/guilhermerodz/input-otp) |
| `lucide-react` | `1.31.0` | `ISC` | [官方仓库](https://github.com/lucide-icons/lucide) |
| `next` | `16.3.4` | `MIT` | [官方仓库](https://github.com/vercel/next.js) |
| `next-themes` | `0.4.6` | `MIT` | [官方仓库](https://github.com/pacocoursey/next-themes) |
| `qrcode` | `1.5.4` | `MIT` | [官方仓库](https://github.com/soldair/node-qrcode) |
| `radix-ui` | `1.6.7` | `MIT` | [官方仓库](https://github.com/radix-ui/primitives) |
| `react` | `19.2.6` | `MIT` | [官方仓库](https://github.com/facebook/react) |
| `react-day-picker` | `10.0.1` | `MIT` | [官方仓库](https://github.com/gpbl/react-day-picker) |
| `react-dom` | `19.2.6` | `MIT` | [官方仓库](https://github.com/facebook/react) |
| `react-hook-form` | `7.85.0` | `MIT` | [官方仓库](https://github.com/react-hook-form/react-hook-form) |
| `react-resizable-panels` | `4.12.2` | `MIT` | [官方仓库](https://github.com/bvaughn/react-resizable-panels) |
| `recharts` | `3.8.0` | `MIT` | [官方仓库](https://github.com/recharts/recharts) |
| `sonner` | `2.0.8` | `MIT` | [官方仓库](https://github.com/emilkowalski/sonner) |
| `tailwind-merge` | `3.6.0` | `MIT` | [官方仓库](https://github.com/dcastil/tailwind-merge) |
| `vaul` | `1.1.2` | `MIT` | [官方仓库](https://github.com/emilkowalski/vaul) |
| `zod` | `3.25.76` | `MIT` | [官方仓库](https://github.com/colinhacks/zod) |

### 开发依赖

| 包 | 锁定版本 | 包声明许可 | 来源 |
| --- | --- | --- | --- |
| `@cloudflare/vite-plugin` | `1.37.1` | `MIT` | [官方仓库](https://github.com/cloudflare/workers-sdk) |
| `@cloudflare/workers-types` | `4.20260515.1` | `MIT OR Apache-2.0` | [官方仓库](https://github.com/cloudflare/workerd) |
| `@tailwindcss/postcss` | `4.2.1` | `MIT` | [官方仓库](https://github.com/tailwindlabs/tailwindcss) |
| `@types/node` | `22.19.19` | `MIT` | [官方仓库](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `@types/react` | `19.2.14` | `MIT` | [官方仓库](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `@types/react-dom` | `19.2.3` | `MIT` | [官方仓库](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `@vitejs/plugin-react` | `6.0.2` | `MIT` | [官方仓库](https://github.com/vitejs/vite-plugin-react) |
| `@vitejs/plugin-rsc` | `0.5.26` | `MIT` | [官方仓库](https://github.com/vitejs/vite-plugin-react) |
| `drizzle-kit` | `0.31.10` | `MIT` | [官方仓库](https://github.com/drizzle-team/drizzle-orm) |
| `eslint` | `9.39.4` | `MIT` | [官方仓库](https://github.com/eslint/eslint) |
| `eslint-config-next` | `16.3.4` | `MIT` | [官方仓库](https://github.com/vercel/next.js) |
| `json-rpc-2.0` | `1.7.1` | `MIT` | [官方仓库](https://github.com/shogowada/json-rpc-2.0) |
| `raw-body` | `3.0.2` | `MIT` | [官方仓库](https://github.com/stream-utils/raw-body) |
| `react-server-dom-webpack` | `19.2.6` | `MIT` | [官方仓库](https://github.com/facebook/react) |
| `tailwindcss` | `4.2.1` | `MIT` | [官方仓库](https://github.com/tailwindlabs/tailwindcss) |
| `tw-animate-css` | `1.4.0` | `MIT` | [官方仓库](https://github.com/Wombosvideo/tw-animate-css) |
| `typescript` | `5.9.3` | `Apache-2.0` | [官方仓库](https://github.com/microsoft/TypeScript) |
| `vinext` | `1.0.0-beta.5` | `MIT` | [官方仓库](https://github.com/cloudflare/vinext) |
| `vite` | `8.0.13` | `MIT` | [官方仓库](https://github.com/vitejs/vite) |
| `wrangler` | `4.92.0` | `MIT OR Apache-2.0` | [官方仓库](https://github.com/cloudflare/workers-sdk) |

### 需要保留的包内附加声明

- `lucide-react` 1.31.0 的包声明为 ISC，但完整 `LICENSE` 同时列出 Feather 派生图标的 MIT 许可和 Copyright (c) 2013-present Cole Bemis。发布包含这些图标的产物时，应保留完整文件，不能只写“ISC”。[官方许可来源](https://github.com/lucide-icons/lucide/blob/main/LICENSE)。
- Vite 的 `LICENSE.md` 包含其打包依赖的额外 MIT、ISC、BSD-2-Clause、Apache-2.0、CC0-1.0 声明；包声明“MIT”不能替代完整随包通知。
- 核验环境中的以下 9 个直接包没有根目录完整许可文件，但有明确的包级许可元数据：`drizzle-orm`、`embla-carousel-react`、`input-otp`、`@cloudflare/vite-plugin`、`@cloudflare/workers-types`、`@vitejs/plugin-rsc`、`drizzle-kit`、`eslint-config-next`、`wrangler`。这不等于无许可；若分发其代码或构建产物，需要从对应版本官方来源补齐适用的完整许可及版权通知。

## 4. 传递依赖与产物分发注意事项

锁文件记录 918 个依赖条目，包含平台可选包，不等于实际安装或最终打包的 918 个组件。912 个记录的下载来源为 npm 官方注册表且均有完整性字段；另外 6 个条目为父包自带的 bundled dependencies，没有单独下载地址。完整性字段是可重复安装证据，不是代码作者身份或许可合规证明。

- Sharp / libvips：锁文件含 15 个许可表达式涉及 `LGPL-3.0-or-later` 的平台二进制条目，部分为 `Apache-2.0 AND LGPL-3.0-or-later` 或再加 MIT。它们来自 Sharp 0.35.4 / libvips 打包链，不能一概按 Sharp 的 Apache-2.0 处理。若分发相关二进制、容器镜像或离线安装包，应单独核对链接方式、对应源代码可获得性、替换/重新链接安排及原始通知。[官方 Sharp/libvips 打包仓库](https://github.com/lovell/sharp-libvips)；[LGPL-3.0 正文](https://www.gnu.org/licences/lgpl.html)。
- MPL-2.0：锁文件含 28 个相关条目，包括 `@resvg/resvg-wasm` 2.4.0、`@vercel/og` 0.8.6、`axe-core` 4.11.4、`satori` 0.16.0，以及 `lightningcss` 1.31.1 / 1.32.0 及其平台包。分发时须保留 MPL 覆盖文件的许可与适用的源代码可获得性；它是文件级义务，不能据此断言整个桥接器必须改用 MPL。[Mozilla 官方说明](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)。
- `caniuse-lite` 1.0.30001793：CC-BY-4.0。若分发其数据，需处理署名、许可链接和修改说明。[Creative Commons 官方说明](https://creativecommons.org/licenses/by/4.0/)。
- 还有 BSD、ISC、Python-2.0、CC0-1.0、0BSD、BlueOak-1.0.0 和 `MIT AND ISC` 等条目，不能把整个依赖树标为 MIT。

本候选是源码发布准备包，没有附带上述安装目录或构建产物。仅声明依赖和发布锁文件，不等于随包分发依赖实现；但日后构建输出、容器镜像、客户端 bundle 或离线包的内容仍须重新扫描。当前清单不是最终二进制的完整 SBOM 或完整第三方许可合集。

## 5. 发布检查清单

- [x] 项目所有者已选择 MIT，根目录 LICENSE 使用 `flyingTeng contributors` 署名；仍须持续核实新增内容权属。
- [ ] 确认最终文件清单与本文一致；额外加入的模板、图片、字体或代码另行核验来源。
- [ ] 保留 OpenAI、shadcn、Tencent 的完整许可及各自归属，不用项目主许可证覆盖它们。
- [x] 已记录 vendored CSS、三项实际使用 UI 组件、Sites 插件/模板及 Tencent 参考实现的来源；保留修改说明和核验边界。
- [ ] 如分发构建产物，基于实际产物重新生成完整第三方清单、许可与必要源代码材料。

本文件是工程来源与许可核验记录，不替代针对最终分发方式的法律意见。

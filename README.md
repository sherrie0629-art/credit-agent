# Agent Builder Assistant

按照附件中的需求文档帮我生成 agent 应用，如果你觉得需求过长，可以生成分步骤的实施方案或者清单

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://credit-agent.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fbb79c3c-e136-405b-91d9-6e9a53a5b400).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

### 本地调试（只读模式）

后端由 Lovable Cloud 托管，`SUPABASE_SERVICE_ROLE_KEY` 只在云端运行时注入，本地无法获取。
本地因此以 **只读模式** 运行：

1. 在项目根目录创建 `.env`，按 `.env.example` 顶部填四行（URL + publishable key，
   其中不带 `VITE_` 前缀的两行是服务端读取的，缺了首屏就是空白）。
2. `npm run dev` 后，命令中心 / 投放结构 / 素材中心 / 离线转化等页面的数据均可正常读取——
   它们统一走 `get_agent_snapshot` 等 SECURITY DEFINER 只读 RPC（已授权给 anon）。
3. 审批、预算调整、素材生成与保存、回传上传等写入操作会提示
   「本地开发环境为只读模式」，请在 Lovable 云端预览中验证。

publishable key 是公开密钥，放本地没有安全风险；service role key 永远不要加 `VITE_` 前缀，
也不要提交到仓库。

### 双环境配置（本地 / 云端各存一份，切换零操作）

Google Ads 等服务端变量（`GOOGLE_ADS_*`）在两处各配置一次即可，之后在 Cursor 与
Lovable 之间来回切换不需要任何改动——代码只读 `process.env`，谁给值就用谁的：

| | Cursor 本地 | Lovable 云端 |
| --- | --- | --- |
| 变量来源 | 项目根 `.env`（不提交仓库） | Cloud Secrets |
| 生效方式 | `npm run dev` 自动加载 | 预览 / 发布运行时注入 |
| `GOOGLE_ADS_PROXY` | 需要（SOCKS 代理） | **不要配置**，云端直连，配了会超时 |

注意：云端密钥更新后预览立即生效，正式站需要重新发布一次。本地始终是只读模式，
结构同步等写入操作请在云端预览中验证。


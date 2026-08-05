# 在 Cursor 本地开发时的后端密钥方案

## 结论先说

Lovable Cloud 托管的后端不对外提供 `SUPABASE_SERVICE_ROLE_KEY`，任何界面、菜单或工具都无法查看或复制它。它只在 Lovable 的服务器运行时被注入，所以「获取后粘到本地 .env」这条路在托管模式下走不通。

本地在 Cursor 里开发、调试，有三条可行路线。

## 方案 A：本地只跑前端 + 非特权后端（改动最小）

本地 `.env` 里保留现有的 `SUPABASE_URL` 与 `SUPABASE_PUBLISHABLE_KEY`（已在项目 .env 中），不配置 service role key。

- 页面、前端交互、所有走 RLS 的读写：本地完全可调。
- 依赖 `client.server.ts`（service role）的服务端逻辑：本地会抛「Missing Supabase environment variable」，这类功能改到 Lovable 预览环境里验证。
- 适合：改 UI、改前端逻辑、调样式与交互。

本项目中依赖 service role 的模块主要是：定时巡检、离线转化回传、素材图片存储读写、LLM 分析师写库。

## 方案 B：本地连一个自建 Supabase 项目（可完整调试后端）

在 supabase.com 新建一个你自己的项目（免费档即可），把本项目的迁移 SQL 应用上去，然后在本地 `.env.local` 里填该项目的 URL / publishable key / service role key（自建项目的 service role key 在其 Project Settings → API 中可见）。

- 本地拥有完整 service role 能力，所有服务端函数可跑通。
- 数据与线上隔离，调试不会污染生产数据。
- 代价：需要一次性把库结构同步过去。

## 方案 C：把本项目改为连接你自己的 Supabase（不推荐现在做）

即从 Lovable Cloud 托管切换到自带 Supabase。这样线上线下用同一套密钥，但会改变现有数据归属与运维方式，属于较大的架构变更。

## 需要我做什么

我这边可以配合的动作：

1. 导出本项目当前完整的数据库结构 SQL（表、视图、函数、RLS 策略、GRANT），方便你在方案 B 里一键建库。
2. 整理一份本地 `.env.local` 需要的变量清单与用途说明。
3. 若线上后端出现「密钥缺失/无效」报错，我可以执行一次后端密钥重新绑定修复（无需你提供任何值）。

## 技术细节

- 服务端读取路径：`src/integrations/supabase/client.server.ts` 中 `process.env.SUPABASE_SERVICE_ROLE_KEY`，仅在 `*.server.ts` 与 server handler 内加载，浏览器永远拿不到。
- `SUPABASE_*` 是保留前缀，无法通过密钥管理工具手动写入；托管环境由平台绑定。
- 本地 `.env.local` 不应提交到仓库；service role key 绝不能出现在任何 `VITE_` 变量里。

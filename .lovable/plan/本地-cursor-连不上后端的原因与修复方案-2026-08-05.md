# 本地（Cursor）连不上后端的原因与修复方案

## 诊断结果（已核实）

- `.env` 里只有 `SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / VITE_*`，**没有** `SUPABASE_SERVICE_ROLE_KEY`（Lovable Cloud 只在云端运行时注入，不下发到本地）。
- 本项目所有数据访问确实都走 service role：`agent.server.ts`、`conversions.server.ts`、`creative.server.ts`、`guardrails.server.ts`、`reallocate.server.ts`、`advisor.server.ts`、`sweep.server.ts`、`image-storage.server.ts` 全部 `await import("@/integrations/supabase/client.server")`。
- `client.server.ts` 缺少该变量时直接抛「Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY」，于是本地页面全空。
- 其他 Lovable 项目在 Cursor 里正常，是因为它们的数据读取走浏览器端 publishable key（受 RLS 约束），本地 `.env` 里就有；本项目为绕过 RLS 走了 admin 路径。所以不是"配置坏了"，而是这个项目的架构选择导致本地缺一把云端才有的钥匙。

补充：本项目此前为满足安全扫描，已把 `agent_decisions / campaigns / creative_*` 等表的匿名读取策略收紧，所以单纯换成 publishable key 也读不到数据——必须同时决定读取权限模型。

## 方案 A：只读快照改走带 RLS 的公开读（推荐，且同时提升线上安全性）

把首屏读取路径（`get_agent_snapshot` RPC 及其依赖）从 service role 改为服务端 publishable 客户端：

1. 迁移：为快照涉及的表/视图新增窄口径 `TO anon` SELECT 策略，或把 `get_agent_snapshot` 保留为 `SECURITY DEFINER` 并 `GRANT EXECUTE ... TO anon`（后者改动最小，只放开这一个聚合只读函数）。
2. `agent.server.ts` 的读取分支改用 publishable 客户端（含 `sb_` key 的 apikey fetch 兜底）。
3. 写入类操作（审批、预算调整、回传上传、图片写入）继续保留 service role，本地这些按钮会报缺钥匙——属于预期，云端预览验证。

效果：本地 `bun dev` 直接能看到全部仪表盘数据，无需任何新密钥。

## 方案 B：本地放一把自己的 service role（调试最完整）

在 supabase.com 建一个你自己的项目，导入本项目的库结构与种子数据，在本地 `.env.local` 里写该项目的 URL / publishable / service role key。

- 本地读写全通，包含 AI 分析师、回传、图片存储。
- 需要一次性同步 schema；我可以导出完整 SQL（表、视图、函数、RLS、GRANT、种子数据）。
- 数据与线上隔离。

## 方案 C：临时降级（不改架构）

在 `client.server.ts` 之外加一个本地兜底：缺 service role 时退回 publishable 客户端并打印告警。开发体验最快，但仍受 RLS 限制，需要配合方案 A 的策略调整才有数据，实质是 A 的子集，不单独推荐。

## 建议

先做方案 A（本地即刻可读、线上更安全），若你还需要在本地调试写入与 AI 链路，再叠加方案 B 建一个私有开发库。

## 技术细节

- 新增 publishable 服务端客户端时，必须对 `sb_publishable_` 这类不透明 key 删掉默认 `Authorization: Bearer`、只发 `apikey`，否则 PostgREST 报 `Expected 3 parts in JWT; got 1`。
- 读取路径改造集中在 `src/lib/creditagent/agent.server.ts` 的 `getClient()` 拆分为 `getReadClient()` / `getAdminClient()`。
- 迁移需含 `GRANT EXECUTE ON FUNCTION public.get_agent_snapshot() TO anon;` 及必要的表级 `GRANT SELECT`。
- `.env.local` 不提交仓库；service role key 绝不可加 `VITE_` 前缀。

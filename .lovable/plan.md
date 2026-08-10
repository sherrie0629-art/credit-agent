# 本地 Cursor 只读调试：不用 service role 也能看到数据

## 先说结论

Lovable Cloud 不下发 `SUPABASE_SERVICE_ROLE_KEY`（我这边也读不到、无法代发），所以本地必须走「publishable key + 只读 RPC」这条路。好消息是权限已经就绪，本地页面空白基本是环境变量没配全 + 部分读取路径还没接入兜底。

## 已核实的现状

- `get_agent_snapshot` / `get_budget_pool_today` / `get_conversion_snapshot` 三个 SECURITY DEFINER 函数都已 `GRANT EXECUTE TO anon`，用 publishable key 就能读。
- `read-client.server.ts` 的兜底逻辑存在：无 service role 时自动改用 publishable 客户端。
- 但只有 4 个文件接了兜底：`agent.server.ts`、`conversions.server.ts`、`report.server.ts`、`reallocate.server.ts`。
- 仍然强制走 service role 的读取路径：`creative.server.ts`、`structure.server.ts`、`google-ads.server.ts`、`pid.server.ts`、`guardrails.server.ts`、`sweep.server.ts`、`advisor.server.ts`、`image-storage.server.ts`。其中素材中心 / 结构管理的读取会在本地直接抛「Missing SUPABASE_SERVICE_ROLE_KEY」。
- 兜底客户端读的是 **不带 VITE_ 前缀** 的 `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`。本地 `.env` 若只写了 `VITE_*`，服务端就拿不到 → 首页整片空白。

## 要做的事

### 1. 本地 `.env` 模板（你直接复制）

```
VITE_SUPABASE_URL=https://<项目子域>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_EgtQ3U7mLlATedMBDnhnsw_CZ71lVnW
SUPABASE_URL=https://<项目子域>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_EgtQ3U7mLlATedMBDnhnsw_CZ71lVnW
```

publishable key 是公开密钥，放本地没有安全问题；URL 我在实施时一并写进 `.env.example` 注释里，你照抄即可。关键点是那两行**不带 VITE_ 前缀**的必须存在。

### 2. 把剩余只读路径接入兜底

给素材中心、结构管理等页面的**读取**函数换成 `getReadClient()`；写入函数保持 `supabaseAdmin` 不变。涉及 `creative.server.ts`、`structure.server.ts`、`google-ads.server.ts` 的查询分支。

若某些读取依赖的表没有 anon 策略，就补一个 SECURITY DEFINER 的只读 RPC（与现有三个同款，`GRANT EXECUTE TO anon`），不放宽任何表级匿名权限，线上安全姿态不变。

### 3. 缺钥匙时给人话提示

`client.server.ts` 是自动生成文件不动；改为在写入类 server function 外层用 `hasServiceRole()` 预检，缺失时返回「本地开发环境不支持写入操作，请在云端预览验证」的明确提示，而不是抛底层报错。

### 4. 补一段 README 本地调试说明

写清楚：本地只读可用、写入需云端、`.env` 需要哪四行、service role 为什么拿不到。

## 技术细节

- publishable key 是不透明字符串，不是 JWT，必须删掉默认 `Authorization: Bearer` 只发 `apikey`（`read-client.server.ts` 已实现，新增路径复用它）。
- 不新增任何 `TO anon` 的表级 SELECT 策略，只经由 SECURITY DEFINER RPC 暴露聚合只读结果。
- service role key 永远不加 `VITE_` 前缀，也不写进仓库。

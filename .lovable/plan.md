## 诊断结果（已实测，不是猜测）

我在你正在预览的页面里直接测了真实耗时：

- 数据库本身**不慢**：核心统计视图 `v_placement_facts` 实际执行 **4.5 毫秒**。
- 慢的是接口：一次 `fetchSnapshot` 请求耗时 **7.8 秒**（另一个请求 0.46 秒）。

原因很明确，在 `src/lib/creditagent/agent.server.ts` 的 `getSnapshot()` 里：一次快照要发起 **约 25 次独立的数据库网络请求**（11 张表 + 4 个统计视图 + `getPlacements` 内部 4 个 + `getFeedbackHealth` 内部 3 个串行请求）。每次都是服务端到数据库的一次 HTTP 往返，单次几百毫秒，累加就是秒级。数据库查询只占其中不到 1%。

另外三个放大问题：

1. **没有 SSR 预取**：数据在浏览器 hydrate 之后才由 `useAgentBootstrap()` 发起请求，所以页面先白/骨架屏，再等 7 秒才出数。
2. **任何一次操作都重取全量**：批准决策、改预算、开关模式……每个 mutation 都返回整个 snapshot，等于每次点击都付一遍 7 秒。
3. **导航没有预加载**：`src/router.tsx` 没设置 `defaultPreload`，鼠标悬停在菜单上时不会提前加载目标页面的代码块（analytics / conversions 还各自打包了 recharts，chunk 较大）。

## 优化方案

### 一、把 25 次往返压成 1 次（主要收益，预计 7.8s → 0.2s 内）

新增一个数据库函数 `public.get_agent_snapshot()`（SECURITY DEFINER，只读，返回单个 JSON）：在库内用 `json_build_object` 一次性聚合 decisions / campaigns / ad_groups / creative_assets / agent_settings / funnel / channel_trend / channel_breakdown / creative_metrics / variants / experiments / placements 以及四个统计视图和回传健康度。`getSnapshot()` 改为 `supabase.rpc('get_agent_snapshot')` + 现有的 map 函数做字段映射，业务逻辑与返回结构完全不变。

同时修掉 `getFeedbackHealth()` 里的串行三段查询和 `feedbackNote()` 每次调用都重算全量健康度的问题（改为本次请求内复用）。

### 二、SSR 预取，首屏直接带数据

在每个页面路由的 `loader` 里预取快照（通过 TanStack Query `ensureQueryData`），store 初始化时接收服务端已有数据，浏览器不再从零发起首个请求。骨架屏保留作为兜底。

### 三、mutation 不再全量重取

- 轻量操作（切换模式、风控优先、改预算、暂停/启用广告组）改为**乐观更新本地状态**，服务端仍返回快照但只在后台对账。
- 服务端 mutation 函数不再无条件 `return getSnapshot()`，只返回受影响的实体，前端局部合并。

### 四、导航提速

- `src/router.tsx` 增加 `defaultPreload: "intent"` + `defaultPreloadDelay: 50`，悬停菜单即预载目标页代码。
- `AppShell` 的菜单项本来就是 `<Link>`，会自动生效。
- analytics / conversions 两个页面的 recharts 图表改为懒加载（`React.lazy` + 骨架占位），避免进入页面时先等大 chunk。

### 五、转化页额外一次请求

`src/routes/conversions.tsx` 在 `useEffect` 里单独调 `fetchConversionSnapshot()`，同样合入 loader 预取。

## 技术要点

- 新增迁移：`get_agent_snapshot()` 函数 + 必要的 `GRANT EXECUTE`；不改任何表结构和 RLS。
- 只重写 `agent.server.ts` 的取数层，`AgentSnapshot` 类型与 UI 消费方式不变。
- 交付后会用同样的方法复测接口耗时，给出优化前后的对比数字。

## 预期效果

| 指标 | 现在 | 目标 |
| --- | --- | --- |
| 快照接口 | 7.8 s | < 0.3 s |
| 首屏出数 | hydrate 后再等 7 s | 随 HTML 一起返回 |
| 点击审批/改预算 | 每次 7 s | 立即响应（乐观更新） |
| 菜单切页 | 现取 chunk | 悬停即预载 |

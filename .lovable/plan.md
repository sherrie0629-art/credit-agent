## 诊断结论（已核实）

数据不是缺失，是**前端没跑起来**。

已核实的事实：
- 数据库有真实数据：`leads` 262 条、`lead_events` 448 条、`agent_decisions` 14 条、`campaigns` 2、`ad_groups` 4、`creative_assets` 3、`funnel_stages` 5、`channel_breakdown` 4。
- 统计视图全部正常：`v_adgroup_facts`、`v_campaign_facts`、`v_placement_facts`、`v_funnel` 均能查出正确的 CPL/CPS/放款数。
- 在沙箱里用无痕浏览器打开首页，页面完整渲染：「今日 AI 接管次数 42」「CPS 降幅 −18.4%」「14 条决策」，推理流里有真实决策卡。
- 你的预览标签页：会话回放显示两次 Vite 报错遮罩，网络日志里是 `TypeError: Importing a module script failed`；我尝试在你的预览页里执行探测脚本，没有任何响应 —— 说明该页面的 JS 根本没有加载成功。

原因：开发服务器日志里出现过 `optimized dependencies changed. reloading`（Vite 依赖预打包在你会话中途重建）。你的标签页拿着旧的模块地址去请求，模块已被替换 → 模块加载失败 → React 从未 hydrate → `useAgentBootstrap` 从未调用后端快照 → 所有面板停留在 SSR 的空初始值（0、空列表）。

## 修复方案

1. 重启开发服务器并清掉 Vite 依赖预打包缓存，消除新旧模块地址不一致。
2. 强制刷新预览页，验证首页、预算与投放、素材中心、全链路归因、离线转化回传五个页面都能拿到真实数据。

## 顺带加固（避免下次“看起来没数据”而无提示）

3. `src/lib/creditagent/store.ts` 目前快照请求失败只在 console 打印，界面无感知。改为把 `error` 状态暴露到 `AppShell`，顶部显示「后端数据加载失败 · 重试」条并提供重试按钮。
4. 首屏空态区分「加载中」和「无数据」：现在决策流空列表和加载中长得一样，加一个骨架/加载态，避免误判为没数据。

## 技术备注

数据链路本身无需改动：`getSnapshot()` 读表 + 四个视图，字段映射与广告组层级都验证过是正确的。这次是纯前端模块加载问题，不涉及数据库或服务端逻辑改动。

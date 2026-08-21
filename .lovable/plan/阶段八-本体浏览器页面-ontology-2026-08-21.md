# 阶段八：本体浏览器页面 `/ontology`

把已落地的本体层（12 类实体、14 条关系、6 类动作、6 类不变量）变成一个可现场点击演示的白盒界面：客户能看到「系统认识哪些业务对象」「它们怎么连」「Agent 能做什么、被什么挡住」。

不新增数据库迁移，不改动任何业务写路径，全部复用现有 `ontology.functions.ts` 的三个 server function。

## 页面结构

新增路由 `src/routes/ontology.tsx`，三个 Tab（沿用 `/creative`、`/analytics` 的 `?tab=` 搜索参数写法）：

**Tab 1 · 本体图谱（schema）**
- 左侧：实体类型清单，来自 `OBJECT_TYPES`。每张卡展示中文名、表名、关键属性数、`平台镜像只读` 标记、Agent 可写列白名单（空则显示「只读实体」）。
- 右侧：选中实体后展示它的出边/入边（`outgoingLinks` / `incomingLinks`），含关系中文名、基数、外键列，点关系可跳到对端实体。
- 顶部一张 ASCII/SVG 概览：Campaign → AdGroup → Creative 主链路 + 受众段、线索、决策三条支线。

**Tab 2 · 实体浏览（instance）**
- 选实体类型 + 填实体 ID + 选深度（1–3），调 `fetchSubgraphFn` 取真实子图。
- 结果分两栏：节点按类型分组列出关键属性；关系列表按 `link.label` 展示，节点 ID 可一键设为新根继续下钻。
- 提供「查看 LLM 视角」开关，切换到 `fetchSubgraphTextFn` 返回的紧凑文本，并显示节点/边数与截断提示——直观说明「参谋只吃这么多 token」。
- 无 ID 时给一组从当前快照（`agentSnapshotQuery`）取的候选广告组/素材做快捷入口，演示时不用手抄 UUID。

**Tab 3 · 动作与护栏（action safety）**
- 上半：`ACTION_TYPES` 六个动作卡，展示作用对象、会改哪些列、产生哪些副作用实体、依赖哪些前置条件。
- 下半：动作试算器。选动作 → 按其 Zod schema 渲染参数表单 → 调 `checkActionFn` 跑 `ontologyPreflight`，把每条不变量的通过/拦截结果逐行展示（含拦截原因）。这是演示「幻觉打不进来」最有说服力的一屏：故意填一个不存在的 ID，当场看到 `TARGET_EXISTS` 红灯。
- 侧栏：近期 `guardrail_events` 中 `rule` 以 `ONTOLOGY_` 开头的记录列表（只读查询）。

## 导航与元信息

- `AppShell` 的 `NAV` 增加一项：`/ontology`，标题「业务本体」，副标题「实体图谱 · 动作护栏」，图标用 `Network`（lucide）。
- 路由 `head()` 给独立标题与描述（如「业务本体 · 实体图谱与动作护栏 | CreditAgent AI」），含 og/twitter 字段，与现有路由口径一致。

## 技术要点

- 页面全部走已有 server function，不写新的 SQL；`guardrail_events` 侧栏若快照里已有数据则直接取快照，否则新增一个只读 server function。
- Tab 1 完全是纯前端渲染 `OBJECT_TYPES` / `LINK_TYPES` / `ACTION_TYPES` 常量，零网络请求，秒开。
- Tab 2/3 的请求用 `useQuery` + `useServerFn`，不放进 loader（避免预渲染时无会话）。
- 样式复用现有 `panel`、`label-mono` 等语义 class 与 shadcn `Tabs`/`Badge`/`Collapsible`，不引入新色值。

## 不做的事

- 不引入图可视化库（d3/cytoscape）；关系用列表 + 可点击下钻表达，避免包体膨胀和演示时的布局抖动。
- 页面全只读：不提供任何从本体浏览器直接执行动作的入口，试算器只跑校验、不落库。

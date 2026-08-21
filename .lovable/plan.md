# 本体论（Ontology）范式落地 CreditAgent — 分步骤实施方案

目标：把现在「表 + 硬编码规则 + LLM 建议」的结构，升级为「业务图谱（实体-关系-动作）+ 图谱约束下的 Agent 读写」。核心收益是三条：归因能穿透到实体、决策能追溯到路径、写操作被本体约束挡住幻觉。

原则：不引入图数据库，继续用 Postgres + 应用层本体抽象；受众等平台侧对象一律「只拉不推、UI 只读」；LLM 仍然只产建议，不获得写权限。

---

## 阶段一：本体注册表（1 步，纯代码，无迁移）

把散落在 `types.ts` / SQL 视图里的隐式模型，收敛成一份显式、可被代码引用的本体定义。

新增 `src/lib/creditagent/ontology/`：
- `objects.ts` — Object Type 定义：Campaign、AdGroup、CreativeAsset、CreativeVariant、CreativeExperiment、CreativePlacement、AudienceSegment、Lead、LeadEvent、AgentDecision、BudgetPoolEntry、GuardrailEvent。每个类型声明：`id 字段`、`表名`、`关键属性`、`是否平台镜像（origin 感知）`。
- `links.ts` — Link Type 定义：`Campaign contains AdGroup`、`AdGroup delivers CreativeAsset (via creative_placements, 带 share)`、`AdGroup targets AudienceSegment`、`Lead attributed_to AdGroup/Creative`、`AgentDecision acts_on X`、`AgentDecision produces BudgetPoolEntry`、`GuardrailEvent blocks AgentDecision`。每条边声明两端类型、基数、外键列。
- `actions.ts` — Action Type 定义：`BUDGET_SHIFT`、`BID_ADJUST`、`CREATIVE_PAUSE`、`CREATIVE_REFRESH`、`VARIANT_PROMOTE`。每个动作声明：输入参数 schema（zod）、作用对象类型、前置条件列表、产生的副作用实体。

产出：一份机器可读的本体，后续所有阶段都引用它。此阶段不改任何运行时行为。

验收：`tsgo` 通过；本体定义与现有表结构一一对上（人工核对清单）。

---

## 阶段二：子图查询层（1 步，纯代码）

Agent 与 UI 都需要「以某个实体为中心取 N 跳邻域」的能力，避免把全量 snapshot 喂给 LLM。

新增 `src/lib/creditagent/ontology/subgraph.server.ts`：
- `getSubgraph({ rootType, rootId, depth })` — 按 `links.ts` 声明的边，从 Postgres 拉取有限跳邻域，返回 `{ nodes, edges }`。
- 深度上限 3，节点数上限（默认 200）截断并标注 `truncated`。
- 复用现有 `read-client.server.ts` 的只读/管理端 client 选择逻辑。

新增 `src/lib/creditagent/ontology/serialize.ts`：把子图压成给 LLM 的紧凑文本（实体 + 关键指标 + 关系），控制 token。

验收：对一个真实 AdGroup 取 2 跳子图，能拿到父 Campaign、投放素材、近期线索统计、相关决策。

---

## 阶段三：本体一致性检查接入护栏（1 步，纯代码）

在现有 `guardrails.ts` / `guardrails.server.ts` 的硬编码阈值之上，加一层「结构合法性」检查，作为所有自动写入的前置门控。

新增 `src/lib/creditagent/ontology/invariants.ts`（纯函数，可单测）：
- 类型合法：`BID_ADJUST` 不能作用于不需要 target 的出价策略（复用 `structure.ts` 的 `bidStrategyNeedsTarget`）。
- 状态一致：父 Campaign 为 PAUSED 时不得单独激活其 AdGroup；`COMPLIANCE_HOLD` 对象禁止加预算。
- 平台镜像保护：`origin != demo` 的实体禁止结构性改写，只允许预算/启停。
- 资金守恒：当日 `budget_pool_entries` 的 ALLOCATE 累计不得超过 RELEASE 累计。
- 引用完整：决策引用的 adGroupId / creativeId 必须在本体中存在（挡 LLM 幻觉 ID，与现有 `sanitizeAdvice` 互补）。

改造 `guardrails.server.ts` 的 `preflight`：先跑 invariants，再跑现有阈值检查；违反时写 `guardrail_events`（`rule` 记为 `ONTOLOGY_*`）。

验收：构造违规输入的单测全部被拦截；正常审批路径行为不变。

---

## 阶段四：决策的图谱差分与审计视图（1 步，含迁移）

让每条决策带上「动作前子图快照 + 预期变更」，审批页展示影响面。

迁移：`agent_decisions` 增加两列
- `ontology_before jsonb`（决策生成时的相关子图快照，裁剪版）
- `ontology_diff jsonb`（预期节点变更：`[{ type, id, field, from, to }]`）

代码：
- `agent.server.ts` 创建决策时调用 `getSubgraph` + 动作定义生成 diff 一并落库。
- `DecisionCard.tsx` 增加「影响面」折叠区：列出会变更的实体、字段、前后值，以及触发/通过的护栏规则。

验收：新产生的决策卡上能看到「本次将改动 2 个广告组的日预算，资金来自 X 组释放」。

---

## 阶段五：受众镜像实体（1 步，含迁移）

受众圈选真相源在 Google / Meta 后台，本地只做只读镜像 + 本地派生指标。

迁移：
- 新建 `audience_segments`：`id`、`channel`、`name`、`platform_resource_name`、`targeting_json`、`origin`（`google_sync|meta_sync`）、`synced_at`、`platform_removed`、时间戳。RLS + GRANT 按现有镜像表（如 `ad_groups`）的口径。
- 新建 `audience_segment_facts`（本地派生，可写）：`segment_id`、`expected_cvr`、`expected_disb_rate`、`sample_size`、`maturity`、`window_from/to`。
- `ad_groups` 增加 `audience_segment_id`（可空，外键），保留现有 `audience` 文本作为回退显示。

代码：
- `google-ads-sync.server.ts` / `meta-ads-sync.server.ts` 在结构同步时一并 upsert 受众镜像并回填 `ad_groups.audience_segment_id`；平台侧删除标 `platform_removed`。
- `StructureTab.tsx` 受众字段改为只读展示 + 「在平台后台修改」提示。
- Agent 侧不产生受众写操作；如判断受众需调整，只出「建议人工在平台后台修改」的 PENDING 卡。

验收：同步后广告组能显示平台真实受众名；UI 上无任何本地圈人入口。

---

## 阶段六：因果归因绑定到实体（1 步，纯代码）

把现有 `attribution.ts` 的杜邦分解结果，从「一堆数字」变成「挂在实体上的因子贡献图」。

- `attribution.server.ts`：分组维度增加 `audienceSegmentId`，按受众段聚合一份分解。
- `attribution.ts`：新增 `attributeFactorToEntities()`，把 CPC / CVR / 放款率三个因子的变化，归到 AdGroup、AudienceSegment、CreativePlacement 三类节点上，并按贡献额排序。
- `AttributionPanel.tsx`：新增「因子归属」区块——「CPC 恶化 82% 来自受众段 A 在 Reels 版位」，每行可下钻到对应实体。

验收：归因面板能回答「这次 CPS 上涨主要由哪个实体造成」。

---

## 阶段七：LLM Analyst 改吃子图（1 步，纯代码）

- `advisor.server.ts`：prompt 上下文从「全量 snapshot 摘要」换成「问题相关子图（阶段二的 serialize 输出）」。
- 建议输出 schema 要求显式给出 `objectType + objectId`，落库前先过 `invariants.ts` 的引用完整性检查，失败直接丢弃并记入 `advisor_runs.dropped`。
- 保持现有约束：只插 PENDING，不写业务表。

验收：`advisor_runs` 中 token 用量下降、幻觉 ID 丢弃数下降。

---

## 阶段八（可选）：本体浏览器页面

新增 `/ontology` 路由：可视化实体关系图、点选实体查看属性与近期决策、查看本体不变量清单与近期违规。用于给客户演示「白盒可穿透」。

---

## 排期建议

| 阶段 | 内容 | 依赖 | 是否含迁移 |
|------|------|------|-----------|
| 一 | 本体注册表 | — | 否 |
| 二 | 子图查询层 | 一 | 否 |
| 三 | 本体护栏 | 一 | 否 |
| 四 | 决策图谱差分 | 二、三 | 是 |
| 五 | 受众镜像实体 | 一 | 是 |
| 六 | 因果归因绑实体 | 二、五 | 否 |
| 七 | LLM 吃子图 | 二、三 | 否 |
| 八 | 本体浏览器 | 全部 | 否 |

建议先做一到三（无迁移、零风险、立刻提升安全性），确认手感后再推进四、五。

---

## 边界与不做的事

- 不引入图数据库；热数据仍走 `get_agent_snapshot` RPC。
- 不给 LLM 任何写库或 Ads mutate 工具。
- 不在本地做受众圈选或向平台推送定向变更。
- 不新增第二套护栏阈值；限额仍统一读 `agent_settings`。

# Palantir 本体论 Agent 范式在 CreditAgent 中的概念分析

## 1. 结论：高度适用，但应分阶段落地

Palantir 的 Ontology Agent 范式（把业务建模成「实体-关系-规则-动作」的可计算图谱，Agent 通过读写图谱来执行业务）对 AI 广告自动化投放非常适用。消费信贷投放的因果链长、合规要求高、资金动作敏感，正是「需要可审计的业务图谱」而非「黑箱端到端模型」的典型场景。

但本体论不是简单加一张图数据库。对 CreditAgent 来说，第一阶段应聚焦「把现有关系型模型显式化为本体语义层」，让 LLM/Agent 的推理和动作都锚定在这个语义层上，而不是直接操作 SQL 表。

## 2. 为什么适用：三个契合点

### 2.1 业务实体天然分层
CreditAgent 已有清晰的实体层级：

```text
Advertiser（客户）
  └── Portfolio（投放组合）
        └── Campaign（系列 / 渠道级）
              └── AdGroup（广告组 / 执行单元）
                    └── CreativePlacement（素材投放关系）
                          └── CreativeAsset（素材）
                                └── CreativeVariant（变体 / 实验臂）
  └── AudienceSegment（受众段）
  └── Lead（线索） → LeadEvent（事件） → Disbursement（放款）
  └── AgentDecision（决策） / GuardrailEvent（护栏事件）
```

这与 Palantir 的 Object Type → Property → Link Type → Action Type 模型天然对应。

### 2.2 因果链比单纯统计更重要
当前归因看板已经做到「结果记账」。本体论可以进一步回答「为什么」：CPS 上升是因为 CPC 变贵、转化率下降、还是放款率下降？预算从 A 组挪到 B 组后，B 组增量中有多少是真实增量、多少是从 A 组转移过来的？这些问题需要显式建模实体间的因果路径。

### 2.3 动作需要可审计、可回滚
Agent 的预算调整、启停、素材替换都是资金动作。本体论可以把每一次动作表达为「从状态 S1 到 S2 的图谱变换」，并强制通过规则验证（preflight）。这比在 SQL 里直接 UPDATE 一行更易于审计和回滚。

## 3. 本体层设计草案

### 3.1 核心 Object Types

| Object Type | 对应现有表 | 关键属性 | 关键关系 |
|-------------|------------|----------|----------|
| Advertiser | 客户维度（可新增） | industry, risk_appetite, target_cps | owns Campaign |
| Campaign | campaigns | channel, placement, status, daily_budget, origin | contains AdGroup, targets AudienceSegment |
| AdGroup | ad_groups | bid_strategy, bid_target, status, daily_budget | belongs_to Campaign, delivers Creative via CreativePlacement, generates Lead |
| CreativeAsset | creative_assets | compliance_status, fatigue_level, max_apr | has Variant, placed_in AdGroup |
| CreativeVariant | creative_variants | angle, compliance_score | belongs_to CreativeAsset, participates_in Experiment |
| CreativeExperiment | creative_experiments | status, winner_variant_id | arms Variant |
| CreativePlacement | creative_placements | share, status | links CreativeAsset ↔ AdGroup |
| AudienceSegment | 新增 / 从 audience 字符串提炼 | channel, targeting_json, expected_cvr | targeted_by Campaign/AdGroup |
| Lead | leads | channel, click_at, landing_url | attributed_to AdGroup/Creative, has_events LeadEvent |
| LeadEvent | lead_events | event_type, value, occurred_at | belongs_to Lead |
| AgentDecision | agent_decisions | action_type, status, trigger_source, confidence_score | acts_on Campaign/AdGroup/Creative, produces BudgetPoolEntry |
| BudgetPoolEntry | budget_pool_entries | direction, amount, status | releases_from / allocates_to AdGroup |
| GuardrailEvent | guardrail_events | rule, verdict, detail | blocks_or_modifies AgentDecision |

### 3.2 关键 Link Types（关系语义化）

- `Campaign --contains--> AdGroup`：结构关系，决定预算层级。
- `AdGroup --delivers--> CreativeAsset`：通过 CreativePlacement 实现，带 share 权重。
- `AdGroup --targets--> AudienceSegment`：投放目标关系。
- `Lead --attributed_to--> AdGroup / CreativeAsset`：归因关系，支持多触点时可扩展为路径。
- `AgentDecision --acts_on--> AdGroup`：动作对象。
- `AgentDecision --produces--> BudgetPoolEntry`：资金影响。
- `GuardrailEvent --blocks--> AgentDecision`：规则拦截。

### 3.3 Action Types（本体化动作）

把当前 `action_type` 枚举扩展为有输入/输出/前置条件的动作类型：

- `BUDGET_SHIFT`：输入（from AdGroup, to AdGroup, amount），输出（BudgetPoolEntry pair），前置条件（guardrail checkBudgetChange）。
- `BID_ADJUST`：输入（AdGroup, new bid_target），前置条件（bidStrategy 允许 target）。
- `CREATIVE_PAUSE` / `CREATIVE_REFRESH`：输入（CreativePlacement 或 CreativeAsset），前置条件（compliance_status != FAILED）。
- `VARIANT_PROMOTE`：输入（experiment_id, winner_variant_id），前置条件（统计显著性 / 样本量）。

## 4. 四个高价值应用场景

### 4.1 因果归因：从「结果记账」到「机制解释」
当前 `AttributionPanel` 已经用杜邦分解把 CPS 拆成 CPC × 1/CVR × 1/DisbRate。本体论可以进一步把每个因子锚定到具体实体：

- CPC 上升 → 是某个 AudienceSegment 竞争激烈，还是某个 Placement 流量质量下降？
- CVR 下降 → 是 Landing Page 问题，还是 Creative 与 Audience 不匹配？
- 放款率下降 → 是某个 Campaign 引入的用户资质变差，还是宏观经济因素？

实现方式：把 `CpsDecomposition` 中的每个因子变化标注到 `AdGroup` / `AudienceSegment` / `CreativePlacement` 节点上，形成「因子贡献图」。

### 4.2 决策审计：每一次 Agent 动作都可追溯
当前 `agent_decisions` 表已经记录了动作，但本体论可以让审计更结构化：

- 动作前状态快照：相关 Campaign、AdGroup、Creative、BudgetPool 的完整子图。
- 动作规则路径：触发了哪些 guardrail，哪些被通过、哪些被拦截。
- 动作后预期 vs 实际：把 `effect` 字段扩展为图谱差分（graph diff）。

这样审批页面可以展示「如果批准，哪些节点会变化、变化量是多少、是否符合本体约束」。

### 4.3 执行护栏：用本体约束防止 LLM 幻觉
当前 `guardrails.ts` 是硬编码规则。本体论可以把它升级为「本体一致性检查」：

- 类型检查：`BID_ADJUST` 不能作用于 `bid_strategy = "Lowest Cost"` 的 AdGroup。
- 关系检查：暂停的 Campaign 下不能单独激活 AdGroup（状态一致性）。
- 预算守恒：所有 `BudgetPoolEntry` 的 RELEASE 总量 ≥ ALLOCATE 总量。
- 合规检查：`CreativeAsset` 的 `max_apr` 必须 ≤ Advertiser 所在司法管辖区上限。

这些检查可以独立于 LLM，作为 Agent 动作的前置门控。

### 4.4 跨实体预算再分配：图谱驱动的资金流动
当前 `reallocate.ts` 已经能筛选高胜率 AdGroup 并生成待审卡。本体论可以让逻辑更透明：

- 释放节点：哪些 AdGroup 因为风险/疲劳/节奏被释放预算，释放原因是什么。
- 候选节点：哪些 AdGroup 符合接收条件，各自的胜率、CPS、成熟度如何。
- 资金路径：从 A 到 B 的每一笔 BudgetPoolEntry 都有完整的图谱路径，便于后续归因「这笔预算增量带来了多少真实放款」。

## 5. 受众本体：从字符串标签到结构化实体

当前 `ad_groups.audience` 是文本字段。建议引入 `AudienceSegment` 作为一等实体：

```text
AudienceSegment
  - id
  - name（如 "25-34 一线城市 有信用卡"）
  - channel
  - targeting_json（平台原生定向参数）
  - expected_cvr / expected_disb_rate（历史基准）
  - competitive_intensity（竞争强度，可外部接入）
  - lookalike_seed（种子人群，可选）
```

关系：
- `AdGroup --targets--> AudienceSegment`
- `Campaign --has_primary_audience--> AudienceSegment`
- `AudienceSegment --performs_in--> Placement`（不同版位下的表现基准）

价值：
- 让 LLM 在生成建议时基于结构化受众，而不是自由文本。
- 支持「受众 × 素材 × 版位」的实验设计。
- 未来可接入外部数据源（征信分段、竞品定向情报）。

## 6. 风险与边界

| 风险 | 说明 |
|------|------|
| 过度工程 | 本体论层如果设计过重，会增加每次 schema 变更的成本。建议先对核心实体做语义封装，而非全量迁移到图数据库。 |
| LLM 推理成本 | 把完整图谱喂给 LLM 会导致 token 暴涨。应使用「子图抽取」：根据问题只取相关 2-3 跳子图。 |
| 实时性 | 本体层不应替代现有的 `get_agent_snapshot` 聚合 RPC。它应作为元数据/规则层，热数据仍走 SQL + RPC。 |
| 外部数据可信度 | 竞品定向、市场利率等外部实体质量不稳定，应标注置信度，避免污染决策。 |

## 7. 下一步建议

1. **先做一个最小本体层映射**：把现有 `campaigns / ad_groups / creative_assets / leads / agent_decisions` 的字段和关系整理成一份显式的「实体-关系-动作」文档，作为团队共识。
2. **在归因模块试点**：把 `AttributionPanel` 的杜邦分解结果绑定到具体 AdGroup / AudienceSegment 节点，验证「因子贡献图」对产品价值的提升。
3. **把受众从字符串升级为「平台同步的只读实体」**：圈选标签仍在 Google / Meta 后台维护，本地新增 `audience_segments` 只做平台定向的镜像（随结构同步拉取、`origin=google_sync/meta_sync`、UI 只读），把 `ad_groups.audience` 自由文本换成对镜像实体的引用；本地只额外写「派生指标」（历史 CVR / 放款率 / 成熟度）这类平台不提供、且由我方数据算出的字段，不做本地圈人。
4. **动作本体化**：把 `agent_decisions` 的 `action_type` 扩展为带输入/输出/前置条件的 Action Type，并在 `guardrails` 中增加本体一致性检查。
5. **暂不引入图数据库**：当前 Postgres + JSONB + 应用层图谱抽象已足够。只有当多跳归因、复杂关系查询成为瓶颈时，再考虑 Neo4j / TigerGraph 等专业图库。

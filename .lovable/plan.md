## 现状(已核查)

- `creative_assets` 表没有任何指向 `campaigns` 的字段,两者在数据层完全独立。
- 创意模块写决策日志时,把素材 ID 当成 `campaign_id`、素材标题当成 `campaign_name`(`src/lib/creditagent/creative.server.ts` 第 112、267、372、522 行),导致决策流里"广告系列"一栏显示的其实是素材。
- 因此素材中心看不到素材投在哪个系列,广告系列页也看不到在跑哪些素材,疲劳/合规风险无法传导到预算决策。

## 目标

素材与广告系列建立多对多投放关系,并在三处界面显性呈现:素材卡片、广告系列行、决策卡片。

## 方案

### 1. 数据层(迁移)

新增关联表 `creative_placements`:
- `creative_id` → 素材,`campaign_id` → 广告系列,`status`(ACTIVE / PAUSED / ENDED),`share`(该素材在此系列的流量占比),`started_at`。
- 主键 (creative_id, campaign_id),按规范补齐 GRANT + RLS(仅 service_role,与现有表一致)。
- 同一迁移内写入种子数据:把现有 4 个素材分配到对应渠道的广告系列上(Meta 素材归 Meta 系列,Google 素材归 Google 系列),保证首屏就有关联可看。

`creative_variants` 复用父素材的投放关系,不额外建表。

### 2. 服务层

- `getSnapshot()` 增补 `placements` 数组,类型加进 `AgentSnapshot`。
- 修正创意侧决策写入:`campaign_id/campaign_name` 改为写素材所属的真实广告系列(取第一个 ACTIVE 投放);素材本身通过新增的 `creative_id / creative_name` 字段记录(需在 `agent_decisions` 增两列,可空)。
- 疲劳扫描与实验结算时,把受影响的广告系列一并列入 reasoning chain,例如"该素材承担 Meta Reels 系列 62% 展现"。

### 3. 界面

- **素材中心 · 素材库**:每张素材卡下方增加"投放于"标签行,列出所属广告系列(渠道徽章 + 系列名 + 占比),点击跳转 `/campaigns` 并高亮该行。
- **广告系列页**:每行展开区新增"在投素材"缩略列表,显示素材标题 + 疲劳等级徽章;若含 FATIGUED 素材,行首出现橙色预警点。
- **决策卡片**:同时展示广告系列与关联素材两行,消除当前"系列名其实是素材名"的误导。
- **A/B 实验看板**:实验头部标注实验所影响的广告系列。

### 4. 验证

- psql 校验关联表与种子行数;
- Playwright 走查 `/creative`(素材卡显示所属系列)、`/campaigns`(展开显示在投素材与疲劳预警)、`/`(决策卡两行分开显示)。

## 备注

`agent_decisions` 现有历史行的 `campaign_id` 存的是素材 ID,迁移中一并回填:能匹配到素材的行,把值搬到新的 `creative_id` 列,`campaign_id` 改为其所属系列。

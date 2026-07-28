## 结论：同意，现在就把「广告组」层级加上

理由：当前 `campaigns` 表的每一行其实同时带着 `channel` + `placement` + 预算 + 出价，语义上就是广告组，但名字叫广告系列 —— 这正是歧义来源。未来接真实 Google/Meta API 时，平台回传的是 campaign_id 与 ad_group_id 两层，现在不加，届时要动 `leads` / 视图 / 决策日志全链路。趁 MVP 数据量小，一次性把三层理顺成本最低。

## 目标层级

```text
广告系列 campaigns        目标 + 渠道 + 总预算（如「Google 消费贷-获客」）
  └ 广告组 ad_groups      版位 + 受众 + 日预算 + 出价（如「Search 品牌词」「PMax 泛人群」）
      └ 素材 creative_assets  通过 creative_placements 挂到广告组
```

## 数据库改动（一次迁移）

1. 新建 `ad_groups`：`id`、`campaign_id`（外键）、`name`、`placement`、`audience`、`status`、`daily_budget`、`bid_strategy`、`sort_order`、时间戳。仅 `service_role` 可访问，与现有表策略一致。
2. 把现有 `campaigns` 的每一行**下沉**为一条 `ad_groups` 记录（沿用原 id 便于兼容），再按 `channel` + 投放目标聚合出 4 条以内的新 `campaigns` 父记录；`campaigns` 保留 `channel`、`status`、`daily_budget`（父级总预算），`placement` 字段迁走。
3. `creative_placements` 增加 `ad_group_id`，`leads` 增加 `ad_group_id`，按现有 `campaign_id` 回填。两个字段都保留 `campaign_id` 作冗余，避免归因链每次都要多跳一次连表。
4. 视图升级：新增 `v_adgroup_facts`（线索/通过/放款/CPL/CPS，口径与现有一致），`v_campaign_facts` 改为对广告组事实做上卷汇总；`v_placement_facts` 的主键从 creative×campaign 改为 creative×ad_group。
5. `agent_decisions` 增加 `ad_group_id` 与 `ad_group_name`，让决策卡能精确指到执行单元。

## 服务端改动

- `agent.server.ts`：快照增加 `adGroups` 数组与广告组事实；预算转移、暂停、AI 建议应用等动作的目标从 campaign 改为 ad group，campaign 层只做汇总展示与总预算约束。
- `conversions.server.ts`：线索生成与素材加权归因按 `ad_group_id` 取 `creative_placements` 池，写入 `leads` 时带上 ad_group_id。
- `creative.server.ts`：疲劳扫描、变体实验、胜出上线产生的决策带上广告组归属。
- `/api/public/leads`：接受可选 `ad_group_id`，缺省时按 campaign 下权重最高的在投广告组落位。
- 类型层：`types.ts` 新增 `AdGroup`，`Campaign` 去掉 `placement` 并增加 `adGroupIds`，`CreativePlacement` 增加广告组字段。

## 前端改动

- **广告系列页**：改为两级表格 —— 广告系列汇总行（总预算、已花费、汇总 CPS）可展开出广告组子行（版位、受众、日预算、CPL、后端授信通过率、CPS、在投素材）。预算编辑、暂停/启用、应用 AI 建议都下沉到广告组行。
- **素材中心**：「投放于」标签从「广告系列名」改为「广告系列 · 广告组」，后端表现按广告组拆分。
- **决策卡**：展示「广告系列 → 广告组 → 素材」完整路径。
- **全链路归因**：渠道下钻多一层广告组，再到素材。
- **落地页 `/lp`**：链接参数带上广告组，方便演示归因。

## 文档改动

重新生成 `CreditAgent_AI_架构设计文档.pdf`：更新 ER 图与三条数据流向图为三层结构，新增 `ad_groups` 表的字段说明，并补一节「广告层级与平台对照」，说明本系统层级如何对应 Google/Meta 的 campaign / ad group / ad。

## 实施顺序

1. 数据库迁移（建表 + 数据下沉 + 回填 + 视图重建）
2. 类型与服务端逻辑
3. 前端三个页面的层级展示与操作下沉
4. 端到端验证：落地页投线索 → 广告组事实 → 决策执行 → 回传
5. 重生成架构 PDF 并逐页视觉 QA

## 技术备注

迁移采用「保 id 下沉」策略：老 campaign id 直接成为 ad group id，所有历史 `leads` / `creative_placements` / `agent_decisions` 的引用无需改写，只需补 `ad_group_id` 冗余列，避免历史事实数据错位。视图口径公式（CPL = 花费/线索，CPS = 花费/放款笔数）保持不变，只改分组维度。

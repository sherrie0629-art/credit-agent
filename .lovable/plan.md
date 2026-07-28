## 已核查的现状

用 psql 直接查了库，除了已修复的「素材↔广告系列」，还存在 4 处断链：

**1. 线索(leads)只到广告系列，没到素材**
`leads` 表只有 `campaign_id`，没有 `creative_id`。所以：
- 无法算「单条素材的真实 CPS / 授信通过率」，素材好坏只能看前端 CTR。
- 疲劳引擎读的 `creative_metrics`（impressions/clicks/cpl/cps）是独立造的数，跟 `leads`/`lead_events` 里 448 条真实事件毫无关系——两套数字各说各话。
- 离线回传的转化也回不到素材维度。

**2. campaigns 上的汇总数字是写死的，跟事实表对不上**

| 广告系列 | campaigns.leads | leads 表实际条数 |
|---|---|---|
| cmp_g_pmax_02 | 498 | 65 |
| cmp_m_reels_04 | 388 | 43 |
| cmp_m_feed_03 | 1042 | 87 |
| cmp_g_search_01 | 612 | 67 |

`approved_loans`(合计 469) 与 `lead_events` 里 `CREDIT_APPROVED`(104) 也对不上；`disbursed_amount` 合计 251.5 万，而 `lead_events` 放款金额合计仅 1.4 万。同一个数在两个页面会显示两个值。

**3. 漏斗与渠道拆分表是孤立的静态表**
- `funnel_stages`（Form Leads 2540 / Credit Approved 469 / Loan Disbursed 312）不是从 `leads`+`lead_events` 汇总来的。
- `channel_breakdown` 用的是 `"Google Search"` 这类字符串，没有 `campaign_id` 外键，无法下钻到系列或素材。
- `channel_trend` 同理，按 Google/Meta 两个字符串写死。

**4. 离线回传结果没有回流到决策**
`conversion_uploads` 的成功率、匹配质量、归因缺口，目前只在 `/conversions` 页面展示，不进入 `agent_decisions` 的推理链——Agent 做预算决策时看不到「这个渠道的回传成功率只有 60%，CPS 被高估了」。

## 目标

让所有指标只有一个事实来源：`leads` + `lead_events` + `creative_placements`，其余表要么补外键，要么改为派生视图。

## 方案

### 第 1 步：数据层补关联（迁移）

- `leads` 增加 `creative_id`（可空，外键概念上指向 `creative_assets`）与索引；回填：按每条线索所属系列的 `creative_placements`，用 `share` 作权重随机分配到具体素材。
- `channel_breakdown` 增加 `campaign_id`，回填现有 4 行到对应系列（Google Search→cmp_g_search_01 等）。
- `creative_metrics` 增加 `campaign_id`，按主投放回填，使素材日指标可归到系列。

### 第 2 步：指标改为派生

新增数据库视图（或 server 端聚合函数，二选一，倾向视图便于复用）：
- `v_campaign_facts`：按 campaign 汇总 leads 数、CREDIT_APPROVED 数、LOAN_DISBURSED 金额与笔数、近 20 条线索通过率。
- `v_creative_facts`：按 creative 汇总同样口径，让素材第一次有真实后端 CPS。
- `v_funnel`：Impressions/Clicks 仍取 campaigns 的投放侧数据，Leads/Approved/Disbursed 改为从事实表实时汇总。

`campaigns` 表保留 `daily_budget`、`status` 等配置字段；`leads/approved_loans/disbursed_amount/cpl/cps/last20_approval_rate` 由 `agent.server.ts` 的 `getSnapshot()` 用视图覆盖后再返回，避免两套数字。

### 第 3 步：服务层串联

- `getSnapshot()`：campaign 与 creative 的绩效字段改读视图；`funnel`、`channelBreakdown` 同样改为派生。
- 疲劳引擎 `computeFatigue` 的 CPL/CPS 输入改用 `v_creative_facts` 的真实值，前端 CTR 仍用 `creative_metrics`。
- 预算决策（`applyAiSuggestion`、风控优先自动暂停）的推理链中追加一行回传健康度：「该渠道离线回传成功率 X%，平台侧 CPS 可能被高估 Y%」，数据取自 `conversion_uploads`。
- 新线索写入（`/api/public/leads`）时按 placement 权重带上 `creative_id`。

### 第 4 步：界面呈现

- **素材中心**：素材卡新增「后端表现」一行——真实线索数 / 授信通过率 / CPS，与现有疲劳分并列。
- **全链路归因**：漏斗与渠道拆分支持按素材下钻；渠道卡片可点进对应广告系列。
- **广告系列页**：展开区的在投素材补上各自贡献的线索与放款笔数。
- **离线回传页**：回传健康度补一句对决策的影响说明，并在决策卡里可见。

### 第 5 步：验证

- psql 交叉校验：`campaigns` 派生值 = `leads`/`lead_events` 直查值；`funnel` 各层单调递减。
- Playwright 走查 `/`、`/campaigns`、`/creative`、`/analytics`、`/conversions`，确认同一指标在各页数值一致。

## 技术备注

`leads` 表已有 448 条 `lead_events`，回填 `creative_id` 只影响归因维度，不改动既有事件。视图与新列都在 `service_role` 权限内，沿用现有 RLS 策略，不新增对外读权限。

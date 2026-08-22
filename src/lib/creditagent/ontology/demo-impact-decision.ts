// 指挥中心预览用：带 ontology_diff 的决策卡样例。
// 不落库；仅在开发环境注入，方便对照「影响面」产品界面。
import type { AgentDecision } from "../types";
import { change, type OntologySnapshot } from "./decision-diff";

export const DEMO_ONTOLOGY_IMPACT_ID = "dec_preview_ontology_impact";

const ontologyBefore: OntologySnapshot = {
  root: { type: "AdGroup", id: "cmp_g_pmax_02" },
  truncated: true,
  capturedAt: new Date().toISOString(),
  nodes: [
    {
      type: "AdGroup",
      id: "cmp_g_pmax_02",
      props: { name: "PMax — 债务整合泛人群", status: "ACTIVE", daily_budget: 1800, bid_target: 42 },
    },
    {
      type: "AdGroup",
      id: "cmp_g_search_01",
      props: { name: "Search — 品牌 + 精确匹配词", status: "ACTIVE", daily_budget: 2400, bid_target: 38 },
    },
    {
      type: "Campaign",
      id: "cmp_google_acq",
      props: { name: "Google — 美国消费信贷获客", status: "ACTIVE", daily_budget: 4200 },
    },
    {
      type: "CreativePlacement",
      id: "crt_island|cmp_g_pmax_02",
      props: { status: "ACTIVE", share: 0.4 },
    },
    {
      type: "BudgetPoolEntry",
      id: "pool_218",
      props: { amount: 600, status: "APPLIED", reason: "RISK_PAUSE" },
    },
  ],
  edges: [
    { link: "belongs_to", fromType: "AdGroup", fromId: "cmp_g_pmax_02", toType: "Campaign", toId: "cmp_google_acq" },
    { link: "belongs_to", fromType: "AdGroup", fromId: "cmp_g_search_01", toType: "Campaign", toId: "cmp_google_acq" },
    { link: "runs_in", fromType: "CreativePlacement", fromId: "crt_island|cmp_g_pmax_02", toType: "AdGroup", toId: "cmp_g_pmax_02" },
  ],
};

/** 跨广告组预算再分配：多实体、多字段，覆盖影响面折叠条 + 截断提示。 */
export const DEMO_ONTOLOGY_IMPACT_DECISION: AgentDecision = {
  id: DEMO_ONTOLOGY_IMPACT_ID,
  timestamp: new Date().toISOString(),
  agentType: "Planner",
  actionType: "BUDGET_SHIFT",
  targetChannel: "Google",
  campaignId: "cmp_google_acq",
  campaignName: "Google — 美国消费信贷获客",
  adGroupId: "cmp_g_pmax_02",
  adGroupName: "PMax — 债务整合泛人群",
  confidenceScore: 0.87,
  triggerSource: "SWEEP",
  status: "PENDING_APPROVAL",
  effect: "跨广告组预算再分配：$600 从 Search 转入 PMax，并上调 PMax 出价目标",
  rollbackTo: "PMax $1,800 / Search $2,400 / tCPA $42",
  dataMetricsTrigger: {
    metric: "CostPerDisbursement",
    currentValue: 14.2,
    thresholdValue: 19,
  },
  reasoningChain: [
    "定时巡检扫描 Google 获客系列下各广告组近窗 CPS。",
    "PMax — 债务整合泛人群 CPS $14.20，低于账户目标 $19.00，具备放量空间。",
    "Search — 品牌 + 精确匹配词 CPS 偏高，建议回收 $600 日预算转入 PMax。",
    "风控规则层：单次预算变动 25%，未超过单次幅度与绝对上限。",
    "托管模式 = Semi-Auto：整张转移方案待人工确认。",
  ],
  ontologyDiff: [
    change({
      type: "AdGroup",
      id: "cmp_g_pmax_02",
      name: "PMax — 债务整合泛人群",
      field: "daily_budget",
      from: 1800,
      to: 2400,
    }),
    change({
      type: "AdGroup",
      id: "cmp_g_pmax_02",
      name: "PMax — 债务整合泛人群",
      field: "bid_target",
      from: 42,
      to: 48,
    }),
    change({
      type: "AdGroup",
      id: "cmp_g_search_01",
      name: "Search — 品牌 + 精确匹配词",
      field: "daily_budget",
      from: 2400,
      to: 1800,
    }),
    change({
      type: "CreativePlacement",
      id: "crt_island|cmp_g_pmax_02",
      name: "Island AI × PMax",
      field: "share",
      from: 0.4,
      to: 0.55,
    }),
    change({
      type: "BudgetPoolEntry",
      id: "pool_218",
      name: "Search 暂停释放",
      field: "amount",
      fieldLabel: "资金来源（已释放）",
      from: 600,
      to: 0,
    }),
  ],
  ontologyBefore,
};

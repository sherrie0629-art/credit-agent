// 本体注册表 · Object Types
//
// 把散落在 types.ts / SQL 视图里的隐式模型收敛成一份显式定义。
// 这里只描述「实体是什么」，不含任何 IO —— 纯数据，可被服务端与客户端同时引用。

export type ObjectTypeId =
  | "Campaign"
  | "AdGroup"
  | "CreativeAsset"
  | "CreativeVariant"
  | "CreativeExperiment"
  | "CreativePlacement"
  | "AudienceSegment"
  | "Lead"
  | "LeadEvent"
  | "AgentDecision"
  | "BudgetPoolEntry"
  | "GuardrailEvent";

export interface ObjectTypeDef {
  id: ObjectTypeId;
  /** 中文展示名，用于 UI 与 LLM 上下文。 */
  label: string;
  /** Postgres 表名。 */
  table: string;
  /** 主键列；复合主键时给出全部列。 */
  idColumns: string[];
  /** 参与推理与展示的关键属性列（子图序列化只取这些，控制 token）。 */
  keyColumns: string[];
  /**
   * 平台镜像实体：带 origin 列，google_sync / meta_sync 行为平台真相，
   * 本地只读，禁止结构性改写。
   */
  platformMirrored: boolean;
  /** Agent 允许自动写入的列白名单（空数组 = 只读实体）。 */
  agentWritableColumns: string[];
}

function def(d: ObjectTypeDef): ObjectTypeDef {
  return d;
}

export const OBJECT_TYPES: Record<ObjectTypeId, ObjectTypeDef> = {
  Campaign: def({
    id: "Campaign",
    label: "广告系列",
    table: "campaigns",
    idColumns: ["id"],
    keyColumns: [
      "id",
      "name",
      "channel",
      "placement",
      "status",
      "daily_budget",
      "spent_today",
      "cps",
      "last20_approval_rate",
      "origin",
      "platform_removed",
    ],
    platformMirrored: true,
    agentWritableColumns: ["status", "daily_budget"],
  }),
  AdGroup: def({
    id: "AdGroup",
    label: "广告组",
    table: "ad_groups",
    idColumns: ["id"],
    keyColumns: [
      "id",
      "campaign_id",
      "name",
      "channel",
      "placement",
      "audience",
      "bid_strategy",
      "bid_target",
      "status",
      "daily_budget",
      "spent_today",
      "origin",
      "platform_removed",
    ],
    platformMirrored: true,
    agentWritableColumns: ["status", "daily_budget", "bid_target"],
  }),
  CreativeAsset: def({
    id: "CreativeAsset",
    label: "素材",
    table: "creative_assets",
    idColumns: ["id"],
    keyColumns: [
      "id",
      "headline",
      "max_apr",
      "compliance_status",
      "fatigue_score",
      "fatigue_level",
      "origin",
      "platform_removed",
    ],
    platformMirrored: true,
    agentWritableColumns: ["fatigue_score", "fatigue_level", "last_scanned_at"],
  }),
  CreativeVariant: def({
    id: "CreativeVariant",
    label: "素材变体",
    table: "creative_variants",
    idColumns: ["id"],
    keyColumns: [
      "id",
      "parent_creative_id",
      "experiment_id",
      "headline",
      "angle",
      "compliance_status",
      "compliance_score",
      "status",
    ],
    platformMirrored: false,
    agentWritableColumns: ["status"],
  }),
  CreativeExperiment: def({
    id: "CreativeExperiment",
    label: "素材实验",
    table: "creative_experiments",
    idColumns: ["id"],
    keyColumns: ["id", "parent_creative_id", "status", "started_at", "winner_variant_id"],
    platformMirrored: false,
    agentWritableColumns: ["status", "winner_variant_id", "decided_at", "arm_stats"],
  }),
  CreativePlacement: def({
    id: "CreativePlacement",
    label: "素材投放关系",
    table: "creative_placements",
    idColumns: ["creative_id", "ad_group_id"],
    keyColumns: ["creative_id", "ad_group_id", "campaign_id", "status", "share", "started_at"],
    platformMirrored: false,
    agentWritableColumns: ["status", "share"],
  }),
  AudienceSegment: def({
    id: "AudienceSegment",
    label: "受众段",
    table: "audience_segments",
    idColumns: ["id"],
    keyColumns: [
      "id",
      "channel",
      "name",
      "platform_resource_name",
      "origin",
      "synced_at",
      "platform_removed",
    ],
    // 圈选真相源在 Google / Meta 后台：只拉不推、UI 只读。
    platformMirrored: true,
    agentWritableColumns: [],
  }),
  Lead: def({
    id: "Lead",
    label: "线索",
    table: "leads",
    idColumns: ["id"],
    keyColumns: ["id", "channel", "campaign_id", "ad_group_id", "creative_id", "click_at"],
    platformMirrored: false,
    agentWritableColumns: [],
  }),
  LeadEvent: def({
    id: "LeadEvent",
    label: "线索事件",
    table: "lead_events",
    idColumns: ["id"],
    keyColumns: ["id", "lead_id", "event_type", "value", "currency", "occurred_at"],
    platformMirrored: false,
    agentWritableColumns: [],
  }),
  AgentDecision: def({
    id: "AgentDecision",
    label: "Agent 决策",
    table: "agent_decisions",
    idColumns: ["id"],
    keyColumns: [
      "id",
      "timestamp",
      "action_type",
      "status",
      "trigger_source",
      "confidence_score",
      "campaign_id",
      "ad_group_id",
      "creative_id",
      "effect",
      "guardrail_note",
    ],
    platformMirrored: false,
    agentWritableColumns: ["status", "guardrail_note", "external_mutate_status"],
  }),
  BudgetPoolEntry: def({
    id: "BudgetPoolEntry",
    label: "预算池流水",
    table: "budget_pool_entries",
    idColumns: ["id"],
    keyColumns: [
      "id",
      "direction",
      "ad_group_id",
      "campaign_id",
      "amount",
      "reason",
      "decision_id",
      "status",
      "pool_day",
    ],
    platformMirrored: false,
    agentWritableColumns: ["status", "note"],
  }),
  GuardrailEvent: def({
    id: "GuardrailEvent",
    label: "护栏事件",
    table: "guardrail_events",
    idColumns: ["id"],
    keyColumns: ["id", "created_at", "action", "target_id", "rule", "verdict", "detail"],
    platformMirrored: false,
    agentWritableColumns: [],
  }),
};

export function objectType(id: ObjectTypeId): ObjectTypeDef {
  return OBJECT_TYPES[id];
}

export const OBJECT_TYPE_IDS = Object.keys(OBJECT_TYPES) as ObjectTypeId[];

/** 平台镜像实体禁止 Agent 做结构性改写，只能改预算 / 启停等运营字段。 */
export function isAgentWritable(type: ObjectTypeId, column: string): boolean {
  return OBJECT_TYPES[type].agentWritableColumns.includes(column);
}

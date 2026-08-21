// 本体注册表 · Link Types
//
// 每条边显式声明两端类型、基数与外键列，子图查询层据此遍历，
// 避免在业务代码里到处硬编码 join 关系。

import type { ObjectTypeId } from "./objects";

export type LinkTypeId =
  | "campaign_contains_ad_group"
  | "ad_group_delivers_creative"
  | "ad_group_targets_audience"
  | "creative_has_variant"
  | "experiment_arms_variant"
  | "lead_attributed_to_ad_group"
  | "lead_attributed_to_creative"
  | "lead_has_event"
  | "decision_acts_on_ad_group"
  | "decision_acts_on_campaign"
  | "decision_acts_on_creative"
  | "decision_produces_budget_entry"
  | "budget_entry_moves_ad_group"
  | "guardrail_blocks_decision";

export type Cardinality = "one-to-many" | "many-to-one" | "many-to-many";

export interface LinkTypeDef {
  id: LinkTypeId;
  label: string;
  from: ObjectTypeId;
  to: ObjectTypeId;
  cardinality: Cardinality;
  /** to 侧指回 from 侧的外键列（在 to 表上）。 */
  foreignKeyOnTo: string;
  /** from 侧被引用的列，默认主键。 */
  referencesOnFrom: string;
  /** 通过中间表实现的关系。 */
  through?: { table: string; fromColumn: string; toColumn: string };
}

function link(d: LinkTypeDef): LinkTypeDef {
  return d;
}

export const LINK_TYPES: Record<LinkTypeId, LinkTypeDef> = {
  campaign_contains_ad_group: link({
    id: "campaign_contains_ad_group",
    label: "系列包含广告组",
    from: "Campaign",
    to: "AdGroup",
    cardinality: "one-to-many",
    foreignKeyOnTo: "campaign_id",
    referencesOnFrom: "id",
  }),
  ad_group_delivers_creative: link({
    id: "ad_group_delivers_creative",
    label: "广告组投放素材",
    from: "AdGroup",
    to: "CreativeAsset",
    cardinality: "many-to-many",
    foreignKeyOnTo: "id",
    referencesOnFrom: "id",
    through: { table: "creative_placements", fromColumn: "ad_group_id", toColumn: "creative_id" },
  }),
  ad_group_targets_audience: link({
    id: "ad_group_targets_audience",
    label: "广告组定向受众段",
    from: "AudienceSegment",
    to: "AdGroup",
    cardinality: "one-to-many",
    foreignKeyOnTo: "audience_segment_id",
    referencesOnFrom: "id",
  }),
  creative_has_variant: link({
    id: "creative_has_variant",
    label: "素材的变体",
    from: "CreativeAsset",
    to: "CreativeVariant",
    cardinality: "one-to-many",
    foreignKeyOnTo: "parent_creative_id",
    referencesOnFrom: "id",
  }),
  experiment_arms_variant: link({
    id: "experiment_arms_variant",
    label: "实验的对照臂",
    from: "CreativeExperiment",
    to: "CreativeVariant",
    cardinality: "one-to-many",
    foreignKeyOnTo: "experiment_id",
    referencesOnFrom: "id",
  }),
  lead_attributed_to_ad_group: link({
    id: "lead_attributed_to_ad_group",
    label: "线索归因至广告组",
    from: "AdGroup",
    to: "Lead",
    cardinality: "one-to-many",
    foreignKeyOnTo: "ad_group_id",
    referencesOnFrom: "id",
  }),
  lead_attributed_to_creative: link({
    id: "lead_attributed_to_creative",
    label: "线索归因至素材",
    from: "CreativeAsset",
    to: "Lead",
    cardinality: "one-to-many",
    foreignKeyOnTo: "creative_id",
    referencesOnFrom: "id",
  }),
  lead_has_event: link({
    id: "lead_has_event",
    label: "线索的后端事件",
    from: "Lead",
    to: "LeadEvent",
    cardinality: "one-to-many",
    foreignKeyOnTo: "lead_id",
    referencesOnFrom: "id",
  }),
  decision_acts_on_ad_group: link({
    id: "decision_acts_on_ad_group",
    label: "决策作用于广告组",
    from: "AdGroup",
    to: "AgentDecision",
    cardinality: "one-to-many",
    foreignKeyOnTo: "ad_group_id",
    referencesOnFrom: "id",
  }),
  decision_acts_on_campaign: link({
    id: "decision_acts_on_campaign",
    label: "决策作用于系列",
    from: "Campaign",
    to: "AgentDecision",
    cardinality: "one-to-many",
    foreignKeyOnTo: "campaign_id",
    referencesOnFrom: "id",
  }),
  decision_acts_on_creative: link({
    id: "decision_acts_on_creative",
    label: "决策作用于素材",
    from: "CreativeAsset",
    to: "AgentDecision",
    cardinality: "one-to-many",
    foreignKeyOnTo: "creative_id",
    referencesOnFrom: "id",
  }),
  decision_produces_budget_entry: link({
    id: "decision_produces_budget_entry",
    label: "决策产生资金流水",
    from: "AgentDecision",
    to: "BudgetPoolEntry",
    cardinality: "one-to-many",
    foreignKeyOnTo: "decision_id",
    referencesOnFrom: "id",
  }),
  budget_entry_moves_ad_group: link({
    id: "budget_entry_moves_ad_group",
    label: "资金流水对应广告组",
    from: "AdGroup",
    to: "BudgetPoolEntry",
    cardinality: "one-to-many",
    foreignKeyOnTo: "ad_group_id",
    referencesOnFrom: "id",
  }),
  guardrail_blocks_decision: link({
    id: "guardrail_blocks_decision",
    label: "护栏拦截决策",
    from: "AgentDecision",
    to: "GuardrailEvent",
    cardinality: "one-to-many",
    foreignKeyOnTo: "target_id",
    referencesOnFrom: "id",
  }),
};

export const LINK_TYPE_LIST = Object.values(LINK_TYPES);

/** 以某类型为起点可走的边。 */
export function outgoingLinks(type: ObjectTypeId): LinkTypeDef[] {
  return LINK_TYPE_LIST.filter((l) => l.from === type);
}

/** 以某类型为终点的边（用于反向回溯，如从 AdGroup 找父 Campaign）。 */
export function incomingLinks(type: ObjectTypeId): LinkTypeDef[] {
  return LINK_TYPE_LIST.filter((l) => l.to === type);
}

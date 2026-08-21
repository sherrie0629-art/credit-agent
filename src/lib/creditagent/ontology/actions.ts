// 本体注册表 · Action Types
//
// 每个动作声明：输入 schema、作用对象类型、前置条件、产生的副作用实体。
// guardrails 与 advisor 都引用这里，避免出现「第二套动作定义」。

import { z } from "zod";
import type { ObjectTypeId } from "./objects";

export type ActionTypeId =
  | "BUDGET_SHIFT"
  | "BID_ADJUST"
  | "CREATIVE_PAUSE"
  | "CREATIVE_REFRESH"
  | "VARIANT_PROMOTE"
  | "COMPLIANCE_REJECT";

/** 前置条件标识，实现在 ./invariants.ts。 */
export type PreconditionId =
  | "TARGET_EXISTS"
  | "MIRROR_WRITE_SCOPE"
  | "PARENT_STATUS_CONSISTENT"
  | "COMPLIANCE_NOT_FAILED"
  | "BID_STRATEGY_ACCEPTS_TARGET"
  | "BUDGET_POOL_CONSERVED"
  | "EXPERIMENT_DECIDABLE";

export interface ActionTypeDef {
  id: ActionTypeId;
  label: string;
  /** 动作作用的实体类型。 */
  actsOn: ObjectTypeId;
  /** 会被修改的列（必须在该实体的 agentWritableColumns 内）。 */
  mutatesColumns: string[];
  /** 副作用实体。 */
  produces: ObjectTypeId[];
  preconditions: PreconditionId[];
  schema: z.ZodTypeAny;
}

const budgetShiftSchema = z.object({
  fromAdGroupId: z.string().optional(),
  toAdGroupId: z.string(),
  amount: z.number().positive(),
  nextDailyBudget: z.number().positive(),
});

const bidAdjustSchema = z.object({
  adGroupId: z.string(),
  nextBidTarget: z.number().positive(),
});

const creativePauseSchema = z.object({
  creativeId: z.string(),
  adGroupId: z.string().optional(),
});

const creativeRefreshSchema = z.object({
  creativeId: z.string(),
});

const variantPromoteSchema = z.object({
  experimentId: z.string(),
  winnerVariantId: z.string(),
});

const complianceRejectSchema = z.object({
  creativeId: z.string(),
  reason: z.string(),
});

export const ACTION_TYPES: Record<ActionTypeId, ActionTypeDef> = {
  BUDGET_SHIFT: {
    id: "BUDGET_SHIFT",
    label: "预算调整 / 再分配",
    actsOn: "AdGroup",
    mutatesColumns: ["daily_budget"],
    produces: ["BudgetPoolEntry", "AgentDecision"],
    preconditions: [
      "TARGET_EXISTS",
      "MIRROR_WRITE_SCOPE",
      "PARENT_STATUS_CONSISTENT",
      "BUDGET_POOL_CONSERVED",
    ],
    schema: budgetShiftSchema,
  },
  BID_ADJUST: {
    id: "BID_ADJUST",
    label: "出价调整",
    actsOn: "AdGroup",
    mutatesColumns: ["bid_target"],
    produces: ["AgentDecision"],
    preconditions: ["TARGET_EXISTS", "MIRROR_WRITE_SCOPE", "BID_STRATEGY_ACCEPTS_TARGET"],
    schema: bidAdjustSchema,
  },
  CREATIVE_PAUSE: {
    id: "CREATIVE_PAUSE",
    label: "素材暂停",
    actsOn: "CreativePlacement",
    mutatesColumns: ["status"],
    produces: ["AgentDecision"],
    preconditions: ["TARGET_EXISTS"],
    schema: creativePauseSchema,
  },
  CREATIVE_REFRESH: {
    id: "CREATIVE_REFRESH",
    label: "素材换新",
    actsOn: "CreativeAsset",
    mutatesColumns: ["fatigue_score", "fatigue_level"],
    produces: ["CreativeVariant", "AgentDecision"],
    preconditions: ["TARGET_EXISTS", "COMPLIANCE_NOT_FAILED"],
    schema: creativeRefreshSchema,
  },
  VARIANT_PROMOTE: {
    id: "VARIANT_PROMOTE",
    label: "变体晋级",
    actsOn: "CreativeExperiment",
    mutatesColumns: ["status", "winner_variant_id"],
    produces: ["AgentDecision"],
    preconditions: ["TARGET_EXISTS", "EXPERIMENT_DECIDABLE", "COMPLIANCE_NOT_FAILED"],
    schema: variantPromoteSchema,
  },
  COMPLIANCE_REJECT: {
    id: "COMPLIANCE_REJECT",
    label: "合规驳回",
    actsOn: "CreativeAsset",
    mutatesColumns: [],
    produces: ["AgentDecision"],
    preconditions: ["TARGET_EXISTS"],
    schema: complianceRejectSchema,
  },
};

export const ACTION_TYPE_IDS = Object.keys(ACTION_TYPES) as ActionTypeId[];

export function actionType(id: string): ActionTypeDef | undefined {
  return ACTION_TYPES[id as ActionTypeId];
}

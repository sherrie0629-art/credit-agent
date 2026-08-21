// 本体不变量：结构性护栏。
//
// 与 guardrails.ts 的区别：guardrails 管「幅度是否越界」（预算 ±%、频次、kill switch），
// invariants 管「这个动作在业务图谱上是否说得通」（对象是否存在、父级是否已暂停、
// 平台镜像字段是否被越权改写、资金是否守恒）。两者都是确定性 TS 逻辑，不依赖 LLM。

import { OBJECT_TYPES, isAgentWritable } from "./objects";
import { ACTION_TYPES, type ActionTypeId, type PreconditionId } from "./actions";

export interface InvariantContext {
  /** 目标实体当前行（来自子图或直查）。 */
  target?: Record<string, unknown> | null;
  /** 目标广告组的父系列行。 */
  parentCampaign?: Record<string, unknown> | null;
  /** BUDGET_SHIFT 的出资方广告组。 */
  sourceAdGroup?: Record<string, unknown> | null;
  /** 实验的臂统计。 */
  experiment?: Record<string, unknown> | null;
}

export interface InvariantViolation {
  precondition: PreconditionId;
  rule: string;
  detail: string;
}

export interface InvariantResult {
  ok: boolean;
  violations: InvariantViolation[];
  checked: PreconditionId[];
}

type Params = Record<string, unknown>;

const CHECKS: Record<
  PreconditionId,
  (a: { actionType: ActionTypeId; params: Params; ctx: InvariantContext }) => InvariantViolation | null
> = {
  TARGET_EXISTS: ({ ctx }) =>
    ctx.target
      ? null
      : {
          precondition: "TARGET_EXISTS",
          rule: "目标实体必须存在",
          detail: "在业务图谱中找不到该动作的目标对象，可能已被平台侧删除或 ID 映射失效。",
        },

  MIRROR_WRITE_SCOPE: ({ actionType, ctx }) => {
    const def = ACTION_TYPES[actionType];
    const objDef = OBJECT_TYPES[def.actsOn];
    const bad = def.mutatesColumns.filter((c) => !isAgentWritable(def.actsOn, c));
    if (bad.length > 0) {
      return {
        precondition: "MIRROR_WRITE_SCOPE",
        rule: "只能改写白名单字段",
        detail: `${objDef.label} 不允许 Agent 写入：${bad.join(", ")}。`,
      };
    }
    if (objDef.platformMirrored && ctx.target?.["platform_removed"] === true) {
      return {
        precondition: "MIRROR_WRITE_SCOPE",
        rule: "平台侧已删除的对象不可改写",
        detail: `${objDef.label} 在广告平台已被删除（platform_removed=true），本地写入无意义。`,
      };
    }
    return null;
  },

  PARENT_STATUS_CONSISTENT: ({ ctx }) => {
    const parentStatus = String(ctx.parentCampaign?.["status"] ?? "").toUpperCase();
    if (parentStatus && parentStatus !== "ACTIVE" && parentStatus !== "运行中") {
      return {
        precondition: "PARENT_STATUS_CONSISTENT",
        rule: "父级系列须在投放中",
        detail: `父广告系列状态为 ${parentStatus}，向其下广告组加预算不会产生曝光。`,
      };
    }
    return null;
  },

  COMPLIANCE_NOT_FAILED: ({ ctx }) => {
    const s = String(ctx.target?.["compliance_status"] ?? "").toUpperCase();
    if (s === "FAIL" || s === "FAILED" || s === "REJECTED") {
      return {
        precondition: "COMPLIANCE_NOT_FAILED",
        rule: "合规未通过的素材不可上量",
        detail: `素材合规状态为 ${s}，须先整改后再执行。`,
      };
    }
    return null;
  },

  BID_STRATEGY_ACCEPTS_TARGET: ({ ctx }) => {
    const strategy = String(ctx.target?.["bid_strategy"] ?? "").toUpperCase();
    const manualLike = ["MANUAL_CPC", "MANUAL", "手动出价"];
    if (manualLike.some((m) => strategy.includes(m))) {
      return {
        precondition: "BID_STRATEGY_ACCEPTS_TARGET",
        rule: "出价目标须与出价策略匹配",
        detail: `广告组出价策略为 ${strategy}，不接受 target CPA/ROAS 类目标值。`,
      };
    }
    return null;
  },

  BUDGET_POOL_CONSERVED: ({ params, ctx }) => {
    const amount = Number(params["amount"] ?? 0);
    const fromId = params["fromAdGroupId"];
    if (!fromId) return null;
    const available = Number(ctx.sourceAdGroup?.["daily_budget"] ?? 0) -
      Number(ctx.sourceAdGroup?.["spent_today"] ?? 0);
    if (amount > available) {
      return {
        precondition: "BUDGET_POOL_CONSERVED",
        rule: "预算再分配须资金守恒",
        detail: `拟转出 ${amount.toFixed(2)}，但出资广告组今日仅剩 ${available.toFixed(2)} 可用。`,
      };
    }
    return null;
  },

  EXPERIMENT_DECIDABLE: ({ params, ctx }) => {
    const status = String(ctx.experiment?.["status"] ?? "").toUpperCase();
    if (status && status !== "RUNNING") {
      return {
        precondition: "EXPERIMENT_DECIDABLE",
        rule: "只有进行中的实验可以结算",
        detail: `实验状态为 ${status}，无法晋级变体。`,
      };
    }
    const arms = ctx.experiment?.["arm_stats"];
    const winner = params["winnerVariantId"];
    if (Array.isArray(arms) && winner) {
      const hit = arms.some((a: any) => a?.variant_id === winner || a?.variantId === winner);
      if (!hit) {
        return {
          precondition: "EXPERIMENT_DECIDABLE",
          rule: "获胜变体须属于该实验",
          detail: `变体 ${String(winner)} 不在实验的对照臂中。`,
        };
      }
    }
    return null;
  },
};

/** 校验动作参数是否符合 Action Type 的 schema。 */
export function validateActionParams(actionType: ActionTypeId, params: unknown) {
  const def = ACTION_TYPES[actionType];
  const parsed = def.schema.safeParse(params);
  return parsed.success
    ? { ok: true as const, data: parsed.data as Params }
    : { ok: false as const, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

/** 跑完该动作声明的全部前置条件，返回所有违反项（不短路，便于一次性展示）。 */
export function checkInvariants(
  actionType: ActionTypeId,
  params: Params,
  ctx: InvariantContext,
): InvariantResult {
  const def = ACTION_TYPES[actionType];
  const violations: InvariantViolation[] = [];
  for (const p of def.preconditions) {
    const v = CHECKS[p]({ actionType, params, ctx });
    if (v) violations.push(v);
  }
  return { ok: violations.length === 0, violations, checked: def.preconditions };
}

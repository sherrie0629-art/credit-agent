// 风控规则层（纯函数 · 零 LLM · 零网络）——所有会改变投放状态的写操作在落库前必须过这一关。
// 这些规则严格硬编码，不受大模型输出影响；模型只能生成文案，动不了预算与状态。

export type GuardrailVerdict = "ALLOW" | "CLAMP" | "DENY";

export interface GuardrailLimits {
  killSwitch: boolean;
  /** 单次预算变动幅度上限（百分比）。 */
  maxBudgetDeltaPct: number;
  /** 单日累计预算变动幅度上限（百分比）。 */
  maxDailyBudgetDeltaPct: number;
  /** 单广告组日预算绝对上限。 */
  maxAdGroupDailyBudget: number;
  /** 每小时允许的自动动作条数。 */
  maxActionsPerHour: number;
}

export const DEFAULT_LIMITS: GuardrailLimits = {
  killSwitch: false,
  maxBudgetDeltaPct: 30,
  maxDailyBudgetDeltaPct: 50,
  maxAdGroupDailyBudget: 20_000,
  maxActionsPerHour: 20,
};

export interface GuardrailDecision {
  verdict: GuardrailVerdict;
  rule: string;
  detail: string;
  /** 当 verdict 为 CLAMP 时，允许落库的修正值。 */
  value?: number;
}

export const ALLOW = (rule = "guardrails", detail = "未触发任何风控规则"): GuardrailDecision => ({
  verdict: "ALLOW",
  rule,
  detail,
});

/** 全局熔断：任何自动写入在熔断开启时一律拒绝。 */
export function checkKillSwitch(limits: GuardrailLimits, automated: boolean): GuardrailDecision {
  if (limits.killSwitch && automated) {
    return {
      verdict: "DENY",
      rule: "KILL_SWITCH",
      detail: "全局熔断已开启，所有自动写入被拒绝，仅保留人工操作。",
    };
  }
  return ALLOW("KILL_SWITCH", "熔断未开启。");
}

/** 每小时自动动作频次上限。 */
export function checkActionRate(
  limits: GuardrailLimits,
  actionsLastHour: number,
): GuardrailDecision {
  if (actionsLastHour >= limits.maxActionsPerHour) {
    return {
      verdict: "DENY",
      rule: "ACTION_RATE",
      detail: `近 1 小时已执行 ${actionsLastHour} 条自动动作，达到上限 ${limits.maxActionsPerHour} 条，后续动作转人工审批。`,
    };
  }
  return ALLOW("ACTION_RATE", `近 1 小时自动动作 ${actionsLastHour}/${limits.maxActionsPerHour}。`);
}

export interface BudgetChangeInput {
  current: number;
  next: number;
  /** 今日已累计的预算变动绝对值（相对今日起始预算）。 */
  changedTodayPct?: number;
}

/** 预算变动三重校验：单次幅度、单日累计幅度、绝对上限。 */
export function checkBudgetChange(
  limits: GuardrailLimits,
  input: BudgetChangeInput,
): GuardrailDecision {
  const { current, next } = input;

  if (!Number.isFinite(next) || next <= 0) {
    return { verdict: "DENY", rule: "BUDGET_VALUE", detail: "目标预算非法（必须为正数）。" };
  }

  if (next > limits.maxAdGroupDailyBudget) {
    return {
      verdict: "CLAMP",
      rule: "BUDGET_ABS_CAP",
      detail: `目标日预算 $${next} 超过广告组绝对上限 $${limits.maxAdGroupDailyBudget}，已截断至上限。`,
      value: limits.maxAdGroupDailyBudget,
    };
  }

  if (current > 0) {
    const deltaPct = Math.abs((next - current) / current) * 100;
    if (deltaPct > limits.maxBudgetDeltaPct) {
      return {
        verdict: "DENY",
        rule: "BUDGET_STEP",
        detail: `单次预算变动 ${deltaPct.toFixed(1)}% 超过上限 ${limits.maxBudgetDeltaPct}%（$${current} → $${next}），已拒绝并转人工审批。`,
      };
    }
    const cumulative = (input.changedTodayPct ?? 0) + deltaPct;
    if (cumulative > limits.maxDailyBudgetDeltaPct) {
      return {
        verdict: "DENY",
        rule: "BUDGET_DAILY_STEP",
        detail: `今日累计预算变动将达 ${cumulative.toFixed(1)}%，超过单日上限 ${limits.maxDailyBudgetDeltaPct}%，已拒绝。`,
      };
    }
  }

  return ALLOW("BUDGET", `预算变动 $${current} → $${next} 在允许区间内。`);
}

/** 消耗速度异常：远超日预算节奏时提前止损。 */
export function checkPacing(input: {
  spentToday: number;
  dailyBudget: number;
  hourOfDay: number;
}): GuardrailDecision {
  const { spentToday, dailyBudget, hourOfDay } = input;
  if (dailyBudget <= 0) return ALLOW("PACING", "无日预算，跳过节奏检查。");
  const expected = dailyBudget * Math.min(1, Math.max(hourOfDay, 1) / 24);
  const ratio = spentToday / Math.max(expected, 1);
  if (spentToday >= dailyBudget) {
    return {
      verdict: "DENY",
      rule: "PACING_EXHAUSTED",
      detail: `今日消耗 $${spentToday.toFixed(0)} 已达日预算 $${dailyBudget}，暂停继续投放。`,
    };
  }
  if (ratio >= 1.8) {
    return {
      verdict: "DENY",
      rule: "PACING_BURST",
      detail: `消耗速度为预期节奏的 ${ratio.toFixed(1)}×（$${spentToday.toFixed(0)} / 预期 $${expected.toFixed(0)}），判定为异常放量。`,
    };
  }
  return ALLOW("PACING", `消耗节奏正常（${ratio.toFixed(2)}× 预期）。`);
}

/** 素材上线前的合规复扫结论校验：只接受 PASSED / WARNING。 */
export function checkComplianceGate(status: string, score: number): GuardrailDecision {
  if (status === "FAILED") {
    return {
      verdict: "DENY",
      rule: "COMPLIANCE_GATE",
      detail: `上线前复扫结论 FAILED（${score}/100），拒绝上线。`,
    };
  }
  return ALLOW("COMPLIANCE_GATE", `上线前复扫通过（${status} · ${score}/100）。`);
}

// 风控规则层的服务端执行器：读取限额、统计频次、落库拦截日志。
// 规则本身在 ./guardrails 中，纯函数、可单测、与大模型完全隔离。
import {
  DEFAULT_LIMITS,
  checkActionRate,
  checkKillSwitch,
  type GuardrailDecision,
  type GuardrailLimits,
} from "./guardrails";

type Row = Record<string, any>;

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

export async function loadLimits(): Promise<GuardrailLimits> {
  const supabase = await db();
  const { data } = await supabase
    .from("agent_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  const s = (data ?? {}) as Row;
  return {
    killSwitch: s.kill_switch ?? DEFAULT_LIMITS.killSwitch,
    maxBudgetDeltaPct: Number(s.max_budget_delta_pct ?? DEFAULT_LIMITS.maxBudgetDeltaPct),
    maxDailyBudgetDeltaPct: Number(
      s.max_daily_budget_delta_pct ?? DEFAULT_LIMITS.maxDailyBudgetDeltaPct,
    ),
    maxAdGroupDailyBudget: Number(
      s.max_ad_group_daily_budget ?? DEFAULT_LIMITS.maxAdGroupDailyBudget,
    ),
    maxActionsPerHour: Number(s.max_actions_per_hour ?? DEFAULT_LIMITS.maxActionsPerHour),
  };
}

/** 近 1 小时内 Agent 自动执行（非人工审批）的动作条数。 */
export async function automatedActionsLastHour(): Promise<number> {
  const supabase = await db();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase
    .from("agent_decisions")
    .select("id", { count: "exact", head: true })
    .eq("status", "EXECUTED")
    .gte("timestamp", since);
  return count ?? 0;
}

export async function recordGuardrail(input: {
  action: string;
  targetId?: string;
  decision: GuardrailDecision;
  requested?: Record<string, unknown>;
}) {
  const supabase = await db();
  await supabase.from("guardrail_events").insert({
    action: input.action,
    target_id: input.targetId ?? "",
    rule: input.decision.rule,
    verdict: input.decision.verdict,
    detail: input.decision.detail,
    requested: input.requested ?? {},
  } as never);
}

/**
 * 人工操作审计留痕：只记录，不拦截。
 * 写入失败不抛出——审计不能把人工止血操作卡死。
 */
export async function recordManualAction(input: {
  action: string;
  targetId?: string;
  rule: string;
  detail: string;
  requested?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    await recordGuardrail({
      action: input.action,
      targetId: input.targetId,
      decision: { verdict: "ALLOW", rule: input.rule, detail: input.detail },
      requested: input.requested,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 全局前置闸门：熔断 + 频次。任何自动写入路径都先调用它。
 * automated=false 时表示人工操作，只受熔断之外的规则约束。
 */
export async function preflight(input: {
  action: string;
  targetId?: string;
  automated: boolean;
  limits?: GuardrailLimits;
}): Promise<{ ok: boolean; decision: GuardrailDecision; limits: GuardrailLimits }> {
  const limits = input.limits ?? (await loadLimits());

  const kill = checkKillSwitch(limits, input.automated);
  if (kill.verdict === "DENY") {
    await recordGuardrail({ action: input.action, targetId: input.targetId, decision: kill });
    return { ok: false, decision: kill, limits };
  }

  if (input.automated) {
    const rate = checkActionRate(limits, await automatedActionsLastHour());
    if (rate.verdict === "DENY") {
      await recordGuardrail({ action: input.action, targetId: input.targetId, decision: rate });
      return { ok: false, decision: rate, limits };
    }
  }

  return { ok: true, decision: kill, limits };
}

export type { GuardrailDecision, GuardrailLimits };

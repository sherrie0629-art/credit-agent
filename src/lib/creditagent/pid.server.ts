// 离散 PID 提案服务端：只写 PENDING_APPROVAL 预算卡，不直接改日预算。
// 动钱原则：批准路径走 agent.server approveDecision + guardrails。
import { checkBudgetChange } from "./guardrails";
import { loadLimits, recordGuardrail } from "./guardrails.server";
import { getSnapshot, nextDecisionId } from "./agent.server";
import {
  PID_MIN_DISBURSED,
  PID_SUGGEST_COOLDOWN_MS,
  TARGET_CPS,
  emptyPidState,
  maxStepFromBudget,
  pidStep,
  type PidControllerState,
} from "./pid";
import type { AdGroup } from "./types";

type Row = Record<string, any>;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // pid_controller_state 未包含在生成的类型里（自定义控制器状态表），这里放宽表名约束。
  return supabaseAdmin as unknown as {
    from: (table: string) => any;
  };
}


function mapState(r: Row): PidControllerState & { lastSuggestionAt: string | null } {
  return {
    integral: Number(r.integral ?? 0),
    lastError: Number(r.last_error ?? 0),
    lastOutput: Number(r.last_output ?? 0),
    lastCps: Number(r.last_cps ?? 0),
    lastSuggestionAt: (r.last_suggestion_at as string | null) ?? null,
  };
}

async function loadState(adGroupId: string) {
  const supabase = await db();
  const { data } = await supabase
    .from("pid_controller_state")
    .select("*")
    .eq("ad_group_id", adGroupId)
    .maybeSingle();
  if (!data) return { ...emptyPidState(), lastSuggestionAt: null as string | null };
  return mapState(data as Row);
}

async function upsertState(
  adGroupId: string,
  state: PidControllerState,
  opts?: { lastSuggestionAt?: string | null; touchSuggestion?: boolean },
) {
  const supabase = await db();
  const row: Row = {
    ad_group_id: adGroupId,
    integral: state.integral,
    last_error: state.lastError,
    last_output: state.lastOutput,
    last_cps: state.lastCps,
    updated_at: new Date().toISOString(),
  };
  if (opts?.touchSuggestion) {
    row.last_suggestion_at = new Date().toISOString();
  } else if (opts?.lastSuggestionAt !== undefined) {
    row.last_suggestion_at = opts.lastSuggestionAt;
  }
  await supabase.from("pid_controller_state").upsert(row as never, { onConflict: "ad_group_id" });
}

/** 人工改预算后重置积分，避免旧积分顶着新设定。 */
export async function resetPidState(adGroupId: string) {
  const supabase = await db();
  await supabase.from("pid_controller_state").upsert(
    {
      ad_group_id: adGroupId,
      integral: 0,
      last_error: 0,
      last_output: 0,
      last_cps: 0,
      last_suggestion_at: null,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "ad_group_id" },
  );
}

function eligibleStatus(status: string) {
  return status === "ACTIVE" || status === "LEARNING";
}

export interface PidPassResult {
  suggested: number;
  skipped: number;
  details: Array<Record<string, unknown>>;
}

/**
 * Sweep 一轮：对合格广告组算 PID，写入待审批 BUDGET_SHIFT（强制人工批准）。
 */
export async function runPidBudgetPass(): Promise<PidPassResult> {
  const limits = await loadLimits();
  const details: Array<Record<string, unknown>> = [];
  let suggested = 0;
  let skipped = 0;

  if (limits.killSwitch) {
    return { suggested: 0, skipped: 0, details: [{ skipped: "KILL_SWITCH" }] };
  }

  const snapshot = await getSnapshot();
  const supabase = await db();

  const { data: pendingRows } = await supabase
    .from("agent_decisions")
    .select("ad_group_id")
    .eq("action_type", "BUDGET_SHIFT")
    .eq("status", "PENDING_APPROVAL");
  const pendingGroups = new Set(
    ((pendingRows ?? []) as Row[]).map((r) => r.ad_group_id as string).filter(Boolean),
  );

  const now = Date.now();

  for (const g of snapshot.adGroups) {
    const outcome = await considerAdGroup(g, {
      limits,
      pendingGroups,
      now,
    });
    details.push(outcome);
    if (outcome.action === "suggested") suggested += 1;
    else skipped += 1;
  }

  return { suggested, skipped, details };
}

async function considerAdGroup(
  g: AdGroup,
  ctx: {
    limits: Awaited<ReturnType<typeof loadLimits>>;
    pendingGroups: Set<string>;
    now: number;
  },
) {
  const base = { adGroupId: g.id, adGroupName: g.name };

  if (!eligibleStatus(g.status)) {
    return { ...base, action: "skipped", reason: `status=${g.status}` };
  }
  if ((g.disbursedCount ?? 0) < PID_MIN_DISBURSED) {
    return {
      ...base,
      action: "skipped",
      reason: `disbursedCount ${g.disbursedCount ?? 0} < ${PID_MIN_DISBURSED}`,
    };
  }
  if (!(g.cps > 0)) {
    return { ...base, action: "skipped", reason: "cps_unavailable" };
  }
  if (ctx.pendingGroups.has(g.id)) {
    return { ...base, action: "skipped", reason: "pending_budget_shift" };
  }

  const prev = await loadState(g.id);
  if (prev.lastSuggestionAt) {
    const elapsed = ctx.now - new Date(prev.lastSuggestionAt).getTime();
    if (elapsed < PID_SUGGEST_COOLDOWN_MS) {
      return {
        ...base,
        action: "skipped",
        reason: "cooldown",
        cooldownRemainingMs: PID_SUGGEST_COOLDOWN_MS - elapsed,
      };
    }
  }

  const error = TARGET_CPS - g.cps;
  const maxStep = maxStepFromBudget(
    g.dailyBudget,
    ctx.limits.maxBudgetDeltaPct,
    ctx.limits.maxAdGroupDailyBudget,
  );
  const step = pidStep({
    error,
    prev: {
      integral: prev.integral,
      lastError: prev.lastError,
      lastOutput: prev.lastOutput,
      lastCps: g.cps,
    },
    maxStep,
  });

  const nextState = { ...step.nextState, lastCps: g.cps };

  if (step.inDeadzone || step.deltaBudget === 0) {
    await upsertState(g.id, nextState, { lastSuggestionAt: prev.lastSuggestionAt });
    return {
      ...base,
      action: "skipped",
      reason: step.inDeadzone ? "deadzone" : "zero_delta",
      error,
      cps: g.cps,
    };
  }

  let targetBudget = Math.round(g.dailyBudget + step.deltaBudget);
  targetBudget = Math.max(1, Math.min(ctx.limits.maxAdGroupDailyBudget, targetBudget));

  // 预检：若当前就会被 DENY，仍更新控制器状态但不出卡，避免无效打扰。
  const verdict = checkBudgetChange(ctx.limits, {
    current: g.dailyBudget,
    next: targetBudget,
  });
  await recordGuardrail({
    action: "PID_BUDGET_SUGGEST",
    targetId: g.id,
    decision: verdict,
    requested: { from: g.dailyBudget, to: targetBudget, error, terms: step.terms },
  });

  if (verdict.verdict === "DENY") {
    await upsertState(g.id, nextState, { lastSuggestionAt: prev.lastSuggestionAt });
    return { ...base, action: "skipped", reason: "guardrail_deny", detail: verdict.detail };
  }

  if (verdict.verdict === "CLAMP" && verdict.value != null) {
    targetBudget = Math.round(verdict.value);
  }

  if (targetBudget === g.dailyBudget) {
    await upsertState(g.id, nextState, { lastSuggestionAt: prev.lastSuggestionAt });
    return { ...base, action: "skipped", reason: "no_change_after_clamp" };
  }

  const delta = targetBudget - g.dailyBudget;
  const deltaPct = g.dailyBudget > 0 ? (delta / g.dailyBudget) * 100 : 0;
  const direction = delta < 0 ? "下调" : "上调";
  const absErr = Math.abs(error);
  const decisionId = await nextDecisionId();

  const reasoningChain = [
    `广告组「${g.name}」当前日预算 $${g.dailyBudget.toLocaleString()}，近窗 CPS $${g.cps.toFixed(2)}，${g.cps > TARGET_CPS ? "高于" : "低于"}目标 $${TARGET_CPS.toFixed(2)}。`,
    `相对目标${g.cps > TARGET_CPS ? "偏高" : "偏低"} $${absErr.toFixed(2)}：建议小幅${direction}日预算，${
      delta < 0 ? "避免继续放量推高放款成本" : "在成本可控时适度放量"
    }。`,
    `建议日预算 $${targetBudget.toLocaleString()}（${delta >= 0 ? "+" : "−"}$${Math.abs(delta).toLocaleString()}，约 ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(0)}%）；单次变动未超过风控幅度上限。`,
    `本建议约每 2 小时最多提出一次；需人工批准后才会改预算，不会自动执行。`,
    `内部明细：e=${error >= 0 ? "+" : ""}${error.toFixed(2)} · P=${step.terms.p.toFixed(1)} · I=${step.terms.i.toFixed(1)} · D=${step.terms.d.toFixed(1)} · ΔB=${delta}（供调参）。`,
  ];

  const supabase = await db();
  await supabase.from("agent_decisions").insert({
    id: decisionId,
    timestamp: new Date().toISOString(),
    agent_type: "Planner",
    action_type: "BUDGET_SHIFT",
    target_channel: g.channel,
    campaign_id: g.campaignId,
    campaign_name: g.campaignName,
    ad_group_id: g.id,
    ad_group_name: g.name,
    confidence_score: clampConfidence(absErr),
    trigger_source: "SWEEP",
    guardrail_note:
      verdict.verdict === "CLAMP"
        ? `提案阶段风控已截断（${verdict.rule}）：${verdict.detail}`
        : null,
    reasoning_chain: reasoningChain as never,
    trigger_metric: "CostPerDisbursement",
    trigger_current_value: Number(g.cps.toFixed(3)),
    trigger_threshold_value: TARGET_CPS,
    status: "PENDING_APPROVAL",
    effect: `日预算 $${g.dailyBudget.toLocaleString()} → $${targetBudget.toLocaleString()}`,
    rollback_to: `$${g.dailyBudget.toLocaleString()}`,
  } as never);

  await upsertState(g.id, nextState, { touchSuggestion: true });
  ctx.pendingGroups.add(g.id);

  return {
    ...base,
    action: "suggested",
    decisionId,
    from: g.dailyBudget,
    to: targetBudget,
    cps: g.cps,
    error,
    delta,
  };
}

function clampConfidence(absErr: number) {
  // 偏离越大略降置信；落在合理区间 0.72–0.88
  const c = 0.88 - Math.min(absErr, 8) * 0.02;
  return Number(Math.max(0.72, Math.min(0.88, c)).toFixed(2));
}

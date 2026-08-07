// 定时轮询兜底轨：与事件驱动构成双轨，事件漏了由 15 分钟一次的巡检补上。
// 止损与执行全部走硬编码规则；LLM 分析师每 6 小时才跑一次，且只产出待审批建议。
import { autoPauseRiskyGroups, getSnapshot } from "./agent.server";
import { ADVISOR_MIN_INTERVAL_MS, lastAdvisorRunAt, runPlannerAdvisor } from "./advisor.server";
import { scanFatigue, settleExperiment } from "./creative.server";
import { checkPacing } from "./guardrails";
import { loadLimits, recordGuardrail } from "./guardrails.server";
import { releaseToPool, runReallocation } from "./reallocate.server";



type Row = Record<string, any>;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function runAgentSweep() {
  const supabase = await db();
  const startedAt = new Date().toISOString();
  const detail: Record<string, unknown> = {};

  const limits = await loadLimits();
  if (limits.killSwitch) {
    await supabase.from("sweep_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: true,
      detail: { skipped: "KILL_SWITCH" },
    } as never);
    return { ok: true, skipped: "KILL_SWITCH" as const };
  }

  // 1) 素材疲劳巡检
  let fatigueAlerts = 0;
  try {
    const res = await scanFatigue();
    fatigueAlerts = res.alerts.length;
    detail.fatigue = res.alerts.map((a) => a.creativeId);
  } catch (e) {
    detail.fatigueError = String(e);
  }

  // 2) 风控通过率兜底暂停
  let riskPauses = 0;
  try {
    const res = await autoPauseRiskyGroups("SWEEP");
    riskPauses = res.pausedCampaigns.length;
    detail.riskPauses = res.pausedCampaigns;
  } catch (e) {
    detail.riskError = String(e);
  }

  const snapshot = await getSnapshot();

  // 3) 达到判定条件的实验自动结算
  let settled = 0;
  for (const exp of snapshot.experiments.filter((e) => e.status === "RUNNING")) {
    try {
      const res = await settleExperiment(exp.id);
      if (res.decided) settled += 1;
    } catch (e) {
      detail.settleError = String(e);
    }
  }

  // 4) 消耗节奏异常检查（提前止损）
  const hourOfDay = new Date().getUTCHours();
  let paceBreaches = 0;
  for (const g of snapshot.adGroups.filter((x) => x.status === "ACTIVE")) {
    const verdict = checkPacing({
      spentToday: g.spentToday,
      dailyBudget: g.dailyBudget,
      hourOfDay,
    });
    if (verdict.verdict === "DENY") {
      paceBreaches += 1;
      await recordGuardrail({
        action: "SWEEP_PACING",
        targetId: g.id,
        decision: verdict,
        requested: { spentToday: g.spentToday, dailyBudget: g.dailyBudget },
      });
      await supabase
        .from("ad_groups")
        .update({
          status: "PAUSED",
          ai_suggestion: `定时巡检：${verdict.detail}`,
        } as never)
        .eq("id", g.id);
      await releaseToPool({
        adGroupId: g.id,
        adGroupName: g.name,
        campaignId: g.campaignId,
        campaignName: g.campaignName,
        amount: Math.max(0, g.dailyBudget - g.spentToday),
        reason: "PACING",
        note: verdict.detail,
      });
    }
  }

  // 5) 离散 PID：按目标 CPS 提案单组预算微调（只出待审批卡，不直接改钱）
  let pidSuggested = 0;
  try {
    const { runPidBudgetPass } = await import("./pid.server");
    const pid = await runPidBudgetPass();
    pidSuggested = pid.suggested;
    detail.pid = {
      suggested: pid.suggested,
      skipped: pid.skipped,
      details: pid.details,
    };
  } catch (e) {
    detail.pidError = String(e);
  }

  // 6) 跨广告组预算再分配：把池里的钱转到高胜率广告组（判定硬编码）
  let reallocated = 0;
  try {
    const res = await runReallocation("SWEEP");
    reallocated = res.allocated;
    detail.reallocation = {
      allocated: res.allocated,
      skipped: "skipped" in res ? res.skipped : null,
      decisionId: res.decisionId,
    };
  } catch (e) {
    detail.reallocationError = String(e);
  }

  // 7) LLM 分析师（降频，每 6 小时一次）——只产出待审批建议，不改任何投放状态
  let advisorCreated = 0;
  try {
    const last = await lastAdvisorRunAt();
    if (last === null || Date.now() - last >= ADVISOR_MIN_INTERVAL_MS) {
      const res = await runPlannerAdvisor("SWEEP");
      advisorCreated = res.created;
      detail.advisor = { created: res.created, dropped: res.dropped, error: res.error };
    } else {
      detail.advisor = { skipped: "COOLDOWN" };
    }
  } catch (e) {
    detail.advisorError = String(e);
  }


  const finishedAt = new Date().toISOString();
  await supabase.from("sweep_runs").insert({
    started_at: startedAt,
    finished_at: finishedAt,
    ok: true,
    fatigue_alerts: fatigueAlerts,
    risk_pauses: riskPauses,
    experiments_settled: settled,
    pace_breaches: paceBreaches,
    detail: detail as never,
  } as never);

  return {
    ok: true,
    fatigueAlerts,
    riskPauses,
    experimentsSettled: settled,
    reallocatedAmount: reallocated,
    pidSuggested,
    paceBreaches,
    advisorSuggestions: advisorCreated,
  };
}


/** 最近一次巡检的执行摘要，供前端显示"兜底轨在跑"。 */
export async function lastSweep() {
  const supabase = await db();
  const { data } = await supabase
    .from("sweep_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = (data ?? null) as Row | null;
  if (!r) return null;
  return {
    startedAt: r.started_at as string,
    fatigueAlerts: Number(r.fatigue_alerts ?? 0),
    riskPauses: Number(r.risk_pauses ?? 0),
    experimentsSettled: Number(r.experiments_settled ?? 0),
    paceBreaches: Number(r.pace_breaches ?? 0),
  };
}

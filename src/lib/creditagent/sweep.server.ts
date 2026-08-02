// 定时轮询兜底轨：与事件驱动构成双轨，事件漏了由 15 分钟一次的巡检补上。
// 全流程零 LLM 参与，全部走硬编码规则。
import { autoPauseRiskyGroups, getSnapshot } from "./agent.server";
import { scanFatigue, settleExperiment } from "./creative.server";
import { checkPacing } from "./guardrails";
import { loadLimits, recordGuardrail } from "./guardrails.server";

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
    }
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
    paceBreaches,
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

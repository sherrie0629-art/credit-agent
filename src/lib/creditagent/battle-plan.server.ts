// 日作战计划服务端：收集待审候选 → LLM 编排（失败则启发式）→ 一键批高优先级仍走 approveDecision。
import { ADVISOR_MODEL, callLovableModel, parseAdvisorJson } from "./advisor.server";
import { approveDecision, getSnapshot } from "./agent.server";
import { loadLimits } from "./guardrails.server";
import {
  heuristicBattlePlan,
  sanitizeBattlePlan,
  type BattlePlan,
  type BattlePlanCandidate,
} from "./battle-plan";
import type { AgentDecision } from "./types";

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

function budgetDeltaHint(effect: string, dailyBudget?: number): number {
  const m = /→\s*\$([\d,]+(?:\.\d+)?)/.exec(effect);
  if (!m || dailyBudget == null || !(dailyBudget > 0)) {
    if (/暂停|PAUSE/i.test(effect)) return -100;
    if (/\+\s*\d+%|上调|提高|加预算/i.test(effect)) return 10;
    if (/−\s*\d+%|-\s*\d+%|下调|降低|降预算|砍/i.test(effect)) return -10;
    return 0;
  }
  const next = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(next)) return 0;
  return ((next - dailyBudget) / dailyBudget) * 100;
}

export function collectBattlePlanCandidates(
  decisions: AgentDecision[],
  adGroups: { id: string; cps: number; dailyBudget: number; spentToday: number }[],
): BattlePlanCandidate[] {
  const byId = new Map(adGroups.map((g) => [g.id, g]));
  return decisions
    .filter((d) => d.status === "PENDING_APPROVAL")
    .map((d) => {
      const g = d.adGroupId ? byId.get(d.adGroupId) : undefined;
      return {
        decisionId: d.id,
        actionType: d.actionType,
        adGroupId: d.adGroupId,
        adGroupName: d.adGroupName,
        channel: d.targetChannel,
        effect: d.effect,
        triggerSource: d.triggerSource,
        confidenceScore: d.confidenceScore,
        cps: g?.cps,
        dailyBudget: g?.dailyBudget,
        spentToday: g?.spentToday,
        budgetDeltaHint: budgetDeltaHint(d.effect, g?.dailyBudget),
      };
    });
}

function battlePlanSystemPrompt() {
  return `你是消费信贷投放系统的「作战参谋」（Battle Planner）。

你不是执行者：不能改预算、不能发明新决策。你只能对输入里已有的待审决策（decisionId）做排序与优先级标注。

目标：把冗长待审队列压成今日可执行的作战顺序——先止血，再拨付，最后才考虑加预算。

优先级定义：
- P0：立即批（暂停高风险组、明显降预算止血）
- P1：今日应批（再分配拨付、次优先降预算）
- P2：可看情况批
- DEFER：今日暂缓（多为加预算、低紧迫、与 P0 冲突的同一组加码）

硬性约束：
1. decisionId 必须逐字来自输入 candidates，禁止编造。
2. 尽量覆盖全部 candidates；漏掉的会被系统标为 DEFER。
3. 同一 adGroupId 若有多张卡，只把最关键的一张标 P0/P1，其余 DEFER 或 P2。
4. why 用中文，一两句，引用输入中的数字。
5. summary 用中文，不超过 120 字，写给 COO 的今日作战意图。

只返回 JSON：
{"summary":"...","items":[{"decisionId":"","priority":"P0","why":""}]}`;
}

export type BattlePlanRunResult = {
  ok: boolean;
  plan: BattlePlan;
  skipped?: string;
  error?: string;
  dropped?: number;
};

export async function runBattlePlan(): Promise<BattlePlanRunResult> {
  // #region agent log
  fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
    body: JSON.stringify({
      sessionId: "6fd86b",
      runId: "pre-fix",
      hypothesisId: "A",
      location: "battle-plan.server.ts:runBattlePlan:entry",
      message: "runBattlePlan entered",
      data: { hasServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  let supabase: Awaited<ReturnType<typeof db>> | null = null;
  try {
    supabase = await db();
    // #region agent log
    fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
      body: JSON.stringify({
        sessionId: "6fd86b",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "battle-plan.server.ts:runBattlePlan:dbOk",
        message: "admin db acquired",
        data: {},
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  } catch (e) {
    // #region agent log
    fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
      body: JSON.stringify({
        sessionId: "6fd86b",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "battle-plan.server.ts:runBattlePlan:dbFail",
        message: "admin db failed",
        data: { err: String(e instanceof Error ? e.message : e).slice(0, 200) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw e;
  }

  const limits = await loadLimits();
  if (limits.killSwitch) {
    const empty = heuristicBattlePlan([]);
    empty.summary = "全局熔断开启中：不生成作战计划，自动化与外推均冻结。";
    return { ok: true, plan: empty, skipped: "KILL_SWITCH" };
  }

  let snapshot;
  try {
    snapshot = await getSnapshot();
    // #region agent log
    fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
      body: JSON.stringify({
        sessionId: "6fd86b",
        runId: "pre-fix",
        hypothesisId: "D",
        location: "battle-plan.server.ts:runBattlePlan:snapshot",
        message: "snapshot loaded",
        data: {
          pending: snapshot.decisions.filter((d) => d.status === "PENDING_APPROVAL").length,
          adGroups: snapshot.adGroups.length,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  } catch (e) {
    // #region agent log
    fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
      body: JSON.stringify({
        sessionId: "6fd86b",
        runId: "pre-fix",
        hypothesisId: "D",
        location: "battle-plan.server.ts:runBattlePlan:snapshotFail",
        message: "getSnapshot failed",
        data: { err: String(e instanceof Error ? e.message : e).slice(0, 200) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw e;
  }

  const candidates = collectBattlePlanCandidates(snapshot.decisions, snapshot.adGroups);

  if (candidates.length === 0) {
    const plan = heuristicBattlePlan([]);
    return { ok: true, plan, dropped: 0 };
  }

  let plan: BattlePlan;
  let droppedCount = 0;

  try {
    // #region agent log
    fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
      body: JSON.stringify({
        sessionId: "6fd86b",
        runId: "pre-fix",
        hypothesisId: "C",
        location: "battle-plan.server.ts:runBattlePlan:llmStart",
        message: "calling lovable model",
        data: { candidates: candidates.length, hasLovableKey: Boolean(process.env.LOVABLE_API_KEY) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const out = await callLovableModel(battlePlanSystemPrompt(), {
      account: {
        targetCps: 19,
        mode: snapshot.mode,
        riskPosture: snapshot.riskPosture,
        pendingCount: candidates.length,
      },
      candidates,
    });
    const raw = parseAdvisorJson(out.text);
    const { plan: sanitized, dropped } = sanitizeBattlePlan(raw, candidates, {
      model: ADVISOR_MODEL,
    });
    plan = sanitized;
    droppedCount = dropped.length;
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e).slice(0, 300);
    // #region agent log
    fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
      body: JSON.stringify({
        sessionId: "6fd86b",
        runId: "pre-fix",
        hypothesisId: "C",
        location: "battle-plan.server.ts:runBattlePlan:llmFail",
        message: "llm failed, heuristic fallback",
        data: { err: message.slice(0, 160) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    plan = heuristicBattlePlan(candidates);
    plan.summary = `${plan.summary}（AI 编排失败已回退：${message.slice(0, 80)}）`;
    if (supabase) {
      await supabase.from("advisor_runs").insert({
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        trigger_source: "BATTLE_PLAN",
        ok: false,
        model: ADVISOR_MODEL,
        duration_ms: Date.now() - t0,
        error: message,
        suggestions_raw: candidates.length,
        suggestions_kept: plan.highPriorityIds.length,
      } as never);
    }
    return { ok: true, plan, error: message, dropped: 0 };
  }

  if (supabase) {
    await supabase.from("advisor_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      trigger_source: "BATTLE_PLAN",
      ok: true,
      model: ADVISOR_MODEL,
      duration_ms: Date.now() - t0,
      raw_output: plan.summary.slice(0, 2000),
      suggestions_raw: candidates.length,
      suggestions_kept: plan.highPriorityIds.length,
      dropped: [] as never,
    } as never);
  }

  // #region agent log
  fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
    body: JSON.stringify({
      sessionId: "6fd86b",
      runId: "pre-fix",
      hypothesisId: "E",
      location: "battle-plan.server.ts:runBattlePlan:ok",
      message: "plan ready",
      data: {
        source: plan.source,
        high: plan.highPriorityIds.length,
        candidates: plan.candidateCount,
        droppedCount,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  return { ok: true, plan, dropped: droppedCount };
}

export type BattlePlanApproveResult = {
  ok: boolean;
  attempted: number;
  executed: number;
  blocked: number;
  failed: number;
  results: {
    id: string;
    status: string;
    guardrailNote?: string | null;
  }[];
  skipped?: string;
};

/** 按作战计划顺序批准高优先级；每张卡仍走 approveDecision（含风控）。 */
export async function approveBattlePlanHighPriority(
  decisionIds: string[],
): Promise<BattlePlanApproveResult> {
  const limits = await loadLimits();
  if (limits.killSwitch) {
    return {
      ok: false,
      attempted: 0,
      executed: 0,
      blocked: 0,
      failed: 0,
      results: [],
      skipped: "KILL_SWITCH",
    };
  }

  const snapshot = await getSnapshot();
  const pending = new Set(
    snapshot.decisions.filter((d) => d.status === "PENDING_APPROVAL").map((d) => d.id),
  );
  const ids = decisionIds.filter((id) => pending.has(id));

  const results: BattlePlanApproveResult["results"] = [];
  let executed = 0;
  let blocked = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      const patch = await approveDecision(id);
      const status = patch.decision?.status ?? "UNKNOWN";
      const note = patch.decision?.guardrailNote;
      if (status === "EXECUTED") executed += 1;
      else blocked += 1;
      results.push({ id, status, guardrailNote: note });
    } catch (e) {
      failed += 1;
      results.push({
        id,
        status: "ERROR",
        guardrailNote: String(e instanceof Error ? e.message : e).slice(0, 200),
      });
    }
  }

  return {
    ok: true,
    attempted: ids.length,
    executed,
    blocked,
    failed,
    results,
  };
}

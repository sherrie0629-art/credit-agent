// 跨广告组预算再分配的服务端执行器。
// 释放 → 入池 → 分配 → 落库，全链路留痕：每一笔都写 budget_pool_entries 并关联决策卡。
// 分配判定来自 ./reallocate（纯函数、硬编码），LLM 不参与。
import { checkBudgetChange } from "./guardrails";
import { loadLimits, preflight, recordGuardrail } from "./guardrails.server";
import {
  PACE_FLOOR,
  TARGET_CPS,
  WIN_RATE_FLOOR,
  planReallocation,
  type PoolReason,
  type ReallocationCandidate,
} from "./reallocate";
import type { BudgetPoolEntry, BudgetPoolState } from "./types";

type Row = Record<string, any>;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function mapEntry(r: Row): BudgetPoolEntry {
  return {
    id: Number(r.id),
    direction: r.direction,
    adGroupId: r.ad_group_id || undefined,
    adGroupName: r.ad_group_name || undefined,
    campaignId: r.campaign_id || undefined,
    campaignName: r.campaign_name || undefined,
    amount: Number(r.amount),
    reason: r.reason,
    decisionId: r.decision_id ?? undefined,
    status: r.status,
    note: r.note ?? "",
    poolDay: r.pool_day,
    createdAt: r.created_at,
  };
}

/** 释放预算入池：暂停 / 降预算 / 节奏止损路径调用。 */
export async function releaseToPool(input: {
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  campaignName: string;
  amount: number;
  reason: PoolReason;
  decisionId?: string;
  note?: string;
  status?: "PENDING" | "APPLIED";
}) {
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const supabase = await db();
  const { data } = await supabase
    .from("budget_pool_entries")
    .insert({
      direction: "RELEASE",
      ad_group_id: input.adGroupId,
      ad_group_name: input.adGroupName,
      campaign_id: input.campaignId,
      campaign_name: input.campaignName,
      amount,
      reason: input.reason,
      decision_id: input.decisionId ?? null,
      status: input.status ?? "APPLIED",
      note: input.note ?? "",
      pool_day: today(),
    } as never)
    .select("*")
    .maybeSingle();
  return data ? mapEntry(data as Row) : null;
}

/**
 * 跨自然日的未分配余额自动过期回收，防止陈旧资金被拿来扩量。
 * 回收方式是补一条 ALLOCATE / EXPIRED 流水把当日账做平，不动任何广告组。
 */
export async function expireStalePool() {
  const supabase = await db();
  const day = today();
  const { data } = await supabase
    .from("budget_pool_entries")
    .select("*")
    .neq("status", "REVERTED")
    .lt("pool_day", day);
  const rows = ((data ?? []) as Row[]).map(mapEntry);
  if (rows.length === 0) return 0;

  const byDay = new Map<string, number>();
  for (const r of rows) {
    const sign = r.direction === "RELEASE" ? 1 : -1;
    byDay.set(r.poolDay, (byDay.get(r.poolDay) ?? 0) + sign * r.amount);
  }

  let expired = 0;
  for (const [poolDay, balance] of byDay) {
    if (balance <= 0) continue;
    await supabase.from("budget_pool_entries").insert({
      direction: "ALLOCATE",
      amount: balance,
      reason: "EXPIRED",
      status: "APPLIED",
      note: `${poolDay} 未分配余额过期回收，不结转至次日。`,
      pool_day: poolDay,
    } as never);
    expired += balance;
  }
  return expired;
}

/** 当日资金池状态：余额 = 已生效释放 − （已生效 + 待审批）分配。 */
export async function getPoolState(): Promise<BudgetPoolState> {
  const supabase = await db();
  const day = today();
  const { data } = await supabase
    .from("budget_pool_entries")
    .select("*")
    .eq("pool_day", day)
    .neq("status", "REVERTED")
    .order("created_at", { ascending: false });

  const entries = ((data ?? []) as Row[]).map(mapEntry);
  const released = entries
    .filter((e) => e.direction === "RELEASE" && e.status === "APPLIED")
    .reduce((s, e) => s + e.amount, 0);
  const allocated = entries
    .filter((e) => e.direction === "ALLOCATE" && e.status === "APPLIED")
    .reduce((s, e) => s + e.amount, 0);
  const reserved = entries
    .filter((e) => e.direction === "ALLOCATE" && e.status === "PENDING")
    .reduce((s, e) => s + e.amount, 0);

  const lastAllocatedAt =
    entries.find((e) => e.direction === "ALLOCATE" && e.status === "APPLIED")?.createdAt ?? null;

  return {
    day,
    released,
    allocated,
    reserved,
    balance: Math.max(0, released - allocated - reserved),
    lastAllocatedAt,
    entries: entries.slice(0, 40),
  };
}

/**
 * 主流程：读池 + 读快照 → 跑纯函数 → 生成一张组合决策卡。
 * FULL_AUTO 且风控全绿时直接落库；否则整张卡待审批，资金在池中冻结（reserved）。
 */
export async function runReallocation(triggerSource: "EVENT" | "SWEEP" | "MANUAL" = "MANUAL") {
  const supabase = await db();
  const { getSnapshot, nextDecisionId } = await import("./agent.server");

  await expireStalePool();
  const pool = await getPoolState();
  if (pool.balance <= 0) {
    return { ok: true, skipped: "EMPTY_POOL" as const, pool, decisionId: null, allocated: 0 };
  }

  const snapshot = await getSnapshot();
  const limits = await loadLimits();

  const candidates: ReallocationCandidate[] = snapshot.adGroups.map((g) => ({
    id: g.id,
    name: g.name,
    campaignId: g.campaignId,
    campaignName: g.campaignName,
    status: g.status,
    dailyBudget: g.dailyBudget,
    spentToday: g.spentToday,
    last20ApprovalRate: g.last20ApprovalRate,
    cps: g.cps,
  }));

  const plan = planReallocation({
    pool: pool.balance,
    candidates,
    limits: {
      maxBudgetDeltaPct: limits.maxBudgetDeltaPct,
      maxAdGroupDailyBudget: limits.maxAdGroupDailyBudget,
    },
  });

  if (plan.allocations.length === 0) {
    // 没有合格承接方：钱全额留池，不强行乱花，只留一条风控记录。
    await recordGuardrail({
      action: "BUDGET_REALLOCATION",
      decision: {
        verdict: "DENY",
        rule: "NO_ELIGIBLE_RECIPIENT",
        detail: `待分配池 $${pool.balance.toLocaleString()} 无合格承接广告组（门槛：通过率 ≥ ${(WIN_RATE_FLOOR * 100).toFixed(0)}% · CPS ≤ $${TARGET_CPS} · 消耗率 ≥ ${PACE_FLOOR * 100}%），资金留池。`,
      },
      requested: { pool: pool.balance, rejected: plan.rejected },
    });
    return {
      ok: true,
      skipped: "NO_ELIGIBLE_RECIPIENT" as const,
      pool,
      decisionId: null,
      allocated: 0,
      rejected: plan.rejected,
    };
  }

  const { data: settings } = await supabase
    .from("agent_settings")
    .select("mode")
    .eq("id", "default")
    .maybeSingle();
  let mode = ((settings as Row | null)?.mode ?? "SEMI_AUTO") as "FULL_AUTO" | "SEMI_AUTO";

  const gate = await preflight({
    action: "BUDGET_REALLOCATION",
    automated: mode === "FULL_AUTO",
  });
  let guardrailNote: string | null = null;
  if (!gate.ok) {
    mode = "SEMI_AUTO";
    guardrailNote = `风控层拦截自动执行（${gate.decision.rule}）：${gate.decision.detail}`;
  }

  const sources = pool.entries.filter((e) => e.direction === "RELEASE" && e.status === "APPLIED");
  const decisionId = await nextDecisionId();
  const top = plan.allocations[0]!;

  const reasoningChain = [
    `待分配资金池余额 $${pool.balance.toLocaleString()}（${pool.day}），来源共 ${sources.length} 笔。`,
    ...sources
      .slice(0, 4)
      .map(
        (s) =>
          `释放：${s.adGroupName ?? "—"} −$${s.amount.toLocaleString()}（${REASON_LABEL[s.reason] ?? s.reason}）。`,
      ),
    `承接筛选（硬编码）：投放中 · 授信通过率 ≥ ${(WIN_RATE_FLOOR * 100).toFixed(0)}% · CPS ≤ $${TARGET_CPS} · 今日消耗率 ≥ ${PACE_FLOOR * 100}%。`,
    ...plan.allocations.map(
      (a) =>
        `分配：${a.adGroupName} +$${a.amount.toLocaleString()}（$${a.fromBudget.toLocaleString()} → $${a.toBudget.toLocaleString()}）· ${a.rationale}`,
    ),
    ...plan.rejected
      .slice(0, 3)
      .map((r) => `未获分配：${r.adGroupName} — ${r.reason}`),
    plan.remaining > 0
      ? `剩余 $${plan.remaining.toLocaleString()} 无合格承接方，继续留池，当日未用则过期回收。`
      : "池余额已全额分配完毕。",
    guardrailNote ?? "风控规则层校验通过：每笔加预算均在单次幅度与绝对上限内。",
    mode === "FULL_AUTO"
      ? "托管模式 = Full-Auto：直接调用广告 API 执行转移。"
      : "托管模式 = Semi-Auto：整张转移方案待人工确认，期间资金在池中冻结。",
  ];

  await supabase.from("agent_decisions").insert({
    id: decisionId,
    timestamp: new Date().toISOString(),
    agent_type: "Planner",
    action_type: "BUDGET_SHIFT",
    target_channel: snapshot.adGroups.find((g) => g.id === top.adGroupId)?.channel ?? "Google",
    campaign_id: top.campaignId,
    campaign_name: top.campaignName,
    ad_group_id: top.adGroupId,
    ad_group_name: top.adGroupName,
    confidence_score: 0.9,
    trigger_source: triggerSource === "MANUAL" ? "EVENT" : triggerSource,
    guardrail_note: guardrailNote,
    reasoning_chain: reasoningChain as never,
    trigger_metric: "CostPerDisbursement",
    trigger_current_value: top.fromBudget,
    trigger_threshold_value: TARGET_CPS,
    status: mode === "FULL_AUTO" ? "EXECUTED" : "PENDING_APPROVAL",
    effect: `跨广告组预算再分配：$${plan.allocated.toLocaleString()} 转入 ${plan.allocations.length} 个高胜率广告组`,
    rollback_to: plan.allocations
      .map((a) => `${a.adGroupName} $${a.fromBudget.toLocaleString()}`)
      .join(" / "),
  } as never);

  // 每笔分配都落一条 ALLOCATE 流水，PENDING 表示资金已冻结但尚未生效。
  await supabase.from("budget_pool_entries").insert(
    plan.allocations.map((a) => ({
      direction: "ALLOCATE",
      ad_group_id: a.adGroupId,
      ad_group_name: a.adGroupName,
      campaign_id: a.campaignId,
      campaign_name: a.campaignName,
      amount: a.amount,
      reason: "SCALE_UP",
      decision_id: decisionId,
      status: mode === "FULL_AUTO" ? "APPLIED" : "PENDING",
      note: a.rationale,
      pool_day: pool.day,
    })) as never,
  );

  if (mode === "FULL_AUTO") {
    for (const a of plan.allocations) {
      const verdict = checkBudgetChange(gate.limits, { current: a.fromBudget, next: a.toBudget });
      await recordGuardrail({
        action: "BUDGET_REALLOCATION",
        targetId: a.adGroupId,
        decision: verdict,
        requested: { from: a.fromBudget, to: a.toBudget, decisionId },
      });
      if (verdict.verdict === "DENY") {
        await supabase
          .from("budget_pool_entries")
          .update({ status: "REVERTED", note: `风控拒绝：${verdict.detail}` } as never)
          .eq("decision_id", decisionId)
          .eq("ad_group_id", a.adGroupId);
        continue;
      }
      const applied = verdict.verdict === "CLAMP" ? (verdict.value ?? a.toBudget) : a.toBudget;
      await supabase
        .from("ad_groups")
        .update({
          daily_budget: applied,
          ai_suggestion: `跨组再分配：+$${(applied - a.fromBudget).toLocaleString()}（来自待分配池）`,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", a.adGroupId);
    }
  }

  return {
    ok: true,
    pool: await getPoolState(),
    decisionId,
    allocated: plan.allocated,
    remaining: plan.remaining,
    allocations: plan.allocations,
    rejected: plan.rejected,
    autoExecuted: mode === "FULL_AUTO",
  };
}

export const REASON_LABEL: Record<string, string> = {
  RISK_PAUSE: "风控暂停释放",
  LOW_WIN_RATE: "低胜率削减",
  PACING: "节奏超速止损",
  SCALE_UP: "高胜率扩量",
  MANUAL: "人工调整",
  EXPIRED: "过期回收",
};

/** 该决策是否是一张跨组再分配卡（有关联的池流水）。 */
export async function pendingAllocationsFor(decisionId: string): Promise<BudgetPoolEntry[]> {
  const supabase = await db();
  const { data } = await supabase
    .from("budget_pool_entries")
    .select("*")
    .eq("decision_id", decisionId)
    .eq("direction", "ALLOCATE");
  return ((data ?? []) as Row[]).map(mapEntry);
}

/**
 * 人工批准再分配卡：逐笔重跑风控闸门后才写 ad_groups。
 * 任意一笔被拒不影响其余笔，被拒的流水标记 REVERTED，资金回流池。
 */
export async function applyReallocationDecision(decisionId: string) {
  const supabase = await db();
  const entries = (await pendingAllocationsFor(decisionId)).filter((e) => e.status === "PENDING");
  if (entries.length === 0) return { applied: 0, denied: 0, notes: [] as string[] };

  const gate = await preflight({ action: "APPROVE_REALLOCATION", automated: false });
  const notes: string[] = [];
  let applied = 0;
  let denied = 0;

  for (const e of entries) {
    const { data } = await supabase
      .from("ad_groups")
      .select("daily_budget,name")
      .eq("id", e.adGroupId ?? "")
      .maybeSingle();
    const current = Number((data as Row | null)?.daily_budget ?? 0);
    const next = current + e.amount;

    const verdict = checkBudgetChange(gate.limits, { current, next });
    await recordGuardrail({
      action: "APPROVE_REALLOCATION",
      targetId: e.adGroupId ?? "",
      decision: verdict,
      requested: { from: current, to: next, decisionId },
    });

    if (verdict.verdict === "DENY") {
      denied += 1;
      notes.push(`${e.adGroupName}：${verdict.detail}`);
      await supabase
        .from("budget_pool_entries")
        .update({ status: "REVERTED", note: `批准时被风控拒绝：${verdict.detail}` } as never)
        .eq("id", e.id);
      continue;
    }

    const target = verdict.verdict === "CLAMP" ? (verdict.value ?? next) : next;
    await supabase
      .from("ad_groups")
      .update({
        daily_budget: target,
        ai_suggestion: `跨组再分配（人工批准）：+$${(target - current).toLocaleString()}`,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", e.adGroupId ?? "");
    await supabase
      .from("budget_pool_entries")
      .update({ status: "APPLIED", amount: target - current } as never)
      .eq("id", e.id);
    applied += 1;
    if (verdict.verdict === "CLAMP") notes.push(`${e.adGroupName}：${verdict.detail}`);
  }

  return { applied, denied, notes };
}

/** 回滚再分配：把已生效的加预算按流水逆向写回，并把资金退还池中。 */
export async function revertReallocationDecision(decisionId: string) {
  const supabase = await db();
  const entries = (await pendingAllocationsFor(decisionId)).filter((e) => e.status !== "REVERTED");
  let reverted = 0;
  for (const e of entries) {
    if (e.status === "APPLIED" && e.adGroupId) {
      const { data } = await supabase
        .from("ad_groups")
        .select("daily_budget")
        .eq("id", e.adGroupId)
        .maybeSingle();
      const current = Number((data as Row | null)?.daily_budget ?? 0);
      await supabase
        .from("ad_groups")
        .update({
          daily_budget: Math.max(1, current - e.amount),
          ai_suggestion: "跨组再分配已回滚",
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", e.adGroupId);
    }
    await supabase
      .from("budget_pool_entries")
      .update({ status: "REVERTED", note: "决策回滚，资金退回待分配池" } as never)
      .eq("id", e.id);
    reverted += 1;
  }
  return reverted;
}

/**
 * @deprecated Product path removed (option 2): AI 参谋 = propose-only via advisor.
 * Orchestration / P0 ranking / one-click high-priority approve are no longer exposed in UI or store.
 * Kept for rollback; delete in a follow-up cleanup PR.
 */
// 日作战计划：纯函数（零网络 · 可单测）。
// LLM 只对「已有待审决策」排序/去重叙事，不得发明新动作或新 decisionId。

export const BATTLE_PRIORITIES = ["P0", "P1", "P2", "DEFER"] as const;
export type BattlePlanPriority = (typeof BATTLE_PRIORITIES)[number];

/** 高优先级：建议一键批准（仍走 approveDecision + guardrails）。 */
export const APPROVE_PRIORITIES: BattlePlanPriority[] = ["P0", "P1"];

export const MAX_BATTLE_PLAN_ITEMS = 40;

export interface BattlePlanCandidate {
  decisionId: string;
  actionType: string;
  adGroupId?: string;
  adGroupName?: string;
  channel: string;
  effect: string;
  triggerSource?: string;
  confidenceScore: number;
  cps?: number;
  dailyBudget?: number;
  spentToday?: number;
  /** 预算卡：负=降预算，正=加预算；非预算为 0 */
  budgetDeltaHint?: number;
}

export interface BattlePlanItem {
  decisionId: string;
  priority: BattlePlanPriority;
  order: number;
  why: string;
  approveRecommended: boolean;
}

export interface BattlePlan {
  generatedAt: string;
  summary: string;
  items: BattlePlanItem[];
  highPriorityIds: string[];
  deferredIds: string[];
  candidateCount: number;
  source: "llm" | "heuristic";
  model?: string;
}

export interface SanitizeBattlePlanResult {
  plan: BattlePlan;
  dropped: { index: number; reason: string }[];
}

function isPriority(v: unknown): v is BattlePlanPriority {
  return typeof v === "string" && (BATTLE_PRIORITIES as readonly string[]).includes(v);
}

/**
 * 规则回退排序：先止血（暂停 / 降预算），再分配，最后加预算。
 * LLM 失败或无 key 时使用，保证指挥中心仍可用。
 */
export function heuristicBattlePlan(candidates: BattlePlanCandidate[], now = new Date()): BattlePlan {
  const scored = candidates.map((c, i) => {
    let score = 0;
    if (c.actionType === "CREATIVE_PAUSE") score += 100;
    if (c.actionType === "BUDGET_SHIFT" && (c.budgetDeltaHint ?? 0) < 0) score += 80;
    if (c.actionType === "BUDGET_SHIFT" && /再分配|闲置|ALLOCATE|池/i.test(c.effect)) score += 60;
    if (c.actionType === "BUDGET_SHIFT" && (c.budgetDeltaHint ?? 0) > 0) score += 20;
    if (c.triggerSource === "SWEEP" || c.triggerSource === "EVENT") score += 10;
    if ((c.cps ?? 0) > 19) score += 15;
    score += c.confidenceScore * 5;
    return { c, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);

  const items: BattlePlanItem[] = scored.map((row, order) => {
    let priority: BattlePlanPriority = "P2";
    if (order < 3 && row.score >= 80) priority = "P0";
    else if (order < 8 && row.score >= 40) priority = "P1";
    else if (row.score < 25 || (row.c.budgetDeltaHint ?? 0) > 0) priority = order < 12 ? "P2" : "DEFER";
    const approveRecommended = APPROVE_PRIORITIES.includes(priority);
    return {
      decisionId: row.c.decisionId,
      priority,
      order,
      why:
        priority === "P0"
          ? "规则启发：优先止血（暂停或降预算）。"
          : priority === "P1"
            ? "规则启发：次优先处理，预计能改善 CPS 或释放预算。"
            : priority === "DEFER"
              ? "规则启发：可暂缓（多为加预算或低紧迫）。"
              : "规则启发：常规待批。",
      approveRecommended,
    };
  });

  const highPriorityIds = items.filter((x) => x.approveRecommended).map((x) => x.decisionId);
  const deferredIds = items.filter((x) => x.priority === "DEFER").map((x) => x.decisionId);
  const p0 = highPriorityIds.length;

  return {
    generatedAt: now.toISOString(),
    summary:
      candidates.length === 0
        ? "待审队列为空。可先运行分析师或等待扫仓产出候选后再生成作战计划。"
        : `启发式作战计划：${candidates.length} 张待审中，建议先批 ${p0} 张高优先级（暂停/降预算优先）；加预算类已后置。AI 编排不可用时的回退方案。`,
    items,
    highPriorityIds,
    deferredIds,
    candidateCount: candidates.length,
    source: "heuristic",
  };
}

/**
 * 把模型输出压回已知 decisionId 集合；禁止发明 id；P0/P1 强制可一键批。
 */
export function sanitizeBattlePlan(
  raw: unknown,
  candidates: BattlePlanCandidate[],
  opts?: { model?: string; now?: Date },
): SanitizeBattlePlanResult {
  const known = new Map(candidates.map((c) => [c.decisionId, c]));
  const dropped: SanitizeBattlePlanResult["dropped"] = [];
  const now = opts?.now ?? new Date();

  if (candidates.length === 0) {
    return {
      plan: heuristicBattlePlan([], now),
      dropped: [],
    };
  }

  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const summary =
    typeof root.summary === "string" && root.summary.trim().length >= 4
      ? root.summary.trim().slice(0, 400)
      : "";
  const list = Array.isArray(root.items)
    ? (root.items as unknown[])
    : Array.isArray(root.ranking)
      ? (root.ranking as unknown[])
      : [];

  const seen = new Set<string>();
  const items: BattlePlanItem[] = [];
  let fromModel = 0;

  list.forEach((item, index) => {
    if (items.length >= MAX_BATTLE_PLAN_ITEMS) {
      dropped.push({ index, reason: `超出上限 ${MAX_BATTLE_PLAN_ITEMS}` });
      return;
    }
    if (!item || typeof item !== "object") {
      dropped.push({ index, reason: "条目不是对象" });
      return;
    }
    const r = item as Record<string, unknown>;
    const decisionId = String(r.decisionId ?? r.decision_id ?? r.id ?? "").trim();
    if (!decisionId || !known.has(decisionId)) {
      dropped.push({ index, reason: `decisionId 不在待审集合：${decisionId || "(空)"}` });
      return;
    }
    if (seen.has(decisionId)) {
      dropped.push({ index, reason: "重复 decisionId" });
      return;
    }
    const priority: BattlePlanPriority = isPriority(r.priority) ? r.priority : "P2";
    const why = String(r.why ?? r.rationale ?? "").trim().slice(0, 240);
    if (why.length < 2) {
      dropped.push({ index, reason: "缺少 why" });
      return;
    }
    seen.add(decisionId);
    fromModel += 1;
    items.push({
      decisionId,
      priority,
      order: items.length,
      why,
      approveRecommended: APPROVE_PRIORITIES.includes(priority),
    });
  });

  if (fromModel === 0) {
    const fallback = heuristicBattlePlan(candidates, now);
    return {
      plan: { ...fallback, model: opts?.model },
      dropped: [...dropped, { index: -1, reason: "模型有效排序为空，已回退启发式" }],
    };
  }

  for (const c of candidates) {
    if (seen.has(c.decisionId)) continue;
    if (items.length >= MAX_BATTLE_PLAN_ITEMS) break;
    items.push({
      decisionId: c.decisionId,
      priority: "DEFER",
      order: items.length,
      why: "模型未排序，默认暂缓；仍可在队列中单独审批。",
      approveRecommended: false,
    });
  }

  items.forEach((it, i) => {
    it.order = i;
    it.approveRecommended = APPROVE_PRIORITIES.includes(it.priority);
  });

  const highPriorityIds = items.filter((x) => x.approveRecommended).map((x) => x.decisionId);
  const deferredIds = items.filter((x) => x.priority === "DEFER").map((x) => x.decisionId);

  return {
    plan: {
      generatedAt: now.toISOString(),
      summary:
        summary ||
        `已编排 ${items.length} 张待审：建议先批 ${highPriorityIds.length} 张高优先级（P0/P1），其余延后。`,
      items,
      highPriorityIds,
      deferredIds,
      candidateCount: candidates.length,
      source: "llm",
      model: opts?.model,
    },
    dropped,
  };
}

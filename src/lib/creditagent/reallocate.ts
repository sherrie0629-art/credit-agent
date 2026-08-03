// 跨广告组预算再分配的纯函数层（零依赖 · 零网络 · 可单测）。
// 判定全部硬编码：LLM 不参与分配，只可能在别处提出待审批建议。

export type PoolReason =
  | "RISK_PAUSE"
  | "LOW_WIN_RATE"
  | "PACING"
  | "SCALE_UP"
  | "MANUAL"
  | "EXPIRED";

/** 账户目标放款成本。 */
export const TARGET_CPS = 19;
/** 进入承接候选池的最低后端授信通过率。 */
export const WIN_RATE_FLOOR = 0.22;
/** 候选广告组允许的 CPS 上限系数（相对基准 CPS）。 */
export const CPS_TOLERANCE = 1.1;
/** 允许承接预算的广告组状态：暂停 / 合规冻结的组不接钱。 */
export const RECEIVABLE_STATUS = ["ACTIVE", "LEARNING"];
/** 今日消耗率下限——花不动钱的组不给加预算。 */
export const PACE_FLOOR = 0.6;
/** 打分权重（写进推理链，保证可审计）。 */
export const WEIGHT_WIN_RATE = 0.6;
export const WEIGHT_COST = 0.4;

export interface ReallocationCandidate {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  status: string;
  dailyBudget: number;
  spentToday: number;
  last20ApprovalRate: number;
  cps: number;
}

export interface ReallocationLimits {
  maxBudgetDeltaPct: number;
  maxAdGroupDailyBudget: number;
}

export interface Allocation {
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  campaignName: string;
  fromBudget: number;
  toBudget: number;
  amount: number;
  score: number;
  /** 该组本轮的加预算上限（受单次幅度与绝对上限约束）。 */
  headroom: number;
  rationale: string;
}

export interface RejectedCandidate {
  adGroupId: string;
  adGroupName: string;
  reason: string;
}

export interface ReallocationPlan {
  allocations: Allocation[];
  /** 实际分配出去的总额。 */
  allocated: number;
  /** 分不出去、留在池里的余额。 */
  remaining: number;
  rejected: RejectedCandidate[];
}

function round(n: number) {
  return Math.max(0, Math.round(n));
}

/**
 * 基准 CPS：账户目标与在投广告组 CPS 中位数取较大者。
 * 只用绝对目标值会导致市场整体成本上行时无人合格、资金全部滞留。
 */
export function benchmarkCps(candidates: ReallocationCandidate[]) {
  const vals = candidates
    .filter((c) => RECEIVABLE_STATUS.includes(c.status) && c.cps > 0)
    .map((c) => c.cps)
    .sort((a, b) => a - b);
  if (vals.length === 0) return TARGET_CPS;
  const mid = Math.floor(vals.length / 2);
  const median =
    vals.length % 2 === 0 ? ((vals[mid - 1]! + vals[mid]!) / 2) : vals[mid]!;
  return Math.max(TARGET_CPS, Number(median.toFixed(2)));
}

function scoreOf(c: ReallocationCandidate, benchmark: number) {
  const winPart = WEIGHT_WIN_RATE * (c.last20ApprovalRate / WIN_RATE_FLOOR);
  const effectiveCps = c.cps > 0 ? c.cps : benchmark;
  const costPart = WEIGHT_COST * (benchmark / effectiveCps);
  return Number((winPart + costPart).toFixed(4));
}

function headroomOf(c: ReallocationCandidate, limits: ReallocationLimits) {
  const byStep = (c.dailyBudget * limits.maxBudgetDeltaPct) / 100;
  const byCap = limits.maxAdGroupDailyBudget - c.dailyBudget;
  return Math.max(0, Math.floor(Math.min(byStep, byCap)));
}

/** 候选筛选：只有"能承接、且承接得起"的广告组才有资格拿钱。 */
export function filterCandidates(
  candidates: ReallocationCandidate[],
  benchmark = benchmarkCps(candidates),
): { eligible: ReallocationCandidate[]; rejected: RejectedCandidate[] } {
  const eligible: ReallocationCandidate[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const c of candidates) {
    const base = { adGroupId: c.id, adGroupName: c.name };
    if (!RECEIVABLE_STATUS.includes(c.status)) {
      rejected.push({ ...base, reason: `状态为 ${c.status}，非投放中` });
      continue;
    }
    if (c.last20ApprovalRate < WIN_RATE_FLOOR) {
      rejected.push({
        ...base,
        reason: `授信通过率 ${(c.last20ApprovalRate * 100).toFixed(1)}% < 承接门槛 ${(WIN_RATE_FLOOR * 100).toFixed(0)}%`,
      });
      continue;
    }
    if (c.cps > benchmark * CPS_TOLERANCE) {
      rejected.push({
        ...base,
        reason: `CPS $${c.cps.toFixed(2)} 高于基准 $${benchmark.toFixed(2)} 的 ${CPS_TOLERANCE}× 容忍线`,
      });
      continue;
    }
    const paceRate = c.dailyBudget > 0 ? c.spentToday / c.dailyBudget : 0;
    if (paceRate < PACE_FLOOR) {
      rejected.push({
        ...base,
        reason: `今日消耗率 ${(paceRate * 100).toFixed(0)}% < ${PACE_FLOOR * 100}%，现有预算尚未花完`,
      });
      continue;
    }
    eligible.push(c);
  }

  return { eligible, rejected };
}

/**
 * 按分数比例把池余额分配给合格广告组，逐个受单次幅度与绝对上限约束；
 * 被截断的余额回流，最多再分配两轮，仍分不掉的留在池里。
 */
export function planReallocation(input: {
  pool: number;
  candidates: ReallocationCandidate[];
  limits: ReallocationLimits;
}): ReallocationPlan {
  const pool = Math.floor(Math.max(0, input.pool));
  const benchmark = benchmarkCps(input.candidates);
  const { eligible, rejected } = filterCandidates(input.candidates, benchmark);

  if (pool <= 0 || eligible.length === 0) {
    return { allocations: [], allocated: 0, remaining: pool, rejected };
  }

  const rows = eligible.map((c) => ({
    c,
    score: scoreOf(c, benchmark),
    headroom: headroomOf(c, input.limits),
    amount: 0,
  }));

  for (const r of rows) {
    if (r.headroom <= 0) {
      rejected.push({
        adGroupId: r.c.id,
        adGroupName: r.c.name,
        reason: `已无加预算空间（当前 $${r.c.dailyBudget.toLocaleString()}，受单次 ${input.limits.maxBudgetDeltaPct}% 与绝对上限约束）`,
      });
    }
  }

  const active = rows.filter((r) => r.headroom > 0);
  let remaining = pool;

  for (let pass = 0; pass < 3 && remaining > 0; pass += 1) {
    const open = active.filter((r) => r.amount < r.headroom);
    const total = open.reduce((s, r) => s + r.score, 0);
    if (open.length === 0 || total <= 0) break;

    const before = remaining;
    for (const r of open) {
      if (remaining <= 0) break;
      const want = round((before * r.score) / total);
      const give = Math.min(want, r.headroom - r.amount, remaining);
      r.amount += give;
      remaining -= give;
    }
    if (remaining === before) break; // 无进展，避免死循环
  }

  const allocations: Allocation[] = active
    .filter((r) => r.amount > 0)
    .map((r) => ({
      adGroupId: r.c.id,
      adGroupName: r.c.name,
      campaignId: r.c.campaignId,
      campaignName: r.c.campaignName,
      fromBudget: r.c.dailyBudget,
      toBudget: r.c.dailyBudget + r.amount,
      amount: r.amount,
      score: r.score,
      headroom: r.headroom,
      rationale: `通过率 ${(r.c.last20ApprovalRate * 100).toFixed(1)}% / CPS $${(r.c.cps > 0 ? r.c.cps : benchmark).toFixed(2)} → 得分 ${r.score.toFixed(2)}（权重 通过率 ${WEIGHT_WIN_RATE} · 成本 ${WEIGHT_COST}）`,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    allocations,
    allocated: allocations.reduce((s, a) => s + a.amount, 0),
    remaining,
    rejected,
  };
}

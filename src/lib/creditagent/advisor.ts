// LLM 分析师的纯函数净化层（零依赖 · 可单测）。
// 模型只是"提出假设"，这里负责把它的输出压回一个受约束的枚举动作集。
// 任何越界、幻觉 id、非法动作都在这里被丢弃或截断，绝不进入执行路径。

export const ADVISOR_ACTIONS = [
  "BUDGET_SHIFT",
  "CREATIVE_PAUSE",
  "CREATIVE_REFRESH",
  "NO_ACTION",
] as const;

export type AdvisorAction = (typeof ADVISOR_ACTIONS)[number];

/** 模型允许提出的预算变动区间（百分比）。超出直接 clamp。 */
export const BUDGET_DELTA_MIN = -40;
export const BUDGET_DELTA_MAX = 30;
/** 单轮最多保留的建议条数。 */
export const MAX_SUGGESTIONS = 5;

export const ADVISOR_METRICS = ["CPL", "ApprovalRate", "CostPerDisbursement", "ROAS"] as const;
export type AdvisorMetric = (typeof ADVISOR_METRICS)[number];

export interface AdvisorSuggestion {
  adGroupId: string;
  action: AdvisorAction;
  /** 仅 BUDGET_SHIFT 有意义，已 clamp 到 [-40, 30]。 */
  budgetDeltaPct: number;
  rationale: string;
  metric: AdvisorMetric;
  currentValue: number;
  thresholdValue: number;
  /** 0-1，已 clamp。 */
  confidence: number;
}

export interface SanitizeResult {
  kept: AdvisorSuggestion[];
  dropped: { index: number; reason: string; raw: unknown }[];
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 把模型的原始输出压成安全的建议列表。
 * knownAdGroupIds 来自当前快照——不在其中的 id 一律判定为幻觉并整条丢弃。
 */
export function sanitizeAdvice(raw: unknown, knownAdGroupIds: string[]): SanitizeResult {
  const known = new Set(knownAdGroupIds);
  const kept: AdvisorSuggestion[] = [];
  const dropped: SanitizeResult["dropped"] = [];

  const list = Array.isArray((raw as { suggestions?: unknown } | null)?.suggestions)
    ? ((raw as { suggestions: unknown[] }).suggestions as unknown[])
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];

  list.forEach((item, index) => {
    if (kept.length >= MAX_SUGGESTIONS) {
      dropped.push({ index, reason: `超出单轮上限 ${MAX_SUGGESTIONS} 条`, raw: item });
      return;
    }
    if (!item || typeof item !== "object") {
      dropped.push({ index, reason: "条目不是对象", raw: item });
      return;
    }
    const r = item as Record<string, unknown>;

    const adGroupId = String(r.adGroupId ?? r.ad_group_id ?? "").trim();
    if (!adGroupId || !known.has(adGroupId)) {
      dropped.push({ index, reason: `广告组 id 不存在于快照：${adGroupId || "(空)"}`, raw: item });
      return;
    }

    const action = String(r.action ?? "").trim() as AdvisorAction;
    if (!ADVISOR_ACTIONS.includes(action)) {
      dropped.push({ index, reason: `动作不在允许枚举内：${action || "(空)"}`, raw: item });
      return;
    }
    if (action === "NO_ACTION") {
      dropped.push({ index, reason: "NO_ACTION 无需生成决策卡", raw: item });
      return;
    }

    const rationale = String(r.rationale ?? "").trim();
    if (rationale.length < 4) {
      dropped.push({ index, reason: "缺少可审计的理由（rationale）", raw: item });
      return;
    }

    if (kept.some((k) => k.adGroupId === adGroupId)) {
      dropped.push({ index, reason: "同一广告组重复建议，只保留第一条", raw: item });
      return;
    }

    const metricRaw = String(r.metric ?? "").trim() as AdvisorMetric;
    const metric: AdvisorMetric = ADVISOR_METRICS.includes(metricRaw)
      ? metricRaw
      : "CostPerDisbursement";

    kept.push({
      adGroupId,
      action,
      budgetDeltaPct:
        action === "BUDGET_SHIFT"
          ? Math.round(clamp(num(r.budgetDeltaPct ?? r.budget_delta_pct), BUDGET_DELTA_MIN, BUDGET_DELTA_MAX))
          : 0,
      rationale: rationale.slice(0, 500),
      metric,
      currentValue: num(r.currentValue ?? r.current_value),
      thresholdValue: num(r.thresholdValue ?? r.threshold_value),
      confidence: clamp(num(r.confidence, 0.5), 0, 1),
    });
  });

  return { kept, dropped };
}

/** BUDGET_SHIFT 建议为 0% 时等同无动作，调用方据此跳过。 */
export function isNoop(s: AdvisorSuggestion) {
  return s.action === "BUDGET_SHIFT" && s.budgetDeltaPct === 0;
}

// 前瞻归因（纯函数 · 零网络 · 可单测）
// 回答三件事：谁贡献了放款（Who）、CPS 为什么变（Why）、接下来会怎样 / 该动哪一刀（What next）。
import { TARGET_CPS } from "./reallocate";

export { TARGET_CPS };

/** 一个周期内某广告组的原始事实。 */
export interface FactorSample {
  spend: number;
  clicks: number;
  leads: number;
  disbursed: number;
  disbursedAmount: number;
}

export interface CpsFactors {
  /** 单次点击成本 = spend / clicks */
  cpc: number;
  /** 线索转化率 = leads / clicks */
  leadCvr: number;
  /** 线索→放款率 = disbursed / leads（含授信通过与提款） */
  disbRate: number;
  /** CPS = cpc / leadCvr / disbRate */
  cps: number;
}

export type CpsFactorKey = "cpc" | "leadCvr" | "disbRate";

export interface CpsContribution {
  key: CpsFactorKey;
  label: string;
  /** 本期 / 上期 的因子比值 */
  ratio: number;
  /** 对 ΔCPS 的美元贡献；正数 = 把 CPS 推高 */
  contribution: number;
  /** 占 |ΔCPS| 的比例 0–1 */
  share: number;
}

export interface CpsDecomposition {
  cur: CpsFactors;
  prior: CpsFactors;
  deltaCps: number;
  parts: CpsContribution[];
  /** 绝对贡献最大的一段 */
  primary: CpsContribution | null;
  /** 人话结论 */
  headline: string;
}

const FACTOR_LABEL: Record<CpsFactorKey, string> = {
  cpc: "流量成本 CPC",
  leadCvr: "线索转化率",
  disbRate: "授信/放款率",
};

export function computeFactors(s: FactorSample): CpsFactors | null {
  if (!(s.spend > 0) || !(s.clicks > 0) || !(s.leads > 0) || !(s.disbursed > 0)) return null;
  const cpc = s.spend / s.clicks;
  const leadCvr = s.leads / s.clicks;
  const disbRate = s.disbursed / s.leads;
  return { cpc, leadCvr, disbRate, cps: cpc / leadCvr / disbRate };
}

/** 对数平均（LMDI-I），保证各段贡献严格加总等于 ΔCPS。 */
function logMean(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  if (Math.abs(a - b) < 1e-9) return a;
  return (a - b) / (Math.log(a) - Math.log(b));
}

/**
 * 杜邦式 CPS 拆解：CPS = CPC ÷ 线索转化率 ÷ 放款率。
 * 用 LMDI 把 ΔCPS 无残差地分给三段。
 */
export function decomposeCps(cur: FactorSample, prior: FactorSample): CpsDecomposition | null {
  const c = computeFactors(cur);
  const p = computeFactors(prior);
  if (!c || !p) return null;

  const L = logMean(c.cps, p.cps);
  const raw: { key: CpsFactorKey; ratio: number; contribution: number }[] = [
    { key: "cpc", ratio: c.cpc / p.cpc, contribution: L * Math.log(c.cpc / p.cpc) },
    { key: "leadCvr", ratio: c.leadCvr / p.leadCvr, contribution: -L * Math.log(c.leadCvr / p.leadCvr) },
    { key: "disbRate", ratio: c.disbRate / p.disbRate, contribution: -L * Math.log(c.disbRate / p.disbRate) },
  ];

  const deltaCps = c.cps - p.cps;
  const absSum = raw.reduce((s, r) => s + Math.abs(r.contribution), 0) || 1;
  const parts: CpsContribution[] = raw.map((r) => ({
    key: r.key,
    label: FACTOR_LABEL[r.key],
    ratio: r.ratio,
    contribution: r.contribution,
    share: Math.abs(r.contribution) / absSum,
  }));

  const primary =
    [...parts].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0] ?? null;

  let headline = "CPS 基本持平，三段因子无显著变化。";
  if (primary && Math.abs(deltaCps) >= 0.01) {
    const dir = deltaCps > 0 ? "上升" : "下降";
    const worse = primary.contribution > 0;
    const cause =
      primary.key === "cpc"
        ? worse
          ? "流量竞价变贵"
          : "流量成本走低"
        : primary.key === "leadCvr"
          ? worse
            ? "落地页/素材的线索转化变差"
            : "线索转化率改善"
          : worse
            ? "风控授信或提款率下滑"
            : "授信/放款率改善";
    headline = `CPS ${dir} $${Math.abs(deltaCps).toFixed(2)}，主因是${cause}（贡献 $${Math.abs(
      primary.contribution,
    ).toFixed(2)}，占 ${(primary.share * 100).toFixed(0)}%）。`;
  }

  return { cur: c, prior: p, deltaCps, parts, primary, headline };
}

// ——— 放款增量归因（量 / 效率 / 结构）———

export interface GrowthEffect {
  key: "volume" | "efficiency" | "mix";
  label: string;
  value: number;
}

export interface GrowthDecomposition {
  delta: number;
  effects: GrowthEffect[];
  headline: string;
  /** 谁贡献了增量，按绝对值倒序 */
  contributors: { id: string; name: string; delta: number }[];
}

export function decomposeGrowth(
  rows: { id: string; name: string; cur: FactorSample; prior: FactorSample }[],
): GrowthDecomposition | null {
  if (rows.length === 0) return null;
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const curAmt = sum((r) => r.cur.disbursedAmount);
  const priAmt = sum((r) => r.prior.disbursedAmount);
  const curLeads = sum((r) => r.cur.leads);
  const priLeads = sum((r) => r.prior.leads);
  if (!(priLeads > 0) || !(curLeads > 0)) return null;

  const priPerLead = priAmt / priLeads;
  const curPerLead = curAmt / curLeads;
  const volume = (curLeads - priLeads) * priPerLead;
  const efficiency = curLeads * (curPerLead - priPerLead);

  // 结构效应：各组线索占比变化 × 各组单线索价值相对整体的偏离
  let mix = 0;
  for (const r of rows) {
    const wCur = r.cur.leads / curLeads;
    const wPri = r.prior.leads / priLeads;
    const vPri = r.prior.leads > 0 ? r.prior.disbursedAmount / r.prior.leads : priPerLead;
    mix += (wCur - wPri) * (vPri - priPerLead) * curLeads;
  }

  const delta = curAmt - priAmt;
  const effects: GrowthEffect[] = [
    { key: "volume", label: "量效应（线索规模）", value: volume },
    { key: "efficiency", label: "效率效应（单线索价值）", value: efficiency - mix },
    { key: "mix", label: "结构效应（预算分布）", value: mix },
  ];
  const top = [...effects].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  const headline =
    Math.abs(delta) < 1
      ? "放款金额与上期基本持平。"
      : `放款金额${delta > 0 ? "增长" : "下滑"} $${Math.abs(delta / 1000).toFixed(1)}k，主要由「${
          top.label
        }」驱动（$${(top.value / 1000).toFixed(1)}k）。`;

  const contributors = rows
    .map((r) => ({ id: r.id, name: r.name, delta: r.cur.disbursedAmount - r.prior.disbursedAmount }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { delta, effects, headline, contributors };
}

// ——— 趋势预测 ———

export interface Forecast {
  slopePerDay: number;
  predicted: number;
  r2: number;
  points: number;
  confidence: "high" | "low";
  horizonDays: number;
}

/** 最小二乘线性外推；样本 <4 或 R² <0.3 判为低置信。 */
export function linearForecast(
  series: { t: number; v: number }[],
  horizonDays: number,
): Forecast | null {
  const pts = series.filter((p) => Number.isFinite(p.v));
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.t, 0) / n;
  const my = pts.reduce((s, p) => s + p.v, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.t - mx) ** 2, 0);
  if (sxx <= 0) return null;
  const sxy = pts.reduce((s, p) => s + (p.t - mx) * (p.v - my), 0);
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const ssTot = pts.reduce((s, p) => s + (p.v - my) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p.v - (intercept + slope * p.t)) ** 2, 0);
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  const lastT = Math.max(...pts.map((p) => p.t));
  const predicted = intercept + slope * (lastT + horizonDays);
  return {
    slopePerDay: slope,
    predicted,
    r2,
    points: n,
    confidence: n >= 5 && r2 >= 0.3 ? "high" : "low",
    horizonDays,
  };
}

/** CPS 触达目标线还有几天（仅在恶化趋势下有意义）。 */
export function daysToBreach(current: number, slopePerDay: number, target = TARGET_CPS): number | null {
  if (!(slopePerDay > 0)) return null;
  if (current >= target) return 0;
  return (target - current) / slopePerDay;
}

// ——— 时滞成熟度 ———

export interface MaturityCurve {
  /** 累积成熟度：index = 天龄，值 = 该天龄下已实现的放款占最终值的比例 */
  cumulative: number[];
  medianDays: number;
  p90Days: number;
  samples: number;
}

export function buildMaturityCurve(lagDays: number[], maxDays = 30): MaturityCurve | null {
  const clean = lagDays.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  if (clean.length < 5) return null;
  const cumulative: number[] = [];
  for (let d = 0; d <= maxDays; d += 1) {
    const c = clean.filter((x) => x <= d).length / clean.length;
    cumulative.push(c);
  }
  const at = (q: number) => clean[Math.min(clean.length - 1, Math.floor(q * clean.length))];
  return { cumulative, medianDays: at(0.5), p90Days: at(0.9), samples: clean.length };
}

export function maturityForAge(curve: MaturityCurve, ageDays: number): number {
  if (ageDays <= 0) return Math.max(curve.cumulative[0], 0.01);
  const idx = Math.min(curve.cumulative.length - 1, Math.floor(ageDays));
  return Math.max(curve.cumulative[idx], 0.01);
}

export interface MaturityAdjustment {
  maturity: number;
  realizedCps: number;
  adjustedCps: number;
  projectedDisbursed: number;
  medianDays: number;
  p90Days: number;
  samples: number;
}

/** 用线索年龄加权的成熟度，把「已实现 CPS」折算成「时滞校正 CPS」。 */
export function adjustForLag(
  curve: MaturityCurve,
  leadAges: number[],
  spend: number,
  realizedDisbursed: number,
): MaturityAdjustment | null {
  if (leadAges.length === 0 || !(spend > 0)) return null;
  const maturity =
    leadAges.reduce((s, age) => s + maturityForAge(curve, age), 0) / leadAges.length;
  const projectedDisbursed = realizedDisbursed / maturity;
  return {
    maturity,
    realizedCps: realizedDisbursed > 0 ? spend / realizedDisbursed : 0,
    adjustedCps: projectedDisbursed > 0 ? spend / projectedDisbursed : 0,
    projectedDisbursed,
    medianDays: curve.medianDays,
    p90Days: curve.p90Days,
    samples: curve.samples,
  };
}

// ——— 处方 ———

export interface Prescription {
  action: "SCALE_UP" | "SCALE_DOWN" | "PAUSE" | "HOLD" | "WATCH";
  label: string;
  deltaPct: number;
  detail: string;
  impact: string;
  confidence: "high" | "low";
}

export function buildPrescription(input: {
  cps: number;
  disbursed: number;
  spend: number;
  forecastCps: number | null;
  slopePerDay: number | null;
  confidence: "high" | "low";
  maxDeltaPct: number;
  target?: number;
}): Prescription {
  const target = input.target ?? TARGET_CPS;
  const cap = Math.max(5, Math.min(input.maxDeltaPct, 50));
  const lowSample = input.disbursed < 5;

  if (lowSample && input.spend < 50) {
    return {
      action: "WATCH",
      label: "观察",
      deltaPct: 0,
      detail: `本期仅 ${input.disbursed} 笔放款、花费 $${Math.round(input.spend)}，样本不足以判定效率。`,
      impact: "此时调预算属于噪声驱动，建议先跑量到 5 笔放款再裁决。",
      confidence: "low",
    };
  }

  const projected = input.forecastCps ?? input.cps;
  const ratio = target > 0 ? projected / target : 1;

  if (input.disbursed === 0 && input.spend >= 50) {
    return {
      action: "PAUSE",
      label: "建议暂停",
      deltaPct: -100,
      detail: `花费 $${Math.round(input.spend)} 但零放款，后端无产出。`,
      impact: `暂停可直接释放约 $${Math.round(input.spend)} 进入当日闲置池。`,
      confidence: lowSample ? "low" : "high",
    };
  }

  if (ratio >= 1.5) {
    const deltaPct = -cap;
    return {
      action: "SCALE_DOWN",
      label: "建议降预算",
      deltaPct,
      detail: `预测 CPS $${projected.toFixed(2)} 约为目标的 ${ratio.toFixed(1)}×。`,
      impact: `按门禁上限下调 ${cap}%，预计每日少花约 $${Math.round(
        (input.spend * cap) / 100,
      )}，同时少约 ${Math.max(1, Math.round(((input.disbursed * cap) / 100) * 0.8))} 笔高价放款。`,
      confidence: input.confidence,
    };
  }

  if (ratio >= 1.1) {
    const deltaPct = -Math.min(cap, 15);
    return {
      action: "SCALE_DOWN",
      label: "小步降预算",
      deltaPct,
      detail:
        input.slopePerDay && input.slopePerDay > 0
          ? `CPS 每日约 +$${input.slopePerDay.toFixed(2)}，预测 ${(ratio * 100 - 100).toFixed(0)}% 高于目标。`
          : `预测 CPS $${projected.toFixed(2)} 高于目标 $${target.toFixed(2)}。`,
      impact: `下调 ${Math.abs(deltaPct)}%，预计每日省约 $${Math.round(
        (input.spend * Math.abs(deltaPct)) / 100,
      )}。`,
      confidence: input.confidence,
    };
  }

  if (ratio <= 0.8) {
    const deltaPct = Math.min(cap, 20);
    return {
      action: "SCALE_UP",
      label: "建议加预算",
      deltaPct,
      detail: `预测 CPS $${projected.toFixed(2)} 仅为目标的 ${ratio.toFixed(2)}×，仍有效率空间。`,
      impact: `在门禁内加 ${deltaPct}%，预计每日多约 ${Math.max(
        1,
        Math.round(((input.disbursed * deltaPct) / 100) * 0.8),
      )} 笔放款。`,
      confidence: input.confidence,
    };
  }

  return {
    action: "HOLD",
    label: "维持",
    deltaPct: 0,
    detail: `预测 CPS $${projected.toFixed(2)} 落在目标带内（±10%）。`,
    impact: "无需调整，继续观察素材疲劳与回传缺口即可。",
    confidence: input.confidence,
  };
}

// ——— 归因装配结果（server 产出 / client 消费）———

export interface AttributionGroup {
  adGroupId: string;
  adGroupName: string;
  campaignName: string;
  channel: string;
  cur: FactorSample;
  prior: FactorSample;
  cps: number;
  priorCps: number;
  decomposition: CpsDecomposition | null;
  forecast: Forecast | null;
  breachInDays: number | null;
  prescription: Prescription;
  series: { day: string; cps: number }[];
}

export interface AttributionBundle {
  available: boolean;
  note: string;
  window: { curFrom: string; curTo: string; priorFrom: string; priorTo: string };
  groups: AttributionGroup[];
  portfolio: {
    decomposition: CpsDecomposition | null;
    growth: GrowthDecomposition | null;
    curCps: number;
    priorCps: number;
    forecastCps: number | null;
  };
  lag: (MaturityAdjustment & { note: string }) | null;
  target: number;
}


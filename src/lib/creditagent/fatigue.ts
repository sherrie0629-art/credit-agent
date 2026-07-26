// 创意疲劳评分引擎 —— 纯函数，前后端共用。

export type FatigueLevel = "HEALTHY" | "WATCH" | "FATIGUED";

export interface CreativeMetricPoint {
  creativeId: string;
  day: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpl: number;
  cps: number;
  frequency: number;
  spend: number;
}

export interface FatigueSignal {
  id: string;
  label: string;
  weight: number;
  hit: boolean;
  detail: string;
}

export interface FatigueResult {
  score: number;
  level: FatigueLevel;
  signals: FatigueSignal[];
  reasoning: string[];
  ctrDecay: number;
  cplLift: number;
  frequency: number;
  days: number;
}

function avg(nums: number[]) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function levelOf(score: number): FatigueLevel {
  if (score >= 70) return "FATIGUED";
  if (score >= 40) return "WATCH";
  return "HEALTHY";
}

export const FATIGUE_LEVEL_LABEL: Record<FatigueLevel, string> = {
  HEALTHY: "健康",
  WATCH: "需观察",
  FATIGUED: "已疲劳",
};

/** metrics 需按日期升序传入。 */
export function computeFatigue(metrics: CreativeMetricPoint[]): FatigueResult {
  if (metrics.length === 0) {
    return {
      score: 0,
      level: "HEALTHY",
      signals: [],
      reasoning: ["暂无投放数据，跳过疲劳判定。"],
      ctrDecay: 1,
      cplLift: 1,
      frequency: 0,
      days: 0,
    };
  }

  const head = metrics.slice(0, 3);
  const tail = metrics.slice(-3);

  const headCtr = avg(head.map((m) => m.ctr)) || 1e-6;
  const tailCtr = avg(tail.map((m) => m.ctr));
  const headCpl = avg(head.map((m) => m.cpl)) || 1e-6;
  const tailCpl = avg(tail.map((m) => m.cpl));
  const frequency = tail.length ? tail[tail.length - 1].frequency : 0;
  const days = metrics.length;

  const ctrDecay = tailCtr / headCtr;
  const cplLift = tailCpl / headCpl;

  const signals: FatigueSignal[] = [
    {
      id: "ctr-decay",
      label: "CTR 衰减",
      weight: 35,
      hit: ctrDecay < 0.7,
      detail: `近 3 日 CTR ${(tailCtr * 100).toFixed(2)}% / 首 3 日 ${(headCtr * 100).toFixed(2)}% = ${ctrDecay.toFixed(2)}（阈值 < 0.70）`,
    },
    {
      id: "frequency",
      label: "频次过载",
      weight: 25,
      hit: frequency >= 3.5,
      detail: `当前人均展示频次 ${frequency.toFixed(2)}（阈值 ≥ 3.50）`,
    },
    {
      id: "cpl-lift",
      label: "CPL 抬升",
      weight: 25,
      hit: cplLift > 1.25,
      detail: `近 3 日 CPL $${tailCpl.toFixed(2)} / 首 3 日 $${headCpl.toFixed(2)} = ${cplLift.toFixed(2)}（阈值 > 1.25）`,
    },
    {
      id: "lifespan",
      label: "素材寿命",
      weight: 15,
      hit: days >= 14,
      detail: `连续投放 ${days} 天（阈值 ≥ 14 天）`,
    },
  ];

  const score = signals.reduce((sum, s) => (s.hit ? sum + s.weight : sum), 0);
  const level = levelOf(score);

  const reasoning = [
    `Creative Agent 巡检素材，读取近 ${days} 天投放指标。`,
    ...signals.map((s) => `${s.hit ? "命中" : "未命中"}「${s.label}」（权重 ${s.weight}）：${s.detail}`),
    `疲劳分 = ${score}/100，判定等级：${FATIGUE_LEVEL_LABEL[level]}。`,
    level === "FATIGUED"
      ? "决策：触发自动迭代，生成合规文案与视觉变体并进入 A/B 赛马。"
      : level === "WATCH"
        ? "决策：暂不换量，保持监控，下一轮巡检复检。"
        : "决策：素材表现健康，维持当前投放。",
  ];

  return { score, level, signals, reasoning, ctrDecay, cplLift, frequency, days };
}

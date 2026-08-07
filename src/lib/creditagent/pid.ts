// 离散 PID：单广告组日预算贴目标 CPS（纯函数 · 零网络 · 可单测）。
// 误差 e = TARGET_CPS - measuredCps：CPS 偏高 → e 为负 → 下调预算；偏低 → 上调。

import { TARGET_CPS } from "./reallocate";

export { TARGET_CPS };

/** 与 sweep 对齐的采样周期（秒）。 */
export const PID_TS_SEC = 900;
/** CPS 死区（美元）：|e| 小于此值不提案。 */
export const PID_DEADZONE = 0.5;
/** 每广告组提案冷却。 */
export const PID_SUGGEST_COOLDOWN_MS = 2 * 3600_000;
/** 近窗最少放款笔数，避免噪声 CPS。 */
export const PID_MIN_DISBURSED = 3;

export interface PidGains {
  kp: number;
  ki: number;
  kd: number;
  /** 积分项 ∑(e·Ts) 的绝对值上限。 */
  integralLimit: number;
}

/** 第一期写死增益；后续可迁 agent_settings。 */
export const DEFAULT_PID_GAINS: PidGains = {
  kp: 100,
  ki: 0.05,
  kd: 40,
  integralLimit: 8_000,
};

export interface PidControllerState {
  integral: number;
  lastError: number;
  lastOutput: number;
  lastCps: number;
}

export interface PidStepInput {
  error: number;
  prev: PidControllerState;
  gains?: PidGains;
  tsSec?: number;
  /** 单次 |ΔB| 上限（美元），通常来自风控单次幅度。 */
  maxStep: number;
  deadzone?: number;
}

export interface PidTerms {
  p: number;
  i: number;
  d: number;
  u: number;
}

export interface PidStepResult {
  deltaBudget: number;
  nextState: PidControllerState;
  terms: PidTerms;
  /** 落入死区时为 true，调用方应跳过提案。 */
  inDeadzone: boolean;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function emptyPidState(cps = 0): PidControllerState {
  return { integral: 0, lastError: 0, lastOutput: 0, lastCps: cps };
}

/**
 * 一步离散位置式 PID。
 * maxStep 必须 ≥ 0；为 0 时 delta 恒为 0。
 */
export function pidStep(input: PidStepInput): PidStepResult {
  const gains = input.gains ?? DEFAULT_PID_GAINS;
  const ts = input.tsSec ?? PID_TS_SEC;
  const deadzone = input.deadzone ?? PID_DEADZONE;
  const maxStep = Math.max(0, Math.floor(input.maxStep));
  const e = Number.isFinite(input.error) ? input.error : 0;

  if (Math.abs(e) < deadzone) {
    return {
      deltaBudget: 0,
      inDeadzone: true,
      terms: { p: 0, i: 0, d: 0, u: 0 },
      nextState: {
        ...input.prev,
        lastError: e,
        lastOutput: 0,
      },
    };
  }

  const p = gains.kp * e;
  const d = gains.kd * ((e - input.prev.lastError) / ts);

  let integral = clamp(input.prev.integral + e * ts, -gains.integralLimit, gains.integralLimit);
  const i = gains.ki * integral;
  const u = p + i + d;
  const rawDelta = Math.round(u);
  const delta = clamp(rawDelta, -maxStep, maxStep);

  // 输出饱和且误差仍推向同侧时，冻结积分，减轻 windup。
  if (delta !== rawDelta) {
    const pushingOut =
      (rawDelta > maxStep && e > 0) || (rawDelta < -maxStep && e < 0);
    if (pushingOut) {
      integral = input.prev.integral;
    }
  }

  return {
    deltaBudget: delta,
    inDeadzone: false,
    terms: { p, i, d, u },
    nextState: {
      integral,
      lastError: e,
      lastOutput: delta,
      lastCps: input.prev.lastCps,
    },
  };
}

/** 由当前预算与风控幅度计算本步 |ΔB| 上限。 */
export function maxStepFromBudget(
  dailyBudget: number,
  maxBudgetDeltaPct: number,
  maxAdGroupDailyBudget: number,
): number {
  const byPct = (Math.max(0, dailyBudget) * maxBudgetDeltaPct) / 100;
  const headroomUp = Math.max(0, maxAdGroupDailyBudget - dailyBudget);
  const byFloor = Math.max(0, dailyBudget);
  // 上调受 headroom 与幅度约束；下调受幅度与当前预算约束。取幅度与「可动空间」的较小者。
  return Math.max(0, Math.floor(Math.min(byPct, Math.max(headroomUp, byFloor))));
}

/** 自检用：若干场景的期望符号（不依赖测试框架）。 */
export function pidSelfCheck(): string[] {
  const errors: string[] = [];
  const prev = emptyPidState(21.4);

  const highCps = pidStep({
    error: TARGET_CPS - 21.4,
    prev,
    maxStep: 500,
  });
  if (!(highCps.deltaBudget < 0)) {
    errors.push(`CPS 偏高应下调预算，got ${highCps.deltaBudget}`);
  }

  const lowCps = pidStep({
    error: TARGET_CPS - 16.5,
    prev: emptyPidState(16.5),
    maxStep: 500,
  });
  if (!(lowCps.deltaBudget > 0)) {
    errors.push(`CPS 偏低应上调预算，got ${lowCps.deltaBudget}`);
  }

  const dead = pidStep({
    error: 0.2,
    prev: emptyPidState(19),
    maxStep: 500,
  });
  if (!dead.inDeadzone || dead.deltaBudget !== 0) {
    errors.push("死区内应跳过");
  }

  return errors;
}

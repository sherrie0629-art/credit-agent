// 参谋调度文案（零依赖 · 可给 UI 用）。
// 动作形状与净化在 ontology/action-schema.ts，不再维护平行字段。

export { MAX_SUGGESTIONS, ADVISOR_METRICS, type AdvisorMetric } from "./ontology/action-schema";

/** 与 advisor.server ADVISOR_MIN_INTERVAL_MS 对齐（小时）。 */
export const ADVISOR_INTERVAL_HOURS = 3;

export type AdvisorScheduleStatus = {
  readable: boolean;
  intervalHours: number;
  /** ISO；无可读日志时为 null */
  lastRunAt: string | null;
  killSwitch: boolean;
};

/** 根据上次运行时间与当前时刻生成状态文案（用户可见：AI 参谋）。 */
export function formatAdvisorScheduleLabel(
  status: AdvisorScheduleStatus,
  nowMs = Date.now(),
): string {
  if (status.killSwitch) return "全局熔断中：AI 参谋自动提案已暂停";
  if (!status.readable) {
    return `AI 参谋随扫仓自动提案（约每 ${status.intervalHours} 小时）`;
  }
  if (!status.lastRunAt) {
    return "下次自动提案：即将在扫仓窗口运行";
  }
  const last = new Date(status.lastRunAt).getTime();
  if (!Number.isFinite(last)) {
    return `AI 参谋随扫仓自动提案（约每 ${status.intervalHours} 小时）`;
  }
  const next = last + status.intervalHours * 3_600_000;
  const msUntil = next - nowMs;
  if (msUntil <= 0) return "下次自动提案：即将在扫仓窗口运行";
  const hours = msUntil / 3_600_000;
  if (hours < 1) return "下次自动提案约不到 1 小时后";
  return `下次自动提案约 ${Math.ceil(hours)} 小时后`;
}

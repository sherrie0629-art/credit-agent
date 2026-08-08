// 经营复盘 / 高管周报：纯函数（零网络 · 可单测）。
import { TARGET_CPS } from "./reallocate";
import type { Channel, ChannelBreakdownRow, FeedbackHealth } from "./types";

export { TARGET_CPS };

export const REPORT_TZ = "America/New_York";

export type WeekKey = "this" | "last";

export interface PeriodWindow {
  week: WeekKey;
  fromIso: string;
  toIso: string;
  /** 人类可读区间，如 2026-08-03 ~ 2026-08-08 */
  label: string;
}

export interface ChannelPeriodFacts {
  channel: Channel;
  leads: number;
  approved: number;
  disbursedCount: number;
  disbursedAmount: number;
  /** Snapshot today's spend for this channel — not true windowed spend. */
  spendSnapshotToday: number;
  cps: number;
  approvalRate: number;
}

export interface PeriodFacts {
  window: PeriodWindow;
  leads: number;
  approved: number;
  disbursedCount: number;
  disbursedAmount: number;
  spendSnapshotToday: number;
  cps: number;
  approvalRate: number;
  /** Spend is snapshot-today; conversions are true window. */
  spendNote: string;
  byChannel: ChannelPeriodFacts[];
}

export interface ExecReportKpi {
  key: string;
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
}

export interface ExecReportChannelRow {
  channel: Channel;
  spend: number;
  leads: number;
  disbursedCount: number;
  disbursedAmount: number;
  cps: number;
  approvalRate: number;
  feedbackSuccessRate: number;
  feedbackGapRate: number;
}

export interface ExecReportAppendixGroup {
  id: string;
  name: string;
  channel: string;
  cps: number;
  spend: number;
  disbursedCount: number;
}

export interface ExecReport {
  generatedAt: string;
  window: PeriodWindow;
  bullets: string[];
  kpis: ExecReportKpi[];
  channels: ExecReportChannelRow[];
  appendix: {
    topByCps: ExecReportAppendixGroup[];
    bottomByCps: ExecReportAppendixGroup[];
    decisionCount: number;
    includeAppendix: boolean;
  };
  spendNote: string;
}

function ymdInTz(d: Date, timeZone = REPORT_TZ): { y: number; m: number; day: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    day: Number(get("day")),
    weekday: get("weekday"),
  };
}

/** UTC instant when `timeZone` local clock shows y-m-d 00:00:00 (binary search). */
function zonedDayStartUtc(y: number, m: number, day: number, timeZone = REPORT_TZ): Date {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let lo = Date.UTC(y, m - 1, day - 1, 0, 0, 0);
  let hi = Date.UTC(y, m - 1, day + 1, 12, 0, 0);
  const target = { y, m, day };
  while (hi - lo > 500) {
    const mid = Math.floor((lo + hi) / 2);
    const parts = dtf.formatToParts(new Date(mid));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const py = get("year");
    const pm = get("month");
    const pd = get("day");
    if (py < target.y || (py === target.y && pm < target.m) || (py === target.y && pm === target.m && pd < target.day)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return new Date(hi);
}

function addCalendarDays(y: number, m: number, day: number, delta: number): { y: number; m: number; day: number } {
  const dt = new Date(Date.UTC(y, m - 1, day + delta));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatYmd(y: number, m: number, day: number) {
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

/** Monday 00:00 → end (exclusive) for this/last week in REPORT_TZ. */
export function weekWindow(week: WeekKey, now = new Date()): PeriodWindow {
  const { y, m, day, weekday } = ymdInTz(now);
  const weekdayIndex: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const fromMonday = weekdayIndex[weekday] ?? 0;
  let monday = addCalendarDays(y, m, day, -fromMonday);
  if (week === "last") {
    monday = addCalendarDays(monday.y, monday.m, monday.day, -7);
  }
  const from = zonedDayStartUtc(monday.y, monday.m, monday.day);
  let to: Date;
  let endLabel: string;
  if (week === "this") {
    to = now;
    endLabel = formatYmd(y, m, day);
  } else {
    const nextMonday = addCalendarDays(monday.y, monday.m, monday.day, 7);
    to = zonedDayStartUtc(nextMonday.y, nextMonday.m, nextMonday.day);
    const sunday = addCalendarDays(monday.y, monday.m, monday.day, 6);
    endLabel = formatYmd(sunday.y, sunday.m, sunday.day);
  }
  const startLabel = formatYmd(monday.y, monday.m, monday.day);
  return {
    week,
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    label: `${startLabel} ~ ${endLabel} (${REPORT_TZ})`,
  };
}

export function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) {
    if (!Number.isFinite(current) || current === 0) return 0;
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatDelta(delta: number | null): string {
  if (delta === null) return "—";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

export function computeCps(spend: number, disbursedCount: number): number {
  if (!(disbursedCount > 0)) return 0;
  return spend / disbursedCount;
}

export function computeApprovalRate(leads: number, approved: number): number {
  if (!(leads > 0)) return 0;
  return approved / leads;
}

/** Rule-based ops insights (no LLM). */
export function buildOpsInsights(input: {
  period: PeriodFacts;
  prior: PeriodFacts | null;
  feedback: FeedbackHealth[];
  channelBreakdown: ChannelBreakdownRow[];
}): string[] {
  const lines: string[] = [];
  const { period, prior, feedback } = input;
  const cpsTone = period.cps > 0 && period.cps > TARGET_CPS ? "高于" : "低于或接近";
  if (period.disbursedCount > 0) {
    lines.push(
      `本期综合 CPS $${period.cps.toFixed(2)}，${cpsTone}目标 $${TARGET_CPS.toFixed(2)}（${period.window.label}）。`,
    );
  } else {
    lines.push(`本期窗口内尚无放款事件，CPS 暂不可比（目标 $${TARGET_CPS.toFixed(2)}）。`);
  }

  if (prior) {
    const dAmt = pctDelta(period.disbursedAmount, prior.disbursedAmount);
    const dLeads = pctDelta(period.leads, prior.leads);
    lines.push(
      `相对上周：放款金额 ${formatDelta(dAmt)}，线索 ${formatDelta(dLeads)}（转化按事件发生时间；花费见口径说明）。`,
    );
  }

  const badFb = feedback.find((h) => h.successRate < 0.9 || h.gapRate > 0.1);
  if (badFb) {
    lines.push(
      `${badFb.channel} 回传成功率 ${(badFb.successRate * 100).toFixed(1)}%、放款缺口 ${(badFb.gapRate * 100).toFixed(0)}%，平台侧 CPS 可能被低估，复盘时请结合回传模块。`,
    );
  } else if (feedback.length) {
    lines.push("各渠道回传成功率与放款缺口处于健康区间，后端 CPS 可信度较高。");
  }

  // Channel ROAS-style hint from breakdown if Meta CPS worse
  const google = period.byChannel.find((c) => c.channel === "Google");
  const meta = period.byChannel.find((c) => c.channel === "Meta");
  if (google && meta && meta.disbursedCount > 0 && google.disbursedCount > 0 && meta.cps > google.cps * 1.15) {
    lines.push(
      `Meta 本期 CPS $${meta.cps.toFixed(2)} 明显高于 Google $${google.cps.toFixed(2)}，前端量与后端放款可能脱节。`,
    );
  }

  return lines.slice(0, 3);
}

export function buildExecReport(input: {
  period: PeriodFacts;
  prior: PeriodFacts | null;
  feedback: FeedbackHealth[];
  adGroups: { id: string; name: string; channel: string; cps: number; spentToday: number; disbursedCount: number }[];
  decisionCount: number;
  killSwitch?: boolean;
  includeAppendix?: boolean;
}): ExecReport {
  const { period, prior, feedback } = input;
  const bullets = buildOpsInsights({
    period,
    prior,
    feedback,
    channelBreakdown: [],
  });

  if (input.killSwitch) {
    bullets.unshift("全局熔断已开启：自动写入冻结，本周以人工操作为主。");
    while (bullets.length > 3) bullets.pop();
  }

  const cpsDelta = prior ? pctDelta(period.cps, prior.cps) : null;
  const spendDelta = prior ? pctDelta(period.spendSnapshotToday, prior.spendSnapshotToday) : null;
  const disbDelta = prior ? pctDelta(period.disbursedAmount, prior.disbursedAmount) : null;

  const kpis: ExecReportKpi[] = [
    {
      key: "spend",
      label: "广告花费（当日快照）",
      value: `$${Math.round(period.spendSnapshotToday).toLocaleString()}`,
      hint: prior ? `较上周快照 ${formatDelta(spendDelta)}` : period.spendNote,
      tone: "neutral",
    },
    {
      key: "leads",
      label: "线索",
      value: period.leads.toLocaleString(),
      hint: prior ? `环比 ${formatDelta(pctDelta(period.leads, prior.leads))}` : undefined,
      tone: "neutral",
    },
    {
      key: "approved",
      label: "授信通过",
      value: period.approved.toLocaleString(),
      hint: `通过率 ${(period.approvalRate * 100).toFixed(1)}%`,
      tone: period.approvalRate > 0 && period.approvalRate < 0.1 ? "bad" : "ok",
    },
    {
      key: "disbursedCount",
      label: "放款笔数",
      value: period.disbursedCount.toLocaleString(),
      hint: prior ? `环比 ${formatDelta(pctDelta(period.disbursedCount, prior.disbursedCount))}` : undefined,
      tone: "neutral",
    },
    {
      key: "disbursedAmount",
      label: "放款金额",
      value: `$${Math.round(period.disbursedAmount).toLocaleString()}`,
      hint: prior ? `环比 ${formatDelta(disbDelta)}` : undefined,
      tone: "ok",
    },
    {
      key: "cps",
      label: "综合 CPS",
      value: period.disbursedCount > 0 ? `$${period.cps.toFixed(2)}` : "—",
      hint: `目标 $${TARGET_CPS.toFixed(2)}${prior ? ` · 环比 ${formatDelta(cpsDelta)}` : ""}`,
      tone:
        period.disbursedCount === 0 ? "neutral" : period.cps > TARGET_CPS ? "bad" : "ok",
    },
  ];

  const fbByChannel = new Map(feedback.map((f) => [f.channel, f]));
  const channels: ExecReportChannelRow[] = (["Google", "Meta"] as Channel[]).map((channel) => {
    const c = period.byChannel.find((x) => x.channel === channel);
    const fb = fbByChannel.get(channel);
    return {
      channel,
      spend: c?.spendSnapshotToday ?? 0,
      leads: c?.leads ?? 0,
      disbursedCount: c?.disbursedCount ?? 0,
      disbursedAmount: c?.disbursedAmount ?? 0,
      cps: c?.cps ?? 0,
      approvalRate: c?.approvalRate ?? 0,
      feedbackSuccessRate: fb?.successRate ?? 0,
      feedbackGapRate: fb?.gapRate ?? 0,
    };
  });

  const ranked = [...input.adGroups]
    .filter((g) => g.disbursedCount > 0 || g.spentToday > 0)
    .sort((a, b) => a.cps - b.cps);
  const withCps = ranked.filter((g) => g.cps > 0);
  const topByCps = withCps.slice(0, 3).map((g) => ({
    id: g.id,
    name: g.name,
    channel: g.channel,
    cps: g.cps,
    spend: g.spentToday,
    disbursedCount: g.disbursedCount,
  }));
  const bottomByCps = withCps
    .slice(-3)
    .reverse()
    .map((g) => ({
      id: g.id,
      name: g.name,
      channel: g.channel,
      cps: g.cps,
      spend: g.spentToday,
      disbursedCount: g.disbursedCount,
    }));

  return {
    generatedAt: new Date().toISOString(),
    window: period.window,
    bullets,
    kpis,
    channels,
    appendix: {
      topByCps,
      bottomByCps,
      decisionCount: input.decisionCount,
      includeAppendix: input.includeAppendix ?? true,
    },
    spendNote: period.spendNote,
  };
}

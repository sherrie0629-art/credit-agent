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
  /** 兼容：经营简报压成的短句（打印/复制） */
  bullets: string[];
  /** CEO/COO 经营简报（结论 → 为何重要 → 动作 → 利害） */
  decisionBrief: DecisionBriefItem[];
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

export type InsightConfidence = "high" | "low";

/** 面向 CEO/COO：不复读 KPI 卡，给可决策结论。 */
export interface DecisionBriefItem {
  id: string;
  conclusion: string;
  why: string;
  action: string;
  stakes: string;
  confidence: InsightConfidence;
  confidenceNote?: string;
}

export type OpsDiagnosticSeverity = "info" | "warn" | "critical";

/** 面向投放/运营：诊断细节与排障线索。 */
export interface OpsDiagnosticItem {
  id: string;
  title: string;
  detail: string;
  severity: OpsDiagnosticSeverity;
}

export interface AnalyticsBrief {
  decisionBrief: DecisionBriefItem[];
  opsDiagnostics: OpsDiagnosticItem[];
  /** 简报压平为 1–3 句，供旧 UI / 周报列表 */
  bullets: string[];
}

export interface AdGroupInsightRow {
  id: string;
  name: string;
  channel: string;
  cps: number;
  spentToday: number;
  disbursedCount: number;
  status?: string;
}

const MIN_DISBURSED_HIGH_CONF = 10;
const MIN_WINDOW_DAYS_HIGH_CONF = 3;

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

function windowDaySpan(window: PeriodWindow): number {
  const ms = new Date(window.toIso).getTime() - new Date(window.fromIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, ms / (24 * 3600 * 1000));
}

function assessConfidence(period: PeriodFacts): {
  confidence: InsightConfidence;
  confidenceNote?: string;
} {
  const days = windowDaySpan(period.window);
  const reasons: string[] = [];
  if (days < MIN_WINDOW_DAYS_HIGH_CONF) {
    reasons.push(`窗口仅约 ${days.toFixed(1)} 天`);
  }
  if (period.disbursedCount < MIN_DISBURSED_HIGH_CONF) {
    reasons.push(`放款仅 ${period.disbursedCount} 笔`);
  }
  if (reasons.length) {
    return {
      confidence: "low",
      confidenceNote: `${reasons.join("，")}，样本不足，结论仅供方向参考`,
    };
  }
  return { confidence: "high" };
}

function flattenBriefItem(item: DecisionBriefItem): string {
  const conf =
    item.confidence === "low" && item.confidenceNote ? `〔${item.confidenceNote}〕` : "";
  return `${item.conclusion} ${item.why} → ${item.action}（${item.stakes}）${conf}`.replace(/\s+/g, " ").trim();
}

/**
 * 经营简报 + 运营诊断（纯规则、无 LLM）。
 * - decisionBrief：给 CEO/COO，不复读 KPI 卡上的裸数字
 * - opsDiagnostics：给投放同学，含回传口径、组集中度等排障信息
 */
export function buildAnalyticsBrief(input: {
  period: PeriodFacts;
  prior: PeriodFacts | null;
  feedback: FeedbackHealth[];
  channelBreakdown?: ChannelBreakdownRow[];
  adGroups?: AdGroupInsightRow[];
  pendingDecisionCount?: number;
  pendingActionableCount?: number;
  killSwitch?: boolean;
}): AnalyticsBrief {
  const { period, prior, feedback, killSwitch } = input;
  const adGroups = input.adGroups ?? [];
  const pendingCount = input.pendingDecisionCount ?? 0;
  const pendingActionable = input.pendingActionableCount ?? pendingCount;
  const conf = assessConfidence(period);
  const decisionBrief: DecisionBriefItem[] = [];
  const opsDiagnostics: OpsDiagnosticItem[] = [];

  if (killSwitch) {
    decisionBrief.push({
      id: "kill-switch",
      conclusion: "全局熔断已开启：自动化写入与外推冻结。",
      why: "Agent 不会自动砍预算或暂停广告组，效率问题只能靠人工处理。",
      action: "确认是否仍需熔断；若事故已过，切回风控优先并优先处理待审队列。",
      stakes: "熔断期间 CPS 恶化不会被系统自动止血。",
      confidence: "high",
    });
  }

  // —— 量涨 + 效率崩（合成，不单复读 CPS）——
  if (period.disbursedCount > 0 && period.cps > TARGET_CPS) {
    const mult = period.cps / TARGET_CPS;
    const overPerLoan = period.cps - TARGET_CPS;
    const dAmt = prior ? pctDelta(period.disbursedAmount, prior.disbursedAmount) : null;
    const dLeads = prior ? pctDelta(period.leads, prior.leads) : null;
    const volumeGrowing =
      (dAmt != null && dAmt > 5) || (dLeads != null && dLeads > 5);
    const volumeShrinking =
      (dAmt != null && dAmt < -5) || (dLeads != null && dLeads < -5);

    let conclusion: string;
    if (volumeGrowing) {
      conclusion = `量在涨但效率崩：相对目标 CPS，成本约 ${mult.toFixed(1)}×，却仍在扩量。`;
    } else if (volumeShrinking) {
      conclusion = `量在收缩且 CPS 仍约目标的 ${mult.toFixed(1)}×，属于「又贵又没量」。`;
    } else {
      conclusion = `后端获客成本约目标的 ${mult.toFixed(1)}×，当前投放未站在可接受效率区间。`;
    }

    const whyParts: string[] = [
      `每笔放款相对目标约多花 $${overPerLoan.toFixed(0)}（花费为当日快照口径，作量级参考）。`,
    ];
    if (prior && (dAmt != null || dLeads != null)) {
      whyParts.push(
        `环比：放款金额 ${formatDelta(dAmt)}、线索 ${formatDelta(dLeads)}。`,
      );
    }

    decisionBrief.push({
      id: "efficiency-vs-volume",
      conclusion,
      why: whyParts.join(" "),
      action:
        pendingActionable > 0
          ? `优先审批指挥中心 ${pendingActionable} 张暂停/降预算类待审卡，再谈扩量。`
          : "先暂停或大幅下调明显高于目标 CPS 的广告组，再观察 24–48h。",
      stakes: `按本期 CPS 粗算，相对目标每笔多耗约 $${overPerLoan.toFixed(0)}；拖越久，无效花费越大。`,
      ...conf,
    });
  } else if (period.disbursedCount === 0) {
    decisionBrief.push({
      id: "no-disbursement",
      conclusion: "本窗口尚无放款，无法用 CPS 做效率裁决。",
      why: "只有线索/花费没有后端结果时，扩量决策缺少北极星约束。",
      action: "核对放款事件接入与归因窗口；有放款前避免 FULL_AUTO 大幅加预算。",
      stakes: "在盲区加预算，平台会按前端转化继续买贵量。",
      ...conf,
    });
  } else if (period.cps > 0 && period.cps <= TARGET_CPS && prior) {
    const dAmt = pctDelta(period.disbursedAmount, prior.disbursedAmount);
    if (dAmt != null && dAmt < -10) {
      decisionBrief.push({
        id: "efficient-but-shrinking",
        conclusion: "效率达标但放款金额在下滑。",
        why: `CPS 处于目标内，但放款金额环比 ${formatDelta(dAmt)}。`,
        action: "在门禁内对高胜率组小步加预算，或从闲置池拨付；避免一刀切砍量。",
        stakes: "守住 CPS 的同时可能丢份额，需明确「保效率还是保规模」。",
        ...conf,
      });
    }
  }

  // —— 回传缺口（经营语言）——
  const badFb = feedback.find((h) => h.successRate < 0.9 || h.gapRate > 0.1);
  if (badFb) {
    const gapPct = Math.round(badFb.gapRate * 100);
    const seenPct = Math.max(0, 100 - gapPct);
    decisionBrief.push({
      id: "feedback-gap",
      conclusion: `${badFb.channel} 回传「上传成功」≠ 平台学到了真实放款。`,
      why: `放款缺口约 ${gapPct}%：大约每 10 笔放款只有约 ${Math.round(seenPct / 10)} 笔进入平台优化信号，智能出价会把贵流量当便宜量继续买。`,
      action:
        gapPct >= 40
          ? `缺口未降到 20% 以下前，勿对 ${badFb.channel} 开 FULL_AUTO 扩量；先修离线转化回传模块。`
          : `在回传模块核对 ${badFb.channel} 事件映射与 lookback，把缺口压到 20% 内再放量。`,
      stakes: "平台侧 CPS 会被系统性低估，Agent 与平台两边都会误判「还能买」。",
      confidence: conf.confidence,
      confidenceNote: conf.confidenceNote,
    });

    opsDiagnostics.push({
      id: "feedback-gap-ops",
      title: `${badFb.channel} 回传健康度异常`,
      detail: `上传成功率 ${(badFb.successRate * 100).toFixed(1)}%，放款缺口 ${gapPct}%。成功率高只说明队列投递成功，不代表平台收到了全部放款。`,
      severity: gapPct >= 40 ? "critical" : "warn",
    });
  } else if (feedback.length) {
    opsDiagnostics.push({
      id: "feedback-ok",
      title: "回传缺口处于健康区间",
      detail: "各渠道成功率与放款缺口正常，后端 CPS 可作为投放决策主依据。",
      severity: "info",
    });
  }

  // —— 待审队列挂钩 ——
  if (pendingCount > 0 && !killSwitch) {
    decisionBrief.push({
      id: "pending-queue",
      conclusion: `Agent 已备好 ${pendingCount} 张待审决策，经营动作卡在审批，不在「缺分析」。`,
      why: "规则/PID/再分配/分析师建议只进队列；不批准就不会改预算或暂停。",
      action: "打开决策指挥中心，按「暂停/降预算 → 再分配拨付」顺序批完高优先级卡。",
      stakes:
        pendingActionable > 0
          ? `其中约 ${pendingActionable} 张直接动预算或启停，拖延等于继续按旧结构烧钱。`
          : "队列空转会让扫仓与顾问产出无法落地。",
      confidence: "high",
    });
  }

  // —— 组级浪费集中度 ——
  const spenders = [...adGroups]
    .filter((g) => g.spentToday > 0)
    .sort((a, b) => b.spentToday - a.spentToday);
  const totalSpend = spenders.reduce((s, g) => s + g.spentToday, 0);
  const wasteCandidates = spenders.filter(
    (g) =>
      (g.disbursedCount > 0 && g.cps > TARGET_CPS * 1.5) ||
      (g.disbursedCount === 0 && g.spentToday >= 30),
  );
  const topWaste = wasteCandidates.slice(0, 3);
  const wasteSpend = topWaste.reduce((s, g) => s + g.spentToday, 0);
  if (topWaste.length >= 1 && totalSpend > 0 && wasteSpend / totalSpend >= 0.25) {
    const names = topWaste.map((g) => `「${g.name}」`).join("、");
    const share = Math.round((wasteSpend / totalSpend) * 100);
    decisionBrief.push({
      id: "waste-concentration",
      conclusion: `无效花费高度集中：${topWaste.length} 个组约占当日花费快照 ${share}%。`,
      why: `主要落在 ${names}（高 CPS 或有花费无放款）。`,
      action: "对这些组优先暂停或砍预算；释放额进入当日闲置池后再拨高胜率组。",
      stakes: `集中处理这 ${topWaste.length} 个组，比平均降预算更能止血。`,
      ...conf,
    });
    opsDiagnostics.push({
      id: "waste-groups",
      title: "高耗低效广告组",
      detail: topWaste
        .map(
          (g) =>
            `${g.name}（${g.channel}）花费 $${Math.round(g.spentToday)} · CPS ${
              g.disbursedCount > 0 ? `$${g.cps.toFixed(2)}` : "无放款"
            }`,
        )
        .join("；"),
      severity: share >= 40 ? "critical" : "warn",
    });
  }

  // —— 渠道差（诊断为主；简报仅在落差大时保留一条）——
  const google = period.byChannel.find((c) => c.channel === "Google");
  const meta = period.byChannel.find((c) => c.channel === "Meta");
  if (
    google &&
    meta &&
    meta.disbursedCount > 0 &&
    google.disbursedCount > 0 &&
    meta.cps > google.cps * 1.15
  ) {
    opsDiagnostics.push({
      id: "channel-cps-gap",
      title: "Meta CPS 明显高于 Google",
      detail: `Meta $${meta.cps.toFixed(2)} vs Google $${google.cps.toFixed(2)}。先查 Meta 回传缺口与素材/受众质量，再决定是否继续加 Meta 预算。`,
      severity: meta.cps > google.cps * 1.5 ? "critical" : "warn",
    });
    if (decisionBrief.length < 3) {
      decisionBrief.push({
        id: "channel-mix",
        conclusion: "渠道效率分化：Meta 后端 CPS 明显贵于 Google。",
        why: `同窗口 Meta $${meta.cps.toFixed(2)} vs Google $${google.cps.toFixed(2)}，前端量不能代表后端放款质量。`,
        action: "增量预算优先倾向 Google；Meta 先修回传与创意，再谈加码。",
        stakes: "继续按「两渠道平均」加预算，会把钱打进更贵的一侧。",
        ...conf,
      });
    }
  }

  // 简报条数控制：优先保留 kill / efficiency / feedback / pending / waste
  const priority = [
    "kill-switch",
    "efficiency-vs-volume",
    "no-disbursement",
    "feedback-gap",
    "pending-queue",
    "waste-concentration",
    "efficient-but-shrinking",
    "channel-mix",
  ];
  decisionBrief.sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id));
  const briefTrimmed = decisionBrief.slice(0, 4);
  const bullets = briefTrimmed.map(flattenBriefItem).slice(0, 3);

  return {
    decisionBrief: briefTrimmed,
    opsDiagnostics: opsDiagnostics.slice(0, 6),
    bullets,
  };
}

/** @deprecated 使用 buildAnalyticsBrief；保留作薄封装。 */
export function buildOpsInsights(input: {
  period: PeriodFacts;
  prior: PeriodFacts | null;
  feedback: FeedbackHealth[];
  channelBreakdown: ChannelBreakdownRow[];
  adGroups?: AdGroupInsightRow[];
  pendingDecisionCount?: number;
  pendingActionableCount?: number;
  killSwitch?: boolean;
}): string[] {
  return buildAnalyticsBrief(input).bullets;
}

export function buildExecReport(input: {
  period: PeriodFacts;
  prior: PeriodFacts | null;
  feedback: FeedbackHealth[];
  adGroups: { id: string; name: string; channel: string; cps: number; spentToday: number; disbursedCount: number }[];
  decisionCount: number;
  pendingDecisionCount?: number;
  pendingActionableCount?: number;
  killSwitch?: boolean;
  includeAppendix?: boolean;
}): ExecReport {
  const { period, prior, feedback } = input;
  const brief = buildAnalyticsBrief({
    period,
    prior,
    feedback,
    channelBreakdown: [],
    adGroups: input.adGroups,
    pendingDecisionCount: input.pendingDecisionCount,
    pendingActionableCount: input.pendingActionableCount,
    killSwitch: input.killSwitch,
  });
  const bullets = brief.bullets;
  const decisionBrief = brief.decisionBrief;

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
    decisionBrief,
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

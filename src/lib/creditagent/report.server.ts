// 经营复盘 / 高管周报：周期事实拉取（server-only）。
import { getSnapshot } from "./agent.server";
import {
  buildExecReport,
  computeApprovalRate,
  computeCps,
  weekWindow,
  type ChannelPeriodFacts,
  type PeriodFacts,
  type WeekKey,
} from "./report";
import type { AgentSnapshot, Channel } from "./types";

type Row = Record<string, any>;

/** Same read path as the rest of the dashboard: admin in Cloud, publishable locally. */
async function db() {
  const { getReadClient } = await import("./read-client.server");
  return getReadClient();
}

const SPEND_NOTE =
  "花费 = 广告组 spent_today 快照合计（非自然周真窗口）；线索/授信/放款 = 选定周期内 lead_events / leads 真窗口。";

const SNAPSHOT_FALLBACK_NOTE =
  "花费 = 广告组 spent_today 快照；线索/授信/放款 = 由 channel_breakdown（CPS/授信率/放款额）反推的模拟周期，用于本地演示上下游漏斗（非 lead_events 真窗口）。";

/** Approx. share of approved leads that reach disbursement in demo funnel (312/469). */
const DEMO_DISBURSE_OF_APPROVED = 312 / 469;

function emptyChannel(channel: Channel): ChannelPeriodFacts {
  return {
    channel,
    leads: 0,
    approved: 0,
    disbursedCount: 0,
    disbursedAmount: 0,
    spendSnapshotToday: 0,
    cps: 0,
    approvalRate: 0,
  };
}

function spendByChannel(snapshot: AgentSnapshot, channel: Channel) {
  return snapshot.adGroups.filter((g) => g.channel === channel).reduce((s, g) => s + g.spentToday, 0);
}

function conversionTotals(byChannel: Map<Channel, ChannelPeriodFacts>) {
  const rows = [...byChannel.values()];
  return {
    leads: rows.reduce((s, c) => s + c.leads, 0),
    approved: rows.reduce((s, c) => s + c.approved, 0),
    disbursedCount: rows.reduce((s, c) => s + c.disbursedCount, 0),
  };
}

/**
 * When leads/lead_events are empty (local RLS / no seed), derive a coherent funnel from
 * channel_breakdown: spend→CPS→放款笔数→授信→线索，保证 leads ≥ approved ≥ disbursed.
 */
function synthesizeFromBreakdown(
  snapshot: AgentSnapshot,
  scale = 1,
): Map<Channel, ChannelPeriodFacts> {
  const byChannel = new Map<Channel, ChannelPeriodFacts>([
    ["Google", emptyChannel("Google")],
    ["Meta", emptyChannel("Meta")],
  ]);

  for (const row of snapshot.channelBreakdown) {
    const ch = (String(row.channel).toLowerCase().includes("meta") ? "Meta" : "Google") as Channel;
    const target = byChannel.get(ch)!;
    const spend = Number(row.spend ?? 0) * scale;
    const cps = Number(row.cps ?? 0);
    const approval = Math.min(Math.max(Number(row.approval ?? 0), 0), 1);
    const disbursedAmount = Number(row.disbursed ?? 0) * scale;

    let disbursedCount =
      row.disbursedCount != null && row.disbursedCount > 0
        ? Math.round(row.disbursedCount * scale)
        : cps > 0
          ? Math.max(0, Math.round(spend / cps))
          : 0;
    let approved = Math.max(
      disbursedCount,
      DEMO_DISBURSE_OF_APPROVED > 0
        ? Math.round(disbursedCount / DEMO_DISBURSE_OF_APPROVED)
        : disbursedCount,
    );
    let leads =
      row.leads != null && row.leads > 0
        ? Math.round(row.leads * scale)
        : approval > 0
          ? Math.max(approved, Math.round(approved / approval))
          : Math.max(approved, disbursedCount);

    // Monotonic funnel
    if (approved > leads) leads = approved;
    if (disbursedCount > approved) {
      approved = disbursedCount;
      if (approved > leads) leads = approved;
    }

    target.leads += leads;
    target.approved += approved;
    target.disbursedCount += disbursedCount;
    target.disbursedAmount += disbursedAmount;
  }

  return byChannel;
}

function assemblePeriodFacts(
  window: PeriodFacts["window"],
  byChannel: Map<Channel, ChannelPeriodFacts>,
  snapshot: AgentSnapshot,
  spendNote = SPEND_NOTE,
): PeriodFacts {
  for (const ch of ["Google", "Meta"] as Channel[]) {
    const row = byChannel.get(ch)!;
    row.spendSnapshotToday = spendByChannel(snapshot, ch);
    row.cps = computeCps(row.spendSnapshotToday, row.disbursedCount);
    row.approvalRate = computeApprovalRate(row.leads, row.approved);
  }

  const channels = [...byChannel.values()];
  const leadsTotal = channels.reduce((s, c) => s + c.leads, 0);
  const approvedTotal = channels.reduce((s, c) => s + c.approved, 0);
  const disbursedCount = channels.reduce((s, c) => s + c.disbursedCount, 0);
  const disbursedAmount = channels.reduce((s, c) => s + c.disbursedAmount, 0);
  const spendSnapshotToday = channels.reduce((s, c) => s + c.spendSnapshotToday, 0);

  return {
    window,
    leads: leadsTotal,
    approved: approvedTotal,
    disbursedCount,
    disbursedAmount,
    spendSnapshotToday,
    cps: computeCps(spendSnapshotToday, disbursedCount),
    approvalRate: computeApprovalRate(leadsTotal, approvedTotal),
    spendNote,
    byChannel: channels,
  };
}

async function loadConversionByChannel(
  fromIso: string,
  toIso: string,
): Promise<{ byChannel: Map<Channel, ChannelPeriodFacts>; source: "rpc" | "tables" | "empty" }> {
  const supabase = await db();
  const byChannel = new Map<Channel, ChannelPeriodFacts>([
    ["Google", emptyChannel("Google")],
    ["Meta", emptyChannel("Meta")],
  ]);

  // Optional RPC: may not exist in every environment — falls back to table reads below.
  const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)(
    "get_period_conversion_facts",
    { p_from: fromIso, p_to: toIso },
  );

  if (!rpcErr && Array.isArray(rpcData)) {
    for (const raw of rpcData as Row[]) {
      const ch = (raw.channel === "Meta" ? "Meta" : "Google") as Channel;
      const row = byChannel.get(ch) ?? emptyChannel(ch);
      row.leads = Number(raw.leads ?? 0);
      row.approved = Number(raw.approved ?? 0);
      row.disbursedCount = Number(raw.disbursed_count ?? 0);
      row.disbursedAmount = Number(raw.disbursed_amount ?? 0);
      byChannel.set(ch, row);
    }
    return { byChannel, source: "rpc" };
  }

  const [{ data: leadRows, error: leadErr }, { data: eventRows, error: eventErr }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, channel, created_at")
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    supabase
      .from("lead_events")
      .select("id, lead_id, event_type, value, occurred_at")
      .gte("occurred_at", fromIso)
      .lt("occurred_at", toIso),
  ]);

  if (leadErr || eventErr) {
    return { byChannel, source: "empty" };
  }

  const leads = (leadRows ?? []) as Row[];
  const events = (eventRows ?? []) as Row[];
  const channelByLead = new Map(leads.map((l) => [l.id as string, l.channel as Channel]));
  const missing = [...new Set(events.map((e) => e.lead_id as string))].filter((id) => !channelByLead.has(id));
  if (missing.length > 0) {
    const { data: extra } = await supabase.from("leads").select("id, channel").in("id", missing.slice(0, 500));
    for (const l of (extra ?? []) as Row[]) {
      channelByLead.set(l.id as string, l.channel as Channel);
    }
  }

  for (const l of leads) {
    const ch = (l.channel === "Meta" ? "Meta" : "Google") as Channel;
    byChannel.get(ch)!.leads += 1;
  }

  const approvedLeads = new Set<string>();
  const disbursedLeads = new Set<string>();
  for (const e of events) {
    const ch = (channelByLead.get(e.lead_id as string) === "Meta" ? "Meta" : "Google") as Channel;
    if (e.event_type === "CREDIT_APPROVED") approvedLeads.add(`${ch}:${e.lead_id}`);
    if (e.event_type === "LOAN_DISBURSED") {
      disbursedLeads.add(`${ch}:${e.lead_id}`);
      byChannel.get(ch)!.disbursedAmount += Number(e.value ?? 0);
    }
  }
  for (const key of approvedLeads) byChannel.get(key.split(":")[0] as Channel)!.approved += 1;
  for (const key of disbursedLeads) byChannel.get(key.split(":")[0] as Channel)!.disbursedCount += 1;

  return { byChannel, source: "tables" };
}

async function loadPeriodFacts(week: WeekKey): Promise<PeriodFacts> {
  const window = weekWindow(week);
  const [{ byChannel: raw }, snapshot] = await Promise.all([
    loadConversionByChannel(window.fromIso, window.toIso),
    getSnapshot(),
  ]);

  let byChannel = raw;
  let spendNote = SPEND_NOTE;
  const totals = conversionTotals(raw);
  if (totals.leads === 0 && totals.disbursedCount === 0 && snapshot.channelBreakdown.length > 0) {
    // Prior week: mild WoW delta so demo 环比不是全 0
    const scale = week === "last" ? 0.88 : 1;
    byChannel = synthesizeFromBreakdown(snapshot, scale);
    spendNote = SNAPSHOT_FALLBACK_NOTE;
  }

  return assemblePeriodFacts(window, byChannel, snapshot, spendNote);
}

async function countDecisions(fromIso: string, toIso: string, snapshot: AgentSnapshot): Promise<number> {
  const supabase = await db();
  const { count, error } = await supabase
    .from("agent_decisions")
    .select("id", { count: "exact", head: true })
    .gte("timestamp", fromIso)
    .lt("timestamp", toIso);
  if (!error && count != null) return count;

  // Publishable / RLS environments: count from snapshot window.
  return snapshot.decisions.filter((d) => d.timestamp >= fromIso && d.timestamp < toIso).length;
}

export async function getAnalyticsPeriodBundle(week: WeekKey) {
  const period = await loadPeriodFacts(week);
  let prior: PeriodFacts | null = null;
  if (week === "this") {
    prior = await loadPeriodFacts("last");
  } else {
    const w = weekWindow("last");
    const from = new Date(w.fromIso);
    from.setUTCDate(from.getUTCDate() - 7);
    const to = new Date(w.toIso);
    to.setUTCDate(to.getUTCDate() - 7);
    prior = await loadPeriodFactsForRange(from.toISOString(), to.toISOString(), {
      week: "last",
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      label: `${from.toISOString().slice(0, 10)} ~ ${to.toISOString().slice(0, 10)} (prior)`,
    });
  }

  const snapshot = await getSnapshot();
  const decisionCount = await countDecisions(period.window.fromIso, period.window.toIso, snapshot);

  return {
    period,
    prior,
    feedbackHealth: snapshot.feedbackHealth,
    insights: null as string[] | null,
    snapshot,
    decisionCount,
  };
}

async function loadPeriodFactsForRange(
  fromIso: string,
  toIso: string,
  window: PeriodFacts["window"],
): Promise<PeriodFacts> {
  const [{ byChannel: raw }, snapshot] = await Promise.all([
    loadConversionByChannel(fromIso, toIso),
    getSnapshot(),
  ]);
  const totals = conversionTotals(raw);
  if (totals.leads === 0 && totals.disbursedCount === 0 && snapshot.channelBreakdown.length > 0) {
    return assemblePeriodFacts(
      window,
      synthesizeFromBreakdown(snapshot, 0.8),
      snapshot,
      SNAPSHOT_FALLBACK_NOTE,
    );
  }
  return assemblePeriodFacts(window, raw, snapshot);
}

export async function getExecWeeklyReport(week: WeekKey, includeAppendix = true) {
  const bundle = await getAnalyticsPeriodBundle(week);
  const report = buildExecReport({
    period: bundle.period,
    prior: bundle.prior,
    feedback: bundle.feedbackHealth,
    adGroups: bundle.snapshot.adGroups.map((g) => ({
      id: g.id,
      name: g.name,
      channel: g.channel,
      cps: g.cps,
      spentToday: g.spentToday,
      disbursedCount: g.disbursedCount,
    })),
    decisionCount: bundle.decisionCount,
    killSwitch: bundle.snapshot.killSwitch,
    includeAppendix,
  });
  return report;
}

export async function getOpsAnalyticsBundle(week: WeekKey) {
  const bundle = await getAnalyticsPeriodBundle(week);
  const { buildOpsInsights } = await import("./report");
  const insights = buildOpsInsights({
    period: bundle.period,
    prior: bundle.prior,
    feedback: bundle.feedbackHealth,
    channelBreakdown: bundle.snapshot.channelBreakdown,
  });
  return {
    period: bundle.period,
    prior: bundle.prior,
    feedbackHealth: bundle.feedbackHealth,
    insights,
    funnel: bundle.snapshot.funnel,
    channelTrend: bundle.snapshot.channelTrend,
    channelBreakdown: bundle.snapshot.channelBreakdown,
  };
}

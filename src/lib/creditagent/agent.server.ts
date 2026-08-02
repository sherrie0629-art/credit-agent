// Server-only data access + agent business logic backed by the Lovable Cloud database.
import type {
  AdGroup,
  AgentDecision,
  AgentSnapshot,
  Campaign,
  ChannelTrendPoint,
  CreativeAsset,
  CreativePlacement,
  FeedbackHealth,
  ManagementMode,
} from "./types";
import { checkBudgetChange } from "./guardrails";
import { loadLimits, preflight, recordGuardrail } from "./guardrails.server";


type Row = Record<string, any>;


async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function mapCampaign(r: Row): Campaign {
  return {
    id: r.id,
    name: r.name,
    channel: r.channel,
    placement: r.placement,
    status: r.status,
    dailyBudget: Number(r.daily_budget),
    spentToday: Number(r.spent_today),
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    leads: Number(r.leads),
    approvedLoans: Number(r.approved_loans),
    disbursedAmount: Number(r.disbursed_amount),
    cpl: Number(r.cpl),
    cps: Number(r.cps),
    compliancePassRate: Number(r.compliance_pass_rate),
    last20ApprovalRate: Number(r.last20_approval_rate),
    aiSuggestion: r.ai_suggestion,
  };
}

function mapAdGroup(
  r: Row,
  campaignName: string,
  f?: {
    leads: number;
    approvedLoans: number;
    disbursedCount: number;
    disbursedAmount: number;
    cpl: number;
    cps: number;
    last20ApprovalRate: number;
  },
): AdGroup {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    campaignName,
    name: r.name,
    channel: r.channel,
    placement: r.placement,
    audience: r.audience,
    bidStrategy: r.bid_strategy,
    status: r.status,
    dailyBudget: Number(r.daily_budget),
    spentToday: Number(r.spent_today),
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    leads: f?.leads ?? 0,
    approvedLoans: f?.approvedLoans ?? 0,
    disbursedCount: f?.disbursedCount ?? 0,
    disbursedAmount: f?.disbursedAmount ?? 0,
    cpl: f?.cpl ?? 0,
    cps: f?.cps ?? 0,
    compliancePassRate: Number(r.compliance_pass_rate),
    last20ApprovalRate: f?.last20ApprovalRate ?? 0,
    aiSuggestion: r.ai_suggestion,
  };
}

function mapDecision(r: Row): AgentDecision {
  return {
    id: r.id,
    timestamp: r.timestamp,
    agentType: r.agent_type,
    actionType: r.action_type,
    targetChannel: r.target_channel,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    adGroupId: r.ad_group_id ?? undefined,
    adGroupName: r.ad_group_name ?? undefined,
    confidenceScore: Number(r.confidence_score),
    reasoningChain: (r.reasoning_chain ?? []) as string[],
    dataMetricsTrigger: {
      metric: r.trigger_metric,
      currentValue: Number(r.trigger_current_value),
      thresholdValue: Number(r.trigger_threshold_value),
    },
    status: r.status,
    effect: r.effect,
    rollbackTo: r.rollback_to ?? undefined,
    creativeId: r.creative_id ?? undefined,
    creativeName: r.creative_name ?? undefined,
  };
}

/** All creative → ad group delivery links, enriched with hierarchy metadata and real lead facts. */
export async function getPlacements(): Promise<CreativePlacement[]> {
  const supabase = await db();
  const [{ data: links }, { data: groups }, { data: campaigns }, { data: facts }] =
    await Promise.all([
      supabase.from("creative_placements").select("*").order("share", { ascending: false }),
      supabase.from("ad_groups").select("id,name,campaign_id,channel,placement"),
      supabase.from("campaigns").select("id,name"),
      (supabase as any).from("v_placement_facts").select("*"),
    ]);
  const groupById = new Map(((groups ?? []) as Row[]).map((g) => [g.id, g]));
  const campaignById = new Map(((campaigns ?? []) as Row[]).map((c) => [c.id, c]));
  const factByPair = new Map(
    ((facts ?? []) as Row[]).map((f) => [`${f.creative_id}::${f.ad_group_id}`, f]),
  );
  return ((links ?? []) as Row[]).map((r) => {
    const g = groupById.get(r.ad_group_id);
    const c = campaignById.get(g?.campaign_id ?? r.campaign_id);
    const f = factByPair.get(`${r.creative_id}::${r.ad_group_id}`);
    return {
      creativeId: r.creative_id,
      adGroupId: r.ad_group_id,
      adGroupName: g?.name ?? r.ad_group_id,
      campaignId: g?.campaign_id ?? r.campaign_id,
      campaignName: c?.name ?? g?.campaign_id ?? r.campaign_id,
      channel: (g?.channel ?? "Google") as CreativePlacement["channel"],
      placement: g?.placement ?? "",
      status: r.status,
      share: Number(r.share),
      startedAt: r.started_at,
      leads: Number(f?.leads ?? 0),
      approved: Number(f?.approved ?? 0),
      disbursedCount: Number(f?.disbursed_count ?? 0),
      disbursedAmount: Number(f?.disbursed_amount ?? 0),
    };
  });
}

/** Primary (highest-share ACTIVE) ad group a creative is delivered in. */
export async function getPrimaryPlacement(creativeId: string): Promise<CreativePlacement | null> {
  const all = await getPlacements();
  const active = all
    .filter((p) => p.creativeId === creativeId && p.status === "ACTIVE")
    .sort((a, b) => b.share - a.share);
  return active[0] ?? null;
}


function mapCreative(r: Row): CreativeAsset {
  return {
    id: r.id,
    headline: r.headline,
    bodyText: r.body_text,
    imageUrl: r.image_url ?? undefined,
    loanTermRange: r.loan_term_range,
    maxApr: Number(r.max_apr),
    complianceStatus: r.compliance_status,
    complianceLogs: (r.compliance_logs ?? []) as string[],
    fatigueScore: Number(r.fatigue_score ?? 0),
    fatigueLevel: (r.fatigue_level ?? "HEALTHY") as CreativeAsset["fatigueLevel"],
    launchedAt: r.launched_at ?? undefined,
    lastScannedAt: r.last_scanned_at ?? undefined,
  };
}


/* -------------------------------------------------------------------------- *
 * Derived facts — single source of truth is leads + lead_events.
 * The `campaigns` / `creative_assets` / `channel_breakdown` / `funnel_stages`
 * tables keep configuration + delivery-side numbers only; every downstream
 * metric below is read from the database views.
 * -------------------------------------------------------------------------- */

type CampaignFacts = {
  leads: number;
  approvedLoans: number;
  disbursedCount: number;
  disbursedAmount: number;
  cpl: number;
  cps: number;
  last20ApprovalRate: number;
};

export async function getCampaignFacts(): Promise<Map<string, CampaignFacts>> {
  const supabase = await db();
  const { data } = await (supabase as any).from("v_campaign_facts").select("*");
  return new Map(
    ((data ?? []) as Row[]).map((r) => [
      r.campaign_id as string,
      {
        leads: Number(r.leads),
        approvedLoans: Number(r.approved_loans),
        disbursedCount: Number(r.disbursed_count),
        disbursedAmount: Number(r.disbursed_amount),
        cpl: Number(r.cpl),
        cps: Number(r.cps),
        last20ApprovalRate: Number(r.last20_approval_rate),
      },
    ]),
  );
}

export async function getAdGroupFacts(): Promise<Map<string, CampaignFacts>> {
  const supabase = await db();
  const { data } = await (supabase as any).from("v_adgroup_facts").select("*");
  return new Map(
    ((data ?? []) as Row[]).map((r) => [
      r.ad_group_id as string,
      {
        leads: Number(r.leads),
        approvedLoans: Number(r.approved_loans),
        disbursedCount: Number(r.disbursed_count),
        disbursedAmount: Number(r.disbursed_amount),
        cpl: Number(r.cpl),
        cps: Number(r.cps),
        last20ApprovalRate: Number(r.last20_approval_rate),
      },
    ]),
  );
}

export async function getCreativeFacts() {
  const supabase = await db();
  const { data } = await (supabase as any).from("v_creative_facts").select("*");
  return new Map(
    ((data ?? []) as Row[]).map((r) => [
      r.creative_id as string,
      {
        spend: Number(r.spend),
        leads: Number(r.leads),
        approvedLoans: Number(r.approved_loans),
        disbursedCount: Number(r.disbursed_count),
        disbursedAmount: Number(r.disbursed_amount),
        cpl: Number(r.cpl),
        cps: Number(r.cps),
        approvalRate: Number(r.approval_rate),
      },
    ]),
  );
}

/**
 * Offline conversion feedback health per channel: how much of what the database
 * knows actually reached the ad platform. Feeds the decision reasoning chain so
 * budget calls acknowledge that platform-side CPS may be overstated.
 */
export async function getFeedbackHealth(): Promise<FeedbackHealth[]> {
  const supabase = await db();
  const [{ data: uploads }, { data: events }] = await Promise.all([
    supabase.from("conversion_uploads").select("event_id, platform, status"),
    supabase.from("lead_events").select("id, lead_id").eq("event_type", "LOAN_DISBURSED"),
  ]);
  const disbursedIds = ((events ?? []) as Row[]).map((e) => e.id as string);
  const { data: leadRows } = await supabase
    .from("leads")
    .select("id, channel")
    .in("id", [...new Set(((events ?? []) as Row[]).map((e) => e.lead_id as string))]);
  const channelByLead = new Map(((leadRows ?? []) as Row[]).map((l) => [l.id, l.channel]));
  const channelByEvent = new Map(
    ((events ?? []) as Row[]).map((e) => [e.id, channelByLead.get(e.lead_id) ?? "Google"]),
  );

  const rows = (uploads ?? []) as Row[];
  return (["Google", "Meta"] as const).map((channel) => {
    const mine = rows.filter((u) => channelByEvent.get(u.event_id) === channel);
    const attempted = mine.filter((u) => u.status === "SENT" || u.status === "FAILED").length;
    const sent = mine.filter((u) => u.status === "SENT").length;
    const sentEventIds = new Set(mine.filter((u) => u.status === "SENT").map((u) => u.event_id));
    const mineDisbursed = disbursedIds.filter((id) => channelByEvent.get(id) === channel);
    const reported = mineDisbursed.filter((id) => sentEventIds.has(id)).length;
    return {
      channel,
      sent,
      attempted,
      successRate: attempted > 0 ? sent / attempted : 0,
      gapRate: mineDisbursed.length > 0 ? 1 - reported / mineDisbursed.length : 0,
    };
  });
}

/** One-line caveat about feedback completeness for a channel's decisions. */
export async function feedbackNote(channel: string) {
  const health = await getFeedbackHealth();
  const h = health.find((x) => x.channel === channel);
  if (!h || h.attempted === 0) {
    return `${channel} 离线转化回传暂无记录，平台侧仍按前端线索优化，CPS 可能被低估。`;
  }
  return `${channel} 离线转化回传成功率 ${(h.successRate * 100).toFixed(1)}%，仍有 ${(h.gapRate * 100).toFixed(0)}% 的放款未回传到平台，平台侧 CPS 存在低估风险。`;
}

function factsFrom(rows: Row[], key: string): Map<string, CampaignFacts> {
  return new Map(
    rows.map((r) => [
      r[key] as string,
      {
        leads: Number(r.leads),
        approvedLoans: Number(r.approved_loans),
        disbursedCount: Number(r.disbursed_count),
        disbursedAmount: Number(r.disbursed_amount),
        cpl: Number(r.cpl),
        cps: Number(r.cps),
        last20ApprovalRate: Number(r.last20_approval_rate ?? 0),
      },
    ]),
  );
}

function placementsFrom(payload: Row): CreativePlacement[] {
  const groupById = new Map((payload.ad_groups as Row[]).map((g) => [g.id, g]));
  const campaignById = new Map((payload.campaigns as Row[]).map((c) => [c.id, c]));
  const factByPair = new Map(
    (payload.v_placement_facts as Row[]).map((f) => [`${f.creative_id}::${f.ad_group_id}`, f]),
  );
  return (payload.creative_placements as Row[]).map((r) => {
    const g = groupById.get(r.ad_group_id);
    const c = campaignById.get(g?.campaign_id ?? r.campaign_id);
    const f = factByPair.get(`${r.creative_id}::${r.ad_group_id}`);
    return {
      creativeId: r.creative_id,
      adGroupId: r.ad_group_id,
      adGroupName: g?.name ?? r.ad_group_id,
      campaignId: g?.campaign_id ?? r.campaign_id,
      campaignName: c?.name ?? g?.campaign_id ?? r.campaign_id,
      channel: (g?.channel ?? "Google") as CreativePlacement["channel"],
      placement: g?.placement ?? "",
      status: r.status,
      share: Number(r.share),
      startedAt: r.started_at,
      leads: Number(f?.leads ?? 0),
      approved: Number(f?.approved ?? 0),
      disbursedCount: Number(f?.disbursed_count ?? 0),
      disbursedAmount: Number(f?.disbursed_amount ?? 0),
    };
  });
}

function feedbackHealthFrom(payload: Row): FeedbackHealth[] {
  const uploads = payload.conversion_uploads as Row[];
  const disbursed = payload.disbursed_events as Row[];
  const channelByEvent = new Map(disbursed.map((e) => [e.id as string, e.channel as string]));
  return (["Google", "Meta"] as const).map((channel) => {
    const mine = uploads.filter((u) => channelByEvent.get(u.event_id) === channel);
    const attempted = mine.filter((u) => u.status === "SENT" || u.status === "FAILED").length;
    const sent = mine.filter((u) => u.status === "SENT").length;
    const sentEventIds = new Set(mine.filter((u) => u.status === "SENT").map((u) => u.event_id));
    const mineDisbursed = disbursed.filter((e) => e.channel === channel);
    const reported = mineDisbursed.filter((e) => sentEventIds.has(e.id)).length;
    return {
      channel,
      sent,
      attempted,
      successRate: attempted > 0 ? sent / attempted : 0,
      gapRate: mineDisbursed.length > 0 ? 1 - reported / mineDisbursed.length : 0,
    };
  });
}

/**
 * Single round-trip snapshot: the whole dashboard state is aggregated inside
 * Postgres by `get_agent_snapshot()` and mapped here. Previously this issued
 * ~25 separate Data API requests, which dominated page load time.
 */
export async function getSnapshot(): Promise<AgentSnapshot> {
  const supabase = await db();
  const { mapMetric, mapVariant, mapExperiment } = await import("./creative.server");

  const { data, error } = await (supabase as any).rpc("get_agent_snapshot");
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as Row;

  const campaignRows = (payload.campaigns ?? []) as Row[];
  const adGroupRows = (payload.ad_groups ?? []) as Row[];
  const campaignFacts = factsFrom((payload.v_campaign_facts ?? []) as Row[], "campaign_id");
  const adGroupFacts = factsFrom((payload.v_adgroup_facts ?? []) as Row[], "ad_group_id");
  const creativeFacts = new Map(
    ((payload.v_creative_facts ?? []) as Row[]).map((r) => [
      r.creative_id as string,
      {
        spend: Number(r.spend),
        leads: Number(r.leads),
        approvedLoans: Number(r.approved_loans),
        disbursedCount: Number(r.disbursed_count),
        disbursedAmount: Number(r.disbursed_amount),
        cpl: Number(r.cpl),
        cps: Number(r.cps),
        approvalRate: Number(r.approval_rate),
      },
    ]),
  );

  const s = (payload.settings ?? {}) as Row;
  const noteByStage = new Map(
    ((payload.funnel_stages ?? []) as Row[]).map((r) => [r.stage as string, r.note as string]),
  );
  const campaignNameById = new Map(campaignRows.map((r) => [r.id as string, r.name as string]));
  const adGroupNameById = new Map(adGroupRows.map((r) => [r.id as string, r.name as string]));

  return {
    decisions: ((payload.decisions ?? []) as Row[]).map(mapDecision),
    campaigns: campaignRows.map((r) => {
      const c = mapCampaign(r);
      const f = campaignFacts.get(c.id);
      return f ? { ...c, ...f } : c;
    }),
    adGroups: adGroupRows.map((r) =>
      mapAdGroup(r, campaignNameById.get(r.campaign_id) ?? r.campaign_id, adGroupFacts.get(r.id)),
    ),
    creatives: ((payload.creative_assets ?? []) as Row[]).map((r) => {
      const c = mapCreative(r);
      const f = creativeFacts.get(c.id);
      return f ? { ...c, backend: f } : c;
    }),
    mode: (s.mode ?? "SEMI_AUTO") as ManagementMode,
    riskFirst: s.risk_first ?? true,
    autoTakeovers: Number(s.auto_takeovers ?? 0),
    cpsImprovementPct: Number(s.cps_improvement_pct ?? 0),
    agentOnline: s.agent_online ?? true,
    funnel: ((payload.v_funnel ?? []) as Row[]).map((r) => ({
      stage: r.stage,
      value: Number(r.value),
      note: noteByStage.get(r.stage) ?? "",
    })),
    channelTrend: ((payload.channel_trend ?? []) as Row[]).map(
      (r): ChannelTrendPoint => ({
        day: r.day,
        googleFrontEndRoi: Number(r.google_front_end_roi),
        metaFrontEndRoi: Number(r.meta_front_end_roi),
        googleTrueRoas: Number(r.google_true_roas),
        metaTrueRoas: Number(r.meta_true_roas),
      }),
    ),
    channelBreakdown: ((payload.channel_breakdown ?? []) as Row[]).map((r) => {
      const f = r.ad_group_id ? adGroupFacts.get(r.ad_group_id) : undefined;
      return {
        channel: r.channel,
        campaignId: r.campaign_id ?? undefined,
        adGroupId: r.ad_group_id ?? undefined,
        adGroupName: r.ad_group_id ? adGroupNameById.get(r.ad_group_id) : undefined,
        spend: Number(r.spend),
        disbursed: f ? f.disbursedAmount : Number(r.disbursed),
        cps: f ? f.cps : Number(r.cps),
        approval: f && f.leads > 0 ? f.approvedLoans / f.leads : Number(r.approval),
        leads: f?.leads,
        disbursedCount: f?.disbursedCount,
      };
    }),
    creativeMetrics: ((payload.creative_metrics ?? []) as Row[]).map(mapMetric),
    variants: ((payload.creative_variants ?? []) as Row[]).map(mapVariant),
    experiments: ((payload.creative_experiments ?? []) as Row[]).map(mapExperiment),
    placements: placementsFrom({
      ad_groups: adGroupRows,
      campaigns: campaignRows,
      v_placement_facts: payload.v_placement_facts ?? [],
      creative_placements: payload.creative_placements ?? [],
    }),
    feedbackHealth: feedbackHealthFrom({
      conversion_uploads: payload.conversion_uploads ?? [],
      disbursed_events: payload.disbursed_events ?? [],
    }),
  };
}



async function bumpTakeovers(by: number) {
  if (by === 0) return;
  const supabase = await db();
  const { data } = await supabase
    .from("agent_settings")
    .select("auto_takeovers")
    .eq("id", "default")
    .maybeSingle();
  const current = Number((data as Row | null)?.auto_takeovers ?? 0);
  await supabase
    .from("agent_settings")
    .update({ auto_takeovers: current + by, updated_at: new Date().toISOString() })
    .eq("id", "default");
}

async function nextDecisionId() {
  const supabase = await db();
  const { count } = await supabase
    .from("agent_decisions")
    .select("id", { count: "exact", head: true });
  return `dec_${1043 + (count ?? 0)}`;
}

async function getAdGroup(id: string) {
  const supabase = await db();
  const { data } = await supabase.from("ad_groups").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as Row;
  const { data: parent } = await supabase
    .from("campaigns")
    .select("name")
    .eq("id", row.campaign_id)
    .maybeSingle();
  const facts = (await getAdGroupFacts()).get(row.id);
  return mapAdGroup(row, ((parent as Row | null)?.name as string) ?? row.campaign_id, facts);
}

export async function approveDecision(id: string) {
  const supabase = await db();
  const { data } = await supabase.from("agent_decisions").select("*").eq("id", id).maybeSingle();
  if (!data) return getSnapshot();
  const decision = mapDecision(data as Row);

  await supabase.from("agent_decisions").update({ status: "EXECUTED" }).eq("id", id);
  await bumpTakeovers(1);

  const targetGroup = decision.adGroupId;
  if (targetGroup) {
    if (decision.actionType === "BUDGET_SHIFT" && decision.id === "dec_1039") {
      await supabase
        .from("ad_groups")
        .update({ daily_budget: 1400, ai_suggestion: "预算已按风控建议下调" } as never)
        .eq("id", targetGroup);
    } else if (decision.actionType === "CREATIVE_PAUSE") {
      await supabase
        .from("ad_groups")
        .update({ ai_suggestion: "低质素材已暂停，合规变体接量中" } as never)
        .eq("id", targetGroup);
    }
  }

  return getSnapshot();
}

export async function rejectDecision(id: string) {
  const supabase = await db();
  await supabase.from("agent_decisions").update({ status: "REJECTED_BY_USER" }).eq("id", id);
  return getSnapshot();
}

export async function rollbackDecision(id: string) {
  const supabase = await db();
  const { data } = await supabase.from("agent_decisions").select("*").eq("id", id).maybeSingle();
  if (!data) return { snapshot: await getSnapshot(), rolledBackTo: "原配置" };
  const decision = mapDecision(data as Row);

  await supabase.from("agent_decisions").update({ status: "ROLLED_BACK" }).eq("id", id);

  const group = decision.adGroupId ? await getAdGroup(decision.adGroupId) : null;
  if (group) {
    const patch: Row = { ai_suggestion: `已回滚至：${decision.rollbackTo ?? "原配置"}` };
    if (decision.id === "dec_1042" && group.id === "cmp_g_search_01") patch.daily_budget = 4200;
    if (decision.id === "dec_1041" && group.status === "COMPLIANCE_HOLD") patch.status = "ACTIVE";
    await supabase.from("ad_groups").update(patch as never).eq("id", group.id);
  }

  return { snapshot: await getSnapshot(), rolledBackTo: decision.rollbackTo ?? "原配置" };
}

export async function setMode(mode: ManagementMode) {
  const supabase = await db();
  await supabase
    .from("agent_settings")
    .update({ mode, updated_at: new Date().toISOString() })
    .eq("id", "default");
  return getSnapshot();
}

export async function setRiskFirst(riskFirst: boolean) {
  const supabase = await db();
  await supabase
    .from("agent_settings")
    .update({ risk_first: riskFirst, updated_at: new Date().toISOString() })
    .eq("id", "default");

  if (!riskFirst) {
    return { snapshot: await getSnapshot(), pausedCampaigns: [] as string[] };
  }

  const snapshot = await getSnapshot();
  const paused = snapshot.adGroups.filter(
    (g) => g.channel === "Meta" && g.last20ApprovalRate < 0.1 && g.status === "ACTIVE",
  );
  if (paused.length === 0) {
    return { snapshot, pausedCampaigns: [] as string[] };
  }

  const baseId = await nextDecisionId();
  const notes = await Promise.all(paused.map((g) => feedbackNote(g.channel)));
  const rows = paused.map((g, i) => ({
    id: `${baseId}_${i}`,
    timestamp: new Date().toISOString(),
    agent_type: "Execution",
    action_type: "CREATIVE_PAUSE",
    target_channel: g.channel,
    campaign_id: g.campaignId,
    campaign_name: g.campaignName,
    ad_group_id: g.id,
    ad_group_name: g.name,
    confidence_score: 0.93,
    reasoning_chain: [
      `风控优先模式开启：检查广告组「${g.name}」（${g.campaignName}）近 20 条线索。`,
      `后端授信通过率 ${(g.last20ApprovalRate * 100).toFixed(1)}% < 阈值 10%。`,
      `实际放款成本 CPS $${g.cps.toFixed(2)}，高于账户目标 $19.00。`,
      notes[i],
      "决策：自动暂停该广告组，预算暂存至 Planner 待分配池。",
    ],
    trigger_metric: "ApprovalRate",
    trigger_current_value: g.last20ApprovalRate,
    trigger_threshold_value: 0.1,
    status: "EXECUTED",
    effect: `广告组「${g.name}」自动暂停`,
    rollback_to: `${g.name} ACTIVE / $${g.dailyBudget}`,
  }));

  await supabase.from("agent_decisions").insert(rows as never);
  for (const g of paused) {
    await supabase
      .from("ad_groups")
      .update({ status: "PAUSED", ai_suggestion: "风控优先：授信通过率过低已自动暂停" } as never)
      .eq("id", g.id);
  }
  await bumpTakeovers(rows.length);

  return { snapshot: await getSnapshot(), pausedCampaigns: paused.map((g) => g.name) };
}

export async function setAdGroupStatus(id: string, status: AdGroup["status"]) {
  const supabase = await db();
  await supabase
    .from("ad_groups")
    .update({ status, updated_at: new Date().toISOString() } as never)
    .eq("id", id);
  return getSnapshot();
}

/** 人工改预算：仍需过绝对上限与单次幅度校验，超限直接拒绝并留痕。 */
export async function setAdGroupBudget(id: string, dailyBudget: number) {
  const supabase = await db();
  const group = await getAdGroup(id);
  if (!group) return { snapshot: await getSnapshot(), guardrail: null };

  const limits = await loadLimits();
  const verdict = checkBudgetChange(limits, { current: group.dailyBudget, next: dailyBudget });
  await recordGuardrail({
    action: "SET_AD_GROUP_BUDGET",
    targetId: id,
    decision: verdict,
    requested: { from: group.dailyBudget, to: dailyBudget },
  });

  if (verdict.verdict === "DENY") {
    return { snapshot: await getSnapshot(), guardrail: verdict };
  }

  const applied = verdict.verdict === "CLAMP" ? (verdict.value ?? dailyBudget) : dailyBudget;
  await supabase
    .from("ad_groups")
    .update({ daily_budget: applied, updated_at: new Date().toISOString() } as never)
    .eq("id", id);
  return { snapshot: await getSnapshot(), guardrail: verdict.verdict === "CLAMP" ? verdict : null };
}

export async function applyAiSuggestion(id: string, triggerSource: "EVENT" | "SWEEP" = "EVENT") {
  const supabase = await db();
  const group = await getAdGroup(id);
  if (!group) return { snapshot: await getSnapshot(), decision: null, guardrail: null };

  const { data: settings } = await supabase
    .from("agent_settings")
    .select("mode")
    .eq("id", "default")
    .maybeSingle();
  let mode = ((settings as Row | null)?.mode ?? "SEMI_AUTO") as ManagementMode;

  const scaleUp = group.last20ApprovalRate >= 0.22;
  const rawNextBudget = Math.round(group.dailyBudget * (scaleUp ? 1.15 : 0.6));
  const decisionId = await nextDecisionId();

  // —— 风控规则层：API 执行前的最后一关 ——
  const gate = await preflight({
    action: "APPLY_AI_SUGGESTION",
    targetId: id,
    automated: mode === "FULL_AUTO",
  });
  let guardrailNote: string | null = null;
  let nextBudget = rawNextBudget;

  if (!gate.ok) {
    mode = "SEMI_AUTO"; // 降级为人工审批，不静默丢弃
    guardrailNote = `风控层拦截自动执行（${gate.decision.rule}）：${gate.decision.detail}`;
  } else {
    const budgetVerdict = checkBudgetChange(gate.limits, {
      current: group.dailyBudget,
      next: rawNextBudget,
    });
    await recordGuardrail({
      action: "APPLY_AI_SUGGESTION",
      targetId: id,
      decision: budgetVerdict,
      requested: { from: group.dailyBudget, to: rawNextBudget },
    });
    if (budgetVerdict.verdict === "DENY") {
      mode = "SEMI_AUTO";
      guardrailNote = `风控层拦截自动执行（${budgetVerdict.rule}）：${budgetVerdict.detail}`;
    } else if (budgetVerdict.verdict === "CLAMP") {
      nextBudget = budgetVerdict.value ?? rawNextBudget;
      guardrailNote = `风控层已截断（${budgetVerdict.rule}）：${budgetVerdict.detail}`;
    }
  }

  const row = {
    id: decisionId,
    timestamp: new Date().toISOString(),
    agent_type: "Planner",
    action_type: "BUDGET_SHIFT",
    target_channel: group.channel,
    campaign_id: group.campaignId,
    campaign_name: group.campaignName,
    ad_group_id: group.id,
    ad_group_name: group.name,
    confidence_score: scaleUp ? 0.89 : 0.82,
    trigger_source: triggerSource,
    guardrail_note: guardrailNote,
    reasoning_chain: [
      `广告组「${group.name}」（${group.campaignName}）近 20 条线索授信通过率 ${(group.last20ApprovalRate * 100).toFixed(1)}%。`,
      `CPL $${group.cpl.toFixed(2)} / CPS $${group.cps.toFixed(2)}（目标 CPS $19.00）。`,
      await feedbackNote(group.channel),
      scaleUp
        ? "后端放款率高于阈值，触发正向扩量策略：预算 +15%。"
        : "后端放款率低于阈值，触发风险拦截：预算削减 40% 并转移至高胜率广告组。",
      guardrailNote ?? "风控规则层校验通过：预算变动在硬编码限额内。",
      mode === "FULL_AUTO"
        ? "托管模式 = Full-Auto：直接调用广告 API 执行。"
        : "托管模式 = Semi-Auto：推送审批卡片，等待人工确认。",
    ],
    trigger_metric: "CostPerDisbursement",
    trigger_current_value: group.cps,
    trigger_threshold_value: 19,
    status: mode === "FULL_AUTO" ? "EXECUTED" : "PENDING_APPROVAL",
    effect: `日预算 $${group.dailyBudget.toLocaleString()} → $${nextBudget.toLocaleString()}`,
    rollback_to: `$${group.dailyBudget.toLocaleString()}`,
  };

  const { data: inserted } = await supabase
    .from("agent_decisions")
    .insert(row as never)
    .select("*")
    .maybeSingle();

  if (mode === "FULL_AUTO") {
    await supabase
      .from("ad_groups")
      .update({ daily_budget: nextBudget } as never)
      .eq("id", group.id);
    await bumpTakeovers(1);
  }


  return {
    snapshot: await getSnapshot(),
    decision: inserted ? mapDecision(inserted as Row) : null,
  };
}

export async function logComplianceDecision(payload: {
  headline: string;
  blocked: boolean;
  score: number;
  reasons: string[];
}) {
  const supabase = await db();
  const row = {
    id: await nextDecisionId(),
    timestamp: new Date().toISOString(),
    agent_type: "Compliance",
    action_type: payload.blocked ? "COMPLIANCE_REJECT" : "CREATIVE_PAUSE",
    target_channel: "Meta",
    campaign_id: "cmp_m_reels_04",
    campaign_name: "Compliance & Creative Studio",
    confidence_score: 0.97,
    reasoning_chain: [
      `扫描素材：“${payload.headline || "(未命名素材)"}”`,
      `Compliance Score = ${payload.score}/100`,
      ...payload.reasons,
      payload.blocked
        ? "决策：阻断提交至广告 API，等待 Auto-Fix。"
        : "决策：允许提交，附加 Legal Disclaimer 后送审。",
    ],
    trigger_metric: "CPL",
    trigger_current_value: payload.score,
    trigger_threshold_value: 100,
    status: "EXECUTED",
    effect: payload.blocked ? "素材提交已阻断" : "素材已通过合规并送审",
  };

  const { data: inserted } = await supabase
    .from("agent_decisions")
    .insert(row)
    .select("*")
    .maybeSingle();

  return {
    snapshot: await getSnapshot(),
    decision: inserted ? mapDecision(inserted as Row) : null,
  };
}

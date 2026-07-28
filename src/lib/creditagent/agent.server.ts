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

export async function getSnapshot(): Promise<AgentSnapshot> {
  const supabase = await db();
  const { mapMetric, mapVariant, mapExperiment } = await import("./creative.server");
  const [
    decisions,
    campaigns,
    adGroups,
    creatives,
    settings,
    funnel,
    trend,
    breakdown,
    metrics,
    variants,
    experiments,
    placements,
    campaignFacts,
    adGroupFacts,
    creativeFacts,
    feedbackHealth,
    funnelFacts,
  ] = await Promise.all([
    supabase.from("agent_decisions").select("*").order("timestamp", { ascending: false }),
    supabase.from("campaigns").select("*").order("sort_order"),
    supabase.from("ad_groups").select("*").order("sort_order"),
    supabase.from("creative_assets").select("*").order("sort_order"),
    supabase.from("agent_settings").select("*").eq("id", "default").maybeSingle(),
    supabase.from("funnel_stages").select("*").order("sort_order"),
    supabase.from("channel_trend").select("*").order("sort_order"),
    supabase.from("channel_breakdown").select("*").order("sort_order"),
    supabase.from("creative_metrics").select("*").order("day"),
    supabase.from("creative_variants").select("*").order("created_at", { ascending: false }),
    supabase.from("creative_experiments").select("*").order("started_at", { ascending: false }),
    getPlacements(),
    getCampaignFacts(),
    getAdGroupFacts(),
    getCreativeFacts(),
    getFeedbackHealth(),
    (supabase as any).from("v_funnel").select("*").order("sort_order"),
  ]);


  const s = (settings.data ?? {}) as Row;
  const noteByStage = new Map(
    ((funnel.data ?? []) as Row[]).map((r) => [r.stage as string, r.note as string]),
  );
  const campaignNameById = new Map(
    ((campaigns.data ?? []) as Row[]).map((r) => [r.id as string, r.name as string]),
  );
  const adGroupNameById = new Map(
    ((adGroups.data ?? []) as Row[]).map((r) => [r.id as string, r.name as string]),
  );

  return {
    decisions: ((decisions.data ?? []) as Row[]).map(mapDecision),
    campaigns: ((campaigns.data ?? []) as Row[]).map((r) => {
      const c = mapCampaign(r);
      const f = campaignFacts.get(c.id);
      return f ? { ...c, ...f } : c;
    }),
    adGroups: ((adGroups.data ?? []) as Row[]).map((r) =>
      mapAdGroup(r, campaignNameById.get(r.campaign_id) ?? r.campaign_id, adGroupFacts.get(r.id)),
    ),
    creatives: ((creatives.data ?? []) as Row[]).map((r) => {
      const c = mapCreative(r);
      const f = creativeFacts.get(c.id);
      return f ? { ...c, backend: f } : c;
    }),
    mode: (s.mode ?? "SEMI_AUTO") as ManagementMode,
    riskFirst: s.risk_first ?? true,
    autoTakeovers: Number(s.auto_takeovers ?? 0),
    cpsImprovementPct: Number(s.cps_improvement_pct ?? 0),
    agentOnline: s.agent_online ?? true,
    funnel: ((funnelFacts.data ?? []) as Row[]).map((r) => ({
      stage: r.stage,
      value: Number(r.value),
      note: noteByStage.get(r.stage) ?? "",
    })),
    channelTrend: ((trend.data ?? []) as Row[]).map(
      (r): ChannelTrendPoint => ({
        day: r.day,
        googleFrontEndRoi: Number(r.google_front_end_roi),
        metaFrontEndRoi: Number(r.meta_front_end_roi),
        googleTrueRoas: Number(r.google_true_roas),
        metaTrueRoas: Number(r.meta_true_roas),
      }),
    ),
    channelBreakdown: ((breakdown.data ?? []) as Row[]).map((r) => {
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
    creativeMetrics: ((metrics.data ?? []) as Row[]).map(mapMetric),
    variants: ((variants.data ?? []) as Row[]).map(mapVariant),
    experiments: ((experiments.data ?? []) as Row[]).map(mapExperiment),
    placements,
    feedbackHealth,
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

export async function setAdGroupBudget(id: string, dailyBudget: number) {
  const supabase = await db();
  await supabase
    .from("ad_groups")
    .update({ daily_budget: dailyBudget, updated_at: new Date().toISOString() } as never)
    .eq("id", id);
  return getSnapshot();
}

export async function applyAiSuggestion(id: string) {
  const supabase = await db();
  const campaign = await getCampaign(id);
  if (!campaign) return { snapshot: await getSnapshot(), decision: null };

  const { data: settings } = await supabase
    .from("agent_settings")
    .select("mode")
    .eq("id", "default")
    .maybeSingle();
  const mode = ((settings as Row | null)?.mode ?? "SEMI_AUTO") as ManagementMode;

  const scaleUp = campaign.last20ApprovalRate >= 0.22;
  const nextBudget = Math.round(campaign.dailyBudget * (scaleUp ? 1.15 : 0.6));
  const decisionId = await nextDecisionId();

  const row = {
    id: decisionId,
    timestamp: new Date().toISOString(),
    agent_type: "Planner",
    action_type: "BUDGET_SHIFT",
    target_channel: campaign.channel,
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    confidence_score: scaleUp ? 0.89 : 0.82,
    reasoning_chain: [
      `${campaign.name} 近 20 条线索授信通过率 ${(campaign.last20ApprovalRate * 100).toFixed(1)}%。`,
      `CPL $${campaign.cpl.toFixed(2)} / CPS $${campaign.cps.toFixed(2)}（目标 CPS $19.00）。`,
      await feedbackNote(campaign.channel),
      scaleUp
        ? "后端放款率高于阈值，触发正向扩量策略：预算 +15%。"
        : "后端放款率低于阈值，触发风险拦截：预算削减 40% 并转移至高胜率渠道。",
      mode === "FULL_AUTO"
        ? "托管模式 = Full-Auto：直接调用广告 API 执行。"
        : "托管模式 = Semi-Auto：推送审批卡片，等待人工确认。",
    ],
    trigger_metric: "CostPerDisbursement",
    trigger_current_value: campaign.cps,
    trigger_threshold_value: 19,
    status: mode === "FULL_AUTO" ? "EXECUTED" : "PENDING_APPROVAL",
    effect: `日预算 $${campaign.dailyBudget.toLocaleString()} → $${nextBudget.toLocaleString()}`,
    rollback_to: `$${campaign.dailyBudget.toLocaleString()}`,
  };

  const { data: inserted } = await supabase
    .from("agent_decisions")
    .insert(row)
    .select("*")
    .maybeSingle();

  if (mode === "FULL_AUTO") {
    await supabase.from("campaigns").update({ daily_budget: nextBudget }).eq("id", campaign.id);
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

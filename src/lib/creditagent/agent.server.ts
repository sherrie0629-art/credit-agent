// Server-only data access + agent business logic backed by the Lovable Cloud database.
import type {
  AgentDecision,
  AgentSnapshot,
  Campaign,
  ChannelTrendPoint,
  CreativeAsset,
  CreativePlacement,
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

function mapDecision(r: Row): AgentDecision {
  return {
    id: r.id,
    timestamp: r.timestamp,
    agentType: r.agent_type,
    actionType: r.action_type,
    targetChannel: r.target_channel,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
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

/** All creative → campaign delivery links, enriched with campaign metadata. */
export async function getPlacements(): Promise<CreativePlacement[]> {
  const supabase = await db();
  const [{ data: links }, { data: campaigns }] = await Promise.all([
    supabase.from("creative_placements").select("*").order("share", { ascending: false }),
    supabase.from("campaigns").select("id,name,channel,placement"),
  ]);
  const byId = new Map(((campaigns ?? []) as Row[]).map((c) => [c.id, c]));
  return ((links ?? []) as Row[]).map((r) => {
    const c = byId.get(r.campaign_id);
    return {
      creativeId: r.creative_id,
      campaignId: r.campaign_id,
      campaignName: c?.name ?? r.campaign_id,
      channel: (c?.channel ?? "Google") as CreativePlacement["channel"],
      placement: c?.placement ?? "",
      status: r.status,
      share: Number(r.share),
      startedAt: r.started_at,
    };
  });
}

/** Primary (highest-share ACTIVE) campaign a creative is delivered in. */
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


export async function getSnapshot(): Promise<AgentSnapshot> {
  const supabase = await db();
  const { mapMetric, mapVariant, mapExperiment } = await import("./creative.server");
  const [
    decisions,
    campaigns,
    creatives,
    settings,
    funnel,
    trend,
    breakdown,
    metrics,
    variants,
    experiments,
  ] = await Promise.all([
    supabase.from("agent_decisions").select("*").order("timestamp", { ascending: false }),
    supabase.from("campaigns").select("*").order("sort_order"),
    supabase.from("creative_assets").select("*").order("sort_order"),
    supabase.from("agent_settings").select("*").eq("id", "default").maybeSingle(),
    supabase.from("funnel_stages").select("*").order("sort_order"),
    supabase.from("channel_trend").select("*").order("sort_order"),
    supabase.from("channel_breakdown").select("*").order("sort_order"),
    supabase.from("creative_metrics").select("*").order("day"),
    supabase.from("creative_variants").select("*").order("created_at", { ascending: false }),
    supabase.from("creative_experiments").select("*").order("started_at", { ascending: false }),
  ]);

  const s = (settings.data ?? {}) as Row;

  return {
    decisions: ((decisions.data ?? []) as Row[]).map(mapDecision),
    campaigns: ((campaigns.data ?? []) as Row[]).map(mapCampaign),
    creatives: ((creatives.data ?? []) as Row[]).map(mapCreative),
    mode: (s.mode ?? "SEMI_AUTO") as ManagementMode,
    riskFirst: s.risk_first ?? true,
    autoTakeovers: Number(s.auto_takeovers ?? 0),
    cpsImprovementPct: Number(s.cps_improvement_pct ?? 0),
    agentOnline: s.agent_online ?? true,
    funnel: ((funnel.data ?? []) as Row[]).map((r) => ({
      stage: r.stage,
      value: Number(r.value),
      note: r.note,
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
    channelBreakdown: ((breakdown.data ?? []) as Row[]).map((r) => ({
      channel: r.channel,
      spend: Number(r.spend),
      disbursed: Number(r.disbursed),
      cps: Number(r.cps),
      approval: Number(r.approval),
    })),
    creativeMetrics: ((metrics.data ?? []) as Row[]).map(mapMetric),
    variants: ((variants.data ?? []) as Row[]).map(mapVariant),
    experiments: ((experiments.data ?? []) as Row[]).map(mapExperiment),
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

async function getCampaign(id: string) {
  const supabase = await db();
  const { data } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  return data ? mapCampaign(data as Row) : null;
}

export async function approveDecision(id: string) {
  const supabase = await db();
  const { data } = await supabase.from("agent_decisions").select("*").eq("id", id).maybeSingle();
  if (!data) return getSnapshot();
  const decision = mapDecision(data as Row);

  await supabase.from("agent_decisions").update({ status: "EXECUTED" }).eq("id", id);
  await bumpTakeovers(1);

  if (decision.actionType === "BUDGET_SHIFT" && decision.id === "dec_1039") {
    await supabase
      .from("campaigns")
      .update({ daily_budget: 1400, ai_suggestion: "预算已按风控建议下调" })
      .eq("id", decision.campaignId);
  } else if (decision.actionType === "CREATIVE_PAUSE") {
    await supabase
      .from("campaigns")
      .update({ ai_suggestion: "低质素材已暂停，合规变体接量中" })
      .eq("id", decision.campaignId);
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

  const campaign = await getCampaign(decision.campaignId);
  if (campaign) {
    const patch: Row = { ai_suggestion: `已回滚至：${decision.rollbackTo ?? "原配置"}` };
    if (decision.id === "dec_1042" && campaign.id === "cmp_g_search_01") patch.daily_budget = 4200;
    if (decision.id === "dec_1041" && campaign.status === "COMPLIANCE_HOLD") patch.status = "ACTIVE";
    await supabase.from("campaigns").update(patch as never).eq("id", campaign.id);
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
  const paused = snapshot.campaigns.filter(
    (c) => c.channel === "Meta" && c.last20ApprovalRate < 0.1 && c.status === "ACTIVE",
  );
  if (paused.length === 0) {
    return { snapshot, pausedCampaigns: [] as string[] };
  }

  const baseId = await nextDecisionId();
  const rows = paused.map((c, i) => ({
    id: `${baseId}_${i}`,
    timestamp: new Date().toISOString(),
    agent_type: "Execution",
    action_type: "CREATIVE_PAUSE",
    target_channel: c.channel,
    campaign_id: c.id,
    campaign_name: c.name,
    confidence_score: 0.93,
    reasoning_chain: [
      `风控优先模式开启：检查 ${c.name} 近 20 条线索。`,
      `后端授信通过率 ${(c.last20ApprovalRate * 100).toFixed(1)}% < 阈值 10%。`,
      `实际放款成本 CPS $${c.cps.toFixed(2)}，高于账户目标 $19.00。`,
      "决策：自动暂停该广告组，预算暂存至 Planner 待分配池。",
    ],
    trigger_metric: "ApprovalRate",
    trigger_current_value: c.last20ApprovalRate,
    trigger_threshold_value: 0.1,
    status: "EXECUTED",
    effect: `${c.placement} 广告组自动暂停`,
    rollback_to: `${c.placement} ACTIVE / $${c.dailyBudget}`,
  }));

  await supabase.from("agent_decisions").insert(rows);
  for (const c of paused) {
    await supabase
      .from("campaigns")
      .update({ status: "PAUSED", ai_suggestion: "风控优先：授信通过率过低已自动暂停" })
      .eq("id", c.id);
  }
  await bumpTakeovers(rows.length);

  return { snapshot: await getSnapshot(), pausedCampaigns: paused.map((c) => c.name) };
}

export async function setCampaignStatus(id: string, status: Campaign["status"]) {
  const supabase = await db();
  await supabase
    .from("campaigns")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  return getSnapshot();
}

export async function setCampaignBudget(id: string, dailyBudget: number) {
  const supabase = await db();
  await supabase
    .from("campaigns")
    .update({ daily_budget: dailyBudget, updated_at: new Date().toISOString() })
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

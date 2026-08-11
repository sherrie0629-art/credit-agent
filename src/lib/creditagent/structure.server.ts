// 投放结构 CRUD（本地 DB 为 Source of Truth；LIVE Ads API 第二期）。
import { scanCompliance } from "./compliance";
import { checkBudgetChange } from "./guardrails";
import { loadLimits, recordGuardrail } from "./guardrails.server";
import { getSnapshot } from "./agent.server";
import {
  bidStrategiesFor,
  bidStrategyNeedsTarget,
  placementsFor,
  type AdGroupCreateStatus,
  type EditableStatus,
} from "./structure";
import type { Channel } from "./types";

/** Normalize bid_target: required positive number for tCPA / Cost Cap; otherwise null. */
function resolveBidTarget(bidStrategy: string, bidTarget: number | null | undefined): number | null {
  if (!bidStrategyNeedsTarget(bidStrategy)) return null;
  const n = Number(bidTarget);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) throw new Error("BID_TARGET_INVALID");
  return Math.round(n * 100) / 100;
}

type Row = Record<string, any>;

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)
    .toString(36)
    .padStart(3, "0")}`;
}

async function nextSortOrder(table: "campaigns" | "ad_groups" | "creative_assets") {
  const supabase = await db();
  const { data } = await supabase.from(table).select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const max = Number((data as Row[] | null)?.[0]?.sort_order ?? 0);
  return (Number.isFinite(max) ? max : 0) + 1;
}

export async function createCampaign(input: {
  name: string;
  channel: Channel;
  status?: EditableStatus;
  dailyBudget?: number;
}) {
  const supabase = await db();
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) throw new Error("NAME_INVALID");

  const id = newId(input.channel === "Google" ? "cmp_g" : "cmp_m");
  const status = input.status ?? "ACTIVE";
  const dailyBudget = Math.max(0, Math.round(input.dailyBudget ?? 0));
  const sortOrder = await nextSortOrder("campaigns");

  const { error } = await supabase.from("campaigns").insert({
    id,
    name,
    channel: input.channel,
    placement: "",
    status,
    daily_budget: dailyBudget,
    spent_today: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    approved_loans: 0,
    disbursed_amount: 0,
    cpl: 0,
    cps: 0,
    compliance_pass_rate: 1,
    last20_approval_rate: 0,
    ai_suggestion: "新建系列：待挂广告组与素材",
    sort_order: sortOrder,
  } as never);

  if (error) throw new Error(error.message);
  return { id, snapshot: await getSnapshot() };
}

export async function updateCampaign(
  id: string,
  patch: { name?: string; status?: EditableStatus; dailyBudget?: number },
) {
  const supabase = await db();
  const update: Row = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < 1 || name.length > 120) throw new Error("NAME_INVALID");
    update.name = name;
  }
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.dailyBudget !== undefined) update.daily_budget = Math.max(0, Math.round(patch.dailyBudget));

  const { error } = await supabase.from("campaigns").update(update as never).eq("id", id);
  if (error) throw new Error(error.message);
  return { snapshot: await getSnapshot() };
}

export async function createAdGroup(input: {
  campaignId: string;
  name: string;
  placement: string;
  audience: string;
  bidStrategy: string;
  bidTarget?: number | null;
  dailyBudget: number;
  status?: AdGroupCreateStatus;
}) {
  const supabase = await db();
  const { data: camp, error: campErr } = await supabase
    .from("campaigns")
    .select("id, name, channel, origin")
    .eq("id", input.campaignId)
    .maybeSingle();
  if (campErr) throw new Error(campErr.message);
  if (!camp) throw new Error("CAMPAIGN_NOT_FOUND");
  if ((camp as Row).origin === "google_sync" || (camp as Row).origin === "meta_sync") {
    throw new Error(
      "GOOGLE_SYNC_PARENT:不能在平台同步系列下新建广告组；请新建本地系列，或在广告后台建组后同步。",
    );
  }

  const channel = (camp as Row).channel as Channel;
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) throw new Error("NAME_INVALID");
  const audience = input.audience.trim();
  if (audience.length < 1 || audience.length > 240) throw new Error("AUDIENCE_INVALID");

  if (!placementsFor(channel).includes(input.placement)) throw new Error("PLACEMENT_INVALID");
  if (!bidStrategiesFor(channel).includes(input.bidStrategy)) throw new Error("BID_STRATEGY_INVALID");
  const bidTarget = resolveBidTarget(input.bidStrategy, input.bidTarget);

  const limits = await loadLimits();
  const requested = Math.round(input.dailyBudget);
  const verdict = checkBudgetChange(limits, { current: 0, next: requested });
  await recordGuardrail({
    action: "CREATE_AD_GROUP_BUDGET",
    targetId: input.campaignId,
    decision: verdict,
    requested: { dailyBudget: requested },
  });
  if (verdict.verdict === "DENY") throw new Error(`BUDGET_DENIED:${verdict.detail}`);
  const dailyBudget = verdict.verdict === "CLAMP" ? (verdict.value ?? requested) : requested;
  if (!(dailyBudget > 0)) throw new Error("BUDGET_INVALID");

  const id = newId(channel === "Google" ? "adg_g" : "adg_m");
  const status = input.status ?? "LEARNING";
  const sortOrder = await nextSortOrder("ad_groups");

  const { error } = await supabase.from("ad_groups").insert({
    id,
    campaign_id: input.campaignId,
    name,
    channel,
    placement: input.placement,
    audience,
    bid_strategy: input.bidStrategy,
    bid_target: bidTarget,
    status,
    daily_budget: dailyBudget,
    spent_today: 0,
    impressions: 0,
    clicks: 0,
    compliance_pass_rate: 1,
    ai_suggestion: "新建广告组：学习期，请绑定合规素材后放量",
    sort_order: sortOrder,
  } as never);

  if (error) throw new Error(error.message);
  return {
    id,
    campaignId: input.campaignId,
    guardrail: verdict.verdict === "CLAMP" ? verdict : null,
    snapshot: await getSnapshot(),
  };
}

export async function updateAdGroup(
  id: string,
  patch: {
    name?: string;
    placement?: string;
    audience?: string;
    bidStrategy?: string;
    bidTarget?: number | null;
    dailyBudget?: number;
    status?: AdGroupCreateStatus;
  },
) {
  const supabase = await db();
  const { data: row, error: readErr } = await supabase.from("ad_groups").select("*").eq("id", id).maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error("AD_GROUP_NOT_FOUND");

  const current = row as Row;
  const channel = current.channel as Channel;
  const update: Row = { updated_at: new Date().toISOString() };

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < 1 || name.length > 120) throw new Error("NAME_INVALID");
    update.name = name;
  }
  if (patch.audience !== undefined) {
    const audience = patch.audience.trim();
    if (audience.length < 1 || audience.length > 240) throw new Error("AUDIENCE_INVALID");
    update.audience = audience;
  }
  if (patch.placement !== undefined) {
    const allowed = new Set<string>([...placementsFor(channel), String(current.placement ?? "")]);
    if (!allowed.has(patch.placement)) throw new Error("PLACEMENT_INVALID");
    update.placement = patch.placement;
  }
  if (patch.bidStrategy !== undefined) {
    const allowed = new Set<string>([...bidStrategiesFor(channel), String(current.bid_strategy ?? "")]);
    if (!allowed.has(patch.bidStrategy)) throw new Error("BID_STRATEGY_INVALID");
    update.bid_strategy = patch.bidStrategy;
  }
  // Re-resolve bid_target whenever strategy or target changes.
  if (patch.bidStrategy !== undefined || patch.bidTarget !== undefined) {
    const nextStrategy = (patch.bidStrategy ?? current.bid_strategy) as string;
    const nextTarget =
      patch.bidTarget !== undefined
        ? patch.bidTarget
        : current.bid_target === null || current.bid_target === undefined
          ? null
          : Number(current.bid_target);
    update.bid_target = resolveBidTarget(nextStrategy, nextTarget);
  }
  if (patch.status !== undefined) update.status = patch.status;

  let guardrail = null;
  if (patch.dailyBudget !== undefined) {
    const limits = await loadLimits();
    const next = Math.round(patch.dailyBudget);
    const verdict = checkBudgetChange(limits, {
      current: Number(current.daily_budget),
      next,
    });
    await recordGuardrail({
      action: "UPDATE_AD_GROUP_BUDGET",
      targetId: id,
      decision: verdict,
      requested: { from: current.daily_budget, to: next },
    });
    if (verdict.verdict === "DENY") throw new Error(`BUDGET_DENIED:${verdict.detail}`);
    const applied = verdict.verdict === "CLAMP" ? (verdict.value ?? next) : next;
    update.daily_budget = applied;
    if (verdict.verdict === "CLAMP") guardrail = verdict;

    if (applied !== Number(current.daily_budget)) {
      const { syncExternalAdGroupBudget } = await import("./external-ads.server");
      await syncExternalAdGroupBudget(id, applied);
    }

    try {
      const { resetPidState } = await import("./pid.server");
      await resetPidState(id);
    } catch (e) {
      console.error("[pid] reset after structure budget edit failed", e);
    }
  }

  if (patch.status !== undefined && patch.status !== current.status) {
    const { syncExternalAdGroupStatus } = await import("./external-ads.server");
    await syncExternalAdGroupStatus(id, patch.status);
  }

  const { error } = await supabase.from("ad_groups").update(update as never).eq("id", id);
  if (error) throw new Error(error.message);
  return { guardrail, snapshot: await getSnapshot() };
}

export async function createCreative(input: {
  headline: string;
  bodyText: string;
  loanTermRange: string;
  maxApr: number;
  specialAdCategory?: boolean;
  imageUrl?: string | null;
}) {
  const supabase = await db();
  const headline = input.headline.trim();
  const bodyText = input.bodyText.trim();
  const loanTermRange = input.loanTermRange.trim();
  if (headline.length < 1 || headline.length > 200) throw new Error("HEADLINE_INVALID");
  if (bodyText.length < 1 || bodyText.length > 2000) throw new Error("BODY_INVALID");
  if (loanTermRange.length < 1 || loanTermRange.length > 80) throw new Error("TERM_INVALID");
  if (!(input.maxApr > 0) || input.maxApr > 100) throw new Error("APR_INVALID");

  const scan = scanCompliance({
    headline,
    bodyText,
    loanTermRange,
    maxApr: input.maxApr,
    specialAdCategory: Boolean(input.specialAdCategory),
  });

  const id = newId("crv");
  const sortOrder = await nextSortOrder("creative_assets");
  const logs = [
    ...scan.rules.filter((r) => !r.passed).map((r) => `${r.source}: ${r.detail}`),
    ...(input.specialAdCategory ? ["Meta: 已确认 Financial Products and Services 特殊广告类别。"] : []),
  ];

  const { error } = await supabase.from("creative_assets").insert({
    id,
    headline,
    body_text: bodyText,
    image_url: input.imageUrl ?? null,
    loan_term_range: loanTermRange,
    max_apr: input.maxApr,
    compliance_status: scan.status,
    compliance_logs: logs,
    fatigue_score: 0,
    fatigue_level: "HEALTHY",
    launched_at: new Date().toISOString(),
    sort_order: sortOrder,
  } as never);

  if (error) throw new Error(error.message);
  return {
    id,
    complianceStatus: scan.status,
    blocked: scan.blocked,
    snapshot: await getSnapshot(),
  };
}

export async function upsertPlacement(input: {
  adGroupId: string;
  creativeId: string;
  share: number;
  status?: "ACTIVE" | "PAUSED";
}) {
  const supabase = await db();
  const [{ data: group }, { data: creative }] = await Promise.all([
    supabase.from("ad_groups").select("id, campaign_id, channel").eq("id", input.adGroupId).maybeSingle(),
    supabase
      .from("creative_assets")
      .select("id, compliance_status, launched_at")
      .eq("id", input.creativeId)
      .maybeSingle(),
  ]);
  if (!group) throw new Error("AD_GROUP_NOT_FOUND");
  if (!creative) throw new Error("CREATIVE_NOT_FOUND");

  const status = input.status ?? "ACTIVE";
  if (status === "ACTIVE" && (creative as Row).compliance_status === "FAILED") {
    throw new Error("COMPLIANCE_BLOCKED");
  }

  const share = Number(input.share);
  if (!(share >= 0) || share > 1) throw new Error("SHARE_INVALID");

  const campaignId = (group as Row).campaign_id as string;
  const row = {
    creative_id: input.creativeId,
    ad_group_id: input.adGroupId,
    campaign_id: campaignId,
    share,
    status,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("creative_placements")
    .upsert(row as never, { onConflict: "creative_id,ad_group_id" });
  if (error) throw new Error(error.message);

  // Soft share check — warn via return, don't block.
  const { data: siblings } = await supabase
    .from("creative_placements")
    .select("share, status")
    .eq("ad_group_id", input.adGroupId);
  const activeSum = ((siblings ?? []) as Row[])
    .filter((p) => p.status === "ACTIVE")
    .reduce((s, p) => s + Number(p.share), 0);
  const shareWarning = activeSum < 0.95 || activeSum > 1.05;

  if (!(creative as Row).launched_at) {
    await supabase
      .from("creative_assets")
      .update({ launched_at: new Date().toISOString() } as never)
      .eq("id", input.creativeId);
  }

  return {
    shareWarning,
    activeShareSum: activeSum,
    snapshot: await getSnapshot(),
  };
}

export async function updatePlacementStatus(input: {
  adGroupId: string;
  creativeId: string;
  status: "ACTIVE" | "PAUSED";
}) {
  const supabase = await db();
  if (input.status === "ACTIVE") {
    const { data: creative } = await supabase
      .from("creative_assets")
      .select("compliance_status")
      .eq("id", input.creativeId)
      .maybeSingle();
    if ((creative as Row | null)?.compliance_status === "FAILED") {
      throw new Error("COMPLIANCE_BLOCKED");
    }
  }

  const { error } = await supabase
    .from("creative_placements")
    .update({ status: input.status, updated_at: new Date().toISOString() } as never)
    .eq("ad_group_id", input.adGroupId)
    .eq("creative_id", input.creativeId);
  if (error) throw new Error(error.message);
  return { snapshot: await getSnapshot() };
}

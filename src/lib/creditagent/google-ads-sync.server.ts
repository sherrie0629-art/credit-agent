/**
 * Google → Agent one-way structure sync (campaign / ad group / ad).
 * Never updates or deletes origin=demo rows.
 */
import { getSnapshot } from "./agent.server";
import { microsToDollars } from "./google-ads";
import {
  getGoogleAdsEnvStatus,
  searchAdGroupAds,
  searchAdGroups,
  searchCampaigns,
} from "./google-ads.server";
import { recordGuardrail } from "./guardrails.server";
import { hasServiceRole, LOCAL_WRITE_HINT } from "./read-client.server";

type Row = Record<string, any>;

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

function mapStatus(googleStatus: string): "ACTIVE" | "PAUSED" {
  const s = String(googleStatus).toUpperCase();
  if (s === "ENABLED" || s === "2") return "ACTIVE";
  return "PAUSED";
}

function mapAdStatus(googleStatus: string): "ACTIVE" | "PAUSED" {
  return mapStatus(googleStatus);
}

export type GoogleStructureSyncResult = {
  ok: boolean;
  message: string;
  campaignsUpserted: number;
  adGroupsUpserted: number;
  creativesUpserted: number;
  markedRemoved: number;
  error?: string;
  snapshot: Awaited<ReturnType<typeof getSnapshot>>;
};

export async function syncGoogleStructure(): Promise<GoogleStructureSyncResult> {
  const env = getGoogleAdsEnvStatus();
  const startedAt = new Date().toISOString();

  const empty = async (partial: Partial<GoogleStructureSyncResult> & { message: string }) => ({
    ok: false,
    campaignsUpserted: 0,
    adGroupsUpserted: 0,
    creativesUpserted: 0,
    markedRemoved: 0,
    snapshot: await getSnapshot(),
    ...partial,
  });

  if (env.mode !== "test") {
    return empty({ message: "GOOGLE_ADS_MODE 未打开（需 test）" });
  }
  if (!env.configured) {
    return empty({
      message: `凭证不完整，缺少：${env.missing.join(", ")}`,
    });
  }
  // Structure sync writes campaigns/ad_groups/creatives — needs service role.
  // Local Cursor is read-only by default; Lovable Cloud injects the key.
  if (!hasServiceRole()) {
    return empty({
      message: "本地为只读模式，无法写入结构镜像",
      error: LOCAL_WRITE_HINT,
    });
  }

  let supabase;
  try {
    supabase = await db();
  } catch (e) {
    return empty({
      message: "无法连接数据库（管理员密钥）",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  let campaignsUpserted = 0;
  let adGroupsUpserted = 0;
  let creativesUpserted = 0;
  let markedRemoved = 0;

  try {
    const [campaigns, adGroups, ads] = await Promise.all([
      searchCampaigns(),
      searchAdGroups(),
      searchAdGroupAds(),
    ]);
    const syncAt = new Date().toISOString();
    const seenCampaignIds = new Set<string>();
    const seenAdGroupIds = new Set<string>();
    const seenCreativeIds = new Set<string>();
    const adGroupToCampaign = new Map<string, string>();

    for (const c of campaigns) {
      if (!c.id || !c.resourceName) continue;
      const id = `g_cmp_${c.id}`;
      seenCampaignIds.add(id);
      const dailyBudget =
        c.budgetMicros != null ? Math.max(0, Math.round(microsToDollars(c.budgetMicros))) : 0;
      const row = {
        id,
        name: c.name || `Google Campaign ${c.id}`,
        channel: "Google",
        placement: "Google Sync",
        status: mapStatus(c.status),
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
        ai_suggestion: "Google 结构同步（只读镜像）",
        google_resource_name: c.resourceName,
        google_budget_resource_name: c.budgetResourceName,
        origin: "google_sync",
        google_sync_at: syncAt,
        platform_removed: false,
        updated_at: syncAt,
      };
      const { error } = await supabase.from("campaigns").upsert(row as never, { onConflict: "id" });
      if (error) throw new Error(`campaign upsert ${id}: ${error.message}`);
      campaignsUpserted += 1;
    }

    for (const g of adGroups) {
      if (!g.id || !g.resourceName) continue;
      const campaignGoogleId =
        g.campaignId ||
        (/campaigns\/(\d+)/.exec(g.campaignResourceName)?.[1] ?? "");
      if (!campaignGoogleId) continue;
      const campaignId = `g_cmp_${campaignGoogleId}`;
      if (!seenCampaignIds.has(campaignId)) {
        // Parent missing from campaign search — skip rather than orphan.
        continue;
      }
      const id = `g_adg_${g.id}`;
      seenAdGroupIds.add(id);
      adGroupToCampaign.set(id, campaignId);
      const parentBudget = campaigns.find((c) => c.id === campaignGoogleId);
      const dailyBudget =
        parentBudget?.budgetMicros != null
          ? Math.max(0, Math.round(microsToDollars(parentBudget.budgetMicros)))
          : 0;
      const row = {
        id,
        campaign_id: campaignId,
        name: g.name || `Google Ad Group ${g.id}`,
        channel: "Google",
        placement: "Google Sync",
        audience: "Google 同步受众（详见广告后台）",
        bid_strategy: "Maximize Conversions",
        bid_target: null,
        status: mapStatus(g.status),
        daily_budget: Math.max(1, dailyBudget || 1),
        spent_today: 0,
        impressions: 0,
        clicks: 0,
        compliance_pass_rate: 1,
        ai_suggestion: "Google 结构同步（只读镜像）；预算/暂停仍可托管推送",
        google_resource_name: g.resourceName,
        origin: "google_sync",
        google_sync_at: syncAt,
        platform_removed: false,
        updated_at: syncAt,
      };
      const { error } = await supabase.from("ad_groups").upsert(row as never, { onConflict: "id" });
      if (error) throw new Error(`ad_group upsert ${id}: ${error.message}`);
      adGroupsUpserted += 1;
    }

    for (const ad of ads) {
      if (!ad.id) continue;
      const adGroupId = `g_adg_${ad.adGroupId}`;
      if (!seenAdGroupIds.has(adGroupId)) continue;
      const id = `g_ad_${ad.id}`;
      seenCreativeIds.add(id);
      const creativeRow = {
        id,
        headline: ad.headline.slice(0, 200),
        body_text: ad.bodyText.slice(0, 2000),
        loan_term_range: "—",
        max_apr: 36,
        compliance_status: "PASSED",
        compliance_logs: ["Imported from Google Ads structure sync"],
        fatigue_level: "HEALTHY",
        fatigue_score: 0,
        image_url: null,
        launched_at: syncAt,
        origin: "google_sync",
        google_resource_name: ad.resourceName || null,
        google_sync_at: syncAt,
        platform_removed: false,
      };
      const { error: cErr } = await supabase
        .from("creative_assets")
        .upsert(creativeRow as never, { onConflict: "id" });
      if (cErr) throw new Error(`creative upsert ${id}: ${cErr.message}`);

      const placementStatus = mapAdStatus(ad.status) === "ACTIVE" ? "ACTIVE" : "PAUSED";
      const { error: pErr } = await supabase.from("creative_placements").upsert(
        {
          creative_id: id,
          ad_group_id: adGroupId,
          status: placementStatus,
          share: 1,
          started_at: syncAt,
        } as never,
        { onConflict: "creative_id,ad_group_id" },
      );
      if (pErr) {
        // Fallback if composite PK name differs: delete+insert
        await supabase
          .from("creative_placements")
          .delete()
          .eq("creative_id", id)
          .eq("ad_group_id", adGroupId);
        const { error: pErr2 } = await supabase.from("creative_placements").insert({
          creative_id: id,
          ad_group_id: adGroupId,
          status: placementStatus,
          share: 1,
          started_at: syncAt,
        } as never);
        if (pErr2) throw new Error(`placement upsert ${id}: ${pErr2.message}`);
      }
      creativesUpserted += 1;
    }

    // Soft-remove google_sync rows missing from this pull (never touch demo).
    const { data: existingCamps } = await supabase
      .from("campaigns")
      .select("id")
      .eq("origin", "google_sync")
      .eq("platform_removed", false);
    for (const row of (existingCamps as Row[] | null) ?? []) {
      if (!seenCampaignIds.has(row.id)) {
        await supabase
          .from("campaigns")
          .update({ platform_removed: true, updated_at: syncAt } as never)
          .eq("id", row.id)
          .eq("origin", "google_sync");
        markedRemoved += 1;
      }
    }

    const { data: existingGroups } = await supabase
      .from("ad_groups")
      .select("id")
      .eq("origin", "google_sync")
      .eq("platform_removed", false);
    for (const row of (existingGroups as Row[] | null) ?? []) {
      if (!seenAdGroupIds.has(row.id)) {
        await supabase
          .from("ad_groups")
          .update({ platform_removed: true, updated_at: syncAt } as never)
          .eq("id", row.id)
          .eq("origin", "google_sync");
        markedRemoved += 1;
      }
    }

    const { data: existingCreatives } = await supabase
      .from("creative_assets")
      .select("id")
      .eq("origin", "google_sync")
      .eq("platform_removed", false);
    for (const row of (existingCreatives as Row[] | null) ?? []) {
      if (!seenCreativeIds.has(row.id)) {
        await supabase
          .from("creative_assets")
          .update({ platform_removed: true } as never)
          .eq("id", row.id)
          .eq("origin", "google_sync");
        markedRemoved += 1;
      }
    }

    const message = `同步完成：系列 ${campaignsUpserted} · 广告组 ${adGroupsUpserted} · 广告 ${creativesUpserted} · 标记移除 ${markedRemoved}`;
    await supabase.from("google_structure_sync_runs").insert({
      started_at: startedAt,
      finished_at: syncAt,
      ok: true,
      campaigns_upserted: campaignsUpserted,
      ad_groups_upserted: adGroupsUpserted,
      creatives_upserted: creativesUpserted,
      marked_removed: markedRemoved,
      detail: {
        customerId: env.customerId,
        campaignCount: campaigns.length,
        adGroupCount: adGroups.length,
        adCount: ads.length,
      },
    } as never);

    await recordGuardrail({
      action: "GOOGLE_STRUCTURE_SYNC",
      decision: { verdict: "ALLOW", rule: "GOOGLE_ADS_PULL", detail: message },
      requested: {
        campaignsUpserted,
        adGroupsUpserted,
        creativesUpserted,
        markedRemoved,
      },
    });

    return {
      ok: true,
      message,
      campaignsUpserted,
      adGroupsUpserted,
      creativesUpserted,
      markedRemoved,
      snapshot: await getSnapshot(),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await supabase.from("google_structure_sync_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: false,
      campaigns_upserted: campaignsUpserted,
      ad_groups_upserted: adGroupsUpserted,
      creatives_upserted: creativesUpserted,
      marked_removed: markedRemoved,
      error: error.slice(0, 2000),
    } as never);
    return {
      ok: false,
      message: "同步失败",
      campaignsUpserted,
      adGroupsUpserted,
      creativesUpserted,
      markedRemoved,
      error,
      snapshot: await getSnapshot(),
    };
  }
}

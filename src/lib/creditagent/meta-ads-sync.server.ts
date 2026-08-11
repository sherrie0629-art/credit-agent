/**
 * Meta → Agent one-way structure sync (campaign / ad set / ad).
 * Never updates or deletes origin=demo or google_sync rows.
 */
import { getSnapshot } from "./agent.server";
import {
  getMetaAdsEnvStatus,
  metaCentsToDollars,
  searchAdSets,
  searchAds,
  searchCampaigns,
} from "./meta-ads.server";
import { recordGuardrail } from "./guardrails.server";
import { hasServiceRole, LOCAL_WRITE_HINT } from "./read-client.server";

type Row = Record<string, any>;

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

function mapStatus(metaStatus: string): "ACTIVE" | "PAUSED" {
  const s = String(metaStatus).toUpperCase();
  if (s === "ACTIVE" || s === "1") return "ACTIVE";
  return "PAUSED";
}

export type MetaStructureSyncResult = {
  ok: boolean;
  message: string;
  campaignsUpserted: number;
  adGroupsUpserted: number;
  creativesUpserted: number;
  markedRemoved: number;
  error?: string;
  snapshot: Awaited<ReturnType<typeof getSnapshot>>;
};

export async function syncMetaStructure(): Promise<MetaStructureSyncResult> {
  const env = getMetaAdsEnvStatus();

  const empty = async (partial: Partial<MetaStructureSyncResult> & { message: string }) => ({
    ok: false,
    campaignsUpserted: 0,
    adGroupsUpserted: 0,
    creativesUpserted: 0,
    markedRemoved: 0,
    snapshot: await getSnapshot(),
    ...partial,
  });

  if (env.mode !== "test") {
    return empty({ message: "META_ADS_MODE 未打开（需 test）" });
  }
  if (!env.configured) {
    return empty({ message: `凭证不完整，缺少：${env.missing.join(", ")}` });
  }
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
    const [campaigns, adSets, ads] = await Promise.all([
      searchCampaigns(),
      searchAdSets(),
      searchAds(),
    ]);
    const syncAt = new Date().toISOString();
    const seenCampaignIds = new Set<string>();
    const seenAdGroupIds = new Set<string>();
    const seenCreativeIds = new Set<string>();
    const adGroupToCampaign = new Map<string, string>();

    for (const c of campaigns) {
      if (!c.id) continue;
      const id = `m_cmp_${c.id}`;
      seenCampaignIds.add(id);
      const row = {
        id,
        name: c.name || `Meta Campaign ${c.id}`,
        channel: "Meta",
        placement: "Meta Sync",
        status: mapStatus(c.status),
        daily_budget: 0,
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
        ai_suggestion: "Meta 同步系列：结构只读，预算/启停走审批推送",
        origin: "meta_sync",
        meta_resource_name: c.id,
        meta_sync_at: syncAt,
        platform_removed: false,
        updated_at: syncAt,
      };
      const { error } = await supabase.from("campaigns").upsert(row as never, { onConflict: "id" });
      if (error) throw new Error(`campaign upsert ${id}: ${error.message}`);
      campaignsUpserted += 1;
    }

    for (const a of adSets) {
      if (!a.id || !a.campaignId) continue;
      const id = `m_adg_${a.id}`;
      const campaignId = `m_cmp_${a.campaignId}`;
      if (!seenCampaignIds.has(campaignId)) continue;
      seenAdGroupIds.add(id);
      adGroupToCampaign.set(id, campaignId);
      const dailyBudget =
        a.dailyBudgetCents != null
          ? Math.max(0, Math.round(metaCentsToDollars(a.dailyBudgetCents)))
          : 0;
      const row = {
        id,
        campaign_id: campaignId,
        name: a.name || `Meta Ad Set ${a.id}`,
        channel: "Meta",
        placement: "Feed",
        audience: "Meta Sync",
        bid_strategy: "Lowest Cost",
        bid_target: null,
        status: mapStatus(a.status),
        daily_budget: dailyBudget,
        spent_today: 0,
        impressions: 0,
        clicks: 0,
        compliance_pass_rate: 1,
        ai_suggestion: "Meta 同步 Ad Set：日预算推送目标为本组 meta_resource_name",
        origin: "meta_sync",
        meta_resource_name: a.id,
        meta_sync_at: syncAt,
        platform_removed: false,
        updated_at: syncAt,
      };
      const { error } = await supabase.from("ad_groups").upsert(row as never, { onConflict: "id" });
      if (error) throw new Error(`ad_group upsert ${id}: ${error.message}`);
      adGroupsUpserted += 1;
    }

    for (const ad of ads) {
      if (!ad.id || !ad.adSetId) continue;
      const id = `m_ad_${ad.id}`;
      const adGroupId = `m_adg_${ad.adSetId}`;
      if (!seenAdGroupIds.has(adGroupId)) continue;
      seenCreativeIds.add(id);
      const creativeRow = {
        id,
        headline: (ad.name || `Meta Ad ${ad.id}`).slice(0, 200),
        body_text: "Synced from Meta Ads",
        loan_term_range: "—",
        max_apr: 36,
        compliance_status: "PASSED",
        compliance_logs: ["Imported from Meta Ads structure sync"],
        fatigue_level: "HEALTHY",
        fatigue_score: 0,
        image_url: null,
        launched_at: syncAt,
        origin: "meta_sync",
        meta_resource_name: ad.id,
        meta_sync_at: syncAt,
        platform_removed: false,
      };
      const { error: cErr } = await supabase
        .from("creative_assets")
        .upsert(creativeRow as never, { onConflict: "id" });
      if (cErr) throw new Error(`creative upsert ${id}: ${cErr.message}`);

      const placementRow = {
        creative_id: id,
        campaign_id: adGroupToCampaign.get(adGroupId) ?? "",
        ad_group_id: adGroupId,
        status: mapStatus(ad.status) === "ACTIVE" ? "ACTIVE" : "PAUSED",
        share: 1,
        started_at: syncAt,
      };
      if (placementRow.campaign_id) {
        const { error: pErr } = await supabase
          .from("creative_placements")
          .upsert(placementRow as never, { onConflict: "creative_id,ad_group_id" });
        if (pErr) {
          await supabase
            .from("creative_placements")
            .delete()
            .eq("creative_id", id)
            .eq("ad_group_id", adGroupId);
          const { error: pErr2 } = await supabase
            .from("creative_placements")
            .insert(placementRow as never);
          if (pErr2) throw new Error(`placement upsert ${id}: ${pErr2.message}`);
        }
      }
      creativesUpserted += 1;
    }

    // Soft-remove meta_sync rows missing from this pull.
    const markRemoved = async (table: "campaigns" | "ad_groups" | "creative_assets", seen: Set<string>) => {
      const { data } = await supabase.from(table).select("id").eq("origin", "meta_sync");
      for (const r of (data ?? []) as Row[]) {
        const id = String(r.id);
        if (seen.has(id)) continue;
        const { error } = await supabase
          .from(table)
          .update({ platform_removed: true, updated_at: syncAt } as never)
          .eq("id", id)
          .eq("origin", "meta_sync");
        if (!error) markedRemoved += 1;
      }
    };
    await markRemoved("campaigns", seenCampaignIds);
    await markRemoved("ad_groups", seenAdGroupIds);
    await markRemoved("creative_assets", seenCreativeIds);

    await supabase.from("meta_structure_sync_runs").insert({
      started_at: syncAt,
      finished_at: new Date().toISOString(),
      ok: true,
      campaigns_upserted: campaignsUpserted,
      ad_groups_upserted: adGroupsUpserted,
      creatives_upserted: creativesUpserted,
      marked_removed: markedRemoved,
      detail: { adAccountId: env.adAccountId },
    } as never);

    await recordGuardrail({
      action: "META_STRUCTURE_SYNC",
      decision: {
        verdict: "ALLOW",
        rule: "META_ADS_TEST",
        detail: `Meta 结构同步：系列 ${campaignsUpserted} · Ad Set ${adGroupsUpserted} · 广告 ${creativesUpserted} · 软删 ${markedRemoved}`,
      },
      requested: { adAccountId: env.adAccountId },
    });

    return {
      ok: true,
      message: `已同步 Meta 结构：${campaignsUpserted} 系列 / ${adGroupsUpserted} Ad Set / ${creativesUpserted} 广告`,
      campaignsUpserted,
      adGroupsUpserted,
      creativesUpserted,
      markedRemoved,
      snapshot: await getSnapshot(),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    try {
      await supabase.from("meta_structure_sync_runs").insert({
        finished_at: new Date().toISOString(),
        ok: false,
        error,
      } as never);
    } catch {
      /* ignore */
    }
    return empty({ message: "Meta 结构同步失败", error });
  }
}

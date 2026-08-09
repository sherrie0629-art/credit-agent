// Thin RPC wrappers for Google Ads probe + binding helpers.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as ads from "./google-ads.server";
import { syncGoogleStructure } from "./google-ads-sync.server";
import { getSnapshot } from "./agent.server";

export const syncGoogleStructureFn = createServerFn({ method: "POST" }).handler(async () =>
  syncGoogleStructure(),
);

export const pingGoogleAdsFn = createServerFn({ method: "GET" }).handler(async () =>
  ads.pingGoogleAds(),
);

export const listGoogleAdsCampaignsFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        customerId: z.string().min(5).max(20).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const mode = ads.getGoogleAdsMode();
    if (mode !== "test") {
      return { mode, campaigns: [] as ads.GoogleAdsCampaignRow[], message: "MODE=off" };
    }
    try {
      const campaigns = await ads.searchCampaigns(data.customerId);
      return { mode, campaigns, message: `ok (${campaigns.length})` };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { mode, campaigns: [] as ads.GoogleAdsCampaignRow[], message };
    }
  });

export const listGoogleAdsAdGroupsFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        customerId: z.string().min(5).max(20).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const mode = ads.getGoogleAdsMode();
    if (mode !== "test") {
      return { mode, adGroups: [] as ads.GoogleAdsAdGroupRow[], message: "MODE=off" };
    }
    try {
      const adGroups = await ads.searchAdGroups(data.customerId);
      return { mode, adGroups, message: `ok (${adGroups.length})` };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { mode, adGroups: [] as ads.GoogleAdsAdGroupRow[], message };
    }
  });

export const bindGoogleCampaignFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        campaignId: z.string().min(1).max(120),
        googleResourceName: z.string().max(240).nullable(),
        googleBudgetResourceName: z.string().max(240).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("campaigns")
      .update({
        google_resource_name: data.googleResourceName?.trim() || null,
        google_budget_resource_name: data.googleBudgetResourceName?.trim() || null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", data.campaignId);
    if (error) throw new Error(error.message);
    return { snapshot: await getSnapshot() };
  });

export const bindGoogleAdGroupFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        adGroupId: z.string().min(1).max(120),
        googleResourceName: z.string().max(240).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ad_groups")
      .update({
        google_resource_name: data.googleResourceName?.trim() || null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", data.adGroupId);
    if (error) throw new Error(error.message);
    return { snapshot: await getSnapshot() };
  });

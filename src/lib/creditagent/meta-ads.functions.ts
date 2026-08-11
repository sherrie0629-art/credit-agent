// Thin RPC wrappers for Meta Ads probe + sync + QA.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as ads from "./meta-ads.server";
import { syncMetaStructure } from "./meta-ads-sync.server";
import { seedMetaAdsWriteTestDecisions } from "./meta-ads-write-qa.server";
import { getSnapshot } from "./agent.server";

export const syncMetaStructureFn = createServerFn({ method: "POST" }).handler(async () =>
  syncMetaStructure(),
);

export const seedMetaAdsWriteTestDecisionsFn = createServerFn({ method: "POST" }).handler(async () =>
  seedMetaAdsWriteTestDecisions(),
);

export const pingMetaAdsFn = createServerFn({ method: "GET" }).handler(async () => ads.pingMetaAds());

export const bindMetaCampaignFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        campaignId: z.string().min(1).max(120),
        metaResourceName: z.string().max(120).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("campaigns")
      .update({
        meta_resource_name: data.metaResourceName?.trim() || null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", data.campaignId);
    if (error) throw new Error(error.message);
    return { snapshot: await getSnapshot() };
  });

export const bindMetaAdGroupFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        adGroupId: z.string().min(1).max(120),
        metaResourceName: z.string().max(120).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ad_groups")
      .update({
        meta_resource_name: data.metaResourceName?.trim() || null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", data.adGroupId);
    if (error) throw new Error(error.message);
    return { snapshot: await getSnapshot() };
  });

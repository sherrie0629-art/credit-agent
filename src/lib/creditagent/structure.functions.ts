// Thin RPC wrappers — 真实逻辑在 ./structure.server。
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as structure from "./structure.server";

const editableStatus = z.enum(["ACTIVE", "PAUSED"]);
const adGroupStatus = z.enum(["ACTIVE", "PAUSED", "LEARNING"]);
const channel = z.enum(["Google", "Meta"]);

export const createCampaignFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        name: z.string().min(1).max(120),
        channel,
        status: editableStatus.optional(),
        dailyBudget: z.number().min(0).max(10_000_000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => structure.createCampaign(data));

export const updateCampaignFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().min(1).max(120),
        name: z.string().min(1).max(120).optional(),
        status: editableStatus.optional(),
        dailyBudget: z.number().min(0).max(10_000_000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { id, ...patch } = data;
    return structure.updateCampaign(id, patch);
  });

export const createAdGroupFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        campaignId: z.string().min(1).max(120),
        name: z.string().min(1).max(120),
        placement: z.string().min(1).max(80),
        audience: z.string().min(1).max(240),
        bidStrategy: z.string().min(1).max(80),
        bidTarget: z.number().positive().max(10_000_000).nullable().optional(),
        dailyBudget: z.number().positive().max(10_000_000),
        status: adGroupStatus.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => structure.createAdGroup(data));

export const updateAdGroupFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().min(1).max(120),
        name: z.string().min(1).max(120).optional(),
        placement: z.string().min(1).max(80).optional(),
        audience: z.string().min(1).max(240).optional(),
        bidStrategy: z.string().min(1).max(80).optional(),
        bidTarget: z.number().positive().max(10_000_000).nullable().optional(),
        dailyBudget: z.number().positive().max(10_000_000).optional(),
        status: adGroupStatus.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { id, ...patch } = data;
    return structure.updateAdGroup(id, patch);
  });

export const createCreativeFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        headline: z.string().min(1).max(200),
        bodyText: z.string().min(1).max(2000),
        loanTermRange: z.string().min(1).max(80),
        maxApr: z.number().positive().max(100),
        specialAdCategory: z.boolean().optional(),
        imageUrl: z.string().max(2000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => structure.createCreative(data));

export const upsertPlacementFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        adGroupId: z.string().min(1).max(120),
        creativeId: z.string().min(1).max(120),
        share: z.number().min(0).max(1),
        status: z.enum(["ACTIVE", "PAUSED"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => structure.upsertPlacement(data));

export const updatePlacementStatusFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        adGroupId: z.string().min(1).max(120),
        creativeId: z.string().min(1).max(120),
        status: z.enum(["ACTIVE", "PAUSED"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => structure.updatePlacementStatus(data));

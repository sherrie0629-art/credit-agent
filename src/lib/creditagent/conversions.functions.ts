// Thin RPC wrappers — all real logic lives in ./conversions.server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as conv from "./conversions.server";

export const fetchConversionSnapshot = createServerFn({ method: "GET" }).handler(async () =>
  conv.getConversionSnapshot(),
);

export const flushQueueFn = createServerFn({ method: "POST" }).handler(async () => {
  await conv.enqueuePendingUploads();
  const result = await conv.flushConversionQueue();
  return { result, snapshot: await conv.getConversionSnapshot() };
});

export const retryUploadFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ uploadId: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => conv.retryUpload(data.uploadId));

export const simulateBatchFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        leads: z.number().int().min(1).max(100),
        approvalRate: z.number().min(0).max(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const result = await conv.simulateBatch(data);
    return { result, snapshot: await conv.getConversionSnapshot() };
  });

export const updateConversionSettingFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        platform: z.enum(["google", "meta"]),
        mode: z.enum(["MOCK", "LIVE"]).optional(),
        enabled: z.boolean().optional(),
        destinationId: z.string().max(200).optional(),
        conversionAction: z.string().max(300).optional(),
        lookbackDays: z.number().int().min(1).max(180).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { platform, ...patch } = data;
    return conv.updateSetting(platform, patch);
  });

export const captureLeadFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        gclid: z.string().max(300).optional(),
        gbraid: z.string().max(300).optional(),
        wbraid: z.string().max(300).optional(),
        fbclid: z.string().max(300).optional(),
        fbp: z.string().max(300).optional(),
        fbc: z.string().max(300).optional(),
        email: z.string().email().max(200).optional(),
        phone: z.string().max(40).optional(),
        landingUrl: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => conv.captureLead(data));

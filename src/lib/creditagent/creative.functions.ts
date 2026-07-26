// Thin RPC wrappers — 真实逻辑在 ./creative.server。
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as creative from "./creative.server";

export const scanFatigueFn = createServerFn({ method: "POST" }).handler(async () =>
  creative.scanFatigue(),
);

export const generateVariantsFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ creativeId: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => creative.generateVariants(data.creativeId));

export const setVariantImageFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({ variantId: z.string().min(1).max(120), imageUrl: z.string().min(1).max(8_000_000) })
      .parse(d),
  )
  .handler(async ({ data }) => creative.setVariantImage(data.variantId, data.imageUrl));

export const launchExperimentFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        creativeId: z.string().min(1).max(120),
        variantIds: z.array(z.string().min(1).max(120)).min(1).max(10),
      })
      .parse(d),
  )
  .handler(async ({ data }) => creative.launchExperiment(data.creativeId, data.variantIds));

export const settleExperimentFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ experimentId: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => creative.settleExperiment(data.experimentId));

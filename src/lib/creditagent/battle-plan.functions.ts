/**
 * @deprecated Product path removed (option 2): AI 参谋 = propose-only via advisor.
 * Server fns retained unused; Command Center / store no longer call these.
 * Delete in a follow-up cleanup PR.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSnapshot } from "./agent.server";
import * as battle from "./battle-plan.server";

/** @deprecated */
export const runBattlePlanFn = createServerFn({ method: "POST" }).handler(async () => {
  const result = await battle.runBattlePlan();
  return { ...result, snapshot: await getSnapshot() };
});

/** @deprecated */
export const approveBattlePlanHighPriorityFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        decisionIds: z.array(z.string().min(1)).max(40),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const result = await battle.approveBattlePlanHighPriority(data.decisionIds);
    return { ...result, snapshot: await getSnapshot() };
  });

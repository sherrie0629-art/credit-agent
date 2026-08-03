// Thin RPC wrapper — 真实逻辑在 ./reallocate.server。
import { createServerFn } from "@tanstack/react-start";

import { runReallocation } from "./reallocate.server";

export const runReallocationFn = createServerFn({ method: "POST" }).handler(async () => {
  const { getSnapshot } = await import("./agent.server");
  const res = await runReallocation("MANUAL");
  return {
    snapshot: await getSnapshot(),
    skipped: "skipped" in res ? res.skipped : null,
    allocated: res.allocated,
    decisionId: res.decisionId,
    autoExecuted: "autoExecuted" in res ? res.autoExecuted : false,
    allocations: "allocations" in res ? (res.allocations ?? []) : [],
  };
});

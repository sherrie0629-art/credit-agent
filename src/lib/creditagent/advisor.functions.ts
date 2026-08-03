// Thin RPC wrapper — 真实逻辑在 ./advisor.server。
import { createServerFn } from "@tanstack/react-start";
import { getSnapshot } from "./agent.server";
import { runPlannerAdvisor } from "./advisor.server";

export const runAdvisorFn = createServerFn({ method: "POST" }).handler(async () => {
  const result = await runPlannerAdvisor("MANUAL");
  return { ...result, snapshot: await getSnapshot() };
});

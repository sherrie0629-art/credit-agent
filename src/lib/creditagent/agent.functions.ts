// Thin RPC wrappers — all real logic lives in ./agent.server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as agent from "./agent.server";

export const fetchSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  return agent.getSnapshot();
});

export const approveDecisionFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => agent.approveDecision(data.id));

export const rejectDecisionFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => agent.rejectDecision(data.id));

export const rollbackDecisionFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => agent.rollbackDecision(data.id));

export const setModeFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ mode: z.enum(["FULL_AUTO", "SEMI_AUTO"]) }).parse(d))
  .handler(async ({ data }) => agent.setMode(data.mode));

export const setRiskFirstFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ riskFirst: z.boolean() }).parse(d))
  .handler(async ({ data }) => agent.setRiskFirst(data.riskFirst));

export const setKillSwitchFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ on: z.boolean() }).parse(d))
  .handler(async ({ data }) => agent.setKillSwitch(data.on));

export const setRiskPostureFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ posture: z.enum(["GUARDED", "RISK_FIRST", "KILL_SWITCH"]) }).parse(d),
  )
  .handler(async ({ data }) => agent.setRiskPosture(data.posture));


export const setAdGroupStatusFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().min(1).max(120),
        status: z.enum(["ACTIVE", "PAUSED", "LEARNING", "COMPLIANCE_HOLD"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => agent.setAdGroupStatus(data.id, data.status));

export const setAdGroupBudgetFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        id: z.string().min(1).max(120),
        dailyBudget: z.number().int().positive().max(10_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => agent.setAdGroupBudget(data.id, data.dailyBudget));

export const applyAiSuggestionFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => agent.applyAiSuggestion(data.id));

export const logComplianceDecisionFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        headline: z.string().max(500),
        blocked: z.boolean(),
        score: z.number().min(0).max(100),
        reasons: z.array(z.string().max(500)).max(50),
      })
      .parse(d),
  )
  .handler(async ({ data }) => agent.logComplianceDecision(data));

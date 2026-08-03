import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";

import {
  applyAiSuggestionFn,
  approveDecisionFn,
  fetchSnapshot,
  logComplianceDecisionFn,
  rejectDecisionFn,
  rollbackDecisionFn,
  setAdGroupBudgetFn,
  setAdGroupStatusFn,
  setKillSwitchFn,
  setModeFn,


  setRiskFirstFn,
} from "./agent.functions";
import { runAdvisorFn } from "./advisor.functions";
import { runReallocationFn } from "./reallocate.functions";

import {
  generateVariantsFn,
  launchExperimentFn,
  scanFatigueFn,
  setVariantImageFn,
  settleExperimentFn,
} from "./creative.functions";
import type { AgentSnapshot, Campaign, ManagementMode } from "./types";

// Client-side cache of the real backend state. Every mutation goes through a
// server function that writes to the database and returns the fresh snapshot.

interface State extends AgentSnapshot {
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY: State = {
  decisions: [],
  campaigns: [],
  adGroups: [],
  creatives: [],
  mode: "SEMI_AUTO",
  riskFirst: true,
  autoTakeovers: 0,
  cpsImprovementPct: 0,
  agentOnline: true,
  killSwitch: false,
  guardrailLimits: {
    maxBudgetDeltaPct: 30,
    maxDailyBudgetDeltaPct: 50,
    maxAdGroupDailyBudget: 20000,
    maxActionsPerHour: 20,
  },

  funnel: [],
  channelTrend: [],
  channelBreakdown: [],
  creativeMetrics: [],
  variants: [],
  experiments: [],
  placements: [],
  feedbackHealth: [],
  budgetPool: {
    day: "",
    released: 0,
    allocated: 0,
    reserved: 0,
    balance: 0,
    lastAllocatedAt: null,
    entries: [],
  },


  loaded: false,
  loading: false,
  error: null,
};


let state: State = EMPTY;

const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applySnapshot(snapshot: AgentSnapshot) {
  set({ ...snapshot, loaded: true, loading: false, error: null });
}

export function useAgentStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(EMPTY),
  );
}

let inFlight: Promise<void> | null = null;

export function refreshAgentState() {
  if (inFlight) return inFlight;
  set({ loading: true, error: null });
  inFlight = fetchSnapshot()
    .then((snapshot) => applySnapshot(snapshot))
    .catch((err: unknown) => {
      console.error("[agent] snapshot fetch failed", err);
      set({ loading: false, error: "无法连接后端 API" });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Route loaders prefetch this so the snapshot ships with the SSR payload. */
export const agentSnapshotQuery = queryOptions({
  queryKey: ["agent-snapshot"],
  queryFn: () => fetchSnapshot(),
  staleTime: 30_000,
});

/** Feeds the SSR-prefetched snapshot into the store (called from the app shell). */
export function useAgentBootstrap() {
  const { data, error, isFetching } = useQuery(agentSnapshotQuery);

  useEffect(() => {
    if (data) applySnapshot(data);
  }, [data]);

  useEffect(() => {
    if (error) {
      console.error("[agent] snapshot fetch failed", error);
      set({ loading: false, error: "无法连接后端 API" });
    }
  }, [error]);

  useEffect(() => {
    if (isFetching && !state.loaded) set({ loading: true });
  }, [isFetching]);
}

/** Local-first update so the UI reacts instantly; the server reply reconciles. */
function optimistic(patch: Partial<State>) {
  set(patch);
}

export const agentApi = {
  async approveDecision(id: string) {
    applySnapshot(await approveDecisionFn({ data: { id } }));
  },

  async rejectDecision(id: string) {
    applySnapshot(await rejectDecisionFn({ data: { id } }));
  },

  async rollbackDecision(id: string) {
    const res = await rollbackDecisionFn({ data: { id } });
    applySnapshot(res.snapshot);
    return res.rolledBackTo;
  },

  async setMode(mode: ManagementMode) {
    optimistic({ mode });
    applySnapshot(await setModeFn({ data: { mode } }));
  },

  async setRiskFirst(riskFirst: boolean) {
    optimistic({ riskFirst });
    const res = await setRiskFirstFn({ data: { riskFirst } });
    applySnapshot(res.snapshot);
    return { pausedCampaigns: res.pausedCampaigns };
  },

  async setKillSwitch(on: boolean) {
    optimistic({ killSwitch: on });
    applySnapshot(await setKillSwitchFn({ data: { on } }));
  },



  async setAdGroupStatus(id: string, status: Campaign["status"]) {
    optimistic({ adGroups: state.adGroups.map((g) => (g.id === id ? { ...g, status } : g)) });
    applySnapshot(await setAdGroupStatusFn({ data: { id, status } }));
  },

  async setAdGroupBudget(id: string, dailyBudget: number) {
    optimistic({ adGroups: state.adGroups.map((g) => (g.id === id ? { ...g, dailyBudget } : g)) });
    const res = await setAdGroupBudgetFn({ data: { id, dailyBudget } });
    applySnapshot(res.snapshot);
    return res.guardrail;
  },



  async applyAiSuggestion(id: string) {
    const res = await applyAiSuggestionFn({ data: { id } });
    applySnapshot(res.snapshot);
    return res.decision;
  },

  async logComplianceDecision(payload: {
    headline: string;
    blocked: boolean;
    score: number;
    reasons: string[];
  }) {
    const res = await logComplianceDecisionFn({ data: payload });
    applySnapshot(res.snapshot);
    return res.decision;
  },

  async runAdvisor() {
    const res = await runAdvisorFn();
    applySnapshot(res.snapshot);
    return res;
  },

  /** 跨广告组预算再分配：把待分配池的资金转移到高胜率广告组。 */
  async runReallocation() {
    const res = await runReallocationFn();
    applySnapshot(res.snapshot);
    return res;
  },


  async scanFatigue() {
    const res = await scanFatigueFn();
    applySnapshot(res.snapshot);
    return res.alerts;
  },

  async generateVariants(creativeId: string) {
    const res = await generateVariantsFn({ data: { creativeId } });
    applySnapshot(res.snapshot);
    return res.created;
  },

  async setVariantImage(variantId: string, imageUrl: string) {
    applySnapshot(await setVariantImageFn({ data: { variantId, imageUrl } }));
  },

  async launchExperiment(creativeId: string, variantIds: string[]) {
    const res = await launchExperimentFn({ data: { creativeId, variantIds } });
    applySnapshot(res.snapshot);
    return res;
  },

  async settleExperiment(experimentId: string) {
    const res = await settleExperimentFn({ data: { experimentId } });
    applySnapshot(res.snapshot);
    return res;
  },
};

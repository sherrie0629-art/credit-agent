import { useEffect, useSyncExternalStore } from "react";
import {
  applyAiSuggestionFn,
  approveDecisionFn,
  fetchSnapshot,
  logComplianceDecisionFn,
  rejectDecisionFn,
  rollbackDecisionFn,
  setCampaignBudgetFn,
  setCampaignStatusFn,
  setModeFn,
  setRiskFirstFn,
} from "./agent.functions";
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
  creatives: [],
  mode: "SEMI_AUTO",
  riskFirst: true,
  autoTakeovers: 0,
  cpsImprovementPct: 0,
  agentOnline: true,
  funnel: [],
  channelTrend: [],
  channelBreakdown: [],
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
  set({ loading: true });
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

/** Loads the backend snapshot once per session (called from the app shell). */
export function useAgentBootstrap() {
  useEffect(() => {
    if (!state.loaded) void refreshAgentState();
  }, []);
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
    applySnapshot(await setModeFn({ data: { mode } }));
  },

  async setRiskFirst(riskFirst: boolean) {
    const res = await setRiskFirstFn({ data: { riskFirst } });
    applySnapshot(res.snapshot);
    return { pausedCampaigns: res.pausedCampaigns };
  },

  async setCampaignStatus(id: string, status: Campaign["status"]) {
    applySnapshot(await setCampaignStatusFn({ data: { id, status } }));
  },

  async setCampaignBudget(id: string, dailyBudget: number) {
    applySnapshot(await setCampaignBudgetFn({ data: { id, dailyBudget } }));
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
};

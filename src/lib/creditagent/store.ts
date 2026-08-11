import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";

import {
  applyAiSuggestionFn,
  approveDecisionFn,
  fetchSnapshot,
  logComplianceDecisionFn,
  rejectDecisionFn,
  rollbackDecisionFn,
  setAdGroupBudgetFn,
  setAdGroupStatusFn,
  setModeFn,
  setRiskPostureFn,
} from "./agent.functions";
import { runAdvisorFn } from "./advisor.functions";
import {
  runBattlePlanFn,
  approveBattlePlanHighPriorityFn,
} from "./battle-plan.functions";
import { runReallocationFn } from "./reallocate.functions";

import {
  generateVariantsFn,
  launchExperimentFn,
  scanFatigueFn,
  settleExperimentFn,
} from "./creative.functions";
import {
  bindGoogleAdGroupFn,
  bindGoogleCampaignFn,
  seedGoogleAdsWriteTestDecisionsFn,
  syncGoogleStructureFn,
} from "./google-ads.functions";
import {
  bindMetaAdGroupFn,
  bindMetaCampaignFn,
  seedMetaAdsWriteTestDecisionsFn,
  syncMetaStructureFn,
} from "./meta-ads.functions";
import {
  createAdGroupFn,
  createCampaignFn,
  createCreativeFn,
  updateAdGroupFn,
  updateCampaignFn,
  updatePlacementStatusFn,
  upsertPlacementFn,
} from "./structure.functions";
import type { AgentSnapshot, Campaign, Channel, ManagementMode, RiskPosture } from "./types";
import { deriveRiskPosture, flagsForRiskPosture } from "./types";

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
  riskPosture: "RISK_FIRST",
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
  const riskPosture =
    snapshot.riskPosture ?? deriveRiskPosture(snapshot.riskFirst, snapshot.killSwitch);
  set({ ...snapshot, riskPosture, loaded: true, loading: false, error: null });
}

export function useAgentStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(EMPTY),
  );
}

let inFlight: Promise<void> | null = null;

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 快照拉取带指数退避重试：开发服务器重启 / 网络抖动会让请求直接 "Load failed"，
 * 自动重试可以在服务恢复后把数据填回来，不需要用户手动刷新。
 */
async function fetchSnapshotWithRetry() {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetchSnapshot();
    } catch (err) {
      lastError = err;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      console.warn(`[agent] snapshot fetch failed, retrying in ${delay}ms`, err);
      await wait(delay);
    }
  }
  throw lastError;
}

export function refreshAgentState() {
  if (inFlight) return inFlight;
  set({ loading: true, error: null });
  inFlight = fetchSnapshotWithRetry()
    .then((snapshot) => applySnapshot(snapshot))
    .catch((err: unknown) => {
      console.error("[agent] snapshot fetch failed", err);
      // 保留上一次成功的数据，只挂错误标记，避免看板整片清空。
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
  // 切页时先用缓存立即渲染，过期后在后台静默刷新，避免导航被网络请求卡住。
  staleTime: 60_000,
  gcTime: 10 * 60_000,
  refetchOnWindowFocus: false,
  retry: 3,
  retryDelay: (attemptIndex) => Math.min(1_000 * 2 ** attemptIndex, 4_000),
});

/**
 * 路由 loader 用的非阻塞预取：首次加载（缓存为空 / SSR）时才等待数据，
 * 之后切页一律立即渲染上一次的缓存，新数据在后台静默到达。
 */
export function prefetchQueryNonBlocking(
  queryClient: QueryClient,
  options: { queryKey: readonly unknown[] },
) {
  const cached = queryClient.getQueryData(options.queryKey);
  const promise = queryClient
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .ensureQueryData(options as any)
    .catch(() => undefined);
  if (cached !== undefined) return undefined;
  return promise.then(() => undefined);
}

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
    const res = await approveDecisionFn({ data: { id } });
    // Local patch first — avoid waiting on full get_agent_snapshot.
    if (res.decision) {
      set({
        decisions: state.decisions.map((d) =>
          d.id === res.decision!.id
            ? {
                ...d,
                status: res.decision!.status,
                guardrailNote: res.decision!.guardrailNote ?? d.guardrailNote,
                externalMutateStatus: res.decision!.externalMutateStatus ?? d.externalMutateStatus,
                externalMutateDetail: res.decision!.externalMutateDetail ?? d.externalMutateDetail,
              }
            : d,
        ),
      });
    }
    if (res.adGroup) {
      set({
        adGroups: state.adGroups.map((g) =>
          g.id === res.adGroup!.id
            ? {
                ...g,
                dailyBudget: res.adGroup!.dailyBudget ?? g.dailyBudget,
                status: res.adGroup!.status ?? g.status,
                aiSuggestion: res.adGroup!.aiSuggestion ?? g.aiSuggestion,
              }
            : g,
        ),
      });
    }
    // Background reconcile with full snapshot (non-blocking).
    void fetchSnapshotWithRetry()
      .then((snapshot) => applySnapshot(snapshot))
      .catch((err) => console.warn("[agent] background snapshot after approve failed", err));
    return res.external ?? null;
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
    return agentApi.setRiskPosture(riskFirst ? "RISK_FIRST" : "GUARDED");
  },

  async setKillSwitch(on: boolean) {
    await agentApi.setRiskPosture(on ? "KILL_SWITCH" : "RISK_FIRST");
  },

  async setRiskPosture(posture: RiskPosture) {
    const flags = flagsForRiskPosture(posture);
    optimistic({ riskPosture: posture, ...flags });
    const res = await setRiskPostureFn({ data: { posture } });
    applySnapshot(res.snapshot);
    return { pausedCampaigns: res.pausedCampaigns };
  },



  async setAdGroupStatus(id: string, status: Campaign["status"]) {
    const prev = state.adGroups;
    optimistic({ adGroups: state.adGroups.map((g) => (g.id === id ? { ...g, status } : g)) });
    try {
      const res = await setAdGroupStatusFn({ data: { id, status } });
      applySnapshot(res.snapshot);
      return res.external ?? null;
    } catch (e) {
      set({ adGroups: prev });
      throw e;
    }
  },

  async setAdGroupBudget(id: string, dailyBudget: number) {
    const prev = state.adGroups;
    optimistic({ adGroups: state.adGroups.map((g) => (g.id === id ? { ...g, dailyBudget } : g)) });
    try {
      const res = await setAdGroupBudgetFn({ data: { id, dailyBudget } });
      applySnapshot(res.snapshot);
      return { guardrail: res.guardrail, external: res.external ?? null };
    } catch (e) {
      set({ adGroups: prev });
      throw e;
    }
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

  async runBattlePlan() {
    const res = await runBattlePlanFn();
    applySnapshot(res.snapshot);
    return res;
  },

  async approveBattlePlanHighPriority(decisionIds: string[]) {
    const res = await approveBattlePlanHighPriorityFn({ data: { decisionIds } });
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

  /** 主视觉保存走 /api/save-creative-image，返回后本地局部 patch，避免全量快照往返。 */
  setVariantImageUrl(variantId: string, imageUrl: string) {
    set({
      variants: state.variants.map((v) => (v.id === variantId ? { ...v, imageUrl } : v)),
    });
  },

  /** 原始素材主视觉的本地局部 patch。 */
  setAssetImageUrl(creativeId: string, imageUrl: string) {
    set({
      creatives: state.creatives.map((c) => (c.id === creativeId ? { ...c, imageUrl } : c)),
    });
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

  async createCampaign(input: {
    name: string;
    channel: Channel;
    status?: "ACTIVE" | "PAUSED";
    dailyBudget?: number;
  }) {
    const res = await createCampaignFn({ data: input });
    applySnapshot(res.snapshot);
    return res;
  },

  async updateCampaign(
    id: string,
    patch: { name?: string; status?: "ACTIVE" | "PAUSED"; dailyBudget?: number },
  ) {
    const res = await updateCampaignFn({ data: { id, ...patch } });
    applySnapshot(res.snapshot);
    return res;
  },

  async bindGoogleCampaign(
    campaignId: string,
    googleResourceName: string | null,
    googleBudgetResourceName: string | null,
  ) {
    const res = await bindGoogleCampaignFn({
      data: { campaignId, googleResourceName, googleBudgetResourceName },
    });
    applySnapshot(res.snapshot);
    return res;
  },

  async bindGoogleAdGroup(adGroupId: string, googleResourceName: string | null) {
    const res = await bindGoogleAdGroupFn({ data: { adGroupId, googleResourceName } });
    applySnapshot(res.snapshot);
    return res;
  },

  /** Google → Agent one-way structure pull (never mutates demo rows). */
  async syncGoogleStructure() {
    const res = await syncGoogleStructureFn();
    applySnapshot(res.snapshot);
    return res;
  },

  /** Seed PENDING cards that exercise Google Ads budget/status mutate on approve. */
  async seedGoogleAdsWriteTestDecisions() {
    const res = await seedGoogleAdsWriteTestDecisionsFn();
    applySnapshot(res.snapshot);
    return res;
  },

  async bindMetaCampaign(campaignId: string, metaResourceName: string | null) {
    const res = await bindMetaCampaignFn({ data: { campaignId, metaResourceName } });
    applySnapshot(res.snapshot);
    return res;
  },

  async bindMetaAdGroup(adGroupId: string, metaResourceName: string | null) {
    const res = await bindMetaAdGroupFn({ data: { adGroupId, metaResourceName } });
    applySnapshot(res.snapshot);
    return res;
  },

  async syncMetaStructure() {
    const res = await syncMetaStructureFn();
    applySnapshot(res.snapshot);
    return res;
  },

  async seedMetaAdsWriteTestDecisions() {
    const res = await seedMetaAdsWriteTestDecisionsFn();
    applySnapshot(res.snapshot);
    return res;
  },

  async createAdGroup(input: {
    campaignId: string;
    name: string;
    placement: string;
    audience: string;
    bidStrategy: string;
    bidTarget?: number | null;
    dailyBudget: number;
    status?: "ACTIVE" | "PAUSED" | "LEARNING";
  }) {
    const res = await createAdGroupFn({ data: input });
    applySnapshot(res.snapshot);
    return res;
  },

  async updateAdGroup(
    id: string,
    patch: {
      name?: string;
      placement?: string;
      audience?: string;
      bidStrategy?: string;
      bidTarget?: number | null;
      dailyBudget?: number;
      status?: "ACTIVE" | "PAUSED" | "LEARNING";
    },
  ) {
    const res = await updateAdGroupFn({ data: { id, ...patch } });
    applySnapshot(res.snapshot);
    return res;
  },

  async createCreative(input: {
    headline: string;
    bodyText: string;
    loanTermRange: string;
    maxApr: number;
    specialAdCategory?: boolean;
    imageUrl?: string | null;
  }) {
    const res = await createCreativeFn({ data: input });
    applySnapshot(res.snapshot);
    return res;
  },

  async upsertPlacement(input: {
    adGroupId: string;
    creativeId: string;
    share: number;
    status?: "ACTIVE" | "PAUSED";
  }) {
    const res = await upsertPlacementFn({ data: input });
    applySnapshot(res.snapshot);
    return res;
  },

  async updatePlacementStatus(input: {
    adGroupId: string;
    creativeId: string;
    status: "ACTIVE" | "PAUSED";
  }) {
    const res = await updatePlacementStatusFn({ data: input });
    applySnapshot(res.snapshot);
    return res;
  },
};

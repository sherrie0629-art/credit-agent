import { useSyncExternalStore } from "react";
import { initialCampaigns, initialCreatives, initialDecisions } from "./mock-data";
import type { AgentDecision, Campaign, CreativeAsset, ManagementMode } from "./types";

// Mock in-memory "API". Replaces Google Ads API / Meta Marketing API / Lending CRM.

interface State {
  decisions: AgentDecision[];
  campaigns: Campaign[];
  creatives: CreativeAsset[];
  mode: ManagementMode;
  riskFirst: boolean;
  autoTakeovers: number;
  cpsImprovementPct: number;
  agentOnline: boolean;
}

let state: State = {
  decisions: initialDecisions,
  campaigns: initialCampaigns,
  creatives: initialCreatives,
  mode: "SEMI_AUTO",
  riskFirst: true,
  autoTakeovers: 37,
  cpsImprovementPct: 18.4,
  agentOnline: true,
};

const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAgentStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

export const mockApiLatency = () => new Promise((r) => setTimeout(r, 420));

function nextId() {
  return `dec_${1043 + state.decisions.length}`;
}

function applyDecision(decision: AgentDecision) {
  const campaigns = state.campaigns.map((c) => {
    if (c.id !== decision.campaignId) return c;
    if (decision.actionType === "BUDGET_SHIFT" && decision.id === "dec_1039") {
      return { ...c, dailyBudget: 1400, aiSuggestion: "预算已按风控建议下调" };
    }
    if (decision.actionType === "CREATIVE_PAUSE") {
      return { ...c, aiSuggestion: "低质素材已暂停，合规变体接量中" };
    }
    return c;
  });
  set({ campaigns });
}

export const agentApi = {
  async approveDecision(id: string) {
    await mockApiLatency();
    const decision = state.decisions.find((d) => d.id === id);
    set({
      decisions: state.decisions.map((d) =>
        d.id === id ? { ...d, status: "EXECUTED" } : d,
      ),
      autoTakeovers: state.autoTakeovers + 1,
    });
    if (decision) applyDecision({ ...decision, status: "EXECUTED" });
  },

  async rejectDecision(id: string) {
    await mockApiLatency();
    set({
      decisions: state.decisions.map((d) =>
        d.id === id ? { ...d, status: "REJECTED_BY_USER" } : d,
      ),
    });
  },

  async rollbackDecision(id: string) {
    await mockApiLatency();
    const decision = state.decisions.find((d) => d.id === id);
    set({
      decisions: state.decisions.map((d) =>
        d.id === id ? { ...d, status: "ROLLED_BACK" } : d,
      ),
      campaigns: state.campaigns.map((c) =>
        decision && c.id === decision.campaignId
          ? {
              ...c,
              dailyBudget:
                decision.id === "dec_1042" && c.id === "cmp_g_search_01"
                  ? 4200
                  : c.dailyBudget,
              status: c.status === "COMPLIANCE_HOLD" && decision.id === "dec_1041" ? "ACTIVE" : c.status,
              aiSuggestion: `已回滚至：${decision.rollbackTo ?? "原配置"}`,
            }
          : c,
      ),
    });
    return decision?.rollbackTo ?? "原配置";
  },

  async setMode(mode: ManagementMode) {
    await mockApiLatency();
    set({ mode });
  },

  async setRiskFirst(riskFirst: boolean) {
    await mockApiLatency();
    if (!riskFirst) {
      set({ riskFirst });
      return { pausedCampaigns: [] as string[] };
    }
    const paused = state.campaigns.filter(
      (c) => c.channel === "Meta" && c.last20ApprovalRate < 0.1 && c.status === "ACTIVE",
    );
    const newDecisions: AgentDecision[] = paused.map((c, i) => ({
      id: `${nextId()}_${i}`,
      timestamp: new Date().toISOString(),
      agentType: "Execution",
      actionType: "CREATIVE_PAUSE",
      targetChannel: c.channel,
      campaignId: c.id,
      campaignName: c.name,
      confidenceScore: 0.93,
      reasoningChain: [
        `风控优先模式开启：检查 ${c.name} 近 20 条线索。`,
        `后端授信通过率 ${(c.last20ApprovalRate * 100).toFixed(1)}% < 阈值 10%。`,
        `实际放款成本 CPS $${c.cps.toFixed(2)}，高于账户目标 $19.00。`,
        "决策：自动暂停该广告组，预算暂存至 Planner 待分配池。",
      ],
      dataMetricsTrigger: {
        metric: "ApprovalRate",
        currentValue: c.last20ApprovalRate,
        thresholdValue: 0.1,
      },
      status: "EXECUTED",
      effect: `${c.placement} 广告组自动暂停`,
      rollbackTo: `${c.placement} ACTIVE / $${c.dailyBudget}`,
    }));

    set({
      riskFirst,
      campaigns: state.campaigns.map((c) =>
        paused.some((p) => p.id === c.id)
          ? { ...c, status: "PAUSED", aiSuggestion: "风控优先：授信通过率过低已自动暂停" }
          : c,
      ),
      decisions: [...newDecisions, ...state.decisions],
      autoTakeovers: state.autoTakeovers + newDecisions.length,
    });
    return { pausedCampaigns: paused.map((c) => c.name) };
  },

  async setCampaignStatus(id: string, status: Campaign["status"]) {
    await mockApiLatency();
    set({
      campaigns: state.campaigns.map((c) => (c.id === id ? { ...c, status } : c)),
    });
  },

  async setCampaignBudget(id: string, dailyBudget: number) {
    await mockApiLatency();
    set({
      campaigns: state.campaigns.map((c) => (c.id === id ? { ...c, dailyBudget } : c)),
    });
  },

  async applyAiSuggestion(id: string) {
    await mockApiLatency();
    const campaign = state.campaigns.find((c) => c.id === id);
    if (!campaign) return null;
    const scaleUp = campaign.last20ApprovalRate >= 0.22;
    const nextBudget = Math.round(campaign.dailyBudget * (scaleUp ? 1.15 : 0.6));
    const decision: AgentDecision = {
      id: nextId(),
      timestamp: new Date().toISOString(),
      agentType: "Planner",
      actionType: "BUDGET_SHIFT",
      targetChannel: campaign.channel,
      campaignId: campaign.id,
      campaignName: campaign.name,
      confidenceScore: scaleUp ? 0.89 : 0.82,
      reasoningChain: [
        `${campaign.name} 近 20 条线索授信通过率 ${(campaign.last20ApprovalRate * 100).toFixed(1)}%。`,
        `CPL $${campaign.cpl.toFixed(2)} / CPS $${campaign.cps.toFixed(2)}（目标 CPS $19.00）。`,
        scaleUp
          ? "后端放款率高于阈值，触发正向扩量策略：预算 +15%。"
          : "后端放款率低于阈值，触发风险拦截：预算削减 40% 并转移至高胜率渠道。",
        state.mode === "FULL_AUTO"
          ? "托管模式 = Full-Auto：直接调用广告 API 执行。"
          : "托管模式 = Semi-Auto：推送审批卡片，等待人工确认。",
      ],
      dataMetricsTrigger: {
        metric: "CostPerDisbursement",
        currentValue: campaign.cps,
        thresholdValue: 19,
      },
      status: state.mode === "FULL_AUTO" ? "EXECUTED" : "PENDING_APPROVAL",
      effect: `日预算 $${campaign.dailyBudget.toLocaleString()} → $${nextBudget.toLocaleString()}`,
      rollbackTo: `$${campaign.dailyBudget.toLocaleString()}`,
    };

    set({
      decisions: [decision, ...state.decisions],
      campaigns:
        state.mode === "FULL_AUTO"
          ? state.campaigns.map((c) =>
              c.id === id ? { ...c, dailyBudget: nextBudget } : c,
            )
          : state.campaigns,
      autoTakeovers: state.mode === "FULL_AUTO" ? state.autoTakeovers + 1 : state.autoTakeovers,
    });
    return decision;
  },

  async logComplianceDecision(payload: {
    headline: string;
    blocked: boolean;
    score: number;
    reasons: string[];
  }) {
    await mockApiLatency();
    const decision: AgentDecision = {
      id: nextId(),
      timestamp: new Date().toISOString(),
      agentType: "Compliance",
      actionType: payload.blocked ? "COMPLIANCE_REJECT" : "CREATIVE_PAUSE",
      targetChannel: "Meta",
      campaignId: "cmp_m_reels_04",
      campaignName: "Compliance & Creative Studio",
      confidenceScore: 0.97,
      reasoningChain: [
        `扫描素材：“${payload.headline || "(未命名素材)"}”`,
        `Compliance Score = ${payload.score}/100`,
        ...payload.reasons,
        payload.blocked
          ? "决策：阻断提交至广告 API，等待 Auto-Fix。"
          : "决策：允许提交，附加 Legal Disclaimer 后送审。",
      ],
      dataMetricsTrigger: { metric: "CPL", currentValue: payload.score, thresholdValue: 100 },
      status: "EXECUTED",
      effect: payload.blocked ? "素材提交已阻断" : "素材已通过合规并送审",
    };
    set({ decisions: [decision, ...state.decisions] });
    return decision;
  },
};

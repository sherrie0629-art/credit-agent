// Domain types for CreditAgent AI (per PRD §3). Mock-only, no real ad APIs.

export type AgentType = "Planner" | "Creative" | "Compliance" | "Execution";

export type ActionType =
  | "BUDGET_SHIFT"
  | "BID_ADJUST"
  | "CREATIVE_PAUSE"
  | "COMPLIANCE_REJECT";

export type Channel = "Google" | "Meta";

export type DecisionStatus =
  | "EXECUTED"
  | "PENDING_APPROVAL"
  | "REJECTED_BY_USER"
  | "ROLLED_BACK";

export interface AgentDecision {
  id: string;
  timestamp: string;
  agentType: AgentType;
  actionType: ActionType;
  targetChannel: Channel;
  campaignId: string;
  campaignName: string;
  confidenceScore: number; // 0.0 - 1.0
  reasoningChain: string[];
  dataMetricsTrigger: {
    metric: "CPL" | "ApprovalRate" | "CostPerDisbursement" | "ROAS";
    currentValue: number;
    thresholdValue: number;
  };
  status: DecisionStatus;
  /** Human-readable summary of the mutation, e.g. "Meta → Google $1,000". */
  effect: string;
  /** Snapshot used by rollback simulation. */
  rollbackTo?: string;
}

export interface Campaign {
  id: string;
  name: string;
  channel: Channel;
  placement: string;
  status: "ACTIVE" | "PAUSED" | "LEARNING" | "COMPLIANCE_HOLD";
  dailyBudget: number;
  spentToday: number;
  impressions: number;
  clicks: number;
  leads: number;
  approvedLoans: number;
  disbursedAmount: number;
  cpl: number;
  cps: number;
  compliancePassRate: number;
  /** Approval rate of the last 20 leads — drives risk-first auto-pause. */
  last20ApprovalRate: number;
  aiSuggestion: string;
}

export interface CreativeAsset {
  id: string;
  headline: string;
  bodyText: string;
  imageUrl?: string;
  loanTermRange: string;
  maxApr: number;
  complianceStatus: "PASSED" | "WARNING" | "FAILED";
  complianceLogs: string[];
}

export type ManagementMode = "FULL_AUTO" | "SEMI_AUTO";

export interface FunnelStage {
  stage: string;
  value: number;
}

export interface ChannelTrendPoint {
  day: string;
  googleFrontEndRoi: number;
  metaFrontEndRoi: number;
  googleTrueRoas: number;
  metaTrueRoas: number;
}

export interface FunnelStageRow extends FunnelStage {
  note: string;
}

export interface ChannelBreakdownRow {
  channel: string;
  spend: number;
  disbursed: number;
  cps: number;
  approval: number;
}

/** Full backend snapshot returned by the agent server API. */
export interface AgentSnapshot {
  decisions: AgentDecision[];
  campaigns: Campaign[];
  creatives: CreativeAsset[];
  mode: ManagementMode;
  riskFirst: boolean;
  autoTakeovers: number;
  cpsImprovementPct: number;
  agentOnline: boolean;
  funnel: FunnelStageRow[];
  channelTrend: ChannelTrendPoint[];
  channelBreakdown: ChannelBreakdownRow[];
}

// Domain types for CreditAgent AI (per PRD §3).
import type { CreativeExperiment, CreativeVariant } from "./creative-types";
import type { CreativeMetricPoint, FatigueLevel } from "./fatigue";

export type AgentType = "Planner" | "Creative" | "Compliance" | "Execution";

export type ActionType =
  | "BUDGET_SHIFT"
  | "BID_ADJUST"
  | "CREATIVE_PAUSE"
  | "COMPLIANCE_REJECT"
  | "CREATIVE_REFRESH"
  | "VARIANT_PROMOTE";

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
  /** Ad group (执行单元) the decision acts on, when applicable. */
  adGroupId?: string;
  adGroupName?: string;
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
  /** Creative asset this decision was about, when the decision is creative-driven. */
  creativeId?: string;
  creativeName?: string;
}

/** Ad group — the real execution unit under a campaign (Google/Meta hierarchy). */
export interface AdGroup {
  id: string;
  campaignId: string;
  campaignName: string;
  name: string;
  channel: Channel;
  placement: string;
  audience: string;
  bidStrategy: string;
  status: "ACTIVE" | "PAUSED" | "LEARNING" | "COMPLIANCE_HOLD";
  dailyBudget: number;
  spentToday: number;
  impressions: number;
  clicks: number;
  leads: number;
  approvedLoans: number;
  disbursedCount: number;
  disbursedAmount: number;
  cpl: number;
  cps: number;
  compliancePassRate: number;
  last20ApprovalRate: number;
  aiSuggestion: string;
}


/** Which campaigns a creative asset is currently delivered in. */
export interface CreativePlacement {
  creativeId: string;
  campaignId: string;
  campaignName: string;
  channel: Channel;
  placement: string;
  status: "ACTIVE" | "PAUSED" | "ENDED";
  /** Share of the campaign's delivery carried by this creative (0-1). */
  share: number;
  startedAt: string;
  /** Real facts for this creative×campaign pair, derived from lead events. */
  leads: number;
  approved: number;
  disbursedCount: number;
  disbursedAmount: number;
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

/** Backend (post-loan) truth for one creative, derived from leads + lead_events. */
export interface CreativeBackendFacts {
  spend: number;
  leads: number;
  approvedLoans: number;
  disbursedCount: number;
  disbursedAmount: number;
  cpl: number;
  cps: number;
  approvalRate: number;
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
  fatigueScore: number;
  fatigueLevel: FatigueLevel;
  launchedAt?: string;
  lastScannedAt?: string;
  /** Real downstream performance; undefined when the creative has no leads yet. */
  backend?: CreativeBackendFacts;
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
  campaignId?: string;
  spend: number;
  disbursed: number;
  cps: number;
  approval: number;
  /** Real lead / disbursement counts behind the money figures. */
  leads?: number;
  disbursedCount?: number;
}

/** Offline conversion feedback health, used to caveat platform-side CPS. */
export interface FeedbackHealth {
  channel: Channel;
  sent: number;
  attempted: number;
  successRate: number;
  /** Share of DB disbursements that never reached the ad platform. */
  gapRate: number;
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
  creativeMetrics: CreativeMetricPoint[];
  variants: CreativeVariant[];
  experiments: CreativeExperiment[];
  placements: CreativePlacement[];
  feedbackHealth: FeedbackHealth[];
}



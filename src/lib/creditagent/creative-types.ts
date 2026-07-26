// 创意变体与 A/B 实验的领域类型。
import type { FatigueLevel } from "./fatigue";

export type VariantStatus = "DRAFT" | "PENDING" | "RUNNING" | "WINNER" | "ELIMINATED" | "BLOCKED";

export interface CreativeVariant {
  id: string;
  parentCreativeId: string;
  experimentId?: string;
  headline: string;
  bodyText: string;
  imageUrl?: string;
  angle: string;
  complianceStatus: "PASSED" | "WARNING" | "FAILED";
  complianceScore: number;
  complianceLogs: string[];
  status: VariantStatus;
  createdAt: string;
}

export interface ExperimentArm {
  armId: string;
  label: string;
  kind: "CONTROL" | "VARIANT";
  impressions: number;
  clicks: number;
  ctr: number;
  cpl: number;
  cps: number;
  loans: number;
  confidence: number;
}

export interface CreativeExperiment {
  id: string;
  parentCreativeId: string;
  status: "RUNNING" | "DECIDED";
  startedAt: string;
  decidedAt?: string;
  winnerVariantId?: string;
  armStats: ExperimentArm[];
}

export interface CreativeFatigueState {
  fatigueScore: number;
  fatigueLevel: FatigueLevel;
  launchedAt?: string;
  lastScannedAt?: string;
}

export const VARIANT_STATUS_LABEL: Record<VariantStatus, string> = {
  DRAFT: "草稿",
  PENDING: "待审批",
  RUNNING: "实验中",
  WINNER: "胜出上线",
  ELIMINATED: "已淘汰",
  BLOCKED: "合规阻断",
};

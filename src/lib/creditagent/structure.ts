// 投放结构 MVP：版位 / 出价枚举（写死，避免自由输入失控）。
import type { Channel } from "./types";

export const GOOGLE_PLACEMENTS = ["Search", "PMax", "Display"] as const;
export const META_PLACEMENTS = ["Feed", "Reels", "Stories"] as const;

export const GOOGLE_BID_STRATEGIES = ["tCPA", "Maximize Conversions"] as const;
export const META_BID_STRATEGIES = ["Lowest Cost", "Cost Cap"] as const;

/** Strategies that require a numeric bid_target (tCPA target / Cost Cap). */
export const BID_STRATEGIES_NEEDING_TARGET = new Set<string>(["tCPA", "Cost Cap"]);

export type EditableStatus = "ACTIVE" | "PAUSED";
export type AdGroupCreateStatus = "ACTIVE" | "PAUSED" | "LEARNING";

export function placementsFor(channel: Channel): readonly string[] {
  return channel === "Google" ? GOOGLE_PLACEMENTS : META_PLACEMENTS;
}

export function bidStrategiesFor(channel: Channel): readonly string[] {
  return channel === "Google" ? GOOGLE_BID_STRATEGIES : META_BID_STRATEGIES;
}

export function bidStrategyNeedsTarget(bidStrategy: string): boolean {
  return BID_STRATEGIES_NEEDING_TARGET.has(bidStrategy);
}

/** Label for the bid_target field in the UI. */
export function bidTargetLabel(bidStrategy: string): string {
  if (bidStrategy === "Cost Cap") return "成本上限 Cost Cap $";
  return "目标 CPA $";
}

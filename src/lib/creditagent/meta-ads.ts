/** Client-safe Meta Ads helpers (types, errors, resource checks). */

export type MetaAdsMode = "off" | "test";

export type MetaExternalMutateStatus =
  | "SKIPPED_OFF"
  | "SKIPPED_NON_META"
  | "SKIPPED_KILL_SWITCH"
  | "SKIPPED_UNBOUND"
  | "PUSHED"
  | "FAILED";

export type MetaExternalMutateResult = {
  mode: MetaAdsMode;
  pushed: boolean;
  status: MetaExternalMutateStatus;
  detail: string;
  platform: "Meta";
  error?: string;
};

export class MetaAdsBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaAdsBindingError";
  }
}

export class MetaAdsApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaAdsApiError";
  }
}

export function parseMetaAdsMode(raw: string | undefined | null): MetaAdsMode {
  return (raw ?? "off").toLowerCase().trim() === "test" ? "test" : "off";
}

/** Normalize to act_123... */
export function normalizeAdAccountId(id: string): string {
  const raw = id.trim();
  if (!raw) return "";
  if (/^act_/i.test(raw)) return `act_${raw.replace(/^act_/i, "")}`;
  return `act_${raw.replace(/\D/g, "")}`;
}

/** Meta daily_budget is in account currency minor units (cents for USD). */
export function dollarsToMetaCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function metaCentsToDollars(cents: number): number {
  return cents / 100;
}

export function requireMetaBinding(input: {
  channel: string;
  adGroupId: string;
  adSetResourceName?: string | null;
}): void {
  if (input.channel !== "Meta") return;
  if (!input.adSetResourceName?.trim()) {
    throw new MetaAdsBindingError(
      `META_ADS_UNBOUND:广告组 ${input.adGroupId} 未绑定 meta_resource_name（Ad Set），拒绝推送 Meta Ads`,
    );
  }
}

export function toastForMetaExternal(ext?: MetaExternalMutateResult | null): {
  title: string;
  description?: string;
  kind: "success" | "info" | "error";
} {
  if (!ext) {
    return { title: "决策已批准（仅本地）", kind: "info" };
  }
  if (ext.pushed) {
    return { title: "已推送 Meta（test）", description: ext.detail, kind: "success" };
  }
  if (ext.status === "FAILED") {
    return { title: "Meta 推送失败", description: ext.detail, kind: "error" };
  }
  return { title: "已批准（仅本地）", description: ext.detail, kind: "info" };
}

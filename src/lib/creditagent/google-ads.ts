/** Client-safe Google Ads helpers (types, errors, resource checks). */

export type GoogleAdsMode = "off" | "test";

export type ExternalMutateStatus =
  | "SKIPPED_OFF"
  | "SKIPPED_NON_GOOGLE"
  | "SKIPPED_KILL_SWITCH"
  | "SKIPPED_UNBOUND"
  | "PUSHED"
  | "FAILED";

export type ExternalMutateResult = {
  mode: GoogleAdsMode;
  pushed: boolean;
  status: ExternalMutateStatus;
  detail: string;
  error?: string;
};

export class GoogleAdsBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAdsBindingError";
  }
}

export class GoogleAdsApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAdsApiError";
  }
}

export function parseGoogleAdsMode(raw: string | undefined | null): GoogleAdsMode {
  return (raw ?? "off").toLowerCase().trim() === "test" ? "test" : "off";
}

export function normalizeCustomerId(id: string): string {
  return id.replace(/-/g, "").trim();
}

export function dollarsToMicros(dollars: number): number {
  return Math.round(dollars * 1_000_000);
}

export function microsToDollars(micros: number): number {
  return micros / 1_000_000;
}

/** Reject mutate when Google channel lacks required resource bindings. */
export function requireGoogleBinding(input: {
  channel: string;
  adGroupId: string;
  adGroupResourceName?: string | null;
  campaignBudgetResourceName?: string | null;
  forBudget?: boolean;
}): void {
  if (input.channel !== "Google") return;
  if (!input.adGroupResourceName?.trim()) {
    throw new GoogleAdsBindingError(
      `GOOGLE_ADS_UNBOUND:广告组 ${input.adGroupId} 未绑定 google_resource_name，拒绝推送 Google Ads`,
    );
  }
  if (input.forBudget && !input.campaignBudgetResourceName?.trim()) {
    throw new GoogleAdsBindingError(
      `GOOGLE_ADS_UNBOUND:广告组 ${input.adGroupId} 所属系列未绑定 google_budget_resource_name，拒绝推送预算`,
    );
  }
}

export function toastForExternal(ext?: ExternalMutateResult | null): {
  title: string;
  description?: string;
  kind: "success" | "info" | "error";
} {
  if (!ext) {
    return { title: "决策已批准（仅本地）", kind: "info" };
  }
  if (ext.pushed) {
    const platform = /Meta/i.test(ext.detail) ? "Meta" : "Google";
    return { title: `已推送 ${platform}（test）`, description: ext.detail, kind: "success" };
  }
  if (ext.status === "FAILED") {
    const platform = /Meta/i.test(ext.detail) ? "Meta" : "Google";
    return { title: `${platform} 推送失败`, description: ext.detail, kind: "error" };
  }
  return { title: "已批准（仅本地）", description: ext.detail, kind: "info" };
}

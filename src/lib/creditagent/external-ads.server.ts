/**
 * Route ad-group budget/status pushes to Google or Meta by channel.
 * Returns the shared ExternalMutateResult shape used by approve/UI toasts.
 */
import type { ExternalMutateResult, ExternalMutateStatus, GoogleAdsMode } from "./google-ads";
import type { MetaExternalMutateResult } from "./meta-ads";

function mapMeta(m: MetaExternalMutateResult): ExternalMutateResult {
  const status: ExternalMutateStatus =
    m.status === "SKIPPED_NON_META"
      ? "SKIPPED_NON_GOOGLE"
      : (m.status as ExternalMutateStatus);
  const mode: GoogleAdsMode = m.mode === "test" ? "test" : "off";
  return {
    mode,
    pushed: m.pushed,
    status,
    detail: m.detail,
    error: m.error,
  };
}

export async function syncExternalAdGroupBudget(
  adGroupId: string,
  dailyBudgetDollars: number,
): Promise<ExternalMutateResult> {
  const { syncGoogleAdGroupBudget } = await import("./google-ads.server");
  const g = await syncGoogleAdGroupBudget(adGroupId, dailyBudgetDollars);
  if (g.status !== "SKIPPED_NON_GOOGLE") return g;
  const { syncMetaAdSetBudget } = await import("./meta-ads.server");
  return mapMeta(await syncMetaAdSetBudget(adGroupId, dailyBudgetDollars));
}

export async function syncExternalAdGroupStatus(
  adGroupId: string,
  status: "ACTIVE" | "PAUSED" | "LEARNING" | "COMPLIANCE_HOLD",
): Promise<ExternalMutateResult> {
  const { syncGoogleAdGroupStatus } = await import("./google-ads.server");
  const g = await syncGoogleAdGroupStatus(adGroupId, status);
  if (g.status !== "SKIPPED_NON_GOOGLE") return g;
  const { syncMetaAdSetStatus } = await import("./meta-ads.server");
  return mapMeta(await syncMetaAdSetStatus(adGroupId, status));
}

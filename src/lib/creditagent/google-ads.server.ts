/**
 * Server-only Google Ads API client (test account).
 * Secrets via process.env — never expose with VITE_ prefix.
 */
import { enums, GoogleAdsApi, toMicros } from "google-ads-api";
import {
  type ExternalMutateResult,
  type GoogleAdsMode,
  GoogleAdsApiError,
  GoogleAdsBindingError,
  normalizeCustomerId,
  parseGoogleAdsMode,
  requireGoogleBinding,
} from "./google-ads";
import { loadLimits, recordGuardrail } from "./guardrails.server";

type Row = Record<string, any>;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export function getGoogleAdsMode(): GoogleAdsMode {
  return parseGoogleAdsMode(process.env.GOOGLE_ADS_MODE);
}

export type GoogleAdsEnvStatus = {
  mode: GoogleAdsMode;
  configured: boolean;
  missing: string[];
  customerId: string | null;
  loginCustomerId: string | null;
};

export function getGoogleAdsEnvStatus(): GoogleAdsEnvStatus {
  const mode = getGoogleAdsMode();
  const required = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID",
  ] as const;
  const missing = required.filter((k) => !String(process.env[k] ?? "").trim());
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
    ? normalizeCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID)
    : null;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
    ? normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)
    : null;
  return {
    mode,
    configured: missing.length === 0,
    missing: [...missing],
    customerId,
    loginCustomerId,
  };
}

function requireLiveConfig() {
  const status = getGoogleAdsEnvStatus();
  if (status.mode !== "test") {
    throw new GoogleAdsApiError("GOOGLE_ADS_MODE is not test");
  }
  if (!status.configured) {
    throw new GoogleAdsApiError(
      `Google Ads 凭证不完整，缺少：${status.missing.join(", ")}`,
    );
  }
  return status;
}

export function getGoogleAdsClient() {
  const status = requireLiveConfig();
  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID!.trim(),
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!.trim(),
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!.trim(),
  });
  return { client, status };
}

export function getGoogleAdsCustomer(customerId?: string) {
  const { client, status } = getGoogleAdsClient();
  const cid = normalizeCustomerId(customerId ?? status.customerId!);
  const customer = client.Customer({
    customer_id: cid,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!.trim(),
    ...(status.loginCustomerId ? { login_customer_id: status.loginCustomerId } : {}),
  });
  return { customer, status, customerId: cid };
}

export async function listAccessibleCustomers(): Promise<string[]> {
  const { client } = getGoogleAdsClient();
  const response = (await client.listAccessibleCustomers(
    process.env.GOOGLE_ADS_REFRESH_TOKEN!.trim(),
  )) as { resource_names?: (string | null | undefined)[] } | string[];
  // Library types say ListAccessibleCustomersResponse; runtime may also be string[].
  if (Array.isArray(response)) return response;
  return (response.resource_names ?? []).filter((n): n is string => Boolean(n));
}

export type GoogleAdsCampaignRow = {
  id: string;
  name: string;
  status: string;
  resourceName: string;
  budgetResourceName: string | null;
  budgetMicros: number | null;
};

export async function searchCampaigns(customerId?: string): Promise<GoogleAdsCampaignRow[]> {
  const { customer } = getGoogleAdsCustomer(customerId);
  const rows = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.resource_name,
      campaign_budget.resource_name,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY campaign.id
    LIMIT 100
  `);

  return (rows as Row[]).map((r) => ({
    id: String(r.campaign?.id ?? ""),
    name: String(r.campaign?.name ?? ""),
    status: String(r.campaign?.status ?? ""),
    resourceName: String(r.campaign?.resource_name ?? ""),
    budgetResourceName: r.campaign_budget?.resource_name
      ? String(r.campaign_budget.resource_name)
      : null,
    budgetMicros:
      r.campaign_budget?.amount_micros != null
        ? Number(r.campaign_budget.amount_micros)
        : null,
  }));
}

export type GoogleAdsAdGroupRow = {
  id: string;
  name: string;
  status: string;
  resourceName: string;
  campaignResourceName: string;
};

export async function searchAdGroups(customerId?: string): Promise<GoogleAdsAdGroupRow[]> {
  const { customer } = getGoogleAdsCustomer(customerId);
  const rows = await customer.query(`
    SELECT
      ad_group.id,
      ad_group.name,
      ad_group.status,
      ad_group.resource_name,
      campaign.resource_name
    FROM ad_group
    WHERE ad_group.status != 'REMOVED'
    ORDER BY ad_group.id
    LIMIT 200
  `);

  return (rows as Row[]).map((r) => ({
    id: String(r.ad_group?.id ?? ""),
    name: String(r.ad_group?.name ?? ""),
    status: String(r.ad_group?.status ?? ""),
    resourceName: String(r.ad_group?.resource_name ?? ""),
    campaignResourceName: String(r.campaign?.resource_name ?? ""),
  }));
}

export async function mutateCampaignBudget(
  budgetResourceName: string,
  dailyBudgetDollars: number,
  customerId?: string,
) {
  const { customer } = getGoogleAdsCustomer(customerId);
  try {
    await customer.mutateResources([
      {
        entity: "campaign_budget",
        operation: "update",
        resource: {
          resource_name: budgetResourceName,
          amount_micros: toMicros(dailyBudgetDollars),
        },
      },
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new GoogleAdsApiError(`Google Ads 预算 mutate 失败：${msg}`);
  }
}

export async function mutateAdGroupStatus(
  adGroupResourceName: string,
  status: "ACTIVE" | "PAUSED" | "LEARNING" | "COMPLIANCE_HOLD",
  customerId?: string,
) {
  const { customer } = getGoogleAdsCustomer(customerId);
  const googleStatus =
    status === "PAUSED" || status === "COMPLIANCE_HOLD"
      ? enums.AdGroupStatus.PAUSED
      : enums.AdGroupStatus.ENABLED;
  try {
    await customer.mutateResources([
      {
        entity: "ad_group",
        operation: "update",
        resource: {
          resource_name: adGroupResourceName,
          status: googleStatus,
        },
      },
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new GoogleAdsApiError(`Google Ads 状态 mutate 失败：${msg}`);
  }
}

function skipped(
  mode: GoogleAdsMode,
  status: ExternalMutateResult["status"],
  detail: string,
): ExternalMutateResult {
  return { mode, pushed: false, status, detail };
}

/**
 * MODE=test + Google + bound → Ads first; on failure throw (caller must not fake local success).
 * MODE=off / non-Google / kill switch → skip with explicit detail (local write allowed).
 */
export async function syncGoogleAdGroupBudget(
  adGroupId: string,
  dailyBudgetDollars: number,
): Promise<ExternalMutateResult> {
  const mode = getGoogleAdsMode();
  const supabase = await db();
  const { data: group } = await supabase.from("ad_groups").select("*").eq("id", adGroupId).maybeSingle();
  if (!group) {
    return skipped(mode, "FAILED", `广告组 ${adGroupId} 不存在`);
  }
  const g = group as Row;
  if (g.channel !== "Google") {
    return skipped(mode, "SKIPPED_NON_GOOGLE", "非 Google 渠道，仅写本地");
  }
  if (mode !== "test") {
    return skipped("off", "SKIPPED_OFF", "GOOGLE_ADS_MODE=off，仅写本地");
  }

  const limits = await loadLimits();
  if (limits.killSwitch) {
    return skipped(mode, "SKIPPED_KILL_SWITCH", "熔断开启，未调用 Google Ads API");
  }

  const env = getGoogleAdsEnvStatus();
  if (!env.configured) {
    throw new GoogleAdsApiError(
      `GOOGLE_ADS_MODE=test 但凭证不完整，缺少：${env.missing.join(", ")}`,
    );
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, google_resource_name, google_budget_resource_name")
    .eq("id", g.campaign_id)
    .maybeSingle();
  const c = campaign as Row | null;

  requireGoogleBinding({
    channel: g.channel,
    adGroupId,
    adGroupResourceName: g.google_resource_name,
    campaignBudgetResourceName: c?.google_budget_resource_name,
    forBudget: true,
  });

  await mutateCampaignBudget(String(c!.google_budget_resource_name), dailyBudgetDollars);

  const detail = `已推送 Google（test）系列预算 $${dailyBudgetDollars} → ${c!.google_budget_resource_name}`;
  await recordGuardrail({
    action: "GOOGLE_ADS_MUTATE_BUDGET",
    targetId: adGroupId,
    decision: { verdict: "ALLOW", rule: "GOOGLE_ADS_TEST", detail },
    requested: {
      mode: "test",
      budgetResourceName: c!.google_budget_resource_name,
      dailyBudget: dailyBudgetDollars,
      adGroupResourceName: g.google_resource_name,
    },
  });

  return { mode, pushed: true, status: "PUSHED", detail };
}

export async function syncGoogleAdGroupStatus(
  adGroupId: string,
  status: "ACTIVE" | "PAUSED" | "LEARNING" | "COMPLIANCE_HOLD",
): Promise<ExternalMutateResult> {
  const mode = getGoogleAdsMode();
  const supabase = await db();
  const { data: group } = await supabase.from("ad_groups").select("*").eq("id", adGroupId).maybeSingle();
  if (!group) {
    return skipped(mode, "FAILED", `广告组 ${adGroupId} 不存在`);
  }
  const g = group as Row;
  if (g.channel !== "Google") {
    return skipped(mode, "SKIPPED_NON_GOOGLE", "非 Google 渠道，仅写本地");
  }
  if (mode !== "test") {
    return skipped("off", "SKIPPED_OFF", "GOOGLE_ADS_MODE=off，仅写本地");
  }

  const limits = await loadLimits();
  if (limits.killSwitch) {
    return skipped(mode, "SKIPPED_KILL_SWITCH", "熔断开启，未调用 Google Ads API");
  }

  const env = getGoogleAdsEnvStatus();
  if (!env.configured) {
    throw new GoogleAdsApiError(
      `GOOGLE_ADS_MODE=test 但凭证不完整，缺少：${env.missing.join(", ")}`,
    );
  }

  requireGoogleBinding({
    channel: g.channel,
    adGroupId,
    adGroupResourceName: g.google_resource_name,
    forBudget: false,
  });

  await mutateAdGroupStatus(String(g.google_resource_name), status);

  const detail = `已推送 Google（test）广告组状态 ${status} → ${g.google_resource_name}`;
  await recordGuardrail({
    action: "GOOGLE_ADS_MUTATE_STATUS",
    targetId: adGroupId,
    decision: { verdict: "ALLOW", rule: "GOOGLE_ADS_TEST", detail },
    requested: {
      mode: "test",
      adGroupResourceName: g.google_resource_name,
      status,
    },
  });

  return { mode, pushed: true, status: "PUSHED", detail };
}

export async function pingGoogleAds(): Promise<{
  ok: boolean;
  mode: GoogleAdsMode;
  message: string;
  env: GoogleAdsEnvStatus;
  customers?: string[];
  campaigns?: GoogleAdsCampaignRow[];
  error?: string;
}> {
  const env = getGoogleAdsEnvStatus();
  if (env.mode === "off") {
    return {
      ok: false,
      mode: "off",
      message: "未连接（GOOGLE_ADS_MODE=off）",
      env,
    };
  }
  if (!env.configured) {
    return {
      ok: false,
      mode: env.mode,
      message: `未连接：缺少 ${env.missing.join(", ")}`,
      env,
    };
  }

  try {
    const customers = await listAccessibleCustomers();
    const campaigns = await searchCampaigns(env.customerId ?? undefined);
    return {
      ok: true,
      mode: "test",
      message: `已连接测试户 ${env.customerId}（${campaigns.length} 个 campaign）`,
      env,
      customers,
      campaigns,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      mode: "test",
      message: "连接失败",
      env,
      error,
    };
  }
}

export { GoogleAdsBindingError, GoogleAdsApiError };

/**
 * Server-only Google Ads API client (test account).
 * Uses REST over HTTPS + SocksProxyAgent when GOOGLE_ADS_PROXY is set.
 * (google-ads-api gRPC does not honor SOCKS ALL_PROXY — probes hang without this path.)
 * Secrets via process.env — never expose with VITE_ prefix.
 */
import * as https from "node:https";
import { SocksProxyAgent } from "socks-proxy-agent";
import {
  type ExternalMutateResult,
  type GoogleAdsMode,
  dollarsToMicros,
  GoogleAdsApiError,
  GoogleAdsBindingError,
  normalizeCustomerId,
  parseGoogleAdsMode,
  requireGoogleBinding,
} from "./google-ads";
import { loadLimits, recordGuardrail } from "./guardrails.server";

type Row = Record<string, any>;

const PING_TIMEOUT_MS = 20_000;
const ADS_API_TIMEOUT_MS = 20_000;
const ADS_API_VERSION = "v24";

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

/** Resolve proxy URL for Ads REST (SOCKS required on many China networks). */
function ensureAdsProxy(): string | null {
  const proxy = (
    process.env.GOOGLE_ADS_PROXY ||
    process.env.ALL_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    ""
  ).trim();
  return proxy || null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new GoogleAdsApiError(
          `${label}超时（${Math.round(ms / 1000)}s）。Google 未响应，本地未改动。请确认代理可用后重试。`,
        ),
      );
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function proxyAgent(): SocksProxyAgent | undefined {
  const proxy = ensureAdsProxy();
  if (!proxy) return undefined;
  if (!/^socks/i.test(proxy) && !/^https?:\/\//i.test(proxy)) {
    throw new GoogleAdsApiError(`不支持的代理格式：${proxy.slice(0, 32)}`);
  }
  // SocksProxyAgent also accepts http(s) CONNECT proxies in recent versions via proxy-agent chain;
  // for plain socks5h:// this is the correct agent.
  return new SocksProxyAgent(proxy);
}

type AdsHttpResult = { status: number; text: string };

async function adsHttps(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<AdsHttpResult> {
  const agent = proxyAgent();
  if (!agent && !process.env.GOOGLE_ADS_ALLOW_DIRECT) {
    // Still try direct — but China networks usually need proxy.
  }
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: init.method ?? "GET",
        headers: init.headers,
        agent,
        timeout: PING_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(
        new GoogleAdsApiError(`Google 未响应（HTTPS 超时），本地未改动：${u.hostname}`),
      );
    });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.accessToken;

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID!.trim(),
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!.trim(),
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!.trim(),
    grant_type: "refresh_token",
  }).toString();

  const res = await withTimeout(
    adsHttps("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": String(Buffer.byteLength(body)),
      },
      body,
    }),
    ADS_API_TIMEOUT_MS,
    "OAuth token 刷新",
  );
  if (res.status < 200 || res.status >= 300) {
    throw new GoogleAdsApiError(`OAuth token 刷新失败 HTTP ${res.status}: ${res.text.slice(0, 240)}`);
  }
  const json = JSON.parse(res.text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new GoogleAdsApiError("OAuth token 响应缺少 access_token");
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: now + (Number(json.expires_in) || 3600) * 1000,
  };
  return json.access_token;
}

async function adsApi(
  path: string,
  init: { method?: string; body?: unknown; customerId?: string } = {},
): Promise<Row> {
  const status = requireLiveConfig();
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!.trim(),
    "Content-Type": "application/json",
  };
  const loginId = status.loginCustomerId;
  if (loginId) headers["login-customer-id"] = loginId;

  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  if (body) headers["Content-Length"] = String(Buffer.byteLength(body));

  const res = await withTimeout(
    adsHttps(`https://googleads.googleapis.com/${ADS_API_VERSION}/${path}`, {
      method: init.method ?? (body ? "POST" : "GET"),
      headers,
      body,
    }),
    ADS_API_TIMEOUT_MS,
    "Google Ads API ",
  );
  if (res.status < 200 || res.status >= 300) {
    throw new GoogleAdsApiError(`Google Ads API HTTP ${res.status}: ${res.text.slice(0, 400)}`);
  }
  return res.text ? (JSON.parse(res.text) as Row) : {};
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

export type GoogleAdsCampaignRow = {
  id: string;
  name: string;
  status: string;
  resourceName: string;
  budgetResourceName: string | null;
  budgetMicros: number | null;
};

export type GoogleAdsAdGroupRow = {
  id: string;
  name: string;
  status: string;
  resourceName: string;
  campaignResourceName: string;
  campaignId: string;
};

function customerIdFromResource(resourceName: string, fallback?: string | null): string {
  const m = /^customers\/(\d+)\//.exec(resourceName);
  if (m?.[1]) return m[1];
  if (fallback) return normalizeCustomerId(fallback);
  const status = requireLiveConfig();
  return status.customerId!;
}

export async function listAccessibleCustomers(): Promise<string[]> {
  requireLiveConfig();
  const json = await adsApi("customers:listAccessibleCustomers", { method: "GET" });
  const names = (json.resourceNames ?? json.resource_names ?? []) as string[];
  return names.filter(Boolean);
}

export async function searchCampaigns(customerId?: string): Promise<GoogleAdsCampaignRow[]> {
  const status = requireLiveConfig();
  const cid = normalizeCustomerId(customerId ?? status.customerId!);
  const json = await adsApi(`customers/${cid}/googleAds:search`, {
    method: "POST",
    body: {
      query: `
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
      `,
    },
  });
  const rows = (json.results ?? []) as Row[];
  return rows.map((r) => ({
    id: String(r.campaign?.id ?? ""),
    name: String(r.campaign?.name ?? ""),
    status: String(r.campaign?.status ?? ""),
    resourceName: String(r.campaign?.resourceName ?? r.campaign?.resource_name ?? ""),
    budgetResourceName: r.campaignBudget?.resourceName
      ? String(r.campaignBudget.resourceName)
      : r.campaign_budget?.resource_name
        ? String(r.campaign_budget.resource_name)
        : null,
    budgetMicros:
      r.campaignBudget?.amountMicros != null
        ? Number(r.campaignBudget.amountMicros)
        : r.campaign_budget?.amount_micros != null
          ? Number(r.campaign_budget.amount_micros)
          : null,
  }));
}

export async function searchAdGroups(customerId?: string): Promise<GoogleAdsAdGroupRow[]> {
  const status = requireLiveConfig();
  const cid = normalizeCustomerId(customerId ?? status.customerId!);
  const json = await adsApi(`customers/${cid}/googleAds:search`, {
    method: "POST",
    body: {
      query: `
        SELECT
          ad_group.id,
          ad_group.name,
          ad_group.status,
          ad_group.resource_name,
          campaign.id,
          campaign.resource_name
        FROM ad_group
        WHERE ad_group.status != 'REMOVED'
        ORDER BY ad_group.id
        LIMIT 200
      `,
    },
  });
  const rows = (json.results ?? []) as Row[];
  return rows.map((r) => ({
    id: String(r.adGroup?.id ?? r.ad_group?.id ?? ""),
    name: String(r.adGroup?.name ?? r.ad_group?.name ?? ""),
    status: String(r.adGroup?.status ?? r.ad_group?.status ?? ""),
    resourceName: String(
      r.adGroup?.resourceName ?? r.ad_group?.resource_name ?? "",
    ),
    campaignResourceName: String(
      r.campaign?.resourceName ?? r.campaign?.resource_name ?? "",
    ),
    campaignId: String(r.campaign?.id ?? ""),
  }));
}

export type GoogleAdsAdRow = {
  id: string;
  resourceName: string;
  status: string;
  adGroupId: string;
  campaignId: string;
  headline: string;
  bodyText: string;
};

export async function searchAdGroupAds(customerId?: string): Promise<GoogleAdsAdRow[]> {
  const status = requireLiveConfig();
  const cid = normalizeCustomerId(customerId ?? status.customerId!);
  const json = await adsApi(`customers/${cid}/googleAds:search`, {
    method: "POST",
    body: {
      query: `
        SELECT
          ad_group_ad.ad.id,
          ad_group_ad.resource_name,
          ad_group_ad.status,
          ad_group_ad.ad.responsive_search_ad.headlines,
          ad_group_ad.ad.responsive_search_ad.descriptions,
          ad_group_ad.ad.name,
          ad_group.id,
          campaign.id
        FROM ad_group_ad
        WHERE ad_group_ad.status != 'REMOVED'
        ORDER BY ad_group_ad.ad.id
        LIMIT 500
      `,
    },
  });
  const rows = (json.results ?? []) as Row[];
  return rows.map((r) => {
    const ad = r.adGroupAd?.ad ?? r.ad_group_ad?.ad ?? {};
    const rsa = ad.responsiveSearchAd ?? ad.responsive_search_ad ?? {};
    const headlines = (rsa.headlines ?? []) as Array<{ text?: string } | string>;
    const descriptions = (rsa.descriptions ?? []) as Array<{ text?: string } | string>;
    const headlineTexts = headlines
      .map((h) => (typeof h === "string" ? h : h.text ?? ""))
      .filter(Boolean);
    const descTexts = descriptions
      .map((d) => (typeof d === "string" ? d : d.text ?? ""))
      .filter(Boolean);
    const name = String(ad.name ?? "");
    return {
      id: String(ad.id ?? ""),
      resourceName: String(
        r.adGroupAd?.resourceName ?? r.ad_group_ad?.resource_name ?? "",
      ),
      status: String(r.adGroupAd?.status ?? r.ad_group_ad?.status ?? ""),
      adGroupId: String(r.adGroup?.id ?? r.ad_group?.id ?? ""),
      campaignId: String(r.campaign?.id ?? ""),
      headline: headlineTexts[0] || name || `Google Ad ${ad.id ?? ""}`,
      bodyText: descTexts[0] || headlineTexts.slice(1).join(" · ") || "（Google 同步广告，无描述）",
    };
  });
}

export async function mutateCampaignBudget(
  budgetResourceName: string,
  dailyBudgetDollars: number,
  customerId?: string,
) {
  const cid = customerIdFromResource(budgetResourceName, customerId);
  try {
    await adsApi(`customers/${cid}/googleAds:mutate`, {
      method: "POST",
      body: {
        mutateOperations: [
          {
            campaignBudgetOperation: {
              update: {
                resourceName: budgetResourceName,
                amountMicros: String(dollarsToMicros(dailyBudgetDollars)),
              },
              updateMask: "amountMicros",
            },
          },
        ],
      },
    });
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
  const cid = customerIdFromResource(adGroupResourceName, customerId);
  const googleStatus =
    status === "PAUSED" || status === "COMPLIANCE_HOLD" ? "PAUSED" : "ENABLED";
  try {
    await adsApi(`customers/${cid}/googleAds:mutate`, {
      method: "POST",
      body: {
        mutateOperations: [
          {
            adGroupOperation: {
              update: {
                resourceName: adGroupResourceName,
                status: googleStatus,
              },
              updateMask: "status",
            },
          },
        ],
      },
    });
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
    const customers = await withTimeout(
      listAccessibleCustomers(),
      PING_TIMEOUT_MS,
      "listAccessibleCustomers",
    );
    const campaigns = await withTimeout(
      searchCampaigns(env.customerId ?? undefined),
      PING_TIMEOUT_MS,
      "searchCampaigns",
    );
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

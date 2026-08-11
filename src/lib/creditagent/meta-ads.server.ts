/**
 * Server-only Meta Marketing API client (test account).
 * Graph REST over HTTPS + optional SocksProxyAgent
 * (META_ADS_PROXY, else GOOGLE_ADS_PROXY / ALL_PROXY / HTTPS_PROXY / HTTP_PROXY).
 * Secrets via process.env — never VITE_.
 */
import * as https from "node:https";
import { SocksProxyAgent } from "socks-proxy-agent";
import {
  type MetaAdsMode,
  type MetaExternalMutateResult,
  MetaAdsApiError,
  dollarsToMetaCents,
  metaCentsToDollars,
  normalizeAdAccountId,
  parseMetaAdsMode,
  requireMetaBinding,
} from "./meta-ads";
import { loadLimits, recordGuardrail } from "./guardrails.server";

type Row = Record<string, any>;

const PING_TIMEOUT_MS = 20_000;
const ADS_API_TIMEOUT_MS = 20_000;

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

function graphVersion(): string {
  return (process.env.META_GRAPH_VERSION || "v21.0").trim() || "v21.0";
}

function ensureAdsProxy(): string | null {
  const proxy = (
    process.env.META_ADS_PROXY ||
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
        new MetaAdsApiError(
          `${label}超时（${Math.round(ms / 1000)}s）。Meta 未响应，本地未改动。请确认代理可用后重试。`,
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
    throw new MetaAdsApiError(`不支持的代理格式：${proxy.slice(0, 32)}`);
  }
  return new SocksProxyAgent(proxy);
}

type HttpResult = { status: number; text: string };

async function graphHttps(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<HttpResult> {
  const agent = proxyAgent();
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
      req.destroy(new MetaAdsApiError(`Meta 未响应（HTTPS 超时），本地未改动：${u.hostname}`));
    });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

export function getMetaAdsMode(): MetaAdsMode {
  return parseMetaAdsMode(process.env.META_ADS_MODE);
}

export type MetaAdsEnvStatus = {
  mode: MetaAdsMode;
  configured: boolean;
  missing: string[];
  adAccountId: string | null;
  graphVersion: string;
};

export function getMetaAdsEnvStatus(): MetaAdsEnvStatus {
  const mode = getMetaAdsMode();
  const token = process.env.META_ACCESS_TOKEN?.trim() || "";
  const accountRaw = process.env.META_AD_ACCOUNT_ID?.trim() || "";
  const missing: string[] = [];
  if (!token) missing.push("META_ACCESS_TOKEN");
  if (!accountRaw) missing.push("META_AD_ACCOUNT_ID");
  return {
    mode,
    configured: missing.length === 0,
    missing,
    adAccountId: accountRaw ? normalizeAdAccountId(accountRaw) : null,
    graphVersion: graphVersion(),
  };
}

function accessToken(): string {
  const t = process.env.META_ACCESS_TOKEN?.trim();
  if (!t) throw new MetaAdsApiError("缺少 META_ACCESS_TOKEN");
  return t;
}

async function graphGet<T = Row>(path: string, fields?: string): Promise<T> {
  const qs = new URLSearchParams({ access_token: accessToken() });
  if (fields) qs.set("fields", fields);
  const url = `https://graph.facebook.com/${graphVersion()}${path}?${qs}`;
  const res = await withTimeout(graphHttps(url, { method: "GET" }), ADS_API_TIMEOUT_MS, `GET ${path}`);
  if (res.status < 200 || res.status >= 300) {
    throw new MetaAdsApiError(`Meta Graph GET ${path} HTTP ${res.status}: ${res.text.slice(0, 280)}`);
  }
  const json = JSON.parse(res.text) as T & { error?: { message?: string } };
  if (json && typeof json === "object" && "error" in json && (json as Row).error) {
    throw new MetaAdsApiError(
      `Meta Graph 错误：${String((json as Row).error?.message ?? res.text).slice(0, 280)}`,
    );
  }
  return json;
}

async function graphPost(path: string, body: Record<string, string | number>): Promise<Row> {
  const params = new URLSearchParams({ access_token: accessToken() });
  for (const [k, v] of Object.entries(body)) params.set(k, String(v));
  const url = `https://graph.facebook.com/${graphVersion()}${path}`;
  const payload = params.toString();
  const res = await withTimeout(
    graphHttps(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": String(Buffer.byteLength(payload)),
      },
      body: payload,
    }),
    ADS_API_TIMEOUT_MS,
    `POST ${path}`,
  );
  if (res.status < 200 || res.status >= 300) {
    throw new MetaAdsApiError(`Meta Graph POST ${path} HTTP ${res.status}: ${res.text.slice(0, 280)}`);
  }
  const json = JSON.parse(res.text) as Row;
  if (json.error) {
    throw new MetaAdsApiError(`Meta Graph 错误：${String(json.error?.message ?? res.text).slice(0, 280)}`);
  }
  return json;
}

export type MetaCampaignRow = {
  id: string;
  name: string;
  status: string;
  objective?: string;
};

export type MetaAdSetRow = {
  id: string;
  name: string;
  status: string;
  campaignId: string;
  dailyBudgetCents: number | null;
};

export type MetaAdRow = {
  id: string;
  name: string;
  status: string;
  adSetId: string;
};

async function paginateData<T extends Row>(
  path: string,
  fields: string,
  map: (row: Row) => T | null,
): Promise<T[]> {
  const out: T[] = [];
  let nextPath: string | null = path;
  let first = true;
  while (nextPath) {
    type Page = { data?: Row[]; paging?: { next?: string } };
    let json: Page;
    if (first) {
      json = await graphGet<Page>(nextPath, fields);
    } else {
      const res = await withTimeout(
        graphHttps(nextPath, { method: "GET" }),
        ADS_API_TIMEOUT_MS,
        "paginate",
      );
      if (res.status < 200 || res.status >= 300) {
        throw new MetaAdsApiError(`Meta 分页失败 HTTP ${res.status}`);
      }
      json = JSON.parse(res.text) as Page;
    }
    first = false;
    for (const row of json.data ?? []) {
      const mapped = map(row);
      if (mapped) out.push(mapped);
    }
    nextPath = json.paging?.next ?? null;
    if (out.length > 500) break;
  }
  return out;
}

export async function listAdAccounts(): Promise<{ id: string; name: string; accountStatus?: number }[]> {
  const json = await graphGet<{ data?: Row[] }>("/me/adaccounts", "id,name,account_status,currency");
  return (json.data ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? r.id),
    accountStatus: r.account_status != null ? Number(r.account_status) : undefined,
  }));
}

export async function searchCampaigns(adAccountId?: string): Promise<MetaCampaignRow[]> {
  const act = normalizeAdAccountId(adAccountId || process.env.META_AD_ACCOUNT_ID || "");
  if (!act) throw new MetaAdsApiError("缺少 META_AD_ACCOUNT_ID");
  return paginateData(`/${act}/campaigns`, "id,name,status,objective", (r) => {
    if (!r.id) return null;
    return {
      id: String(r.id),
      name: String(r.name ?? r.id),
      status: String(r.status ?? "PAUSED"),
      objective: r.objective ? String(r.objective) : undefined,
    };
  });
}

export async function searchAdSets(adAccountId?: string): Promise<MetaAdSetRow[]> {
  const act = normalizeAdAccountId(adAccountId || process.env.META_AD_ACCOUNT_ID || "");
  if (!act) throw new MetaAdsApiError("缺少 META_AD_ACCOUNT_ID");
  return paginateData(
    `/${act}/adsets`,
    "id,name,status,campaign_id,daily_budget",
    (r) => {
      if (!r.id) return null;
      const cents = r.daily_budget != null ? Number(r.daily_budget) : null;
      return {
        id: String(r.id),
        name: String(r.name ?? r.id),
        status: String(r.status ?? "PAUSED"),
        campaignId: String(r.campaign_id ?? ""),
        dailyBudgetCents: Number.isFinite(cents as number) ? (cents as number) : null,
      };
    },
  );
}

export async function searchAds(adAccountId?: string): Promise<MetaAdRow[]> {
  const act = normalizeAdAccountId(adAccountId || process.env.META_AD_ACCOUNT_ID || "");
  if (!act) throw new MetaAdsApiError("缺少 META_AD_ACCOUNT_ID");
  return paginateData(`/${act}/ads`, "id,name,status,adset_id", (r) => {
    if (!r.id) return null;
    return {
      id: String(r.id),
      name: String(r.name ?? r.id),
      status: String(r.status ?? "PAUSED"),
      adSetId: String(r.adset_id ?? ""),
    };
  });
}

export async function mutateAdSetBudget(adSetId: string, dailyBudgetDollars: number): Promise<void> {
  const cents = dollarsToMetaCents(dailyBudgetDollars);
  if (!(cents > 0)) throw new MetaAdsApiError("日预算必须大于 0");
  await graphPost(`/${adSetId}`, { daily_budget: cents });
}

export async function mutateAdSetStatus(
  adSetId: string,
  status: "ACTIVE" | "PAUSED" | "LEARNING" | "COMPLIANCE_HOLD",
): Promise<void> {
  const metaStatus = status === "ACTIVE" || status === "LEARNING" ? "ACTIVE" : "PAUSED";
  await graphPost(`/${adSetId}`, { status: metaStatus });
}

function skipped(
  mode: MetaAdsMode,
  status: MetaExternalMutateResult["status"],
  detail: string,
): MetaExternalMutateResult {
  return { mode, pushed: false, status, detail, platform: "Meta" };
}

export async function syncMetaAdSetBudget(
  adGroupId: string,
  dailyBudgetDollars: number,
): Promise<MetaExternalMutateResult> {
  const mode = getMetaAdsMode();
  const supabase = await db();
  const { data: group } = await supabase.from("ad_groups").select("*").eq("id", adGroupId).maybeSingle();
  if (!group) return skipped(mode, "FAILED", `广告组 ${adGroupId} 不存在`);
  const g = group as Row;
  if (g.channel !== "Meta") {
    return skipped(mode, "SKIPPED_NON_META", "非 Meta 渠道，仅写本地");
  }
  if (mode !== "test") {
    return skipped("off", "SKIPPED_OFF", "META_ADS_MODE=off，仅写本地");
  }

  const limits = await loadLimits();
  if (limits.killSwitch) {
    return skipped(mode, "SKIPPED_KILL_SWITCH", "熔断开启，未调用 Meta Ads API");
  }

  const env = getMetaAdsEnvStatus();
  if (!env.configured) {
    throw new MetaAdsApiError(`META_ADS_MODE=test 但凭证不完整，缺少：${env.missing.join(", ")}`);
  }

  requireMetaBinding({
    channel: g.channel,
    adGroupId,
    adSetResourceName: g.meta_resource_name,
  });

  await mutateAdSetBudget(String(g.meta_resource_name), dailyBudgetDollars);

  const detail = `已推送 Meta（test）Ad Set 日预算 $${dailyBudgetDollars} → ${g.meta_resource_name}`;
  await recordGuardrail({
    action: "META_ADS_MUTATE_BUDGET",
    targetId: adGroupId,
    decision: { verdict: "ALLOW", rule: "META_ADS_TEST", detail },
    requested: {
      mode: "test",
      adSetId: g.meta_resource_name,
      dailyBudget: dailyBudgetDollars,
      dailyBudgetCents: dollarsToMetaCents(dailyBudgetDollars),
    },
  });

  return { mode, pushed: true, status: "PUSHED", detail, platform: "Meta" };
}

export async function syncMetaAdSetStatus(
  adGroupId: string,
  status: "ACTIVE" | "PAUSED" | "LEARNING" | "COMPLIANCE_HOLD",
): Promise<MetaExternalMutateResult> {
  const mode = getMetaAdsMode();
  const supabase = await db();
  const { data: group } = await supabase.from("ad_groups").select("*").eq("id", adGroupId).maybeSingle();
  if (!group) return skipped(mode, "FAILED", `广告组 ${adGroupId} 不存在`);
  const g = group as Row;
  if (g.channel !== "Meta") {
    return skipped(mode, "SKIPPED_NON_META", "非 Meta 渠道，仅写本地");
  }
  if (mode !== "test") {
    return skipped("off", "SKIPPED_OFF", "META_ADS_MODE=off，仅写本地");
  }

  const limits = await loadLimits();
  if (limits.killSwitch) {
    return skipped(mode, "SKIPPED_KILL_SWITCH", "熔断开启，未调用 Meta Ads API");
  }

  const env = getMetaAdsEnvStatus();
  if (!env.configured) {
    throw new MetaAdsApiError(`META_ADS_MODE=test 但凭证不完整，缺少：${env.missing.join(", ")}`);
  }

  requireMetaBinding({
    channel: g.channel,
    adGroupId,
    adSetResourceName: g.meta_resource_name,
  });

  await mutateAdSetStatus(String(g.meta_resource_name), status);

  const detail = `已推送 Meta（test）Ad Set 状态 ${status} → ${g.meta_resource_name}`;
  await recordGuardrail({
    action: "META_ADS_MUTATE_STATUS",
    targetId: adGroupId,
    decision: { verdict: "ALLOW", rule: "META_ADS_TEST", detail },
    requested: { mode: "test", adSetId: g.meta_resource_name, status },
  });

  return { mode, pushed: true, status: "PUSHED", detail, platform: "Meta" };
}

export async function pingMetaAds(): Promise<{
  ok: boolean;
  mode: MetaAdsMode;
  message: string;
  env: MetaAdsEnvStatus;
  accounts?: { id: string; name: string }[];
  campaigns?: MetaCampaignRow[];
  error?: string;
}> {
  const env = getMetaAdsEnvStatus();
  if (env.mode === "off") {
    return { ok: false, mode: "off", message: "未连接（META_ADS_MODE=off）", env };
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
    const accounts = await withTimeout(listAdAccounts(), PING_TIMEOUT_MS, "listAdAccounts");
    const campaigns = await withTimeout(
      searchCampaigns(env.adAccountId ?? undefined),
      PING_TIMEOUT_MS,
      "searchCampaigns",
    );
    return {
      ok: true,
      mode: "test",
      message: `已连接 ${env.adAccountId}（${campaigns.length} 个 campaign）`,
      env,
      accounts,
      campaigns,
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const error = /API access blocked/i.test(raw)
      ? [
          "Meta 返回 API access blocked（OAuthException 200）：应用级 Graph 访问被拒，不是本机代理问题。",
          "请到 developers.facebook.com → 你的 App → 检查红条/Required actions / App 是否 Disabled。",
          "用同一 token 在 Graph API Explorer 测 GET /me；若 Explorer 也失败，换新 App 或处理违规后再发 token。",
          raw.slice(0, 180),
        ].join(" ")
      : raw;
    return { ok: false, mode: "test", message: "探活失败", env, error };
  }
}

export { metaCentsToDollars };

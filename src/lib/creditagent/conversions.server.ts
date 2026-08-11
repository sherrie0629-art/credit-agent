// Server-only: offline conversion feedback engine (Google Ads OCI + Meta CAPI).
// Platform calls go through a swappable adapter. Today only MOCK adapters exist;
// LiveGoogleAdsAdapter / LiveMetaCapiAdapter can be dropped in without touching
// the queue, the state machine or the UI.
import type {
  AttributionDay,
  ConversionPlatform,
  ConversionSetting,
  ConversionSnapshot,
  LeadEventType,
  UploadRow,
  UploadStatus,
} from "./conversion-types";

type Row = Record<string, any>;

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

/* ------------------------------------------------------------------ *
 * Adapter contract — the single point of coupling with the ad platforms
 * ------------------------------------------------------------------ */

export interface UploadItem {
  uploadId: string;
  eventId: string;
  eventType: LeadEventType;
  value: number;
  currency: string;
  occurredAt: string;
  lead: Row;
}

export interface AdapterResult {
  uploadId: string;
  accepted: boolean;
  errorCode?: string;
  matchQuality: number;
  request: unknown;
  response: unknown;
}

export interface ConversionAdapter {
  platform: ConversionPlatform;
  buildPayload(item: UploadItem, setting: ConversionSetting): unknown;
  upload(items: UploadItem[], setting: ConversionSetting): Promise<AdapterResult[]>;
}

function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function gAdsDateTime(iso: string) {
  // Google OCI expects "yyyy-MM-dd HH:mm:ss+|-HH:mm"
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + "+00:00";
}

const GOOGLE_ACTION_BY_EVENT: Record<LeadEventType, string> = {
  LEAD: "Qualified Lead",
  CREDIT_APPROVED: "Credit Approved",
  LOAN_DISBURSED: "Loan Disbursed",
  FIRST_PAYMENT_DEFAULT: "Loan Default (negative)",
};

const META_EVENT_NAME: Record<LeadEventType, string> = {
  LEAD: "Lead",
  CREDIT_APPROVED: "SubmitApplication",
  LOAN_DISBURSED: "Purchase",
  FIRST_PAYMENT_DEFAULT: "LoanDefault",
};

/** Mock Google Ads offline click conversion upload. */
export const mockGoogleAdapter: ConversionAdapter = {
  platform: "google",
  buildPayload(item, setting) {
    const l = item.lead;
    return {
      endpoint: `customers/${(setting.destinationId || "").replace(/-/g, "")}/conversionUploads:uploadClickConversions`,
      partialFailure: true,
      conversions: [
        {
          gclid: l.gclid ?? undefined,
          gbraid: l.gbraid ?? undefined,
          wbraid: l.wbraid ?? undefined,
          conversionAction: setting.conversionAction,
          conversionActionName: GOOGLE_ACTION_BY_EVENT[item.eventType],
          conversionDateTime: gAdsDateTime(item.occurredAt),
          conversionValue: item.value,
          currencyCode: item.currency,
          orderId: item.eventId,
          userIdentifiers: [
            l.hashed_email ? { hashedEmail: l.hashed_email } : null,
            l.hashed_phone ? { hashedPhoneNumber: l.hashed_phone } : null,
          ].filter(Boolean),
        },
      ],
    };
  },
  async upload(items, setting) {
    return items.map((item) => {
      const request = this.buildPayload(item, setting);
      const l = item.lead;
      const r = seededRandom(item.uploadId + "g");

      if (!l.gclid && !l.gbraid && !l.wbraid) {
        return {
          uploadId: item.uploadId,
          accepted: false,
          errorCode: "MISSING_CLICK_ID",
          matchQuality: 0,
          request,
          response: { errors: [{ errorCode: "MISSING_CLICK_ID" }] },
        };
      }
      if (r < 0.05) {
        return {
          uploadId: item.uploadId,
          accepted: false,
          errorCode: "UNPARSEABLE_GCLID",
          matchQuality: 0,
          request,
          response: { errors: [{ errorCode: { conversionUploadError: "UNPARSEABLE_GCLID" } }] },
        };
      }
      if (r < 0.09) {
        return {
          uploadId: item.uploadId,
          accepted: false,
          errorCode: "CLICK_NOT_FOUND",
          matchQuality: 0,
          request,
          response: { errors: [{ errorCode: { conversionUploadError: "CLICK_NOT_FOUND" } }] },
        };
      }
      if (r < 0.11) {
        return {
          uploadId: item.uploadId,
          accepted: false,
          errorCode: "RATE_LIMITED",
          matchQuality: 0,
          request,
          response: { errors: [{ errorCode: { quotaError: "RESOURCE_EXHAUSTED" } }] },
        };
      }
      return {
        uploadId: item.uploadId,
        accepted: true,
        matchQuality: 0.62 + r * 0.35,
        request,
        response: {
          results: [{ gclid: l.gclid, conversionAction: setting.conversionAction }],
          partialFailureError: null,
        },
      };
    });
  },
};

/** Mock Meta Conversions API (dataset events) upload. */
export const mockMetaAdapter: ConversionAdapter = {
  platform: "meta",
  buildPayload(item, setting) {
    const l = item.lead;
    return {
      endpoint: `https://graph.facebook.com/v21.0/${setting.destinationId}/events`,
      data: [
        {
          event_name: META_EVENT_NAME[item.eventType],
          event_time: Math.floor(new Date(item.occurredAt).getTime() / 1000),
          event_id: item.eventId,
          action_source: "system_generated",
          user_data: {
            em: l.hashed_email ? [l.hashed_email] : undefined,
            ph: l.hashed_phone ? [l.hashed_phone] : undefined,
            fbc: l.fbc ?? undefined,
            fbp: l.fbp ?? undefined,
          },
          custom_data: {
            value: item.value,
            currency: item.currency,
            content_category: "consumer_loan",
          },
        },
      ],
    };
  },
  async upload(items, setting) {
    return items.map((item) => {
      const request = this.buildPayload(item, setting);
      const l = item.lead;
      const r = seededRandom(item.uploadId + "m");

      if (!l.fbc && !l.fbp && !l.hashed_email && !l.hashed_phone) {
        return {
          uploadId: item.uploadId,
          accepted: false,
          errorCode: "INVALID_MATCH_KEYS",
          matchQuality: 0,
          request,
          response: { error: { code: 100, message: "Missing user_data match keys" } },
        };
      }
      if (r < 0.08) {
        return {
          uploadId: item.uploadId,
          accepted: false,
          errorCode: "INVALID_MATCH_KEYS",
          matchQuality: 0,
          request,
          response: {
            error: { code: 100, message: "Invalid parameter", fbtrace_id: `A${item.uploadId}` },
          },
        };
      }
      if (r < 0.11) {
        return {
          uploadId: item.uploadId,
          accepted: false,
          errorCode: "RATE_LIMITED",
          matchQuality: 0,
          request,
          response: { error: { code: 613, message: "Calls to this api have exceeded the rate limit" } },
        };
      }
      return {
        uploadId: item.uploadId,
        accepted: true,
        matchQuality: (l.fbc ? 0.7 : 0.45) + r * 0.25,
        request,
        response: { events_received: 1, messages: [], fbtrace_id: `A${item.uploadId}` },
      };
    });
  },
};

/** Live Meta Conversions API — posts to Graph with META_ACCESS_TOKEN / META_CAPI_ACCESS_TOKEN. */
export const liveMetaCapiAdapter: ConversionAdapter = {
  platform: "meta",
  buildPayload(item, setting) {
    return mockMetaAdapter.buildPayload(item, setting);
  },
  async upload(items, setting) {
    const token = (
      process.env.META_CAPI_ACCESS_TOKEN ||
      process.env.META_ACCESS_TOKEN ||
      ""
    ).trim();
    const dataset = setting.destinationId.trim();
    if (!token || !dataset) {
      return items.map((item) => ({
        uploadId: item.uploadId,
        accepted: false,
        errorCode: "ADAPTER_DISABLED",
        matchQuality: 0,
        request: this.buildPayload(item, setting),
        response: { error: "缺少 META_ACCESS_TOKEN（或 META_CAPI_ACCESS_TOKEN）或 destinationId" },
      }));
    }

    const version = (process.env.META_GRAPH_VERSION || "v21.0").trim() || "v21.0";
    const results: AdapterResult[] = [];
    for (const item of items) {
      const request = this.buildPayload(item, setting) as {
        endpoint: string;
        data: unknown[];
      };
      const body = JSON.stringify({ data: request.data, access_token: token });
      try {
        const url = `https://graph.facebook.com/${version}/${dataset}/events`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        const text = await res.text();
        let response: unknown = text;
        try {
          response = JSON.parse(text);
        } catch {
          /* keep text */
        }
        const ok = res.status >= 200 && res.status < 300 && !(response as { error?: unknown })?.error;
        results.push({
          uploadId: item.uploadId,
          accepted: ok,
          errorCode: ok ? undefined : "LIVE_REJECTED",
          matchQuality: ok ? 0.8 : 0,
          request: { ...request, endpoint: url },
          response,
        });
      } catch (e) {
        results.push({
          uploadId: item.uploadId,
          accepted: false,
          errorCode: "LIVE_NETWORK",
          matchQuality: 0,
          request,
          response: { error: e instanceof Error ? e.message : String(e) },
        });
      }
    }
    return results;
  },
};

function getAdapter(setting: ConversionSetting): ConversionAdapter | null {
  if (setting.mode === "MOCK") {
    return setting.platform === "google" ? mockGoogleAdapter : mockMetaAdapter;
  }
  if (setting.mode === "LIVE" && setting.platform === "meta") {
    return liveMetaCapiAdapter;
  }
  // Google LIVE OCI not wired yet
  return null;
}

/* ------------------------------------------------------------------ *
 * Settings + mapping helpers
 * ------------------------------------------------------------------ */

function mapSetting(r: Row): ConversionSetting {
  return {
    platform: r.platform,
    mode: r.mode,
    enabled: r.enabled,
    destinationId: r.destination_id ?? "",
    conversionAction: r.conversion_action ?? "",
    lookbackDays: Number(r.lookback_days ?? 90),
  };
}

async function loadSettings(): Promise<ConversionSetting[]> {
  const supabase = await db();
  const { data } = await supabase.from("conversion_settings").select("*").order("platform");
  return ((data ?? []) as Row[]).map(mapSetting);
}

export function platformForChannel(channel: string): ConversionPlatform {
  return channel === "Google" ? "google" : "meta";
}

/* ------------------------------------------------------------------ *
 * Queue: enqueue → dispatch → retry
 * ------------------------------------------------------------------ */

/** Creates PENDING upload rows for value events that don't have one yet. */
export async function enqueuePendingUploads(): Promise<number> {
  const supabase = await db();
  const { data: events } = await supabase
    .from("lead_events")
    .select("*")
    .in("event_type", ["CREDIT_APPROVED", "LOAN_DISBURSED", "FIRST_PAYMENT_DEFAULT"])
    .order("occurred_at", { ascending: false })
    .limit(500);
  const { data: existing } = await supabase.from("conversion_uploads").select("event_id, platform");

  const seen = new Set(((existing ?? []) as Row[]).map((r) => `${r.event_id}:${r.platform}`));
  const eventRows = (events ?? []) as Row[];
  if (eventRows.length === 0) return 0;

  const { data: leads } = await supabase
    .from("leads")
    .select("id, channel")
    .in("id", eventRows.map((e) => e.lead_id));
  const channelById = new Map(((leads ?? []) as Row[]).map((l) => [l.id, l.channel]));

  const rows = eventRows
    .filter((e) => {
      const platform = platformForChannel(channelById.get(e.lead_id) ?? "Meta");
      return !seen.has(`${e.id}:${platform}`);
    })
    .map((e) => {
      const platform = platformForChannel(channelById.get(e.lead_id) ?? "Meta");
      return {
        id: `${e.id}_${platform}`,
        event_id: e.id,
        platform,
        status: "PENDING" as UploadStatus,
      };
    });

  if (rows.length === 0) return 0;
  await supabase.from("conversion_uploads").upsert(rows as never, { onConflict: "event_id,platform" });
  return rows.length;
}

const MAX_ATTEMPTS = 5;

export interface FlushResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** Picks up PENDING / retryable FAILED uploads and pushes them to the adapters. */
export async function flushConversionQueue(limit = 60): Promise<FlushResult> {
  const supabase = await db();
  const settings = await loadSettings();
  const result: FlushResult = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  const { data: queue } = await supabase
    .from("conversion_uploads")
    .select("*")
    .in("status", ["PENDING", "FAILED"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);

  const queueRows = (queue ?? []) as Row[];
  if (queueRows.length === 0) return result;

  const { data: events } = await supabase
    .from("lead_events")
    .select("*")
    .in("id", queueRows.map((q) => q.event_id));
  const eventById = new Map(((events ?? []) as Row[]).map((e) => [e.id, e]));

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .in("id", [...new Set(((events ?? []) as Row[]).map((e) => e.lead_id))]);
  const leadById = new Map(((leads ?? []) as Row[]).map((l) => [l.id, l]));

  const now = Date.now();
  const batches = new Map<ConversionPlatform, UploadItem[]>();

  for (const q of queueRows) {
    const event = eventById.get(q.event_id);
    const lead = event ? leadById.get(event.lead_id) : null;
    const setting = settings.find((s) => s.platform === q.platform);
    if (!event || !lead || !setting) continue;
    result.processed += 1;

    if (!setting.enabled) {
      await supabase
        .from("conversion_uploads")
        .update({ status: "SKIPPED", error_code: "ADAPTER_DISABLED" })
        .eq("id", q.id);
      result.skipped += 1;
      continue;
    }

    const ageDays = (now - new Date(lead.click_at).getTime()) / 86_400_000;
    if (ageDays > setting.lookbackDays) {
      await supabase
        .from("conversion_uploads")
        .update({ status: "SKIPPED", error_code: "OUTSIDE_LOOKBACK_WINDOW" })
        .eq("id", q.id);
      result.skipped += 1;
      continue;
    }

    const list = batches.get(q.platform) ?? [];
    list.push({
      uploadId: q.id,
      eventId: event.id,
      eventType: event.event_type,
      value: Number(event.value),
      currency: event.currency ?? "USD",
      occurredAt: event.occurred_at,
      lead,
    });
    batches.set(q.platform, list);
  }

  const attemptsById = new Map(queueRows.map((q) => [q.id, Number(q.attempts ?? 0)]));

  for (const [platform, items] of batches) {
    const setting = settings.find((s) => s.platform === platform)!;
    const adapter = getAdapter(setting);
    if (!adapter) {
      for (const item of items) {
        await supabase
          .from("conversion_uploads")
          .update({ status: "SKIPPED", error_code: "ADAPTER_DISABLED" })
          .eq("id", item.uploadId);
        result.skipped += 1;
      }
      continue;
    }
    const results = await adapter.upload(items, setting);
    for (const r of results) {
      const attempts = (attemptsById.get(r.uploadId) ?? 0) + 1;
      await supabase
        .from("conversion_uploads")
        .update({
          status: r.accepted ? "SENT" : "FAILED",
          attempts,
          error_code: r.errorCode ?? null,
          match_quality: Number(r.matchQuality.toFixed(3)),
          request_payload: r.request as never,
          response_body: r.response as never,
          sent_at: r.accepted ? new Date().toISOString() : null,
        })
        .eq("id", r.uploadId);
      if (r.accepted) result.sent += 1;
      else result.failed += 1;
    }
  }

  await maybeRaiseAgentAlert();
  return result;
}

export async function retryUpload(uploadId: string) {
  const supabase = await db();
  await supabase
    .from("conversion_uploads")
    .update({ status: "PENDING", error_code: null })
    .eq("id", uploadId);
  await flushConversionQueue(5);
  return getConversionSnapshot();
}

/* ------------------------------------------------------------------ *
 * Agent alert — white-box decision when the feedback loop degrades
 * ------------------------------------------------------------------ */

async function maybeRaiseAgentAlert() {
  const supabase = await db();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data } = await supabase
    .from("conversion_uploads")
    .select("status, error_code, platform")
    .gte("updated_at", since);
  const rows = (data ?? []) as Row[];
  const attempted = rows.filter((r) => r.status === "SENT" || r.status === "FAILED");
  if (attempted.length < 10) return;
  const successRate = rows.filter((r) => r.status === "SENT").length / attempted.length;
  if (successRate >= 0.85) return;

  const { data: dup } = await supabase
    .from("agent_decisions")
    .select("id")
    .eq("action_type", "CONVERSION_FEEDBACK_ALERT")
    .eq("status", "PENDING_APPROVAL")
    .limit(1);
  if ((dup ?? []).length > 0) return;

  const topError =
    attempted
      .filter((r) => r.error_code)
      .reduce<Record<string, number>>((acc, r) => {
        acc[r.error_code] = (acc[r.error_code] ?? 0) + 1;
        return acc;
      }, {}) ?? {};
  const worst = Object.entries(topError).sort((a, b) => b[1] - a[1])[0];

  const { count } = await supabase
    .from("agent_decisions")
    .select("id", { count: "exact", head: true });

  await supabase.from("agent_decisions").insert({
    id: `dec_${1043 + (count ?? 0)}`,
    timestamp: new Date().toISOString(),
    agent_type: "Execution",
    action_type: "CONVERSION_FEEDBACK_ALERT",
    target_channel: "Google",
    campaign_id: "cmp_google_acq",
    campaign_name: "Google — 美国消费信贷获客",
    ad_group_id: "cmp_g_search_01",
    ad_group_name: "Search — 高意图关键词",
    confidence_score: 0.94,
    reasoning_chain: [
      `近 24 小时回传成功率 ${(successRate * 100).toFixed(1)}%，低于 85% 阈值。`,
      worst ? `主要错误：${worst[0]}，出现 ${worst[1]} 次。` : "错误分布分散，疑似平台侧限流。",
      "回传缺失会导致平台侧出价模型缺少后端放款信号，逐步退化为前端 CPL 优化。",
      "建议：暂停受影响渠道的自动扩量，修复点击标识采集后重跑回传队列。",
    ],
    trigger_metric: "ConversionUploadSuccessRate",
    trigger_current_value: Number(successRate.toFixed(3)),
    trigger_threshold_value: 0.85,
    status: "PENDING_APPROVAL",
    effect: "冻结依赖回传信号的自动扩量决策",
    rollback_to: "恢复自动扩量",
  } as never);
}

/* ------------------------------------------------------------------ *
 * Simulation helpers (stand-in for the real loan origination system)
 * ------------------------------------------------------------------ */

/** Fallback delivery units (ad group id → parent campaign) if the table is empty. */
const AD_GROUPS: { id: string; campaignId: string; channel: string }[] = [
  { id: "cmp_g_search_01", campaignId: "cmp_google_acq", channel: "Google" },
  { id: "cmp_g_pmax_02", campaignId: "cmp_google_acq", channel: "Google" },
  { id: "cmp_m_feed_03", campaignId: "cmp_meta_acq", channel: "Meta" },
  { id: "cmp_m_reels_04", campaignId: "cmp_meta_acq", channel: "Meta" },
];

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function captureLead(input: {
  channel?: string;
  campaignId?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  fbp?: string;
  fbc?: string;
  email?: string;
  phone?: string;
  landingUrl?: string;
}) {
  const supabase = await db();
  const id = `lead_live_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const channel = input.channel ?? (input.gclid || input.gbraid ? "Google" : "Meta");

  // Resolve the delivery unit: the tracking param may carry either an ad group
  // id (real execution unit) or a campaign id (parent). Always land on an ad group.
  const { data: groupRows } = await supabase
    .from("ad_groups")
    .select("id, campaign_id, channel")
    .order("sort_order");
  const groups = (groupRows ?? []) as Row[];
  const hinted = input.campaignId
    ? (groups.find((g) => g.id === input.campaignId) ??
      groups.find((g) => g.campaign_id === input.campaignId))
    : undefined;
  const group = hinted ?? groups.find((g) => g.channel === channel) ?? groups[0];
  const adGroupId = group?.id ?? null;
  const campaignId = group?.campaign_id ?? input.campaignId ?? null;

  // Attribute the lead to a creative by traffic share, so downstream loan
  // outcomes roll up to the asset that actually earned the click.
  const { data: placements } = await supabase
    .from("creative_placements")
    .select("creative_id, share")
    .eq("ad_group_id", adGroupId ?? "")
    .eq("status", "ACTIVE");
  let creativeId: string | null = null;
  const pool = (placements ?? []) as { creative_id: string; share: number }[];
  if (pool.length > 0) {
    const total = pool.reduce((a, p) => a + Number(p.share), 0) || 1;
    let roll = Math.random() * total;
    creativeId = pool[pool.length - 1].creative_id;
    for (const p of pool) {
      roll -= Number(p.share);
      if (roll <= 0) {
        creativeId = p.creative_id;
        break;
      }
    }
  }

  const row = {
    id,
    channel,
    campaign_id: campaignId,
    ad_group_id: adGroupId,
    creative_id: creativeId,
    gclid: input.gclid ?? null,
    gbraid: input.gbraid ?? null,
    wbraid: input.wbraid ?? null,
    fbclid: input.fbclid ?? null,
    fbp: input.fbp ?? null,
    fbc: input.fbc ?? null,
    hashed_email: input.email ? await sha256(input.email) : null,
    hashed_phone: input.phone ? await sha256(input.phone.replace(/[^\d+]/g, "")) : null,
    landing_url: input.landingUrl ?? "",
    click_at: new Date().toISOString(),
  };
  await supabase.from("leads").insert(row as never);
  await supabase.from("lead_events").insert({
    id: `${id}_lead`,
    lead_id: id,
    event_type: "LEAD",
    value: 0,
    occurred_at: new Date().toISOString(),
  } as never);
  return { leadId: id };
}

/** Simulates the loan origination system: new leads + downstream outcomes. */
export async function simulateBatch(input: { leads: number; approvalRate: number }) {
  const supabase = await db();
  const count = Math.min(Math.max(input.leads, 1), 100);
  const stamp = Date.now().toString(36);
  const leadRows: Row[] = [];
  const eventRows: Row[] = [];

  const { data: allPlacements } = await supabase
    .from("creative_placements")
    .select("creative_id, ad_group_id, share")
    .eq("status", "ACTIVE");
  const poolByGroup = new Map<string, { creative_id: string; share: number }[]>();
  for (const p of (allPlacements ?? []) as Row[]) {
    const list = poolByGroup.get(p.ad_group_id) ?? [];
    list.push({ creative_id: p.creative_id, share: Number(p.share) });
    poolByGroup.set(p.ad_group_id, list);
  }
  const pickCreative = (adGroupId: string) => {
    const pool = poolByGroup.get(adGroupId);
    if (!pool || pool.length === 0) return null;
    const total = pool.reduce((a, p) => a + p.share, 0) || 1;
    let roll = Math.random() * total;
    for (const p of pool) {
      roll -= p.share;
      if (roll <= 0) return p.creative_id;
    }
    return pool[pool.length - 1].creative_id;
  };

  const { data: groupRows } = await supabase
    .from("ad_groups")
    .select("id, campaign_id, channel")
    .order("sort_order");
  const groups = ((groupRows ?? []) as Row[]).map((g) => ({
    id: g.id as string,
    campaignId: g.campaign_id as string,
    channel: g.channel as string,
  }));
  const units = groups.length > 0 ? groups : AD_GROUPS;

  for (let i = 0; i < count; i++) {
    const unit = units[i % units.length];
    const id = `lead_sim_${stamp}_${i}`;
    const clickAt = new Date(Date.now() - Math.floor(Math.random() * 3) * 86_400_000);
    const isGoogle = unit.channel === "Google";
    leadRows.push({
      id,
      channel: unit.channel,
      campaign_id: unit.campaignId,
      ad_group_id: unit.id,
      creative_id: pickCreative(unit.id),
      gclid: isGoogle ? `Cj0KCQ${stamp}${i}` : null,
      fbclid: isGoogle ? null : `IwAR${stamp}${i}`,
      fbp: isGoogle ? null : `fb.1.${Math.floor(clickAt.getTime() / 1000)}.${100000 + i}`,
      fbc: isGoogle || i % 8 === 0 ? null : `fb.1.${Math.floor(clickAt.getTime() / 1000)}.IwAR${i}`,
      hashed_email: await sha256(`sim${stamp}${i}@example.com`),
      hashed_phone: await sha256(`+1555${stamp}${i}`),
      landing_url: "https://credit-agent.lovable.app/lp",
      click_at: clickAt.toISOString(),
    });
    eventRows.push({
      id: `${id}_lead`,
      lead_id: id,
      event_type: "LEAD",
      value: 0,
      occurred_at: new Date(clickAt.getTime() + 240_000).toISOString(),
    });

    const approved = Math.random() < input.approvalRate;
    if (approved) {
      eventRows.push({
        id: `${id}_appr`,
        lead_id: id,
        event_type: "CREDIT_APPROVED",
        value: 30,
        occurred_at: new Date(clickAt.getTime() + 3 * 3600_000).toISOString(),
      });
      if (Math.random() < 0.75) {
        const amount = 800 + Math.floor(Math.random() * 4200);
        eventRows.push({
          id: `${id}_disb`,
          lead_id: id,
          event_type: "LOAN_DISBURSED",
          value: Number((amount * 0.06).toFixed(2)),
          occurred_at: new Date(clickAt.getTime() + 6 * 3600_000).toISOString(),
        });
      }
    }
  }

  await supabase.from("leads").insert(leadRows as never);
  await supabase.from("lead_events").insert(eventRows as never);
  const queued = await enqueuePendingUploads();
  return { leads: leadRows.length, events: eventRows.length, queued };
}

/** Ingests an external loan lifecycle event (webhook or simulator). */
export async function ingestLoanEvent(input: {
  leadId: string;
  eventType: LeadEventType;
  value?: number;
  currency?: string;
  occurredAt?: string;
  externalRef?: string;
}) {
  const supabase = await db();
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", input.leadId)
    .maybeSingle();
  if (!lead) return { ok: false, reason: "LEAD_NOT_FOUND" as const };

  const id = `${input.leadId}_${input.eventType.toLowerCase()}`;
  await supabase.from("lead_events").upsert(
    {
      id,
      lead_id: input.leadId,
      event_type: input.eventType,
      value: input.value ?? 0,
      currency: input.currency ?? "USD",
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      external_ref: input.externalRef ?? null,
    } as never,
    { onConflict: "id" },
  );
  await enqueuePendingUploads();
  return { ok: true as const, eventId: id };
}

export async function updateSetting(
  platform: ConversionPlatform,
  patch: Partial<Pick<ConversionSetting, "mode" | "enabled" | "destinationId" | "conversionAction" | "lookbackDays">>,
) {
  const supabase = await db();
  const row: Row = {};
  if (patch.mode) row.mode = patch.mode;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.destinationId !== undefined) row.destination_id = patch.destinationId;
  if (patch.conversionAction !== undefined) row.conversion_action = patch.conversionAction;
  if (patch.lookbackDays !== undefined) row.lookback_days = patch.lookbackDays;
  await supabase.from("conversion_settings").update(row as never).eq("platform", platform);
  return getConversionSnapshot();
}

/* ------------------------------------------------------------------ *
 * Snapshot for the dashboard
 * ------------------------------------------------------------------ */

function mapConversionSnapshot(payload: Row): ConversionSnapshot {
  const uploadRows = (payload.conversion_uploads ?? []) as Row[];
  const eventById = new Map(((payload.lead_events ?? []) as Row[]).map((e) => [e.id, e]));
  const leadById = new Map(((payload.leads ?? []) as Row[]).map((l) => [l.id, l]));

  const uploads: UploadRow[] = uploadRows.map((u) => {
    const e = eventById.get(u.event_id);
    const l = e ? leadById.get(e.lead_id) : null;
    return {
      id: u.id,
      eventId: u.event_id,
      platform: u.platform,
      status: u.status,
      attempts: Number(u.attempts ?? 0),
      errorCode: u.error_code ?? undefined,
      matchQuality: Number(u.match_quality ?? 0),
      sentAt: u.sent_at ?? undefined,
      createdAt: u.created_at,
      requestPayload: u.request_payload,
      responseBody: u.response_body,
      eventType: (e?.event_type ?? "LOAN_DISBURSED") as LeadEventType,
      value: Number(e?.value ?? 0),
      occurredAt: e?.occurred_at ?? u.created_at,
      leadId: e?.lead_id ?? "",
      channel: l?.channel ?? "-",
      campaignId: l?.campaign_id ?? "-",
    };
  });

  const attempted = uploads.filter((u) => u.status === "SENT" || u.status === "FAILED");
  const sent = uploads.filter((u) => u.status === "SENT");
  const latencies = sent
    .filter((u) => u.sentAt)
    .map((u) => (new Date(u.sentAt!).getTime() - new Date(u.occurredAt).getTime()) / 60_000)
    .filter((v) => v >= 0);

  const sentEventIds = new Set(sent.map((u) => u.eventId));
  const byDay = new Map<string, AttributionDay>();
  for (const e of (payload.disbursed_events ?? []) as Row[]) {
    const day = String(e.occurred_at).slice(5, 10);
    const entry = byDay.get(day) ?? { day, dbDisbursed: 0, platformReported: 0 };
    entry.dbDisbursed += 1;
    if (sentEventIds.has(e.id)) entry.platformReported += 1;
    byDay.set(day, entry);
  }
  const attribution = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-14);

  return {
    uploads,
    settings: ((payload.conversion_settings ?? []) as Row[]).map(mapSetting),
    leadCount: Number(payload.lead_count ?? 0),
    attribution,
    kpis: {
      pending: uploads.filter((u) => u.status === "PENDING").length,
      sent: sent.length,
      failed: uploads.filter((u) => u.status === "FAILED").length,
      skipped: uploads.filter((u) => u.status === "SKIPPED").length,
      successRate: attempted.length ? sent.length / attempted.length : 0,
      matchRate: sent.length ? sent.reduce((a, u) => a + u.matchQuality, 0) / sent.length : 0,
      avgLatencyMinutes: latencies.length
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0,
      uploadedValue: sent.reduce((a, u) => a + u.value, 0),
    },
  };
}

/** Aggregated read path — works with publishable key via SECURITY DEFINER RPC. */
export async function getConversionSnapshot(): Promise<ConversionSnapshot> {
  const { getReadClient } = await import("./read-client.server");
  const supabase = await getReadClient();
  const { data, error } = await (supabase as any).rpc("get_conversion_snapshot");
  if (error) throw new Error(error.message);
  return mapConversionSnapshot((data ?? {}) as Row);
}

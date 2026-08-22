// Planner 的 LLM「分析师」层：只读快照 → 产出跨广告组诊断与建议 → 全部落为待审批。
// 严格边界：无 tool-calling、无 DB 写权限交给模型、输出必须过本体 Action 契约。
// 执行权仍在硬编码风控层（guardrails.ts），批准时会再过一次闸门。
import type { AgentSnapshot } from "./types";
import { MAX_SUGGESTIONS } from "./advisor";
import { checkBudgetChange } from "./guardrails";
import { loadLimits } from "./guardrails.server";
import { getSnapshot } from "./agent.server";
import { buildSubgraphContext, snapshotKnownRefs, type AdvisorContext } from "./advisor-context.server";
import { ACTION_TYPES, type ActionTypeId } from "./ontology/actions";
import {
  advisorPromptSchemaBlock,
  describeActionEffect,
  screenAdvisorSuggestions,
  type ScreenedSuggestion,
} from "./ontology/action-schema";
import type { OntologyChange } from "./ontology/decision-diff";
import { change } from "./ontology/decision-diff";

export const ADVISOR_MODEL = "openai/gpt-5.6-sol";
/** 定时轨的降频间隔：规则扫描 15 分钟一次，参谋提案 3 小时一次。 */
export const ADVISOR_MIN_INTERVAL_MS = 3 * 3600_000;

type Row = Record<string, any>;

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

/** 压缩成只含数字的紧凑事实包——不传自由文本，减少提示注入面。 */
export function buildAdvisorContext(snapshot: AgentSnapshot) {
  return {
    account: {
      targetCps: 19,
      mode: snapshot.mode,
      riskPosture: snapshot.riskPosture,
      killSwitch: snapshot.killSwitch,
      limits: snapshot.guardrailLimits,
    },
    adGroups: snapshot.adGroups.map((g) => ({
      adGroupId: g.id,
      campaign: g.campaignName,
      channel: g.channel,
      status: g.status,
      dailyBudget: g.dailyBudget,
      spentToday: g.spentToday,
      impressions: g.impressions,
      clicks: g.clicks,
      leads: g.leads,
      approvedLoans: g.approvedLoans,
      disbursedCount: g.disbursedCount,
      cpl: Number(g.cpl.toFixed(2)),
      cps: Number(g.cps.toFixed(2)),
      last20ApprovalRate: Number(g.last20ApprovalRate.toFixed(4)),
      compliancePassRate: Number(g.compliancePassRate.toFixed(4)),
    })),
    creatives: snapshot.creatives.map((c) => ({
      creativeId: c.id,
      fatigueScore: c.fatigueScore,
      fatigueLevel: c.fatigueLevel,
      complianceStatus: c.complianceStatus,
      cps: c.backend?.cps ?? null,
      approvalRate: c.backend?.approvalRate ?? null,
    })),
    channelTrend: snapshot.channelTrend.slice(-7),
    funnel: snapshot.funnel.map((f) => ({ stage: f.stage, value: f.value })),
  };
}

function systemPrompt() {
  return `你是消费信贷投放系统的 Planner 分析师（Advisor）。

你的输入是一份「业务图谱子图」：以若干问题广告组为中心的 2 跳邻域，包含实体（广告系列、广告组、素材、投放、受众段、近期决策等）、其关键指标与彼此关系。请沿着这些关系做推理，而不是只看单表数字。

你的角色是分析师，不是执行者。你没有任何工具权限，不能修改预算、状态或素材。你的输出只会作为"待人工审批的建议"落库，之后还要过一层硬编码风控与本体不变量检查才可能执行。

请特别关注纯阈值规则处理不好的情形：
- 矛盾信号（例如 CTR 上升但后端授信通过率下降）
- 跨广告组的预算再分配机会（把低胜率广告组的预算腾给高胜率广告组）
- 前端指标（CPL）与后端真实成本（CPS）背离
- 沿关系穿透的解释（同一素材/受众段在多个广告组上共同恶化）

硬性输出约束：
1. 只返回符合下方 JSON Schema 的 JSON，不要 markdown 围栏。
2. actionType 必须是 BUDGET_SHIFT / BID_ADJUST / CREATIVE_PAUSE / CREATIVE_REFRESH / VARIANT_PROMOTE / COMPLIANCE_REJECT / NO_ACTION 之一。
3. params 必须符合该 actionType 对应的 params schema；其中的实体 ID 必须逐字来自子图，禁止编造。
4. BUDGET_SHIFT 请给出 toAdGroupId、amount、nextDailyBudget（可选 fromAdGroupId），不要再报百分比。
5. 最多给 ${MAX_SUGGESTIONS} 条建议，每条必须给出中文 rationale，并引用具体数字与实体。
6. 没有值得动作的对象时 suggestions 为空数组，不要为了凑数编建议。

输出契约（JSON Schema）：
${advisorPromptSchemaBlock()}`;
}

/**
 * 调用 Lovable AI Gateway 的 Responses API。
 * 推理模型单次可跑数分钟，必须流式，否则会撞请求超时；这里在服务端消费完整流。
 */
export async function callLovableModel(
  instructions: string,
  input: unknown,
): Promise<{ text: string }> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("MISSING_KEY");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: ADVISOR_MODEL,
      stream: true,
      instructions,
      input: typeof input === "string" ? input : JSON.stringify(input),
      reasoning: { effort: "medium", summary: "auto" },
    }),
  });

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("NO_CREDITS");
  if (!res.ok) throw new Error(`AI_ERROR_${res.status}:${(await res.text()).slice(0, 300)}`);
  if (!res.body) throw new Error("AI_EMPTY_STREAM");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let completedText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let evt: any;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
        text += evt.delta;
      } else if (evt.type === "response.completed") {
        const out = evt.response?.output_text;
        if (typeof out === "string") completedText = out;
        else if (Array.isArray(out)) completedText = out.join("");
      }
    }
  }

  return { text: text || completedText };
}

async function callAdvisorModel(context: unknown): Promise<{ text: string }> {
  return callLovableModel(systemPrompt(), context);
}

export function parseAdvisorJson(text: string): any {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/```$/g, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return {};
    try {
      return JSON.parse(m[0]);
    } catch {
      return {};
    }
  }
}

interface AdvisorRunResult {
  ok: boolean;
  created: number;
  dropped: number;
  summary?: string;
  skipped?: string;
  error?: string;
}

/**
 * 跑一轮分析师。建议一律以 PENDING_APPROVAL 落库，永远不直接改投放状态。
 */
export async function runPlannerAdvisor(
  triggerSource: "MANUAL" | "SWEEP" = "MANUAL",
): Promise<AdvisorRunResult> {
  const supabase = await db();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const limits = await loadLimits();
  if (limits.killSwitch) {
    await supabase.from("advisor_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      trigger_source: triggerSource,
      ok: true,
      error: "KILL_SWITCH",
    } as never);
    return { ok: true, created: 0, dropped: 0, skipped: "KILL_SWITCH" };
  }

  const snapshot = await getSnapshot();
  let context: AdvisorContext | null = null;
  try {
    context = await buildSubgraphContext(snapshot);
  } catch {
    context = null;
  }
  const promptInput = context && context.knownRefs.size > 0 ? context.text : JSON.stringify(buildAdvisorContext(snapshot));
  const knownRefs =
    context && context.knownRefs.size > 0 ? context.knownRefs : snapshotKnownRefs(snapshot);

  let raw: any = {};
  let rawText = "";
  try {
    const out = await callAdvisorModel(promptInput);
    rawText = out.text;
    raw = parseAdvisorJson(rawText);
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e).slice(0, 500);
    await supabase.from("advisor_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      trigger_source: triggerSource,
      ok: false,
      model: ADVISOR_MODEL,
      duration_ms: Date.now() - t0,
      error: message,
    } as never);
    return { ok: false, created: 0, dropped: 0, error: message };
  }

  const screened = screenAdvisorSuggestions(raw, knownRefs);
  if (!screened.ok) {
    await supabase.from("advisor_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      trigger_source: triggerSource,
      ok: false,
      model: ADVISOR_MODEL,
      duration_ms: Date.now() - t0,
      raw_output: rawText.slice(0, 20000),
      error: screened.error ?? "ENVELOPE_INVALID",
    } as never);
    return { ok: false, created: 0, dropped: 0, error: screened.error };
  }

  const { ontologyPreflight } = await import("./ontology/preflight.server");
  const preflightDropped: { index: number; reason: string }[] = [];
  const actionable: ScreenedSuggestion[] = [];
  for (const [i, s] of screened.kept.entries()) {
    const gate = await ontologyPreflight({
      actionType: s.actionType,
      params: s.params,
      automated: true,
    });
    if (!gate.ok) {
      preflightDropped.push({
        index: i,
        reason: gate.paramError
          ? `ACTION_SCHEMA: ${gate.paramError}`
          : (gate.result?.violations.map((v) => v.detail).join(" / ") ?? "本体不变量未通过"),
      });
      continue;
    }
    actionable.push(s);
  }

  const stamp = Date.now().toString(36);
  const rows = (
    await Promise.all(
      actionable.map((s, i) => buildDecisionRow(s, i, stamp, snapshot, limits, screened.summary)),
    )
  ).filter(Boolean);

  if (rows.length) await supabase.from("agent_decisions").insert(rows as never);

  await supabase.from("advisor_runs").insert({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    trigger_source: triggerSource,
    ok: true,
    model: ADVISOR_MODEL,
    duration_ms: Date.now() - t0,
    raw_output: rawText.slice(0, 20000),
    suggestions_raw: screened.kept.length + screened.dropped.length,
    suggestions_kept: rows.length,
    dropped: [
      ...screened.dropped.map((d) => ({ index: d.index, reason: d.reason })),
      ...preflightDropped,
    ] as never,
  } as never);

  return {
    ok: true,
    created: rows.length,
    dropped: screened.dropped.length + preflightDropped.length,
    summary: screened.summary,
  };
}

function resolveTargets(s: ScreenedSuggestion, snapshot: AgentSnapshot) {
  const adGroupId =
    String(s.params["toAdGroupId"] ?? s.params["adGroupId"] ?? s.params["fromAdGroupId"] ?? "") ||
    undefined;
  const creativeId = String(s.params["creativeId"] ?? "") || undefined;
  const group = adGroupId ? snapshot.adGroups.find((g) => g.id === adGroupId) : undefined;
  const creative = creativeId ? snapshot.creatives.find((c) => c.id === creativeId) : undefined;
  const placement =
    creativeId && adGroupId
      ? snapshot.placements.find((p) => p.creativeId === creativeId && p.adGroupId === adGroupId)
      : creativeId
        ? snapshot.placements.find((p) => p.creativeId === creativeId)
        : undefined;
  const experiment =
    s.actionType === "VARIANT_PROMOTE"
      ? snapshot.experiments.find((e) => e.id === String(s.params["experimentId"] ?? ""))
      : undefined;
  const viaPlacementGroup = placement
    ? snapshot.adGroups.find((g) => g.id === placement.adGroupId)
    : undefined;
  const g = group ?? viaPlacementGroup;
  return { adGroupId: g?.id ?? adGroupId, group: g, creative, placement, experiment };
}

function ontologyChangesFor(s: ScreenedSuggestion, snapshot: AgentSnapshot): OntologyChange[] {
  const { group, creative, placement, experiment } = resolveTargets(s, snapshot);
  switch (s.actionType) {
    case "BUDGET_SHIFT":
      return [
        change({
          type: "AdGroup",
          id: group?.id ?? s.targetId,
          name: group?.name,
          field: "daily_budget",
          from: group?.dailyBudget ?? null,
          to: Number(s.params["nextDailyBudget"]),
        }),
      ];
    case "BID_ADJUST":
      return [
        change({
          type: "AdGroup",
          id: group?.id ?? s.targetId,
          name: group?.name,
          field: "bid_target",
          from: group?.bidTarget ?? null,
          to: Number(s.params["nextBidTarget"]),
        }),
      ];
    case "CREATIVE_PAUSE":
      return [
        change({
          type: "CreativePlacement",
          id: placement ? `${placement.creativeId}|${placement.adGroupId}` : s.targetId,
          name: creative?.headline,
          field: "status",
          from: placement?.status ?? "ACTIVE",
          to: "PAUSED",
        }),
      ];
    case "CREATIVE_REFRESH":
      return [
        change({
          type: "CreativeAsset",
          id: creative?.id ?? s.targetId,
          name: creative?.headline,
          field: "fatigue_level",
          from: creative?.fatigueLevel ?? null,
          to: "HEALTHY",
        }),
      ];
    case "VARIANT_PROMOTE":
      return [
        change({
          type: "CreativeExperiment",
          id: experiment?.id ?? s.targetId,
          field: "status",
          from: experiment?.status ?? "RUNNING",
          to: "DECIDED",
        }),
        change({
          type: "CreativeExperiment",
          id: experiment?.id ?? s.targetId,
          field: "winner_variant_id",
          from: experiment?.winnerVariantId ?? null,
          to: String(s.params["winnerVariantId"] ?? ""),
        }),
      ];
    case "COMPLIANCE_REJECT":
      return [
        change({
          type: "CreativeAsset",
          id: creative?.id ?? s.targetId,
          name: creative?.headline,
          field: "compliance_status",
          from: creative?.complianceStatus ?? null,
          to: "FAILED",
        }),
      ];
    default:
      return [];
  }
}

async function buildDecisionRow(
  s: ScreenedSuggestion,
  i: number,
  stamp: string,
  snapshot: AgentSnapshot,
  limits: Awaited<ReturnType<typeof loadLimits>>,
  summary: string,
): Promise<Row> {
  const { group, creative, adGroupId } = resolveTargets(s, snapshot);
  const pendingHit =
    (adGroupId &&
      snapshot.decisions.some(
        (d) => d.status === "PENDING_APPROVAL" && d.adGroupId === adGroupId,
      )) ||
    (creative &&
      snapshot.decisions.some(
        (d) => d.status === "PENDING_APPROVAL" && d.creativeId === creative.id,
      ));

  const notes: string[] = [];
  if (s.actionType === "BUDGET_SHIFT" && group) {
    const nextBudget = Number(s.params["nextDailyBudget"]);
    const verdict = checkBudgetChange(limits, { current: group.dailyBudget, next: nextBudget });
    if (verdict.verdict === "DENY") {
      notes.push(`预判：批准时将被规则层拒绝（${verdict.rule}）——${verdict.detail}`);
    } else if (verdict.verdict === "CLAMP") {
      notes.push(`预判：批准时将被规则层截断至 $${verdict.value}（${verdict.rule}）。`);
    } else {
      notes.push("预判：该建议在当前风控限额内，批准后可执行。");
    }
  } else {
    notes.push("预判：非预算类动作，批准时仍需过风控姿态熔断、频次闸门与本体不变量。");
  }
  if (pendingHit) {
    notes.push("与规则层建议冲突：同一目标已有待审批决策，两条并列，请人工裁决。");
  }

  const targetName = group?.name ?? creative?.headline;
  const effect = describeActionEffect(s.actionType, s.params, { targetName });
  const def = ACTION_TYPES[s.actionType as ActionTypeId];
  const rootType =
    s.actionType === "CREATIVE_PAUSE" || s.actionType === "CREATIVE_REFRESH" || s.actionType === "COMPLIANCE_REJECT"
      ? "CreativeAsset"
      : def.actsOn;
  const rootId =
    rootType === "CreativeAsset" ? String(s.params["creativeId"] ?? s.targetId) : s.targetId;

  const { buildDecisionOntology } = await import("./ontology/decision-diff.server");
  const ontology = await buildDecisionOntology({
    rootType,
    rootId,
    changes: ontologyChangesFor(s, snapshot),
  });

  const campaignId = group?.campaignId ?? snapshot.campaigns[0]?.id ?? "unknown";
  const campaignName = group?.campaignName ?? snapshot.campaigns[0]?.name ?? campaignId;

  return {
    id: `dec_llm_${stamp}_${i}`,
    timestamp: new Date().toISOString(),
    agent_type: "Planner",
    action_type: s.actionType,
    target_channel: group?.channel ?? "Google",
    campaign_id: campaignId,
    campaign_name: campaignName,
    ad_group_id: adGroupId ?? null,
    ad_group_name: group?.name ?? null,
    creative_id: creative?.id ?? (s.params["creativeId"] as string | undefined) ?? null,
    creative_name: creative?.headline ?? null,
    confidence_score: s.confidence,
    trigger_source: "LLM",
    guardrail_note: notes.join(" "),
    reasoning_chain: [
      summary ? `全局诊断：${summary}` : "AI 参谋读取当前业务子图做跨对象比较。",
      group
        ? `广告组「${group.name}」：日预算 $${group.dailyBudget}、CPL $${group.cpl.toFixed(2)}、CPS $${group.cps.toFixed(2)}。`
        : creative
          ? `素材「${creative.headline}」：疲劳 ${creative.fatigueLevel}、合规 ${creative.complianceStatus}。`
          : `目标 ${s.actionType}:${s.targetId}`,
      `参谋理由：${s.rationale}`,
      "本条由 AI 参谋提出，未经执行；执行权仍在硬编码风控规则层与本体不变量。",
      ...notes,
    ],
    trigger_metric: s.metric,
    trigger_current_value: s.currentValue,
    trigger_threshold_value: s.thresholdValue,
    status: "PENDING_APPROVAL",
    effect,
    rollback_to: group
      ? `${group.name} ${group.status} / $${group.dailyBudget}`
      : creative
        ? `${creative.headline} ${creative.complianceStatus}`
        : s.targetId,
    action_params: s.params,
    ontology_before: ontology.ontology_before,
    ontology_diff: ontology.ontology_diff,
  };
}

/** 上一次参谋提案时间，供定时轨做 3 小时幂等（不含作战计划等其它 trigger）。 */
export async function lastAdvisorRunAt(): Promise<number | null> {
  const supabase = await db();
  const { data } = await supabase
    .from("advisor_runs")
    .select("started_at")
    .in("trigger_source", ["SWEEP", "MANUAL"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = (data ?? null) as Row | null;
  return r ? new Date(r.started_at as string).getTime() : null;
}

/** 指挥中心状态文案用：下次自动分析倒计时。 */
export async function getAdvisorScheduleStatus(): Promise<{
  readable: boolean;
  intervalHours: number;
  lastRunAt: string | null;
  killSwitch: boolean;
}> {
  const intervalHours = ADVISOR_MIN_INTERVAL_MS / 3_600_000;
  const { hasServiceRole } = await import("./read-client.server");
  if (!hasServiceRole()) {
    return {
      readable: false,
      intervalHours,
      lastRunAt: null,
      killSwitch: false,
    };
  }
  const limits = await loadLimits();
  const lastMs = await lastAdvisorRunAt();
  return {
    readable: true,
    intervalHours,
    lastRunAt: lastMs != null ? new Date(lastMs).toISOString() : null,
    killSwitch: limits.killSwitch,
  };
}

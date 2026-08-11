// Planner 的 LLM「分析师」层：只读快照 → 产出跨广告组诊断与建议 → 全部落为待审批。
// 严格边界：无 tool-calling、无 DB 写权限交给模型、输出必须过 sanitizeAdvice 净化。
// 执行权仍在硬编码风控层（guardrails.ts），批准时会再过一次闸门。
import type { AgentSnapshot } from "./types";
import {
  BUDGET_DELTA_MAX,
  BUDGET_DELTA_MIN,
  MAX_SUGGESTIONS,
  isNoop,
  sanitizeAdvice,
  type AdvisorSuggestion,
} from "./advisor";
import { checkBudgetChange } from "./guardrails";
import { loadLimits } from "./guardrails.server";
import { getSnapshot } from "./agent.server";

export const ADVISOR_MODEL = "openai/gpt-5.6-sol";
/** 定时轨的降频间隔：规则扫描 15 分钟一次，分析师 6 小时一次。 */
export const ADVISOR_MIN_INTERVAL_MS = 6 * 3600_000;

type Row = Record<string, any>;

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

const ACTION_LABEL: Record<string, string> = {
  BUDGET_SHIFT: "调整预算",
  CREATIVE_PAUSE: "暂停投放",
  CREATIVE_REFRESH: "刷新素材",
};

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

你的角色是分析师，不是执行者。你没有任何工具权限，不能修改预算、状态或素材。你的输出只会作为"待人工审批的建议"落库，之后还要过一层硬编码风控规则才可能执行。

请基于给定的数字事实做跨广告组的全局判断，特别关注纯阈值规则处理不好的情形：
- 矛盾信号（例如 CTR 上升但后端授信通过率下降）
- 跨广告组的预算再分配机会（把低胜率广告组的预算腾给高胜率广告组）
- 前端指标（CPL）与后端真实成本（CPS）背离

硬性输出约束：
1. action 只能是 BUDGET_SHIFT / CREATIVE_PAUSE / CREATIVE_REFRESH / NO_ACTION 之一。
2. adGroupId 必须逐字来自输入数据，禁止编造。
3. budgetDeltaPct 是整数百分比，范围 ${BUDGET_DELTA_MIN} 到 ${BUDGET_DELTA_MAX}，仅 BUDGET_SHIFT 使用。
4. 最多给 ${MAX_SUGGESTIONS} 条建议，每条必须给出中文 rationale，并引用具体数字。
5. metric 从 CPL / ApprovalRate / CostPerDisbursement / ROAS 中选一个，currentValue 与 thresholdValue 必须是数字。
6. confidence 为 0 到 1 的小数。
7. 没有值得动作的广告组时返回空数组，不要为了凑数编建议。

只返回 JSON，格式：
{"summary":"一句话全局诊断","suggestions":[{"adGroupId":"","action":"","budgetDeltaPct":0,"rationale":"","metric":"","currentValue":0,"thresholdValue":0,"confidence":0.7}]}`;
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
  const context = buildAdvisorContext(snapshot);

  let raw: any = {};
  let rawText = "";
  try {
    const out = await callAdvisorModel(context);
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

  const { kept, dropped } = sanitizeAdvice(raw, snapshot.adGroups.map((g) => g.id));
  const actionable = kept.filter((s) => !isNoop(s));
  const summary = typeof raw?.summary === "string" ? raw.summary.slice(0, 300) : "";

  const groupById = new Map(snapshot.adGroups.map((g) => [g.id, g]));
  const pendingGroups = new Set(
    snapshot.decisions
      .filter((d) => d.status === "PENDING_APPROVAL" && d.adGroupId)
      .map((d) => d.adGroupId as string),
  );

  const stamp = Date.now().toString(36);
  const rows = actionable.map((s, i) => buildDecisionRow(s, i, stamp, groupById, pendingGroups, limits, summary));

  if (rows.length) await supabase.from("agent_decisions").insert(rows as never);

  await supabase.from("advisor_runs").insert({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    trigger_source: triggerSource,
    ok: true,
    model: ADVISOR_MODEL,
    duration_ms: Date.now() - t0,
    raw_output: rawText.slice(0, 20000),
    suggestions_raw: kept.length + dropped.length,
    suggestions_kept: rows.length,
    dropped: dropped.map((d) => ({ index: d.index, reason: d.reason })) as never,
  } as never);

  return { ok: true, created: rows.length, dropped: dropped.length, summary };
}

function buildDecisionRow(
  s: AdvisorSuggestion,
  i: number,
  stamp: string,
  groupById: Map<string, AgentSnapshot["adGroups"][number]>,
  pendingGroups: Set<string>,
  limits: Awaited<ReturnType<typeof loadLimits>>,
  summary: string,
): Row {
  const g = groupById.get(s.adGroupId)!;
  const nextBudget =
    s.action === "BUDGET_SHIFT"
      ? Math.max(1, Math.round(g.dailyBudget * (1 + s.budgetDeltaPct / 100)))
      : g.dailyBudget;

  // 风控 dry-run：提前告诉审批人"批了会不会被规则层挡下"。
  const notes: string[] = [];
  if (s.action === "BUDGET_SHIFT") {
    const verdict = checkBudgetChange(limits, { current: g.dailyBudget, next: nextBudget });
    if (verdict.verdict === "DENY") {
      notes.push(`预判：批准时将被规则层拒绝（${verdict.rule}）——${verdict.detail}`);
    } else if (verdict.verdict === "CLAMP") {
      notes.push(`预判：批准时将被规则层截断至 $${verdict.value}（${verdict.rule}）。`);
    } else {
      notes.push("预判：该建议在当前风控限额内，批准后可执行。");
    }
  } else {
    notes.push("预判：非预算类动作，批准时仍需过风控姿态熔断与频次闸门。");
  }
  if (pendingGroups.has(s.adGroupId)) {
    notes.push("与规则层建议冲突：该广告组已有待审批的规则决策，两条并列，请人工裁决。");
  }

  const effect =
    s.action === "BUDGET_SHIFT"
      ? `建议：广告组「${g.name}」日预算 $${g.dailyBudget} → $${nextBudget}（${s.budgetDeltaPct > 0 ? "+" : ""}${s.budgetDeltaPct}%）`
      : `建议：广告组「${g.name}」${ACTION_LABEL[s.action] ?? s.action}`;

  return {
    id: `dec_llm_${stamp}_${i}`,
    timestamp: new Date().toISOString(),
    agent_type: "Planner",
    action_type: s.action,
    target_channel: g.channel,
    campaign_id: g.campaignId,
    campaign_name: g.campaignName,
    ad_group_id: g.id,
    ad_group_name: g.name,
    confidence_score: s.confidence,
    trigger_source: "LLM",
    guardrail_note: notes.join(" "),
    reasoning_chain: [
      summary ? `全局诊断：${summary}` : "LLM 分析师读取当前快照做跨广告组比较。",
      `广告组「${g.name}」：日预算 $${g.dailyBudget}、CPL $${g.cpl.toFixed(2)}、CPS $${g.cps.toFixed(2)}、近 20 条线索通过率 ${(g.last20ApprovalRate * 100).toFixed(1)}%。`,
      `分析师理由：${s.rationale}`,
      "本条由 LLM 分析师提出，未经执行；执行权仍在硬编码风控规则层。",
      ...notes,
    ],
    trigger_metric: s.metric,
    trigger_current_value: s.currentValue,
    trigger_threshold_value: s.thresholdValue,
    status: "PENDING_APPROVAL",
    effect,
    rollback_to: `${g.name} ${g.status} / $${g.dailyBudget}`,
  };
}

/** 上一次分析师运行时间，供定时轨做 6 小时幂等。 */
export async function lastAdvisorRunAt(): Promise<number | null> {
  const supabase = await db();
  const { data } = await supabase
    .from("advisor_runs")
    .select("started_at")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = (data ?? null) as Row | null;
  return r ? new Date(r.started_at as string).getTime() : null;
}

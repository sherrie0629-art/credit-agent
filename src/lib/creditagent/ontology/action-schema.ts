// 动作契约的可导出面：JSON Schema（给模型看）+ 信封 Zod（解析模型输出）+ ID 抽取。
// 形状只来自 ./actions.ts，这里不另定义字段。
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ACTION_TYPE_IDS, ACTION_TYPES, type ActionTypeId } from "./actions";
import type { ObjectTypeId } from "./objects";
import { validateActionParams } from "./invariants";

export const MAX_SUGGESTIONS = 5;

export const ADVISOR_METRICS = ["CPL", "ApprovalRate", "CostPerDisbursement", "ROAS"] as const;
export type AdvisorMetric = (typeof ADVISOR_METRICS)[number];

export const ADVISOR_ACTION_TYPES = [
  ...ACTION_TYPE_IDS,
  "NO_ACTION",
] as ["BUDGET_SHIFT", "BID_ADJUST", "CREATIVE_PAUSE", "CREATIVE_REFRESH", "VARIANT_PROMOTE", "COMPLIANCE_REJECT", "NO_ACTION"];
export type AdvisorActionType = (typeof ADVISOR_ACTION_TYPES)[number];

const jsonSchemaOpts = { $refStrategy: "none" as const, target: "jsonSchema7" as const };

export const advisorSuggestionSchema = z.object({
  actionType: z.enum(ADVISOR_ACTION_TYPES),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  rationale: z.string().trim().min(4).max(500),
  metric: z.enum(ADVISOR_METRICS),
  currentValue: z.number().finite(),
  thresholdValue: z.number().finite(),
  confidence: z.number().min(0).max(1),
});

export const advisorEnvelopeSchema = z.object({
  summary: z.string().max(300).optional().default(""),
  suggestions: z.array(advisorSuggestionSchema),
});

export type AdvisorEnvelope = z.infer<typeof advisorEnvelopeSchema>;
export type AdvisorSuggestion = z.infer<typeof advisorSuggestionSchema>;

export interface ActionRef {
  type: ObjectTypeId;
  id: string;
  field: string;
}

/** 各动作 params 里哪些字段是实体 ID。 */
const PARAM_REFS: Record<ActionTypeId, { field: string; type: ObjectTypeId; optional?: boolean }[]> = {
  BUDGET_SHIFT: [
    { field: "toAdGroupId", type: "AdGroup" },
    { field: "fromAdGroupId", type: "AdGroup", optional: true },
  ],
  BID_ADJUST: [{ field: "adGroupId", type: "AdGroup" }],
  CREATIVE_PAUSE: [
    { field: "creativeId", type: "CreativeAsset" },
    { field: "adGroupId", type: "AdGroup", optional: true },
  ],
  CREATIVE_REFRESH: [{ field: "creativeId", type: "CreativeAsset" }],
  VARIANT_PROMOTE: [
    { field: "experimentId", type: "CreativeExperiment" },
    { field: "winnerVariantId", type: "CreativeVariant" },
  ],
  COMPLIANCE_REJECT: [{ field: "creativeId", type: "CreativeAsset" }],
};

export function targetIdOf(actionType: ActionTypeId, params: Record<string, unknown>): string {
  switch (actionType) {
    case "BUDGET_SHIFT":
      return String(params["toAdGroupId"] ?? "");
    case "BID_ADJUST":
      return String(params["adGroupId"] ?? "");
    case "CREATIVE_PAUSE":
    case "CREATIVE_REFRESH":
    case "COMPLIANCE_REJECT":
      return String(params["creativeId"] ?? "");
    case "VARIANT_PROMOTE":
      return String(params["experimentId"] ?? "");
    default:
      return "";
  }
}

export function extractActionRefs(actionType: ActionTypeId, params: Record<string, unknown>): ActionRef[] {
  const refs: ActionRef[] = [];
  for (const spec of PARAM_REFS[actionType]) {
    const raw = params[spec.field];
    if (raw === undefined || raw === null || raw === "") {
      if (!spec.optional) refs.push({ type: spec.type, id: "", field: spec.field });
      continue;
    }
    refs.push({ type: spec.type, id: String(raw), field: spec.field });
  }
  return refs;
}

export function missingRefs(
  actionType: ActionTypeId,
  params: Record<string, unknown>,
  knownRefs: Set<string>,
): ActionRef[] {
  if (knownRefs.size === 0) return [];
  return extractActionRefs(actionType, params).filter((r) => !r.id || !knownRefs.has(`${r.type}:${r.id}`));
}

export function actionParamsJsonSchema(id: ActionTypeId) {
  return zodToJsonSchema(ACTION_TYPES[id].schema, { ...jsonSchemaOpts, name: `${id}Params` });
}

export function advisorEnvelopeJsonSchema() {
  return zodToJsonSchema(advisorEnvelopeSchema, { ...jsonSchemaOpts, name: "AdvisorEnvelope" });
}

/** 贴进 system prompt 的契约块：信封 + 各动作 params。 */
export function advisorPromptSchemaBlock(): string {
  const actionParams = Object.fromEntries(ACTION_TYPE_IDS.map((id) => [id, actionParamsJsonSchema(id)]));
  return JSON.stringify({ envelope: advisorEnvelopeJsonSchema(), actionParams }, null, 2);
}

export function parseAdvisorEnvelope(raw: unknown):
  | { ok: true; data: AdvisorEnvelope }
  | { ok: false; error: string } {
  const parsed = advisorEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    };
  }
  return { ok: true, data: parsed.data };
}

export type ActionParamValue = string | number | boolean | null;
export type ActionParams = Record<string, ActionParamValue>;

export interface ScreenedSuggestion {
  actionType: ActionTypeId;
  params: ActionParams;
  rationale: string;
  metric: AdvisorMetric;
  currentValue: number;
  thresholdValue: number;
  confidence: number;
  targetId: string;
}

export interface ScreenResult {
  ok: boolean;
  error?: string;
  summary: string;
  kept: ScreenedSuggestion[];
  dropped: { index: number; reason: string; raw: unknown }[];
}

/**
 * 解析信封、校验 params 形状、核对子图引用、去重。
 * 不跑 ontologyPreflight（那一步要查库）。
 */
export function screenAdvisorSuggestions(raw: unknown, knownRefs: Set<string>): ScreenResult {
  const envelope = parseAdvisorEnvelope(raw);
  if (!envelope.ok) {
    return { ok: false, error: envelope.error, summary: "", kept: [], dropped: [] };
  }

  const kept: ScreenedSuggestion[] = [];
  const dropped: ScreenResult["dropped"] = [];
  const seen = new Set<string>();

  envelope.data.suggestions.forEach((item, index) => {
    if (item.actionType === "NO_ACTION") {
      dropped.push({ index, reason: "NO_ACTION 无需生成决策卡", raw: item });
      return;
    }
    const actionType = item.actionType as ActionTypeId;
    if (kept.length >= MAX_SUGGESTIONS) {
      dropped.push({ index, reason: `超出单轮上限 ${MAX_SUGGESTIONS} 条`, raw: item });
      return;
    }

    const parsed = validateActionParams(actionType, item.params ?? {});
    if (!parsed.ok) {
      dropped.push({ index, reason: `ACTION_SCHEMA: ${parsed.error}`, raw: item });
      return;
    }
    const params = parsed.data as ActionParams;

    const missing = missingRefs(actionType, params, knownRefs);
    if (missing.length > 0) {
      dropped.push({
        index,
        reason: `实体 ID 不在本体子图中（疑似幻觉）：${missing.map((m) => `${m.type}:${m.id || "(空)"}`).join(", ")}`,
        raw: item,
      });
      return;
    }

    const targetId = targetIdOf(actionType, params);
    const dedupeKey = `${actionType}:${targetId}`;
    if (seen.has(dedupeKey)) {
      dropped.push({ index, reason: "同一目标实体重复建议，只保留第一条", raw: item });
      return;
    }
    seen.add(dedupeKey);

    kept.push({
      actionType,
      params,
      rationale: item.rationale,
      metric: item.metric,
      currentValue: item.currentValue,
      thresholdValue: item.thresholdValue,
      confidence: item.confidence,
      targetId,
    });
  });

  return { ok: true, summary: envelope.data.summary ?? "", kept, dropped };
}

export function describeActionEffect(
  actionType: ActionTypeId,
  params: Record<string, unknown>,
  labels: { targetName?: string } = {},
): string {
  const name = labels.targetName ?? String(targetIdOf(actionType, params));
  switch (actionType) {
    case "BUDGET_SHIFT":
      return `建议：广告组「${name}」日预算 → $${Number(params["nextDailyBudget"] ?? 0).toLocaleString()}（调拨 $${Number(params["amount"] ?? 0).toLocaleString()}）`;
    case "BID_ADJUST":
      return `建议：广告组「${name}」出价目标 → $${Number(params["nextBidTarget"] ?? 0).toLocaleString()}`;
    case "CREATIVE_PAUSE":
      return `建议：暂停素材「${name}」的投放关系`;
    case "CREATIVE_REFRESH":
      return `建议：刷新素材「${name}」并生成变体`;
    case "VARIANT_PROMOTE":
      return `建议：实验 ${params["experimentId"]} 晋级变体 ${params["winnerVariantId"]}`;
    case "COMPLIANCE_REJECT":
      return `建议：合规驳回素材「${name}」${params["reason"] ? `（${params["reason"]}）` : ""}`;
    default:
      return `建议：${actionType}`;
  }
}

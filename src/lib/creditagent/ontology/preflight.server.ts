// 本体不变量的服务端执行器：装配上下文 → 跑不变量 → 落审计日志。
// 与 guardrails.server.ts 的 preflight 串联使用：先熔断/频次，再结构性不变量。
import { ACTION_TYPES, type ActionTypeId } from "./actions";
import { OBJECT_TYPES } from "./objects";
import { targetIdOf } from "./action-schema";
import {
  checkInvariants,
  validateActionParams,
  type InvariantContext,
  type InvariantResult,
} from "./invariants";

type Row = Record<string, any>;

async function db() {
  const { getReadClient } = await import("../read-client.server");
  return getReadClient();
}

async function one(table: string, column: string, value: string): Promise<Row | null> {
  if (!value) return null;
  const supabase = await db();
  const { data } = await (supabase as any).from(table).select("*").eq(column, value).maybeSingle();
  return (data as Row) ?? null;
}

async function buildContext(actionType: ActionTypeId, params: Row): Promise<InvariantContext> {
  const def = ACTION_TYPES[actionType];
  const ctx: InvariantContext = {};
  const id = targetIdOf(actionType, params);

  if (actionType === "CREATIVE_PAUSE") {
    // 作用对象是投放关系，但合规/疲劳判断落在素材本体上。
    ctx.target = params["adGroupId"]
      ? await (async () => {
          const supabase = await db();
          const { data } = await (supabase as any)
            .from("creative_placements")
            .select("*")
            .eq("creative_id", id)
            .eq("ad_group_id", String(params["adGroupId"]))
            .maybeSingle();
          return (data as Row) ?? null;
        })()
      : await one("creative_assets", "id", id);
  } else {
    ctx.target = await one(OBJECT_TYPES[def.actsOn].table, OBJECT_TYPES[def.actsOn].idColumns[0]!, id);
  }

  if (def.actsOn === "AdGroup" && ctx.target?.["campaign_id"]) {
    ctx.parentCampaign = await one("campaigns", "id", String(ctx.target["campaign_id"]));
  }
  if (actionType === "BUDGET_SHIFT" && params["fromAdGroupId"]) {
    ctx.sourceAdGroup = await one("ad_groups", "id", String(params["fromAdGroupId"]));
  }
  if (actionType === "VARIANT_PROMOTE") {
    ctx.experiment = ctx.target;
  }
  return ctx;
}

export interface OntologyPreflightResult {
  ok: boolean;
  actionType: ActionTypeId;
  targetId: string;
  result?: InvariantResult;
  paramError?: string;
}

/**
 * 结构性前置校验。任何自动写入路径在 guardrails.preflight 通过后调用。
 * 违反时写入 guardrail_events（DENY），便于在护栏审计里回溯。
 */
export async function ontologyPreflight(input: {
  actionType: ActionTypeId;
  params: unknown;
  automated?: boolean;
}): Promise<OntologyPreflightResult> {
  const parsed = validateActionParams(input.actionType, input.params);
  if (!parsed.ok) {
    await audit(input.actionType, "", "ACTION_SCHEMA", parsed.error, input.params);
    return { ok: false, actionType: input.actionType, targetId: "", paramError: parsed.error };
  }

  const params = parsed.data as Row;
  const targetId = targetIdOf(input.actionType, params);
  const ctx = await buildContext(input.actionType, params);
  const result = checkInvariants(input.actionType, params, ctx);

  if (!result.ok) {
    await audit(
      input.actionType,
      targetId,
      result.violations[0]!.rule,
      result.violations.map((v) => v.detail).join(" / "),
      params,
    );
  }

  return { ok: result.ok, actionType: input.actionType, targetId, result };
}

async function audit(
  action: string,
  targetId: string,
  rule: string,
  detail: string,
  requested: unknown,
) {
  try {
    const { recordGuardrail } = await import("../guardrails.server");
    await recordGuardrail({
      action: `ONTOLOGY:${action}`,
      targetId,
      decision: { verdict: "DENY", rule, detail },
      requested: (requested ?? {}) as Record<string, unknown>,
    });
  } catch {
    /* 审计不可阻塞主流程 */
  }
}

/**
 * Seed PENDING approval cards that exercise Meta Ads write paths on approve.
 * Budget pushes target Ad Set (meta_resource_name on ad_groups).
 */
import { getSnapshot } from "./agent.server";
import { getMetaAdsMode } from "./meta-ads.server";
import { loadLimits } from "./guardrails.server";
import { hasServiceRole, LOCAL_WRITE_HINT } from "./read-client.server";

type Row = Record<string, any>;

const QA_ID_PREFIX = "qa_meta_";

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

function fmtMoney(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

export type MetaAdsWriteQaResult = {
  ok: boolean;
  message: string;
  warning?: string;
  cards: { id: string; label: string; actionType: string; adGroupId: string; adGroupName: string }[];
  skipped: string[];
  targetAdGroupId: string | null;
  targetAdGroupName: string | null;
  snapshot: Awaited<ReturnType<typeof getSnapshot>>;
};

export async function seedMetaAdsWriteTestDecisions(): Promise<MetaAdsWriteQaResult> {
  const empty = async (
    partial: Partial<MetaAdsWriteQaResult> & { message: string },
  ): Promise<MetaAdsWriteQaResult> => ({
    ok: false,
    cards: [],
    skipped: [],
    targetAdGroupId: null,
    targetAdGroupName: null,
    snapshot: await getSnapshot(),
    ...partial,
  });

  if (!hasServiceRole()) {
    return empty({ message: "本地为只读模式，无法写入验收卡片", warning: LOCAL_WRITE_HINT });
  }

  const supabase = await db();
  const mode = getMetaAdsMode();
  const limits = await loadLimits();
  const warnings: string[] = [];
  if (mode !== "test") {
    warnings.push("META_ADS_MODE 不是 test：批准后不会推送 Meta（仅本地/跳过）");
  }
  if (limits.killSwitch) {
    warnings.push("风控姿态为全局熔断：批准也不会调用 Meta Ads API");
  }

  const { data: groups, error: gErr } = await supabase
    .from("ad_groups")
    .select("id, name, channel, origin, daily_budget, meta_resource_name, campaign_id, status")
    .eq("channel", "Meta")
    .order("id");
  if (gErr) return empty({ message: `读取广告组失败：${gErr.message}` });

  const allGroups = (groups ?? []) as Row[];
  const { data: camps } = await supabase
    .from("campaigns")
    .select("id, name, meta_resource_name, origin")
    .eq("channel", "Meta");
  const campById = new Map(((camps ?? []) as Row[]).map((c) => [c.id as string, c]));

  const bound = allGroups.find(
    (g) => g.origin === "meta_sync" && String(g.meta_resource_name ?? "").trim(),
  );

  if (!bound) {
    return empty({
      message: "没有已对上号的 Meta 同步 Ad Set。请先「从 Meta 同步结构」。",
    });
  }

  const unboundDemo = allGroups.find((g) => {
    if (g.id === bound.id) return false;
    return g.origin === "demo" && !String(g.meta_resource_name ?? "").trim();
  });

  await supabase
    .from("agent_decisions")
    .update({ status: "REJECTED_BY_USER" } as never)
    .eq("status", "PENDING_APPROVAL")
    .like("id", `${QA_ID_PREFIX}%`);

  const stamp = Date.now().toString(36);
  const current = Math.max(1, Math.round(Number(bound.daily_budget) || 1000));
  const camp = campById.get(String(bound.campaign_id));
  const campName = String(camp?.name ?? bound.campaign_id);
  const groupName = String(bound.name);
  const smallTarget = Math.max(1, Math.round(current * 1.1));
  const clampTarget = Math.round(current * 1.5);
  const denyTarget = Math.round(current * 2);

  const now = new Date().toISOString();
  const cards: MetaAdsWriteQaResult["cards"] = [];
  const skipped: string[] = [];

  const insertBudget = async (
    suffix: string,
    label: string,
    to: number,
    adGroupId: string,
    adGroupName: string,
    campaignId: string,
    campaignName: string,
  ) => {
    const id = `${QA_ID_PREFIX}${suffix}_${stamp}`;
    const from = adGroupId === bound.id ? current : Math.max(1, Math.round(Number(
      allGroups.find((g) => g.id === adGroupId)?.daily_budget,
    ) || 1000));
    await supabase.from("agent_decisions").insert({
      id,
      timestamp: now,
      agent_type: "Execution",
      action_type: "BUDGET_SHIFT",
      target_channel: "Meta",
      campaign_id: campaignId,
      campaign_name: campaignName,
      ad_group_id: adGroupId,
      ad_group_name: adGroupName,
      confidence_score: 0.91,
      trigger_source: "EVENT",
      reasoning_chain: [
        `Meta 写入验收：${label}`,
        `Ad Set ${adGroupName}（${adGroupId}）日预算 $${fmtMoney(from)} → $${fmtMoney(to)}`,
        "批准后 MODE=test 且已绑定则推送 Meta Ad Set daily_budget。",
      ],
      trigger_metric: "CostPerDisbursement",
      trigger_current_value: from,
      trigger_threshold_value: to,
      status: "PENDING_APPROVAL",
      effect: `日预算 $${fmtMoney(from)} → $${fmtMoney(to)}`,
      rollback_to: `${adGroupName} $${fmtMoney(from)}`,
    } as never);
    cards.push({ id, label, actionType: "BUDGET_SHIFT", adGroupId, adGroupName });
  };

  await insertBudget("A_budget", "A 预算 +10% 推送", smallTarget, bound.id, groupName, String(bound.campaign_id), campName);

  const pauseId = `${QA_ID_PREFIX}B_pause_${stamp}`;
  await supabase.from("agent_decisions").insert({
    id: pauseId,
    timestamp: now,
    agent_type: "Execution",
    action_type: "CREATIVE_PAUSE",
    target_channel: "Meta",
    campaign_id: bound.campaign_id,
    campaign_name: campName,
    ad_group_id: bound.id,
    ad_group_name: groupName,
    confidence_score: 0.9,
    trigger_source: "EVENT",
    reasoning_chain: [
      "Meta 写入验收：B 暂停 Ad Set",
      `批准后推送 status=PAUSED → ${bound.meta_resource_name}`,
    ],
    trigger_metric: "ApprovalRate",
    trigger_current_value: 0,
    trigger_threshold_value: 0.1,
    status: "PENDING_APPROVAL",
    effect: `广告组「${groupName}」暂停`,
    rollback_to: `${groupName} ACTIVE / $${fmtMoney(current)}`,
  } as never);
  cards.push({
    id: pauseId,
    label: "B 暂停推送",
    actionType: "CREATIVE_PAUSE",
    adGroupId: bound.id,
    adGroupName: groupName,
  });

  await insertBudget("C_clamp", "C CLAMP 幅度（约 +50%）", clampTarget, bound.id, groupName, String(bound.campaign_id), campName);
  await insertBudget("D_deny", "D DENY 幅度（约 +100%）", denyTarget, bound.id, groupName, String(bound.campaign_id), campName);

  if (unboundDemo) {
    await insertBudget(
      "E_unbound",
      "E 未绑定 demo（应拒绝推送）",
      Math.max(1, Math.round(Number(unboundDemo.daily_budget) || 1000) + 50),
      unboundDemo.id,
      String(unboundDemo.name),
      String(unboundDemo.campaign_id),
      String(campById.get(String(unboundDemo.campaign_id))?.name ?? unboundDemo.campaign_id),
    );
  } else {
    skipped.push("E 未绑定：无合适的 demo Meta 广告组");
  }

  return {
    ok: true,
    message: `已生成 ${cards.length} 张 Meta 写入验收卡片`,
    warning: warnings.length ? warnings.join("；") : undefined,
    cards,
    skipped,
    targetAdGroupId: bound.id,
    targetAdGroupName: groupName,
    snapshot: await getSnapshot(),
  };
}

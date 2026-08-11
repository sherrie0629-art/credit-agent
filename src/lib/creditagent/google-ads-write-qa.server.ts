/**
 * Seed PENDING approval cards that exercise Google Ads write paths on approve.
 * Safe small budget bumps + guardrail / unbound negative cases.
 */
import { getSnapshot } from "./agent.server";
import { getGoogleAdsMode } from "./google-ads.server";
import { loadLimits } from "./guardrails.server";
import { hasServiceRole, LOCAL_WRITE_HINT } from "./read-client.server";

type Row = Record<string, any>;

const QA_ID_PREFIX = "qa_gads_";

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

function fmtMoney(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

function budgetEffect(from: number, to: number) {
  return `日预算 $${fmtMoney(from)} → $${fmtMoney(to)}`;
}

export type GoogleAdsWriteQaCard = {
  id: string;
  label: string;
  actionType: string;
  adGroupId: string;
  adGroupName: string;
};

export type GoogleAdsWriteQaResult = {
  ok: boolean;
  message: string;
  warning?: string;
  cards: GoogleAdsWriteQaCard[];
  skipped: string[];
  targetAdGroupId: string | null;
  targetAdGroupName: string | null;
  snapshot: Awaited<ReturnType<typeof getSnapshot>>;
};

export async function seedGoogleAdsWriteTestDecisions(): Promise<GoogleAdsWriteQaResult> {
  const empty = async (
    partial: Partial<GoogleAdsWriteQaResult> & { message: string },
  ): Promise<GoogleAdsWriteQaResult> => ({
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
  const mode = getGoogleAdsMode();
  const limits = await loadLimits();
  const warnings: string[] = [];
  if (mode !== "test") {
    warnings.push("GOOGLE_ADS_MODE 不是 test：批准后不会推送 Google（仅本地/跳过）");
  }
  if (limits.killSwitch) {
    warnings.push("Kill Switch 已开启：批准也不会调用 Google Ads API");
  }

  const { data: groups, error: gErr } = await supabase
    .from("ad_groups")
    .select("id, name, channel, origin, daily_budget, google_resource_name, campaign_id, status")
    .eq("channel", "Google")
    .order("id");
  if (gErr) return empty({ message: `读取广告组失败：${gErr.message}` });

  const allGroups = (groups ?? []) as Row[];
  const { data: camps } = await supabase
    .from("campaigns")
    .select("id, name, google_budget_resource_name, google_resource_name, origin")
    .eq("channel", "Google");
  const campById = new Map(((camps ?? []) as Row[]).map((c) => [c.id as string, c]));

  const bound = allGroups.find((g) => {
    if (g.origin !== "google_sync") return false;
    if (!String(g.google_resource_name ?? "").trim()) return false;
    const camp = campById.get(String(g.campaign_id));
    return Boolean(camp?.google_budget_resource_name?.trim());
  });

  if (!bound) {
    return empty({
      message: "没有已对上号的 Google 同步广告组。请先「从 Google 同步结构」，并确认系列带 campaign_budget。",
    });
  }

  const unboundDemo = allGroups.find((g) => {
    if (g.id === bound.id) return false;
    const hasRes = Boolean(String(g.google_resource_name ?? "").trim());
    return g.origin === "demo" && !hasRes;
  });

  // Retire previous QA pending cards (id prefix).
  await supabase
    .from("agent_decisions")
    .update({ status: "REJECTED_BY_USER" } as never)
    .eq("status", "PENDING_APPROVAL")
    .like("id", `${QA_ID_PREFIX}%`);

  const stamp = Date.now().toString(36);
  const current = Math.max(1, Math.round(Number(bound.daily_budget) || 1000));
  const camp = campById.get(String(bound.campaign_id))!;
  const campName = String(camp.name ?? bound.campaign_id);
  const groupName = String(bound.name);

  const smallTarget = Math.max(1, Math.round(current * 1.1)); // +10% within 30% step
  const clampTarget = limits.maxAdGroupDailyBudget + 5_000;
  // STEP deny must stay under abs cap (abs check runs first and would CLAMP).
  const stepDenyFloor = Math.ceil(current * (1 + (limits.maxBudgetDeltaPct + 10) / 100));
  const canStepDeny = stepDenyFloor <= limits.maxAdGroupDailyBudget;

  type Spec = {
    suffix: string;
    label: string;
    actionType: "BUDGET_SHIFT" | "CREATIVE_PAUSE";
    adGroupId: string;
    adGroupName: string;
    campaignId: string;
    campaignName: string;
    effect: string;
    rollbackTo: string;
    reasoning: string[];
  };

  const specs: Spec[] = [
    {
      suffix: "a_budget",
      label: "A · 小幅加预算（应推送 Google）",
      actionType: "BUDGET_SHIFT",
      adGroupId: String(bound.id),
      adGroupName: groupName,
      campaignId: String(bound.campaign_id),
      campaignName: campName,
      effect: budgetEffect(current, smallTarget),
      rollbackTo: `$${fmtMoney(current)}`,
      reasoning: [
        "【Google 写入验收卡 A】批准后应调用 CampaignBudget mutate。",
        `目标广告组「${groupName}」已同步并对上号。`,
        `日预算 $${fmtMoney(current)} → $${fmtMoney(smallTarget)}（约 +10%，应在护栏内 ALLOW）。`,
      ],
    },
    {
      suffix: "b_pause",
      label: "B · 暂停广告组（应推送 Google）",
      actionType: "CREATIVE_PAUSE",
      adGroupId: String(bound.id),
      adGroupName: groupName,
      campaignId: String(bound.campaign_id),
      campaignName: campName,
      effect: `暂停广告组「${groupName}」`,
      rollbackTo: String(bound.status ?? "ACTIVE"),
      reasoning: [
        "【Google 写入验收卡 B】批准后应调用广告组状态 mutate → PAUSED。",
        "恢复投放请用预算页人工改状态（批准路径目前只推暂停）。",
      ],
    },
    {
      suffix: "c_clamp",
      label: "C · 护栏截断（绝对上限 CLAMP）",
      actionType: "BUDGET_SHIFT",
      adGroupId: String(bound.id),
      adGroupName: groupName,
      campaignId: String(bound.campaign_id),
      campaignName: campName,
      effect: budgetEffect(current, clampTarget),
      rollbackTo: `$${fmtMoney(current)}`,
      reasoning: [
        "【Google 写入验收卡 C】目标超过 maxAdGroupDailyBudget，批准时应 CLAMP 后推送截断值。",
        `目标 $${fmtMoney(clampTarget)} → 期望截断至 $${fmtMoney(limits.maxAdGroupDailyBudget)}。`,
      ],
    },
  ];

  const skipped: string[] = [];
  if (canStepDeny) {
    specs.push({
      suffix: "d_deny",
      label: "D · 护栏拒绝（单次幅度 DENY）",
      actionType: "BUDGET_SHIFT",
      adGroupId: String(bound.id),
      adGroupName: groupName,
      campaignId: String(bound.campaign_id),
      campaignName: campName,
      effect: budgetEffect(current, stepDenyFloor),
      rollbackTo: `$${fmtMoney(current)}`,
      reasoning: [
        "【Google 写入验收卡 D】单次变动超过 maxBudgetDeltaPct，批准应被拒绝且不推 Google。",
        `$${fmtMoney(current)} → $${fmtMoney(stepDenyFloor)}（上限 ${limits.maxBudgetDeltaPct}%）。`,
      ],
    });
  } else {
    skipped.push(
      "D · 护栏拒绝：当前日预算过高，无法在绝对上限内构造幅度拒绝，已跳过",
    );
  }

  if (unboundDemo) {
    specs.push({
      suffix: "e_unbound",
      label: "E · 未对上号（应拒绝推送）",
      actionType: "BUDGET_SHIFT",
      adGroupId: String(unboundDemo.id),
      adGroupName: String(unboundDemo.name),
      campaignId: String(unboundDemo.campaign_id),
      campaignName: String(campById.get(String(unboundDemo.campaign_id))?.name ?? unboundDemo.campaign_id),
      effect: budgetEffect(
        Math.max(1, Math.round(Number(unboundDemo.daily_budget) || 1000)),
        Math.max(1, Math.round((Number(unboundDemo.daily_budget) || 1000) * 1.1)),
      ),
      rollbackTo: `$${fmtMoney(Math.max(1, Math.round(Number(unboundDemo.daily_budget) || 1000)))}`,
      reasoning: [
        "【Google 写入验收卡 E】演示组未绑定 google_resource_name。",
        "批准时应报未对上号 / 未推送 Google。",
      ],
    });
  } else {
    skipped.push("E · 未对上号：没有无 resource 的 demo Google 广告组，已跳过");
  }

  const now = new Date().toISOString();
  const cards: GoogleAdsWriteQaCard[] = [];
  const rows = specs.map((s) => {
    const id = `${QA_ID_PREFIX}${s.suffix}_${stamp}`;
    cards.push({
      id,
      label: s.label,
      actionType: s.actionType,
      adGroupId: s.adGroupId,
      adGroupName: s.adGroupName,
    });
    return {
      id,
      timestamp: now,
      agent_type: "Execution",
      action_type: s.actionType,
      target_channel: "Google",
      campaign_id: s.campaignId,
      campaign_name: s.campaignName,
      ad_group_id: s.adGroupId,
      ad_group_name: s.adGroupName,
      confidence_score: 0.99,
      trigger_source: "EVENT",
      reasoning_chain: s.reasoning,
      trigger_metric: "CostPerDisbursement",
      trigger_current_value: 0,
      trigger_threshold_value: 19,
      status: "PENDING_APPROVAL",
      effect: s.effect,
      rollback_to: s.rollbackTo,
      guardrail_note: null,
    };
  });

  const { error: insErr } = await supabase.from("agent_decisions").insert(rows as never);
  if (insErr) {
    return empty({ message: `插入验收卡片失败：${insErr.message}` });
  }

  const warning = warnings.length ? warnings.join("；") : undefined;
  return {
    ok: true,
    message: `已生成 ${cards.length} 张写入验收卡 → 广告组「${groupName}」`,
    warning,
    cards,
    skipped,
    targetAdGroupId: String(bound.id),
    targetAdGroupName: groupName,
    snapshot: await getSnapshot(),
  };
}

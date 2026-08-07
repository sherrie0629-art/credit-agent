// 创意疲劳巡检、AI 变体生成与 A/B 赛马结算（server-only）。
import { computeFatigue, FATIGUE_LEVEL_LABEL, type CreativeMetricPoint } from "./fatigue";
import { autoFixCompliance, scanCompliance, BANNED_PHRASES } from "./compliance";
import type { CreativeExperiment, CreativeVariant, ExperimentArm } from "./creative-types";
import { getCreativeFacts, getPrimaryPlacement, getSnapshot } from "./agent.server";
import { checkComplianceGate } from "./guardrails";
import { preflight, recordGuardrail } from "./guardrails.server";
import { IMAGE_ROUTE_PREFIX, toClientImageUrl, uploadVariantImage } from "./image-storage.server";


type Row = Record<string, any>;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export function mapMetric(r: Row): CreativeMetricPoint {
  return {
    creativeId: r.creative_id,
    day: r.day,
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    ctr: Number(r.ctr),
    cpl: Number(r.cpl),
    cps: Number(r.cps),
    frequency: Number(r.frequency),
    spend: Number(r.spend),
  };
}

export function mapVariant(r: Row): CreativeVariant {
  return {
    id: r.id,
    parentCreativeId: r.parent_creative_id,
    experimentId: r.experiment_id ?? undefined,
    headline: r.headline,
    bodyText: r.body_text,
    imageUrl: toClientImageUrl(r.image_url, r.id),
    angle: r.angle,
    complianceStatus: r.compliance_status,
    complianceScore: Number(r.compliance_score),
    complianceLogs: (r.compliance_logs ?? []) as string[],
    status: r.status,
    createdAt: r.created_at,
  };
}

export function mapExperiment(r: Row): CreativeExperiment {
  return {
    id: r.id,
    parentCreativeId: r.parent_creative_id,
    status: r.status,
    startedAt: r.started_at,
    decidedAt: r.decided_at ?? undefined,
    winnerVariantId: r.winner_variant_id ?? undefined,
    armStats: (r.arm_stats ?? []) as ExperimentArm[],
  };
}

async function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)
    .toString(36)
    .padStart(3, "0")}`;
}

async function insertDecision(row: Row) {
  const supabase = await db();
  await supabase.from("agent_decisions").insert(row as never);
}

/**
 * Resolve which campaign a creative-driven decision belongs to, so the decision
 * feed shows the real ad campaign while still naming the creative behind it.
 */
async function attribution(creativeId: string, creativeName: string) {
  const p = await getPrimaryPlacement(creativeId);
  return {
    target_channel: p?.channel ?? (creativeId.includes("_g_") ? "Google" : "Meta"),
    campaign_id: p?.campaignId ?? creativeId,
    campaign_name: p?.campaignName ?? creativeName,
    ad_group_id: p?.adGroupId ?? null,
    ad_group_name: p?.adGroupName ?? null,
    creative_id: creativeId,
    creative_name: creativeName,
    placementNote: p
      ? `该素材当前投放于「${p.campaignName} › ${p.adGroupName}」（${p.placement}），承担该广告组 ${(p.share * 100).toFixed(0)}% 的流量。`
      : "该素材当前未绑定任何广告组，仅在素材库中待投。",
  };
}


// ---------------------------------------------------------------- 疲劳巡检

export async function scanFatigue() {
  const supabase = await db();
  const [{ data: creatives }, { data: metrics }] = await Promise.all([
    supabase.from("creative_assets").select("*").order("sort_order"),
    supabase.from("creative_metrics").select("*").order("day"),
  ]);

  const byCreative = new Map<string, CreativeMetricPoint[]>();
  for (const r of (metrics ?? []) as Row[]) {
    const m = mapMetric(r);
    const list = byCreative.get(m.creativeId) ?? [];
    list.push(m);
    byCreative.set(m.creativeId, list);
  }

  const alerts: { creativeId: string; headline: string; score: number; level: string }[] = [];
  const now = new Date().toISOString();

  for (const c of ((creatives ?? []) as Row[])) {
    const result = computeFatigue(byCreative.get(c.id) ?? []);
    await supabase
      .from("creative_assets")
      .update({
        fatigue_score: result.score,
        fatigue_level: result.level,
        last_scanned_at: now,
      } as never)
      .eq("id", c.id);

    if (result.level === "FATIGUED") {
      alerts.push({
        creativeId: c.id,
        headline: c.headline,
        score: result.score,
        level: result.level,
      });
      const attr = await attribution(c.id, c.headline);
      const { placementNote, ...attrCols } = attr;
      const facts = (await getCreativeFacts()).get(c.id);
      const backendNote = facts
        ? `后端真实表现：${facts.leads} 条线索 / 授信通过 ${facts.approvedLoans} 条（${(facts.approvalRate * 100).toFixed(1)}%）/ 放款 ${facts.disbursedCount} 笔，实际 CPS $${facts.cps.toFixed(2)}。`
        : "该素材尚无后端线索数据，仅依据前端指标判定。";
      await insertDecision({
        id: `dec_fatigue_${c.id}_${now.slice(0, 10)}`,
        timestamp: now,
        agent_type: "Creative",
        action_type: "CREATIVE_REFRESH",
        ...attrCols,
        confidence_score: Math.min(0.99, 0.6 + result.score / 250),
        reasoning_chain: [placementNote, backendNote, ...result.reasoning],
        trigger_metric: "CPL",
        trigger_current_value: result.score,
        trigger_threshold_value: 70,
        status: "EXECUTED",
        effect: `素材「${c.headline}」判定为${FATIGUE_LEVEL_LABEL[result.level]}，建议生成新变体`,
      });

    }
  }

  return { snapshot: await getSnapshot(), alerts };
}

// ---------------------------------------------------------------- AI 变体生成

interface GeneratedVariant {
  angle: string;
  headline: string;
  bodyText: string;
  imagePrompt: string;
}

async function generateCopy(input: {
  headline: string;
  bodyText: string;
  reasons: string[];
}): Promise<GeneratedVariant[]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("MISSING_KEY");

  const prompt = `你是消费信贷广告的 Creative Agent。原素材出现广告疲劳，请生成 3 个全新的广告变体。

原标题：${input.headline}
原正文：${input.bodyText}
疲劳原因：${input.reasons.join("；")}

硬性合规要求（美国消费贷广告）：
- 严禁出现这些表述：${BANNED_PHRASES.join(", ")}
- 正文必须写明还款期限区间，最短不低于 61 天，例如 "Terms 61 days - 36 months"
- 正文必须披露 Representative APR，且不高于 35.9%
- 正文末尾必须包含 "Approval is subject to credit, income and affordability checks."

每个变体使用不同的创意角度（例如：理性算账、生活场景、信任背书），文案本身用英文（投放语言），angle 用中文一句话说明角度。
imagePrompt 用英文描述该变体的广告主视觉（真实摄影风格，无文字叠加）。

只返回 JSON：{"variants":[{"angle":"","headline":"","bodyText":"","imagePrompt":""}]}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3.6-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("NO_CREDITS");
  if (!res.ok) throw new Error(`AI_ERROR_${res.status}`);

  const json = (await res.json()) as any;
  const text: string = json?.choices?.[0]?.message?.content ?? "{}";
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/g, "");
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : { variants: [] };
  }
  const list = Array.isArray(parsed?.variants) ? parsed.variants : [];
  return list.slice(0, 3).map((v: any) => ({
    angle: String(v.angle ?? "新角度"),
    headline: String(v.headline ?? ""),
    bodyText: String(v.bodyText ?? v.body_text ?? ""),
    imagePrompt: String(v.imagePrompt ?? v.image_prompt ?? "modern fintech lifestyle photography"),
  }));
}

export async function generateVariants(creativeId: string) {
  const supabase = await db();
  const { data: creative } = await supabase
    .from("creative_assets")
    .select("*")
    .eq("id", creativeId)
    .maybeSingle();
  if (!creative) return { snapshot: await getSnapshot(), created: 0 };
  const c = creative as Row;

  const { data: metrics } = await supabase
    .from("creative_metrics")
    .select("*")
    .eq("creative_id", creativeId)
    .order("day");
  const fatigue = computeFatigue(((metrics ?? []) as Row[]).map(mapMetric));
  const reasons = fatigue.signals.filter((s) => s.hit).map((s) => `${s.label} — ${s.detail}`);

  const generated = await generateCopy({
    headline: c.headline,
    bodyText: c.body_text,
    reasons: reasons.length ? reasons : ["素材长期投放，需要更新创意角度"],
  });

  const rows: Row[] = [];
  const now = new Date().toISOString();

  for (const g of generated) {
    let input = {
      headline: g.headline,
      bodyText: g.bodyText,
      loanTermRange: "61 days - 36 months",
      maxApr: 35.9,
      specialAdCategory: true,
    };
    let scan = scanCompliance(input);
    const logs: string[] = [`AI 生成角度：${g.angle}`, `初次合规评分 ${scan.score}/100`];

    if (scan.blocked) {
      const fixed = autoFixCompliance(input);
      input = fixed.next;
      logs.push(...fixed.changes.map((x) => `自动修复：${x}`));
      scan = scanCompliance(input);
      logs.push(`修复后评分 ${scan.score}/100`);
    }

    rows.push({
      id: await newId("var"),
      parent_creative_id: creativeId,
      headline: input.headline,
      body_text: input.bodyText,
      angle: g.angle,
      image_url: null,
      compliance_status: scan.status,
      compliance_score: scan.score,
      compliance_logs: logs,
      status: scan.blocked ? "BLOCKED" : "DRAFT",
      created_at: now,
    });
  }

  if (rows.length) await supabase.from("creative_variants").insert(rows as never);

  const genAttr = await attribution(creativeId, c.headline);
  await insertDecision({
    id: await newId("dec_gen"),
    timestamp: now,
    agent_type: "Creative",
    action_type: "CREATIVE_REFRESH",
    target_channel: genAttr.target_channel,
    campaign_id: genAttr.campaign_id,
    campaign_name: genAttr.campaign_name,
    ad_group_id: genAttr.ad_group_id,
    ad_group_name: genAttr.ad_group_name,
    creative_id: genAttr.creative_id,
    creative_name: genAttr.creative_name,
    confidence_score: 0.9,
    reasoning_chain: [
      genAttr.placementNote,
      `素材「${c.headline}」疲劳分 ${fatigue.score}/100，触发自动迭代。`,
      ...reasons.map((r) => `疲劳信号：${r}`),
      `Creative Agent 调用生成模型产出 ${rows.length} 个新变体，覆盖不同创意角度。`,
      `全部变体已过 Compliance Agent 审计，阻断 ${rows.filter((r) => r.status === "BLOCKED").length} 条。`,
    ],
    trigger_metric: "CPL",
    trigger_current_value: fatigue.score,
    trigger_threshold_value: 70,
    status: "EXECUTED",
    effect: `生成 ${rows.length} 个候选变体`,
  });


  return { snapshot: await getSnapshot(), created: rows.length };
}

// ---------------------------------------------------------------- 实验上线

export async function launchExperiment(creativeId: string, variantIds: string[]) {
  const supabase = await db();
  const { data: settings } = await supabase
    .from("agent_settings")
    .select("mode")
    .eq("id", "default")
    .maybeSingle();
  let mode = ((settings as Row | null)?.mode ?? "SEMI_AUTO") as "FULL_AUTO" | "SEMI_AUTO";

  const { data: creative } = await supabase
    .from("creative_assets")
    .select("*")
    .eq("id", creativeId)
    .maybeSingle();
  const { data: variantRows } = await supabase
    .from("creative_variants")
    .select("*")
    .in("id", variantIds);

  // —— 风控规则层：上线前的最后一关 ——
  const gate = await preflight({
    action: "LAUNCH_EXPERIMENT",
    targetId: creativeId,
    automated: mode === "FULL_AUTO",
  });
  if (mode === "FULL_AUTO" && !gate.ok) mode = "SEMI_AUTO";

  const candidates = ((variantRows ?? []) as Row[])
    .map(mapVariant)
    .filter((v) => v.status !== "BLOCKED");

  // 上线前用同一套硬编码规则实时复扫，防止 BLOCKED / 后续被改写的文案穿透上线。
  const variants: typeof candidates = [];
  for (const v of candidates) {
    const rescan = scanCompliance({
      headline: v.headline,
      bodyText: v.bodyText,
      loanTermRange: "61 days - 36 months",
      maxApr: 35.9,
      specialAdCategory: true,
    });
    const verdict = checkComplianceGate(rescan.status, rescan.score);
    await recordGuardrail({
      action: "LAUNCH_EXPERIMENT",
      targetId: v.id,
      decision: verdict,
      requested: { headline: v.headline },
    });
    if (verdict.verdict === "DENY") {
      await supabase
        .from("creative_variants")
        .update({
          status: "BLOCKED",
          compliance_status: rescan.status,
          compliance_score: rescan.score,
        } as never)
        .eq("id", v.id);
      continue;
    }
    variants.push(v);
  }

  if (variants.length === 0) {
    return { snapshot: await getSnapshot(), experimentId: null, mode };
  }


  const expId = await newId("exp");
  const now = new Date().toISOString();
  const arms: ExperimentArm[] = [
    {
      armId: creativeId,
      label: `对照组 · ${(creative as Row)?.headline ?? creativeId}`,
      kind: "CONTROL",
      impressions: 0,
      clicks: 0,
      ctr: 0,
      cpl: 0,
      cps: 0,
      loans: 0,
      confidence: 0,
    },
    ...variants.map((v) => ({
      armId: v.id,
      label: `变体 · ${v.angle}`,
      kind: "VARIANT" as const,
      impressions: 0,
      clicks: 0,
      ctr: 0,
      cpl: 0,
      cps: 0,
      loans: 0,
      confidence: 0,
    })),
  ];

  await supabase.from("creative_experiments").insert({
    id: expId,
    parent_creative_id: creativeId,
    status: "RUNNING",
    started_at: now,
    arm_stats: arms,
  } as never);

  await supabase
    .from("creative_variants")
    .update({ experiment_id: expId, status: mode === "FULL_AUTO" ? "RUNNING" : "PENDING" } as never)
    .in(
      "id",
      variants.map((v) => v.id),
    );

  const expAttr = await attribution(creativeId, (creative as Row)?.headline ?? creativeId);
  await insertDecision({
    id: await newId("dec_exp"),
    timestamp: now,
    agent_type: "Execution",
    action_type: "CREATIVE_REFRESH",
    target_channel: expAttr.target_channel,
    campaign_id: expAttr.campaign_id,
    campaign_name: expAttr.campaign_name,
    ad_group_id: expAttr.ad_group_id,
    ad_group_name: expAttr.ad_group_name,
    creative_id: expAttr.creative_id,
    creative_name: expAttr.creative_name,
    confidence_score: 0.88,
    reasoning_chain: [
      expAttr.placementNote,
      `准备上线 ${variants.length} 个新变体，与原素材组成 A/B 赛马。`,
      `预算按 ${arms.length} 臂均分，胜负判定条件：单臂曝光 ≥ 1000 且置信度 ≥ 95%。`,
      mode === "FULL_AUTO"
        ? "托管模式 = Full-Auto：变体直接上线投放。"
        : "托管模式 = Semi-Auto：推送审批卡片，人工确认后进入实验。",
    ],
    trigger_metric: "CPL",
    trigger_current_value: variants.length,
    trigger_threshold_value: 1,
    status: mode === "FULL_AUTO" ? "EXECUTED" : "PENDING_APPROVAL",
    effect: `实验 ${expId} 上线（${arms.length} 个投放臂）`,
    rollback_to: `仅保留原素材 ${creativeId}`,
  });


  return { snapshot: await getSnapshot(), experimentId: expId, mode };
}

// ---------------------------------------------------------------- 赛马结算

function normalCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (1.330274 * t ** 4 - 1.821256 * t ** 3 + 1.781478 * t * t - 0.356538 * t + 0.319382);
  return z > 0 ? 1 - p : p;
}

function accumulate(arm: ExperimentArm, index: number): ExperimentArm {
  const batch = 550 + Math.floor(Math.random() * 220);
  // 变体默认承接更强的新鲜度红利，控制组维持疲劳表现。
  const baseCtr = arm.kind === "CONTROL" ? 0.015 : 0.026 + index * 0.004;
  const noise = (Math.random() - 0.5) * 0.004;
  const ctr = Math.max(0.005, baseCtr + noise);
  const clicks = Math.round(batch * ctr);
  const impressions = arm.impressions + batch;
  const totalClicks = arm.clicks + clicks;
  const cpl = arm.kind === "CONTROL" ? 26 + Math.random() * 3 : 15 + Math.random() * 4;
  const cps = arm.kind === "CONTROL" ? 33 + Math.random() * 4 : 18 + Math.random() * 4;
  const loans = arm.loans + Math.max(1, Math.round(clicks * (arm.kind === "CONTROL" ? 0.05 : 0.11)));
  return {
    ...arm,
    impressions,
    clicks: totalClicks,
    ctr: totalClicks / impressions,
    cpl: Number(cpl.toFixed(2)),
    cps: Number(cps.toFixed(2)),
    loans,
  };
}

export async function settleExperiment(experimentId: string) {
  const supabase = await db();
  const { data } = await supabase
    .from("creative_experiments")
    .select("*")
    .eq("id", experimentId)
    .maybeSingle();
  if (!data) return { snapshot: await getSnapshot(), decided: false, message: "实验不存在" };
  const exp = mapExperiment(data as Row);
  if (exp.status === "DECIDED") {
    return { snapshot: await getSnapshot(), decided: true, message: "实验已结束" };
  }

  const arms = exp.armStats.map((a, i) => accumulate(a, i));
  const control = arms.find((a) => a.kind === "CONTROL")!;

  for (const arm of arms) {
    if (arm.kind === "CONTROL") {
      arm.confidence = 0;
      continue;
    }
    const p1 = arm.ctr;
    const p0 = control.ctr;
    const n1 = arm.impressions;
    const n0 = control.impressions;
    const p = (arm.clicks + control.clicks) / (n1 + n0);
    const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0)) || 1e-9;
    const z = (p1 - p0) / se;
    arm.confidence = Number(Math.min(0.999, Math.max(0, normalCdf(z))).toFixed(3));
  }

  const eligible = arms.filter(
    (a) => a.kind === "VARIANT" && a.impressions >= 1000 && a.confidence >= 0.95,
  );

  if (eligible.length === 0) {
    await supabase
      .from("creative_experiments")
      .update({ arm_stats: arms } as never)
      .eq("id", experimentId);
    return {
      snapshot: await getSnapshot(),
      decided: false,
      message: "样本积累中：尚未达到 1000 曝光 / 95% 置信度",
    };
  }

  const winner = eligible.reduce((best, a) => (a.cps < best.cps ? a : best), eligible[0]);
  const now = new Date().toISOString();

  await supabase
    .from("creative_experiments")
    .update({
      arm_stats: arms,
      status: "DECIDED",
      decided_at: now,
      winner_variant_id: winner.armId,
    } as never)
    .eq("id", experimentId);

  await supabase
    .from("creative_variants")
    .update({ status: "ELIMINATED" } as never)
    .eq("experiment_id", experimentId);
  await supabase
    .from("creative_variants")
    .update({ status: "WINNER" } as never)
    .eq("id", winner.armId);

  const winnerVariant = await supabase
    .from("creative_variants")
    .select("*")
    .eq("id", winner.armId)
    .maybeSingle();
  const wv = winnerVariant.data ? mapVariant(winnerVariant.data as Row) : null;

  if (wv) {
    // 写入 DB 的必须是存储短路径或 null，不能写 toClientImageUrl 产出的 legacy/ 代理地址。
    const rawImageUrl = (winnerVariant.data as Row | null)?.image_url as string | null | undefined;
    let promotedImageUrl: string | null = rawImageUrl ?? null;
    if (promotedImageUrl?.startsWith("data:")) {
      promotedImageUrl = (await uploadVariantImage(winner.armId, promotedImageUrl)) ?? null;
    } else if (promotedImageUrl?.includes("/legacy/")) {
      promotedImageUrl = `${IMAGE_ROUTE_PREFIX}/variants/${winner.armId}.png`;
    }

    await supabase
      .from("creative_assets")
      .update({
        headline: wv.headline,
        body_text: wv.bodyText,
        image_url: promotedImageUrl,
        compliance_status: wv.complianceStatus,
        fatigue_score: 0,
        fatigue_level: "HEALTHY",
        launched_at: now,
      } as never)
      .eq("id", exp.parentCreativeId);
  }

  const winAttr = await attribution(exp.parentCreativeId, wv?.headline ?? winner.label);
  await insertDecision({
    id: await newId("dec_win"),
    timestamp: now,
    agent_type: "Execution",
    action_type: "VARIANT_PROMOTE",
    target_channel: winAttr.target_channel,
    campaign_id: winAttr.campaign_id,
    campaign_name: winAttr.campaign_name,
    ad_group_id: winAttr.ad_group_id,
    ad_group_name: winAttr.ad_group_name,
    creative_id: winAttr.creative_id,
    creative_name: winAttr.creative_name,
    confidence_score: winner.confidence,
    reasoning_chain: [
      winAttr.placementNote,
      `实验 ${experimentId} 累计曝光 ${arms.reduce((s, a) => s + a.impressions, 0).toLocaleString()}。`,
      `对照组 CTR ${(control.ctr * 100).toFixed(2)}% / CPS $${control.cps.toFixed(2)}。`,
      `胜出臂「${winner.label}」CTR ${(winner.ctr * 100).toFixed(2)}% / CPS $${winner.cps.toFixed(2)}，置信度 ${(winner.confidence * 100).toFixed(1)}%。`,
      "决策：胜者承接全部预算，其余变体与疲劳原素材自动暂停。",
    ],
    trigger_metric: "CostPerDisbursement",
    trigger_current_value: winner.cps,
    trigger_threshold_value: control.cps,
    status: "EXECUTED",
    effect: `变体「${winner.label}」胜出并全量上线`,
    rollback_to: `恢复原素材 ${exp.parentCreativeId}`,
  });


  return {
    snapshot: await getSnapshot(),
    decided: true,
    message: `「${winner.label}」胜出，CPS $${winner.cps.toFixed(2)}（置信度 ${(winner.confidence * 100).toFixed(1)}%）`,
  };
}

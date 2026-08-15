// 素材短视频的业务层：模型单段最长 8 秒，所以一条成片由两段 8 秒串行生成。
// 角色锁定：第 1 段用变体主视觉做图生视频；第 1 段完成后由浏览器抽末帧，
// 作为第 2 段的起始帧再图生，保证脸/衣服/场景连续。两段齐后浏览器拼接烧字幕。

import type { CaptionLine } from "./video-caption.server";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/videos";
const MODEL = "google/veo-3.1-lite";
const SECONDS = "8";
const SIZE = "720x1280";
const [FRAME_W, FRAME_H] = SIZE.split("x").map(Number) as [number, number];

// #region agent log
function agentLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
) {
  fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
    body: JSON.stringify({
      sessionId: "6fd86b",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

export type VideoStage =
  | "SCRIPTING"
  | "SEGMENT_1"
  | "BRIDGE"
  | "SEGMENT_2"
  | "COMPOSING"
  | "DONE";

export interface VideoSegment {
  index: 1 | 2;
  jobId?: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  url?: string;
  /** 调试用：角色锁定提交证据（云端可查库） */
  lockDebug?: Record<string, unknown>;
}

export interface VideoJobView {
  targetId: string;
  jobId: string;
  status: "QUEUED" | "RUNNING" | "COMPOSING" | "COMPLETED" | "FAILED";
  stage?: VideoStage;
  segments?: VideoSegment[];
  captions?: CaptionLine[];
  videoUrl?: string;
  error?: string;
}

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return (await getAdminClient()) as unknown as { from: (t: string) => any };
}

function key() {
  const k = process.env["LOVABLE_API_KEY"];
  if (!k) throw new Error("Missing LOVABLE_API_KEY");
  return k;
}

function bytesToDataUrl(bytes: Uint8Array, contentType: string) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    bin += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return `data:${contentType};base64,${btoa(bin)}`;
}

/** 把参考图裁到网关要求的 size；非 PNG 时原样包成 data URL。 */
async function toReferenceDataUrl(bytes: Uint8Array, contentType: string) {
  const { fitToExactSize } = await import("./image-transform.server");
  const fitted = fitToExactSize(bytes, FRAME_W, FRAME_H);
  if (fitted) return bytesToDataUrl(fitted.bytes, fitted.contentType);
  return bytesToDataUrl(bytes, contentType || "image/png");
}

function wrapPrompt(scene: string) {
  return `A vertical 9:16 social video ad segment for a licensed US consumer lending brand. ${scene} Animate from the provided reference image as the first frame—keep the exact same person (face, hair, age, skin tone), clothing, accessories, room, and lighting. Cinematic natural light, trustworthy professional tone, smooth camera motion. Clear English speech only, natural pacing aligned to the listed dialogue lines. End the clip gently: complete speech before the last second and hold a still, calm beat—do not cut mid-word or mid-gesture. No on-screen text, no logos, no Chinese speech.`;
}

/** 向网关提交一段 8 秒图生视频，返回任务 id + 调试信息。 */
async function submitSegment(
  scene: string,
  referenceDataUrl: string,
): Promise<{ id: string; lockDebug: Record<string, unknown> }> {
  const prompt = wrapPrompt(scene);
  const refLen = referenceDataUrl.length;
  const refPrefix = referenceDataUrl.slice(0, 40);
  // Lovable 网关兼容 OpenAI Videos 形态；个别字段名可能略有差异，失败时换形态重试。
  const bodies: { label: string; body: Record<string, unknown> }[] = [
    {
      label: "input_reference.object",
      body: {
        model: MODEL,
        prompt,
        seconds: SECONDS,
        size: SIZE,
        input_reference: { image_url: referenceDataUrl },
      },
    },
    {
      label: "input_reference.string",
      body: {
        model: MODEL,
        prompt,
        seconds: SECONDS,
        size: SIZE,
        input_reference: referenceDataUrl,
      },
    },
    {
      label: "image.string",
      body: {
        model: MODEL,
        prompt,
        seconds: SECONDS,
        size: SIZE,
        image: referenceDataUrl,
      },
    },
  ];

  const attempts: Record<string, unknown>[] = [];
  let lastMessage = "视频生成请求失败。";
  for (const { label, body } of bodies) {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const errBody = res.ok
      ? null
      : ((await res.json().catch(() => null)) as { message?: string } | null);
    attempts.push({
      label,
      status: res.status,
      ok: res.ok,
      message: errBody?.message?.slice(0, 200) ?? null,
    });
    // #region agent log
    agentLog("A", "video.server.ts:submitSegment", "gateway submit attempt", {
      label,
      status: res.status,
      ok: res.ok,
      refLen,
      refPrefix,
      message: errBody?.message?.slice(0, 200) ?? null,
    });
    // #endregion
    if (res.ok) {
      const job = (await res.json()) as { id: string };
      const lockDebug = {
        bodyLabel: label,
        refLen,
        refPrefix,
        gatewayJobId: job.id,
        attempts,
      };
      return { id: job.id, lockDebug };
    }
    lastMessage =
      errBody?.message ??
      (res.status === 429
        ? "视频生成排队中，请稍后再试。"
        : res.status === 402
          ? "AI 额度不足，请补充后再生成视频。"
          : "视频生成请求失败。");
    if (res.status === 429 || res.status === 402) throw new Error(lastMessage);
  }
  // #region agent log
  agentLog("A", "video.server.ts:submitSegment", "all submit bodies failed", {
    attempts,
    refLen,
  });
  // #endregion
  throw new Error(lastMessage);
}

async function loadVariantHero(targetId: string) {
  const { resolveCreativeImage } = await import("./image-storage.server");
  const supabase = await db();
  const { data } = await supabase
    .from("creative_variants")
    .select("image_url")
    .eq("id", targetId)
    .maybeSingle();
  const url = (data as { image_url?: string | null } | null)?.image_url;
  if (url?.startsWith("/api/public/creative-image/")) {
    const hit = await resolveCreativeImage(url.slice("/api/public/creative-image/".length));
    if (hit) return hit;
  }
  // 兼容未写库路径或扩展名差异：legacy 会回退到 variants/{id}.*
  return resolveCreativeImage(`legacy/${targetId}`);
}

function view(row: any): VideoJobView {
  return {
    targetId: row.target_id,
    jobId: row.job_id,
    status: row.status,
    stage: row.stage ?? undefined,
    segments: (row.segments ?? []) as VideoSegment[],
    captions: (row.captions ?? []) as CaptionLine[],
    videoUrl: row.video_url ?? undefined,
    error: row.error_message ?? undefined,
  };
}

async function fail(supabase: any, jobId: string, message: string): Promise<VideoJobView> {
  const { data } = await supabase
    .from("creative_videos")
    .update({
      status: "FAILED",
      stage: "DONE",
      error_message: message,
      completed_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .select("*")
    .maybeSingle();
  return data
    ? view(data)
    : { targetId: "", jobId, status: "FAILED", error: message };
}

/** 同一素材同时最多一个进行中的任务，避免视频费用被并发放大。 */
export async function createVideoJob(targetId: string, prompt: string): Promise<VideoJobView> {
  const supabase = await db();

  const { data: running } = await supabase
    .from("creative_videos")
    .select("*")
    .eq("target_id", targetId)
    .in("status", ["QUEUED", "RUNNING", "COMPOSING"])
    .limit(1);
  if (running && running.length > 0) return view(running[0]);

  const hero = await loadVariantHero(targetId);
  // #region agent log
  agentLog("B", "video.server.ts:createVideoJob", "hero load result", {
    targetId,
    hasHero: Boolean(hero),
    heroBytes: hero?.bytes.length ?? 0,
    heroType: hero?.contentType ?? null,
  });
  // #endregion
  if (!hero) {
    throw new Error("请先生成主视觉。短视频用主视觉锁定角色外貌与服装，无图无法保证一致性。");
  }
  const referenceDataUrl = await toReferenceDataUrl(hero.bytes, hero.contentType);

  const { data: variant } = await supabase
    .from("creative_variants")
    .select("headline, body_text, angle")
    .eq("id", targetId)
    .maybeSingle();

  const { buildVideoScript } = await import("./video-caption.server");
  const script = await buildVideoScript({
    headline: variant?.headline ?? prompt.slice(0, 40),
    bodyText: variant?.body_text ?? prompt,
    angle: variant?.angle ?? undefined,
  });

  const masterId = `vjob_${crypto.randomUUID()}`;
  const submitted = await submitSegment(script.scenes[0], referenceDataUrl);
  // #region agent log
  agentLog("A", "video.server.ts:createVideoJob", "seg1 submitted", {
    masterId,
    ...submitted.lockDebug,
  });
  // #endregion

  const segments: VideoSegment[] = [
    {
      index: 1,
      jobId: submitted.id,
      status: "RUNNING",
      lockDebug: { ...submitted.lockDebug, heroBytes: hero.bytes.length, heroType: hero.contentType },
    },
    { index: 2, status: "PENDING" },
  ];

  await supabase.from("creative_videos").insert({
    target_id: targetId,
    target_kind: "variant",
    job_id: masterId,
    status: "RUNNING",
    stage: "SEGMENT_1",
    segments,
    captions: script.captions,
    prompt: `${script.scenes[0]}\n---\n${script.scenes[1]}`,
    seconds: "16",
    size: SIZE,
    // 临时把锁定证据塞进 error_message 前缀，便于云端 SQL 一眼看到（成功后会清掉）
    error_message: `LOCKDBG seg1=${JSON.stringify(segments[0].lockDebug).slice(0, 900)}`,
  });

  return {
    targetId,
    jobId: masterId,
    status: "RUNNING",
    stage: "SEGMENT_1",
    segments,
    captions: script.captions,
  };
}

/** 拉一段网关任务的状态。 */
async function segmentStatus(jobId: string): Promise<{
  state: "running" | "completed" | "failed";
  error?: string;
}> {
  const res = await fetch(`${GATEWAY}/${jobId}`, { headers: { Authorization: `Bearer ${key()}` } });
  if (!res.ok) return { state: "running" };
  const job = (await res.json()) as { status: string; error?: { message?: string } };
  if (job.status === "failed")
    return { state: "failed", error: job.error?.message ?? "视频生成失败。" };
  if (job.status === "completed") return { state: "completed" };
  return { state: "running" };
}

/** 下载分段并落存储桶，返回可播放路径。 */
async function storeSegment(masterId: string, index: number, jobId: string) {
  const content = await fetch(`${GATEWAY}/${jobId}/content`, {
    headers: { Authorization: `Bearer ${key()}` },
  });
  if (!content.ok) return null;
  const bytes = new Uint8Array(await content.arrayBuffer());
  const { storeVideoBytes } = await import("./video-storage.server");
  return storeVideoBytes(`jobs/${masterId}/seg${index}.mp4`, bytes);
}

/**
 * 状态机轮询：第 1 段完成 → BRIDGE（等前端上传末帧）→ 第 2 段 → 合成。
 * BRIDGE 阶段不自动提交第 2 段，避免两段各自文生导致换脸/换装。
 */
export async function pollVideoJob(jobId: string): Promise<VideoJobView> {
  const supabase = await db();
  const { data: row } = await supabase
    .from("creative_videos")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  if (!row) throw new Error("视频任务不存在。");
  if (
    row.status === "COMPLETED" ||
    row.status === "FAILED" ||
    row.status === "COMPOSING" ||
    row.stage === "BRIDGE"
  ) {
    return view(row);
  }

  const segments = ((row.segments ?? []) as VideoSegment[]).slice();
  const current = row.stage === "SEGMENT_2" ? segments[1] : segments[0];
  if (!current?.jobId) return view(row);

  const state = await segmentStatus(current.jobId);
  if (state.state === "failed") return fail(supabase, jobId, state.error!);
  if (state.state === "running") return view(row);

  const url = await storeSegment(jobId, current.index, current.jobId);
  if (!url) return view(row);

  current.status = "COMPLETED";
  current.url = url;

  // 第 1 段落地后进入桥接：前端抽末帧再 continue，而不是直接文生第 2 段。
  if (current.index === 1) {
    const { data } = await supabase
      .from("creative_videos")
      .update({ segments, stage: "BRIDGE", status: "RUNNING" })
      .eq("job_id", jobId)
      .select("*")
      .maybeSingle();
    return view(data ?? { ...row, segments, stage: "BRIDGE", status: "RUNNING" });
  }

  const { data } = await supabase
    .from("creative_videos")
    .update({ segments, stage: "COMPOSING", status: "COMPOSING" })
    .eq("job_id", jobId)
    .select("*")
    .maybeSingle();
  return view(data ?? { ...row, segments, stage: "COMPOSING", status: "COMPOSING" });
}

/**
 * 用第 1 段末帧（或主视觉兜底）提交第 2 段图生视频。
 * bridgeBytes 由浏览器从 seg1 抽帧得到，保证角色与场景连续。
 */
export async function continueVideoJob(
  jobId: string,
  bridgeBytes: Uint8Array,
  contentType = "image/jpeg",
): Promise<VideoJobView> {
  const supabase = await db();
  const { data: row } = await supabase
    .from("creative_videos")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  if (!row) throw new Error("视频任务不存在。");
  if (row.stage !== "BRIDGE") {
    return view(row);
  }

  const segments = ((row.segments ?? []) as VideoSegment[]).slice();
  if (segments[1]?.jobId) return view(row);

  const scenes = String(row.prompt ?? "").split("\n---\n");
  const referenceDataUrl = await toReferenceDataUrl(bridgeBytes, contentType);

  // #region agent log
  agentLog("C", "video.server.ts:continueVideoJob", "bridge frame received", {
    jobId,
    bridgeBytes: bridgeBytes.length,
    contentType,
    refLen: referenceDataUrl.length,
    stage: row.stage,
  });
  // #endregion

  let submitted: { id: string; lockDebug: Record<string, unknown> };
  try {
    submitted = await submitSegment(scenes[1] ?? scenes[0] ?? "", referenceDataUrl);
  } catch (e) {
    return fail(supabase, jobId, e instanceof Error ? e.message : "第 2 段提交失败。");
  }

  segments[1] = {
    index: 2,
    jobId: submitted.id,
    status: "RUNNING",
    lockDebug: {
      ...submitted.lockDebug,
      bridgeBytes: bridgeBytes.length,
      bridgeType: contentType,
    },
  };
  const lockNote = `LOCKDBG seg1=${JSON.stringify(segments[0]?.lockDebug ?? {}).slice(0, 400)} | seg2=${JSON.stringify(segments[1].lockDebug).slice(0, 400)}`;
  const { data } = await supabase
    .from("creative_videos")
    .update({
      segments,
      stage: "SEGMENT_2",
      status: "RUNNING",
      error_message: lockNote,
    })
    .eq("job_id", jobId)
    .select("*")
    .maybeSingle();
  // #region agent log
  agentLog("C", "video.server.ts:continueVideoJob", "seg2 submitted after bridge", {
    jobId,
    ...submitted.lockDebug,
    bridgeBytes: bridgeBytes.length,
  });
  // #endregion
  return view(data ?? { ...row, segments, stage: "SEGMENT_2", status: "RUNNING" });
}

/** 成片回写：浏览器合成完成后调用。 */
export async function completeVideoJob(jobId: string, videoUrl: string): Promise<VideoJobView> {
  const supabase = await db();
  const { data: prev } = await supabase
    .from("creative_videos")
    .select("error_message, segments")
    .eq("job_id", jobId)
    .maybeSingle();
  // 保留 LOCKDBG 证据到完成后，便于对照成片查库（不覆盖为 null）
  const keepDbg =
    typeof prev?.error_message === "string" && prev.error_message.startsWith("LOCKDBG")
      ? prev.error_message
      : null;
  // #region agent log
  agentLog("E", "video.server.ts:completeVideoJob", "complete with lock dbg", {
    jobId,
    keepDbg: keepDbg?.slice(0, 300) ?? null,
    segDebug: (prev?.segments as VideoSegment[] | null)?.map((s) => ({
      index: s.index,
      bodyLabel: s.lockDebug?.bodyLabel ?? null,
      refLen: s.lockDebug?.refLen ?? null,
      bridgeBytes: s.lockDebug?.bridgeBytes ?? null,
    })),
  });
  // #endregion
  const { data } = await supabase
    .from("creative_videos")
    .update({
      status: "COMPLETED",
      stage: "DONE",
      video_url: videoUrl,
      completed_at: new Date().toISOString(),
      ...(keepDbg ? { error_message: keepDbg } : {}),
    })
    .eq("job_id", jobId)
    .select("*")
    .maybeSingle();
  if (!data) throw new Error("视频任务不存在。");
  return view(data);
}

/** 合成失败时把原因写回，避免任务永远挂在合成中。 */
export async function failVideoJob(jobId: string, message: string): Promise<VideoJobView> {
  const supabase = await db();
  return fail(supabase, jobId, message);
}

/** 素材库首屏用：每个素材取最新一条任务。 */
export async function listVideoJobs(): Promise<VideoJobView[]> {
  const supabase = await db();
  const { data } = await supabase
    .from("creative_videos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const seen = new Set<string>();
  const out: VideoJobView[] = [];
  for (const row of (data ?? []) as any[]) {
    if (seen.has(row.target_id)) continue;
    seen.add(row.target_id);
    out.push(view(row));
  }
  return out;
}

// 素材短视频的业务层：模型单段最长 8 秒，所以一条成片由两段 8 秒串行生成，
// 两段都出片后交给浏览器端做拼接与字幕烧录（Worker 里跑不了 ffmpeg），
// 最终成片再回写 creative_videos.video_url。

import type { CaptionLine } from "./video-caption.server";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/videos";
const MODEL = "google/veo-3.1-lite";
const SECONDS = "8";
const SIZE = "720x1280";

export type VideoStage = "SCRIPTING" | "SEGMENT_1" | "SEGMENT_2" | "COMPOSING" | "DONE";

export interface VideoSegment {
  index: 1 | 2;
  jobId?: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  url?: string;
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

function wrapPrompt(scene: string) {
  return `A vertical 9:16 social video ad segment for a licensed consumer lending brand. ${scene} Cinematic natural light, real people, trustworthy and professional tone, smooth camera motion, no on-screen text, no logos.`;
}

/** 向网关提交一段 8 秒视频，返回任务 id。 */
async function submitSegment(scene: string): Promise<string> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: wrapPrompt(scene), seconds: SECONDS, size: SIZE }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(
      body?.message ??
        (res.status === 429
          ? "视频生成排队中，请稍后再试。"
          : res.status === 402
            ? "AI 额度不足，请补充后再生成视频。"
            : "视频生成请求失败。"),
    );
  }
  const job = (await res.json()) as { id: string };
  return job.id;
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

  // 文案取自变体本身；取不到就用调用方传来的 prompt 兜底。
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
  const segJob = await submitSegment(script.scenes[0]);

  const segments: VideoSegment[] = [
    { index: 1, jobId: segJob, status: "RUNNING" },
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

/** 状态机轮询：第 1 段完成 → 提交第 2 段 → 两段齐了 → 交给前端合成。 */
export async function pollVideoJob(jobId: string): Promise<VideoJobView> {
  const supabase = await db();
  const { data: row } = await supabase
    .from("creative_videos")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  if (!row) throw new Error("视频任务不存在。");
  if (row.status === "COMPLETED" || row.status === "FAILED" || row.status === "COMPOSING") {
    return view(row);
  }

  const segments = ((row.segments ?? []) as VideoSegment[]).slice();
  const scenes = String(row.prompt ?? "").split("\n---\n");
  const current = row.stage === "SEGMENT_2" ? segments[1] : segments[0];
  if (!current?.jobId) return view(row);

  const state = await segmentStatus(current.jobId);
  if (state.state === "failed") return fail(supabase, jobId, state.error!);
  if (state.state === "running") return view(row);

  const url = await storeSegment(jobId, current.index, current.jobId);
  if (!url) return view(row); // 下载/上传失败，下一轮重试

  current.status = "COMPLETED";
  current.url = url;

  // 第 1 段落地后串行提交第 2 段（网关对并发任务有严格限制）。
  if (current.index === 1) {
    let secondJob: string;
    try {
      secondJob = await submitSegment(scenes[1] ?? scenes[0] ?? "");
    } catch (e) {
      return fail(supabase, jobId, e instanceof Error ? e.message : "第 2 段提交失败。");
    }
    segments[1] = { index: 2, jobId: secondJob, status: "RUNNING" };
    const { data } = await supabase
      .from("creative_videos")
      .update({ segments, stage: "SEGMENT_2" })
      .eq("job_id", jobId)
      .select("*")
      .maybeSingle();
    return view(data ?? { ...row, segments, stage: "SEGMENT_2" });
  }

  // 两段齐了：进入合成阶段，等前端把成片传回来。
  const { data } = await supabase
    .from("creative_videos")
    .update({ segments, stage: "COMPOSING", status: "COMPOSING" })
    .eq("job_id", jobId)
    .select("*")
    .maybeSingle();
  return view(data ?? { ...row, segments, stage: "COMPOSING", status: "COMPOSING" });
}

/** 成片回写：浏览器合成完成后调用。 */
export async function completeVideoJob(jobId: string, videoUrl: string): Promise<VideoJobView> {
  const supabase = await db();
  const { data } = await supabase
    .from("creative_videos")
    .update({
      status: "COMPLETED",
      stage: "DONE",
      video_url: videoUrl,
      completed_at: new Date().toISOString(),
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

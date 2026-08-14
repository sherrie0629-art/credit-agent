// 素材短视频的业务层：调用 Lovable AI Gateway 的 Veo 视频接口，
// 任务状态与结果落到 creative_videos 表，MP4 落到对象存储。

const GATEWAY = "https://ai.gateway.lovable.dev/v1/videos";
const MODEL = "google/veo-3.1-lite";
const SECONDS = "8";
const SIZE = "720x1280";

export interface VideoJobView {
  targetId: string;
  jobId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  videoUrl?: string;
  error?: string;
}

async function db() {
  const { getAdminClient } = await import("./read-client.server");
  return (await getAdminClient()) as unknown as {
    from: (t: string) => any;
  };
}

function key() {
  const k = process.env["LOVABLE_API_KEY"];
  if (!k) throw new Error("Missing LOVABLE_API_KEY");
  return k;
}

function buildPrompt(raw: string) {
  return `An 8-second vertical social video ad for a licensed consumer lending brand. ${raw}. Cinematic natural light, real people, trustworthy and professional tone, smooth camera motion, no on-screen text, no logos.`;
}

/** 同一素材同时最多一个进行中的任务，避免视频费用被并发放大。 */
export async function createVideoJob(targetId: string, prompt: string): Promise<VideoJobView> {
  const supabase = await db();

  const { data: running } = await supabase
    .from("creative_videos")
    .select("*")
    .eq("target_id", targetId)
    .in("status", ["QUEUED", "RUNNING"])
    .limit(1);
  if (running && running.length > 0) {
    const row = running[0];
    return { targetId, jobId: row.job_id, status: row.status };
  }

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: buildPrompt(prompt),
      seconds: SECONDS,
      size: SIZE,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      (body as { message?: string } | null)?.message ??
      (res.status === 429
        ? "视频生成排队中，请稍后再试。"
        : res.status === 402
          ? "AI 额度不足，请补充后再生成视频。"
          : "视频生成请求失败。");
    throw new Error(message);
  }

  const job = (await res.json()) as { id: string };

  await supabase.from("creative_videos").insert({
    target_id: targetId,
    target_kind: "variant",
    job_id: job.id,
    status: "RUNNING",
    prompt,
    seconds: SECONDS,
    size: SIZE,
  });

  return { targetId, jobId: job.id, status: "RUNNING" };
}

/** 轮询任务；完成时把 MP4 落库并返回可播放地址。 */
export async function pollVideoJob(jobId: string): Promise<VideoJobView> {
  const supabase = await db();
  const { data: row } = await supabase
    .from("creative_videos")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  if (!row) throw new Error("视频任务不存在。");
  if (row.status === "COMPLETED" || row.status === "FAILED") {
    return {
      targetId: row.target_id,
      jobId,
      status: row.status,
      videoUrl: row.video_url ?? undefined,
      error: row.error_message ?? undefined,
    };
  }

  const res = await fetch(`${GATEWAY}/${jobId}`, {
    headers: { Authorization: `Bearer ${key()}` },
  });
  if (!res.ok) return { targetId: row.target_id, jobId, status: "RUNNING" };

  const job = (await res.json()) as {
    status: string;
    error?: { message?: string };
  };

  if (job.status === "failed") {
    const message = job.error?.message ?? "视频生成失败。";
    await supabase
      .from("creative_videos")
      .update({ status: "FAILED", error_message: message, completed_at: new Date().toISOString() })
      .eq("job_id", jobId);
    return { targetId: row.target_id, jobId, status: "FAILED", error: message };
  }

  if (job.status !== "completed") {
    return { targetId: row.target_id, jobId, status: "RUNNING" };
  }

  const content = await fetch(`${GATEWAY}/${jobId}/content`, {
    headers: { Authorization: `Bearer ${key()}` },
  });
  if (!content.ok) return { targetId: row.target_id, jobId, status: "RUNNING" };

  const bytes = new Uint8Array(await content.arrayBuffer());
  const { storeVariantVideoBytes } = await import("./video-storage.server");
  const url = await storeVariantVideoBytes(jobId, bytes);

  if (!url) {
    const message = "视频已生成，但保存失败，请重试。";
    await supabase
      .from("creative_videos")
      .update({ status: "FAILED", error_message: message, completed_at: new Date().toISOString() })
      .eq("job_id", jobId);
    return { targetId: row.target_id, jobId, status: "FAILED", error: message };
  }

  await supabase
    .from("creative_videos")
    .update({ status: "COMPLETED", video_url: url, completed_at: new Date().toISOString() })
    .eq("job_id", jobId);

  return { targetId: row.target_id, jobId, status: "COMPLETED", videoUrl: url };
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
    out.push({
      targetId: row.target_id,
      jobId: row.job_id,
      status: row.status,
      videoUrl: row.video_url ?? undefined,
      error: row.error_message ?? undefined,
    });
  }
  return out;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ImageIcon,
  Loader2,
  Plus,
  RadarIcon,
  Rocket,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Video as VideoIcon,
} from "lucide-react";

import { CreateCreativeForm } from "@/components/creditagent/structure/CreateCreativeForm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { agentApi, useAgentStore } from "@/lib/creditagent/store";
import { computeFatigue, FATIGUE_LEVEL_LABEL, type FatigueLevel } from "@/lib/creditagent/fatigue";
import { VARIANT_STATUS_LABEL } from "@/lib/creditagent/creative-types";
import type { ComplianceInput } from "@/lib/creditagent/compliance";
import type { CreativePlacement } from "@/lib/creditagent/types";
import { creativeThumbUrl } from "@/lib/creditagent/image-url";
import { streamImage } from "@/lib/streamImage";
import { cn } from "@/lib/utils";


/** data:image/png;base64,... → 原始字节，用于二进制上传。 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const UPLOAD_MAX_WIDTH = 1200;

/**
 * 上传前在浏览器里降采样并转 WebP：2~3MB 的原图压到 150~300KB，
 * 上传耗时基本消失，服务端也不用再做同步降采样。失败时回退原始 PNG 字节。
 */
async function prepareUpload(
  dataUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, UPLOAD_MAX_WIDTH / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85),
    );
    if (!out || out.size === 0) throw new Error("encode failed");
    return { bytes: new Uint8Array(await out.arrayBuffer()), contentType: out.type || "image/webp" };
  } catch {
    return { bytes: dataUrlToBytes(dataUrl), contentType: "image/png" };
  }
}


const LEVEL_STYLE: Record<FatigueLevel, string> = {
  HEALTHY: "border-success/40 bg-success/12 text-success",
  WATCH: "border-warning/40 bg-warning/12 text-warning",
  FATIGUED: "border-destructive/40 bg-destructive/12 text-destructive",
};

export function CreativeLibraryTab({
  onReview,
  focusCreativeId,
  onClearFocus,
}: {
  onReview: (draft: ComplianceInput) => void;
  focusCreativeId?: string;
  onClearFocus?: () => void;
}) {
  const creatives = useAgentStore((s) => s.creatives);
  const metrics = useAgentStore((s) => s.creativeMetrics);
  const variants = useAgentStore((s) => s.variants);
  const experiments = useAgentStore((s) => s.experiments);
  const loaded = useAgentStore((s) => s.loaded);
  const placements = useAgentStore((s) => s.placements);

  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, { src: string; final: boolean }>>({});
  const [stage, setStage] = useState<Record<string, string>>({});

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // 从运营看板「素材下钻」跳转过来时：滚动到目标卡片并短暂高亮。
  useEffect(() => {
    if (!focusCreativeId || !loaded) return;
    if (!creatives.some((c) => c.id === focusCreativeId)) return;
    const el = document.getElementById(`creative-${focusCreativeId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(focusCreativeId);
    const t = window.setTimeout(() => setHighlightId(null), 3000);
    return () => window.clearTimeout(t);
  }, [focusCreativeId, loaded, creatives]);

  const focusedCreative = focusCreativeId
    ? creatives.find((c) => c.id === focusCreativeId)
    : undefined;

  type VideoJob = {
    targetId: string;
    jobId: string;
    status: "QUEUED" | "RUNNING" | "COMPOSING" | "COMPLETED" | "FAILED";
    stage?: "SCRIPTING" | "SEGMENT_1" | "BRIDGE" | "SEGMENT_2" | "COMPOSING" | "DONE";
    segments?: { index: number; status: string; url?: string }[];
    captions?: { start: number; end: number; text: string }[];
    videoUrl?: string;
    error?: string;
  };

  const [videos, setVideos] = useState<Record<string, VideoJob>>({});
  const [videoStage, setVideoStage] = useState<Record<string, string>>({});
  /** 浏览器拼片进度（首次生成后的自动合成），不占用「生成短视频」的模型阶段文案。 */
  const [composeStage, setComposeStage] = useState<Record<string, string>>({});
  const pollers = useRef<Record<string, number>>({});
  const composing = useRef<Record<string, boolean>>({});
  const bridging = useRef<Record<string, boolean>>({});

  /** 从第 1 段末尾抽一帧（720×1280），作第 2 段图生起始帧以锁定角色。 */
  async function extractLastFrame(videoUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = videoUrl;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("无法读取第 1 段视频"));
    });
    const target = Math.max(0, (video.duration || 0) - 0.08);
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("定位末帧失败"));
      video.currentTime = target;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布");
    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;
    const scale = Math.max(720 / vw, 1280 / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    ctx.drawImage(video, (720 - dw) / 2, (1280 - dh) / 2, dw, dh);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) throw new Error("末帧编码失败");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: "image/jpeg" };
  }




  const placementsByCreative = useMemo(() => {
    const map = new Map<string, CreativePlacement[]>();
    for (const p of placements) {
      const list = map.get(p.creativeId) ?? [];
      list.push(p);
      map.set(p.creativeId, list);
    }
    return map;
  }, [placements]);

  const fatigueByCreative = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeFatigue>>();
    for (const c of creatives) {
      map.set(c.id, computeFatigue(metrics.filter((m) => m.creativeId === c.id)));
    }
    return map;
  }, [creatives, metrics]);


  async function handleScan() {
    setScanning(true);
    try {
      const alerts = await agentApi.scanFatigue();
      toast.success(
        alerts.length
          ? `巡检完成：${alerts.length} 条素材判定为已疲劳，已写入决策流`
          : "巡检完成：暂无疲劳素材",
      );
    } catch {
      toast.error("巡检失败，请稍后重试");
    } finally {
      setScanning(false);
    }
  }

  async function handleGenerate(creativeId: string) {
    setBusyId(creativeId);
    try {
      const created = await agentApi.generateVariants(creativeId);
      toast.success(`AI 已生成 ${created} 个候选变体，并完成合规审计`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg.includes("RATE_LIMIT")
          ? "AI 网关限流，请稍后重试"
          : msg.includes("NO_CREDITS")
            ? "AI 额度已用尽，请在工作区补充额度"
            : "变体生成失败，请稍后重试",
      );
    } finally {
      setBusyId(null);
    }
  }

  /** 保存走后台：压缩 → 上传 → 静默把 store 里的 URL 换成正式地址。 */
  async function saveInBackground(targetId: string, dataUrl: string, kind: "variant" | "asset") {
    try {
      const { bytes, contentType } = await prepareUpload(dataUrl);
      const res = await fetch(
        `/api/save-creative-image?variantId=${encodeURIComponent(targetId)}&kind=${kind}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", "x-image-type": contentType },
          body: bytes as unknown as BodyInit,
        },
      );
      if (!res.ok) throw new Error("图片保存失败");
      const saved = (await res.json()) as { imageUrl: string };
      if (kind === "asset") agentApi.setAssetImageUrl(targetId, saved.imageUrl);
      else agentApi.setVariantImageUrl(targetId, saved.imageUrl);
      setFailed((s) => ({ ...s, [targetId]: false }));
    } catch {
      toast.error("主视觉已生成，但保存失败", {
        action: { label: "重试保存", onClick: () => void saveInBackground(targetId, dataUrl, kind) },
      });
    }
  }

  async function handleImage(
    targetId: string,
    prompt: string,
    kind: "variant" | "asset" = "variant",
  ) {
    setImgBusy(targetId);
    const startedAt = Date.now();
    const tick = () => {
      const s = Math.round((Date.now() - startedAt) / 1000);
      setStage((prev) => ({ ...prev, [targetId]: `AI 正在出图… ${s}s（通常 5-15 秒）` }));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    try {
      let last = "";
      await streamImage("/api/generate-creative-image", prompt, (src, final) => {
        last = src;
        setPreview((p) => ({ ...p, [targetId]: { src, final } }));
      });
      toast.success(kind === "asset" ? "原素材主视觉已生成" : "变体主视觉已生成");
      // 图已经贴到卡片上了：立即解锁，保存放后台，不再让用户等。
      void saveInBackground(targetId, last, kind);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "配图生成失败");
    } finally {
      window.clearInterval(timer);
      setImgBusy(null);
      setStage((s) => {
        const next = { ...s };
        delete next[targetId];
        return next;
      });
    }
  }

  /** 首屏拉一次已有视频任务；有进行中的就继续轮询。 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/creative-video-status");
        if (!res.ok) return;
        const data = (await res.json()) as { jobs?: VideoJob[] };
        if (!alive || !data.jobs) return;
        const map: Record<string, VideoJob> = {};
        for (const j of data.jobs) map[j.targetId] = j;
        setVideos(map);
        for (const j of data.jobs) {
          if (j.stage === "BRIDGE") void runBridge(j);
          else if (j.status === "QUEUED" || j.status === "RUNNING") pollVideo(j.targetId, j.jobId);
          if (j.status === "COMPOSING") void runCompose(j);
        }
      } catch {
        /* 视频是增值能力，拉取失败不影响素材库 */
      }
    })();
    return () => {
      alive = false;
      for (const id of Object.values(pollers.current)) window.clearInterval(id);
      pollers.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 第 1 段完成后抽末帧，提交第 2 段图生以锁定角色。 */
  async function runBridge(job: VideoJob) {
    const targetId = job.targetId;
    if (bridging.current[targetId]) return;
    bridging.current[targetId] = true;
    try {
      const seg1 = (job.segments ?? []).find((s) => s.index === 1 && s.url);
      if (!seg1?.url) throw new Error("第 1 段视频缺失，无法续拍");
      setVideoStage((p) => ({ ...p, [targetId]: "锁定角色：抽取第 1 段末帧…" }));
      const frame = await extractLastFrame(seg1.url);
      // #region agent log
      fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
        body: JSON.stringify({
          sessionId: "6fd86b",
          hypothesisId: "C",
          location: "CreativeLibraryTab.tsx:runBridge",
          message: "extracted last frame",
          data: {
            targetId,
            jobId: job.jobId,
            bytes: frame.bytes.length,
            contentType: frame.contentType,
            seg1Url: seg1.url,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setVideoStage((p) => ({ ...p, [targetId]: "提交第 2 段（角色锁定续拍）…" }));
      const res = await fetch(
        `/api/continue-creative-video?jobId=${encodeURIComponent(job.jobId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-image-type": frame.contentType,
          },
          body: frame.bytes as unknown as BodyInit,
        },
      );
      const next = (await res.json()) as VideoJob & { error?: string };
      if (!res.ok) throw new Error(next.error ?? "续拍提交失败");
      setVideos((v) => ({ ...v, [targetId]: { ...next, targetId } }));
      pollVideo(targetId, job.jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "角色锁定续拍失败";
      void fetch("/api/fail-creative-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.jobId, message }),
      }).catch(() => {});
      setVideos((v) => ({
        ...v,
        [targetId]: { ...(v[targetId] ?? job), targetId, status: "FAILED", error: message },
      }));
      toast.error(message);
      setVideoStage((p) => {
        const next = { ...p };
        delete next[targetId];
        return next;
      });
    } finally {
      bridging.current[targetId] = false;
    }
  }

  /** 两段都出片后，在浏览器里拼接 + 烧字幕，再把成片回传落库。 */
  async function runCompose(job: VideoJob) {
    const targetId = job.targetId;
    if (composing.current[targetId]) return;
    composing.current[targetId] = true;
    const urls = (job.segments ?? [])
      .filter((s) => s.url)
      .sort((a, b) => a.index - b.index)
      .map((s) => s.url!);
    try {
      if (urls.length < 2) throw new Error("分段视频缺失");
      const { composeVideo } = await import("@/lib/creditagent/video-compose");
      const bytes = await composeVideo({
        segmentUrls: urls,
        captions: job.captions ?? [],
        onStage: (s) =>
          setComposeStage((p) => ({
            ...p,
            [targetId]:
              s === "LOADING"
                ? "加载合成引擎…"
                : s === "DOWNLOADING"
                  ? "下载分段素材…"
                  : s === "RENDERING"
                    ? "渲染字幕…"
                    : "拼接与烧录字幕…（约 1-2 分钟）",
          })),
      });
      const res = await fetch(`/api/save-creative-video?jobId=${encodeURIComponent(job.jobId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes as unknown as BodyInit,
      });
      if (!res.ok) throw new Error("成片保存失败");
      const saved = (await res.json()) as VideoJob;
      setVideos((v) => ({ ...v, [targetId]: { ...saved, targetId } }));
      toast.success("16 秒带字幕短视频已生成");
    } catch (err) {
      const message = err instanceof Error ? err.message : "视频合成失败";
      // 把真实原因写回库，避免任务永远挂在「合成中」且 error_message 为空。
      void fetch("/api/fail-creative-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.jobId, message }),
      }).catch(() => {});
      setVideos((v) => ({
        ...v,
        [targetId]: { ...(v[targetId] ?? job), targetId, status: "FAILED", error: message },
      }));
      toast.error(message, {
        action: { label: "重新合成", onClick: () => void runCompose(job) },
      });
    } finally {
      composing.current[targetId] = false;
      setComposeStage((p) => {
        const next = { ...p };
        delete next[targetId];
        return next;
      });
    }
  }

  function pollVideo(targetId: string, jobId: string) {
    if (pollers.current[targetId]) return;
    const startedAt = Date.now();
    const run = async () => {
      const s = Math.round((Date.now() - startedAt) / 1000);
      try {
        const res = await fetch(`/api/creative-video-status?jobId=${encodeURIComponent(jobId)}`);
        if (!res.ok) return;
        const job = (await res.json()) as VideoJob & { error?: string };
        if (!job.status) return;
        setVideos((v) => ({ ...v, [targetId]: { ...job, targetId, jobId } }));
        setVideoStage((p) => ({
          ...p,
          [targetId]:
            job.stage === "SEGMENT_2"
              ? `生成第 2 段（角色锁定）… ${s}s`
              : job.stage === "BRIDGE"
                ? `锁定角色中… ${s}s`
                : `生成第 1 段（主视觉锁定）… ${s}s`,
        }));
        if (job.stage === "BRIDGE") {
          window.clearInterval(pollers.current[targetId]!);
          delete pollers.current[targetId];
          void runBridge({ ...job, targetId, jobId });
          return;
        }
        if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "COMPOSING") {
          window.clearInterval(pollers.current[targetId]!);
          delete pollers.current[targetId];
          if (job.status === "COMPOSING") {
            setComposeStage((p) => ({ ...p, [targetId]: "两段已就绪，开始合成…" }));
            void runCompose({ ...job, targetId, jobId });
            return;
          }
          setVideoStage((p) => {
            const next = { ...p };
            delete next[targetId];
            return next;
          });
          if (job.status === "COMPLETED") toast.success("短视频已生成");
          else toast.error(job.error ?? "视频生成失败");
        }
      } catch {
        /* 下一轮重试 */
      }
    };
    void run();
    pollers.current[targetId] = window.setInterval(run, 8000);
  }

  async function handleVideo(targetId: string, prompt: string) {
    setVideoStage((p) => ({ ...p, [targetId]: "写字幕脚本中…" }));
    try {
      const res = await fetch("/api/generate-creative-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId: targetId, prompt }),
      });
      const job = (await res.json()) as VideoJob & { error?: string };
      if (!res.ok || !job.jobId) throw new Error(job.error ?? "视频生成请求失败");
      setVideos((v) => ({ ...v, [targetId]: { ...job, targetId } }));
      toast.info("视频任务已提交：主视觉锁定角色，两段续拍约需 3-6 分钟");
      pollVideo(targetId, job.jobId);
    } catch (err) {
      setVideoStage((p) => {
        const next = { ...p };
        delete next[targetId];
        return next;
      });

      toast.error(err instanceof Error ? err.message : "视频生成失败");
    }
  }


  async function handleLaunch(creativeId: string) {
    const ids = variants
      .filter((v) => v.parentCreativeId === creativeId && selected[v.id])
      .map((v) => v.id);
    if (ids.length === 0) {
      toast.error("请先勾选要上线的变体");
      return;
    }
    setBusyId(creativeId);
    try {
      const res = await agentApi.launchExperiment(creativeId, ids);
      toast.success(
        res.mode === "FULL_AUTO"
          ? `实验已上线（Full-Auto），${ids.length} 个变体开始赛马`
          : `实验已创建（Semi-Auto），${ids.length} 个变体待人工审批`,
      );
      setSelected({});
    } catch {
      toast.error("实验上线失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <TrendingDown className="size-4 text-neon" /> 素材库与疲劳雷达
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:border-neon/40 hover:text-neon"
          >
            <Plus className="size-4" />
            新建原素材
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="inline-flex items-center gap-2 rounded-md border border-neon/50 bg-neon/10 px-4 py-2 text-sm font-medium text-neon transition-colors hover:bg-neon/20 disabled:opacity-50"
          >
            {scanning ? <Loader2 className="size-4 animate-spin" /> : <RadarIcon className="size-4" />}
            立即巡检疲劳
          </button>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建原素材</DialogTitle>
            <DialogDescription>
              填写文案与合规披露字段；创建后可在卡片上生成主视觉，再到「投放结构」绑定广告组。
            </DialogDescription>
          </DialogHeader>
          <CreateCreativeForm
            onCreated={() => {
              setCreateOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      {!loaded && <p className="text-sm text-muted-foreground">正在加载素材指标…</p>}

      {focusCreativeId && loaded && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-neon/40 bg-neon/5 px-3 py-2 text-xs">
          <span className="truncate">
            {focusedCreative
              ? `正在查看：${focusedCreative.headline}`
              : "未找到该素材（可能已下线或不在当前数据范围内）"}
          </span>
          <button
            type="button"
            className="shrink-0 text-muted-foreground underline-offset-2 hover:text-neon hover:underline"
            onClick={() => onClearFocus?.()}
          >
            显示全部
          </button>
        </div>
      )}

      {creatives.map((c) => {
        const f = fatigueByCreative.get(c.id);
        const level = (f?.level ?? c.fatigueLevel) as FatigueLevel;
        const score = f?.score ?? c.fatigueScore;
        const own = variants.filter((v) => v.parentCreativeId === c.id);
        const exp = experiments.find((e) => e.parentCreativeId === c.id);

        return (
          <article
            key={c.id}
            id={`creative-${c.id}`}
            className={cn(
              "panel space-y-4 p-4 transition-shadow",
              highlightId === c.id && "shadow-neon ring-2 ring-neon",
            )}
          >
            <div className="flex flex-wrap items-start gap-3">
              {(() => {
                const shot = preview[c.id];
                const assetPrompt = `${c.headline}. ${c.bodyText}`;
                const busy = Boolean(stage[c.id]);
                if (shot) {
                  return (
                    <div className="shrink-0">
                      <img
                        src={shot.src}
                        alt={`素材原图：${c.headline}`}
                        className={cn(
                          "h-20 w-32 rounded border border-border object-cover transition-[filter]",
                          shot.final ? "blur-0" : "blur-md",
                        )}
                      />
                      <p className="mt-1 w-32 text-center text-[10px] text-muted-foreground">
                        {stage[c.id] ?? "已生成"}
                      </p>
                    </div>
                  );
                }
                if (c.imageUrl && !failed[c.id]) {
                  return (
                    <div className="shrink-0">
                      <a href={c.imageUrl} target="_blank" rel="noreferrer" className="block">
                        <img
                          src={creativeThumbUrl(c.imageUrl, 256)}
                          alt={`素材原图：${c.headline}`}
                          loading="lazy"
                          decoding="async"
                          fetchPriority="low"
                          onError={() => setFailed((s) => ({ ...s, [c.id]: true }))}
                          className="h-20 w-32 rounded border border-border object-cover transition-colors hover:border-neon/50"
                        />
                      </a>
                      <button
                        onClick={() => handleImage(c.id, assetPrompt, "asset")}
                        disabled={busy}
                        className="mt-1 w-32 rounded border border-border px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-neon/50 hover:text-neon disabled:opacity-50"
                      >
                        重新生成主视觉
                      </button>
                    </div>
                  );
                }
                return (
                  <button
                    onClick={() => handleImage(c.id, assetPrompt, "asset")}
                    disabled={busy}
                    className="flex h-20 w-32 shrink-0 flex-col items-center justify-center gap-1 rounded border border-dashed border-border bg-muted/40 text-muted-foreground transition-colors hover:border-neon/50 hover:text-neon disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin text-neon" />
                    ) : (
                      <ImageIcon className="size-4 opacity-60" />
                    )}
                    <span className="text-[10px]">
                      {stage[c.id] ??
                        (failed[c.id] ? "加载失败，点击重生成" : "暂无原图，点击生成")}
                    </span>
                  </button>
                );
              })()}

              <div className="min-w-0 flex-1">

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded border px-2 py-0.5 text-[11px]",
                      LEVEL_STYLE[level],
                    )}
                  >
                    {FATIGUE_LEVEL_LABEL[level]} · {score}/100
                  </span>
                  <span
                    className={cn(
                      "rounded border px-2 py-0.5 text-[11px]",
                      c.complianceStatus === "PASSED"
                        ? "border-success/40 bg-success/12 text-success"
                        : c.complianceStatus === "WARNING"
                          ? "border-warning/40 bg-warning/12 text-warning"
                          : "border-destructive/40 bg-destructive/12 text-destructive",
                    )}
                  >
                    合规{" "}
                    {c.complianceStatus === "PASSED"
                      ? "已通过"
                      : c.complianceStatus === "WARNING"
                        ? "风险提示"
                        : "未通过"}
                  </span>
                  <span className="label-mono">{c.id}</span>
                </div>
                <p className="mt-2 truncate text-sm font-medium">{c.headline}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.bodyText}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {c.loanTermRange} · 最高 APR {c.maxApr || "—"}%
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="label-mono">投放于</span>
                  {placementsByCreative.get(c.id)?.length ? (
                    placementsByCreative.get(c.id)!.map((p) => (
                      <Link
                        key={p.adGroupId}
                        to="/campaigns"
                        search={{ tab: "structure" }}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] transition-colors hover:border-neon/50 hover:text-neon",
                          p.status === "ACTIVE"
                            ? "border-border bg-background/60"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        <span className="font-mono text-[10px] opacity-70">{p.channel}</span>
                        <span className="opacity-70">{p.campaignName}</span>
                        <span className="opacity-60">›</span>
                        {p.adGroupName}
                        <span className="font-mono text-[10px] text-neon">
                          {p.status === "ACTIVE" ? `${(p.share * 100).toFixed(0)}%` : "已暂停"}
                        </span>
                      </Link>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground">未绑定广告组</span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-border bg-background/40 px-2.5 py-1.5">
                  <span className="label-mono">后端表现</span>
                  {c.backend && c.backend.leads > 0 ? (
                    <>
                      <span className="font-mono text-[11px]">
                        线索{" "}
                        <span className="text-foreground">{c.backend.leads.toLocaleString()}</span>
                      </span>
                      <span className="font-mono text-[11px]">
                        授信通过率{" "}
                        <span
                          className={cn(
                            c.backend.approvalRate < 0.1 ? "text-destructive" : "text-success",
                          )}
                        >
                          {(c.backend.approvalRate * 100).toFixed(1)}%
                        </span>
                      </span>
                      <span className="font-mono text-[11px]">
                        放款{" "}
                        <span className="text-foreground">{c.backend.disbursedCount}</span> 笔
                      </span>
                      <span className="font-mono text-[11px]">
                        CPS{" "}
                        <span className={cn(c.backend.cps > 19 ? "text-destructive" : "text-success")}>
                          ${c.backend.cps.toFixed(2)}
                        </span>
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">暂无后端线索数据</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    onReview({
                      headline: c.headline,
                      bodyText: c.bodyText,
                      loanTermRange: c.loanTermRange,
                      maxApr: c.maxApr,
                      specialAdCategory: c.complianceStatus === "PASSED",
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-xs transition-colors hover:border-neon/50 hover:text-neon"
                >
                  <ShieldCheck className="size-3.5" />
                  送去合规审查
                </button>
                <button
                  onClick={() => handleGenerate(c.id)}
                  disabled={busyId === c.id}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-xs transition-colors hover:border-neon/50 hover:text-neon disabled:opacity-50"
                >
                  {busyId === c.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  AI 生成变体
                </button>
                <button
                  onClick={() => handleLaunch(c.id)}
                  disabled={busyId === c.id}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-xs transition-colors hover:border-neon/50 hover:text-neon disabled:opacity-50"
                >
                  <Rocket className="size-3.5" />
                  上线 A/B 实验
                </button>
              </div>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
              <div
                className={cn(
                  "h-full rounded transition-all",
                  level === "FATIGUED"
                    ? "bg-destructive"
                    : level === "WATCH"
                      ? "bg-warning"
                      : "bg-success",
                )}
                style={{ width: `${score}%` }}
              />
            </div>

            <ul className="grid gap-2 sm:grid-cols-2">
              {(f?.signals ?? []).map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "rounded border px-3 py-2 text-[11px]",
                    s.hit
                      ? "border-destructive/30 bg-destructive/8 text-foreground"
                      : "border-border bg-background/40 text-muted-foreground",
                  )}
                >
                  <span className="font-medium">
                    {s.hit ? "命中" : "正常"} · {s.label}（权重 {s.weight}）
                  </span>
                  <span className="mt-0.5 block">{s.detail}</span>
                </li>
              ))}
            </ul>

            {own.length > 0 && (
              <div className="space-y-3 border-t border-border pt-3">
                <p className="label-mono">ai 变体 · {own.length}</p>
                <div className="grid gap-3 lg:grid-cols-3">
                  {own.map((v) => {
                    const p = preview[v.id];
                    const img = p?.src ?? v.imageUrl;
                    const vid = videos[v.id];
                    const composingBusy = Boolean(composeStage[v.id]);
                    const generatingBusy =
                      Boolean(videoStage[v.id]) ||
                      vid?.status === "RUNNING" ||
                      vid?.status === "QUEUED" ||
                      vid?.status === "COMPOSING";
                    const videoLocked = generatingBusy || composingBusy;


                    return (
                      <div key={v.id} className="rounded border border-border bg-background/50 p-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="accent-[var(--color-neon,#22d3ee)]"
                            checked={!!selected[v.id]}
                            disabled={v.status === "BLOCKED"}
                            onChange={(e) =>
                              setSelected((s) => ({ ...s, [v.id]: e.target.checked }))
                            }
                          />
                          <span
                            className={cn(
                              "rounded border px-1.5 py-0.5 text-[10px]",
                              v.complianceStatus === "PASSED"
                                ? "border-success/40 text-success"
                                : v.complianceStatus === "WARNING"
                                  ? "border-warning/40 text-warning"
                                  : "border-destructive/40 text-destructive",
                            )}
                          >
                            合规 {v.complianceScore}/100
                          </span>
                          <span className="ml-auto label-mono">{VARIANT_STATUS_LABEL[v.status]}</span>
                        </div>

                        {(() => {
                          const hasHero = Boolean(img && !failed[v.id]);
                          const hasVideo = vid?.status === "COMPLETED" && Boolean(vid.videoUrl);
                          // 主视觉与视频封面共用同一张小图：避免 w=720 再打一次缩略图，
                          // 竖图按宽 720 就会变成约 720×1280 PNG，流式解码就会从上往下刷。
                          const thumbSrc = img ? creativeThumbUrl(img, 256) : undefined;

                          const heroImg = hasHero ? (
                            <img
                              src={p?.src && !p.final ? img : thumbSrc}
                              alt={`变体主视觉：${v.angle}`}
                              loading="lazy"
                              decoding="async"
                              fetchPriority="low"
                              onError={() => setFailed((s) => ({ ...s, [v.id]: true }))}
                              className={cn(
                                "h-full w-full object-cover transition-[filter]",
                                p && !p.final ? "blur-xl" : "blur-0",
                              )}
                            />
                          ) : null;

                          const heroPlaceholder = (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-muted/40 text-muted-foreground">
                              {stage[v.id] ? (
                                <Loader2 className="size-5 animate-spin text-neon" />
                              ) : (
                                <ImageIcon className="size-5 opacity-60" />
                              )}
                              <span className="text-[11px]">
                                {stage[v.id]
                                  ? stage[v.id]
                                  : failed[v.id]
                                    ? "图片加载失败，可重新生成"
                                    : "尚未生成主视觉"}
                              </span>
                            </div>
                          );

                          const videoEl = hasVideo ? (
                            <video
                              src={vid.videoUrl}
                              poster={thumbSrc}
                              controls
                              playsInline
                              preload="none"
                              className="h-full w-full bg-black object-cover"
                              onError={(ev) => {
                                void (async () => {
                                  const el = ev.currentTarget;
                                  if (el.dataset.blobFallback) return;
                                  try {
                                    const res = await fetch(vid.videoUrl!);
                                    if (!res.ok) return;
                                    const buf = new Uint8Array(await res.arrayBuffer());
                                    if (buf.byteLength === 0) return;
                                    el.dataset.blobFallback = "1";
                                    el.src = URL.createObjectURL(
                                      new Blob([buf], { type: "video/mp4" }),
                                    );
                                    el.load();
                                  } catch {
                                    /* 保持原生错误态 */
                                  }
                                })();
                              }}
                            />
                          ) : null;

                          // 主视觉 + 短视频同时存在：使用统一高度的标签网格式并排布局
                          if (hasHero && hasVideo) {
                            return (
                              <div className="mt-3 flex h-44 gap-3">
                                <div className="relative min-w-0 flex-[3] overflow-hidden rounded-xl border border-border/60">
                                  {heroImg}
                                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                                  <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/40 px-2 py-0.5 text-[10px] text-white/70 backdrop-blur-sm">
                                    主视觉
                                  </span>
                                </div>
                                <div className="group relative min-w-0 flex-1 overflow-hidden rounded-xl border border-border/60">
                                  {videoEl}
                                  <div className="pointer-events-none absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/50" />
                                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/20 shadow-xl backdrop-blur-md transition-transform duration-300 group-hover:scale-110">
                                      <svg
                                        className="h-4 w-4 translate-x-0.5 fill-current text-white"
                                        viewBox="0 0 24 24"
                                      >
                                        <path d="M8 5v14l11-7z" />
                                      </svg>
                                    </div>
                                  </div>
                                  <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/40 px-2 py-0.5 text-[10px] text-white/70 backdrop-blur-sm">
                                    短视频
                                  </span>
                                </div>
                              </div>
                            );
                          }

                          // 仅图片：保持原有 16:9 单媒体展示
                          if (hasHero) {
                            return (
                              <div className="mt-2">
                                <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border/60">
                                  {heroImg}
                                </div>
                              </div>
                            );
                          }

                          // 仅视频：保持原有居中竖版展示
                          if (hasVideo) {
                            return (
                              <div className="mt-2 flex justify-center overflow-hidden rounded-xl">
                                <div className="relative aspect-[9/16] max-h-[220px] w-auto overflow-hidden rounded-xl border border-border/60">
                                  {videoEl}
                                  <div className="pointer-events-none absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/50" />
                                  <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/40 px-2 py-0.5 text-[10px] text-white/70 backdrop-blur-sm">
                                    短视频
                                  </span>
                                </div>
                              </div>
                            );
                          }

                          // 两者都没有：显示占位
                          return <div className="mt-2 h-44">{heroPlaceholder}</div>;
                        })()}

                        <p className="mt-3 text-[11px] text-neon">{v.angle}</p>
                        <p className="mt-1 text-xs font-medium">{v.headline}</p>
                        <p className="mt-1 line-clamp-3 text-[11px] text-muted-foreground">
                          {v.bodyText}
                        </p>

                        <div className="mt-3 grid gap-2">
                          <button
                            onClick={() => handleImage(v.id, `${v.angle}. ${v.headline}`)}
                            disabled={imgBusy === v.id}
                            className="inline-flex w-full items-center justify-center gap-2 rounded border border-border px-2 py-1.5 text-[11px] transition-colors hover:border-neon/50 hover:text-neon disabled:opacity-50"
                          >
                            {stage[v.id] ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <ImageIcon className="size-3" />
                            )}
                            {stage[v.id] ?? (img ? "重新生成主视觉" : "生成主视觉")}
                          </button>

                          <button
                            onClick={() =>
                              handleVideo(v.id, `${v.angle}. ${v.headline}. ${v.bodyText}`)
                            }
                            disabled={
                              videoLocked ||
                              v.status === "BLOCKED" ||
                              v.complianceStatus === "FAILED" ||
                              !img
                            }
                            title={
                              v.complianceStatus === "FAILED"
                                ? "合规未通过的变体不可生成视频"
                                : !img
                                  ? "请先生成主视觉，用于锁定短视频角色外貌"
                                  : "生成 16 秒竖版短视频（主视觉锁定角色，两段 8 秒续拍拼接）"
                            }
                            className="inline-flex w-full items-center justify-center gap-2 rounded border border-border px-2 py-1.5 text-[11px] transition-colors hover:border-neon/50 hover:text-neon disabled:opacity-50"
                          >
                            {generatingBusy ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <VideoIcon className="size-3" />
                            )}
                            {videoStage[v.id] ??
                              (vid?.status === "COMPOSING"
                                ? (composeStage[v.id] ?? "合成中…")
                                : vid?.status === "COMPLETED"
                                  ? "重新生成短视频"
                                  : "生成短视频")}
                          </button>

                          <button
                            onClick={() =>
                              onReview({
                                headline: v.headline,
                                bodyText: v.bodyText,
                                loanTermRange: c.loanTermRange,
                                maxApr: c.maxApr,
                                specialAdCategory: v.complianceStatus === "PASSED",
                              })
                            }
                            className="inline-flex w-full items-center justify-center gap-2 rounded border border-border px-2 py-1.5 text-[11px] transition-colors hover:border-neon/50 hover:text-neon"
                          >
                            <ShieldCheck className="size-3" />
                            送去合规审查
                          </button>
                        </div>

                        {v.complianceLogs.length > 0 && (
                          <ul className="mt-2 space-y-0.5">
                            {v.complianceLogs.map((log, i) => (
                              <li key={i} className="text-[10px] text-muted-foreground">
                                · {log}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {exp && (
              <p className="text-[11px] text-muted-foreground">
                当前实验：{exp.id}（{exp.status === "RUNNING" ? "赛马中" : "已结束"}）
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

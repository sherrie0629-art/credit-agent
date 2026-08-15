// 浏览器端成片：把两段 8 秒 MP4 拼成约 16 秒，并把中文字幕硬烧进画面。
// 放在浏览器是因为服务端运行环境（Worker）跑不了 ffmpeg；
// 字幕用 canvas 渲染成透明 PNG 再 overlay，这样不需要额外打包中文字体。

import type { CaptionLine } from "./video-caption.server";

// 必须是 ESM 构建：ffmpeg.load() 对 core 走 dynamic import()，UMD 无法被浏览器 import。
const CORE_CDN_BASES = [
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm",
  "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm",
];
const W = 720;
const H = 1280;

export type ComposeStage = "LOADING" | "DOWNLOADING" | "RENDERING" | "ENCODING";

/** 把一条字幕画成整幅透明 PNG（底部字幕条），交给 ffmpeg overlay。 */
async function captionPng(text: string): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);

  const fontSize = 46;
  ctx.font = `700 ${fontSize}px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(text);
  const padX = 28;
  const boxW = Math.min(W - 48, metrics.width + padX * 2);
  const boxH = fontSize + 34;
  const boxY = H - 240;

  ctx.fillStyle = "rgba(0,0,0,0.62)";
  const x = (W - boxW) / 2;
  const r = 18;
  ctx.beginPath();
  ctx.moveTo(x + r, boxY);
  ctx.arcTo(x + boxW, boxY, x + boxW, boxY + boxH, r);
  ctx.arcTo(x + boxW, boxY + boxH, x, boxY + boxH, r);
  ctx.arcTo(x, boxY + boxH, x, boxY, r);
  ctx.arcTo(x, boxY, x + boxW, boxY, r);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, W / 2, boxY + boxH / 2, boxW - padX);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("字幕渲染失败");
  return new Uint8Array(await blob.arrayBuffer());
}

export interface ComposeInput {
  segmentUrls: string[];
  captions: CaptionLine[];
  onStage?: (stage: ComposeStage) => void;
}

/** 返回成片 MP4 字节。 */
export async function composeVideo({
  segmentUrls,
  captions,
  onStage,
}: ComposeInput): Promise<Uint8Array> {
  onStage?.("LOADING");
  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import("@ffmpeg/ffmpeg"),
    import("@ffmpeg/util"),
  ]);

  const ffmpeg = new FFmpeg();

  // 优先同源打包的 ESM core，其次 CDN 的 ESM 构建。
  const sources: { label: string; urls: () => Promise<{ core: string; wasm: string }> }[] = [
    {
      label: "bundled",
      urls: async () => {
        const [core, wasm] = await Promise.all([
          import("@ffmpeg/core/dist/esm/ffmpeg-core.js?url"),
          import("@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url"),
        ]);
        return { core: core.default as string, wasm: wasm.default as string };
      },
    },
    ...CORE_CDN_BASES.map((base) => ({
      label: base,
      urls: async () => ({ core: `${base}/ffmpeg-core.js`, wasm: `${base}/ffmpeg-core.wasm` }),
    })),
  ];

  let loaded = false;
  const loadErrors: string[] = [];
  for (const src of sources) {
    try {
      const { core, wasm } = await src.urls();
      await ffmpeg.load({
        coreURL: await toBlobURL(core, "text/javascript"),
        wasmURL: await toBlobURL(wasm, "application/wasm"),
      });
      loaded = true;
      break;
    } catch (e) {
      loadErrors.push(`${src.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!loaded) throw new Error(`合成引擎加载失败：${loadErrors.join(" | ")}`);

  onStage?.("DOWNLOADING");
  for (let i = 0; i < segmentUrls.length; i++) {
    let res: Response;
    try {
      res = await fetch(segmentUrls[i]!);
    } catch (e) {
      throw new Error(
        `分段视频下载失败（段${i + 1} ${e instanceof Error ? e.message : String(e)}）`,
      );
    }
    if (!res.ok) throw new Error(`分段视频下载失败（段${i + 1} HTTP ${res.status}）`);
    await ffmpeg.writeFile(`seg${i + 1}.mp4`, new Uint8Array(await res.arrayBuffer()));
  }

  onStage?.("RENDERING");
  for (let i = 0; i < captions.length; i++) {
    try {
      await ffmpeg.writeFile(`cap${i}.png`, await captionPng(captions[i]!.text));
    } catch (e) {
      throw new Error(`字幕渲染失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const inputs: string[] = [];
  for (let i = 0; i < segmentUrls.length; i++) inputs.push("-i", `seg${i + 1}.mp4`);
  for (let i = 0; i < captions.length; i++) inputs.push("-i", `cap${i}.png`);

  const build = (withAudio: boolean) => {
    const n = segmentUrls.length;
    let filter = "";
    for (let i = 0; i < n; i++) filter += `[${i}:v]scale=${W}:${H},setsar=1[v${i}];`;
    for (let i = 0; i < n; i++) filter += withAudio ? `[v${i}][${i}:a]` : `[v${i}]`;
    filter += withAudio ? `concat=n=${n}:v=1:a=1[vc][aout];` : `concat=n=${n}:v=1:a=0[vc];`;

    let prev = "vc";
    captions.forEach((c, i) => {
      const label = `o${i}`;
      filter += `[${prev}][${n + i}:v]overlay=0:0:enable='between(t,${c.start},${c.end})'[${label}];`;
      prev = label;
    });
    filter += `[${prev}]null[vout]`;

    const args = ["-y", ...inputs, "-filter_complex", filter, "-map", "[vout]"];
    if (withAudio) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k");
    args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-pix_fmt", "yuv420p");
    args.push("out.mp4");
    return args;
  };

  onStage?.("ENCODING");
  try {
    await ffmpeg.exec(build(true));
  } catch (audioErr) {
    // 某些分段可能没有音轨，退化成无声成片而不是整体失败。
    try {
      await ffmpeg.exec(build(false));
    } catch (e) {
      throw new Error(
        `视频编码失败：${e instanceof Error ? e.message : String(e)}（含音轨尝试：${
          audioErr instanceof Error ? audioErr.message : String(audioErr)
        }）`,
      );
    }
  }

  let out: Uint8Array;
  try {
    out = (await ffmpeg.readFile("out.mp4")) as Uint8Array;
  } catch (e) {
    ffmpeg.terminate();
    throw new Error(`视频编码失败：${e instanceof Error ? e.message : String(e)}`);
  }
  ffmpeg.terminate();
  if (!out || out.byteLength === 0) throw new Error("视频编码失败：输出为空");
  return out;
}

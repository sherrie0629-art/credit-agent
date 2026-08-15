// 短视频脚本层：把素材文案改写成「黄金前 3 秒」结构的英文字幕 + 两段分镜。
// 字幕时间轴必须对齐口播；分镜提示里写入 exact spoken English lines，供 Veo 生成可对口的音轨。
// LLM 不可用或不合规时回退模板，保证视频链路不被阻断。

import { BANNED_PHRASES } from "./compliance";

export interface CaptionLine {
  /** 秒（整条 16 秒成片时间轴） */
  start: number;
  end: number;
  text: string;
}

export interface VideoScript {
  captions: CaptionLine[];
  /** 两段 8 秒镜头的画面描述（含必须说出的英文台词） */
  scenes: [string, string];
  source: "AI" | "TEMPLATE";
}

export interface ScriptInput {
  headline: string;
  bodyText: string;
  angle?: string;
  maxApr?: number;
  loanTermRange?: string;
}

/** 竖版单行英文字幕上限（约 720px / 字号 40）。 */
const MAX_CHARS = 42;
const TOTAL = 16;

function clip(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS - 1)}…` : t;
}

function linesInWindow(captions: CaptionLine[], from: number, to: number) {
  return captions.filter((c) => c.start < to && c.end > from).map((c) => c.text);
}

function sceneWithSpeech(visual: string, spoken: string[], segmentLabel: "0-8s" | "8-16s") {
  const beats = spoken.map((line, i) => `${i + 1}. "${line}"`).join(" ");
  const softEnd =
    segmentLabel === "0-8s"
      ? "Finish the last spoken line by ~6.8s, then hold a calm continuous visual beat with no new dialogue for the final second so the shot can dissolve into the next."
      : "Finish the last spoken line by ~6.8s, then hold a soft CTA pose looking toward camera with no new dialogue for the final second—no abrupt cut mid-motion.";
  return `${visual} During this ${segmentLabel} shot the on-camera person speaks clear, natural American English at a calm ad pace, saying ONLY these lines in order without rushing or overlapping: ${beats} Match lip movement to the words. ${softEnd} No other language. No on-screen text, no logos.`;
}

/** 模板兜底：痛点 → 卖点 → CTA；口播与字幕同一套英文。 */
function templateScript(input: ScriptInput): VideoScript {
  const body = input.bodyText.split(/[。！？.!?;；,，]/).filter((s) => s.trim().length > 1);
  const sell1 = clip(body[0] ?? input.headline);
  const sell2 = clip(body[1] ?? input.angle ?? "Licensed lender. Clear fixed rates.");
  const captions: CaptionLine[] = [
    { start: 0, end: 3, text: clip(input.headline) },
    { start: 3, end: 7.5, text: sell1 },
    { start: 7.5, end: 11.5, text: sell2 },
    { start: 11.5, end: TOTAL, text: "Check your rate in minutes" },
  ];
  const spoken1 = linesInWindow(captions, 0, 8);
  const spoken2 = linesInWindow(captions, 8, 16);
  return {
    captions,
    scenes: [
      sceneWithSpeech(
        "0–8s: Open on the first frame in a real everyday money-stress moment tied to the headline. Soft natural window light, one adult at a kitchen or living-room table looking at bills on a phone, then a turn toward relief.",
        spoken1,
        "0-8s",
      ),
      sceneWithSpeech(
        "8–16s: Same person, same location and lighting. Mood resolves—approval on the phone, calm confidence—ending on a clear CTA beat looking toward camera.",
        spoken2,
        "8-16s",
      ),
    ],
    source: "TEMPLATE",
  };
}

const INSTRUCTIONS = `You write scripts for a 16-second vertical (9:16) US consumer-lending social ad.

Hard rules:
1. ALL caption text MUST be English only (no Chinese). Each caption ≤ ${MAX_CHARS} characters.
2. Captions are burned-in subtitles that MUST match spoken VO word-for-word. Caption timings are when those words are spoken.
3. Golden first 3 seconds: first caption is a pain point or core offer—no brand warmup.
4. Brand/product may appear in caption 1 or 2; never as on-screen logos in the video.
5. 3–11s: benefits / trust (limits, speed, licensed lender). 11–16s: clear CTA.
6. 4–6 captions covering 0–16s with no gaps longer than 0.4s between adjacent lines.
7. No banned claims: "100% approval", "no credit check", "guaranteed", "no income proof", etc.
8. scenes[0] and scenes[1] are English visual directions for two 8s shots (same person, place, lighting). Each scene MUST list the exact English lines the talent speaks in that shot, in order, matching the captions that fall in that half (0–8s vs 8–16s). Natural conversational pace so speech fills the caption windows. Finish speech by ~6.8s of each shot and hold a calm visual beat for the last second (no mid-sentence cut).

Return JSON only:
{"captions":[{"start":0,"end":3,"text":"..."}],"scenes":["...","..."]}`;

function normalize(raw: unknown, input: ScriptInput): VideoScript | null {
  const obj = raw as { captions?: CaptionLine[]; scenes?: string[] } | null;
  const caps = Array.isArray(obj?.captions) ? obj!.captions! : [];
  const scenes = Array.isArray(obj?.scenes) ? obj!.scenes! : [];
  if (caps.length < 4 || caps.length > 6 || scenes.length < 2) return null;

  const captions = caps
    .map((c) => ({
      start: Math.max(0, Math.min(TOTAL, Number(c.start) || 0)),
      end: Math.max(0, Math.min(TOTAL, Number(c.end) || 0)),
      text: clip(String(c.text ?? "")),
    }))
    .filter((c) => c.text.length > 0 && c.end > c.start)
    .sort((a, b) => a.start - b.start);

  if (captions.length < 4) return null;
  if (captions[0]!.start > 0.2 || captions[0]!.end > 3.6) return null;
  if (captions[captions.length - 1]!.end < TOTAL - 1) return null;

  // Reject leftover Chinese captions from older prompts.
  if (captions.some((c) => /[\u4e00-\u9fff]/.test(c.text))) return null;

  const merged = captions.map((c) => c.text).join(" ").toLowerCase();
  if (BANNED_PHRASES.some((p) => merged.includes(p))) return null;

  const spoken1 = linesInWindow(captions, 0, 8);
  const spoken2 = linesInWindow(captions, 8, 16);
  // Force spoken lines into scenes so Veo audio tracks the subtitle copy even if the model omitted them.
  const scene0 = sceneWithSpeech(String(scenes[0]).replace(/\s+/g, " ").trim(), spoken1, "0-8s");
  const scene1 = sceneWithSpeech(String(scenes[1]).replace(/\s+/g, " ").trim(), spoken2, "8-16s");

  return {
    captions,
    scenes: [scene0, scene1],
    source: "AI",
  };
}

/** 生成英文字幕与分镜；任何异常都回退模板。 */
export async function buildVideoScript(input: ScriptInput): Promise<VideoScript> {
  try {
    const { callLovableModel } = await import("./advisor.server");
    const { text } = await callLovableModel(INSTRUCTIONS, {
      headline: input.headline,
      bodyText: input.bodyText,
      angle: input.angle ?? "",
      maxApr: input.maxApr ?? null,
      loanTermRange: input.loanTermRange ?? null,
      language: "en-US",
      note: "Captions and spoken VO must be English and time-aligned.",
    });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return templateScript(input);
    const parsed = normalize(JSON.parse(match[0]), input);
    return parsed ?? templateScript(input);
  } catch {
    return templateScript(input);
  }
}

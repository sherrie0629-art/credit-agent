// 短视频脚本层：把素材文案改写成「黄金前 3 秒」结构的字幕 + 两段分镜提示词。
// 输出严格结构化，LLM 不可用或不合规时回退模板，保证视频链路不被阻断。

import { scanCompliance } from "./compliance";

export interface CaptionLine {
  /** 秒 */
  start: number;
  end: number;
  text: string;
}

export interface VideoScript {
  captions: CaptionLine[];
  /** 两段 8 秒镜头的画面描述 */
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

const MAX_CHARS = 18;
const TOTAL = 16;

function clip(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS - 1)}…` : t;
}

/** 模板兜底：同样遵守 痛点 → 卖点 → CTA 的时间轴。 */
function templateScript(input: ScriptInput): VideoScript {
  const body = input.bodyText.split(/[。！？.!?;；,，]/).filter((s) => s.trim().length > 1);
  const sell1 = clip(body[0] ?? input.headline);
  const sell2 = clip(body[1] ?? input.angle ?? "持牌机构，费率透明");
  return {
    captions: [
      { start: 0, end: 3, text: clip(input.headline) },
      { start: 3, end: 7.5, text: sell1 },
      { start: 7.5, end: 11.5, text: sell2 },
      { start: 11.5, end: TOTAL, text: "点击了解可借额度" },
    ],
    scenes: [
      `Opening frame lands immediately inside a real everyday money-pressure moment tied to: ${input.headline}. No logo animation, no fade-in, no slow establishing shot — the very first frame already shows the person and the problem, then turns toward relief.`,
      `Same person, same location and lighting as before. The mood resolves: the loan is approved on the phone, money arrives, the person looks relieved and confident, ending on a clear, calm final beat suitable for a call to action.`,
    ],
    source: "TEMPLATE",
  };
}

const INSTRUCTIONS = `你是消费信贷出海短视频的编导。为一条 16 秒竖版（9:16）广告写字幕与两段分镜。

硬性结构（必须遵守）：
1. 0-3 秒是黄金前 3 秒：第一条字幕必须直接抛出用户痛点或核心优惠，禁止品牌铺垫、口号、寒暄。
2. 品牌/产品在 3 秒内首次露出（写进第一条或第二条字幕的文字里；画面里不出现任何文字或 logo）。
3. 3-11 秒讲卖点与信任要素（额度、放款速度、持牌合规）。
4. 11-16 秒必须是明确的行动号召（CTA）。
5. 共 4-6 条字幕，覆盖 0 到 16 秒不留空档，每条中文不超过 18 个字。
6. 不得出现「100% 通过」「无需审核」「保证放款」这类绝对化承诺。

两段分镜（scenes）用英文写，各约 8 秒，同一主角、同一场景、同一光线，连贯衔接。
第 1 段必须第一帧就进入真实场景，不要 logo 动画、黑场、缓慢推镜。
两段都必须注明：no on-screen text, no logos。

只输出 JSON：{"captions":[{"start":0,"end":3,"text":"..."}],"scenes":["...","..."]}`;

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
  // 黄金前 3 秒：首条必须从 0 开始、3 秒内说完。
  if (captions[0]!.start > 0.2 || captions[0]!.end > 3.6) return null;
  // 结尾必须有 CTA 时段。
  if (captions[captions.length - 1]!.end < TOTAL - 1) return null;

  // 合规兜底：字幕整体过一次禁语与 APR 校验。
  const merged = captions.map((c) => c.text).join(" ");
  const verdict = scanCompliance({
    headline: captions[0]!.text,
    bodyText: merged,
    loanTermRange: input.loanTermRange ?? "—",
    maxApr: input.maxApr ?? 0,
    specialAdCategory: false,
  });
  if (verdict.status === "FAILED") return null;

  return {
    captions,
    scenes: [String(scenes[0]), String(scenes[1])],
    source: "AI",
  };
}

/** 生成字幕与分镜；任何异常都回退模板。 */
export async function buildVideoScript(input: ScriptInput): Promise<VideoScript> {
  try {
    const { callLovableModel } = await import("./advisor.server");
    const { text } = await callLovableModel(INSTRUCTIONS, {
      headline: input.headline,
      bodyText: input.bodyText,
      angle: input.angle ?? "",
      maxApr: input.maxApr ?? null,
      loanTermRange: input.loanTermRange ?? null,
    });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return templateScript(input);
    const parsed = normalize(JSON.parse(match[0]), input);
    return parsed ?? templateScript(input);
  } catch {
    return templateScript(input);
  }
}

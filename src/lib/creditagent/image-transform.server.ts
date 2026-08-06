// 纯 JS 图片处理：边缘 Worker 运行时没有原生二进制，不能用 sharp。
// 任何一步失败都退回原始字节，保证「生成主视觉」永远能落库。
import { decode as decodePng, encode as encodePng } from "fast-png";

const MAX_UPLOAD_WIDTH = 1200;

type Raster = { data: Uint8Array; width: number; height: number };

function toRgba(bytes: Uint8Array): Raster | null {
  try {
    const img = decodePng(bytes);
    if (img.depth !== 8) return null;
    const src = img.data as Uint8Array | Uint16Array;
    const px = img.width * img.height;
    const ch = img.channels ?? Math.floor(src.length / px);
    const out = new Uint8Array(px * 4);
    for (let i = 0; i < px; i++) {
      const s = i * ch;
      const d = i * 4;
      if (ch >= 3) {
        out[d] = Number(src[s]);
        out[d + 1] = Number(src[s + 1]);
        out[d + 2] = Number(src[s + 2]);
        out[d + 3] = ch === 4 ? Number(src[s + 3]) : 255;
      } else {
        const g = Number(src[s]);
        out[d] = g;
        out[d + 1] = g;
        out[d + 2] = g;
        out[d + 3] = ch === 2 ? Number(src[s + 1]) : 255;
      }
    }
    return { data: out, width: img.width, height: img.height };
  } catch {
    return null;
  }
}

/** 盒式降采样：按整块像素求平均，比最近邻平滑得多，且是纯运算。 */
function downscale(src: Raster, targetWidth: number): Raster {
  const w = Math.max(1, Math.min(src.width, Math.floor(targetWidth)));
  const h = Math.max(1, Math.round((src.height * w) / src.width));
  if (w === src.width && h === src.height) return src;

  const out = new Uint8Array(w * h * 4);
  const xRatio = src.width / w;
  const yRatio = src.height / h;

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xRatio));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let sy = y0; sy < y1 && sy < src.height; sy++) {
        for (let sx = x0; sx < x1 && sx < src.width; sx++) {
          const s = (sy * src.width + sx) * 4;
          r += src.data[s]!;
          g += src.data[s + 1]!;
          b += src.data[s + 2]!;
          a += src.data[s + 3]!;
          n++;
        }
      }
      const d = (y * w + x) * 4;
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
      out[d + 3] = Math.round(a / n);
    }
  }
  return { data: out, width: w, height: h };
}

function encode(raster: Raster): Uint8Array {
  const buf = encodePng({
    width: raster.width,
    height: raster.height,
    data: raster.data,
    channels: 4,
    depth: 8,
  });
  return new Uint8Array(buf);
}

/** 上传前把 AI 输出压到合理尺寸；失败则原样存储。 */
export async function optimizeForStorage(
  bytes: Uint8Array,
  contentType: string,
): Promise<{ bytes: Uint8Array; contentType: string; ext: string }> {
  const fallbackExt = contentType.split("/")[1]?.split("+")[0] || "png";
  try {
    const raster = toRgba(bytes);
    if (!raster) return { bytes, contentType: contentType || "image/png", ext: fallbackExt };
    if (raster.width <= MAX_UPLOAD_WIDTH) {
      return { bytes, contentType: contentType || "image/png", ext: fallbackExt };
    }
    return { bytes: encode(downscale(raster, MAX_UPLOAD_WIDTH)), contentType: "image/png", ext: "png" };
  } catch (err) {
    console.error("[creative-image] optimize failed, storing original", err);
    return { bytes, contentType: contentType || "image/png", ext: fallbackExt };
  }
}

/** 列表卡片用的即时缩略图；失败则回原图。 */
export async function resizeForDisplay(
  bytes: Uint8Array,
  width: number,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const w = Math.min(800, Math.max(32, Math.floor(width)));
  try {
    const raster = toRgba(bytes);
    if (!raster) return { bytes, contentType: "image/png" };
    return { bytes: encode(downscale(raster, w)), contentType: "image/png" };
  } catch (err) {
    console.error("[creative-image] thumbnail failed, serving original", err);
    return { bytes, contentType: "image/png" };
  }
}

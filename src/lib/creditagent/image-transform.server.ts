import sharp from "sharp";

const MAX_UPLOAD_WIDTH = 1200;
const WEBP_QUALITY = 82;
const THUMB_QUALITY = 78;

/** Resize + WebP for storage; keeps full-res AI output within a sane byte budget. */
export async function optimizeForStorage(
  bytes: Uint8Array,
  contentType: string,
): Promise<{ bytes: Uint8Array; contentType: string; ext: string }> {
  const input = sharp(Buffer.from(bytes), { animated: false });
  const pipeline = input.resize({
    width: MAX_UPLOAD_WIDTH,
    height: MAX_UPLOAD_WIDTH,
    fit: "inside",
    withoutEnlargement: true,
  });

  // PNG from the image model compresses poorly; WebP is ~10× smaller at gallery sizes.
  if (contentType.includes("png") || contentType.includes("jpeg") || contentType.includes("jpg")) {
    const out = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
    return { bytes: new Uint8Array(out), contentType: "image/webp", ext: "webp" };
  }

  const ext = contentType.split("/")[1]?.split("+")[0] ?? "webp";
  const out = await pipeline.toBuffer();
  return { bytes: new Uint8Array(out), contentType: contentType || "image/webp", ext };
}

/** On-the-fly thumbnail for grid cards; width capped to avoid abuse. */
export async function resizeForDisplay(
  bytes: Uint8Array,
  width: number,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const w = Math.min(800, Math.max(32, Math.floor(width)));
  const out = await sharp(Buffer.from(bytes), { animated: false })
    .resize({ width: w, withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
  return { bytes: new Uint8Array(out), contentType: "image/webp" };
}

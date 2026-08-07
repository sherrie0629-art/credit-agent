// 素材主视觉的存储层：图片二进制放对象存储，数据库只保留一条短 URL。
// 历史数据里 image_url 直接存了 base64 data URL（单张约 2.5MB），会把快照
// 接口撑到 5MB，因此快照里一律不下发 base64，改成指向下面这个读取路由。

const BUCKET = "creative-images";

export const IMAGE_ROUTE_PREFIX = "/api/public/creative-image";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function parseDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const contentType = match[1] ?? "image/png";
  const binary = atob(match[2] ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}

/** 直接存原始字节，不做同步压缩（降采样交给读取路由的 ?w= 分支按需做）。 */
export async function storeVariantImageBytes(
  variantId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  const ext = (contentType.split("/")[1]?.split("+")[0] || "png").toLowerCase();
  const path = `variants/${variantId}.${ext}`;
  const supabase = await admin();
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: contentType || "image/png",
    upsert: true,
  });
  if (error) {
    console.error("[creative-image] upload failed", error);
    return null;
  }
  return `${IMAGE_ROUTE_PREFIX}/${path}`;
}

/** 把 data URL 上传到对象存储，返回可直接放进 <img src> 的短路径。 */
export async function uploadVariantImage(
  variantId: string,
  dataUrl: string,
): Promise<string | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  return storeVariantImageBytes(variantId, parsed.bytes, parsed.contentType);
}


type ResolvedImage = { bytes: Uint8Array; contentType: string };

/** 读取存储对象；给公开图片路由用。 */
export async function readStoredImage(path: string): Promise<ResolvedImage | null> {
  const supabase = await admin();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    contentType: data.type || "image/png",
  };
}

function storagePathFromRouteUrl(url: string): string | null {
  if (!url.startsWith(`${IMAGE_ROUTE_PREFIX}/`)) return null;
  const path = url.slice(IMAGE_ROUTE_PREFIX.length + 1);
  if (!path || path.startsWith("legacy/")) return null;
  return path;
}

/** legacy/{id} 404 时，按常见扩展名回退到对象存储里的 variants/{id}.* */
async function readStoredImageById(id: string): Promise<ResolvedImage | null> {
  for (const ext of ["png", "webp", "jpeg", "jpg"]) {
    const hit = await readStoredImage(`variants/${id}.${ext}`);
    if (hit) return hit;
  }
  return null;
}

/**
 * 兼容历史 base64：按变体 ID 取库里的 data URL 并解码，
 * 顺带把它迁移进对象存储，之后就走存储读取。
 */
export async function readLegacyVariantImage(id: string): Promise<ResolvedImage | null> {
  const supabase = await admin();

  // 素材变体与原始素材两张表都可能存着历史 base64。
  const tables = ["creative_variants", "creative_assets"] as const;
  for (const table of tables) {
    const { data } = await supabase
      .from(table)
      .select("image_url")
      .eq("id", id)
      .maybeSingle();
    const url = (data as { image_url?: string | null } | null)?.image_url ?? null;
    if (!url) continue;

    const storagePath = storagePathFromRouteUrl(url);
    if (storagePath) {
      const stored = await readStoredImage(storagePath);
      if (stored) return stored;
      continue;
    }

    if (!url.startsWith("data:")) continue;
    const parsed = parseDataUrl(url);
    if (!parsed) continue;

    // 惰性迁移：写入存储并把库里的巨型字符串换成短路径。
    const stored = await uploadVariantImage(id, url);
    if (stored) {
      await supabase
        .from(table)
        .update({ image_url: stored } as never)
        .eq("id", id);
    }
    return parsed;
  }
  return readStoredImageById(id);
}

/** 图片路由统一入口：legacy/* 与 variants/* 都走这里。 */
export async function resolveCreativeImage(splat: string): Promise<ResolvedImage | null> {
  if (splat.startsWith("legacy/")) {
    return readLegacyVariantImage(splat.slice("legacy/".length));
  }
  return readStoredImage(splat);
}

/** 快照映射用：绝不把 base64 下发给前端。 */
export function toClientImageUrl(raw: string | null | undefined, variantId: string) {
  if (!raw) return undefined;
  if (raw.startsWith("data:")) return `${IMAGE_ROUTE_PREFIX}/legacy/${variantId}`;
  // 历史脏数据：DB 里误存了 legacy/ 代理地址，实际文件在 variants/{id}.png。
  if (raw.includes("/legacy/")) return `${IMAGE_ROUTE_PREFIX}/variants/${variantId}.png`;
  return raw;
}

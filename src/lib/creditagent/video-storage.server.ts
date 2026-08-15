// 素材短视频的存储层：MP4 二进制放对象存储，数据库只保留一条短 URL。
// 与图片一致，前端拿到的是 /api/public/creative-video/... 代理地址。

const BUCKET = "creative-videos";

export const VIDEO_ROUTE_PREFIX = "/api/public/creative-video";

async function admin() {
  const { getAdminClient } = await import("./read-client.server");
  return getAdminClient();
}

/** 按指定路径上传 MP4 字节，返回可播放的代理短路径。 */
export async function storeVideoBytes(path: string, bytes: Uint8Array): Promise<string | null> {
  const supabase = await admin();
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (error) {
    console.error("[creative-video] upload failed", error);
    return null;
  }
  return `${VIDEO_ROUTE_PREFIX}/${path}`;
}

/** 上传 MP4 字节，返回可直接放进 <video src> 的短路径。 */

export async function storeVariantVideoBytes(
  jobId: string,
  bytes: Uint8Array,
): Promise<string | null> {
  const path = `jobs/${jobId}.mp4`;
  const supabase = await admin();
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (error) {
    console.error("[creative-video] upload failed", error);
    return null;
  }
  return `${VIDEO_ROUTE_PREFIX}/${path}`;
}

/** 读取存储对象；给公开视频路由用。 */
export async function readStoredVideo(
  path: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const supabase = await admin();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    contentType: data.type || "video/mp4",
  };
}

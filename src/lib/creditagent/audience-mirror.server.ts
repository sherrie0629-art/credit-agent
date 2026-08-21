// 受众段只读镜像：圈选真相源在 Google / Meta 后台，本地只拉不推。
// 结构同步时按广告组维度写一份镜像，并回填 ad_groups.audience_segment_id。
type Db = { from: (t: string) => any };

export interface AudienceMirrorInput {
  /** 稳定 id，例如 g_aud_<adGroupId> / m_aud_<adSetId>。 */
  id: string;
  channel: "Google" | "Meta";
  name: string;
  platformResourceName?: string | null;
  targeting?: Record<string, unknown>;
  origin: "google_sync" | "meta_sync";
  syncAt: string;
}

/**
 * upsert 一条受众镜像。失败不抛出——镜像是增强信息，绝不能拖垮结构同步主流程。
 * 返回可回填到 ad_groups.audience_segment_id 的 id；失败返回 null。
 */
export async function upsertAudienceSegment(
  supabase: Db,
  input: AudienceMirrorInput,
): Promise<string | null> {
  try {
    const { error } = await supabase.from("audience_segments").upsert(
      {
        id: input.id,
        channel: input.channel,
        name: input.name.slice(0, 240),
        platform_resource_name: input.platformResourceName ?? null,
        targeting_json: input.targeting ?? {},
        origin: input.origin,
        synced_at: input.syncAt,
        platform_removed: false,
        updated_at: input.syncAt,
      },
      { onConflict: "id" },
    );
    if (error) return null;
    return input.id;
  } catch {
    return null;
  }
}

/** 平台侧已消失的受众段只打标，不删除（保留历史归因引用）。 */
export async function markAudienceSegmentsRemoved(
  supabase: Db,
  origin: "google_sync" | "meta_sync",
  seenIds: string[],
  syncAt: string,
): Promise<number> {
  try {
    let q = supabase
      .from("audience_segments")
      .update({ platform_removed: true, updated_at: syncAt })
      .eq("origin", origin)
      .eq("platform_removed", false);
    if (seenIds.length) q = q.not("id", "in", `(${seenIds.map((s) => `"${s}"`).join(",")})`);
    const { data, error } = await q.select("id");
    if (error) return 0;
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

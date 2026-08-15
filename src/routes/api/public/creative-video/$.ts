import { createFileRoute } from "@tanstack/react-router";

function parseRange(header: string | null, total: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  const start = m[1] === "" ? 0 : Number(m[1]);
  const end = m[2] === "" ? total - 1 : Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= total) {
    return null;
  }
  return { start, end: Math.min(end, total - 1) };
}

export const Route = createFileRoute("/api/public/creative-video/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const splat = params._splat ?? "";
        if (!splat || splat.includes("..")) return new Response("Bad path", { status: 400 });

        const { readStoredVideo } = await import("@/lib/creditagent/video-storage.server");
        const video = await readStoredVideo(splat);

        // #region agent log
        const magic = video
          ? Array.from(video.bytes.slice(0, 12))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")
          : null;
        const rangeHdr = request.headers.get("Range");
        fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
          body: JSON.stringify({
            sessionId: "6fd86b",
            runId: "playback-post-fix",
            hypothesisId: "D",
            location: "creative-video/$.ts:GET",
            message: video ? "public video served" : "public video not found",
            data: {
              splat,
              found: Boolean(video),
              bytes: video?.bytes.byteLength ?? 0,
              contentType: video?.contentType ?? null,
              magic,
              range: rangeHdr,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion

        if (!video) return new Response("Not found", { status: 404 });

        const bytes = video.bytes;
        const total = bytes.byteLength;
        const contentType = video.contentType || "video/mp4";
        const range = parseRange(rangeHdr, total);

        // <video> 依赖 Range/206；只回 200 整包时，部分预览 WebView 会直接 MEDIA_ERR。
        if (range) {
          const { start, end } = range;
          const slice = bytes.slice(start, end + 1);
          return new Response(slice, {
            status: 206,
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(slice.byteLength),
              "Content-Range": `bytes ${start}-${end}/${total}`,
              "Accept-Ranges": "bytes",
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        }

        return new Response(bytes, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(total),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});

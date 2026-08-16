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
        if (!video) return new Response("Not found", { status: 404 });

        const bytes = video.bytes;
        const total = bytes.byteLength;
        const contentType = video.contentType || "video/mp4";
        const range = parseRange(request.headers.get("Range"), total);

        // <video> 依赖 Range/206；部分预览 WebView 对整包 200 不友好。
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

        return new Response(new Blob([bytes], { type: contentType }), {
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

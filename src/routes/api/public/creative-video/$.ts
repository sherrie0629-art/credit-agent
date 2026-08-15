import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/creative-video/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
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
        fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
          body: JSON.stringify({
            sessionId: "6fd86b",
            runId: "playback-pre",
            hypothesisId: "B",
            location: "creative-video/$.ts:GET",
            message: video ? "public video served" : "public video not found",
            data: {
              splat,
              found: Boolean(video),
              bytes: video?.bytes.byteLength ?? 0,
              contentType: video?.contentType ?? null,
              magic,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion

        if (!video) return new Response("Not found", { status: 404 });

        return new Response(video.bytes as unknown as BodyInit, {
          headers: {
            "Content-Type": video.contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});

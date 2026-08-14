import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/creative-video/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const splat = params._splat ?? "";
        if (!splat || splat.includes("..")) return new Response("Bad path", { status: 400 });

        const { readStoredVideo } = await import("@/lib/creditagent/video-storage.server");
        const video = await readStoredVideo(splat);
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

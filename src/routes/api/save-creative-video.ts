import { createFileRoute } from "@tanstack/react-router";

// 成片回传：浏览器把拼接 + 烧字幕后的 MP4 二进制 POST 上来，服务端只做存储 + 写库。
export const Route = createFileRoute("/api/save-creative-video")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const jobId = url.searchParams.get("jobId") ?? "";
        if (!jobId || !/^[\w-]+$/.test(jobId) || jobId.length > 120) {
          return new Response("Bad jobId", { status: 400 });
        }

        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > 80_000_000) {
          return new Response("Bad payload", { status: 400 });
        }

        try {
          const { storeVideoBytes } = await import("@/lib/creditagent/video-storage.server");
          const stored = await storeVideoBytes(`jobs/${jobId}/final.mp4`, bytes);
          if (!stored) return new Response("Upload failed", { status: 500 });

          const { completeVideoJob } = await import("@/lib/creditagent/video.server");
          return Response.json(await completeVideoJob(jobId, stored));
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "成片保存失败。" },
            { status: 400 },
          );
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

// 合成失败回写：浏览器端拼接/烧字幕失败时把真实原因写入库，避免任务永远挂在合成中。
export const Route = createFileRoute("/api/fail-creative-video")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => null)) as {
            jobId?: string;
            message?: string;
          } | null;
          const jobId = body?.jobId ?? "";
          if (!jobId || !/^[\w-]+$/.test(jobId) || jobId.length > 120) {
            return new Response("Bad jobId", { status: 400 });
          }
          const message = String(body?.message ?? "视频合成失败。").slice(0, 500);

          const { failVideoJob } = await import("@/lib/creditagent/video.server");
          return Response.json(await failVideoJob(jobId, message));
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "回写失败状态出错。" },
            { status: 400 },
          );
        }
      },
    },
  },
});

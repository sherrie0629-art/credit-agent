import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/creative-video-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const jobId = url.searchParams.get("jobId");

        try {
          const { pollVideoJob, listVideoJobs } = await import("@/lib/creditagent/video.server");
          if (!jobId) return Response.json({ jobs: await listVideoJobs() });
          return Response.json(await pollVideoJob(jobId));
        } catch (e) {
          const message = e instanceof Error ? e.message : "查询视频任务失败。";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});

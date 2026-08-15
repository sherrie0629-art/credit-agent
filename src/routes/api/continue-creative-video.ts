import { createFileRoute } from "@tanstack/react-router";

/** 第 1 段完成后：前端上传末帧，服务端用该帧图生第 2 段以锁定角色。 */
export const Route = createFileRoute("/api/continue-creative-video")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const jobId = new URL(request.url).searchParams.get("jobId");
        if (!jobId) return new Response("Missing jobId", { status: 400 });
        const buf = new Uint8Array(await request.arrayBuffer());
        if (buf.byteLength < 100) return new Response("Missing bridge frame", { status: 400 });
        const contentType = request.headers.get("x-image-type") || "image/jpeg";

        try {
          const { continueVideoJob } = await import("@/lib/creditagent/video.server");
          const job = await continueVideoJob(jobId, buf, contentType);
          return Response.json(job);
        } catch (e) {
          const message = e instanceof Error ? e.message : "续拍提交失败。";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});

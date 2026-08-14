import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/generate-creative-video")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { variantId, prompt } = (await request.json()) as {
          variantId?: string;
          prompt?: string;
        };
        if (!variantId || !prompt) return new Response("Missing variantId/prompt", { status: 400 });

        try {
          const { createVideoJob } = await import("@/lib/creditagent/video.server");
          const job = await createVideoJob(variantId, prompt);
          return Response.json(job);
        } catch (e) {
          const message = e instanceof Error ? e.message : "视频生成失败。";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/generate-creative-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { prompt } = (await request.json()) as { prompt?: string };
        if (!prompt) return new Response("Missing prompt", { status: 400 });

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const instruction = `Advertising key visual for a licensed consumer lending brand. ${prompt}. Square 1:1 composition suitable for a card thumbnail. Photorealistic, warm natural light, trustworthy and professional, no text overlays, no logos.`;

        const call = (model: string) =>
          fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(
              model.includes("lite")
                ? // Nano Banana 2 Lite 走 Vertex generateContent 请求体（最快、最省）。
                  {
                    model,
                    contents: [{ role: "user", parts: [{ text: instruction }] }],
                    stream: true,
                  }
                : {
                    model,
                    messages: [{ role: "user", content: instruction }],
                    modalities: ["image", "text"],
                    stream: true,
                  },
            ),
          });

        let upstream = await call("google/gemini-3.1-flash-lite-image");
        if (!upstream.ok || !upstream.body) {
          // 轻量模型不可用时回退到原模型，保证功能不中断。
          upstream = await call("google/gemini-3.1-flash-image");
        }


        if (!upstream.ok || !upstream.body) {
          return new Response(await upstream.text(), { status: upstream.status });
        }

        return new Response(upstream.body, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});

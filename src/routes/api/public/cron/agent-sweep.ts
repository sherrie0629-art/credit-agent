// 定时巡检兜底轨：由 pg_cron 每 15 分钟调用一次。
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/agent-sweep")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey") ?? "";
        const allowed = [
          process.env["SUPABASE_ANON_KEY"],
          process.env["SUPABASE_PUBLISHABLE_KEY"],
        ].filter((k): k is string => Boolean(k));
        if (allowed.length === 0 || !allowed.includes(apiKey)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { runAgentSweep } = await import("@/lib/creditagent/sweep.server");
        const result = await runAgentSweep();
        return Response.json(result);
      },
    },
  },
});

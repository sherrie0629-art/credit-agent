// Public lead capture endpoint — external landing pages POST click IDs here.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  gclid: z.string().max(300).optional(),
  gbraid: z.string().max(300).optional(),
  wbraid: z.string().max(300).optional(),
  fbclid: z.string().max(300).optional(),
  fbp: z.string().max(300).optional(),
  fbc: z.string().max(300).optional(),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(40).optional(),
  channel: z.enum(["Google", "Meta"]).optional(),
  campaignId: z.string().max(120).optional(),
  landingUrl: z.string().max(500).optional(),
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const Route = createFileRoute("/api/public/leads")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
        }
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "Invalid payload" }, { status: 400, headers: cors });
        }
        const { captureLead } = await import("@/lib/creditagent/conversions.server");
        const result = await captureLead(parsed.data);
        return Response.json(result, { headers: cors });
      },
    },
  },
});

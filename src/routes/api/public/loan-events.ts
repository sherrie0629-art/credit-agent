// Public webhook: loan origination system pushes credit/disbursement outcomes.
// Signature: hex HMAC-SHA256 of the raw body in the `x-signature` header.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  leadId: z.string().min(1).max(200),
  eventType: z.enum(["LEAD", "CREDIT_APPROVED", "LOAN_DISBURSED", "FIRST_PAYMENT_DEFAULT"]),
  value: z.number().min(-1_000_000).max(1_000_000).optional(),
  currency: z.string().length(3).optional(),
  occurredAt: z.string().datetime().optional(),
  externalRef: z.string().max(200).optional(),
});

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/loan-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.LOAN_WEBHOOK_SECRET;
        if (!secret) {
          return Response.json(
            { error: "Webhook secret not configured" },
            { status: 503 },
          );
        }
        const raw = await request.text();
        const signature = request.headers.get("x-signature") ?? "";
        const expected = await hmacHex(secret, raw);
        if (!timingSafeEqual(signature, expected)) {
          return new Response("Invalid signature", { status: 401 });
        }
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

        const { ingestLoanEvent } = await import("@/lib/creditagent/conversions.server");
        const result = await ingestLoanEvent(parsed.data);
        return Response.json(result, { status: result.ok ? 200 : 404 });
      },
    },
  },
});

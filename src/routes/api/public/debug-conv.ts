import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/debug-conv")({
  server: { handlers: { GET: async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const r = await supabaseAdmin.from("conversion_uploads").select("*").order("created_at", { ascending: false }).limit(3);
    return Response.json({ count: r.data?.length ?? null, error: r.error });
  } } },
});

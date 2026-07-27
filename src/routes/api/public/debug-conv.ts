import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/debug-conv")({
  server: { handlers: { GET: async () => {
    const { getConversionSnapshot } = await import("@/lib/creditagent/conversions.server");
    const s = await getConversionSnapshot();
    return Response.json({ uploads: s.uploads.length, kpis: s.kpis, first: s.uploads[0] });
  } } },
});

// Cron endpoint: drains the offline conversion upload queue every 15 minutes.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/upload-conversions")({
  server: {
    handlers: {
      POST: async () => {
        const { enqueuePendingUploads, flushConversionQueue } = await import(
          "@/lib/creditagent/conversions.server"
        );
        const queued = await enqueuePendingUploads();
        const result = await flushConversionQueue();
        return Response.json({ queued, ...result });
      },
    },
  },
});

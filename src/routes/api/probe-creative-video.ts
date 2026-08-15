import { createFileRoute } from "@tanstack/react-router";

/**
 * Playback debug probe: inspect storage + optional client fetch results.
 * Persists a [playback-debug] line on creative_videos.error_message (status unchanged).
 */
export const Route = createFileRoute("/api/probe-creative-video")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          jobId?: string;
          clientStatus?: number | null;
          clientBytes?: number | null;
          clientType?: string | null;
          clientMagic?: string | null;
          clientError?: string | null;
        } | null;

        const jobId = body?.jobId ?? "";
        if (!jobId || !/^[\w-]+$/.test(jobId) || jobId.length > 120) {
          return new Response("Bad jobId", { status: 400 });
        }

        try {
          const { getAdminClient } = await import("@/lib/creditagent/read-client.server");
          const supabase = await getAdminClient();
          const { data: row } = await supabase
            .from("creative_videos")
            .select("video_url, status")
            .eq("job_id", jobId)
            .maybeSingle();

          const videoUrl = (row as { video_url?: string } | null)?.video_url ?? "";
          const prefix = "/api/public/creative-video/";
          const storagePath = videoUrl.startsWith(prefix) ? videoUrl.slice(prefix.length) : "";

          let storageBytes: number | null = null;
          let storageMagic: string | null = null;
          let storageError: string | null = null;
          let contentType: string | null = null;

          if (storagePath) {
            const { readStoredVideo } = await import("@/lib/creditagent/video-storage.server");
            const video = await readStoredVideo(storagePath);
            if (!video) {
              storageError = "readStoredVideo returned null";
            } else {
              storageBytes = video.bytes.byteLength;
              contentType = video.contentType;
              storageMagic = Array.from(video.bytes.slice(0, 12))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
            }
          } else {
            storageError = `no/invalid video_url: ${videoUrl || "(empty)"}`;
          }

          const summary = [
            "[playback-debug]",
            `job=${jobId}`,
            `url=${videoUrl || "(none)"}`,
            `path=${storagePath || "(none)"}`,
            `storageBytes=${storageBytes ?? "null"}`,
            `storageMagic=${storageMagic ?? "null"}`,
            `storageType=${contentType ?? "null"}`,
            `storageError=${storageError ?? "null"}`,
            `clientStatus=${body?.clientStatus ?? "null"}`,
            `clientBytes=${body?.clientBytes ?? "null"}`,
            `clientType=${body?.clientType ?? "null"}`,
            `clientMagic=${body?.clientMagic ?? "null"}`,
            `clientError=${body?.clientError ?? "null"}`,
          ].join(" ");

          // #region agent log
          fetch("http://127.0.0.1:7245/ingest/f05c1af9-fd58-4b84-a7ea-5cdcd71e3717", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6fd86b" },
            body: JSON.stringify({
              sessionId: "6fd86b",
              runId: "playback-pre",
              hypothesisId: "A-E",
              location: "probe-creative-video.ts",
              message: "playback probe",
              data: {
                jobId,
                videoUrl,
                storagePath,
                storageBytes,
                storageMagic,
                contentType,
                storageError,
                clientStatus: body?.clientStatus ?? null,
                clientBytes: body?.clientBytes ?? null,
                clientMagic: body?.clientMagic ?? null,
                clientError: body?.clientError ?? null,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion

          await supabase
            .from("creative_videos")
            .update({ error_message: summary.slice(0, 900) })
            .eq("job_id", jobId);

          return Response.json({
            ok: !storageError && storageBytes != null && storageBytes > 0,
            summary,
            storageBytes,
            storageMagic,
            contentType,
            storageError,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "probe failed";
          return Response.json({ ok: false, error: message }, { status: 400 });
        }
      },
    },
  },
});

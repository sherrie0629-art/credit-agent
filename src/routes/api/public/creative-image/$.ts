import { createFileRoute } from "@tanstack/react-router";

const CACHE_ORIGINAL = "public, max-age=31536000, immutable";
const CACHE_THUMB = "public, max-age=604800";

export const Route = createFileRoute("/api/public/creative-image/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const splat = params._splat ?? "";
        if (!splat || splat.includes("..")) return new Response("Bad path", { status: 400 });

        const width = Number(new URL(request.url).searchParams.get("w") || 0);

        const { resolveCreativeImage } = await import("@/lib/creditagent/image-storage.server");

        const image = await resolveCreativeImage(splat);

        if (!image) return new Response("Not found", { status: 404 });

        if (width > 0) {
          const { resizeForDisplay } = await import("@/lib/creditagent/image-transform.server");
          const thumb = await resizeForDisplay(image.bytes, width);
          return new Response(thumb.bytes as unknown as BodyInit, {
            headers: { "Content-Type": thumb.contentType, "Cache-Control": CACHE_THUMB },
          });
        }

        return new Response(image.bytes as unknown as BodyInit, {
          headers: { "Content-Type": image.contentType, "Cache-Control": CACHE_ORIGINAL },
        });
      },
    },
  },
});

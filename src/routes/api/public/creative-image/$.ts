import { createFileRoute } from "@tanstack/react-router";

const CACHE = "public, max-age=31536000, immutable";

export const Route = createFileRoute("/api/public/creative-image/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const splat = params._splat ?? "";
        if (!splat || splat.includes("..")) return new Response("Bad path", { status: 400 });

        const { readLegacyVariantImage, readStoredImage } = await import(
          "@/lib/creditagent/image-storage.server"
        );

        const image = splat.startsWith("legacy/")
          ? await readLegacyVariantImage(splat.slice("legacy/".length))
          : await readStoredImage(splat);

        if (!image) return new Response("Not found", { status: 404 });

        return new Response(image.bytes as unknown as BodyInit, {
          headers: { "Content-Type": image.contentType, "Cache-Control": CACHE },
        });
      },
    },
  },
});

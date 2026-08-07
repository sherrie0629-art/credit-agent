import { createFileRoute } from "@tanstack/react-router";

// 保存主视觉：客户端直接 POST 原始二进制（比 base64 少 ~33% 体积，
// 也避开 server function 的 RPC 序列化），服务端只做存储 + 写库。
export const Route = createFileRoute("/api/save-creative-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const variantId = url.searchParams.get("variantId") ?? "";
        if (!variantId || variantId.length > 120 || !/^[\w-]+$/.test(variantId)) {
          return new Response("Bad variantId", { status: 400 });
        }

        const contentType = request.headers.get("x-image-type") || "image/png";
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > 12_000_000) {
          return new Response("Bad payload", { status: 400 });
        }

        const { storeVariantImageBytes } = await import(
          "@/lib/creditagent/image-storage.server"
        );
        const stored = await storeVariantImageBytes(variantId, bytes, contentType);
        if (!stored) return new Response("Upload failed", { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("creative_variants")
          .update({ image_url: stored } as never)
          .eq("id", variantId);
        if (error) return new Response("Persist failed", { status: 500 });

        return Response.json({ variantId, imageUrl: stored });
      },
    },
  },
});

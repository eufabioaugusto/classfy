import { corsHeaders, json, serviceClient } from "../_shared/video/http.ts";
import { getVideoProvider } from "../_shared/video/provider.ts";

const contentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { contentId } = await req.json();
    if (typeof contentId !== "string" || !contentIdPattern.test(contentId)) {
      return json({ error: "Invalid content id" }, 400);
    }

    const client = serviceClient();
    const { data: content, error: contentError } = await client
      .from("contents")
      .select("id, title, status, media_asset_id")
      .eq("id", contentId)
      .eq("status", "approved")
      .maybeSingle();

    if (contentError || !content?.media_asset_id) {
      return json({ error: "Preview not available" }, 404);
    }

    const configuredHeroId = Deno.env.get("HOME_HERO_CONTENT_ID")?.trim();
    const isConfiguredHero = configuredHeroId
      ? content.id === configuredHeroId
      : content.title.trim().toLocaleLowerCase("pt-BR") === "aula mux 1";
    if (!isConfiguredHero) {
      return json({ error: "Preview not available" }, 404);
    }

    const { data: asset, error: assetError } = await client
      .from("media_assets")
      .select("*, media_provider_assets!media_provider_assets_media_asset_id_fkey(*)")
      .eq("id", content.media_asset_id)
      .eq("status", "ready")
      .maybeSingle();

    if (assetError || !asset) {
      return json({ error: "Preview not available" }, 404);
    }

    const bindings = asset.media_provider_assets as Array<Record<string, unknown>>;
    const binding = bindings.find((item) => item.id === asset.active_provider_binding_id);
    if (!binding || binding.status !== "ready") {
      return json({ error: "Preview is still processing" }, 409);
    }

    const provider = getVideoProvider(String(binding.provider));
    if (!provider.getPreviewSource) {
      return json({ error: "Preview is not supported by this provider" }, 409);
    }

    const source = await provider.getPreviewSource(binding, asset, {
      startSeconds: 0,
      durationSeconds: 20,
    });

    return new Response(JSON.stringify({ source }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[video-hero-preview]", error);
    return json({
      error: error instanceof Error ? error.message : "Preview resolution failed",
    }, 400);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { getVideoProvider } from "../_shared/video/provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const service = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await service.auth.getUser(authorization.slice(7));
    if (authError || !user) return json({ error: "Unauthorized" }, 401);
    const { data: isAdmin } = await service.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "Admin required" }, 403);

    const staleDraftCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleDrafts, error: staleDraftError } = await service.from("publication_drafts")
      .select("id").eq("state", "draft").lt("updated_at", staleDraftCutoff).limit(100);
    if (staleDraftError) throw staleDraftError;
    const staleDraftIds = (staleDrafts ?? []).map((draft) => draft.id);
    if (staleDraftIds.length) {
      await service.from("publication_drafts").update({ state: "discarded", updated_at: new Date().toISOString() }).in("id", staleDraftIds);
      await service.from("media_assets").update({ abandoned_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in("publication_draft_id", staleDraftIds).is("content_id", null);
    }

    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: assets, error } = await service.from("media_assets")
      .select("id, status, media_provider_assets(id, provider, provider_asset_id, status)")
      .not("abandoned_at", "is", null)
      .lt("abandoned_at", cutoff)
      .is("content_id", null)
      .limit(50);
    if (error) throw error;

    const results: Array<{ id: string; removed: boolean; reason?: string }> = [];
    for (const asset of assets ?? []) {
      try {
        const bindings = Array.isArray(asset.media_provider_assets) ? asset.media_provider_assets : [];
        for (const binding of bindings) {
          if (!binding.provider_asset_id || binding.status === "deleted") continue;
          await getVideoProvider(binding.provider).deleteAsset(binding.provider_asset_id);
          await service.from("media_provider_assets").update({ status: "deleted", updated_at: new Date().toISOString() }).eq("id", binding.id);
        }
        await service.from("media_assets").update({ status: "deleted", updated_at: new Date().toISOString() }).eq("id", asset.id);
        results.push({ id: asset.id, removed: true });
      } catch (cleanupError) {
        console.error("Could not remove abandoned media", asset.id, cleanupError);
        results.push({ id: asset.id, removed: false, reason: cleanupError instanceof Error ? cleanupError.message : "unknown_error" });
      }
    }

    const { data: files, error: filesError } = await service.from("publication_draft_files")
      .select("id, bucket, object_path")
      .eq("state", "abandoned")
      .lt("updated_at", cutoff)
      .limit(100);
    if (filesError) throw filesError;
    const fileResults: Array<{ id: string; removed: boolean; reason?: string }> = [];
    for (const file of files ?? []) {
      try {
        const { error: removeError } = await service.storage.from(file.bucket).remove([file.object_path]);
        if (removeError) throw removeError;
        await service.from("publication_draft_files").update({ state: "deleted", updated_at: new Date().toISOString() }).eq("id", file.id);
        fileResults.push({ id: file.id, removed: true });
      } catch (cleanupError) {
        console.error("Could not remove abandoned file", file.id, cleanupError);
        fileResults.push({ id: file.id, removed: false, reason: cleanupError instanceof Error ? cleanupError.message : "unknown_error" });
      }
    }
    return json({ staleDrafts: staleDraftIds.length, checked: assets?.length ?? 0, results, filesChecked: files?.length ?? 0, fileResults });
  } catch (error) {
    console.error("cleanup-abandoned-media error", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

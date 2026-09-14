import { corsHeaders, json, serviceClient } from "../_shared/video/http.ts";
import { getVideoProvider } from "../_shared/video/provider.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const client = serviceClient();
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace("Bearer ", "");
    const { data: authData } = token
      ? await client.auth.getUser(token)
      : { data: { user: null } };
    const user = authData.user;
    const { mediaAssetId } = await req.json();
    const { data: asset, error } = await client
      .from("media_assets")
      .select(
        "*, media_provider_assets!media_provider_assets_media_asset_id_fkey(*)",
      )
      .eq("id", mediaAssetId)
      .single();
    if (error || !asset) return json({ error: "Media asset not found" }, 404);

    const { data: adminRole } = user
      ? await client
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle()
      : { data: null };
    const isAdmin = Boolean(adminRole);

    const { data: content } = asset.content_id
      ? await client
          .from("contents")
          .select(
            "id, creator_id, status, visibility, required_plan, content_type",
          )
          .eq("id", asset.content_id)
          .single()
      : { data: null };

    const { data: lesson } = !content
      ? await client
          .from("course_lessons")
          .select(
            "id, is_preview, course:courses!inner(id, creator_id, status, visibility)",
          )
          .eq("media_asset_id", asset.id)
          .maybeSingle()
      : { data: null };

    if (content) {
      if (content.status !== "approved") {
        if (!user || (asset.owner_id !== user.id && !isAdmin)) {
          return json({ error: "Forbidden" }, 403);
        }
      } else if (content.content_type === "short") {
        // Shorts aprovados sao publicos por contrato de produto.
      } else if (!user) {
        return json({ error: "Unauthorized" }, 401);
      } else if (content.creator_id !== user.id) {
        if (content.visibility === "paid") {
          const { data: purchase } = await client
            .from("purchased_contents")
            .select("id")
            .eq("user_id", user.id)
            .eq("content_id", content.id)
            .in("status", ["confirmed", "legacy_confirmed"])
            .maybeSingle();
          if (!purchase) return json({ error: "Purchase required" }, 403);
        } else if (
          content.visibility === "pro" ||
          content.visibility === "premium"
        ) {
          const { data: profile } = await client
            .from("profiles")
            .select("plan")
            .eq("id", user.id)
            .single();
          const rank: Record<string, number> = { free: 0, pro: 1, premium: 2 };
          if ((rank[profile?.plan ?? "free"] ?? 0) < rank[content.visibility]) {
            return json({ error: "Subscription required" }, 403);
          }
        }
      }
    } else if (lesson) {
      const course = Array.isArray(lesson.course)
        ? lesson.course[0]
        : lesson.course;
      if (!course || course.status !== "approved") {
        if (!user || (course?.creator_id !== user.id && !isAdmin)) {
          return json({ error: "Forbidden" }, 403);
        }
      } else if (!user) {
        // A vitrine pode ser publica, mas o consumo educacional exige login.
        // Preview remove a barreira de plano/compra, nao a de identidade.
        return json({ error: "Unauthorized" }, 401);
      } else if (course.creator_id !== user.id && !lesson.is_preview) {
        if (course.visibility === "paid") {
          const { data: enrollment } = await client
            .from("course_enrollments")
            .select("id")
            .eq("user_id", user.id)
            .eq("course_id", course.id)
            .maybeSingle();
          if (!enrollment) return json({ error: "Enrollment required" }, 403);
        } else if (
          course.visibility === "pro" ||
          course.visibility === "premium"
        ) {
          const { data: profile } = await client
            .from("profiles")
            .select("plan")
            .eq("id", user.id)
            .single();
          const rank: Record<string, number> = { free: 0, pro: 1, premium: 2 };
          if ((rank[profile?.plan ?? "free"] ?? 0) < rank[course.visibility]) {
            return json({ error: "Subscription required" }, 403);
          }
        }
      }
    } else {
      if (!user || (asset.owner_id !== user.id && !isAdmin)) {
        return json({ error: "Forbidden" }, 403);
      }
    }

    const bindings = asset.media_provider_assets as Array<Record<string, any>>;
    const binding = bindings.find(
      (item) => item.id === asset.active_provider_binding_id,
    );
    if (!binding || binding.status !== "ready") {
      return json(
        { error: "Video is still processing", status: asset.status },
        409,
      );
    }
    const source = await getVideoProvider(binding.provider).getPlaybackSource(
      binding,
      asset,
    );
    return json({ mediaAssetId: asset.id, status: asset.status, source });
  } catch (error) {
    console.error("[video-playback]", error);
    return json(
      {
        error:
          error instanceof Error ? error.message : "Playback resolution failed",
      },
      400,
    );
  }
});

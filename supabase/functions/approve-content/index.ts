import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  APP_URL,
  ctaButton,
  emailCard,
  rewardBox,
  sendEmail,
} from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const service = createClient(supabaseUrl, serviceKey);
    const token = authorization.slice(7);
    const { data: { user }, error: authError } = await service.auth.getUser(
      token,
    );
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { contentId, itemType = "content", reason } = await req.json();
    if (
      !contentId || !["content", "course"].includes(itemType) || !reason?.trim()
    ) {
      return json(
        { error: "Content ID, valid item type and reason are required" },
        400,
      );
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: result, error } = await userClient.rpc("approve_content_v1", {
      p_item_id: contentId,
      p_item_type: itemType,
      p_reason: reason.trim(),
    });
    if (error) throw error;

    const approval = Array.isArray(result) ? result[0] : result;
    const table = itemType === "course" ? "courses" : "contents";
    const { data: content } = await service.from(table)
      .select("creator_id, title, content_type")
      .eq("id", contentId)
      .single();

    if (content?.creator_id) {
      try {
        const [{ data: creatorAuth }, { data: profile }] = await Promise.all([
          service.auth.admin.getUserById(content.creator_id),
          service.from("profiles").select("display_name").eq(
            "id",
            content.creator_id,
          ).single(),
        ]);
        if (creatorAuth?.user?.email) {
          const points = Number(approval?.content_points || 0) +
            Number(approval?.first_upload_points || 0);
          const itemLabel = itemType === "course" ? "curso" : "conteúdo";
          const name = profile?.display_name ||
            creatorAuth.user.email.split("@")[0];
          const subject = `Seu ${itemLabel} foi aprovado! — Classfy`;
          const html = emailCard(
            subject,
            `"${content.title}" está publicado`,
            `
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">Conteúdo aprovado! ✅</h1>
            <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
              Olá, <strong>${name}</strong>! Seu ${itemLabel} <strong>"${content.title}"</strong> foi aprovado e já está disponível na plataforma.
            </p>
            ${points > 0 ? rewardBox(points, 0) : ""}
            ${ctaButton("Ver meu conteúdo", `${APP_URL}/studio/contents`)}
          `,
          );
          await sendEmail(
            Deno.env.get("RESEND_API_KEY")!,
            creatorAuth.user.email,
            subject,
            html,
          );
        }
      } catch (emailError) {
        console.error("Approval email failed", emailError);
      }

      if (
        itemType === "content" &&
        ["aula", "podcast"].includes(content.content_type)
      ) {
        service.functions.invoke("transcribe-content", { body: { contentId } })
          .then(({ error }) =>
            error && console.error("Auto-transcription failed", error)
          );
      }
    }

    return json({ success: true, ...approval });
  } catch (error) {
    console.error("approve-content V1 error", error);
    return json({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

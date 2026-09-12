import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  APP_URL,
  ctaButton,
  emailCard,
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
    const { data: { user }, error: authError } = await service.auth.getUser(
      authorization.slice(7),
    );
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { contentId, submissionId, itemType = "content", reason } = await req.json();
    if (
      (!contentId && !submissionId) || !["content", "course"].includes(itemType) || !reason?.trim()
    ) {
      return json({
        error: "Content ID, valid item type and reason are required",
      }, 400);
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data, error } = submissionId
      ? await userClient.rpc("reject_publication_submission_v1", {
        p_submission_id: submissionId,
        p_reason: reason.trim(),
      })
      : await userClient.rpc("reject_content_v1", {
        p_item_id: contentId,
        p_item_type: itemType,
        p_reason: reason.trim(),
      });
    if (error) throw error;

    const rejection = Array.isArray(data) ? data[0] : data;
    const resolvedContentId = contentId || rejection?.sourceId;
    const resolvedItemType = rejection?.sourceType || itemType;
    let creatorId = rejection?.creator_id;
    let itemTitle = rejection?.title;
    if (submissionId && resolvedContentId) {
      const table = resolvedItemType === "course" ? "courses" : "contents";
      const { data: source } = await service.from(table).select("creator_id, title").eq("id", resolvedContentId).single();
      creatorId = source?.creator_id;
      itemTitle = source?.title;
    }
    try {
      const { data: creatorAuth } = await service.auth.admin.getUserById(
        creatorId,
      );
      if (creatorAuth?.user?.email) {
        const subject = "Conteúdo não aprovado — Classfy";
        const html = emailCard(
          subject,
          `"${itemTitle}" precisa de ajustes`,
          `
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">Conteúdo não aprovado</h1>
          <p style="margin:0 0 12px;font-size:15px;color:#52525b;line-height:1.6;">Seu conteúdo <strong>"${itemTitle}"</strong> precisa de ajustes.</p>
          <p style="margin:0 0 12px;font-size:14px;color:#52525b;line-height:1.6;"><strong>Motivo:</strong> ${reason.trim()}</p>
          ${ctaButton("Ir para o Studio", `${APP_URL}/studio/contents`)}
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
      console.error("Rejection email failed", emailError);
    }
    return json({ success: true, ...rejection });
  } catch (error) {
    console.error("reject-content V1 error", error);
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

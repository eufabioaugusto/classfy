import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailCard, ctaButton, rewardBox, redBadge, sendEmail, APP_URL } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function getUserEmail(supabase: ReturnType<typeof createClient>, userId: string): Promise<{ email: string; name: string } | null> {
  const { data } = await supabase.auth.admin.getUserById(userId);
  if (!data?.user?.email) return null;
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", userId).single();
  return {
    email: data.user.email,
    name: profile?.display_name || data.user.email.split("@")[0],
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { type, user_id, data } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const user = await getUserEmail(supabase, user_id);
    if (!user) {
      return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let subject = "";
    let html = "";

    switch (type) {
      case "creator_approved": {
        subject = "Parabéns! Você agora é Creator na Classfy";
        html = emailCard(subject, "Sua solicitação de creator foi aprovada!", `
          <p style="margin:0 0 12px;">${redBadge("Creator aprovado")}</p>
          <h1 style="margin:8px 0;font-size:22px;font-weight:700;color:#09090b;">Bem-vindo ao time de Creators! 🎉</h1>
          <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
            Olá, <strong>${user.name}</strong>! Sua solicitação para o canal <strong>"${data.channel_name}"</strong> foi aprovada.
            Agora você pode publicar conteúdos e começar a monetizar seu conhecimento.
          </p>
          ${ctaButton("Ir para o Studio", `${APP_URL}/studio`)}
          <p style="margin:0;font-size:13px;color:#71717a;line-height:1.6;">
            No Studio você pode enviar vídeos, podcasts, cursos e muito mais.<br/>
            Seus conteúdos passam por revisão antes de serem publicados.
          </p>
        `);
        break;
      }

      case "creator_rejected": {
        subject = "Atualização sobre sua solicitação de Creator — Classfy";
        html = emailCard(subject, "Sua solicitação de creator foi analisada", `
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">Solicitação não aprovada</h1>
          <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
            Olá, <strong>${user.name}</strong>. Analisamos sua solicitação para o canal <strong>"${data.channel_name}"</strong> e, por enquanto, não foi possível aprovar.
          </p>
          ${data.reason ? `<div style="margin:20px 0;padding:16px;background:#f4f4f5;border-radius:8px;border-left:3px solid #dc2626;"><p style="margin:0;font-size:14px;color:#52525b;line-height:1.6;"><strong>Motivo:</strong> ${data.reason}</p></div>` : ""}
          <p style="margin:0 0 16px;font-size:14px;color:#52525b;line-height:1.6;">
            Você pode enviar uma nova solicitação a qualquer momento após ajustar as informações necessárias.
          </p>
          ${ctaButton("Enviar nova solicitação", `${APP_URL}/conta`)}
        `);
        break;
      }

      case "withdrawal_approved": {
        subject = "Saque aprovado — Classfy";
        html = emailCard(subject, `Seu saque de R$ ${data.amount.toFixed(2)} foi processado`, `
          <p style="margin:0 0 12px;">${redBadge("Pagamento processado")}</p>
          <h1 style="margin:8px 0;font-size:22px;font-weight:700;color:#09090b;">Saque aprovado! 💸</h1>
          <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
            Olá, <strong>${user.name}</strong>! Seu saque foi aprovado e processado.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
            <tr><td style="padding:16px;">
              <p style="margin:0 0 4px;font-size:12px;color:#16a34a;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Valor transferido</p>
              <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;">R$ ${data.amount.toFixed(2)}</p>
              ${data.pix_key ? `<p style="margin:0;font-size:13px;color:#52525b;">Chave PIX: <strong>${data.pix_key}</strong></p>` : ""}
            </td></tr>
          </table>
          ${data.admin_notes ? `<p style="margin:0 0 16px;font-size:13px;color:#71717a;">Nota: ${data.admin_notes}</p>` : ""}
          <p style="margin:0;font-size:13px;color:#71717a;">O valor pode levar até 1 dia útil para aparecer na sua conta.</p>
          ${ctaButton("Ver minha carteira", `${APP_URL}/carteira`)}
        `);
        break;
      }

      case "withdrawal_rejected": {
        subject = "Saque não processado — Classfy";
        html = emailCard(subject, `Seu saque de R$ ${data.amount.toFixed(2)} não foi processado`, `
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">Saque não processado</h1>
          <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
            Olá, <strong>${user.name}</strong>. Seu saque de <strong>R$ ${data.amount.toFixed(2)}</strong> não pôde ser processado no momento.
          </p>
          ${data.admin_notes ? `<div style="margin:20px 0;padding:16px;background:#f4f4f5;border-radius:8px;border-left:3px solid #dc2626;"><p style="margin:0;font-size:14px;color:#52525b;line-height:1.6;"><strong>Motivo:</strong> ${data.admin_notes}</p></div>` : ""}
          <p style="margin:0 0 16px;font-size:14px;color:#52525b;line-height:1.6;">
            O valor foi mantido na sua carteira. Você pode solicitar um novo saque a qualquer momento.
          </p>
          ${ctaButton("Ver minha carteira", `${APP_URL}/carteira`)}
        `);
        break;
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown email type" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await sendEmail(RESEND_API_KEY, user.email, subject, html);
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

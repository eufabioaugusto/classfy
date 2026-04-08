import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = "Classfy <noreply@classfy.com.br>";
const APP_URL = "https://app.classfy.com.br";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Generate recovery link via admin API (bypasses rate limit)
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${APP_URL}/reset-password` },
    });

    if (error) {
      // Don't expose whether the email exists — return success anyway
      console.error("generateLink error:", error.message);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recoveryUrl = data.properties?.action_link;
    if (!recoveryUrl) {
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send via Resend
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <a href="${APP_URL}" style="text-decoration:none;">
            <span style="font-size:26px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">Classfy</span><span style="font-size:26px;font-weight:700;color:#dc2626;">.</span>
          </a>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td height="4" bgcolor="#dc2626" style="background-color:#dc2626;font-size:0;line-height:0;">&nbsp;</td></tr></table>
          <div style="padding:40px 40px 32px;">
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">Redefinir senha</h1>
          <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
            Recebemos uma solicitação para redefinir a senha da conta associada a <strong>${email}</strong>.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
            <tr><td align="center">
              <a href="${recoveryUrl}" style="display:inline-block;background-color:#09090b;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;">
                Criar nova senha
              </a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#71717a;">
            Este link expira em <strong>1 hora</strong>. Se você não solicitou isso, ignore este email — sua senha permanece a mesma.
          </p>
          <p style="margin:16px 0 0;font-size:12px;color:#71717a;word-break:break-all;">
            Ou copie e cole no navegador:<br/>
            <a href="${recoveryUrl}" style="color:#2563eb;">${recoveryUrl}</a>
          </p>
          </div>
        </td></tr>
        <tr><td align="center" style="padding-top:24px;">
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.6;">
            Este email foi enviado pela <strong>Classfy</strong>.<br/>
            <a href="${APP_URL}" style="color:#71717a;">app.classfy.com.br</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: "Redefinir senha — Classfy",
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", err);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

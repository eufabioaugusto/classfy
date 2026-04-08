import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const HOOK_SECRET = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
const FROM_EMAIL = "Classfy <noreply@classfy.com.br>";
const APP_URL = "https://app.classfy.com.br";

async function verifySignature(secret: string, body: string, signature: string): Promise<boolean> {
  try {
    // secret format: "v1,whsec_<base64>"
    const base64Secret = secret.replace(/^v1,whsec_/, "");
    const keyBytes = Uint8Array.from(atob(base64Secret), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    // signature format: "v1=<hex>"
    const hexSig = signature.replace(/^v1=/, "");
    const sigBytes = new Uint8Array(hexSig.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const bodyBytes = new TextEncoder().encode(body);
    return await crypto.subtle.verify("HMAC", key, sigBytes, bodyBytes);
  } catch {
    return false;
  }
}

interface HookPayload {
  user: {
    email: string;
    user_metadata?: { display_name?: string; full_name?: string };
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: "signup" | "recovery" | "email_change" | "magiclink" | "reauthentication";
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

function buildVerifyUrl(tokenHash: string, type: string, redirectTo: string): string {
  const params = new URLSearchParams({ token: tokenHash, type, redirect_to: redirectTo });
  return `${SUPABASE_URL}/auth/v1/verify?${params}`;
}

function template(subject: string, preheader: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <span style="display:none;font-size:1px;color:#f4f4f5;max-height:0;overflow:hidden;">${preheader}</span>
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <a href="${APP_URL}" style="text-decoration:none;">
                <span style="font-size:26px;font-weight:700;color:#09090b;letter-spacing:-0.5px;">Classfy</span>
              </a>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:12px;padding:40px 40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#71717a;line-height:1.6;">
                Este email foi enviado pela <strong>Classfy</strong>.<br/>
                Se você não solicitou este email, ignore-o com segurança.<br/>
                <a href="${APP_URL}" style="color:#71717a;">app.classfy.com.br</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(text: string, url: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
    <tr>
      <td align="center">
        <a href="${url}" style="display:inline-block;background-color:#09090b;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.2px;">
          ${text}
        </a>
      </td>
    </tr>
  </table>`;
}

function fallbackLink(url: string): string {
  return `<p style="margin:16px 0 0;font-size:12px;color:#71717a;word-break:break-all;">
    Ou copie e cole este link no seu navegador:<br/>
    <a href="${url}" style="color:#2563eb;">${url}</a>
  </p>`;
}

function getEmailContent(payload: HookPayload): { subject: string; html: string } | null {
  const { email_action_type, token_hash, redirect_to } = payload.email_data;
  const userEmail = payload.user.email;
  const name = payload.user.user_metadata?.display_name
    || payload.user.user_metadata?.full_name
    || userEmail.split("@")[0];

  switch (email_action_type) {
    case "signup": {
      const url = buildVerifyUrl(token_hash, "signup", redirect_to || APP_URL);
      return {
        subject: "Confirme seu email — Classfy",
        html: template(
          "Confirme seu email",
          "Clique no botão para ativar sua conta na Classfy",
          `<h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">Bem-vindo à Classfy, ${name}!</h1>
           <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
             Só mais um passo. Confirme seu email para ativar sua conta e começar a aprender.
           </p>
           ${ctaButton("Confirmar meu email", url)}
           <p style="margin:0;font-size:13px;color:#71717a;">Este link expira em <strong>24 horas</strong>.</p>
           ${fallbackLink(url)}`
        ),
      };
    }

    case "recovery": {
      const url = buildVerifyUrl(token_hash, "recovery", redirect_to || `${APP_URL}/reset-password`);
      return {
        subject: "Redefinir senha — Classfy",
        html: template(
          "Redefinir senha",
          "Você solicitou a redefinição da sua senha na Classfy",
          `<h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">Redefinir senha</h1>
           <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
             Recebemos uma solicitação para redefinir a senha da conta associada a <strong>${userEmail}</strong>.
           </p>
           ${ctaButton("Criar nova senha", url)}
           <p style="margin:0;font-size:13px;color:#71717a;">Este link expira em <strong>1 hora</strong>. Se você não solicitou isso, ignore este email — sua senha permanece a mesma.</p>
           ${fallbackLink(url)}`
        ),
      };
    }

    case "email_change": {
      const url = buildVerifyUrl(token_hash, "email_change", redirect_to || APP_URL);
      return {
        subject: "Confirme a alteração de email — Classfy",
        html: template(
          "Alteração de email",
          "Confirme o novo endereço de email da sua conta Classfy",
          `<h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">Confirme o novo email</h1>
           <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
             Você solicitou a alteração do email da sua conta para <strong>${userEmail}</strong>. Clique abaixo para confirmar.
           </p>
           ${ctaButton("Confirmar novo email", url)}
           <p style="margin:0;font-size:13px;color:#71717a;">Se você não fez essa solicitação, ignore este email.</p>
           ${fallbackLink(url)}`
        ),
      };
    }

    case "magiclink": {
      const url = buildVerifyUrl(token_hash, "magiclink", redirect_to || APP_URL);
      return {
        subject: "Seu link de acesso — Classfy",
        html: template(
          "Link de acesso",
          "Use este link para entrar na sua conta Classfy",
          `<h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">Entrar na Classfy</h1>
           <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
             Clique no botão abaixo para entrar na sua conta. Este link é de uso único.
           </p>
           ${ctaButton("Entrar na minha conta", url)}
           <p style="margin:0;font-size:13px;color:#71717a;">Este link expira em <strong>1 hora</strong>.</p>
           ${fallbackLink(url)}`
        ),
      };
    }

    default:
      return null;
  }
}

serve(async (req) => {
  try {
    const body = await req.text();

    if (HOOK_SECRET) {
      const signature = req.headers.get("x-supabase-signature") ?? "";
      const valid = await verifySignature(HOOK_SECRET, body, signature);
      if (!valid) {
        return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
      }
    }

    const payload: HookPayload = JSON.parse(body);
    const content = getEmailContent(payload);

    if (!content) {
      return new Response(JSON.stringify({}), { status: 200 });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [payload.user.email],
        subject: content.subject,
        html: content.html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ error: err }), { status: 500 });
    }

    return new Response(JSON.stringify({}), { status: 200 });
  } catch (err) {
    console.error("Hook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

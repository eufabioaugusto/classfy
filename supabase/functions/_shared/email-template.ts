export const APP_URL = "https://app.classfy.com.br";
export const FROM_EMAIL = "Classfy <noreply@classfy.com.br>";

export function emailCard(subject: string, preheader: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <span style="display:none;font-size:1px;color:#f4f4f5;max-height:0;overflow:hidden;">${preheader}</span>
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
          <div style="padding:40px 40px 32px;">${body}</div>
        </td></tr>
        <tr><td align="center" style="padding-top:24px;">
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.6;">
            Este email foi enviado pela <strong>Classfy</strong>.<br/>
            Se não reconhece esta ação, ignore este email.<br/>
            <a href="${APP_URL}" style="color:#71717a;">app.classfy.com.br</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function ctaButton(text: string, url: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
    <tr><td align="center">
      <a href="${url}" style="display:inline-block;background-color:#09090b;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.2px;">${text}</a>
    </td></tr>
  </table>`;
}

export function redBadge(text: string): string {
  return `<span style="display:inline-block;background-color:#dc2626;color:#ffffff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:0.5px;text-transform:uppercase;">${text}</span>`;
}

export function rewardBox(points: number, value: number): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;">
    <tr>
      <td align="center" style="padding:16px;">
        <p style="margin:0 0 4px;font-size:12px;color:#dc2626;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Recompensa recebida</p>
        <p style="margin:0;font-size:20px;font-weight:700;color:#09090b;">${points} pontos <span style="color:#71717a;font-weight:400;font-size:15px;">+ R$ ${value.toFixed(2)}</span></p>
      </td>
    </tr>
  </table>`;
}

export async function sendEmail(apiKey: string, to: string, subject: string, html: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
  }
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { APP_URL } from "../_shared/email-template.ts";
import { recordEdgeLog } from "../_shared/app-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Não autorizado." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Serviço indisponível." }, 503);

  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: { user: admin }, error: authError } = await service.auth.getUser(authorization.slice(7));
    if (authError || !admin) return json({ error: "Sessão inválida." }, 401);

    const { data: adminRole, error: roleError } = await service.from("user_roles")
      .select("role").eq("user_id", admin.id).eq("role", "admin").maybeSingle();
    if (roleError || !adminRole) return json({ error: "Acesso restrito a administradores." }, 403);

    const body = await req.json();
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (displayName.length < 2 || displayName.length > 120 ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Informe nome e email válidos." }, 400);
    }

    const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
      data: { display_name: displayName },
      redirectTo: `${APP_URL}/convite`,
    });
    if (error) {
      const duplicate = /already|registered|exists/i.test(error.message);
      return json({
        error: duplicate
          ? "Este email já possui uma conta. Use a busca para encontrá-la."
          : "Não foi possível enviar o convite. Tente novamente.",
      }, duplicate ? 409 : 502);
    }

    await recordEdgeLog({
      source: "admin-invite-user",
      event: "user_invited",
      context: { adminId: admin.id, invitedUserId: data.user?.id },
    });
    return json({ success: true, userId: data.user?.id });
  } catch (error) {
    console.error("admin-invite-user failed", error);
    return json({ error: "Não foi possível criar o usuário." }, 500);
  }
});

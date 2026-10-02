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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return json({ error: "Serviço indisponível." }, 503);

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
    const role = body?.role;
    const plan = body?.plan;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const walletAdjustment = body?.walletAdjustment ?? 0;
    if (displayName.length < 2 || displayName.length > 120 ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Informe nome e email válidos." }, 400);
    }
    if (!["user", "creator", "admin"].includes(role) ||
      !["free", "pro", "premium"].includes(plan)) {
      return json({ error: "Selecione uma função e um plano válidos." }, 400);
    }
    if (!reason || reason.length > 500) return json({ error: "Informe o motivo do cadastro (até 500 caracteres)." }, 400);
    if (typeof walletAdjustment !== "number" || !Number.isFinite(walletAdjustment) ||
      Math.abs(walletAdjustment) > 100000 ||
      Math.abs(walletAdjustment * 100 - Math.round(walletAdjustment * 100)) > 0.000001) {
      return json({ error: "Informe um ajuste da carteira válido, com até duas casas decimais." }, 400);
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

    const userId = data.user?.id;
    if (!userId) return json({ error: "Convite enviado, mas a conta não pôde ser localizada. Confira a lista de usuários antes de tentar novamente.", userCreated: true }, 502);

    const adminClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: accessError } = await adminClient.rpc("admin_update_user_access_v1", {
      p_user_id: userId,
      p_role: role,
      p_plan: plan,
      p_plan_expires_at: plan === "free" ? null : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      p_reason: reason,
    });
    if (accessError) {
      console.error("admin-invite-user access configuration failed", accessError);
      return json({ error: "O convite foi enviado, mas não foi possível configurar função e plano. Edite a conta criada na lista de usuários.", userCreated: true, userId }, 500);
    }

    if (walletAdjustment !== 0) {
      const { error: walletError } = await adminClient.rpc("adjust_wallet_v1", {
        p_user_id: userId,
        p_amount: walletAdjustment,
        p_reason: reason,
      });
      if (walletError) {
        console.error("admin-invite-user wallet adjustment failed", walletError);
        return json({ error: "O convite, a função e o plano foram configurados, mas o ajuste da carteira falhou. Confira a conta antes de aplicar o ajuste pela edição.", userCreated: true, userId }, 500);
      }
    }

    await recordEdgeLog({
      source: "admin-invite-user",
      event: "user_invited",
      context: { adminId: admin.id, invitedUserId: userId, role, plan, walletAdjusted: walletAdjustment !== 0 },
    });
    return json({ success: true, userId });
  } catch (error) {
    console.error("admin-invite-user failed", error);
    return json({ error: "Não foi possível criar o usuário." }, 500);
  }
});

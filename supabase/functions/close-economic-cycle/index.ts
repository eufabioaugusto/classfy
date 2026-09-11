import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authorization = req.headers.get("Authorization") || "";

    if (authorization !== `Bearer ${serviceKey}`) {
      const auth = createClient(supabaseUrl, anonKey);
      const { data: { user }, error } = await auth.auth.getUser(authorization.replace("Bearer ", ""));
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      const admin = createClient(supabaseUrl, serviceKey);
      const { data: role } = await admin.from("user_roles").select("role")
        .eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (!role) return json({ error: "Admin access required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const yearMonth = body.year_month || previousMonth();
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase.rpc("close_economic_cycle_v1", {
      p_year_month: yearMonth,
    });
    if (error) throw error;
    return json(data);
  } catch (error) {
    console.error("close-economic-cycle V1 error", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function previousMonth() {
  const now = new Date();
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

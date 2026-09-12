import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  try {
    const { creatorId } = await req.json();
    if (!creatorId) return json({ error: "creatorId e obrigatorio" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const serviceClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    if (user.id !== creatorId) {
      const { data: adminRole } = await serviceClient.from("user_roles")
        .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (!adminRole) return json({ error: "Forbidden" }, 403);
    }

    const { data, error } = await serviceClient.rpc(
      "evaluate_creator_milestones_v1",
      { p_creator_id: creatorId, p_types: null },
    );
    if (error) throw error;

    return json(data);
  } catch (error) {
    console.error("check-creator-milestones:", error);
    return json({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

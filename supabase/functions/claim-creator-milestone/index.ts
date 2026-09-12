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
    const { milestoneId, creatorId } = await req.json();
    if (!milestoneId) return json({ error: "milestoneId e obrigatorio" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);
    if (creatorId && creatorId !== user.id) return json({ error: "Forbidden" }, 403);

    const { data, error } = await supabase.rpc("claim_creator_milestone_v1", {
      p_milestone_id: milestoneId,
    });
    if (error) throw error;

    return json(data);
  } catch (error) {
    console.error("claim-creator-milestone:", error);
    return json({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

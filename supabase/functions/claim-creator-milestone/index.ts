import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Autenticar usuário via JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { milestoneId, creatorId } = await req.json();

    if (!milestoneId || !creatorId) {
      return new Response(
        JSON.stringify({ error: "milestoneId e creatorId são obrigatórios" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Autorização: só o próprio creator pode resgatar o próprio milestone
    if (user.id !== creatorId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: creatorRole }, { data: creatorProfile }] = await Promise.all(
      [
        supabase.from("user_roles").select("role").eq("user_id", creatorId).eq(
          "role",
          "creator",
        ).maybeSingle(),
        supabase.from("profiles").select("creator_status").eq("id", creatorId)
          .single(),
      ],
    );
    if (!creatorRole || creatorProfile?.creator_status !== "approved") {
      return new Response(
        JSON.stringify({ error: "Creator aprovado obrigatório" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Buscar o milestone e verificar que está elegível
    const { data: milestone, error: msError } = await supabase
      .from("creator_milestones")
      .select("id, title, points_reward, milestone_type, milestone_value")
      .eq("id", milestoneId)
      .single();

    if (msError || !milestone) {
      return new Response(
        JSON.stringify({ error: "Milestone não encontrado" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: progress, error: progressError } = await supabase
      .from("creator_milestone_progress")
      .select("id, completed_at, claimed")
      .eq("creator_id", creatorId)
      .eq("milestone_id", milestoneId)
      .maybeSingle();
    if (progressError || !progress?.completed_at) {
      return new Response(
        JSON.stringify({ error: "Milestone ainda não concluído" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (progress.claimed) {
      return new Response(
        JSON.stringify({ success: false, alreadyClaimed: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { error: claimedError } = await supabase
      .from("creator_milestone_progress")
      .update({ claimed: true, claimed_at: new Date().toISOString() })
      .eq("id", progress.id)
      .eq("claimed", false);
    if (claimedError) throw claimedError;

    // Notificação
    await supabase.from("notifications").insert({
      user_id: creatorId,
      type: "milestone_completed",
      title: "🎉 Meta alcançada!",
      message:
        `Você concluiu a meta "${milestone.title}" e desbloqueou essa conquista.`,
    });

    console.log(
      `Milestone recognized: ${milestoneId} by creator ${
        creatorId.slice(0, 8)
      }`,
    );

    return new Response(
      JSON.stringify({ success: true, points: 0, recognitionOnly: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Error claiming milestone:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

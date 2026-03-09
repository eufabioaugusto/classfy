import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReverseRewardPayload {
  actionKey: string;
  userId: string;
  contentId: string;
}

function buildTrackingKey(actionKey: string, contentId: string) {
  return `${actionKey}_${contentId}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { actionKey, userId, contentId }: ReverseRewardPayload = await req.json();

    if (!actionKey || !userId || !contentId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: actionKey, userId, contentId" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // Get the most recent reward event for this action/content
    const { data: reward, error: rewardErr } = await supabase
      .from("reward_events")
      .select("id, value, points, performance_points, cycle_id")
      .eq("user_id", userId)
      .eq("content_id", contentId)
      .eq("action_key", actionKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rewardErr) {
      return new Response(
        JSON.stringify({ error: "Failed to find reward" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    if (!reward) {
      return new Response(
        JSON.stringify({ success: true, reversed: false, value: 0, points: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch creator reward before deleting anything (parallel)
    const [delResult, creatorRewardResult] = await Promise.all([
      // Delete user reward event
      supabase
        .from("reward_events")
        .delete()
        .eq("id", reward.id),

      // Find creator reward event
      supabase
        .from("reward_events")
        .select("id, performance_points, user_id, cycle_id")
        .eq("content_id", contentId)
        .eq("action_key", actionKey)
        .filter("metadata->>as_creator", "eq", "true")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (delResult.error) {
      return new Response(
        JSON.stringify({ error: "Failed to delete reward" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    // Revert user PP atomically using increment_cycle_user_points with negative value
    const ppToRevert = Number(reward.performance_points || 0);
    const userPPPromise = (ppToRevert > 0 && reward.cycle_id)
      ? supabase.rpc("increment_cycle_user_points", {
          p_cycle_id: reward.cycle_id,
          p_user_id: userId,
          p_points: -ppToRevert,
        })
      : Promise.resolve({ error: null });

    const creatorReward = creatorRewardResult.data;
    let creatorDeletePromise = Promise.resolve({ error: null });
    let creatorPPPromise = Promise.resolve({ error: null });
    let creatorPPReverted = 0;

    if (creatorReward) {
      const creatorPP = Number(creatorReward.performance_points || 0);
      creatorPPReverted = creatorPP;

      // Delete creator reward event
      creatorDeletePromise = supabase
        .from("reward_events")
        .delete()
        .eq("id", creatorReward.id);

      // Revert creator PP atomically
      if (creatorPP > 0 && creatorReward.cycle_id) {
        creatorPPPromise = supabase.rpc("increment_cycle_user_points", {
          p_cycle_id: creatorReward.cycle_id,
          p_user_id: creatorReward.user_id,
          p_points: -creatorPP,
        });
      }
    }

    // Remove tracking record + run all async reversals in parallel
    const trackingKey = buildTrackingKey(actionKey, contentId);
    await Promise.all([
      userPPPromise,
      creatorDeletePromise,
      creatorPPPromise,
      supabase
        .from("reward_action_tracking")
        .delete()
        .eq("user_id", userId)
        .eq("action_key", trackingKey),
    ]);

    return new Response(
      JSON.stringify({
        success: true,
        reversed: true,
        performance_points_reverted: ppToRevert,
        creator_pp_reverted: creatorPPReverted,
        points: Number(reward.points || 0),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

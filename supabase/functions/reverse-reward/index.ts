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

// Mirrors process-reward tracking-key logic for per-content actions
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
      .select("id, value, points")
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

    // Delete reward event
    const { error: delErr } = await supabase
      .from("reward_events")
      .delete()
      .eq("id", reward.id);

    if (delErr) {
      return new Response(
        JSON.stringify({ error: "Failed to delete reward" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    // Update wallet (balance + total_earned)
    const { data: wallet, error: walletErr } = await supabase
      .from("wallets")
      .select("balance, total_earned")
      .eq("user_id", userId)
      .single();

    if (walletErr) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch wallet" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    const value = Number(reward.value || 0);
    const newBalance = Math.max(0, Number(wallet.balance || 0) - value);
    const newTotalEarned = Math.max(0, Number(wallet.total_earned || 0) - value);

    const { error: updErr } = await supabase
      .from("wallets")
      .update({
        balance: newBalance,
        total_earned: newTotalEarned,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updErr) {
      return new Response(
        JSON.stringify({ error: "Failed to update wallet" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    // Remove tracking record (so re-like can reward again, consistent with reversal)
    const trackingKey = buildTrackingKey(actionKey, contentId);
    await supabase
      .from("reward_action_tracking")
      .delete()
      .eq("user_id", userId)
      .eq("action_key", trackingKey);

    return new Response(
      JSON.stringify({
        success: true,
        reversed: true,
        value: value,
        points: Number(reward.points || 0),
        wallet: { balance: newBalance, total_earned: newTotalEarned },
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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReverseRewardPayload {
  actionKey: string;
  userId: string;
  contentId?: string;
  targetId?: string;
}

const REVERSIBLE_ACTIONS = new Set([
  "LIKE",
  "SAVE",
  "FAVORITE",
  "SUBSCRIBE_CREATOR",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: ReverseRewardPayload = await req.json();
    const actionKey = payload.actionKey?.trim().toUpperCase();
    const userId = payload.userId;
    const targetId = payload.targetId || payload.contentId;

    if (!actionKey || !userId || !targetId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: actionKey, userId, targetId" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    if (!REVERSIBLE_ACTIONS.has(actionKey)) {
      return new Response(JSON.stringify({ error: "Reward action is not reversible" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const isServiceRequest = authHeader === `Bearer ${supabaseKey}`;
    if (!isServiceRequest) {
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authError } = await authClient.auth.getUser(
        authHeader.replace("Bearer ", ""),
      );
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401,
        });
      }
      if (user.id !== userId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403,
        });
      }
    }

    const { data: reversal, error: reversalError } = await supabase.rpc("reverse_reward_award", {
      p_user_id: userId,
      p_content_id: targetId,
      p_action_key: actionKey,
    });
    if (reversalError) {
      return new Response(JSON.stringify({ error: reversalError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
      });
    }
    return new Response(JSON.stringify({ success: true, ...reversal }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

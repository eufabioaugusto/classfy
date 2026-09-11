import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!serviceKey || req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
      return json({ error: "Service authorization required" }, 401);
    }
    const payload = await req.json();
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Positive amount is required" }, 400);

    const allowed = new Set(["subscription_pro", "subscription_premium", "content_purchase", "boost", "other"]);
    if (!allowed.has(payload.revenue_type)) return json({ error: "Invalid revenue type" }, 400);
    const explicitlyEligible = payload.revenue_type === "other"
      ? payload.is_pool_eligible === true
      : payload.is_pool_eligible !== false;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const { data, error } = await supabase.rpc("record_revenue_entry_v1", {
      p_revenue_type: payload.revenue_type,
      p_gross_amount: amount,
      p_source_id: payload.source_id || null,
      p_user_id: payload.user_id || null,
      p_metadata: payload.metadata || {},
      p_is_pool_eligible: explicitlyEligible,
      p_payment_fee_amount: Number(payload.payment_fee_amount || 0),
      p_tax_amount: Number(payload.tax_amount || 0),
      p_creator_amount: Number(payload.creator_amount || 0),
    });
    if (error) throw error;
    return json({ success: true, data });
  } catch (error) {
    console.error("record-revenue V1 error", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

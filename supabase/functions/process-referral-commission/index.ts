import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authorization = req.headers.get("Authorization") || "";

    if (authorization !== `Bearer ${serviceKey}`) {
      const auth = createClient(supabaseUrl, anonKey);
      const { data: { user }, error } = await auth.auth.getUser(
        authorization.replace("Bearer ", ""),
      );
      if (error || !user) return json({ error: "Unauthorized" }, 401);

      const admin = createClient(supabaseUrl, serviceKey);
      const { data: role } = await admin.from("user_roles").select("role")
        .eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (!role) return json({ error: "Admin access required" }, 403);
    }

    const { conversion_id, purchase_amount, purchase_type, stripe_charge_id } =
      await req.json();
    const amount = Number(purchase_amount);
    if (
      !conversion_id || !Number.isFinite(amount) || amount <= 0 ||
      amount > 100000 || !purchase_type
    ) {
      return json({ error: "Invalid referral commission payload" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase.rpc(
      "process_referral_commission_v1",
      {
        p_conversion_id: conversion_id,
        p_purchase_amount: amount,
        p_purchase_type: purchase_type,
        p_stripe_charge_id: stripe_charge_id || null,
      },
    );
    if (error) throw error;
    return json(data);
  } catch (error) {
    console.error("process-referral-commission V1 error", error);
    return json({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

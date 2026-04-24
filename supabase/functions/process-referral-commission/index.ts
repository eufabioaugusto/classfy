import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify the request is from an authenticated source (service role or admin)
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      console.error("Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Extract JWT token and verify it's service role or admin
    const token = authHeader.replace("Bearer ", "");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    
    // Create a client with the user's token to check their role
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      supabaseAnonKey,
      { 
        auth: { persistSession: false },
        global: { headers: { Authorization: authHeader } }
      }
    );

    // Check if this is a service role call (from stripe webhook)
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    
    // If we can get a user, verify they have admin role
    if (user) {
      const { data: roleData } = await supabaseClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .single();

      if (!roleData) {
        console.error("User is not admin:", user.id);
        return new Response(
          JSON.stringify({ error: "Forbidden - Admin access required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // If userError, it might be service role call which is fine (no user context)

    const { conversion_id, purchase_amount, purchase_type, stripe_charge_id } = await req.json();

    if (!conversion_id || !purchase_amount || !purchase_type) {
      throw new Error("Missing required parameters");
    }

    // Validate purchase_amount is a positive number and within reasonable bounds
    const amount = Number(purchase_amount);
    if (isNaN(amount) || amount <= 0 || amount > 100000) {
      console.error("Invalid purchase amount:", purchase_amount);
      throw new Error("Invalid purchase amount");
    }

    // Get conversion data
    const { data: conversion, error: conversionError } = await supabaseClient
      .from("referral_conversions")
      .select("*")
      .eq("id", conversion_id)
      .single();

    if (conversionError) throw conversionError;

    if (!conversion) {
      console.error("Conversion not found:", conversion_id);
      throw new Error("Conversion not found");
    }

    // Check if already paid
    if (conversion.commission_paid) {
      console.log("Commission already paid for this conversion");
      return new Response(
        JSON.stringify({ success: false, message: "Commission already paid" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get commission rate from config
    const { data: config } = await supabaseClient
      .from("system_config")
      .select("config_value")
      .eq("config_key", "referral_commission_rate")
      .single();

    const commissionRate = config ? Number(config.config_value) : 0.10;
    
    // Cap commission rate at 50% for safety
    const safeCommissionRate = Math.min(commissionRate, 0.5);
    const commissionAmount = amount * safeCommissionRate;

    // Insert commission — UNIQUE(conversion_id) garante idempotência se webhook repetir
    let commissionId: string | null = null;
    const { data: commissionData, error: commissionError } = await supabaseClient
      .from("referral_commissions")
      .insert({
        referrer_id: conversion.referrer_id,
        referred_user_id: conversion.referred_user_id,
        conversion_id,
        purchase_type,
        purchase_amount: amount,
        commission_rate: safeCommissionRate,
        commission_amount: commissionAmount,
        status: "paid",
        stripe_charge_id,
        paid_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (commissionError) throw commissionError;
    commissionId = commissionData.id;

    // Update conversion
    await supabaseClient
      .from("referral_conversions")
      .update({
        first_purchase_at: new Date().toISOString(),
        commission_paid: true,
      })
      .eq("id", conversion_id);

    // Crédito atômico via RPC — sem read-modify-write
    const idempotencyKey = `commission_${commissionId}`;
    const { error: walletError } = await supabaseClient.rpc("increment_wallet", {
      p_user_id:         conversion.referrer_id,
      p_amount:          commissionAmount,
      p_tx_type:         "commission",
      p_description:     `Comissão de indicação - conversão ${conversion_id.substring(0, 8)}`,
      p_idempotency_key: idempotencyKey,
      p_commission_id:   commissionId,
      p_stripe_event_id: stripe_charge_id || null,
    });

    if (walletError) throw walletError;

    // Notificação
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("display_name")
      .eq("id", conversion.referred_user_id)
      .single();

    await supabaseClient
      .from("notifications")
      .insert({
        user_id: conversion.referrer_id,
        type: "reward",
        title: "💰 Comissão Recebida!",
        message: `Você ganhou R$ ${commissionAmount.toFixed(2)} pela indicação de ${profile?.display_name || "um usuário"}!`,
      });

    console.log(`Commission processed: R$ ${commissionAmount.toFixed(2)} for conversion ${conversion_id.substring(0, 8)}...`);

    return new Response(
      JSON.stringify({ success: true, commission_amount: commissionAmount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing referral commission:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});

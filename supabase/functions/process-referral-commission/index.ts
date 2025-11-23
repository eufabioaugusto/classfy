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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { conversion_id, purchase_amount, purchase_type, stripe_charge_id } = await req.json();

    if (!conversion_id || !purchase_amount || !purchase_type) {
      throw new Error("Missing required parameters");
    }

    // Get conversion data
    const { data: conversion, error: conversionError } = await supabaseClient
      .from("referral_conversions")
      .select("*")
      .eq("id", conversion_id)
      .single();

    if (conversionError) throw conversionError;

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
    const commissionAmount = purchase_amount * commissionRate;

    // Create commission record
    const { error: commissionError } = await supabaseClient
      .from("referral_commissions")
      .insert({
        referrer_id: conversion.referrer_id,
        referred_user_id: conversion.referred_user_id,
        conversion_id,
        purchase_type,
        purchase_amount,
        commission_rate: commissionRate,
        commission_amount: commissionAmount,
        status: "paid", // Instantly paid to wallet
        stripe_charge_id,
        paid_at: new Date().toISOString(),
      });

    if (commissionError) throw commissionError;

    // Update conversion
    await supabaseClient
      .from("referral_conversions")
      .update({
        first_purchase_at: new Date().toISOString(),
        commission_paid: true,
      })
      .eq("id", conversion_id);

    // Update referrer wallet
    const { data: wallet } = await supabaseClient
      .from("wallets")
      .select("balance, total_earned")
      .eq("user_id", conversion.referrer_id)
      .single();

    await supabaseClient
      .from("wallets")
      .update({
        balance: (wallet?.balance || 0) + commissionAmount,
        total_earned: (wallet?.total_earned || 0) + commissionAmount,
      })
      .eq("user_id", conversion.referrer_id);

    // Send notification
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

    console.log(`Commission processed: R$ ${commissionAmount} for conversion ${conversion_id}`);

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

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

    const { referral_code, referred_user_id } = await req.json();

    if (!referral_code || !referred_user_id) {
      throw new Error("Referral code and referred user ID are required");
    }

    // Get referral link
    const { data: link, error: linkError } = await supabaseClient
      .from("referral_links")
      .select("user_id, total_conversions")
      .eq("referral_code", referral_code)
      .single();

    if (linkError) throw linkError;

    // Check if user is trying to use their own referral link
    if (link.user_id === referred_user_id) {
      console.log("User tried to use their own referral link");
      return new Response(
        JSON.stringify({ success: false, message: "Cannot use own referral link" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if conversion already exists
    const { data: existing } = await supabaseClient
      .from("referral_conversions")
      .select("id")
      .eq("referred_user_id", referred_user_id)
      .single();

    if (existing) {
      console.log("Conversion already tracked for this user");
      return new Response(
        JSON.stringify({ success: false, message: "Conversion already tracked" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create conversion
    const { error: conversionError } = await supabaseClient
      .from("referral_conversions")
      .insert({
        referrer_id: link.user_id,
        referred_user_id,
        referral_code,
      });

    if (conversionError) throw conversionError;

    // Increment conversions count
    await supabaseClient
      .from("referral_links")
      .update({ total_conversions: (link.total_conversions || 0) + 1 })
      .eq("referral_code", referral_code);

    // Send notification to referrer
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("display_name")
      .eq("id", referred_user_id)
      .single();

    await supabaseClient
      .from("notifications")
      .insert({
        user_id: link.user_id,
        type: "system",
        title: "🎉 Nova Conversão!",
        message: `${profile?.display_name || "Alguém"} se cadastrou usando seu link de afiliado!`,
      });

    console.log(`Conversion tracked: ${referral_code} -> ${referred_user_id}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error tracking referral conversion:", error);
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

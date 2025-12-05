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

    const { referral_code } = await req.json();

    if (!referral_code) {
      throw new Error("Referral code is required");
    }

    // Increment click count
    const { error } = await supabaseClient
      .from("referral_links")
      .update({ 
        total_clicks: supabaseClient.rpc('increment', { row_id: referral_code })
      })
      .eq("referral_code", referral_code);

    // Using a simpler approach - fetch and increment
    const { data: link, error: fetchError } = await supabaseClient
      .from("referral_links")
      .select("total_clicks")
      .eq("referral_code", referral_code)
      .single();

    if (fetchError) throw fetchError;

    await supabaseClient
      .from("referral_links")
      .update({ total_clicks: (link.total_clicks || 0) + 1 })
      .eq("referral_code", referral_code);

    console.log('Referral click tracked successfully');

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error tracking referral click:", error);
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

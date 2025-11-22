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

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { boostId, paymentIntentId } = await req.json();

    if (!boostId) {
      throw new Error("Missing boost ID");
    }

    const now = new Date();
    
    // Get boost data
    const { data: boost, error: boostError } = await supabaseClient
      .from('boosts')
      .select('*')
      .eq('id', boostId)
      .single();

    if (boostError) throw boostError;

    // Calculate end date
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + boost.duration_days);

    // Update boost to active
    const { error: updateError } = await supabaseClient
      .from('boosts')
      .update({
        status: 'active',
        start_date: now.toISOString(),
        end_date: endDate.toISOString(),
        stripe_payment_intent_id: paymentIntentId
      })
      .eq('id', boostId);

    if (updateError) throw updateError;

    // Create notification
    await supabaseClient
      .from('notifications')
      .insert({
        user_id: boost.user_id,
        type: 'system',
        title: '🚀 Boost Ativado!',
        message: `Seu boost está ativo por ${boost.duration_days} dias!`,
        related_content_id: boost.content_id
      });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
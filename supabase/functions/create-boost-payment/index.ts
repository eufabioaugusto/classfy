import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated");

    const { boostData } = await req.json();
    const { objective, contentId, audienceType, audienceFilters, dailyBudget, durationDays, boostId } = boostData;

    // Validate data
    if (!objective || !dailyBudget || !durationDays) {
      throw new Error("Missing required fields");
    }

    // Validate content exists if objective is content
    if (objective === 'content' && contentId) {
      const { data: content, error: contentError } = await supabaseClient
        .from('contents')
        .select('id')
        .eq('id', contentId)
        .single();
      
      if (contentError || !content) {
        throw new Error("Conteúdo não encontrado. Por favor, selecione um conteúdo válido.");
      }
    }

    const totalAmount = dailyBudget * durationDays;

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Check if customer exists
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    }

    let boost;
    
    // Se boostId foi fornecido, reutilizar o boost existente
    if (boostId) {
      const { data: existingBoost, error: fetchError } = await supabaseClient
        .from('boosts')
        .select()
        .eq('id', boostId)
        .eq('user_id', user.id)
        .single();
      
      if (fetchError) throw fetchError;
      boost = existingBoost;
    } else {
      // Criar novo boost
      const { data: newBoost, error: boostError } = await supabaseClient
        .from('boosts')
        .insert({
          user_id: user.id,
          content_id: objective === 'content' ? contentId : null,
          objective,
          audience_type: audienceType,
          audience_filters: audienceFilters || {},
          daily_budget: dailyBudget,
          duration_days: durationDays,
          status: 'pending_payment'
        })
        .select()
        .single();

      if (boostError) throw boostError;
      boost = newBoost;
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: objective === 'profile' ? 'Impulsionar Perfil' : 'Impulsionar Conteúdo',
              description: `${durationDays} dias de anúncio - R$ ${dailyBudget}/dia`,
            },
            unit_amount: Math.round(totalAmount * 100), // Convert to centavos
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${req.headers.get("origin")}/boost-success?boost_id=${boost.id}`,
      cancel_url: `${req.headers.get("origin")}/`,
      metadata: {
        boost_id: boost.id,
        user_id: user.id,
      },
    });

    return new Response(JSON.stringify({ url: session.url, boostId: boost.id }), {
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
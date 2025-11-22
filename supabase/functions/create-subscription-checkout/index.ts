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

    const { plan } = await req.json();

    if (!plan || !['pro', 'premium'].includes(plan)) {
      throw new Error("Invalid plan selected");
    }

    // Fixed Stripe Product IDs
    const planConfig = {
      pro: {
        name: "Classfy Pro",
        priceId: "price_1SWKSDBW0e1s8a6ZRbWZI6Fm",
        productId: "prod_TTH0TCgKCJn5QS",
      },
      premium: {
        name: "Classfy Premium",
        priceId: "price_1SWKT6BW0e1s8a6ZGKTT7wTV",
        productId: "prod_TTH12wU8lOauHD",
      },
    };

    const selectedPlan = planConfig[plan as keyof typeof planConfig];

    console.log("[CREATE-SUBSCRIPTION-CHECKOUT] Creating checkout for plan:", plan, "with fixed price ID:", selectedPlan.priceId);

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

    // Create checkout session for subscription
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [
        {
          price: selectedPlan.priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${req.headers.get("origin")}/conta?subscription=success`,
      cancel_url: `${req.headers.get("origin")}/conta?subscription=canceled`,
      metadata: {
        user_id: user.id,
        plan_type: plan,
        product_id: selectedPlan.productId,
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
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

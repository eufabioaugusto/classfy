import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  STRIPE_PLANS,
  findBillableSubscription,
  getOrCreateStripeCustomer,
  getRequestOrigin,
  isSubscriptionPlan,
} from "../_shared/stripe-subscription.ts";

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("User not authenticated");

    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated");

    const body = await req.json();
    const plan = body.plan || body.planType;

    if (!isSubscriptionPlan(plan)) {
      throw new Error("Invalid plan selected");
    }

    const selectedPlan = STRIPE_PLANS[plan];

    console.log("[CREATE-SUBSCRIPTION-CHECKOUT] Creating checkout for plan:", plan, "with fixed price ID:", selectedPlan.priceId);

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const origin = getRequestOrigin(req);
    const customerId = await getOrCreateStripeCustomer(stripe, supabaseClient, {
      id: user.id,
      email: user.email,
    });

    const existingSubscription = await findBillableSubscription(stripe, customerId);
    if (existingSubscription) {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/conta`,
      });

      return new Response(JSON.stringify({ url: portalSession.url, mode: "portal" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Create checkout session for subscription
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [
        {
          price: selectedPlan.priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      payment_method_types: ['card'],
      success_url: `${origin}/conta?subscription=success`,
      cancel_url: `${origin}/conta?subscription=canceled`,
      metadata: {
        user_id: user.id,
        plan_type: plan,
        product_id: selectedPlan.productId,
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan_type: plan,
          product_id: selectedPlan.productId,
        },
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

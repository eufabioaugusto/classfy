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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      // No auth header - return free plan gracefully
      return new Response(JSON.stringify({ 
        hasSubscription: false,
        plan: 'free'
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user?.email) {
      // Auth error or no email - return free plan gracefully instead of 401
      console.log("[VERIFY-SUBSCRIPTION] No valid user session, returning free plan");
      return new Response(JSON.stringify({ 
        hasSubscription: false,
        plan: 'free'
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Check if customer exists
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    
    if (customers.data.length === 0) {
      return new Response(JSON.stringify({ 
        hasSubscription: false,
        plan: 'free'
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const customerId = customers.data[0].id;

    // Get active subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    const hasActiveSub = subscriptions.data.length > 0;
    let planType = 'free';
    let subscriptionEnd = null;

    if (hasActiveSub) {
      const subscription = subscriptions.data[0];
      subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
      
      // Get product ID from subscription
      const productId = subscription.items.data[0].price.product as string;
      
      // Map product ID to plan type using fixed IDs
      const productToPlan: Record<string, string> = {
        "prod_TTH0TCgKCJn5QS": "pro",
        "prod_TTH12wU8lOauHD": "premium",
      };
      
      planType = productToPlan[productId] || subscription.metadata.plan_type || 'pro';
      
      console.log("[VERIFY-SUBSCRIPTION] Active subscription found:", {
        subscriptionId: subscription.id,
        productId,
        planType,
        endDate: subscriptionEnd,
      });

      // Update profile with subscription info
      await supabaseClient
        .from('profiles')
        .update({
          plan: planType,
          plan_expires_at: subscriptionEnd,
        })
        .eq('id', user.id);
    }

    return new Response(JSON.stringify({
      hasSubscription: hasActiveSub,
      plan: planType,
      subscriptionEnd,
    }), {
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

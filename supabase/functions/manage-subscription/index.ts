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
    
    if (!user?.email) {
      throw new Error("User not authenticated");
    }

    const { action, newPlan } = await req.json();

    if (!action || !["upgrade", "downgrade", "cancel"].includes(action)) {
      throw new Error("Invalid action");
    }

    console.log("[MANAGE-SUBSCRIPTION] Action:", action, "New plan:", newPlan);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Find customer
    const customers = await stripe.customers.list({ 
      email: user.email, 
      limit: 1 
    });

    if (customers.data.length === 0) {
      throw new Error("No Stripe customer found");
    }

    const customerId = customers.data[0].id;

    // Get active subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      throw new Error("No active subscription found");
    }

    const subscription = subscriptions.data[0];

    // Handle cancel
    if (action === "cancel") {
      await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
      });

      console.log("[MANAGE-SUBSCRIPTION] Subscription cancelled at period end");

      return new Response(JSON.stringify({ 
        success: true,
        message: "Sua assinatura será cancelada ao final do período atual"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Handle upgrade/downgrade
    if (!newPlan || !["pro", "premium"].includes(newPlan)) {
      throw new Error("Invalid plan for upgrade/downgrade");
    }

    const planConfig: Record<string, { priceId: string; productId: string }> = {
      pro: {
        priceId: "price_1SWKSDBW0e1s8a6ZRbWZI6Fm",
        productId: "prod_TTH0TCgKCJn5QS",
      },
      premium: {
        priceId: "price_1SWKT6BW0e1s8a6ZGKTT7wTV",
        productId: "prod_TTH12wU8lOauHD",
      },
    };

    const targetPlan = planConfig[newPlan];

    // Update subscription
    const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: targetPlan.priceId,
        },
      ],
      proration_behavior: "create_prorations",
      metadata: {
        plan_type: newPlan,
        product_id: targetPlan.productId,
      },
    });

    console.log("[MANAGE-SUBSCRIPTION] Subscription updated:", {
      subscriptionId: updatedSubscription.id,
      newPlan,
      productId: targetPlan.productId,
    });

    // Update profile
    await supabaseClient
      .from("profiles")
      .update({
        plan: newPlan,
        plan_expires_at: new Date(updatedSubscription.current_period_end * 1000).toISOString(),
      })
      .eq("id", user.id);

    return new Response(JSON.stringify({ 
      success: true,
      message: action === "upgrade" 
        ? "Plano atualizado com sucesso! As mudanças são imediatas."
        : "Plano alterado com sucesso! O valor será ajustado na próxima cobrança."
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[MANAGE-SUBSCRIPTION] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

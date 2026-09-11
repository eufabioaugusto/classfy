import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  findBillableSubscription,
  findStripeCustomer,
  getSubscriptionPeriodEnd,
  isSubscriptionPlan,
  STRIPE_PLANS,
} from "../_shared/stripe-subscription.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("User not authenticated");

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

    const { customerId, profile } = await findStripeCustomer(
      stripe,
      supabaseClient,
      {
        id: user.id,
        email: user.email,
      },
    );

    if (!customerId) {
      throw new Error("No Stripe customer found");
    }

    const subscription = await findBillableSubscription(stripe, customerId);
    if (!subscription) {
      throw new Error("No active subscription found");
    }

    // Handle cancel
    if (action === "cancel") {
      await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
      });

      console.log("[MANAGE-SUBSCRIPTION] Subscription cancelled at period end");

      return new Response(
        JSON.stringify({
          success: true,
          message: "Sua assinatura será cancelada ao final do período atual",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    // Handle upgrade/downgrade
    if (!isSubscriptionPlan(newPlan)) {
      throw new Error("Invalid plan for upgrade/downgrade");
    }

    const targetPlan = STRIPE_PLANS[newPlan];

    // Update subscription
    const isDowngrade = profile?.plan === "premium" && newPlan === "pro";
    const updatedSubscription = await stripe.subscriptions.update(
      subscription.id,
      {
        items: [
          {
            id: subscription.items.data[0].id,
            price: targetPlan.priceId,
          },
        ],
        proration_behavior: isDowngrade ? "none" : "create_prorations",
        payment_behavior: isDowngrade
          ? "allow_incomplete"
          : "pending_if_incomplete",
        metadata: {
          plan_type: newPlan,
          product_id: targetPlan.productId,
          pending_plan: newPlan,
        },
      },
    );

    console.log("[MANAGE-SUBSCRIPTION] Subscription updated:", {
      subscriptionId: updatedSubscription.id,
      newPlan,
      productId: targetPlan.productId,
    });

    const effectiveAt = isDowngrade
      ? getSubscriptionPeriodEnd(subscription)
      : getSubscriptionPeriodEnd(updatedSubscription);
    const { error: syncError } = await supabaseClient.rpc(
      "sync_subscription_state_v1",
      {
        p_user_id: user.id,
        p_status: updatedSubscription.status,
        p_plan: newPlan,
        p_period_end: getSubscriptionPeriodEnd(updatedSubscription),
        p_subscription_id: updatedSubscription.id,
        p_customer_id: customerId,
        p_pending_plan: newPlan,
        p_pending_effective_at: effectiveAt,
        p_event_created_at: new Date().toISOString(),
      },
    );
    if (syncError) throw syncError;

    return new Response(
      JSON.stringify({
        success: true,
        message: action === "upgrade"
          ? "Upgrade solicitado. O novo plano entra após a confirmação do pagamento."
          : "Downgrade agendado para o fim do período já pago.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("[MANAGE-SUBSCRIPTION] Error:", error);
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

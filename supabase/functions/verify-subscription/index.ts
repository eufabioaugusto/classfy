import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  findBillableSubscription,
  findStripeCustomer,
  getPlanFromProduct,
  getSubscriptionPeriodEnd,
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
    if (!authHeader) {
      // No auth header - return free plan gracefully
      return new Response(
        JSON.stringify({
          hasSubscription: false,
          plan: "free",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth
      .getUser(token);

    if (authError || !user?.email) {
      // Auth error or no email - return free plan gracefully instead of 401
      console.log(
        "[VERIFY-SUBSCRIPTION] No valid user session, returning free plan",
      );
      return new Response(
        JSON.stringify({
          hasSubscription: false,
          plan: "free",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    // Initialize Stripe
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
      const expiresAt = profile?.plan_expires_at
        ? new Date(profile.plan_expires_at).getTime()
        : null;
      const shouldExpireLocalPlan = Boolean(
        expiresAt && expiresAt <= Date.now(),
      );

      if (shouldExpireLocalPlan) {
        const { error: syncError } = await supabaseClient.rpc(
          "sync_subscription_state_v1",
          {
            p_user_id: user.id,
            p_status: "expired",
            p_plan: null,
            p_period_end: null,
            p_subscription_id: null,
            p_customer_id: null,
            p_pending_plan: null,
            p_pending_effective_at: null,
            p_event_created_at: new Date().toISOString(),
          },
        );
        if (syncError) throw syncError;
      }

      return new Response(
        JSON.stringify({
          hasSubscription: false,
          plan: shouldExpireLocalPlan ? "free" : profile?.plan ?? "free",
          subscriptionEnd: shouldExpireLocalPlan
            ? null
            : profile?.plan_expires_at ?? null,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    const subscription = await findBillableSubscription(stripe, customerId);
    let hasActiveSub = Boolean(subscription);
    let planType = "free";
    let subscriptionEnd = null;

    if (subscription) {
      subscriptionEnd = getSubscriptionPeriodEnd(subscription);

      // Get product ID from subscription
      const productId = subscription.items.data[0]?.price?.product as
        | string
        | undefined;
      planType = getPlanFromProduct(
        productId,
        subscription.metadata?.plan_type,
      );
      const pendingPlan = subscription.metadata?.pending_plan;
      const isPendingDowngrade = profile?.plan === "premium" &&
        planType === "pro" && pendingPlan === "pro";

      console.log("[VERIFY-SUBSCRIPTION] Active subscription found:", {
        subscriptionId: subscription.id,
        productId,
        planType,
        endDate: subscriptionEnd,
      });

      const { data: synced, error: syncError } = await supabaseClient.rpc(
        "sync_subscription_state_v1",
        {
          p_user_id: user.id,
          p_status: subscription.status,
          p_plan: planType,
          p_period_end: subscriptionEnd,
          p_subscription_id: subscription.id,
          p_customer_id: customerId,
          p_pending_plan: isPendingDowngrade ? "pro" : null,
          p_pending_effective_at: isPendingDowngrade ? subscriptionEnd : null,
          p_event_created_at: new Date().toISOString(),
        },
      );
      if (syncError) throw syncError;
      planType = synced?.plan || "free";
      hasActiveSub = planType !== "free";
    } else {
      const { error: syncError } = await supabaseClient.rpc(
        "sync_subscription_state_v1",
        {
          p_user_id: user.id,
          p_status: "free",
          p_plan: null,
          p_period_end: null,
          p_subscription_id: null,
          p_customer_id: customerId,
          p_pending_plan: null,
          p_pending_effective_at: null,
          p_event_created_at: new Date().toISOString(),
        },
      );
      if (syncError) throw syncError;
    }

    return new Response(
      JSON.stringify({
        hasSubscription: hasActiveSub,
        plan: planType,
        subscriptionEnd,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

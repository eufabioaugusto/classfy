import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { getPlanFromProduct, getSubscriptionPeriodEnd } from "../_shared/stripe-subscription.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
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

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2025-08-27.basil",
  });

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  let event: Stripe.Event | null = null;
  let eventRecorded = false;

  try {
    const body = await req.text();
    
    if (!webhookSecret || !signature) {
      throw new Error("Stripe webhook signature configuration is missing");
    }
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

    if (!event) throw new Error("Invalid Stripe event payload");

    console.log(`Received event: ${event.type} (${event.id})`);

    // Dedupe: se esse event_id já foi processado, retorna 200 imediatamente
    const { error: dedupError } = await supabaseClient
      .from('stripe_events_processed')
      .insert({ event_id: event.id, event_type: event.type });

    if (dedupError) {
      // unique_violation (23505) = evento já processado
      if (dedupError.code === '23505') {
        console.log(`Event ${event.id} already processed, skipping.`);
        return new Response(JSON.stringify({ received: true, skipped: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw new Error(`Failed to reserve Stripe event: ${dedupError.message}`);
    } else {
      eventRecorded = true;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        
        // Handle boost purchase
        if (session.mode === "payment" && session.metadata?.boost_id) {
          const boostId = session.metadata.boost_id;
          const totalBudget = session.amount_total ? session.amount_total / 100 : 0;
          const costs = await getPaymentCosts(stripe, session.payment_intent as string | null);
          
          console.log("[WEBHOOK] Boost payment completed:", { boostId, totalBudget });

          // Activate boost
          const { error: activateError } = await supabaseClient.functions.invoke('activate-boost', {
            body: {
              boostId,
              paymentIntentId: session.payment_intent as string,
            }
          });
          if (activateError) throw new Error(`Boost activation failed: ${activateError.message}`);
          console.log("Boost activated successfully");

          // Record boost revenue
          if (totalBudget > 0) {
            await recordRevenue(supabaseClient, {
              revenue_type: 'boost',
              amount: totalBudget,
              source_id: session.payment_intent as string,
              user_id: session.metadata.user_id,
              metadata: { boost_id: boostId, total_budget: totalBudget },
              payment_fee_amount: costs.paymentFee,
              tax_amount: (session.total_details?.amount_tax || 0) / 100,
            });
          }
        }
        
        // Handle content purchase
        if (session.mode === "payment" && session.metadata?.content_id) {
          const safePricePaid = session.amount_total ? session.amount_total / 100 : 0;
          const discountApplied = parseFloat(session.metadata.discount_applied || "0");
          const paymentIntentId = session.payment_intent as string;
          const costs = await getPaymentCosts(stripe, paymentIntentId);
          const { data, error } = await supabaseClient.rpc("record_content_sale_v1", {
            p_user_id: session.metadata.user_id,
            p_content_id: session.metadata.content_id,
            p_gross_amount: safePricePaid,
            p_discount_applied: Number.isFinite(discountApplied) ? discountApplied : 0,
            p_payment_intent_id: paymentIntentId,
            p_checkout_session_id: session.id,
            p_payment_fee_amount: costs.paymentFee,
            p_tax_amount: (session.total_details?.amount_tax || 0) / 100,
          });
          if (error) throw new Error(`Error recording content sale: ${error.message}`);
          console.log("Content sale recorded atomically", data);
        }
        
        // Handle subscription
        if (session.mode === "subscription" && session.metadata?.user_id) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          
          const productId = subscription.items.data[0]?.price?.product as string | undefined;
          const planType = getPlanFromProduct(productId, session.metadata.plan_type);
          const subscriptionEnd = getSubscriptionPeriodEnd(subscription);

          console.log("[WEBHOOK] Subscription checkout completed:", {
            userId: session.metadata.user_id,
            productId,
            planType,
            subscriptionEnd,
          });

          const { error } = await supabaseClient.rpc("sync_subscription_state_v1", {
            p_user_id: session.metadata.user_id,
            p_status: subscription.status,
            p_plan: planType,
            p_period_end: subscriptionEnd,
            p_subscription_id: subscription.id,
            p_customer_id: session.customer as string,
            p_pending_plan: null,
            p_pending_effective_at: null,
          });
          if (error) throw new Error(`Error updating subscription: ${error.message}`);
        }

        // Check for referral commission
        const userId = session.metadata?.user_id;
        const purchaseAmount = session.amount_total ? session.amount_total / 100 : 0;
        
        if (userId && purchaseAmount > 0) {
          const { data: conversion } = await supabaseClient
            .from("referral_conversions")
            .select("*")
            .eq("referred_user_id", userId)
            .eq("commission_paid", false)
            .is("first_purchase_at", null)
            .single();

          if (conversion) {
            await supabaseClient.functions.invoke('process-referral-commission', {
              body: {
                conversion_id: conversion.id,
                purchase_amount: purchaseAmount,
                purchase_type: session.mode,
                stripe_charge_id: session.payment_intent as string || session.subscription as string,
              }
            });
          }
        }
        
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const { data: profile } = await supabaseClient
          .from("profiles")
          .select("id")
          .eq("billing_id", customerId)
          .single();

        if (profile) {
          const productId = subscription.items.data[0]?.price?.product as string | undefined;
          const planType = getPlanFromProduct(productId, subscription.metadata?.plan_type);
          const subscriptionEnd = getSubscriptionPeriodEnd(subscription);
          const pendingPlan = subscription.metadata?.pending_plan;

          console.log("[WEBHOOK] Subscription updated/deleted:", {
            userId: profile.id,
            productId,
            planType,
            status: subscription.status,
            subscriptionEnd,
          });

          const { error } = await supabaseClient.rpc("sync_subscription_state_v1", {
            p_user_id: profile.id,
            p_status: subscription.status,
            p_plan: planType,
            p_period_end: subscriptionEnd,
            p_subscription_id: subscription.id,
            p_customer_id: customerId,
            p_pending_plan: pendingPlan === "pro" || pendingPlan === "premium" ? pendingPlan : null,
            p_pending_effective_at: pendingPlan ? subscriptionEnd : null,
          });

          if (error) {
            throw new Error(`Error updating subscription status: ${error.message}`);
          } else {
            console.log(`Subscription ${event.type} processed successfully`);
          }
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
          const customerId = subscription.customer as string;

          const { data: profile } = await supabaseClient
            .from("profiles")
            .select("id")
            .eq("billing_id", customerId)
            .single();

          if (profile) {
            const subscriptionEnd = getSubscriptionPeriodEnd(subscription);
            const productId = subscription.items.data[0]?.price?.product as string | undefined;
            const planType = getPlanFromProduct(productId, subscription.metadata?.plan_type);

            const { error } = await supabaseClient.rpc("sync_subscription_state_v1", {
              p_user_id: profile.id,
              p_status: subscription.status,
              p_plan: planType,
              p_period_end: subscriptionEnd,
              p_subscription_id: subscription.id,
              p_customer_id: customerId,
              p_pending_plan: null,
              p_pending_effective_at: null,
            });

            if (error) {
              throw new Error(`Error updating subscription period: ${error.message}`);
            } else {
              console.log("Subscription renewed successfully");
              
              // Record renewal revenue
              const invoiceAmount = invoice.amount_paid ? invoice.amount_paid / 100 : 0;
              if (invoiceAmount > 0) {
                const paymentIntentId = typeof invoice.payment_intent === "string"
                  ? invoice.payment_intent
                  : invoice.payment_intent?.id;
                const costs = await getPaymentCosts(stripe, paymentIntentId || null);
                const revenueType = planType === "premium" ? 'subscription_premium' : 'subscription_pro';
                await recordRevenue(supabaseClient, {
                  revenue_type: revenueType,
                  amount: invoiceAmount,
                  source_id: invoice.id,
                  user_id: profile.id,
                  metadata: { invoice_id: invoice.id, plan_type: planType, product_id: productId },
                  payment_fee_amount: costs.paymentFee,
                  tax_amount: (invoice.total_tax_amounts || []).reduce(
                    (sum: number, tax: { amount: number }) => sum + tax.amount,
                    0,
                  ) / 100,
                });
              }
            }
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
          const customerId = subscription.customer as string;

          const { data: profile } = await supabaseClient
            .from("profiles")
            .select("id, display_name")
            .eq("billing_id", customerId)
            .single();

          if (profile) {
            const productId = subscription.items.data[0]?.price?.product as string | undefined;
            const planType = getPlanFromProduct(productId, subscription.metadata?.plan_type);
            const { error: stateError } = await supabaseClient.rpc("sync_subscription_state_v1", {
              p_user_id: profile.id,
              p_status: "past_due",
              p_plan: planType,
              p_period_end: getSubscriptionPeriodEnd(subscription),
              p_subscription_id: subscription.id,
              p_customer_id: customerId,
              p_pending_plan: null,
              p_pending_effective_at: null,
            });
            if (stateError) throw new Error(`Error starting subscription grace period: ${stateError.message}`);
            await supabaseClient
              .from("notifications")
              .insert({
                user_id: profile.id,
                type: "payment",
                title: "Falha no pagamento",
                message: "Houve um problema com o pagamento da sua assinatura. Por favor, atualize sua forma de pagamento.",
              });

            console.log("Payment failure notification sent");
          }
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
        if (paymentIntentId && charge.amount_refunded > 0) {
          const { error } = await supabaseClient.rpc("reverse_content_sale_v1", {
            p_payment_intent_id: paymentIntentId,
            p_reversal_type: "refund",
            p_reversed_gross_amount: charge.amount_refunded / 100,
            p_stripe_event_id: event.id,
          });
          if (error) throw new Error(`Content refund failed: ${error.message}`);
        }
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        const charge = typeof dispute.charge === "string"
          ? await stripe.charges.retrieve(dispute.charge)
          : dispute.charge;
        const paymentIntentId = typeof charge?.payment_intent === "string"
          ? charge.payment_intent
          : charge?.payment_intent?.id;
        if (paymentIntentId) {
          const { error } = await supabaseClient.rpc("reverse_content_sale_v1", {
            p_payment_intent_id: paymentIntentId,
            p_reversal_type: "chargeback",
            p_reversed_gross_amount: dispute.amount / 100,
            p_stripe_event_id: event.id,
          });
          if (error) throw new Error(`Content chargeback failed: ${error.message}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Webhook error:", error);
    if (eventRecorded && event?.id) {
      const { error: deleteError } = await supabaseClient
        .from("stripe_events_processed")
        .delete()
        .eq("event_id", event.id);

      if (deleteError) {
        console.error("Failed to release failed Stripe event for retry:", deleteError);
      }
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});

// Helper to record revenue in revenue_entries table (idempotente por source_id)
async function recordRevenue(
  supabase: any,
  params: {
    revenue_type: string;
    amount: number;
    source_id?: string;
    user_id?: string;
    metadata?: Record<string, unknown>;
    payment_fee_amount?: number;
    tax_amount?: number;
    creator_amount?: number;
  }
) {
  const { error } = await supabase.rpc("record_revenue_entry_v1", {
    p_revenue_type: params.revenue_type,
    p_gross_amount: params.amount,
    p_source_id: params.source_id || null,
    p_user_id: params.user_id || null,
    p_metadata: params.metadata || {},
    p_is_pool_eligible: true,
    p_payment_fee_amount: params.payment_fee_amount || 0,
    p_tax_amount: params.tax_amount || 0,
    p_creator_amount: params.creator_amount || 0,
  });
  if (error) throw new Error(`Error recording revenue: ${error.message}`);
}

async function getPaymentCosts(stripe: Stripe, paymentIntentId: string | null) {
  if (!paymentIntentId) return { paymentFee: 0 };
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    const balanceTransaction = charge && typeof charge.balance_transaction === "object"
      ? charge.balance_transaction
      : null;
    return { paymentFee: balanceTransaction?.fee ? balanceTransaction.fee / 100 : 0 };
  } catch (error) {
    console.warn("Could not resolve Stripe fee; revenue remains explicit with zero fee", error);
    return { paymentFee: 0 };
  }
}

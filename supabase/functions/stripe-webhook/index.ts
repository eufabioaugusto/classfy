import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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

  try {
    const body = await req.text();
    
    let event: Stripe.Event;
    if (webhookSecret && signature) {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } else {
      event = JSON.parse(body);
    }

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
      console.error('Error recording stripe event:', dedupError);
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        
        // Handle boost purchase
        if (session.mode === "payment" && session.metadata?.boost_id) {
          const boostId = session.metadata.boost_id;
          const totalBudget = session.amount_total ? session.amount_total / 100 : 0;
          
          console.log("[WEBHOOK] Boost payment completed:", { boostId, totalBudget });

          // Activate boost
          try {
            await supabaseClient.functions.invoke('activate-boost', {
              body: {
                boostId,
                paymentIntentId: session.payment_intent as string,
              }
            });
            console.log("Boost activated successfully");
          } catch (activateErr) {
            console.error("Error activating boost:", activateErr);
          }

          // Record boost revenue
          if (totalBudget > 0) {
            await recordRevenue(supabaseClient, {
              revenue_type: 'boost',
              amount: totalBudget,
              source_id: session.payment_intent as string,
              user_id: session.metadata.user_id,
              metadata: { boost_id: boostId, total_budget: totalBudget },
            });
          }
        }
        
        // Handle content purchase
        if (session.mode === "payment" && session.metadata?.content_id) {
          const pricePaid = parseFloat(session.metadata.price_paid);
          
          const { error } = await supabaseClient
            .from("purchased_contents")
            .upsert({
              user_id: session.metadata.user_id,
              content_id: session.metadata.content_id,
              price_paid: pricePaid,
              discount_applied: parseFloat(session.metadata.discount_applied),
            }, {
              onConflict: "user_id,content_id"
            });

          if (error) {
            console.error("Error recording purchase:", error);
          } else {
            console.log("Purchase recorded successfully");
            
            // Record revenue: platform takes 20% commission on content sales
            const platformCommission = pricePaid * 0.20;
            await recordRevenue(supabaseClient, {
              revenue_type: 'content_purchase',
              amount: platformCommission,
              source_id: session.payment_intent as string,
              user_id: session.metadata.user_id,
              metadata: { 
                content_id: session.metadata.content_id,
                total_price: pricePaid,
                commission_rate: 0.20,
              },
            });
          }
        }
        
        // Handle subscription
        if (session.mode === "subscription" && session.metadata?.user_id) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          
          const productId = subscription.items.data[0].price.product as string;
          const productToPlan: Record<string, string> = {
            "prod_TTH0TCgKCJn5QS": "pro",
            "prod_TTH12wU8lOauHD": "premium",
          };
          
          const planType = productToPlan[productId] || session.metadata.plan_type || "pro";
          const subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();

          console.log("[WEBHOOK] Subscription checkout completed:", {
            userId: session.metadata.user_id,
            productId,
            planType,
            subscriptionEnd,
          });

          const { error } = await supabaseClient
            .from("profiles")
            .update({
              plan: planType,
              plan_expires_at: subscriptionEnd,
              billing_id: session.customer as string,
            })
            .eq("id", session.metadata.user_id);

          if (error) {
            console.error("Error updating subscription:", error);
          } else {
            console.log("Subscription activated successfully");
            
            // Record subscription revenue
            const subscriptionAmount = session.amount_total ? session.amount_total / 100 : 0;
            const revenueType = planType === 'premium' ? 'subscription_premium' : 'subscription_pro';
            await recordRevenue(supabaseClient, {
              revenue_type: revenueType,
              amount: subscriptionAmount,
              source_id: session.subscription as string,
              user_id: session.metadata.user_id,
              metadata: { plan_type: planType, product_id: productId },
            });
          }
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
          const isActive = subscription.status === "active";
          
          const productId = subscription.items.data[0]?.price?.product as string;
          const productToPlan: Record<string, string> = {
            "prod_TTH0TCgKCJn5QS": "pro",
            "prod_TTH12wU8lOauHD": "premium",
          };
          
          const planType = isActive ? (productToPlan[productId] || subscription.metadata?.plan_type || "pro") : "free";
          const subscriptionEnd = isActive 
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null;

          console.log("[WEBHOOK] Subscription updated/deleted:", {
            userId: profile.id,
            productId,
            planType,
            isActive,
            subscriptionEnd,
          });

          const { error } = await supabaseClient
            .from("profiles")
            .update({
              plan: planType,
              plan_expires_at: subscriptionEnd,
            })
            .eq("id", profile.id);

          if (error) {
            console.error("Error updating subscription status:", error);
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
            const subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();

            const { error } = await supabaseClient
              .from("profiles")
              .update({
                plan_expires_at: subscriptionEnd,
              })
              .eq("id", profile.id);

            if (error) {
              console.error("Error updating subscription period:", error);
            } else {
              console.log("Subscription renewed successfully");
              
              // Record renewal revenue
              const invoiceAmount = invoice.amount_paid ? invoice.amount_paid / 100 : 0;
              if (invoiceAmount > 0) {
                const productId = subscription.items.data[0]?.price?.product as string;
                const revenueType = productId === "prod_TTH12wU8lOauHD" ? 'subscription_premium' : 'subscription_pro';
                await recordRevenue(supabaseClient, {
                  revenue_type: revenueType,
                  amount: invoiceAmount,
                  source_id: invoice.id,
                  user_id: profile.id,
                  metadata: { renewal: true, invoice_id: invoice.id },
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

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Webhook error:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});

// Helper to record revenue in revenue_entries table (idempotente por source_id)
async function recordRevenue(
  supabase: ReturnType<typeof createClient>,
  params: {
    revenue_type: string;
    amount: number;
    source_id?: string;
    user_id?: string;
    metadata?: Record<string, any>;
  }
) {
  try {
    const now = new Date();
    const year_month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const { error } = await supabase
      .from('revenue_entries')
      .insert({
        year_month,
        revenue_type: params.revenue_type,
        amount: params.amount,
        source_id: params.source_id || null,
        user_id: params.user_id || null,
        metadata: params.metadata || {},
      });

    if (error) {
      // unique_violation = source_id já registrado (retry do webhook) — ignorar silenciosamente
      if ((error as any).code === '23505') {
        console.log('Revenue already recorded for source_id:', params.source_id, '— skipping.');
        return;
      }
      console.error('Error recording revenue:', error);
    } else {
      console.log('Revenue recorded:', { type: params.revenue_type, amount: params.amount, year_month });
    }
  } catch (err) {
    console.error('Failed to record revenue:', err);
  }
}

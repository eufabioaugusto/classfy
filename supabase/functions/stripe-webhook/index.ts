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
    
    // Verify webhook signature
    let event: Stripe.Event;
    if (webhookSecret && signature) {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } else {
      event = JSON.parse(body);
    }

    console.log(`Received event: ${event.type}`);

    // Handle different event types
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        
        // Handle content purchase
        if (session.mode === "payment" && session.metadata?.content_id) {
          const { error } = await supabaseClient
            .from("purchased_contents")
            .upsert({
              user_id: session.metadata.user_id,
              content_id: session.metadata.content_id,
              price_paid: parseFloat(session.metadata.price_paid),
              discount_applied: parseFloat(session.metadata.discount_applied),
            }, {
              onConflict: "user_id,content_id"
            });

          if (error) {
            console.error("Error recording purchase:", error);
          } else {
            console.log("Purchase recorded successfully");
          }
        }
        
        // Handle subscription
        if (session.mode === "subscription" && session.metadata?.user_id) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          const planType = session.metadata.plan_type || "pro";
          const subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();

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
          }
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Find user by billing_id
        const { data: profile } = await supabaseClient
          .from("profiles")
          .select("id")
          .eq("billing_id", customerId)
          .single();

        if (profile) {
          const isActive = subscription.status === "active";
          const planType = isActive ? (subscription.metadata?.plan_type || "pro") : "free";
          const subscriptionEnd = isActive 
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null;

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
        
        // Only process subscription invoices
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
            // Create notification about failed payment
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

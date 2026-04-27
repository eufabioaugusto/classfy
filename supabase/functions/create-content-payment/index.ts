import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { getOrCreateStripeCustomer, getRequestOrigin } from "../_shared/stripe-subscription.ts";

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

    const { contentId } = await req.json();

    if (!contentId) {
      throw new Error("Missing required fields");
    }

    // Get content details
    const { data: content, error: contentError } = await supabaseClient
      .from('contents')
      .select('title, price, discount, visibility, status')
      .eq('id', contentId)
      .maybeSingle();

    if (contentError) throw contentError;
    if (!content) throw new Error('Content not found');
    if (content.status !== "approved") throw new Error("Content is not available for purchase");
    if (content.visibility !== "paid") throw new Error("Content is not configured as paid");

    const price = Number(content.price || 0);
    const discount = Number(content.discount || 0);
    const finalPrice = price * (1 - discount / 100);

    if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
      throw new Error("Invalid content price");
    }

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const origin = getRequestOrigin(req);
    const customerId = await getOrCreateStripeCustomer(stripe, supabaseClient, {
      id: user.id,
      email: user.email,
    });

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: content.title,
              description: "Acesso vitalício ao conteúdo",
            },
            unit_amount: Math.round(finalPrice * 100), // Convert to centavos
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${origin}/watch/${contentId}?purchase=success`,
      cancel_url: `${origin}/watch/${contentId}?purchase=canceled`,
      metadata: {
        content_id: contentId,
        user_id: user.id,
        original_price: price.toString(),
        discount_applied: (discount || 0).toString(),
        price_paid: finalPrice.toString(),
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

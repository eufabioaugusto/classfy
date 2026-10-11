import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  findBillableSubscription,
  getOrCreateStripeCustomer,
  getRequestOrigin,
  isSubscriptionPlan,
} from "../_shared/stripe-subscription.ts";
import {
  createWebSubscriptionCheckoutService,
  WebCheckoutError,
  type WebCheckoutStripe,
} from "../_shared/web-subscription-checkout.ts";
import { createWebCheckoutRepository } from "../_shared/web-checkout-repository.ts";

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

  let ownedLease: { owner: string; token: string } | undefined;
  const repository = createWebCheckoutRepository(supabaseClient);
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

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
      timeout: 20_000,
      maxNetworkRetries: 1,
    });

    const lease = crypto.randomUUID();
    if (!await repository.claim(user.id, lease)) {
      throw new WebCheckoutError(
        "checkout_busy",
        "Uma operação de assinatura está em andamento. Tente novamente em instantes.",
        409,
      );
    }
    ownedLease = { owner: user.id, token: lease };
    const origin = getRequestOrigin(req);
    const customerId = await getOrCreateStripeCustomer(stripe, supabaseClient, {
      id: user.id,
      email: user.email,
    });

    const existingSubscription = await findBillableSubscription(
      stripe,
      customerId,
    );
    if (existingSubscription) {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/conta`,
      });

      return new Response(
        JSON.stringify({ url: portalSession.url, mode: "portal" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    // URL contract stays unchanged; both entry points reserve the same durable
    // owner ledger BEFORE creating a session. Unknown replies reuse exact params.
    const service = createWebSubscriptionCheckoutService({
      repository,
      stripe: stripe as unknown as WebCheckoutStripe,
      publishableKey: "",
      returnOrigin: origin,
      uiMode: "hosted",
    });
    const result = await service.execute({ id: user.id, email: user.email }, {
      action: "prepare",
      plan,
      operationId: crypto.randomUUID(),
    }, lease);
    if (!result.url) {
      throw new WebCheckoutError(
        "checkout_in_progress",
        result.message ||
          "Há um pagamento em andamento. Conclua ou cancele antes de iniciar outro.",
        409,
      );
    }
    return new Response(
      JSON.stringify({ url: result.url, mode: result.mode }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const errorMessage = error instanceof WebCheckoutError
      ? error.message
      : "Não foi possível abrir o pagamento. Confira o estado da assinatura e tente novamente.";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: error instanceof WebCheckoutError ? error.status : 500,
    });
  } finally {
    if (ownedLease) {
      try {
        await repository.release(ownedLease.owner, ownedLease.token);
      } catch {
        /* Expiring lease fences retries without masking the result. */
      }
    }
  }
});

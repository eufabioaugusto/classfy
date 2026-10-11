import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  createSubscriptionBillingService,
  SUBSCRIPTION_BILLING_API_VERSION,
  SubscriptionBillingError,
  type SubscriptionBillingStripe,
} from "../_shared/subscription-billing.ts";
import {
  createSubscriptionBillingFetch,
  createSubscriptionBillingHandler,
} from "../_shared/subscription-billing-http.ts";

const boundedFetch = createSubscriptionBillingFetch(fetch);
serve(async (req) => {
  // Inicialização lazy: OPTIONS e chamadas sem Bearer não exigem Stripe ativo.
  let supabase: ReturnType<typeof createClient> | undefined;
  const client = () =>
    supabase ??= createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: boundedFetch },
      },
    );
  return await createSubscriptionBillingHandler({
    authenticate: async (token) => {
      const { data: { user }, error } = await client().auth.getUser(token);
      return !error && user?.id ? user.id : null;
    },
    read: async (owner, body) => {
      const secret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
      if (!/^sk_(test|live)_/.test(secret)) {
        throw new SubscriptionBillingError(
          "billing_not_configured",
          "A consulta de cobrança não está configurada.",
          503,
        );
      }
      const stripe = new Stripe(secret, {
        apiVersion: SUBSCRIPTION_BILLING_API_VERSION,
        timeout: 20_000,
        maxNetworkRetries: 1,
      });
      const service = createSubscriptionBillingService({
        stripe: stripe as unknown as SubscriptionBillingStripe,
        cursorSecret: secret,
        profile: async (id) => {
          const { data, error } = await client().from("profiles").select(
            "billing_id",
          ).eq("id", id).maybeSingle();
          if (error) {
            throw new SubscriptionBillingError(
              "billing_state_unavailable",
              "Não foi possível consultar sua conta agora. Tente novamente.",
              503,
            );
          }
          return data;
        },
      });
      return await service.read(owner, body);
    },
  })(req);
});

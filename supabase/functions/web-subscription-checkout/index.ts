import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  createWebSubscriptionCheckoutService,
  WEB_CHECKOUT_API_VERSION,
  WebCheckoutError,
  type WebCheckoutStripe,
} from "../_shared/web-subscription-checkout.ts";
import { createWebCheckoutRepository } from "../_shared/web-checkout-repository.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const deadlineFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const source = init?.signal;
  const abort = () => controller.abort(source?.reason);
  source?.addEventListener("abort", abort, { once: true });
  if (source?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      new Promise<Response>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new WebCheckoutError(
              "network_timeout",
              "A confirmação está demorando. Confira o estado do pagamento antes de tentar novamente.",
              504,
            ),
          );
        }, 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    source?.removeEventListener("abort", abort);
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return response({
      code: "method_not_allowed",
      error: "Método não permitido.",
    }, 405);
  }
  try {
    const secret = Deno.env.get("STRIPE_SECRET_KEY") ?? "",
      publishableKey = Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? "";
    if (
      !/^sk_(test|live)_/.test(secret) ||
      !/^pk_(test|live)_/.test(publishableKey) ||
      secret.split("_")[1] !== publishableKey.split("_")[1]
    ) {
      throw new WebCheckoutError(
        "checkout_not_configured",
        "O pagamento integrado ainda não está configurado.",
        503,
      );
    }
    const origin = new URL(Deno.env.get("APP_URL") || "https://classfy.com.br");
    if (
      origin.protocol !== "https:" &&
      !(origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname))
    ) {
      throw new WebCheckoutError(
        "checkout_not_configured",
        "O endereço de retorno do pagamento não está configurado.",
        503,
      );
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: deadlineFetch },
      },
    );
    const authorization = req.headers.get("Authorization") ?? "";
    if (!/^Bearer\s+\S+$/i.test(authorization)) {
      throw new WebCheckoutError(
        "unauthorized",
        "Entre na sua conta para continuar.",
        401,
      );
    }
    const { data: { user }, error } = await supabase.auth.getUser(
      authorization.replace(/^Bearer\s+/i, ""),
    );
    if (error || !user?.id || !user.email) {
      throw new WebCheckoutError(
        "unauthorized",
        "Sua sessão expirou. Entre novamente.",
        401,
      );
    }
    const repository = createWebCheckoutRepository(supabase);
    const stripe = new Stripe(secret, {
      apiVersion: WEB_CHECKOUT_API_VERSION,
      timeout: 20_000,
      maxNetworkRetries: 1,
    });
    const service = createWebSubscriptionCheckoutService({
      repository,
      stripe: stripe as unknown as WebCheckoutStripe,
      publishableKey,
      returnOrigin: origin.origin,
    });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new WebCheckoutError(
        "invalid_request",
        "Solicitação inválida.",
        400,
      );
    }
    return response(
      await service.execute({ id: user.id, email: user.email }, body),
    );
  } catch (error) {
    if (error instanceof WebCheckoutError) {
      return response({ code: error.code, error: error.message }, error.status);
    }
    // Never echo SDK errors, request bodies, customer details or client secrets.
    const kind = (error as { type?: string })?.type;
    return response({
      code: kind === "StripeCardError"
        ? "payment_failed"
        : "checkout_unavailable",
      error: kind === "StripeCardError"
        ? "O cartão não autorizou o pagamento. Confira os dados e tente novamente."
        : "Não foi possível concluir esta etapa. Confira o estado do pagamento antes de tentar novamente.",
    }, kind === "StripeCardError" ? 402 : 503);
  }
});

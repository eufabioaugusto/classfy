import {
  SubscriptionBillingError,
  type SubscriptionBillingResult,
} from "./subscription-billing.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export function createSubscriptionBillingHandler(deps: {
  authenticate(token: string): Promise<string | null>;
  read(owner: string, body: unknown): Promise<SubscriptionBillingResult>;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") {
      return response({
        code: "method_not_allowed",
        error: "Método não permitido.",
      }, 405);
    }
    try {
      const authorization = req.headers.get("Authorization") ?? "";
      if (!/^Bearer\s+\S+$/i.test(authorization)) {
        throw new SubscriptionBillingError(
          "unauthorized",
          "Entre na sua conta para consultar a cobrança.",
          401,
        );
      }
      const owner = await deps.authenticate(
        authorization.replace(/^Bearer\s+/i, ""),
      );
      if (!owner) {
        throw new SubscriptionBillingError(
          "unauthorized",
          "Sua sessão expirou. Entre novamente.",
          401,
        );
      }
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw new SubscriptionBillingError(
          "invalid_request",
          "Solicitação inválida.",
          400,
        );
      }
      return response(await deps.read(owner, body));
    } catch (error) {
      if (error instanceof SubscriptionBillingError) {
        return response(
          { code: error.code, error: error.message },
          error.status,
        );
      }
      // Erros do SDK não atravessam a fronteira: podem carregar URLs, request IDs
      // ou dados de cobrança. Nenhum token, email ou objeto Stripe é logado.
      return response({
        code: "billing_unavailable",
        error:
          "Não foi possível consultar sua cobrança agora. Tente novamente.",
      }, 503);
    }
  };
}

export function createSubscriptionBillingFetch(
  baseFetch: typeof fetch,
  timeoutMs = 20_000,
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const source = init?.signal ??
      (input instanceof Request ? input.signal : undefined);
    let rejectAbort!: (error: unknown) => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const abort = () => {
      controller.abort(source?.reason);
      rejectAbort(
        new SubscriptionBillingError(
          "request_canceled",
          "A consulta de cobrança foi interrompida.",
          499,
        ),
      );
    };
    source?.addEventListener("abort", abort, { once: true });
    if (source?.aborted) abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        baseFetch(input, { ...init, signal: controller.signal }),
        aborted,
        new Promise<Response>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new SubscriptionBillingError(
                "network_timeout",
                "A consulta está demorando. Tente novamente em instantes.",
                504,
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      source?.removeEventListener("abort", abort);
    }
  };
}

import { MobileSubscriptionError } from "./mobile-subscription.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
async function readBody(req: Request): Promise<unknown> {
  const body = await req.text();
  if (body.length > 120_000) {
    throw new MobileSubscriptionError(
      "invalid_request",
      "Solicitação inválida.",
      400,
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new MobileSubscriptionError(
      "invalid_request",
      "Solicitação inválida.",
      400,
    );
  }
}
function failure(error: unknown): Response {
  if (error instanceof MobileSubscriptionError) {
    return json({ code: error.code, error: error.message }, error.status);
  }
  // Purchase tokens, signing keys and upstream URLs never cross the HTTP boundary or logs.
  return json({
    code: "store_unavailable",
    error: "Não foi possível verificar a assinatura agora. Tente novamente.",
  }, 503);
}
export function createMobileSubscriptionHandler(deps: {
  authenticate(token: string): Promise<string | null>;
  read(userId: string, body: unknown): Promise<unknown>;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return json({ code: "method_not_allowed" }, 405);
    try {
      const authorization = req.headers.get("Authorization") ?? "";
      if (!/^Bearer\s+\S+$/i.test(authorization)) {
        throw new MobileSubscriptionError(
          "unauthorized",
          "Entre na sua conta.",
          401,
        );
      }
      const user = await deps.authenticate(
        authorization.replace(/^Bearer\s+/i, ""),
      );
      if (!user) {
        throw new MobileSubscriptionError(
          "unauthorized",
          "Sua sessão expirou. Entre novamente.",
          401,
        );
      }
      return json(await deps.read(user, await readBody(req)));
    } catch (error) {
      return failure(error);
    }
  };
}
export function createMobileNotificationHandler(
  receive: (authorization: string, body: unknown) => Promise<unknown>,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ code: "method_not_allowed" }, 405);
    try {
      return json(
        await receive(
          req.headers.get("Authorization") ?? "",
          await readBody(req),
        ),
      );
    } catch (error) {
      return failure(error);
    }
  };
}

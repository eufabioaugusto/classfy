import {
  assertStoreEnvironment,
  createMobileSubscriptionService,
  MOBILE_APP_ID,
  type MobileStoreConfig,
  type MobileStoreVerifier,
  MobileSubscriptionError,
  type MobileSubscriptionSyncResult,
  normalizeAppleSubscription,
  normalizeGoogleSubscription,
  parseMobileRequest,
  platformConfigured,
  purchaseTokenHash,
  readMobileStoreConfig,
  type StoreSubscription,
} from "./mobile-subscription.ts";
import {
  createMobileNotificationHandler,
  createMobileSubscriptionHandler,
} from "./mobile-subscription-http.ts";
import { createMobileSubscriptionRepository } from "./mobile-subscription-repository.ts";
import {
  createMobileStoreVerifier,
  verifyGooglePushIdentity,
} from "./mobile-subscription-store-verifiers.ts";
import {
  createLocalJWKSet,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from "npm:jose@6.2.12";

const user = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const NOW = 1_800_000_000_000;
const end = new Date(NOW + 86_400_000).toISOString();
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Esperado ${JSON.stringify(expected)}, recebido ${
        JSON.stringify(actual)
      }`,
    );
  }
}
async function rejects(work: Promise<unknown> | (() => unknown), code: string) {
  try {
    if (typeof work === "function") work();
    else await work;
  } catch (error) {
    equal((error as MobileSubscriptionError).code, code);
    return;
  }
  throw new Error("Esperava rejeição");
}
const config = (): MobileStoreConfig => ({
  appleEnabled: true,
  googleEnabled: true,
  appleEnvironment: "Production",
  appleKeyId: "FIXTUREKEY",
  appleIssuerId: "fixture-issuer",
  applePrivateKey: "fixture-key",
  appleAppId: 123456,
  googleServiceAccountJson: JSON.stringify({
    type: "service_account",
    client_email: "fixture@example.invalid",
    private_key: "fixture-key",
  }),
  googleOidcAudience: "https://classfy.invalid/callback",
  googleOidcServiceEmail: "push@example.invalid",
  sandboxUsers: new Set(),
});
const apple = () => ({
  originalTransactionId: "10001",
  transactionId: "10002",
  appAccountToken: user,
  bundleId: MOBILE_APP_ID,
  productId: "br.com.classfy.pro.monthly",
  environment: "Production",
  type: "Auto-Renewable Subscription",
  inAppOwnershipType: "PURCHASED",
  expiresDate: NOW + 86_400_000,
  signedDate: NOW,
});
const renewal = () => ({
  originalTransactionId: "10001",
  environment: "Production",
  autoRenewStatus: 1,
  signedDate: NOW,
});
const google = (): Record<string, any> => ({
  subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
  acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
  externalAccountIdentifiers: { obfuscatedExternalAccountId: user },
  lineItems: [{
    productId: "classfy_pro",
    expiryTime: end,
    offerDetails: { basePlanId: "monthly" },
    autoRenewingPlan: { autoRenewEnabled: true },
  }],
});
const snapshot = (): StoreSubscription => ({
  platform: "google",
  userId: user,
  originalId: "fixture-hash",
  productId: "classfy_pro",
  plan: "pro",
  status: "active",
  periodEnd: end,
  autoRenew: true,
  eventId: "fixture-event",
  eventAt: new Date(NOW).toISOString(),
  environment: "Production",
  purchaseToken: "fixture-token",
  acknowledgementPending: true,
});
function fixture() {
  const effects = {
    synced: 0,
    verified: 0,
    acknowledged: 0,
    acknowledgementFails: false,
    allowed: true,
    enabled: true,
    authenticated: false,
  };
  let result = snapshot();
  let syncResult: MobileSubscriptionSyncResult = {
    plan: "pro",
    status: "active",
    subscriptionEnd: end,
    entitlementSource: "google",
  };
  const verifier: MobileStoreVerifier = {
    configured: () => effects.enabled,
    apple: async () => {
      effects.verified++;
      return result;
    },
    google: async () => {
      effects.verified++;
      return result;
    },
    appleNotification: async () => {
      effects.verified++;
      return result;
    },
    googleNotificationAuth: async (authorization) => {
      if (authorization !== "Bearer signed-fixture") {
        throw new MobileSubscriptionError(
          "invalid_notification_auth",
          "Falha",
          401,
        );
      }
      effects.authenticated = true;
    },
    acknowledgeGoogle: async () => {
      effects.acknowledged++;
      if (effects.acknowledgementFails) {
        throw new MobileSubscriptionError(
          "store_acknowledgement_failed",
          "Falha",
          503,
        );
      }
    },
  };
  const service = createMobileSubscriptionService(verifier, {
    purchaseAllowed: async () => effects.allowed,
    sync: async () => {
      effects.synced++;
      return syncResult;
    },
  }, () => NOW);
  return {
    effects,
    service,
    setSnapshot: (value: StoreSubscription) => result = value,
    setSyncResult: (value: Partial<MobileSubscriptionSyncResult>) =>
      syncResult = { ...syncResult, ...value },
  };
}
const verifyBody = {
  action: "verify",
  platform: "google",
  productId: "classfy_pro",
  purchaseToken: "fixture-token",
};
async function verifyFixture(f: ReturnType<typeof fixture>) {
  const response = await f.service.read(user, verifyBody);
  if (!("verified" in response)) {
    throw new Error("Resposta de verificação esperada");
  }
  return response;
}

Deno.test("mobile: lojas ficam desativadas por padrão e chave isolada não ativa compras", () => {
  const empty = readMobileStoreConfig(() => undefined);
  equal(platformConfigured(empty, "apple"), false);
  equal(platformConfigured(empty, "google"), false);
  equal(
    platformConfigured({ ...config(), appleEnabled: false }, "apple"),
    false,
  );
  equal(
    platformConfigured({ ...config(), appleAppId: undefined }, "apple"),
    false,
  );
  equal(
    platformConfigured(
      { ...config(), googleServiceAccountJson: "malformed" },
      "google",
    ),
    false,
  );
});
Deno.test("mobile: catálogo indisponível não oferece produtos", async () => {
  const f = fixture();
  f.effects.enabled = false;
  equal(await f.service.read(user, { action: "catalog", platform: "apple" }), {
    enabled: false,
    products: [],
    reason: "store_not_configured",
  });
  await rejects(f.service.read(user, verifyBody), "store_unavailable");
  equal(f.effects.verified, 0);
  equal(f.effects.synced, 0);
});
Deno.test("mobile: catálogo bloqueia uma assinatura de outro provedor", async () => {
  const f = fixture();
  f.effects.allowed = false;
  equal(await f.service.read(user, { action: "catalog", platform: "google" }), {
    enabled: false,
    products: [],
    reason: "subscription_managed_elsewhere",
  });
});
Deno.test("mobile: recusa produto externo, store desconhecida e identificadores inválidos", async () => {
  await rejects(
    () => parseMobileRequest({ ...verifyBody, productId: "unrelated" }),
    "invalid_store_purchase",
  );
  await rejects(
    () => parseMobileRequest({ ...verifyBody, platform: "stripe" }),
    "invalid_store_purchase",
  );
  await rejects(
    () =>
      parseMobileRequest({
        action: "verify",
        platform: "apple",
        productId: "br.com.classfy.pro.monthly",
        transactionId: "../",
      }),
    "invalid_store_purchase",
  );
  await rejects(
    () =>
      parseMobileRequest({ ...verifyBody, purchaseToken: "x".repeat(4097) }),
    "invalid_store_purchase",
  );
});
Deno.test("Apple: compra confirmada renova plano e titularidade", () => {
  const state = normalizeAppleSubscription(
    apple(),
    renewal(),
    1,
    config(),
    NOW,
    user,
  );
  equal([state.userId, state.plan, state.status, state.periodEnd], [
    user,
    "pro",
    "active",
    end,
  ]);
});
Deno.test("Apple: cancelamento conserva o período já pago", () => {
  equal(
    normalizeAppleSubscription(
      apple(),
      { ...renewal(), autoRenewStatus: 0 },
      1,
      config(),
      NOW,
    ).status,
    "canceled",
  );
});
Deno.test("Apple: revogação prevalece mesmo com validade futura", () => {
  equal(
    normalizeAppleSubscription(
      { ...apple(), revocationDate: NOW },
      renewal(),
      1,
      config(),
      NOW,
    ).status,
    "revoked",
  );
});
Deno.test("Apple: billing retry sem carência bloqueia acesso mesmo com prazo futuro", () => {
  equal(
    normalizeAppleSubscription(apple(), renewal(), 3, config(), NOW).status,
    "paused",
  );
});
Deno.test("Apple: carência usa prazo fornecido pela Apple", () => {
  const grace = NOW + 2 * 86_400_000;
  equal(
    normalizeAppleSubscription(
      { ...apple(), expiresDate: NOW - 1 },
      { ...renewal(), gracePeriodExpiresDate: grace },
      4,
      config(),
      NOW,
    ).periodEnd,
    new Date(grace).toISOString(),
  );
});
Deno.test("Apple: recusa outro dono, bundle, produto, compra compartilhada e token sem dono", async () => {
  await rejects(
    () =>
      normalizeAppleSubscription(apple(), renewal(), 1, config(), NOW, other),
    "purchase_owned_by_another_account",
  );
  for (
    const change of [
      { bundleId: "other.app" },
      { productId: "other.product" },
      { inAppOwnershipType: "FAMILY_SHARED" },
      { appAccountToken: undefined },
      { isUpgraded: true },
      { type: "Consumable" },
    ]
  ) {
    await rejects(
      () =>
        normalizeAppleSubscription(
          { ...apple(), ...change },
          renewal(),
          1,
          config(),
          NOW,
        ),
      "invalid_store_purchase",
    );
  }
});
Deno.test("Apple: sandbox e Xcode local não liberam plano de produção", async () => {
  await rejects(
    () =>
      normalizeAppleSubscription(
        { ...apple(), environment: "Sandbox" },
        { ...renewal(), environment: "Sandbox" },
        1,
        config(),
        NOW,
      ),
    "store_environment_not_allowed",
  );
  await rejects(
    () => assertStoreEnvironment("Xcode", "Production", user, new Set([user])),
    "store_environment_not_allowed",
  );
  const sandbox = { ...config(), appleEnvironment: "Sandbox" as const };
  await rejects(
    () =>
      normalizeAppleSubscription(
        { ...apple(), environment: "Sandbox" },
        { ...renewal(), environment: "Sandbox" },
        1,
        sandbox,
        NOW,
      ),
    "store_environment_not_allowed",
  );
  equal(
    normalizeAppleSubscription(
      { ...apple(), environment: "Sandbox" },
      { ...renewal(), environment: "Sandbox" },
      1,
      { ...sandbox, sandboxUsers: new Set([user]) },
      NOW,
    ).environment,
    "Sandbox",
  );
});
Deno.test("Google: token opaco é hasheado e substituição identifica token anterior", async () => {
  const state = await normalizeGoogleSubscription(
    { ...google(), linkedPurchaseToken: "previous-token" },
    "current-token",
    config(),
    NOW,
    user,
  );
  equal(state.originalId, await purchaseTokenHash("current-token"));
  equal(state.replacedOriginalId, await purchaseTokenHash("previous-token"));
  equal(state.acknowledgementPending, true);
});
Deno.test("Google: pendência sem expiry não libera e informa aguardar", async () => {
  const pending = google();
  pending.subscriptionState = "SUBSCRIPTION_STATE_PENDING";
  delete pending.lineItems[0].expiryTime;
  await rejects(
    normalizeGoogleSubscription(pending, "token", config(), NOW),
    "purchase_pending",
  );
});
Deno.test("Google: recusa outro dono, base plan, prepaid e produto alheio", async () => {
  await rejects(
    normalizeGoogleSubscription(google(), "token", config(), NOW, other),
    "purchase_owned_by_another_account",
  );
  for (
    const change of [{ offerDetails: { basePlanId: "annual" } }, {
      prepaidPlan: {},
    }, { productId: "other-product" }]
  ) {
    const purchase = google();
    Object.assign(purchase.lineItems[0], change);
    await rejects(
      normalizeGoogleSubscription(purchase, "token", config(), NOW),
      "invalid_store_purchase",
    );
  }
});
Deno.test("Google: falta saldo/on hold e pausa não concedem acesso futuro", async () => {
  for (
    const status of ["SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PAUSED"]
  ) {
    const purchase = { ...google(), subscriptionState: status };
    const state = await normalizeGoogleSubscription(
      purchase,
      "token",
      config(),
      NOW,
    );
    equal([state.status, state.acknowledgementPending], ["paused", false]);
  }
});
Deno.test("Google: cancelamento preserva validade e expiração encerra", async () => {
  equal(
    (await normalizeGoogleSubscription(
      { ...google(), subscriptionState: "SUBSCRIPTION_STATE_CANCELED" },
      "token",
      config(),
      NOW,
    )).status,
    "canceled",
  );
  const expired = google();
  expired.lineItems[0].expiryTime = new Date(NOW - 1).toISOString();
  equal(
    (await normalizeGoogleSubscription(expired, "token", config(), NOW)).status,
    "expired",
  );
});
Deno.test("Google: compra de licença exige usuário explicitamente permitido", async () => {
  await rejects(
    normalizeGoogleSubscription(
      { ...google(), testPurchase: {} },
      "token",
      config(),
      NOW,
    ),
    "store_environment_not_allowed",
  );
  equal(
    (await normalizeGoogleSubscription(
      { ...google(), testPurchase: {} },
      "token",
      { ...config(), sandboxUsers: new Set([user]) },
      NOW,
    )).environment,
    "Sandbox",
  );
});
Deno.test("mobile: servidor confirma compra, grava acesso e só então reconhece Google", async () => {
  const f = fixture();
  equal(await f.service.read(user, verifyBody), {
    verified: true,
    plan: "pro",
    subscriptionEnd: end,
    storeAcknowledged: true,
  });
  equal([f.effects.verified, f.effects.synced, f.effects.acknowledged], [
    1,
    1,
    1,
  ]);
});
Deno.test("mobile: estado ignorado ou acesso de outro provedor nunca finaliza compra", async () => {
  for (
    const result of [
      { ignored_stale_event: true },
      { ignored_replaced_subscription: true },
      { entitlementSource: "stripe" },
      { entitlementSource: "apple" },
      { entitlementSource: "" },
      { plan: "free", subscriptionEnd: null },
      { status: "paused" },
      { subscriptionEnd: new Date(NOW - 1).toISOString() },
    ]
  ) {
    const f = fixture();
    f.setSyncResult(result);
    const response = await verifyFixture(f);
    equal(response.verified, false);
    equal(response.storeAcknowledged, false);
    equal(f.effects.acknowledged, 0);
  }
});
Deno.test("mobile: snapshot suspenso, revogado ou vencido não aproveita outro plano ativo", async () => {
  for (const status of ["paused", "revoked", "expired"] as const) {
    const f = fixture();
    f.setSnapshot({ ...snapshot(), status });
    equal((await verifyFixture(f)).verified, false);
    equal(f.effects.acknowledged, 0);
  }
  const f = fixture();
  f.setSnapshot({ ...snapshot(), periodEnd: new Date(NOW - 1).toISOString() });
  equal((await verifyFixture(f)).verified, false);
});
Deno.test("Google: falha no ACK permite retry após RPC idempotente já confirmado", async () => {
  const f = fixture();
  f.effects.acknowledgementFails = true;
  await rejects(
    f.service.read(user, verifyBody),
    "store_acknowledgement_failed",
  );
  f.effects.acknowledgementFails = false;
  f.setSyncResult({ duplicate: true });
  equal((await verifyFixture(f)).storeAcknowledged, true);
  equal([f.effects.synced, f.effects.acknowledged], [2, 2]);
});
Deno.test("Google webhook: evento ignorado não reconhece token antigo", async () => {
  const f = fixture();
  f.setSyncResult({ ignored_replaced_subscription: true });
  await f.service.googleNotification("Bearer signed-fixture", {
    message: {
      messageId: "old-event",
      data: btoa(JSON.stringify({
        packageName: MOBILE_APP_ID,
        subscriptionNotification: { purchaseToken: "fixture-token" },
      })),
    },
  });
  equal([f.effects.synced, f.effects.acknowledged], [1, 0]);
});
Deno.test("mobile: produto e usuário retornados pela loja são reconferidos antes do RPC", async () => {
  const f = fixture();
  f.setSnapshot({ ...snapshot(), userId: other });
  await rejects(
    f.service.read(user, verifyBody),
    "purchase_owned_by_another_account",
  );
  f.setSnapshot({ ...snapshot(), productId: "classfy_premium" });
  await rejects(f.service.read(user, verifyBody), "invalid_store_purchase");
  equal([f.effects.synced, f.effects.acknowledged], [0, 0]);
});
Deno.test("Google webhook: rejeita callback sem autenticação antes de verificar compra", async () => {
  const f = fixture();
  await rejects(
    f.service.googleNotification("", {
      message: { data: "e30=", messageId: "event" },
    }),
    "invalid_notification_auth",
  );
  equal([f.effects.verified, f.effects.synced], [0, 0]);
});
Deno.test("Google webhook: consulta estado atual e usa ID estável de evento", async () => {
  const f = fixture();
  await f.service.googleNotification("Bearer signed-fixture", {
    message: {
      messageId: "event-1",
      data: btoa(
        JSON.stringify({
          packageName: MOBILE_APP_ID,
          subscriptionNotification: {
            purchaseToken: "fixture-token",
            notificationType: 2,
          },
        }),
      ),
    },
  });
  equal([
    f.effects.authenticated,
    f.effects.verified,
    f.effects.synced,
    f.effects.acknowledged,
  ], [true, 1, 1, 1]);
});
Deno.test("Google webhook: outro package não altera plano", async () => {
  const f = fixture();
  await rejects(
    f.service.googleNotification("Bearer signed-fixture", {
      message: {
        messageId: "event",
        data: btoa(
          JSON.stringify({
            packageName: "other.app",
            subscriptionNotification: { purchaseToken: "token" },
          }),
        ),
      },
    }),
    "invalid_store_purchase",
  );
  equal(f.effects.synced, 0);
});
Deno.test("HTTP mobile: sessão inválida não consulta catálogo e erros não expõem token", async () => {
  let called = false;
  const handler = createMobileSubscriptionHandler({
    authenticate: async () => null,
    read: async () => {
      called = true;
    },
  });
  equal(
    (await handler(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { Authorization: "Bearer fake" },
        body: "{}",
      }),
    )).status,
    401,
  );
  equal(called, false);
  const broken = createMobileNotificationHandler(async () => {
    throw new Error("private signing secret/token upstream path");
  });
  const response = await broken(
    new Request("https://example.invalid", { method: "POST", body: "{}" }),
  );
  equal(response.status, 503);
  equal((await response.text()).includes("secret"), false);
});
Deno.test("repository: RPC rejeita reutilização e conflito com outra assinatura", async () => {
  for (
    const [message, code] of [[
      "store_subscription_owner_mismatch",
      "purchase_owned_by_another_account",
    ], ["subscription_provider_conflict", "subscription_managed_elsewhere"]]
  ) {
    const repo = createMobileSubscriptionRepository({
      from: () => null,
      rpc: async () => ({ data: null, error: { message } }),
    });
    await rejects(repo.sync(snapshot()), code);
  }
});
Deno.test("repository: preserva origem e decisões idempotentes retornadas pelo banco", async () => {
  const repo = createMobileSubscriptionRepository({
    from: () => null,
    rpc: async () => ({
      data: {
        plan: "pro",
        status: "active",
        subscriptionEnd: end,
        entitlementSource: "google",
        duplicate: true,
        ignored_stale_event: true,
        ignored_replaced_subscription: true,
      },
      error: null,
    }),
  });
  equal(await repo.sync(snapshot()), {
    plan: "pro",
    status: "active",
    subscriptionEnd: end,
    entitlementSource: "google",
    duplicate: true,
    ignored_stale_event: true,
    ignored_replaced_subscription: true,
  });
});
Deno.test("Apple SDK: rejeita JWS forjado usando roots pinned oficiais", async () => {
  const verifier = createMobileStoreVerifier(config());
  await rejects(
    verifier.appleNotification(
      "eyJhbGciOiJub25lIn0.eyJub3RpZmljYXRpb25UeXBlIjoiVEVTVCJ9.",
    ),
    "invalid_store_purchase",
  );
});
Deno.test("Google OIDC: assinatura, audiência, issuer, email e expiração são validados", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "fixture";
  const localKeys = createLocalJWKSet({ keys: [jwk] });
  const verify =
    ((token: string, _keys: unknown, options: any) =>
      jwtVerify(token, localKeys, options)) as typeof jwtVerify;
  const sign = (
    claims: Record<string, unknown>,
    audience = "https://classfy.invalid/callback",
    issuer = "https://accounts.google.com",
    expiry = "1h",
  ) =>
    new SignJWT({
      email: "push@example.invalid",
      email_verified: true,
      ...claims,
    }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).setSubject(
      "service-account",
    ).setAudience(audience).setIssuer(issuer).setIssuedAt().setExpirationTime(
      expiry,
    ).sign(privateKey);
  await verifyGooglePushIdentity(
    `Bearer ${await sign({})}`,
    "https://classfy.invalid/callback",
    "push@example.invalid",
    verify,
  );
  for (
    const token of [
      await sign({ email: "other@example.invalid" }),
      await sign({ email_verified: false }),
      await sign({}, "other-audience"),
      await sign(
        {},
        "https://classfy.invalid/callback",
        "https://evil.invalid",
      ),
      await sign(
        {},
        "https://classfy.invalid/callback",
        "https://accounts.google.com",
        "-1h",
      ),
    ]
  ) {
    await rejects(
      verifyGooglePushIdentity(
        `Bearer ${token}`,
        "https://classfy.invalid/callback",
        "push@example.invalid",
        verify,
      ),
      "invalid_notification_auth",
    );
  }
});
Deno.test("Google API: verifica package fixo e reconhece após snapshot validado", async () => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const key = await exportPKCS8(privateKey);
  const urls: string[] = [];
  const verifier = createMobileStoreVerifier({
    ...config(),
    googleServiceAccountJson: JSON.stringify({
      type: "service_account",
      client_email: "fixture@example.invalid",
      private_key: key,
    }),
  }, {
    now: () => NOW,
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("oauth2.googleapis.com")) {
        return Response.json({
          access_token: "fixture-access",
          expires_in: 3600,
        });
      }
      if (url.endsWith(":acknowledge")) {
        return new Response(null, { status: 204 });
      }
      return Response.json(google());
    },
  });
  const result = await verifier.google("opaque/with-specials", user);
  await verifier.acknowledgeGoogle(result);
  equal(urls.length, 3);
  equal(
    urls[1].includes(
      `/applications/${MOBILE_APP_ID}/purchases/subscriptionsv2/tokens/opaque%2Fwith-specials`,
    ),
    true,
  );
  equal(urls[2].endsWith("opaque%2Fwith-specials:acknowledge"), true);
});

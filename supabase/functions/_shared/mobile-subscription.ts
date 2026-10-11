export type MobileStore = "apple" | "google";
export type MobilePlan = "pro" | "premium";
export type StoreEnvironment = "Production" | "Sandbox";
export type MobileSubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "expired"
  | "refunded"
  | "revoked"
  | "paused";

export const MOBILE_PRODUCTS = {
  apple: [
    { plan: "pro", productId: "br.com.classfy.pro.monthly" },
    { plan: "premium", productId: "br.com.classfy.premium.monthly" },
  ],
  google: [
    { plan: "pro", productId: "classfy_pro", basePlanId: "monthly" },
    { plan: "premium", productId: "classfy_premium", basePlanId: "monthly" },
  ],
} as const;
export const MOBILE_APP_ID = "br.com.classfy.mobile";
export const MOBILE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MobileSubscriptionError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}
export function invalidStoreProof(): never {
  throw new MobileSubscriptionError(
    "invalid_store_purchase",
    "A loja não confirmou esta assinatura.",
    422,
  );
}
export function storeUnavailable(): never {
  throw new MobileSubscriptionError(
    "store_unavailable",
    "As compras pelo aplicativo ainda não estão disponíveis.",
    503,
  );
}
export function productPlan(
  platform: MobileStore,
  productId: unknown,
): MobilePlan {
  const product = MOBILE_PRODUCTS[platform].find((item) =>
    item.productId === productId
  );
  if (!product) invalidStoreProof();
  return product.plan;
}
export function canonicalStoreOwner(value: unknown): string {
  if (typeof value !== "string" || !MOBILE_UUID.test(value)) {
    invalidStoreProof();
  }
  return value.toLowerCase();
}
export function requireStoreOwner(actual: unknown, expected?: string): string {
  const owner = canonicalStoreOwner(actual);
  if (expected && owner !== canonicalStoreOwner(expected)) {
    throw new MobileSubscriptionError(
      "purchase_owned_by_another_account",
      "Esta assinatura pertence a outra conta Classfy.",
      409,
    );
  }
  return owner;
}
export function assertStoreEnvironment(
  environment: unknown,
  expected: StoreEnvironment,
  user: string,
  sandboxUsers: ReadonlySet<string>,
): asserts environment is StoreEnvironment {
  if (
    environment !== expected ||
    (environment === "Sandbox" && !sandboxUsers.has(user))
  ) {
    throw new MobileSubscriptionError(
      "store_environment_not_allowed",
      "Esta compra não pertence ao ambiente autorizado.",
      422,
    );
  }
}
export function storeDate(value: unknown): string {
  const milliseconds = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Date.parse(value)
    : NaN;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) invalidStoreProof();
  return new Date(milliseconds).toISOString();
}
export function boundedStoreId(value: unknown, max = 256): string {
  if (
    typeof value !== "string" || !value || value.length > max ||
    /[\x00-\x1f]/.test(value)
  ) {
    invalidStoreProof();
  }
  return value;
}
export async function purchaseTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export type MobileRequest = { action: "catalog"; platform: MobileStore } | {
  action: "verify";
  platform: MobileStore;
  productId: string;
  transactionId?: string;
  purchaseToken?: string;
};
export function parseMobileRequest(body: unknown): MobileRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalidStoreProof();
  }
  const input = body as Record<string, unknown>;
  if (input.platform !== "apple" && input.platform !== "google") {
    invalidStoreProof();
  }
  const platform = input.platform;
  if (input.action === "catalog") return { action: "catalog", platform };
  if (input.action !== "verify") invalidStoreProof();
  const productId = boundedStoreId(input.productId);
  productPlan(platform, productId);
  if (platform === "apple") {
    const transactionId = boundedStoreId(input.transactionId, 128);
    if (!/^\d+$/.test(transactionId)) invalidStoreProof();
    return { action: "verify", platform, productId, transactionId };
  }
  return {
    action: "verify",
    platform,
    productId,
    purchaseToken: boundedStoreId(input.purchaseToken, 4096),
  };
}

export interface StoreSubscription {
  platform: MobileStore;
  userId: string;
  originalId: string;
  productId: string;
  plan: MobilePlan;
  status: MobileSubscriptionStatus;
  periodEnd: string;
  autoRenew: boolean;
  eventId: string;
  eventAt: string;
  environment: StoreEnvironment;
  transactionId?: string;
  purchaseToken?: string;
  replacedOriginalId?: string;
  acknowledgementPending?: boolean;
}
export interface MobileStoreConfig {
  appleEnabled: boolean;
  googleEnabled: boolean;
  appleEnvironment: StoreEnvironment;
  appleKeyId?: string;
  appleIssuerId?: string;
  applePrivateKey?: string;
  appleAppId?: number;
  googleServiceAccountJson?: string;
  googleOidcAudience?: string;
  googleOidcServiceEmail?: string;
  sandboxUsers: ReadonlySet<string>;
}
export function readMobileStoreConfig(
  get: (name: string) => string | undefined,
): MobileStoreConfig {
  const appId = Number(get("MOBILE_APPLE_APP_ID"));
  return {
    appleEnabled: get("MOBILE_APPLE_BILLING_ENABLED") === "true",
    googleEnabled: get("MOBILE_GOOGLE_BILLING_ENABLED") === "true",
    appleEnvironment: get("MOBILE_APPLE_ENVIRONMENT") === "Sandbox"
      ? "Sandbox"
      : "Production",
    appleKeyId: get("MOBILE_APPLE_KEY_ID"),
    appleIssuerId: get("MOBILE_APPLE_ISSUER_ID"),
    applePrivateKey: get("MOBILE_APPLE_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
    appleAppId: Number.isSafeInteger(appId) && appId > 0 ? appId : undefined,
    googleServiceAccountJson: get("MOBILE_GOOGLE_SERVICE_ACCOUNT_JSON"),
    googleOidcAudience: get("MOBILE_GOOGLE_OIDC_AUDIENCE"),
    googleOidcServiceEmail: get("MOBILE_GOOGLE_OIDC_SERVICE_EMAIL"),
    sandboxUsers: new Set(
      (get("MOBILE_SANDBOX_USER_IDS") ?? "").split(",")
        .map((id) => id.trim().toLowerCase()).filter((id) =>
          MOBILE_UUID.test(id)
        ),
    ),
  };
}
export function platformConfigured(
  config: MobileStoreConfig,
  platform: MobileStore,
): boolean {
  if (platform === "apple") {
    return Boolean(
      config.appleEnabled && config.appleKeyId && config.appleIssuerId &&
        config.applePrivateKey &&
        (config.appleEnvironment === "Sandbox" || config.appleAppId),
    );
  }
  if (
    !config.googleEnabled || !config.googleServiceAccountJson ||
    !config.googleOidcAudience || !config.googleOidcServiceEmail
  ) return false;
  try {
    const account = JSON.parse(config.googleServiceAccountJson);
    return account.type === "service_account" &&
      typeof account.client_email === "string" &&
      typeof account.private_key === "string";
  } catch {
    return false;
  }
}

/** Input must already be cryptographically verified by Apple's official library. */
export function normalizeAppleSubscription(
  transaction: Record<string, unknown>,
  renewal: Record<string, unknown>,
  status: number,
  config: MobileStoreConfig,
  now: number,
  expectedUser?: string,
): StoreSubscription {
  if (
    transaction.bundleId !== MOBILE_APP_ID ||
    transaction.type !== "Auto-Renewable Subscription" ||
    transaction.inAppOwnershipType !== "PURCHASED" ||
    transaction.isUpgraded === true
  ) invalidStoreProof();
  const userId = requireStoreOwner(transaction.appAccountToken, expectedUser);
  assertStoreEnvironment(
    transaction.environment,
    config.appleEnvironment,
    userId,
    config.sandboxUsers,
  );
  const plan = productPlan("apple", transaction.productId);
  const originalId = boundedStoreId(transaction.originalTransactionId, 128);
  const transactionId = boundedStoreId(transaction.transactionId, 128);
  if (
    renewal.originalTransactionId !== originalId ||
    renewal.environment !== transaction.environment
  ) invalidStoreProof();
  const autoRenew = renewal.autoRenewStatus === 1;
  const periodEnd = storeDate(
    status === 4 ? renewal.gracePeriodExpiresDate : transaction.expiresDate,
  );
  let state: MobileSubscriptionStatus;
  if (transaction.revocationDate !== undefined || status === 5) {
    state = "revoked";
  } else if (status === 2 || Date.parse(periodEnd) <= now) state = "expired";
  else if (status === 3) state = "paused";
  else if (status === 1 || status === 4) {
    state = autoRenew ? "active" : "canceled";
  } else invalidStoreProof();
  return {
    platform: "apple",
    userId,
    originalId,
    productId: String(transaction.productId),
    plan,
    status: state,
    periodEnd,
    autoRenew,
    environment: config.appleEnvironment,
    transactionId,
    eventId: `apple:${transactionId}:${status}:${
      String(renewal.signedDate ?? transaction.signedDate)
    }`,
    eventAt: storeDate(
      Math.max(Number(transaction.signedDate), Number(renewal.signedDate)),
    ),
  };
}

/** Google purchase data comes only from purchases.subscriptionsv2.get. */
export async function normalizeGoogleSubscription(
  purchase: Record<string, any>,
  token: string,
  config: MobileStoreConfig,
  now: number,
  expectedUser?: string,
): Promise<StoreSubscription> {
  const userId = requireStoreOwner(
    purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId,
    expectedUser,
  );
  const environment = purchase.testPurchase ? "Sandbox" : "Production";
  assertStoreEnvironment(environment, environment, userId, config.sandboxUsers);
  const items = purchase.lineItems;
  if (!Array.isArray(items) || items.length !== 1) invalidStoreProof();
  const item = items[0];
  const plan = productPlan("google", item.productId);
  if (
    item.offerDetails?.basePlanId !== "monthly" || !item.autoRenewingPlan ||
    item.prepaidPlan
  ) invalidStoreProof();
  const status = purchase.subscriptionState;
  if (
    status === "SUBSCRIPTION_STATE_PENDING" ||
    status === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"
  ) {
    throw new MobileSubscriptionError(
      "purchase_pending",
      "Aguarde a loja concluir o pagamento.",
      409,
    );
  }
  const periodEnd = storeDate(item.expiryTime);
  let state: MobileSubscriptionStatus;
  if (status === "SUBSCRIPTION_STATE_EXPIRED" || Date.parse(periodEnd) <= now) {
    state = "expired";
  } else if (
    status === "SUBSCRIPTION_STATE_ON_HOLD" ||
    status === "SUBSCRIPTION_STATE_PAUSED"
  ) state = "paused";
  else if (status === "SUBSCRIPTION_STATE_CANCELED") state = "canceled";
  else if (
    status === "SUBSCRIPTION_STATE_ACTIVE" ||
    status === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
  ) state = "active";
  else invalidStoreProof();
  const originalId = await purchaseTokenHash(token);
  return {
    platform: "google",
    userId,
    originalId,
    productId: item.productId,
    plan,
    status: state,
    periodEnd,
    autoRenew: item.autoRenewingPlan.autoRenewEnabled === true,
    environment,
    purchaseToken: token,
    acknowledgementPending: purchase.acknowledgementState ===
        "ACKNOWLEDGEMENT_STATE_PENDING" &&
      (state === "active" || state === "canceled"),
    replacedOriginalId: typeof purchase.linkedPurchaseToken === "string"
      ? await purchaseTokenHash(purchase.linkedPurchaseToken)
      : undefined,
    eventId: `google:${originalId}:${now}`,
    eventAt: storeDate(now),
  };
}

export interface MobileStoreVerifier {
  configured(platform: MobileStore): boolean;
  apple(
    transactionId: string,
    expectedUser?: string,
  ): Promise<StoreSubscription>;
  google(
    purchaseToken: string,
    expectedUser?: string,
  ): Promise<StoreSubscription>;
  appleNotification(signedPayload: string): Promise<StoreSubscription | null>;
  googleNotificationAuth(authorization: string): Promise<void>;
  acknowledgeGoogle(snapshot: StoreSubscription): Promise<void>;
}
export interface MobileSubscriptionRepository {
  purchaseAllowed(userId: string, platform: MobileStore): Promise<boolean>;
  sync(
    snapshot: StoreSubscription,
  ): Promise<MobileSubscriptionSyncResult>;
}
export interface MobileSubscriptionSyncResult {
  plan: string;
  status: string;
  subscriptionEnd: string | null;
  entitlementSource: string;
  duplicate?: boolean;
  ignored_stale_event?: boolean;
  ignored_replaced_subscription?: boolean;
}
function confirmedStoreAccess(
  snapshot: StoreSubscription,
  synced: MobileSubscriptionSyncResult,
  now: number,
): boolean {
  const allowed = ["active", "canceled", "past_due"];
  return !synced.ignored_stale_event &&
    !synced.ignored_replaced_subscription &&
    synced.entitlementSource === snapshot.platform &&
    ["pro", "premium"].includes(synced.plan) &&
    allowed.includes(synced.status) &&
    allowed.includes(snapshot.status) &&
    Date.parse(snapshot.periodEnd ?? "") > now &&
    Date.parse(synced.subscriptionEnd ?? "") > now;
}
export function createMobileSubscriptionService(
  verifier: MobileStoreVerifier,
  repository: MobileSubscriptionRepository,
  now: () => number = Date.now,
) {
  return {
    async read(userId: string, body: unknown) {
      const request = parseMobileRequest(body);
      const enabled = verifier.configured(request.platform);
      if (request.action === "catalog") {
        const allowed = await repository.purchaseAllowed(
          userId,
          request.platform,
        );
        return {
          enabled: enabled && allowed,
          products: enabled && allowed ? MOBILE_PRODUCTS[request.platform] : [],
          ...(!allowed
            ? { reason: "subscription_managed_elsewhere" }
            : !enabled
            ? { reason: "store_not_configured" }
            : {}),
        };
      }
      if (!enabled) storeUnavailable();
      const snapshot = request.platform === "apple"
        ? await verifier.apple(request.transactionId!, userId)
        : await verifier.google(request.purchaseToken!, userId);
      requireStoreOwner(snapshot.userId, userId);
      if (snapshot.productId !== request.productId) invalidStoreProof();
      const synced = await repository.sync(snapshot);
      const confirmed = confirmedStoreAccess(snapshot, synced, now());
      if (snapshot.platform === "google" && confirmed) {
        await verifier.acknowledgeGoogle(snapshot);
      }
      return {
        verified: confirmed,
        plan: synced.plan,
        subscriptionEnd: synced.subscriptionEnd,
        ...(snapshot.platform === "google"
          ? { storeAcknowledged: confirmed }
          : {}),
      };
    },
    async appleNotification(body: unknown) {
      if (!verifier.configured("apple")) storeUnavailable();
      const signedPayload = (body as { signedPayload?: unknown })
        ?.signedPayload;
      if (typeof signedPayload !== "string" || signedPayload.length > 100_000) {
        invalidStoreProof();
      }
      const snapshot = await verifier.appleNotification(signedPayload);
      if (snapshot) await repository.sync(snapshot);
      return { received: true };
    },
    async googleNotification(authorization: string, body: unknown) {
      if (!verifier.configured("google")) storeUnavailable();
      await verifier.googleNotificationAuth(authorization);
      const message =
        (body as { message?: { data?: unknown; messageId?: unknown } })
          ?.message;
      if (typeof message?.data !== "string" || message.data.length > 32_000) {
        invalidStoreProof();
      }
      const eventId = boundedStoreId(message.messageId);
      let notification: Record<string, any>;
      try {
        notification = JSON.parse(atob(message.data));
      } catch {
        invalidStoreProof();
      }
      if (notification.packageName !== MOBILE_APP_ID) invalidStoreProof();
      if (notification.testNotification) return { received: true };
      const details = notification.subscriptionNotification ??
        notification.voidedPurchaseNotification;
      if (!details) return { received: true, ignored: true };
      const token = boundedStoreId(details.purchaseToken, 4096);
      const snapshot = await verifier.google(token);
      snapshot.eventId = `google-notification:${eventId}`;
      const synced = await repository.sync(snapshot);
      if (confirmedStoreAccess(snapshot, synced, now())) {
        await verifier.acknowledgeGoogle(snapshot);
      }
      return { received: true };
    },
  };
}

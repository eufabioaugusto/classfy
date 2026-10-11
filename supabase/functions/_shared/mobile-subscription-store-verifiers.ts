import { Buffer } from "node:buffer";
import {
  AppStoreServerAPIClient,
  Environment,
  type JWSTransactionDecodedPayload,
  SignedDataVerifier,
} from "npm:@apple/app-store-server-library@3.1.0";
import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
} from "npm:jose@6.2.12";
import { APPLE_ROOT_CERTIFICATES_BASE64 } from "./mobile-subscription-apple-roots.ts";
import {
  assertStoreEnvironment,
  boundedStoreId,
  canonicalStoreOwner,
  invalidStoreProof,
  MOBILE_APP_ID,
  type MobileStoreConfig,
  type MobileStoreVerifier,
  MobileSubscriptionError,
  normalizeAppleSubscription,
  normalizeGoogleSubscription,
  platformConfigured,
  requireStoreOwner,
  type StoreSubscription,
  storeUnavailable,
} from "./mobile-subscription.ts";

const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  {
    timeoutDuration: 10_000,
  },
);
async function withDeadline<T>(
  work: Promise<T>,
  milliseconds = 25_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() =>
          reject(
            new MobileSubscriptionError(
              "store_timeout",
              "A loja está demorando para responder. Tente novamente.",
              504,
            ),
          ), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyGooglePushIdentity(
  authorization: string,
  audience: string | undefined,
  email: string | undefined,
  verify: typeof jwtVerify = jwtVerify,
): Promise<void> {
  if (!audience || !email) storeUnavailable();
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new MobileSubscriptionError(
      "invalid_notification_auth",
      "Notificação não autenticada.",
      401,
    );
  }
  try {
    const { payload } = await verify(
      authorization.replace(/^Bearer\s+/i, ""),
      googleKeys,
      {
        algorithms: ["RS256"],
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience,
        requiredClaims: ["iat", "exp", "sub", "email", "email_verified"],
        maxTokenAge: "1h",
        clockTolerance: 30,
      },
    );
    if (payload.email !== email || payload.email_verified !== true) {
      throw new Error("identity_mismatch");
    }
  } catch {
    throw new MobileSubscriptionError(
      "invalid_notification_auth",
      "Notificação não autenticada.",
      401,
    );
  }
}

export function createMobileStoreVerifier(
  config: MobileStoreConfig,
  options: { fetch?: typeof fetch; now?: () => number } = {},
): MobileStoreVerifier {
  const baseFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let apple:
    | { client: AppStoreServerAPIClient; verifier: SignedDataVerifier }
    | undefined;
  let googleAccess: { token: string; until: number } | undefined;

  const appleTools = () => {
    if (!platformConfigured(config, "apple")) storeUnavailable();
    if (!apple) {
      const environment = config.appleEnvironment === "Sandbox"
        ? Environment.SANDBOX
        : Environment.PRODUCTION;
      apple = {
        client: new AppStoreServerAPIClient(
          config.applePrivateKey!,
          config.appleKeyId!,
          config.appleIssuerId!,
          MOBILE_APP_ID,
          environment,
        ),
        verifier: new SignedDataVerifier(
          APPLE_ROOT_CERTIFICATES_BASE64.map((root) =>
            Buffer.from(root, "base64")
          ),
          true,
          environment,
          MOBILE_APP_ID,
          config.appleAppId,
        ),
      };
    }
    return apple;
  };
  async function decodeTransaction(
    signed: string | undefined,
  ): Promise<JWSTransactionDecodedPayload> {
    if (!signed) invalidStoreProof();
    try {
      return await appleTools().verifier.verifyAndDecodeTransaction(signed);
    } catch {
      invalidStoreProof();
    }
  }
  async function applePurchase(
    transactionId: string,
    expectedUser?: string,
  ): Promise<StoreSubscription> {
    const { client, verifier } = appleTools();
    const proof = await withDeadline(client.getTransactionInfo(transactionId));
    const initial = await decodeTransaction(proof.signedTransactionInfo);
    if (initial.transactionId !== transactionId) invalidStoreProof();
    const owner = requireStoreOwner(initial.appAccountToken, expectedUser);
    assertStoreEnvironment(
      initial.environment,
      config.appleEnvironment,
      owner,
      config.sandboxUsers,
    );
    const current = await withDeadline(
      client.getAllSubscriptionStatuses(transactionId),
    );
    if (
      current.bundleId !== MOBILE_APP_ID ||
      current.environment !== config.appleEnvironment
    ) invalidStoreProof();
    const matches: {
      transaction: JWSTransactionDecodedPayload;
      renewal: Record<string, unknown>;
      status: number;
    }[] = [];
    for (const group of current.data ?? []) {
      for (const latest of group.lastTransactions ?? []) {
        const transaction = await decodeTransaction(
          latest.signedTransactionInfo,
        );
        if (
          transaction.originalTransactionId !== initial.originalTransactionId ||
          transaction.isUpgraded
        ) continue;
        if (!latest.signedRenewalInfo || typeof latest.status !== "number") {
          invalidStoreProof();
        }
        let renewal;
        try {
          renewal = await verifier.verifyAndDecodeRenewalInfo(
            latest.signedRenewalInfo,
          );
        } catch {
          invalidStoreProof();
        }
        matches.push({
          transaction,
          renewal: renewal as unknown as Record<string, unknown>,
          status: latest.status,
        });
      }
    }
    matches.sort((a, b) =>
      Number(b.transaction.purchaseDate) - Number(a.transaction.purchaseDate)
    );
    const latest = matches[0];
    if (!latest) invalidStoreProof();
    return normalizeAppleSubscription(
      latest.transaction as unknown as Record<string, unknown>,
      latest.renewal,
      latest.status,
      config,
      now(),
      owner,
    );
  }
  async function googleAccessToken(): Promise<string> {
    if (!platformConfigured(config, "google")) storeUnavailable();
    if (googleAccess && googleAccess.until > now() + 60_000) {
      return googleAccess.token;
    }
    const account = JSON.parse(config.googleServiceAccountJson!);
    const issued = Math.floor(now() / 1000);
    const privateKey = await importPKCS8(account.private_key, "RS256");
    const assertion = await new SignJWT({
      scope: "https://www.googleapis.com/auth/androidpublisher",
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.client_email).setAudience(
        "https://oauth2.googleapis.com/token",
      )
      .setIssuedAt(issued).setExpirationTime(issued + 3600).sign(privateKey);
    const response = await baseFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) storeUnavailable();
    const result = await response.json();
    if (
      typeof result.access_token !== "string" ||
      !Number.isFinite(result.expires_in)
    ) storeUnavailable();
    googleAccess = {
      token: result.access_token,
      until: now() + Math.min(result.expires_in, 3600) * 1000,
    };
    return googleAccess.token;
  }

  return {
    configured: (platform) => platformConfigured(config, platform),
    apple: applePurchase,
    async google(token, expectedUser) {
      const accessToken = await googleAccessToken();
      const url =
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${MOBILE_APP_ID}/purchases/subscriptionsv2/tokens/${
          encodeURIComponent(token)
        }`;
      const response = await baseFetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (
        response.status === 400 || response.status === 404 ||
        response.status === 410
      ) invalidStoreProof();
      if (!response.ok) storeUnavailable();
      // Package identity is enforced by the authenticated, fixed application API URL.
      return await normalizeGoogleSubscription(
        await response.json(),
        token,
        config,
        now(),
        expectedUser,
      );
    },
    async appleNotification(signedPayload) {
      const { verifier } = appleTools();
      let notification;
      try {
        notification = await verifier.verifyAndDecodeNotification(
          signedPayload,
        );
      } catch {
        invalidStoreProof();
      }
      if (notification.notificationType === "TEST") return null;
      if (!notification.data?.signedTransactionInfo) invalidStoreProof();
      const transaction = await decodeTransaction(
        notification.data.signedTransactionInfo,
      );
      // Query current store status, rather than granting from a replayed notification.
      const snapshot = await applePurchase(
        boundedStoreId(transaction.transactionId, 128),
        canonicalStoreOwner(transaction.appAccountToken),
      );
      snapshot.eventId = `apple-notification:${
        boundedStoreId(notification.notificationUUID)
      }`;
      return snapshot;
    },
    googleNotificationAuth: (authorization) =>
      verifyGooglePushIdentity(
        authorization,
        config.googleOidcAudience,
        config.googleOidcServiceEmail,
      ),
    async acknowledgeGoogle(snapshot) {
      if (!snapshot.acknowledgementPending) return;
      if (snapshot.platform !== "google" || !snapshot.purchaseToken) {
        invalidStoreProof();
      }
      const accessToken = await googleAccessToken();
      const url =
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${MOBILE_APP_ID}/purchases/subscriptions/${
          encodeURIComponent(snapshot.productId)
        }/tokens/${encodeURIComponent(snapshot.purchaseToken)}:acknowledge`;
      const response = await baseFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) storeUnavailable();
    },
  };
}

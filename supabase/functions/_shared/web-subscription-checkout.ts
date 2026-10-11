import {
  getSubscriptionPeriodEnd,
  STRIPE_PLANS,
  type SubscriptionPlan,
} from "./stripe-subscription.ts";

// Stripe 18.5.0 / 2025-08-27.basil. Keep the service independent of HTTP/SDK IO.
export const WEB_CHECKOUT_API_VERSION = "2025-08-27.basil";
export class WebCheckoutError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}
type Plan = SubscriptionPlan;
type Json = Record<string, any>;
export interface CheckoutOperation {
  id: string;
  ownerId: string;
  requestId: string;
  kind: "checkout" | "upgrade";
  plan: Plan;
  state:
    | "quoted"
    | "creating"
    | "prepared"
    | "confirming"
    | "pending"
    | "completed"
    | "canceled"
    | "failed";
  createdAt: number;
  expiresAt: number;
  customerId: string;
  sessionId?: string;
  subscriptionId?: string;
  invoiceId?: string;
  paymentIntentId?: string;
  params?: Json;
  quote?: Json;
}
export interface WebCheckoutRepository {
  claim(owner: string, token: string): Promise<boolean>;
  release(owner: string, token: string): Promise<void>;
  profile(owner: string): Promise<Json>;
  saveCustomer(owner: string, customer: string): Promise<void>;
  operations(owner: string): Promise<CheckoutOperation[]>;
  save(
    owner: string,
    token: string,
    operation: CheckoutOperation,
  ): Promise<void>;
  sync(owner: string, subscription: Json, plan: Plan): Promise<boolean>;
}
export interface WebCheckoutStripe {
  customers: {
    retrieve(id: string): Promise<Json>;
    list(params: Json): Promise<{ data: Json[]; has_more?: boolean }>;
    create(params: Json, options: Json): Promise<Json>;
  };
  prices: { retrieve(id: string): Promise<Json> };
  subscriptions: {
    list(params: Json): Promise<{ data: Json[]; has_more?: boolean }>;
    retrieve(id: string, params?: Json): Promise<Json>;
    update(id: string, params: Json, options: Json): Promise<Json>;
  };
  checkout: {
    sessions: {
      list(params: Json): Promise<{ data: Json[]; has_more?: boolean }>;
      create(params: Json, options: Json): Promise<Json>;
      retrieve(id: string, params?: Json): Promise<Json>;
      expire(id: string, params?: Json, options?: Json): Promise<Json>;
    };
  };
  invoices: {
    createPreview(params: Json): Promise<Json>;
    retrieve(id: string, params?: Json): Promise<Json>;
  };
  paymentIntents: { retrieve(id: string): Promise<Json> };
}
export interface WebCheckoutDependencies {
  repository: WebCheckoutRepository;
  stripe: WebCheckoutStripe;
  publishableKey: string;
  now?: () => number;
  uuid?: () => string;
  returnOrigin: string;
  uiMode?: "custom" | "hosted";
}
export type WebCheckoutRequest =
  | { action: "prepare"; plan: Plan; operationId: string }
  | { action: "confirm_upgrade"; quoteToken: string; operationId: string }
  | {
    action: "status";
    plan?: Plan;
    sessionId?: string;
    paymentIntentId?: string;
    subscriptionId?: string;
    quoteToken?: string;
    operationId?: string;
  }
  | { action: "cancel"; sessionId?: string; quoteToken?: string };

const id = (value: unknown): string | null =>
  typeof value === "string" ? value : value && typeof value === "object" &&
      typeof (value as Json).id === "string"
    ? (value as Json).id
    : null;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code: string, message: string, status = 409): never {
  throw new WebCheckoutError(code, message, status);
}
const exactPlan = (subscription: Json): Plan | null => {
  if (subscription.items?.data?.length !== 1) return null;
  const item = subscription.items.data[0];
  if (item.quantity !== 1) return null;
  return Object.entries(STRIPE_PLANS).find(([, config]) =>
    item.price?.id === config.priceId &&
    id(item.price?.product) === config.productId
  )?.[0] as Plan | null ?? null;
};
/** Preserve the already-paid Premium period from the historical downgrade flow.
 * A stored effective date is fixed: never extend it on a later renewal.
 * Stripe metadata covers a lost reply before the protected profile was synced.
 */
export function pendingWebDowngrade(
  profile: Json,
  subscription: Json,
  at = Date.now(),
): string | null {
  if (profile.plan !== "premium" || exactPlan(subscription) !== "pro") {
    return null;
  }
  const storedAt = Date.parse(profile.pending_plan_effective_at ?? "");
  if (profile.pending_plan === "pro" && Number.isFinite(storedAt)) {
    return storedAt > at ? new Date(storedAt).toISOString() : null;
  }
  const periodEnd = getSubscriptionPeriodEnd(subscription as any);
  return subscription.metadata?.pending_plan === "pro" && periodEnd &&
      Date.parse(periodEnd) > at
    ? periodEnd
    : null;
}
const accessible = (sub: Json, now: number) =>
  ["active", "trialing"].includes(sub.status) &&
  !!getSubscriptionPeriodEnd(sub as any) &&
  Date.parse(getSubscriptionPeriodEnd(sub as any)!) > now;
const fingerprint = (sub: Json) =>
  JSON.stringify([
    sub.id,
    sub.status,
    sub.items?.data?.map((
      item: Json,
    ) => [item.id, item.price?.id, item.quantity, item.current_period_end]),
    sub.current_period_end,
    id(sub.latest_invoice),
    sub.cancel_at_period_end,
    sub.schedule,
    sub.pending_update,
  ]);
const money = (amount: unknown): number => {
  if (!Number.isSafeInteger(amount) || Number(amount) < 0) {
    fail(
      "invalid_price",
      "O valor da assinatura não pôde ser confirmado.",
      503,
    );
  }
  return Number(amount);
};
const owned = (resource: Json, owner: string, customer: string) => {
  if (
    id(resource.customer) !== customer ||
    (resource.metadata?.user_id && resource.metadata.user_id !== owner)
  ) fail("not_found", "Pagamento não encontrado nesta conta.", 404);
};
const sessionOwned = (session: Json, operation: CheckoutOperation) => {
  owned(session, operation.ownerId, operation.customerId);
  // A pre-ledger session can only be adopted after canonical price/owner checks.
  // The durable receipt records the exact Stripe ID; it never accepts another
  // session whose metadata happens to name the same plan/customer.
  const adopted = operation.params?.adopted_session === session.id &&
    !session.metadata?.web_checkout_operation;
  if (
    session.metadata?.user_id !== operation.ownerId ||
    (!adopted && session.metadata?.web_checkout_operation !== operation.id) ||
    session.metadata?.plan_type !== operation.plan ||
    session.mode !== "subscription" ||
    session.ui_mode !== (operation.params?.ui_mode ?? "custom")
  ) fail("not_found", "Pagamento não encontrado nesta conta.", 404);
};
const unstartedCheckout = (session: Json) =>
  session.status === "open" && session.payment_status === "unpaid" &&
  session.subscription === null && session.invoice === null &&
  session.payment_intent === null && session.setup_intent === null;

export function parseWebCheckoutRequest(raw: unknown): WebCheckoutRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("invalid_request", "Solicitação inválida.", 400);
  }
  const value = raw as Json;
  if (
    !["prepare", "confirm_upgrade", "status", "cancel"].includes(value.action)
  ) fail("invalid_action", "Ação de assinatura inválida.", 400);
  if (
    (value.action === "prepare" ||
      value.action === "status" && value.plan !== undefined) &&
    !["pro", "premium"].includes(value.plan)
  ) fail("invalid_plan", "Plano inválido.", 400);
  if (
    ["prepare", "confirm_upgrade"].includes(value.action) &&
    !uuidPattern.test(value.operationId ?? "")
  ) fail("invalid_operation", "Identificador da operação inválido.", 400);
  if (
    value.action === "confirm_upgrade" &&
    !uuidPattern.test(value.quoteToken ?? "")
  ) fail("invalid_quote", "Prévia inválida.", 400);
  if (["status", "cancel"].includes(value.action)) {
    const references = [
      value.sessionId,
      value.paymentIntentId,
      value.quoteToken,
      value.action === "status" ? value.operationId : undefined,
    ].filter((value) => value !== undefined);
    if (
      value.subscriptionId !== undefined &&
      !/^sub_[a-zA-Z0-9]+$/.test(value.subscriptionId)
    ) fail("invalid_reference", "Referência de assinatura inválida.", 400);
    if (
      !(references.length === 1 ||
        value.action === "status" && references.length === 0 &&
          value.subscriptionId !== undefined) ||
      (value.action === "status" && value.operationId !== undefined &&
        !uuidPattern.test(value.operationId)) ||
      (value.sessionId !== undefined &&
        !/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(value.sessionId)) ||
      (value.paymentIntentId !== undefined &&
        !/^pi_[a-zA-Z0-9]+$/.test(value.paymentIntentId)) ||
      (value.quoteToken !== undefined && !uuidPattern.test(value.quoteToken)) ||
      (value.action === "cancel" && value.paymentIntentId !== undefined)
    ) fail("invalid_reference", "Referência de pagamento inválida.", 400);
  }
  return value as WebCheckoutRequest;
}

export function createWebSubscriptionCheckoutService(
  deps: WebCheckoutDependencies,
) {
  const { stripe, repository: repo } = deps;
  const now = deps.now ?? Date.now,
    uuid = deps.uuid ?? (() => crypto.randomUUID());
  const save = (owner: string, lease: string, op: CheckoutOperation) =>
    repo.save(owner, lease, op);
  async function customer(
    owner: { id: string; email: string },
    profile: Json,
  ): Promise<string> {
    if (profile.billing_id) {
      const existing = await stripe.customers.retrieve(profile.billing_id);
      if (
        existing.deleted ||
        existing.metadata?.user_id && existing.metadata.user_id !== owner.id
      ) {
        fail(
          "billing_owner",
          "Não foi possível confirmar a conta de cobrança.",
          409,
        );
      }
      return existing.id;
    }
    // A matching email alone never grants ownership of a Stripe Customer.
    const found =
      (await stripe.customers.list({ email: owner.email, limit: 100 })).data
        .find((row) => !row.deleted && row.metadata?.user_id === owner.id);
    const created = found ??
      await stripe.customers.create({
        email: owner.email,
        metadata: { user_id: owner.id },
      }, { idempotencyKey: `web-customer-v1:${owner.id}` });
    await repo.saveCustomer(owner.id, created.id);
    return created.id;
  }
  async function price(plan: Plan) {
    const result = await stripe.prices.retrieve(STRIPE_PLANS[plan].priceId);
    if (
      !result.active || result.currency !== "brl" ||
      id(result.product) !== STRIPE_PLANS[plan].productId ||
      result.recurring?.interval !== "month" ||
      result.recurring?.interval_count !== 1
    ) fail("invalid_price", "O preço deste plano não está disponível.", 503);
    return { recurringAmount: money(result.unit_amount), currency: "brl" };
  }
  async function subscriptionFor(customerId: string) {
    const listed = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    if (listed.has_more) {
      fail(
        "billing_history_unavailable",
        "Não foi possível confirmar todas as assinaturas desta conta. Revise a assinatura em Minha conta.",
        503,
      );
    }
    const current = listed.data.filter((row) =>
      !["canceled", "incomplete_expired"].includes(row.status)
    );
    if (current.length > 1) {
      fail(
        "multiple_subscriptions",
        "Há mais de uma assinatura nesta conta. Revise a assinatura em Minha conta.",
      );
    }
    return current[0] ?? null;
  }
  function quoteResponse(op: CheckoutOperation) {
    const quote = op.quote!;
    return {
      kind: "upgrade_quote",
      plan: "premium",
      quoteToken: op.id,
      amountDue: quote.amountDue,
      recurringAmount: quote.recurringAmount,
      currency: quote.currency,
      currentPlan: quote.currentPlan,
      targetPlan: quote.targetPlan,
      prorationDate: quote.prorationDate,
      expiresAt: new Date(op.expiresAt).toISOString(),
    };
  }
  async function syncActive(owner: string, sub: Json, plan: Plan) {
    if (
      !accessible(sub, now()) || exactPlan(sub) !== plan || sub.pending_update
    ) return false;
    return await repo.sync(owner, sub, plan);
  }
  async function checkoutResponse(
    op: CheckoutOperation,
    lease: string,
    session?: Json,
  ) {
    const current = session ??
      await stripe.checkout.sessions.retrieve(op.sessionId!);
    sessionOwned(current, op);
    if (current.status !== "open") return await status(op, lease);
    if (current.ui_mode === "hosted") {
      return deps.uiMode === "hosted"
        ? { url: current.url, mode: "checkout" }
        : {
          kind: "manage",
          plan: op.plan,
          message:
            "Este pagamento anterior precisa ser verificado antes de abrir o pagamento integrado.",
        };
    }
    if (!current.client_secret) {
      fail("missing_client_secret", "Não foi possível abrir o pagamento.", 503);
    }
    return {
      kind: "checkout",
      plan: op.plan,
      operationId: op.id,
      sessionId: current.id,
      clientSecret: current.client_secret,
      publishableKey: deps.publishableKey,
      amountDue: money(current.amount_total),
      recurringAmount: op.quote!.recurringAmount,
      currency: "brl",
      expiresAt: new Date(current.expires_at * 1000).toISOString(),
    };
  }
  async function invoiceAndIntent(op: CheckoutOperation, sub: Json) {
    const invoiceId = op.invoiceId ?? id(sub.latest_invoice);
    if (!invoiceId) return { invoice: null, intent: null };
    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ["confirmation_secret", "payments.data.payment.payment_intent"],
    });
    owned(invoice, op.ownerId, op.customerId);
    if (
      id(
        invoice.parent?.subscription_details?.subscription ??
          invoice.subscription,
      ) !== op.subscriptionId
    ) fail("not_found", "Pagamento não encontrado nesta conta.", 404);
    const item = invoice.payments?.data?.find((payment: Json) =>
      payment.payment?.type === "payment_intent"
    );
    const invoiceSecret = invoice.confirmation_secret?.client_secret;
    const intentId = id(item?.payment?.payment_intent) ??
      (typeof invoiceSecret === "string"
        ? /^((?:pi_)[a-zA-Z0-9]+)_secret_/.exec(invoiceSecret)?.[1] ?? null
        : null);
    const intent = intentId
      ? await stripe.paymentIntents.retrieve(intentId)
      : null;
    if (intent) owned(intent, op.ownerId, op.customerId);
    return { invoice, intent };
  }
  async function upgradeResponse(op: CheckoutOperation, lease: string) {
    const sub = await stripe.subscriptions.retrieve(op.subscriptionId!);
    owned(sub, op.ownerId, op.customerId);
    const { invoice, intent } = await invoiceAndIntent(op, sub);
    if (invoice) op.invoiceId = invoice.id;
    if (intent) op.paymentIntentId = intent.id;
    const active = invoice?.status === "paid" &&
      await syncActive(op.ownerId, sub, "premium");
    op.state = active ? "completed" : "pending";
    await save(op.ownerId, lease, op);
    const state = active
      ? "active"
      : intent?.status === "requires_action"
      ? "requires_action"
      : intent?.status === "requires_payment_method"
      ? "requires_payment_method"
      : "processing";
    return {
      kind: "upgrade_payment",
      plan: "premium",
      operationId: op.id,
      subscriptionId: sub.id,
      paymentIntentId: intent?.id ?? null,
      clientSecret: active ? null : intent?.client_secret ??
        invoice?.confirmation_secret?.client_secret ?? null,
      publishableKey: deps.publishableKey,
      status: state,
      amountDue: op.quote!.amountDue,
      recurringAmount: op.quote!.recurringAmount,
      currency: "brl",
      expiresAt: new Date(op.expiresAt).toISOString(),
    };
  }
  async function status(op: CheckoutOperation, lease: string) {
    const profile = await repo.profile(op.ownerId);
    const response = (
      state: "active" | "pending" | "expired" | "failed",
      message?: string,
    ) => ({
      kind: "status",
      state,
      plan: op.plan,
      operationId: op.id,
      ...op.sessionId ? { sessionId: op.sessionId } : {},
      ...op.subscriptionId ? { subscriptionId: op.subscriptionId } : {},
      ...op.paymentIntentId ? { paymentIntentId: op.paymentIntentId } : {},
      effectivePlan: state === "active" ? op.plan : profile.plan ?? "free",
      ...message ? { message } : {},
    });
    if (op.state === "canceled") {
      return response("expired", "Este pagamento foi encerrado.");
    }
    if (op.state === "failed") {
      return response(
        "failed",
        "Este pagamento não foi concluído. Prepare uma nova tentativa.",
      );
    }
    if (op.kind === "checkout") {
      if (!op.sessionId) {
        return response(
          "pending",
          "A preparação ainda está sendo confirmada. Tente novamente.",
        );
      }
      const session = await stripe.checkout.sessions.retrieve(op.sessionId, {
        expand: ["line_items"],
      });
      sessionOwned(session, op);
      if (session.status === "expired") {
        op.state = "canceled";
        await save(op.ownerId, lease, op);
        return response("expired");
      }
      if (session.status !== "complete") return response("pending");
      if (
        session.payment_status !== "paid" &&
        session.payment_status !== "no_payment_required"
      ) return response("pending");
      const subId = id(session.subscription);
      if (!subId) return response("pending");
      const sub = await stripe.subscriptions.retrieve(subId);
      owned(sub, op.ownerId, op.customerId);
      if (await syncActive(op.ownerId, sub, op.plan)) {
        op.state = "completed";
        op.subscriptionId = subId;
        await save(op.ownerId, lease, op);
        return response("active");
      }
      return response(
        ["incomplete_expired", "canceled", "unpaid"].includes(sub.status)
          ? "failed"
          : "pending",
      );
    }
    if (op.state === "quoted") {
      return response(op.expiresAt > now() ? "pending" : "expired");
    }
    if (!op.subscriptionId) return response("failed");
    const result = await upgradeResponse(op, lease);
    if (result.status === "active") return response("active");
    const sub = await stripe.subscriptions.retrieve(op.subscriptionId);
    const { invoice, intent } = await invoiceAndIntent(op, sub);
    if (
      invoice?.status === "void" || intent?.status === "canceled" ||
      (!sub.pending_update && exactPlan(sub) === "pro" && op.expiresAt <= now())
    ) return response("expired");
    if (intent?.status === "requires_payment_method") {
      return response(
        "failed",
        "O cartão não autorizou o pagamento. Confira os dados e tente novamente.",
      );
    }
    return response("pending");
  }

  function recoveredSessionPlan(
    session: Json,
    owner: string,
    customer: string,
  ) {
    owned(session, owner, customer);
    const plan = session.metadata?.plan_type as Plan;
    const lines = session.line_items;
    const item = lines?.data?.[0];
    if (
      session.metadata?.user_id !== owner ||
      !["pro", "premium"].includes(plan) ||
      session.mode !== "subscription" ||
      !["custom", "hosted"].includes(session.ui_mode) ||
      (session.client_reference_id && session.client_reference_id !== owner) ||
      lines?.has_more || lines?.data?.length !== 1 || item.quantity !== 1 ||
      item.price?.id !== STRIPE_PLANS[plan]?.priceId ||
      id(item.price?.product) !== STRIPE_PLANS[plan]?.productId ||
      session.currency !== "brl" ||
      (session.metadata.product_id &&
        session.metadata.product_id !== STRIPE_PLANS[plan].productId) ||
      !Number.isFinite(session.expires_at) ||
      (session.metadata.web_checkout_operation &&
        !uuidPattern.test(session.metadata.web_checkout_operation))
    ) {
      fail(
        "checkout_unverified",
        "Não foi possível confirmar o pagamento anterior desta conta. Revise a assinatura em Minha conta antes de iniciar outro.",
      );
    }
    return plan;
  }

  async function adoptSession(
    session: Json,
    owner: string,
    customer: string,
    operations: CheckoutOperation[],
    lease: string,
    requestId: string,
  ) {
    const plan = recoveredSessionPlan(session, owner, customer);
    const existing = operations.find((op) =>
      op.sessionId === session.id ||
      op.id === session.metadata.web_checkout_operation
    );
    if (existing) {
      sessionOwned(session, existing);
      if (existing.state === "canceled" || existing.state === "failed") {
        fail(
          "checkout_unverified",
          "O pagamento anterior precisa ser verificado.",
        );
      }
      if (!existing.sessionId) {
        existing.sessionId = session.id;
        existing.state = "prepared";
        await save(owner, lease, existing);
      }
      return existing;
    }
    const op: CheckoutOperation = {
      id: session.metadata.web_checkout_operation ?? uuid(),
      ownerId: owner,
      customerId: customer,
      requestId,
      kind: "checkout",
      plan,
      state: "prepared",
      sessionId: session.id,
      createdAt: now(),
      expiresAt: session.expires_at * 1000,
      params: {
        ui_mode: session.ui_mode,
        ...!session.metadata.web_checkout_operation
          ? { adopted_session: session.id }
          : {},
      },
      quote: await price(plan),
    };
    // Save before exposing a secret or retiring the session. A lost DB reply is
    // recovered by the next owner-scoped read, without creating a new payment.
    await save(owner, lease, op);
    operations.push(op);
    return op;
  }

  async function expireUnstarted(
    op: CheckoutOperation,
    session: Json,
    lease: string,
  ) {
    if (!unstartedCheckout(session)) return false;
    // Recovery can inspect several sessions. Fence the external mutation again
    // immediately before expire; an expired/replaced lease cannot retire it.
    await save(op.ownerId, lease, op);
    let current: Json;
    try {
      current = await stripe.checkout.sessions.expire(session.id, {}, {
        idempotencyKey: `web-retire-v1:${session.id}`,
      });
    } catch {
      // Expire may have succeeded before its response was lost, or Checkout
      // may have completed first. Neither case authorizes a speculative create.
      current = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["line_items"],
      });
    }
    sessionOwned(current, op);
    if (current.status !== "expired") return false;
    op.state = "canceled";
    await save(op.ownerId, lease, op);
    return true;
  }

  async function recoverCheckouts(
    owner: string,
    customer: string,
    plan: Plan,
    requestId: string,
    operations: CheckoutOperation[],
    candidate: CheckoutOperation | undefined,
    lease: string,
  ): Promise<{ operation?: CheckoutOperation; response?: Json }> {
    const recoveredStatus = async (op: CheckoutOperation) => {
      const result = await status(op, lease);
      if (op.plan === plan) return result;
      const name = op.plan === "pro" ? "Pro" : "Premium";
      return {
        kind: "manage",
        plan: op.plan,
        message: result.state === "active"
          ? `O pagamento do ${name} foi confirmado. Confira sua assinatura em Minha conta e selecione o novo plano novamente.`
          : `Existe um pagamento anterior do ${name} que ainda precisa ser confirmado. Confira esse pagamento em Minha conta antes de trocar de plano.`,
      };
    };
    const listed = await stripe.checkout.sessions.list({
      customer,
      status: "open",
      limit: 100,
    });
    if (listed.has_more) {
      fail(
        "billing_history_unavailable",
        "Não foi possível confirmar todos os pagamentos desta conta. Tente novamente em Minha conta.",
        503,
      );
    }
    // Include all durable live receipts, not only the newest. Stripe list is a
    // snapshot and can omit a session which completes/expires during recovery.
    const sessionIds = new Set(
      listed.data.filter((row) => row.mode === "subscription").map((row) =>
        row.id as string
      ),
    );
    for (const op of operations) {
      if (
        op.kind === "checkout" && op.sessionId &&
        ["creating", "prepared", "pending"].includes(op.state)
      ) sessionIds.add(op.sessionId);
    }
    const open: { session: Json; operation?: CheckoutOperation }[] = [];
    for (const sessionId of sessionIds) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["line_items"],
      });
      recoveredSessionPlan(session, owner, customer);
      const known = operations.find((op) =>
        op.sessionId === sessionId ||
        op.id === session.metadata.web_checkout_operation
      );
      if (known) sessionOwned(session, known);
      if (session.status === "expired") {
        if (known && known.state !== "canceled") {
          known.state = "canceled";
          await save(owner, lease, known);
        }
        continue;
      }
      if (session.status !== "open") {
        const op = await adoptSession(
          session,
          owner,
          customer,
          operations,
          lease,
          uuid(),
        );
        return { response: await recoveredStatus(op) };
      }
      open.push({ session, operation: known });
    }
    const keep = open.find((row) =>
      row.session.ui_mode === "custom" &&
      row.session.metadata.plan_type === plan &&
      row.operation?.id === candidate?.id
    ) ?? open.find((row) =>
      row.session.ui_mode === "custom" &&
      row.session.metadata.plan_type === plan
    );
    // Assess the entire set before expiring anything. A started/unknown payment
    // for another plan must be resolved, never replaced with a second charge.
    const protectedPayment = open.find((row) =>
      row !== keep && !unstartedCheckout(row.session)
    );
    if (protectedPayment) {
      const op = await adoptSession(
        protectedPayment.session,
        owner,
        customer,
        operations,
        lease,
        uuid(),
      );
      return { response: await recoveredStatus(op) };
    }
    let retired = false;
    for (const row of open) {
      if (row === keep) continue;
      const op = await adoptSession(
        row.session,
        owner,
        customer,
        operations,
        lease,
        uuid(),
      );
      if (!await expireUnstarted(op, row.session, lease)) {
        return { response: await recoveredStatus(op) };
      }
      retired = true;
    }
    if (keep) {
      const op = await adoptSession(
        keep.session,
        owner,
        customer,
        operations,
        lease,
        candidate?.requestId === requestId ? uuid() : requestId,
      );
      return { response: await checkoutResponse(op, lease) };
    }
    if (retired) {
      const sub = await subscriptionFor(customer);
      if (sub) {
        owned(sub, owner, customer);
        const currentPlan = exactPlan(sub);
        if (currentPlan && await syncActive(owner, sub, currentPlan)) {
          return {
            response: currentPlan === plan
              ? { kind: "active", plan, status: sub.status }
              : {
                kind: "manage",
                plan: currentPlan,
                message:
                  "Uma assinatura anterior foi confirmada. Confira sua assinatura em Minha conta e selecione o novo plano novamente.",
              },
          };
        }
        return {
          response: {
            kind: "manage",
            plan: exactPlan(sub) ?? plan,
            message:
              "Uma assinatura anterior está sendo confirmada. Revise o pagamento em Minha conta antes de iniciar outro.",
          },
        };
      }
    }
    if (candidate?.sessionId) return {};
    if (candidate && candidate.plan !== plan) {
      fail(
        "operation_pending",
        "Há um pagamento sendo preparado. Aguarde a confirmação antes de trocar o plano.",
      );
    }
    return { operation: candidate };
  }

  return {
    async execute(
      owner: { id: string; email: string },
      raw: unknown,
      existingLease?: string,
    ): Promise<Json> {
      const request = parseWebCheckoutRequest(raw);
      if (
        deps.uiMode !== "hosted" &&
        !/^pk_(test|live)_/.test(deps.publishableKey)
      ) {
        fail(
          "checkout_not_configured",
          "O pagamento integrado ainda não está configurado.",
          503,
        );
      }
      const lease = existingLease ?? uuid();
      if (!existingLease && !await repo.claim(owner.id, lease)) {
        fail(
          "checkout_busy",
          "Uma operação de assinatura está em andamento. Tente novamente em instantes.",
          409,
        );
      }
      try {
        const operations = await repo.operations(owner.id);
        if (request.action === "status" || request.action === "cancel") {
          const op = operations.find((row) =>
            row.ownerId === owner.id &&
            (request.sessionId
              ? row.sessionId === request.sessionId
              : "paymentIntentId" in request && request.paymentIntentId
              ? row.paymentIntentId === request.paymentIntentId
              : "operationId" in request && request.operationId
              ? row.id === request.operationId
              : request.quoteToken
              ? row.id === request.quoteToken
              : "subscriptionId" in request && request.subscriptionId
              ? row.kind === "upgrade" &&
                row.subscriptionId === request.subscriptionId &&
                ["confirming", "pending", "completed"].includes(row.state)
              : false)
          );
          if (!op) {
            fail("not_found", "Pagamento não encontrado nesta conta.", 404);
          }
          if (request.action === "status") {
            if (request.plan !== undefined && op.plan !== request.plan) {
              fail(
                "plan_mismatch",
                "O plano deste pagamento não corresponde à solicitação.",
              );
            }
            if (
              request.subscriptionId &&
              op.subscriptionId !== request.subscriptionId
            ) fail("not_found", "Pagamento não encontrado nesta conta.", 404);
            return await status(op, lease);
          }
          if (op.kind === "upgrade") {
            if (op.state !== "quoted" && op.state !== "canceled") {
              return await status(op, lease);
            }
            op.state = "canceled";
            await save(owner.id, lease, op);
            return { kind: "canceled", plan: op.plan };
          }
          if (!op.sessionId) {
            fail(
              "operation_pending",
              "A preparação ainda está sendo confirmada. Tente novamente antes de encerrar.",
            );
          }
          const session = await stripe.checkout.sessions.retrieve(
            op.sessionId,
            {
              expand: ["line_items"],
            },
          );
          sessionOwned(session, op);
          if (session.status === "complete") return await status(op, lease);
          if (session.status === "open") {
            if (!await expireUnstarted(op, session, lease)) {
              return await status(op, lease);
            }
          }
          if (session.status !== "open" && session.status !== "expired") {
            return await status(op, lease);
          }
          op.state = "canceled";
          await save(owner.id, lease, op);
          return { kind: "canceled", plan: op.plan };
        }
        const profile = await repo.profile(owner.id);
        if (request.action === "confirm_upgrade") {
          const op = operations.find((row) =>
            row.id === request.quoteToken && row.ownerId === owner.id &&
            row.kind === "upgrade"
          );
          if (!op) fail("not_found", "Prévia não encontrada nesta conta.", 404);
          if (["canceled", "failed"].includes(op.state)) {
            fail(
              "quote_expired",
              "Esta prévia não está mais disponível. Confira o valor novamente.",
            );
          }
          if (op.state === "completed" || op.state === "pending") {
            return await upgradeResponse(op, lease);
          }
          if (op.state === "quoted") {
            if (op.expiresAt <= now()) {
              fail(
                "quote_expired",
                "Esta prévia expirou. Confira o valor novamente.",
              );
            }
            const sub = await stripe.subscriptions.retrieve(op.subscriptionId!);
            owned(sub, owner.id, op.customerId);
            if (
              profile.billing_id !== op.customerId || !accessible(sub, now()) ||
              exactPlan(sub) !== "pro" ||
              fingerprint(sub) !== op.quote!.subscriptionFingerprint
            ) {
              fail(
                "quote_changed",
                "A assinatura mudou. Confira o valor novamente antes de confirmar.",
              );
            }
            const target = await price("premium");
            const preview = await stripe.invoices.createPreview({
              customer: op.customerId,
              subscription: sub.id,
              subscription_details: {
                items: [{
                  id: sub.items.data[0].id,
                  price: STRIPE_PLANS.premium.priceId,
                }],
                proration_behavior: "always_invoice",
                proration_date: op.quote!.prorationDate,
              },
            });
            if (
              preview.currency !== "brl" ||
              money(preview.amount_due) !== op.quote!.amountDue ||
              target.recurringAmount !== op.quote!.recurringAmount
            ) {
              fail(
                "quote_changed",
                "O valor mudou. Confira uma nova prévia antes de confirmar.",
              );
            }
            const other = operations.find((row) =>
              row.id !== op.id && row.kind === "upgrade" &&
              ["confirming", "pending"].includes(row.state)
            );
            if (other) return await upgradeResponse(other, lease);
            op.state = "confirming";
            op.params = {
              items: [{
                id: sub.items.data[0].id,
                price: STRIPE_PLANS.premium.priceId,
              }],
              payment_behavior: "pending_if_incomplete",
              proration_behavior: "always_invoice",
              proration_date: op.quote!.prorationDate,
              expand: ["latest_invoice.confirmation_secret"],
            };
            // Durable exact params precede the only operation that may charge.
            await save(owner.id, lease, op);
          }
          if (now() - op.createdAt >= 23 * 60 * 60 * 1000) {
            fail(
              "confirmation_unknown",
              "Esta confirmação precisa ser revisada em Minha conta antes de tentar outro pagamento.",
            );
          }
          const updated = await stripe.subscriptions.update(
            op.subscriptionId!,
            op.params!,
            { idempotencyKey: `web-upgrade-v1:${op.id}` },
          );
          owned(updated, owner.id, op.customerId);
          op.invoiceId = id(updated.latest_invoice) ?? undefined;
          op.state = "pending";
          await save(owner.id, lease, op);
          return await upgradeResponse(op, lease);
        }
        // Active administrative grants are an entitlement, not a new charge.
        if (
          deps.uiMode !== "hosted" && profile.entitlement_source === "admin" &&
          profile.plan === request.plan &&
          Date.parse(profile.plan_expires_at ?? "") > now()
        ) return { kind: "active", plan: request.plan, status: "active" };
        const customerId = await customer(owner, profile);
        const sub = await subscriptionFor(customerId);
        if (sub) {
          owned(sub, owner.id, customerId);
          const currentPlan = exactPlan(sub);
          if (pendingWebDowngrade(profile, sub, now())) {
            return {
              kind: "manage",
              plan: "premium",
              message:
                "Sua mudança para Pro já está prevista para o fim do período pago. Revise essa mudança em Minha conta antes de iniciar outro pagamento.",
            };
          }
          const resumable = operations.find((op) =>
            op.kind === "checkout" && op.plan === request.plan &&
            op.sessionId && ["prepared", "pending"].includes(op.state)
          );
          if (sub.status === "incomplete" && resumable) {
            return await checkoutResponse(resumable, lease);
          }
          if (
            currentPlan === request.plan && !sub.pending_update &&
            accessible(sub, now()) &&
            await repo.sync(owner.id, sub, currentPlan)
          ) return { kind: "active", plan: currentPlan, status: sub.status };
          if (sub.pending_update) {
            const existing = operations.find((op) =>
              op.kind === "upgrade" && op.subscriptionId === sub.id &&
              ["pending", "confirming"].includes(op.state)
            );
            if (existing && request.plan === "premium") {
              return await upgradeResponse(existing, lease);
            }
          }
          if (
            currentPlan !== "pro" || request.plan !== "premium" ||
            sub.status !== "active" || sub.pending_update ||
            sub.cancel_at_period_end || sub.schedule ||
            sub.collection_method !== "charge_automatically"
          ) {
            return {
              kind: "manage",
              plan: currentPlan ?? profile.plan ?? "free",
              message:
                "Esta assinatura precisa ser revisada em Minha conta antes de mudar de plano.",
            };
          }
          const previous = operations.find((op) =>
            op.requestId === request.operationId
          );
          if (previous) {
            if (previous.kind !== "upgrade" || previous.plan !== request.plan) {
              fail(
                "operation_mismatch",
                "Esta operação já foi usada para outro pagamento.",
              );
            }
            if (
              previous.state === "quoted" && previous.expiresAt > now() &&
              previous.quote!.subscriptionFingerprint === fingerprint(sub)
            ) return quoteResponse(previous);
            if (
              ["confirming", "pending", "completed"].includes(previous.state)
            ) return await upgradeResponse(previous, lease);
            fail(
              "quote_expired",
              "Esta prévia expirou. Inicie uma nova solicitação.",
            );
          }
          const target = await price("premium"),
            prorationDate = Math.floor(now() / 1000);
          const preview = await stripe.invoices.createPreview({
            customer: customerId,
            subscription: sub.id,
            subscription_details: {
              items: [{
                id: sub.items.data[0].id,
                price: STRIPE_PLANS.premium.priceId,
              }],
              proration_behavior: "always_invoice",
              proration_date: prorationDate,
            },
          });
          if (preview.currency !== "brl") {
            fail(
              "invalid_price",
              "A moeda da assinatura não pôde ser confirmada.",
              503,
            );
          }
          const op: CheckoutOperation = {
            id: uuid(),
            ownerId: owner.id,
            requestId: request.operationId,
            kind: "upgrade",
            plan: "premium",
            state: "quoted",
            createdAt: now(),
            expiresAt: now() + 300_000,
            customerId,
            subscriptionId: sub.id,
            quote: {
              amountDue: money(preview.amount_due),
              recurringAmount: target.recurringAmount,
              currency: "brl",
              currentPlan: "pro",
              targetPlan: "premium",
              prorationDate,
              subscriptionFingerprint: fingerprint(sub),
            },
          };
          await save(owner.id, lease, op);
          return quoteResponse(op);
        }
        const previousRequest = operations.find((op) =>
          op.requestId === request.operationId
        );
        if (
          previousRequest &&
          (previousRequest.plan !== request.plan ||
            previousRequest.kind !== "checkout")
        ) {
          fail(
            "operation_mismatch",
            "Esta operação já foi usada para outro pagamento.",
          );
        }
        const unfinished = operations.find((op) =>
          op.kind === "checkout" &&
          ["creating", "prepared", "pending"].includes(op.state)
        );
        // A repeated client intent retains its own terminal receipt, even when
        // another tab has since opened a new checkout for the same plan.
        let op = previousRequest ?? unfinished;
        if (
          op?.state === "creating" && op.expiresAt <= now() && !op.sessionId
        ) {
          op.state = "failed";
          await save(owner.id, lease, op);
          if (op.requestId !== request.operationId) op = undefined;
        }
        if (op && ["completed", "canceled", "failed"].includes(op.state)) {
          return await status(op, lease);
        }
        if (deps.uiMode !== "hosted") {
          const recovery = await recoverCheckouts(
            owner.id,
            customerId,
            request.plan,
            request.operationId,
            operations,
            op,
            lease,
          );
          if (recovery.response) return recovery.response;
          // A client intent is never reused after its payment was retired.
          // A new user choice has a fresh request UUID and can create safely.
          if (
            op?.requestId === request.operationId && op.state === "canceled"
          ) {
            return await status(op, lease);
          }
          op = recovery.operation;
        }
        if (op && op.plan !== request.plan) {
          if (!op.sessionId) {
            fail(
              "operation_pending",
              "Há um pagamento sendo preparado. Aguarde a confirmação antes de trocar o plano.",
            );
          }
          const old = await stripe.checkout.sessions.retrieve(op.sessionId);
          sessionOwned(old, op);
          if (old.status === "complete") return await status(op, lease);
          if (old.status === "open") {
            return {
              kind: "manage",
              plan: op.plan,
              message:
                "Existe um pagamento anterior para outro plano. Revise esse pagamento antes de iniciar outro.",
            };
          }
          op.state = "canceled";
          await save(owner.id, lease, op);
          op = undefined;
        }
        if (op?.sessionId) return await checkoutResponse(op, lease);
        if (!op) {
          const listedSessions = deps.uiMode === "hosted"
            ? await stripe.checkout.sessions.list({
              customer: customerId,
              status: "open",
              limit: 100,
            })
            : { data: [], has_more: false };
          if (listedSessions.has_more) {
            fail(
              "billing_history_unavailable",
              "Não foi possível confirmar todos os pagamentos desta conta. Tente novamente em Minha conta.",
              503,
            );
          }
          const older = listedSessions.data.find((session) =>
            session.mode === "subscription" &&
            session.metadata?.user_id === owner.id
          );
          if (older) {
            return deps.uiMode === "hosted" && older.ui_mode === "hosted" &&
                older.metadata?.plan_type === request.plan
              ? { url: older.url, mode: "checkout" }
              : {
                kind: "manage",
                plan: older.metadata?.plan_type ?? request.plan,
                message:
                  "Existe um pagamento anterior nesta conta. Revise esse pagamento antes de iniciar outro.",
              };
          }
          const target = await price(request.plan);
          op = {
            id: uuid(),
            ownerId: owner.id,
            requestId: request.operationId,
            kind: "checkout",
            plan: request.plan,
            state: "creating",
            createdAt: now(),
            expiresAt: now() + 3600_000,
            customerId,
            quote: target,
          };
          op.params = {
            customer: customerId,
            mode: "subscription",
            ui_mode: deps.uiMode ?? "custom",
            payment_method_types: ["card"],
            line_items: [{
              price: STRIPE_PLANS[request.plan].priceId,
              quantity: 1,
            }],
            expires_at: Math.floor(op.expiresAt / 1000),
            return_url:
              `${deps.returnOrigin}/conta?subscription=return&billing_session_id={CHECKOUT_SESSION_ID}`,
            client_reference_id: owner.id,
            metadata: {
              user_id: owner.id,
              plan_type: request.plan,
              product_id: STRIPE_PLANS[request.plan].productId,
              web_checkout_operation: op.id,
            },
            subscription_data: {
              metadata: {
                user_id: owner.id,
                plan_type: request.plan,
                product_id: STRIPE_PLANS[request.plan].productId,
              },
            },
          };
          if (deps.uiMode === "hosted") {
            delete op.params.return_url;
            op.params.success_url =
              `${deps.returnOrigin}/conta?subscription=success`;
            op.params.cancel_url =
              `${deps.returnOrigin}/conta?subscription=canceled`;
          }
          await save(owner.id, lease, op);
        }
        await save(owner.id, lease, op);
        const session = await stripe.checkout.sessions.create(op.params!, {
          idempotencyKey: `web-checkout-v1:${op.id}`,
        });
        sessionOwned(session, op);
        op.sessionId = session.id;
        op.state = "prepared";
        await save(owner.id, lease, op);
        return await checkoutResponse(op, lease, session);
      } finally {
        try {
          if (!existingLease) await repo.release(owner.id, lease);
        } catch {
          /* The bounded lease expires; retain the payment result/error. */
        }
      }
    },
  };
}

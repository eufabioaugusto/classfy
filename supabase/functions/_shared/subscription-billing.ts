import { STRIPE_PLANS, type SubscriptionPlan } from "./stripe-subscription.ts";

// Contrato de leitura: Stripe 18.5.0 / API 2025-08-27.basil.
export const SUBSCRIPTION_BILLING_API_VERSION = "2025-08-27.basil";
type Json = Record<string, any>;
export class SubscriptionBillingError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}
export interface SubscriptionInvoice {
  id: string;
  number: string | null;
  status: "paid" | "open" | "uncollectible" | "void" | "draft";
  plan: SubscriptionPlan | null;
  createdAt: string;
  dueAt: string | null;
  paidAt: string | null;
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  currency: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
}
export interface SubscriptionBillingResult {
  invoices: SubscriptionInvoice[];
  nextCursor: string | null;
  subscription: null | {
    plan: SubscriptionPlan;
    status: string;
    cancelAtPeriodEnd: boolean;
    periodEnd: string | null;
    nextRenewal: null | {
      at: string;
      amountDue: number | null;
      currency: string | null;
    };
    paymentMethod: null | {
      type: "card";
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    };
  };
}
export interface SubscriptionBillingStripe {
  customers: { retrieve(id: string): Promise<Json> };
  subscriptions: {
    list(params: Json): Promise<{ data: Json[]; has_more?: boolean }>;
    retrieve(id: string): Promise<Json>;
  };
  invoices: {
    list(params: Json): Promise<{ data: Json[]; has_more?: boolean }>;
    createPreview(params: Json): Promise<Json>;
  };
  paymentMethods: { retrieve(id: string): Promise<Json> };
}
export interface SubscriptionBillingDependencies {
  profile(owner: string): Promise<{ billing_id: string | null } | null>;
  stripe: SubscriptionBillingStripe;
  cursorSecret: string;
  now?: () => number;
}

const reference = (value: unknown): string | null =>
  typeof value === "string" ? value : value && typeof value === "object" &&
      typeof (value as Json).id === "string"
    ? (value as Json).id
    : null;
function fail(code: string, message: string, status = 503): never {
  throw new SubscriptionBillingError(code, message, status);
}
const unavailable = () =>
  fail(
    "billing_unavailable",
    "Não foi possível consultar sua cobrança agora. Tente novamente.",
  );
const invalidCursor = () =>
  fail(
    "invalid_cursor",
    "Esta página do histórico expirou. Atualize a consulta.",
    400,
  );
const iso = (seconds: unknown): string | null => {
  if (
    typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0
  ) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const cents = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) unavailable();
  return Number(value);
};
const currency = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-z]{3}$/.test(value)) unavailable();
  return value as string;
};
const ownerBoundary = (resource: Json, owner: string, customer: string) => {
  if (
    reference(resource.customer) !== customer ||
    (resource.metadata?.user_id && resource.metadata.user_id !== owner)
  ) {
    fail(
      "billing_owner_mismatch",
      "Não foi possível confirmar a conta de cobrança.",
      403,
    );
  }
};
const planForPrice = (priceId: string | null, productId: string | null) =>
  Object.entries(STRIPE_PLANS).find(([, config]) =>
    config.priceId === priceId && config.productId === productId
  )?.[0] as SubscriptionPlan | undefined;
const subscriptionPlan = (sub: Json): SubscriptionPlan | null => {
  const items = sub.items?.data;
  if (
    !Array.isArray(items) || sub.items.has_more || items.length !== 1 ||
    items[0].quantity !== 1
  ) return null;
  return planForPrice(
    reference(items[0].price),
    reference(items[0].price?.product),
  ) ?? null;
};
const invoiceSubscription = (invoice: Json) =>
  reference(
    invoice.parent?.subscription_details?.subscription ?? invoice.subscription,
  );
function invoicePlans(invoice: Json) {
  // Basil substituiu line.price por pricing.price_details. Não rotular uma
  // fatura histórica Premium como Pro depois de um downgrade da assinatura.
  // Na leitura do histórico, um preço antigo do produto canônico continua
  // válido; o resumo da assinatura atual mantém preço E produto exatos.
  const plans = new Set<SubscriptionPlan>();
  for (const line of invoice.lines?.data ?? []) {
    const details = line.pricing?.price_details;
    const price = reference(details?.price ?? line.price);
    const product = reference(details?.product ?? line.price?.product);
    const plan = price
      ? Object.entries(STRIPE_PLANS).find(([, config]) =>
        config.productId === product
      )?.[0] as SubscriptionPlan | undefined
      : undefined;
    if (plan) plans.add(plan);
  }
  return {
    hasClassfyProduct: plans.size > 0,
    plan: plans.size === 1 && !invoice.lines?.has_more ? [...plans][0] : null,
  };
}
const stripeUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
        !url.port &&
        (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"))
      ? url.href
      : null;
  } catch {
    return null;
  }
};
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_")
    .replace(/=+$/, "");
const decode = (value: string) =>
  Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (char) => char.charCodeAt(0),
  );
const encoder = new TextEncoder();

export function createSubscriptionBillingService(
  deps: SubscriptionBillingDependencies,
) {
  const now = deps.now ?? Date.now;
  let key: Promise<CryptoKey> | undefined;
  const getKey = () =>
    key ??= crypto.subtle.importKey(
      "raw",
      encoder.encode(deps.cursorSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  const signCursor = async (
    owner: string,
    customer: string,
    after: string,
    status: string,
  ) => {
    const payload = encode(
      encoder.encode(
        JSON.stringify({
          v: 1,
          owner,
          customer,
          after,
          status,
          expires: now() + 3_600_000,
        }),
      ),
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      await getKey(),
      encoder.encode(`subscription-billing:${payload}`),
    );
    return `${payload}.${encode(new Uint8Array(signature))}`;
  };
  const readCursor = async (
    value: string,
    owner: string,
    customer: string,
    status: string,
  ) => {
    try {
      const parts = value.split(".");
      if (
        parts.length !== 2 || !/^[\w-]+$/.test(parts[0]) ||
        !/^[\w-]+$/.test(parts[1])
      ) return invalidCursor();
      if (
        !await crypto.subtle.verify(
          "HMAC",
          await getKey(),
          decode(parts[1]),
          encoder.encode(`subscription-billing:${parts[0]}`),
        )
      ) return invalidCursor();
      const payload = JSON.parse(new TextDecoder().decode(decode(parts[0])));
      if (
        payload.v !== 1 || payload.owner !== owner ||
        payload.customer !== customer || payload.status !== status ||
        !Number.isFinite(payload.expires) || payload.expires <= now() ||
        !/^in_[a-zA-Z0-9]+$/.test(payload.after)
      ) return invalidCursor();
      return payload.after as string;
    } catch {
      return invalidCursor();
    }
  };

  return {
    async read(
      owner: string,
      raw: unknown,
    ): Promise<SubscriptionBillingResult> {
      if (!owner) {
        fail(
          "unauthorized",
          "Entre na sua conta para consultar a cobrança.",
          401,
        );
      }
      if (!deps.cursorSecret) {
        fail(
          "billing_not_configured",
          "A consulta de cobrança não está configurada.",
        );
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        fail("invalid_request", "Solicitação inválida.", 400);
      }
      const request = raw as Json;
      if (
        Object.keys(request).some((name) =>
          !["cursor", "limit", "status"].includes(name)
        ) ||
        (request.status !== undefined &&
          !["all", "paid", "pending"].includes(request.status)) ||
        (request.cursor !== undefined &&
          (typeof request.cursor !== "string" ||
            request.cursor.length > 2048)) ||
        (request.limit !== undefined &&
          (!Number.isInteger(request.limit) || request.limit < 1 ||
            request.limit > 25))
      ) {
        fail("invalid_request", "Solicitação inválida.", 400);
      }
      try {
        const profile = await deps.profile(owner);
        if (!profile) fail("account_not_found", "Conta não encontrada.", 404);
        const customerId = profile.billing_id;
        if (!customerId) {
          if (request.cursor) invalidCursor();
          return { invoices: [], nextCursor: null, subscription: null };
        }
        if (!/^cus_[a-zA-Z0-9]+$/.test(customerId)) unavailable();
        const filter = request.status ?? "all";
        const limit = request.limit ?? 10;
        const after = request.cursor
          ? await readCursor(request.cursor, owner, customerId, filter)
          : undefined;
        const customer = await deps.stripe.customers.retrieve(customerId);
        if (
          customer.deleted || customer.id !== customerId ||
          (customer.metadata?.user_id && customer.metadata.user_id !== owner)
        ) {
          fail(
            "billing_owner_mismatch",
            "Não foi possível confirmar a conta de cobrança.",
            403,
          );
        }
        const listInvoices = (after?: string) =>
          deps.stripe.invoices.list({
            customer: customerId,
            limit,
            ...filter === "paid" ? { status: "paid" } : {},
            ...after ? { starting_after: after } : {},
          });
        const [subscriptions, firstPage] = await Promise.all([
          deps.stripe.subscriptions.list({
            customer: customerId,
            status: "all",
            limit: 100,
          }),
          listInvoices(after),
        ]);
        if (subscriptions.has_more) unavailable();
        const known = new Map<string, Json>();
        for (const sub of subscriptions.data) {
          ownerBoundary(sub, owner, customerId);
          known.set(sub.id, sub);
        }
        const invoices: SubscriptionInvoice[] = [];
        let page = firstPage, lastId: string | undefined, more = false;
        // Pendentes une open+uncollectible, sem filtrar apenas a página visível.
        // O cursor avança pelo último registro percorrido; o teto de 5 páginas
        // mantém a consulta limitada sem pular faturas de uma página posterior.
        pages: for (let scan = 0; scan < 5; scan++) {
          if (page.has_more && page.data.length === 0) unavailable();
          for (const [index, invoice] of page.data.entries()) {
            ownerBoundary(invoice, owner, customerId);
            if (!/^in_[a-zA-Z0-9]+$/.test(invoice.id ?? "")) unavailable();
            lastId = invoice.id;
            more = index < page.data.length - 1 || !!page.has_more;
            if (
              filter === "paid" && invoice.status !== "paid" ||
              filter === "pending" &&
                !["open", "uncollectible"].includes(invoice.status)
            ) continue;
            const subId = invoiceSubscription(invoice);
            if (!subId) continue; // Carteira, compras avulsas e faturas manuais não são assinatura.
            const snapshotOwner = invoice.parent?.subscription_details?.metadata
              ?.user_id;
            if (snapshotOwner && snapshotOwner !== owner) {
              fail(
                "billing_owner_mismatch",
                "Não foi possível confirmar a conta de cobrança.",
                403,
              );
            }
            const pricing = invoicePlans(invoice);
            // Metadata de plano não prova cobrança Classfy. A linha precisa
            // referenciar preço real e produto canônico, inclusive preços antigos.
            if (!pricing.hasClassfyProduct) continue;
            let sub = known.get(subId);
            if (!sub) {
              sub = await deps.stripe.subscriptions.retrieve(subId);
              ownerBoundary(sub, owner, customerId);
              known.set(subId, sub);
            }
            if (
              !/^in_[a-zA-Z0-9]+$/.test(invoice.id ?? "") ||
              !["paid", "open", "uncollectible", "void", "draft"].includes(
                invoice.status,
              )
            ) unavailable();
            const createdAt = iso(invoice.created);
            if (!createdAt) unavailable();
            invoices.push({
              id: invoice.id,
              number: typeof invoice.number === "string"
                ? invoice.number
                : null,
              status: invoice.status,
              plan: pricing.plan,
              createdAt: createdAt!,
              dueAt: iso(invoice.due_date),
              paidAt: iso(invoice.status_transitions?.paid_at),
              amountDue: cents(invoice.amount_due),
              amountPaid: cents(invoice.amount_paid),
              amountRemaining: cents(invoice.amount_remaining),
              currency: currency(invoice.currency),
              pdfUrl: invoice.status === "draft"
                ? null
                : stripeUrl(invoice.invoice_pdf),
              hostedUrl: invoice.status === "draft"
                ? null
                : stripeUrl(invoice.hosted_invoice_url),
            });
            if (invoices.length >= limit) break pages;
          }
          if (!page.has_more || scan === 4) break;
          if (!lastId) unavailable();
          page = await listInvoices(lastId);
        }
        const current = subscriptions.data.filter((sub) =>
          subscriptionPlan(sub) &&
          !["canceled", "incomplete_expired"].includes(sub.status)
        );
        if (current.length > 1) {
          fail(
            "multiple_subscriptions",
            "Há mais de uma assinatura nesta conta. Revise sua assinatura antes de consultar a próxima cobrança.",
            409,
          );
        }
        let summary: SubscriptionBillingResult["subscription"] = null;
        const sub = current[0];
        if (sub) {
          const periodEnd = iso(
            sub.current_period_end ?? sub.items.data[0].current_period_end,
          );
          let paymentMethod: NonNullable<
            SubscriptionBillingResult["subscription"]
          >["paymentMethod"] = null;
          const methodId = reference(
            sub.default_payment_method ??
              customer.invoice_settings?.default_payment_method,
          );
          if (methodId) {
            const method = await deps.stripe.paymentMethods.retrieve(methodId);
            ownerBoundary(method, owner, customerId);
            const card = method.card;
            if (
              method.type === "card" && card && /^[0-9]{4}$/.test(card.last4) &&
              typeof card.brand === "string" &&
              Number.isInteger(card.exp_month) && card.exp_month >= 1 &&
              card.exp_month <= 12 &&
              Number.isInteger(card.exp_year) && card.exp_year >= 2000 &&
              card.exp_year < 10000
            ) {
              paymentMethod = {
                type: "card",
                brand: card.brand,
                last4: card.last4,
                expMonth: card.exp_month,
                expYear: card.exp_year,
              };
            }
          }
          let nextRenewal: NonNullable<
            SubscriptionBillingResult["subscription"]
          >["nextRenewal"] = null;
          if (
            ["active", "trialing"].includes(sub.status) && periodEnd &&
            Date.parse(periodEnd) > now() &&
            !sub.cancel_at_period_end && !sub.cancel_at &&
            !sub.pause_collection && !sub.pending_update
          ) {
            nextRenewal = { at: periodEnd, amountDue: null, currency: null };
            try {
              // createPreview é somente leitura: não cria fatura pagável, nem
              // altera assinatura, desconto, preço ou entitlement.
              const preview = await deps.stripe.invoices.createPreview({
                customer: customerId,
                subscription: sub.id,
              });
              ownerBoundary(preview, owner, customerId);
              nextRenewal.amountDue = cents(preview.amount_due);
              nextRenewal.currency = currency(preview.currency);
            } catch (error) {
              if (error instanceof SubscriptionBillingError) throw error;
              // O histórico continua disponível; não inventar valor por tabela.
            }
          }
          summary = {
            plan: subscriptionPlan(sub)!,
            status: sub.status,
            cancelAtPeriodEnd: !!sub.cancel_at_period_end,
            periodEnd,
            nextRenewal,
            paymentMethod,
          };
        }
        return {
          invoices,
          subscription: summary,
          nextCursor: more && lastId
            ? await signCursor(owner, customerId, lastId, filter)
            : null,
        };
      } catch (error) {
        if (error instanceof SubscriptionBillingError) throw error;
        return unavailable();
      }
    },
  };
}

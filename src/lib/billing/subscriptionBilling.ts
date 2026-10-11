import { supabase } from '@/integrations/supabase/client';

export type SubscriptionBillingFilter = 'all' | 'paid' | 'pending';
export type SubscriptionInvoice = {
  id: string;
  number: string | null;
  status: 'paid' | 'open' | 'uncollectible' | 'void' | 'draft';
  plan: 'pro' | 'premium' | null;
  createdAt: string;
  dueAt: string | null;
  paidAt: string | null;
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  currency: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
};
export type SubscriptionBillingPage = {
  invoices: SubscriptionInvoice[];
  nextCursor: string | null;
  subscription: null | {
    plan: 'pro' | 'premium';
    status: string;
    cancelAtPeriodEnd: boolean;
    periodEnd: string | null;
    nextRenewal: null | { at: string; amountDue: number | null; currency: string | null };
    paymentMethod: null | { type: 'card'; brand: string; last4: string; expMonth: number; expYear: number };
  };
};

export class SubscriptionBillingError extends Error {}
const INVALID = 'Os dados da cobrança não puderam ser confirmados. Tente novamente.';
const SESSION = 'Sua sessão mudou. Entre novamente para consultar suas cobranças.';
const DEADLINE = 20_000;
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SubscriptionBillingError(INVALID);
  return value as RecordValue;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 500) throw new SubscriptionBillingError(INVALID);
  return value;
}
function date(value: unknown, nullable = true): string | null {
  if (nullable && value === null) return null;
  const text = string(value);
  if (!Number.isFinite(Date.parse(text))) throw new SubscriptionBillingError(INVALID);
  return text;
}
function amount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new SubscriptionBillingError(INVALID);
  return Number(value);
}
function currency(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z]{3}$/.test(value)) throw new SubscriptionBillingError(INVALID);
  return value;
}
function plan(value: unknown, nullable = false): 'pro' | 'premium' | null {
  if (nullable && value === null) return null;
  if (value !== 'pro' && value !== 'premium') throw new SubscriptionBillingError(INVALID);
  return value;
}

/** Only API-provided invoice links are displayed. Never build an invoice URL from an ID. */
export function trustedSubscriptionInvoiceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['invoice.stripe.com', 'pay.stripe.com', 'files.stripe.com'].includes(url.hostname)
      ? url.href : null;
  } catch { return null; }
}

function parsePage(value: unknown): SubscriptionBillingPage {
  const data = record(value);
  if (!Array.isArray(data.invoices) || data.invoices.length > 25) throw new SubscriptionBillingError(INVALID);
  const invoices = data.invoices.map(item => {
    const row = record(item), id = string(row.id);
    if (!/^in_[a-zA-Z0-9]+$/.test(id) || !['paid', 'open', 'uncollectible', 'void', 'draft'].includes(String(row.status))) throw new SubscriptionBillingError(INVALID);
    return {
      id, number: row.number === null ? null : string(row.number), status: row.status as SubscriptionInvoice['status'],
      plan: plan(row.plan, true), createdAt: date(row.createdAt, false)!, dueAt: date(row.dueAt), paidAt: date(row.paidAt),
      amountDue: amount(row.amountDue), amountPaid: amount(row.amountPaid), amountRemaining: amount(row.amountRemaining), currency: currency(row.currency),
      pdfUrl: row.status === 'draft' ? null : trustedSubscriptionInvoiceUrl(row.pdfUrl),
      hostedUrl: row.status === 'draft' ? null : trustedSubscriptionInvoiceUrl(row.hostedUrl),
    };
  });
  if (new Set(invoices.map(invoice => invoice.id)).size !== invoices.length) throw new SubscriptionBillingError(INVALID);
  let subscription: SubscriptionBillingPage['subscription'] = null;
  if (data.subscription !== null) {
    const source = record(data.subscription);
    if (typeof source.cancelAtPeriodEnd !== 'boolean') throw new SubscriptionBillingError(INVALID);
    let nextRenewal: NonNullable<SubscriptionBillingPage['subscription']>['nextRenewal'] = null;
    if (source.nextRenewal !== null) {
      const next = record(source.nextRenewal);
      nextRenewal = { at: date(next.at, false)!, amountDue: next.amountDue === null ? null : amount(next.amountDue), currency: next.currency === null ? null : currency(next.currency) };
    }
    let paymentMethod: NonNullable<SubscriptionBillingPage['subscription']>['paymentMethod'] = null;
    if (source.paymentMethod !== null) {
      const method = record(source.paymentMethod);
      if (method.type === 'card' && typeof method.brand === 'string' && method.brand.length <= 40
        && typeof method.last4 === 'string' && /^\d{4}$/.test(method.last4)
        && Number.isInteger(method.expMonth) && Number(method.expMonth) >= 1 && Number(method.expMonth) <= 12
        && Number.isInteger(method.expYear) && Number(method.expYear) >= 2000 && Number(method.expYear) < 10000) {
        paymentMethod = { type: 'card', brand: method.brand, last4: method.last4, expMonth: Number(method.expMonth), expYear: Number(method.expYear) };
      }
    }
    subscription = { plan: plan(source.plan)!, status: string(source.status), cancelAtPeriodEnd: source.cancelAtPeriodEnd,
      periodEnd: date(source.periodEnd), nextRenewal, paymentMethod };
  }
  if (data.nextCursor !== null && (typeof data.nextCursor !== 'string' || !data.nextCursor || data.nextCursor.length > 2048)) throw new SubscriptionBillingError(INVALID);
  return { invoices, subscription, nextCursor: data.nextCursor as string | null };
}

/** Stripe invoice amounts are minor units; ISK/UGX retain the two-decimal API representation. */
export function formatSubscriptionBillingAmount(value: number, code: string): string {
  const upper = code.toUpperCase();
  const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: upper });
  const decimals = ['ISK', 'UGX', 'HUF', 'TWD'].includes(upper) ? 2 : formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(value / (10 ** decimals));
}

export async function readSubscriptionBilling(ownerId: string, options: {
  cursor?: string; status?: SubscriptionBillingFilter; limit?: number; signal?: AbortSignal;
} = {}): Promise<SubscriptionBillingPage> {
  const { signal } = options;
  if (signal?.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const check = () => { if (controller.signal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError'); };
  const currentSession = async () => {
    check();
    const { data, error } = await supabase.auth.getSession();
    check();
    if (!ownerId || error || data.session?.user.id !== ownerId || !data.session.access_token) throw new SubscriptionBillingError(SESSION);
    return data.session.access_token;
  };
  try {
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => { controller.abort(); reject(new DOMException('Consulta cancelada.', 'AbortError')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => { controller.abort(); reject(new SubscriptionBillingError('A consulta demorou mais que o esperado. Tente novamente.')); }, DEADLINE);
    });
    const request = async () => {
      const token = await currentSession();
      const verified = await supabase.auth.getUser(token);
      check();
      if (verified.error || verified.data.user?.id !== ownerId) throw new SubscriptionBillingError(SESSION);
      await currentSession();
      const { data, error } = await supabase.functions.invoke('subscription-billing', {
        body: { status: options.status ?? 'all', limit: options.limit ?? 10, ...(options.cursor ? { cursor: options.cursor } : {}) },
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      await currentSession();
      if (error) {
        let message = 'Não foi possível consultar suas cobranças. Tente novamente.';
        try {
          if (error.context instanceof Response) {
            const payload = await error.context.clone().json();
            check();
            if (typeof payload?.error === 'string') message = payload.error;
          }
        } catch { check(); }
        throw new SubscriptionBillingError(message);
      }
      return parsePage(data);
    };
    return await Promise.race([request(), interrupted]);
  } finally {
    clearTimeout(timeout);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

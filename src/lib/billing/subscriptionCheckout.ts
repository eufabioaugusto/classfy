import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { supabase } from '@/integrations/supabase/client';

export type BillingPlan = 'pro' | 'premium';
type Amounts = { plan: BillingPlan; amountDue: number; recurringAmount: number; currency: string };
export type CheckoutFlow = Amounts & { kind: 'checkout'; sessionId: string; clientSecret: string; publishableKey: string; expiresAt: string };
export type UpgradeQuote = Amounts & { kind: 'upgrade_quote'; currentPlan: 'pro'; quoteToken: string; prorationDate: number; expiresAt: string };
export type UpgradePaymentFlow = Amounts & { kind: 'upgrade_payment'; operationId?: string; subscriptionId: string; paymentIntentId: string | null; clientSecret: string | null; publishableKey: string; status: 'requires_action' | 'requires_payment_method' | 'processing' | 'active' };
export type PreparedSubscription = CheckoutFlow | UpgradeQuote | UpgradePaymentFlow | SubscriptionStatus | { kind: 'active'; plan: BillingPlan; status: string } | { kind: 'manage'; message: string };
export type SubscriptionStatus = BillingStatusReference & { kind: 'status'; state: 'active' | 'pending' | 'expired' | 'failed'; plan: BillingPlan; effectivePlan?: 'free' | BillingPlan; expiresAt?: string; message?: string };
export type BillingStatusReference = { plan?: BillingPlan; operationId?: string; sessionId?: string; subscriptionId?: string; paymentIntentId?: string | null };
export class SubscriptionCheckoutError extends Error {}

/** Routing hint only; the server still verifies the subscription before charging or granting access. */
export function hasCurrentPaidPlan(profile: { plan: string; plan_expires_at?: string | null } | null | undefined) {
  return !!profile && ['pro', 'premium'].includes(profile.plan)
    && (!profile.plan_expires_at || Date.parse(profile.plan_expires_at) > Date.now());
}

const DEADLINE = 20_000;
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Solicitação cancelada.', 'AbortError');
}
async function bounded<T>(signal: AbortSignal | undefined, task: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  cancelled(signal);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => { controller.abort(); reject(new DOMException('Solicitação cancelada.', 'AbortError')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => { controller.abort(); reject(new SubscriptionCheckoutError('A confirmação demorou mais que o esperado. Verifique o pagamento antes de tentar novamente.')); }, DEADLINE);
    });
    const result = await Promise.race([Promise.resolve(task(controller.signal)), interrupted]);
    cancelled(signal);
    return result;
  } finally {
    clearTimeout(timeout);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
async function ownerSession(owner: string, signal?: AbortSignal) {
  const { data, error } = await bounded(signal, () => supabase.auth.getSession());
  if (!owner || error || data.session?.user.id !== owner || !data.session.access_token) {
    throw new SubscriptionCheckoutError('Sua sessão mudou. Entre novamente para continuar.');
  }
  return data.session.access_token;
}
async function invoke(owner: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const token = await ownerSession(owner, signal);
  const verified = await bounded(signal, () => supabase.auth.getUser(token));
  if (verified.error || verified.data.user?.id !== owner) throw new SubscriptionCheckoutError('Entre novamente para continuar a assinatura.');
  const { data, error } = await bounded(signal, requestSignal => supabase.functions.invoke('web-subscription-checkout', {
    body, signal: requestSignal, headers: { Authorization: `Bearer ${token}` },
  }));
  await ownerSession(owner, signal);
  if (error) {
    let message = 'Não foi possível confirmar a solicitação. Verifique sua assinatura antes de tentar novamente.';
    try {
      const response = error.context;
      if (response instanceof Response) {
        const payload = await response.clone().json();
        if (typeof payload?.error === 'string') message = payload.error;
      }
    } catch { /* Keep the bounded, user-facing message. */ }
    throw new SubscriptionCheckoutError(message);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SubscriptionCheckoutError('A resposta da assinatura não pôde ser confirmada.');
  return data;
}
function validateAmounts(data: Record<string, unknown>) {
  if (!['pro', 'premium'].includes(String(data.plan)) || data.currency !== 'brl'
    || !Number.isSafeInteger(data.amountDue) || Number(data.amountDue) < 0
    || !Number.isSafeInteger(data.recurringAmount) || Number(data.recurringAmount) <= 0) {
    throw new SubscriptionCheckoutError('Os valores da assinatura não puderam ser confirmados.');
  }
}
function requireString(data: Record<string, unknown>, key: string) {
  if (typeof data[key] !== 'string' || !data[key]) throw new SubscriptionCheckoutError('A assinatura não pôde ser preparada. Tente novamente.');
}
export async function prepareSubscriptionCheckout(owner: string, plan: BillingPlan, operationId: string, signal?: AbortSignal): Promise<PreparedSubscription> {
  const data = await invoke(owner, { action: 'prepare', plan, operationId }, signal);
  if (data.kind === 'active' && data.plan === plan) return data as PreparedSubscription;
  if (data.kind === 'manage' && typeof data.message === 'string') return data as PreparedSubscription;
  if (data.kind === 'status' && ['active', 'pending', 'expired', 'failed'].includes(String(data.state)) && data.plan === plan) return data as SubscriptionStatus;
  validateAmounts(data);
  if (data.plan !== plan) throw new SubscriptionCheckoutError('O plano solicitado não pôde ser confirmado.');
  if (data.kind === 'upgrade_payment') {
    requireString(data, 'subscriptionId');
    requireString(data, 'publishableKey');
    if (!['requires_action', 'requires_payment_method', 'processing', 'active'].includes(String(data.status))) throw new SubscriptionCheckoutError('O pagamento não pôde ser retomado.');
    return data as UpgradePaymentFlow;
  }
  if (!Number.isFinite(Date.parse(String(data.expiresAt)))) throw new SubscriptionCheckoutError('A validade do pagamento não pôde ser confirmada.');
  if (data.kind === 'checkout') {
    ['sessionId', 'clientSecret', 'publishableKey'].forEach(key => requireString(data, key));
  } else if (data.kind === 'upgrade_quote') {
    requireString(data, 'quoteToken');
  } else throw new SubscriptionCheckoutError('O pagamento não pôde ser preparado.');
  return data as PreparedSubscription;
}
export async function confirmSubscriptionUpgrade(owner: string, quoteToken: string, operationId: string, signal?: AbortSignal): Promise<UpgradePaymentFlow> {
  const data = await invoke(owner, { action: 'confirm_upgrade', quoteToken, operationId }, signal);
  validateAmounts(data);
  if (data.kind !== 'upgrade_payment' || data.plan !== 'premium'
    || !['requires_action', 'requires_payment_method', 'processing', 'active'].includes(String(data.status))) throw new SubscriptionCheckoutError('Não foi possível confirmar a mudança de plano.');
  requireString(data, 'subscriptionId');
  requireString(data, 'publishableKey');
  return data as UpgradePaymentFlow;
}
export async function readSubscriptionCheckoutStatus(owner: string, flow: BillingStatusReference, signal?: AbortSignal): Promise<SubscriptionStatus> {
  const reference = flow.sessionId ? { sessionId: flow.sessionId } : flow.operationId ? { operationId: flow.operationId } : { paymentIntentId: flow.paymentIntentId ?? undefined };
  const data = await invoke(owner, { action: 'status', plan: flow.plan, subscriptionId: flow.subscriptionId, ...reference }, signal);
  if (data.kind !== 'status' || !['active', 'pending', 'expired', 'failed'].includes(String(data.state))
    || !['pro', 'premium'].includes(String(data.plan))) throw new SubscriptionCheckoutError('Não foi possível confirmar o resultado do pagamento.');
  return data as SubscriptionStatus;
}
export async function requestSubscriptionCheckoutCancel(owner: string, sessionId: string, signal?: AbortSignal): Promise<void> {
  await invoke(owner, { action: 'cancel', sessionId }, signal);
}
const loaders = new Map<string, Promise<Stripe | null>>();
export function loadBillingStripe(key: string): Promise<Stripe | null> {
  if (!/^pk_(test|live)_[A-Za-z0-9]+$/.test(key)) return Promise.reject(new SubscriptionCheckoutError('O pagamento está temporariamente indisponível.'));
  if (!loaders.has(key)) {
    const promise = bounded(undefined, () => loadStripe(key, { locale: 'pt-BR' })).catch(error => { loaders.delete(key); throw error; });
    loaders.set(key, promise);
  }
  return loaders.get(key)!;
}

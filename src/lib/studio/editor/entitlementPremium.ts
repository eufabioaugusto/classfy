import { supabase } from '@/integrations/supabase/client';

export type StudioPremiumProfile = {
  id: string;
  plan: 'free' | 'pro' | 'premium';
  plan_expires_at: string | null;
  entitlement_source: string;
  subscription_status: string;
  subscription_grace_until: string | null;
  stripe_subscription_id: string | null;
};
export type StudioPremiumAccess = {
  canUseScenes: boolean;
  effectivePlan: 'free' | 'pro' | 'premium';
  expiresAt: number | null;
  reason: 'active' | 'inactive' | 'expired' | 'unknown';
};
export type StudioPremiumScope = { signal?: AbortSignal; isCurrent?: () => boolean };
export class StudioPremiumError extends Error {}
const DEADLINE_MS = 15_000;
const PROFILE_FIELDS = 'id,plan,plan_expires_at,entitlement_source,subscription_status,subscription_grace_until,stripe_subscription_id';
const expiry = (value: string | null | undefined) => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** Mirrors the existing subscription entitlement rules; an admin role is not a plan. */
export function studioPremiumAccess(profile: StudioPremiumProfile | null | undefined, now = Date.now()): StudioPremiumAccess {
  const denied = (reason: StudioPremiumAccess['reason']): StudioPremiumAccess => ({ canUseScenes: false, effectivePlan: 'free', expiresAt: null, reason });
  if (!profile || !Number.isFinite(now) || !['free', 'pro', 'premium'].includes(profile.plan)
    || !['free', 'stripe', 'admin', 'legacy'].includes(profile.entitlement_source)) return denied('unknown');
  if (profile.plan === 'free' || profile.entitlement_source === 'free') return denied('inactive');
  // A current administrative grant is independent from Stripe status, just as
  // sync_subscription_state_v1 preserves that grant until its explicit expiry.
  if (profile.entitlement_source !== 'admin' && !['active', 'trialing', 'past_due', 'canceled'].includes(profile.subscription_status)) return denied('inactive');
  const until = expiry(profile.entitlement_source !== 'admin' && profile.subscription_status === 'past_due'
    ? profile.subscription_grace_until : profile.plan_expires_at);
  if (until === null) return denied('unknown');
  if (until <= now) return denied('expired');
  return { canUseScenes: profile.plan === 'premium', effectivePlan: profile.plan, expiresAt: until, reason: 'active' };
}

function assertScope(scope: StudioPremiumScope) {
  if (scope.signal?.aborted || scope.isCurrent?.() === false) throw new DOMException('Consulta cancelada.', 'AbortError');
}
async function bounded<T>(scope: StudioPremiumScope, task: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  assertScope(scope);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => { controller.abort(); reject(new DOMException('Consulta cancelada.', 'AbortError')); };
      scope.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new StudioPremiumError('A confirmação demorou mais que o esperado. Tente novamente.')); }, DEADLINE_MS);
    });
    const result = await Promise.race([Promise.resolve(task(controller.signal)), cancelled]);
    assertScope(scope); return result;
  } finally { clearTimeout(timer); if (abort) scope.signal?.removeEventListener('abort', abort); }
}
async function assertOwner(owner: string, scope: StudioPremiumScope) {
  if (!owner) throw new StudioPremiumError('Entre na sua conta para confirmar o plano.');
  const session = await bounded(scope, () => supabase.auth.getSession());
  const token = session.data.session?.access_token;
  if (session.error || session.data.session?.user.id !== owner || !token) throw new StudioPremiumError('Sua sessão mudou. Entre novamente para confirmar o plano.');
  const { data, error } = await bounded(scope, () => supabase.auth.getUser(token));
  if (error || data.user?.id !== owner) throw new StudioPremiumError('Sua sessão mudou. Entre novamente para confirmar o plano.');
  return token;
}

export async function readStudioPremiumProfile(owner: string, scope: StudioPremiumScope = {}, verifySubscription = false): Promise<StudioPremiumProfile> {
  const token = await assertOwner(owner, scope);
  if (verifySubscription) {
    const { error } = await bounded(scope, signal => supabase.functions.invoke('verify-subscription', { signal, headers: { Authorization: `Bearer ${token}` } }));
    if (error) throw new StudioPremiumError('Não foi possível verificar a assinatura. Tente novamente.');
  }
  const { data, error } = await bounded(scope, signal => supabase.from('profiles').select(PROFILE_FIELDS).eq('id', owner).abortSignal(signal).single());
  if (error || !data || data.id !== owner) throw new StudioPremiumError('Não foi possível confirmar seu plano. Tente novamente.');
  // Confirm the local session once more before adopting a response that might
  // have crossed an account change. The caller supplies its focus/owner epoch.
  const session = await bounded(scope, () => supabase.auth.getSession());
  if (session.error || session.data.session?.user.id !== owner) throw new StudioPremiumError('Sua sessão mudou. Entre novamente para confirmar o plano.');
  assertScope(scope);
  return data as StudioPremiumProfile;
}

export function studioPremiumCheckout(profile: StudioPremiumProfile) {
  const access = studioPremiumAccess(profile);
  if (profile.entitlement_source === 'stripe' && profile.stripe_subscription_id) {
    if (profile.plan === 'premium') return { name: 'customer-portal', body: undefined };
    if (access.effectivePlan === 'pro') return { name: 'manage-subscription', body: { action: 'upgrade', newPlan: 'premium' } };
  }
  return { name: 'create-subscription-checkout', body: { plan: 'premium' } };
}

export async function requestStudioPremiumCheckout(owner: string, scope: StudioPremiumScope = {}): Promise<{ url?: string; message?: string; alreadyActive?: boolean }> {
  const profile = await readStudioPremiumProfile(owner, scope);
  if (studioPremiumAccess(profile).canUseScenes) return { alreadyActive: true };
  const command = studioPremiumCheckout(profile);
  const token = await assertOwner(owner, scope);
  assertScope(scope);
  const { data, error } = await bounded(scope, signal => supabase.functions.invoke(command.name, { body: command.body, signal, headers: { Authorization: `Bearer ${token}` } }));
  if (error) throw new StudioPremiumError('Não foi possível confirmar a solicitação. Verifique sua assinatura antes de tentar novamente.');
  if (data?.url) {
    try {
      const url = new URL(data.url);
      if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw new Error();
      return { url: url.href };
    } catch { throw new StudioPremiumError('Não foi possível abrir a assinatura com segurança. Tente novamente.'); }
  }
  if (data?.success) return { message: 'Solicitação recebida. O Premium será liberado após a confirmação do pagamento.' };
  throw new StudioPremiumError('Não foi possível abrir a assinatura. Tente novamente.');
}

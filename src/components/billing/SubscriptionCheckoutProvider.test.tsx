import { StrictMode, act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionCheckoutProvider, useSubscriptionCheckout } from './SubscriptionCheckoutProvider';

// Provider, dialog, router and operation ownership are real. Auth identity,
// server responses and Stripe iframe methods are isolated boundaries.
const boundary = vi.hoisted(() => ({
  auth: { user: { id: 'owner-one' } as { id: string } | null, loading: false, profile: { plan: 'free', plan_expires_at: null as string | null }, refreshProfile: vi.fn() },
  status: vi.fn(), prepare: vi.fn(), cancel: vi.fn(), confirm: vi.fn(), load: vi.fn(), upgrade: vi.fn(), callback: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => boundary.auth }));
vi.mock('@/lib/billing/subscriptionCheckout', async () => ({
  hasCurrentPaidPlan: (await vi.importActual<typeof import('@/lib/billing/subscriptionCheckout')>('@/lib/billing/subscriptionCheckout')).hasCurrentPaidPlan,
  readSubscriptionCheckoutStatus: boundary.status, prepareSubscriptionCheckout: boundary.prepare,
  requestSubscriptionCheckoutCancel: boundary.cancel, loadBillingStripe: boundary.load, confirmSubscriptionUpgrade: boundary.upgrade,
}));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutProvider: ({ children }: { children: React.ReactNode }) => children,
  useCheckout: () => ({ type: 'success', checkout: { confirm: boundary.confirm } }),
  PaymentElement: function StripeFrame({ onReady }: { onReady(): void }) { useEffect(() => { onReady(); }, []); return <input aria-label="Cartão seguro do Stripe" />; },
}));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => children,
  useStripe: () => ({}), useElements: () => ({}), PaymentElement: () => null,
}));

let root: Root, host: HTMLDivElement;
const checkout = { kind: 'checkout', plan: 'premium', sessionId: 'cs_test_fixture', clientSecret: 'fixture', publishableKey: 'pk_test_fixture', expiresAt: new Date(Date.now() + 600_000).toISOString(), amountDue: 4990, recurringAmount: 4990, currency: 'brl' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }
function Controls() {
  const { startSubscription } = useSubscriptionCheckout(), location = useLocation();
  return <><button onClick={() => { startSubscription('premium', boundary.callback); startSubscription('premium', boundary.callback); }}>Assinar Premium</button><button onClick={() => startSubscription('pro')}>Escolher Pro</button><output aria-label="Rota atual">{location.pathname}{location.search}</output></>;
}
async function render(entry = '/planos') { await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={[entry]}><SubscriptionCheckoutProvider><Controls /></SubscriptionCheckoutProvider></MemoryRouter></StrictMode>)); }
function button(text: string) { const value = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes(text) || button.getAttribute('aria-label') === text); expect(value, text).toBeTruthy(); return value!; }
async function click(text: string) { await act(async () => button(text).click()); }
const text = () => document.body.textContent ?? '';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  boundary.auth.user = { id: 'owner-one' }; boundary.auth.loading = false; boundary.auth.profile = { plan: 'free', plan_expires_at: null };
  boundary.auth.refreshProfile.mockResolvedValue(undefined); boundary.callback.mockResolvedValue(undefined);
  boundary.status.mockResolvedValue({ kind: 'status', state: 'active', plan: 'premium' });
  boundary.prepare.mockResolvedValue(checkout); boundary.cancel.mockResolvedValue(undefined); boundary.load.mockResolvedValue({}); boundary.confirm.mockResolvedValue({ type: 'success', session: {} });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('SubscriptionCheckoutProvider: owner-scoped return and offer ownership', () => {
  it('StrictMode return checks the existing payment, removes sensitive URL parameters and never prepares another charge', async () => {
    await render('/conta?billing_session_id=cs_test_fixture&payment_intent_client_secret=fixture-secret&redirect_status=succeeded&tab=plano');
    expect(boundary.prepare).not.toHaveBeenCalled(); expect(boundary.confirm).not.toHaveBeenCalled();
    expect(boundary.status.mock.calls.every(call => call[0] === 'owner-one' && call[1].sessionId === 'cs_test_fixture')).toBe(true);
    expect(document.querySelector('[aria-label="Rota atual"]')?.textContent).toBe('/conta?tab=plano');
    expect(text()).toContain('Plano confirmado'); expect(boundary.auth.refreshProfile).toHaveBeenCalledTimes(1);
    expect(button('Concluir').disabled).toBe(false);
  });
  it('uses the returned PaymentIntent and subscription as an owner-scoped reference without loading Stripe', async () => {
    await render('/conta?payment_intent=pi_fixture&billing_subscription_id=sub_fixture&payment_intent_client_secret=secret');
    expect(boundary.status).toHaveBeenCalledWith('owner-one', { paymentIntentId: 'pi_fixture', subscriptionId: 'sub_fixture' }, expect.any(AbortSignal));
    expect(boundary.load).not.toHaveBeenCalled(); expect(boundary.prepare).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Rota atual"]')?.textContent).toBe('/conta');
  });
  it('verifies a subscription-only return without preparing, authenticating or charging again', async () => {
    await render('/conta?billing_subscription_id=sub_fixture&redirect_status=succeeded&tab=plan');
    expect(boundary.status).toHaveBeenCalledWith('owner-one', { subscriptionId: 'sub_fixture' }, expect.any(AbortSignal));
    expect(boundary.prepare).not.toHaveBeenCalled(); expect(boundary.load).not.toHaveBeenCalled(); expect(boundary.confirm).not.toHaveBeenCalled(); expect(boundary.upgrade).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Rota atual"]')?.textContent).toBe('/conta?tab=plan');
    expect(text()).toContain('Plano confirmado'); expect(boundary.auth.refreshProfile).toHaveBeenCalledTimes(1);
  });
  it('owner replacement aborts a deferred return and its late response cannot refresh either account', async () => {
    const server = deferred<unknown>(); boundary.status.mockReturnValue(server.promise);
    await render('/conta?billing_session_id=cs_test_fixture');
    const signal = boundary.status.mock.calls.at(-1)![2];
    boundary.auth.user = { id: 'owner-two' }; await render();
    expect(signal.aborted).toBe(true); expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => server.resolve({ kind: 'status', state: 'active', plan: 'premium' }));
    expect(boundary.auth.refreshProfile).not.toHaveBeenCalled(); expect(boundary.prepare).not.toHaveBeenCalled();
    expect(boundary.status.mock.calls.every(call => call[0] === 'owner-one')).toBe(true);
  });
  it('a global verification deadline releases controls, and manual retry reads status without charging', async () => {
    vi.useFakeTimers(); const server = deferred<unknown>();
    boundary.status.mockImplementation((_owner, _reference, signal: AbortSignal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Cancelado.', 'AbortError')), { once: true }); server.promise.then(resolve);
    }));
    await render('/conta?billing_session_id=cs_test_fixture');
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(text()).toContain('demorou mais que o esperado'); expect(button('Verificar pagamento').disabled).toBe(false);
    boundary.status.mockResolvedValue({ kind: 'status', state: 'active', plan: 'premium' }); await click('Verificar pagamento');
    expect(text()).toContain('Plano confirmado'); expect(boundary.auth.refreshProfile).toHaveBeenCalledTimes(1);
    expect(boundary.prepare).not.toHaveBeenCalled(); expect(boundary.confirm).not.toHaveBeenCalled();
  });
  it('double offer calls reserve one owner flow and a late profile refresh does not run the old caller callback', async () => {
    const refreshed = deferred<void>(); boundary.auth.refreshProfile.mockReturnValue(refreshed.promise);
    await render(); await click('Assinar Premium');
    expect(boundary.prepare).toHaveBeenCalledTimes(2); // StrictMode setup replay, one durable operation ID.
    expect(new Set(boundary.prepare.mock.calls.map(call => call[2])).size).toBe(1);
    await click('Confirmar assinatura'); expect(boundary.auth.refreshProfile).toHaveBeenCalledTimes(1);
    boundary.auth.user = { id: 'owner-two' }; await render(); await act(async () => refreshed.resolve());
    expect(boundary.callback).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(boundary.prepare.mock.calls.every(call => call[0] === 'owner-one')).toBe(true);
  });
  it('current Premium to Pro directs to the account without preparing a new subscription', async () => {
    boundary.auth.profile = { plan: 'premium', plan_expires_at: new Date(Date.now() + 86_400_000).toISOString() }; await render(); await click('Escolher Pro');
    expect(document.querySelector('[aria-label="Rota atual"]')?.textContent).toBe('/conta?tab=plan');
    expect(boundary.prepare).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('expired Premium can request Pro and lets the backend decide without navigating to account management', async () => {
    boundary.auth.profile = { plan: 'premium', plan_expires_at: new Date(Date.now() - 60_000).toISOString() };
    boundary.prepare.mockResolvedValue({ ...checkout, plan: 'pro', amountDue: 2990, recurringAmount: 2990 });
    await render(); await click('Escolher Pro');
    expect(document.querySelector('[aria-label="Rota atual"]')?.textContent).toBe('/planos');
    expect(boundary.prepare.mock.calls.every(call => call[0] === 'owner-one' && call[1] === 'pro')).toBe(true);
    expect(boundary.prepare).toHaveBeenCalledTimes(2); // StrictMode, stable preparation identity.
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Classfy Pro');
    expect(boundary.confirm).not.toHaveBeenCalled(); expect(boundary.upgrade).not.toHaveBeenCalled();
  });
});

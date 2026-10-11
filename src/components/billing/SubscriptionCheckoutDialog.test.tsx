import { StrictMode, act, useEffect, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionCheckoutDialog } from './SubscriptionCheckoutDialog';

// Real React/Radix/dialog state. Only network and Stripe-hosted iframe APIs are
// replaced: these tests cannot submit a charge or confer any entitlement.
const boundary = vi.hoisted(() => ({
  prepare: vi.fn(), upgrade: vi.fn(), status: vi.fn(), cancel: vi.fn(), load: vi.fn(),
  checkoutConfirm: vi.fn(), paymentConfirm: vi.fn(), nextAction: vi.fn(), checkoutOptions: vi.fn(), elementsOptions: vi.fn(),
}));
vi.mock('@/lib/billing/subscriptionCheckout', () => ({
  prepareSubscriptionCheckout: boundary.prepare, confirmSubscriptionUpgrade: boundary.upgrade,
  readSubscriptionCheckoutStatus: boundary.status, requestSubscriptionCheckoutCancel: boundary.cancel,
  loadBillingStripe: boundary.load,
}));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutProvider: ({ children, options }: { children: React.ReactNode; options: unknown }) => { boundary.checkoutOptions(options); return children; },
  useCheckout: () => ({ type: 'success', checkout: { confirm: boundary.checkoutConfirm } }),
  PaymentElement: function HostedPayment({ onReady }: { onReady(): void }) { useEffect(() => { onReady(); }, [onReady]); return <input aria-label="Cartão seguro do Stripe" />; },
}));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, options }: { children: React.ReactNode; options: unknown }) => { boundary.elementsOptions(options); return children; },
  useStripe: () => ({ confirmPayment: boundary.paymentConfirm }), useElements: () => ({ hosted: true }),
  PaymentElement: function HostedPayment({ onReady }: { onReady(): void }) { useEffect(() => { onReady(); }, [onReady]); return <input aria-label="Cartão seguro do Stripe" />; },
}));

type Props = ComponentProps<typeof SubscriptionCheckoutDialog>;
const checkout = { kind: 'checkout', plan: 'premium', sessionId: 'cs_ui_fixture', clientSecret: 'ui_fixture', publishableKey: 'pk_test_fixture', expiresAt: new Date(Date.now() + 600_000).toISOString(), amountDue: 9900, recurringAmount: 9900, currency: 'brl' };
const quote = { kind: 'upgrade_quote', plan: 'premium', currentPlan: 'pro', quoteToken: 'quote_ui_fixture', expiresAt: new Date(Date.now() + 600_000).toISOString(), prorationDate: 123, amountDue: 2450, recurringAmount: 9900, currency: 'brl' };
const upgradePayment = { kind: 'upgrade_payment', plan: 'premium', subscriptionId: 'sub_ui_fixture', paymentIntentId: 'pi_ui_fixture', clientSecret: 'ui_fixture', publishableKey: 'pk_test_fixture', status: 'requires_action', amountDue: 2450, recurringAmount: 9900, currency: 'brl' };
let root: Root, host: HTMLDivElement;
const changed = vi.fn(), confirmed = vi.fn();
const base: Props = { open: true, owner: 'owner-one', plan: 'premium', onOpenChange: changed, onConfirmed: confirmed };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: Error) => void; const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; }); return { promise, resolve, reject }; }
function button(text: string) { const value = [...document.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.includes(text) || value.getAttribute('aria-label') === text); expect(value, text).toBeTruthy(); return value!; }
const body = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
async function render(patch: Partial<Props> = {}) { await act(async () => root.render(<StrictMode><SubscriptionCheckoutDialog {...base} {...patch} /></StrictMode>)); }
async function click(text: string) { await act(async () => button(text).click()); }
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  boundary.prepare.mockResolvedValue(checkout); boundary.upgrade.mockResolvedValue(upgradePayment); boundary.status.mockResolvedValue({ kind: 'status', state: 'active', plan: 'premium' }); boundary.cancel.mockResolvedValue(undefined); boundary.load.mockResolvedValue({ fixture: true, handleNextAction: boundary.nextAction });
  boundary.checkoutConfirm.mockResolvedValue({ type: 'success', session: {} }); boundary.paymentConfirm.mockResolvedValue({}); boundary.nextAction.mockResolvedValue({});
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('SubscriptionCheckoutDialog: Stripe protocol and account lifecycle', () => {
  it('prepares a stable id under StrictMode and displays server amounts before any confirmation', async () => {
    await render(); expect(boundary.prepare).toHaveBeenCalledTimes(2);
    expect(new Set(boundary.prepare.mock.calls.map(call => call[2])).size).toBe(1);
    expect(boundary.prepare.mock.calls[0][3].aborted).toBe(true); expect(boundary.prepare.mock.calls[1][3].aborted).toBe(false);
    expect(body().textContent).toContain('99,00'); expect(body().textContent).toContain('Renovação automática mensal');
    expect(boundary.checkoutConfirm).not.toHaveBeenCalled(); expect(boundary.upgrade).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled();
    expect(boundary.checkoutOptions).toHaveBeenLastCalledWith(expect.objectContaining({ clientSecret: 'ui_fixture', elementsOptions: expect.objectContaining({ appearance: expect.objectContaining({ theme: 'night' }) }) }));
  });
  it('a card decline preserves the hosted form and does not read status or grant a plan', async () => {
    boundary.checkoutConfirm.mockResolvedValue({ type: 'error', error: { message: 'Cartão recusado. Escolha outro cartão.' } });
    await render(); const input = document.querySelector<HTMLInputElement>('[aria-label="Cartão seguro do Stripe"]')!; input.value = 'draft kept inside iframe boundary';
    await click('Confirmar assinatura'); expect(body().textContent).toContain('Cartão recusado'); expect(document.querySelector('[aria-label="Cartão seguro do Stripe"]')).toBe(input); expect(input.value).toBe('draft kept inside iframe boundary');
    expect(boundary.status).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled(); expect(button('Confirmar assinatura').disabled).toBe(false);
  });
  it('double submit makes one confirmation and server acknowledgement alone confirms the plan', async () => {
    const sdk = deferred<unknown>(), server = deferred<unknown>(); boundary.checkoutConfirm.mockReturnValue(sdk.promise); boundary.status.mockReturnValue(server.promise);
    await render(); const form = document.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(boundary.checkoutConfirm).toHaveBeenCalledTimes(1); expect(confirmed).not.toHaveBeenCalled();
    await act(async () => sdk.resolve({ type: 'success', session: {} })); expect(confirmed).not.toHaveBeenCalled(); expect(body().textContent).toContain('Confirmando o pagamento');
    expect(boundary.checkoutConfirm).toHaveBeenCalledWith({ redirect: 'if_required', returnUrl: `${window.location.origin}/conta?billing_session_id=cs_ui_fixture` });
    await act(async () => server.resolve({ kind: 'status', state: 'active', plan: 'premium' })); expect(confirmed).toHaveBeenCalledTimes(1); expect(body().textContent).toContain('Plano confirmado');
  });
  it('pending status polling is bounded and manual verification never charges again', async () => {
    await render(); vi.useFakeTimers(); boundary.status.mockResolvedValue({ kind: 'status', state: 'pending', plan: 'premium' });
    await click('Confirmar assinatura'); expect(boundary.status).toHaveBeenCalledTimes(1);
    for (const delay of [1200, 2200, 3500]) await act(async () => vi.advanceTimersByTimeAsync(delay));
    expect(boundary.status).toHaveBeenCalledTimes(4); expect(body().textContent).toContain('A confirmação ainda'); expect(confirmed).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(120_000)); expect(boundary.status).toHaveBeenCalledTimes(4);
    boundary.status.mockResolvedValue({ kind: 'status', state: 'active', plan: 'premium' }); await click('Verificar pagamento'); expect(confirmed).toHaveBeenCalledTimes(1); expect(boundary.checkoutConfirm).toHaveBeenCalledTimes(1);
  });
  it('requires an explicit quote confirmation before using the saved card, then authenticates its PaymentIntent', async () => {
    boundary.prepare.mockResolvedValue(quote); await render(); expect(body().textContent).toContain('24,50'); expect(body().textContent).toContain('método de pagamento salvo'); expect(boundary.upgrade).not.toHaveBeenCalled(); expect(boundary.load).not.toHaveBeenCalled();
    await click('Confirmar upgrade'); expect(boundary.upgrade).toHaveBeenCalledTimes(1); expect(confirmed).not.toHaveBeenCalled(); expect(button('Autenticar pagamento')).toBeTruthy(); expect(document.querySelector('[aria-label="Cartão seguro do Stripe"]')).toBeNull();
    await click('Autenticar pagamento'); expect(boundary.nextAction).toHaveBeenCalledWith({ clientSecret: 'ui_fixture' }); expect(boundary.paymentConfirm).not.toHaveBeenCalled(); expect(confirmed).toHaveBeenCalledTimes(1);
  });
  it('requires_payment_method offers a PaymentElement for the existing upgrade PaymentIntent', async () => {
    boundary.prepare.mockResolvedValue(quote); boundary.upgrade.mockResolvedValue({ ...upgradePayment, status: 'requires_payment_method' }); await render(); await click('Confirmar upgrade'); await click('Confirmar pagamento');
    expect(boundary.nextAction).not.toHaveBeenCalled(); expect(boundary.paymentConfirm).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: 'ui_fixture', redirect: 'if_required', confirmParams: { return_url: `${window.location.origin}/conta?billing_subscription_id=sub_ui_fixture&billing_payment_intent_id=pi_ui_fixture` } })); expect(confirmed).toHaveBeenCalledTimes(1);
  });
  it('reopening resumes the existing upgrade intent without preparing a new quote or charging the saved card', async () => {
    boundary.prepare.mockResolvedValue(upgradePayment); await render(); expect(button('Autenticar pagamento')).toBeTruthy(); expect(boundary.upgrade).not.toHaveBeenCalled(); await click('Autenticar pagamento'); expect(boundary.nextAction).toHaveBeenCalledTimes(1); expect(confirmed).toHaveBeenCalledTimes(1);
  });
  it.each(['expired', 'failed'] as const)('an existing terminal Checkout %s is rendered rather than an empty payment form', async state => {
    boundary.prepare.mockResolvedValue({ kind: 'status', state, plan: 'premium', sessionId: 'cs_ui_fixture', message: 'Resultado confirmado pelo servidor.' }); await render(); expect(body().textContent).toContain('Resultado confirmado pelo servidor'); expect(confirmed).not.toHaveBeenCalled(); expect(boundary.checkoutConfirm).not.toHaveBeenCalled(); expect(document.querySelector('form')).toBeNull();
  });
  it('a recovered pending Checkout verifies the same reference, and completed Checkout never submits again', async () => {
    const waiting = deferred<unknown>(); boundary.prepare.mockResolvedValue({ kind: 'status', state: 'pending', plan: 'premium', sessionId: 'cs_ui_fixture', operationId: 'operation_fixture' }); boundary.status.mockReturnValue(waiting.promise); await render();
    expect(boundary.status).toHaveBeenCalledWith('owner-one', expect.objectContaining({ sessionId: 'cs_ui_fixture', operationId: 'operation_fixture' }), expect.any(AbortSignal)); expect(confirmed).not.toHaveBeenCalled();
    await act(async () => waiting.resolve({ kind: 'status', state: 'active', plan: 'premium' })); expect(confirmed).toHaveBeenCalledTimes(1); expect(boundary.checkoutConfirm).not.toHaveBeenCalled();
  });
  it('Stripe authentication can focus its own external challenge and restores the dialog afterward', async () => {
    const waiting = deferred<unknown>(), bank = document.createElement('button'); bank.textContent = 'Banco · Autenticação'; document.body.append(bank);
    boundary.prepare.mockResolvedValue(upgradePayment); boundary.nextAction.mockImplementation(() => { bank.focus(); expect(document.activeElement).toBe(bank); expect(document.body.style.pointerEvents).not.toBe('none'); return waiting.promise; });
    await render(); bank.focus(); expect(document.activeElement).not.toBe(bank); await click('Autenticar pagamento'); expect(document.activeElement).toBe(bank); expect(body().getAttribute('aria-modal')).toBe('false'); expect(boundary.prepare).toHaveBeenCalledTimes(2);
    await act(async () => waiting.resolve({ error: { message: 'Autenticação cancelada.' } })); expect(body().getAttribute('aria-modal')).toBe('true'); expect(body().contains(document.activeElement)).toBe(true); expect(body().textContent).toContain('Autenticação cancelada'); expect(confirmed).not.toHaveBeenCalled(); bank.remove();
  });
  it('exits fullscreen before Stripe starts while preserving the same prepared session and hosted form', async () => {
    const fullscreen = document.createElement('div'); document.body.append(fullscreen); Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreen });
    const exit = vi.fn(async () => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null }); document.dispatchEvent(new Event('fullscreenchange')); }); Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    await render(); const form = document.querySelector('form'); boundary.checkoutConfirm.mockImplementation(async () => { expect(document.fullscreenElement).toBeNull(); expect(document.querySelector('form')).toBe(form); return { type: 'success', session: {} }; });
    await click('Confirmar assinatura'); expect(exit).toHaveBeenCalledTimes(1); expect(boundary.checkoutConfirm).toHaveBeenCalledTimes(1); expect(boundary.prepare).toHaveBeenCalledTimes(2); expect(confirmed).toHaveBeenCalledTimes(1); await render({ open: false }); fullscreen.remove();
  });
  it('saved-card authentication is deduplicated and owner changes invalidate its delayed acknowledgement', async () => {
    const sdk = deferred<unknown>(); boundary.nextAction.mockReturnValue(sdk.promise); boundary.prepare.mockResolvedValue(quote); await render(); await click('Confirmar upgrade');
    const authenticate = button('Autenticar pagamento'); await act(async () => { authenticate.click(); authenticate.click(); }); expect(boundary.nextAction).toHaveBeenCalledTimes(1); expect(confirmed).not.toHaveBeenCalled();
    await render({ owner: 'owner-two' }); await act(async () => sdk.resolve({})); expect(boundary.status).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled(); expect(boundary.prepare.mock.calls.every(call => call[0] === 'owner-one')).toBe(true);
  });
  it('an expired quote cannot attempt a saved-card charge; explicit refresh uses a new preparation id', async () => {
    boundary.prepare.mockResolvedValue({ ...quote, expiresAt: new Date(Date.now() - 1000).toISOString() }); await render(); const id = boundary.prepare.mock.calls.at(-1)![2]; await click('Confirmar upgrade'); expect(boundary.upgrade).not.toHaveBeenCalled(); expect(body().textContent).toContain('expirou');
    boundary.prepare.mockResolvedValue(quote); await click('Atualizar pagamento'); expect(boundary.prepare.mock.calls.at(-1)![2]).not.toBe(id); expect(boundary.upgrade).not.toHaveBeenCalled();
  });
  it('a failed upgrade request can retry the same operation id without opening another quote', async () => {
    boundary.prepare.mockResolvedValue(quote); boundary.upgrade.mockRejectedValueOnce(new Error('Confirmação indisponível.')); await render(); await click('Confirmar upgrade'); expect(body().textContent).toContain('Confirmação indisponível'); await click('Confirmar upgrade');
    expect(boundary.upgrade).toHaveBeenCalledTimes(2); expect(boundary.upgrade.mock.calls[0][2]).toBe(boundary.upgrade.mock.calls[1][2]); expect(boundary.prepare).toHaveBeenCalledTimes(2);
  });
  it('source/owner changes discard a late SDK result and never prepare or mutate for the replacement account', async () => {
    const sdk = deferred<unknown>(); boundary.checkoutConfirm.mockReturnValue(sdk.promise); await render(); await click('Confirmar assinatura'); await render({ owner: 'owner-two' });
    await act(async () => sdk.resolve({ type: 'success', session: {} })); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(changed).toHaveBeenCalledWith(false); expect(boundary.prepare.mock.calls.every(call => call[0] === 'owner-one')).toBe(true); expect(boundary.status).not.toHaveBeenCalled(); expect(boundary.cancel).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled();
  });
  it('close aborts a pending server result without canceling a payment already submitted', async () => {
    const server = deferred<unknown>(); boundary.status.mockReturnValue(server.promise); await render(); await click('Confirmar assinatura'); const signal = boundary.status.mock.calls[0][2];
    await click('Fechar pagamento'); expect(signal.aborted).toBe(true); expect(boundary.cancel).not.toHaveBeenCalled();
    await act(async () => server.resolve({ kind: 'status', state: 'active', plan: 'premium' })); expect(confirmed).not.toHaveBeenCalled();
  });
  it('closing a ready Checkout aborts only local work and immediate reopening resumes the same session', async () => {
    await render(); const close = button('Fechar pagamento'); await act(async () => { close.click(); close.click(); }); expect(boundary.cancel).not.toHaveBeenCalled(); expect(boundary.checkoutConfirm).not.toHaveBeenCalled();
    await render({ open: false }); await render(); expect(button('Confirmar assinatura').disabled).toBe(false); expect(boundary.checkoutOptions).toHaveBeenLastCalledWith(expect.objectContaining({ clientSecret: checkout.clientSecret })); expect(boundary.cancel).not.toHaveBeenCalled();
    await click('Confirmar assinatura'); expect(boundary.checkoutConfirm).toHaveBeenCalledWith(expect.objectContaining({ returnUrl: `${window.location.origin}/conta?billing_session_id=cs_ui_fixture` })); expect(confirmed).toHaveBeenCalledTimes(1);
  });
  it('submit and close before React renders confirming cannot expire the same Checkout', async () => {
    await render(); const form = document.querySelector('form')!, close = button('Fechar pagamento');
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); close.click(); });
    expect(boundary.cancel).not.toHaveBeenCalled(); expect(boundary.status).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled();
  });
  it('a late prepare after close never expires the same session resumed by a new opening', async () => {
    const original = deferred<unknown>(); boundary.prepare.mockReturnValue(original.promise); await render(); const oldSignal = boundary.prepare.mock.calls.at(-1)![3]; await click('Fechar pagamento'); expect(oldSignal.aborted).toBe(true); await render({ open: false });
    boundary.prepare.mockResolvedValue(checkout); await render(); const newForm = document.querySelector('form'); expect(button('Confirmar assinatura').disabled).toBe(false);
    await act(async () => original.resolve(checkout)); expect(document.querySelector('form')).toBe(newForm); expect(boundary.cancel).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled();
    await click('Confirmar assinatura'); expect(boundary.checkoutConfirm).toHaveBeenCalledTimes(1); expect(confirmed).toHaveBeenCalledTimes(1);
  });
  it('close while the SDK is confirming or its result is pending never expires the Checkout', async () => {
    const sdk = deferred<unknown>(); boundary.checkoutConfirm.mockReturnValue(sdk.promise); await render(); await click('Confirmar assinatura'); await click('Fechar pagamento'); expect(boundary.cancel).not.toHaveBeenCalled(); await act(async () => sdk.resolve({ type: 'success', session: {} })); expect(confirmed).not.toHaveBeenCalled();
    await render({ open: false }); boundary.checkoutConfirm.mockResolvedValue({ type: 'success', session: {} }); await render(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); await click('Confirmar assinatura'); expect(body().textContent).toContain('Volte a esta página'); await click('Fechar pagamento'); expect(boundary.cancel).not.toHaveBeenCalled();
  });
  it('closing a quote or confirmed checkout never issues cancel; payment failure never grants access', async () => {
    boundary.prepare.mockResolvedValue(quote); await render(); await click('Fechar pagamento'); expect(boundary.cancel).not.toHaveBeenCalled();
    await render({ open: false }); boundary.prepare.mockResolvedValue(checkout); boundary.status.mockResolvedValue({ kind: 'status', state: 'failed', plan: 'premium', message: 'Pagamento recusado pelo banco.' }); await render(); await click('Confirmar assinatura'); expect(body().textContent).toContain('Pagamento recusado pelo banco'); expect(confirmed).not.toHaveBeenCalled();
    boundary.status.mockResolvedValue({ kind: 'status', state: 'active', plan: 'premium' }); await click('Verificar pagamento'); await click('Fechar pagamento'); expect(boundary.cancel).not.toHaveBeenCalled();
  });
  it('a preparation retry preserves operation identity and a Stripe loader failure permits retry', async () => {
    boundary.prepare.mockRejectedValue(new Error('Conexão indisponível.')); await render(); const id = boundary.prepare.mock.calls.at(-1)![2]; boundary.prepare.mockResolvedValue(checkout); boundary.load.mockRejectedValue(new Error('script unavailable'));
    await click('Tentar novamente'); expect(boundary.prepare.mock.calls.at(-1)![2]).toBe(id); expect(body().textContent).toContain('Não foi possível carregar o pagamento seguro'); boundary.load.mockResolvedValue({ fixture: true }); await click('Recarregar formulário'); expect(button('Confirmar assinatura').disabled).toBe(false);
  });
  it('hidden state stops polling without stopping a payment already submitted; later verification can confirm', async () => {
    await render(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); await click('Confirmar assinatura'); expect(boundary.status).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled(); expect(body().textContent).toContain('Volte a esta página');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); await click('Verificar pagamento'); expect(confirmed).toHaveBeenCalledTimes(1); expect(boundary.checkoutConfirm).toHaveBeenCalledTimes(1);
  });
  it('an unresolved SDK confirmation becomes verifiable without another charge, and its late success is ignored', async () => {
    const sdk = deferred<unknown>(); boundary.checkoutConfirm.mockReturnValue(sdk.promise); await render(); vi.useFakeTimers(); await click('Confirmar assinatura');
    await act(async () => vi.advanceTimersByTimeAsync(120_000)); expect(body().textContent).toContain('Verifique o pagamento'); expect(button('Verificar pagamento').disabled).toBe(false); expect(confirmed).not.toHaveBeenCalled();
    await act(async () => sdk.resolve({ type: 'success', session: {} })); expect(boundary.status).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled();
    await click('Verificar pagamento'); expect(confirmed).toHaveBeenCalledTimes(1); expect(boundary.checkoutConfirm).toHaveBeenCalledTimes(1);
  });
  it('uses the fullscreen portal, keyboard Escape and connected trigger restoration', async () => {
    const fullscreen = document.createElement('div'); document.body.append(fullscreen); Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreen });
    function Controlled() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>Assinar plano</button><SubscriptionCheckoutDialog {...base} open={open} onOpenChange={setOpen} /></>; }
    await act(async () => root.render(<Controlled />)); button('Assinar plano').focus(); await click('Assinar plano'); await settle(); expect(fullscreen.querySelector('[role="dialog"]')).toBeTruthy(); expect(document.activeElement?.closest('[role="dialog"]')).toBeTruthy();
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); await act(async () => new Promise(resolve => setTimeout(resolve, 10))); expect(fullscreen.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(button('Assinar plano')); fullscreen.remove();
  });
  it('a provider mounting the dialog already open restores its connected initiating button', async () => {
    const trigger = document.createElement('button'); trigger.textContent = 'Plano Premium'; document.body.append(trigger); trigger.focus(); await render(); await click('Fechar pagamento'); await render({ open: false });
    await act(async () => new Promise(resolve => setTimeout(resolve, 10))); expect(document.activeElement).toBe(trigger); trigger.remove();
  });
});

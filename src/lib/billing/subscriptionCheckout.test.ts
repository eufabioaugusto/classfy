import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ owner: 'account-a', session: vi.fn(), user: vi.fn(), invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: io.session, getUser: io.user }, functions: { invoke: io.invoke } } }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));
import { prepareSubscriptionCheckout, readSubscriptionCheckoutStatus, confirmSubscriptionUpgrade, hasCurrentPaidPlan } from './subscriptionCheckout';
const checkout = { kind: 'checkout', plan: 'premium', amountDue: 4990, recurringAmount: 4990, currency: 'brl', sessionId: 'cs_fixture', clientSecret: 'fixture', publishableKey: 'pk_test_fixture', expiresAt: '2026-10-11T18:00:00Z' };
beforeEach(() => {
  io.owner = 'account-a';
  io.session.mockImplementation(async () => ({ data: { session: { user: { id: io.owner }, access_token: 'fixture-token' } }, error: null }));
  io.user.mockImplementation(async () => ({ data: { user: { id: io.owner } }, error: null }));
  io.invoke.mockResolvedValue({ data: checkout, error: null });
});
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe('checkout web e identidade da conta', () => {
  it('perfil com plano vencido pode voltar ao checkout; plano vigente orienta gerenciamento', () => {
    expect(hasCurrentPaidPlan({ plan: 'premium', plan_expires_at: '2000-01-01T00:00:00Z' })).toBe(false);
    expect(hasCurrentPaidPlan({ plan: 'premium', plan_expires_at: '2099-01-01T00:00:00Z' })).toBe(true);
    expect(hasCurrentPaidPlan({ plan: 'free', plan_expires_at: null })).toBe(false);
  });
  it('recusa iniciar cobrança com dono diferente da sessão', async () => {
    await expect(prepareSubscriptionCheckout('account-b', 'premium', 'request')).rejects.toThrow('sessão mudou');
    expect(io.invoke).not.toHaveBeenCalled();
  });
  it('descarta resposta de pagamento que cruza uma troca de conta', async () => {
    io.invoke.mockImplementation(async () => { io.owner = 'account-b'; return { data: checkout, error: null }; });
    await expect(prepareSubscriptionCheckout('account-a', 'premium', 'request')).rejects.toThrow('sessão mudou');
  });
  it.each([{ plan: 'pro' }, { currency: 'usd' }, { amountDue: -1 }, { expiresAt: 'invalid' }])('recusa resumo inconsistente %j antes de mostrar pagamento', async patch => {
    io.invoke.mockResolvedValue({ data: { ...checkout, ...patch }, error: null });
    await expect(prepareSubscriptionCheckout('account-a', 'premium', 'request')).rejects.toThrow();
  });
  it('retorno da autenticação consulta identificadores próprios sem preparar uma cobrança', async () => {
    io.invoke.mockResolvedValue({ data: { kind: 'status', state: 'pending', plan: 'premium', effectivePlan: 'pro' }, error: null });
    const result = await readSubscriptionCheckoutStatus('account-a', { subscriptionId: 'sub_fixture', paymentIntentId: 'pi_fixture' });
    expect(result.state).toBe('pending');
    expect(io.invoke).toHaveBeenCalledWith('web-subscription-checkout', expect.objectContaining({ body: expect.objectContaining({ action: 'status', subscriptionId: 'sub_fixture', paymentIntentId: 'pi_fixture' }) }));
  });
  it('confirmar upgrade transmite a prévia opaca e a mesma operação para retry', async () => {
    io.invoke.mockResolvedValue({ data: { kind: 'upgrade_payment', plan: 'premium', subscriptionId: 'sub_fixture', paymentIntentId: null, clientSecret: null, publishableKey: 'pk_test_fixture', status: 'processing', amountDue: 600, recurringAmount: 4990, currency: 'brl' }, error: null });
    expect((await confirmSubscriptionUpgrade('account-a', 'quote', 'operation')).status).toBe('processing');
    expect(io.invoke).toHaveBeenCalledWith('web-subscription-checkout', expect.objectContaining({ body: { action: 'confirm_upgrade', quoteToken: 'quote', operationId: 'operation' } }));
  });
  it('retoma a autenticação pendente devolvida por prepare sem confirmar outro upgrade', async () => {
    const resumed = { ...checkout, kind: 'upgrade_payment', operationId: 'operation', subscriptionId: 'sub_fixture', paymentIntentId: 'pi_fixture', status: 'requires_action' };
    io.invoke.mockResolvedValue({ data: resumed, error: null });
    expect(await prepareSubscriptionCheckout('account-a', 'premium', 'request')).toEqual(resumed);
    expect(io.invoke).toHaveBeenCalledTimes(1);
    expect(io.invoke.mock.calls[0][1].body.action).toBe('prepare');
  });
  it.each(['active', 'pending', 'expired', 'failed'])('aceita o resultado %s de uma operação retomada', async state => {
    const result = { kind: 'status', state, plan: 'premium', operationId: 'operation' };
    io.invoke.mockResolvedValue({ data: result, error: null });
    expect(await prepareSubscriptionCheckout('account-a', 'premium', 'request')).toEqual(result);
  });
  it('consulta upgrade sem PaymentIntent usando somente a operação e assinatura', async () => {
    io.invoke.mockResolvedValue({ data: { kind: 'status', state: 'pending', plan: 'premium' }, error: null });
    await readSubscriptionCheckoutStatus('account-a', { operationId: 'operation', subscriptionId: 'sub_fixture', paymentIntentId: null });
    const body = JSON.parse(JSON.stringify(io.invoke.mock.calls[0][1].body));
    expect(body).toEqual({ action: 'status', operationId: 'operation', subscriptionId: 'sub_fixture' });
  });
  it('sinal cancelado não consulta nem envia; leitura que nunca responde tem prazo', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(prepareSubscriptionCheckout('account-a', 'pro', 'request', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(io.session).not.toHaveBeenCalled();
    vi.useFakeTimers(); io.session.mockImplementation(() => new Promise(() => {}));
    const pending = prepareSubscriptionCheckout('account-a', 'pro', 'request').catch(error => error);
    await vi.advanceTimersByTimeAsync(20_001);
    expect((await pending).message).toContain('demorou');
    expect(io.invoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

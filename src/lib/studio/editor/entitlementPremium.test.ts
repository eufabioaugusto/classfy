import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ owner: 'creator', row: null as unknown, queryError: null as unknown, query: null as null | (() => Promise<unknown>), session: vi.fn(), user: vi.fn(), invoke: vi.fn(), select: vi.fn(), eq: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: io.session, getUser: io.user }, functions: { invoke: io.invoke },
  from: (table: string) => { expect(table).toBe('profiles'); return { select: (fields: string) => { io.select(fields); return { eq: (column: string, owner: string) => { io.eq(column, owner); return { abortSignal: () => ({ single: () => io.query ? io.query() : Promise.resolve({ data: io.row, error: io.queryError }) }) }; } }; } }; },
} }));
import { readStudioPremiumProfile, requestStudioPremiumCheckout, studioPremiumAccess, studioPremiumCheckout, type StudioPremiumProfile } from './entitlementPremium';

const NOW = Date.parse('2026-10-11T12:00:00Z'), FUTURE = '2026-11-11T12:00:00Z';
function profile(patch: Partial<StudioPremiumProfile> = {}): StudioPremiumProfile { return { id: 'creator', plan: 'premium', plan_expires_at: FUTURE, entitlement_source: 'stripe', subscription_status: 'active', subscription_grace_until: null, stripe_subscription_id: 'sub-fixture', ...patch }; }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(NOW);
  io.owner = 'creator'; io.row = profile(); io.queryError = null; io.query = null;
  io.session.mockImplementation(async () => ({ data: { session: { user: { id: io.owner }, access_token: 'fixture-session' } }, error: null }));
  io.user.mockImplementation(async () => ({ data: { user: { id: io.owner } }, error: null }));
  io.invoke.mockResolvedValue({ data: { url: 'https://checkout.stripe.com/fixture' }, error: null });
});
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('Premium de cenas baseado no entitlement oficial vigente', () => {
  it.each(['apple', 'google'])('assinatura oficial %s reconhece período vigente sem abrir checkout Stripe', source => {
    expect(studioPremiumAccess(profile({ entitlement_source: source, stripe_subscription_id: null }), NOW).canUseScenes).toBe(true);
    expect(studioPremiumAccess(profile({ entitlement_source: source, plan_expires_at: '2026-01-01T00:00:00Z' }), NOW).canUseScenes).toBe(false);
    expect(studioPremiumAccess(profile({ entitlement_source: source, plan: 'pro' }), NOW).canUseScenes).toBe(false);
  });
  it.each(['active', 'trialing', 'canceled'])('%s respeita o período pago e expira na borda exata', status => {
    expect(studioPremiumAccess(profile({ subscription_status: status }), NOW).canUseScenes).toBe(true);
    expect(studioPremiumAccess(profile({ subscription_status: status, plan_expires_at: new Date(NOW).toISOString() }), NOW)).toMatchObject({ canUseScenes: false, reason: 'expired' });
  });
  it('past_due usa apenas o prazo de tolerância e não renova por data de período antiga', () => {
    expect(studioPremiumAccess(profile({ subscription_status: 'past_due', plan_expires_at: '2026-10-10T12:00:00Z', subscription_grace_until: FUTURE }), NOW).canUseScenes).toBe(true);
    expect(studioPremiumAccess(profile({ subscription_status: 'past_due', subscription_grace_until: '2026-10-10T12:00:00Z' }), NOW)).toMatchObject({ canUseScenes: false, reason: 'expired' });
    expect(studioPremiumAccess(profile({ subscription_status: 'past_due' }), NOW).canUseScenes).toBe(false);
  });
  it('concessão administrativa depende de prazo remoto, sem conceder Premium por role', () => {
    expect(studioPremiumAccess(profile({ entitlement_source: 'admin', subscription_status: 'free', stripe_subscription_id: null }), NOW).canUseScenes).toBe(true);
    expect(studioPremiumAccess(profile({ entitlement_source: 'admin', plan: 'pro' }), NOW)).toMatchObject({ effectivePlan: 'pro', canUseScenes: false });
    expect(studioPremiumAccess(profile({ entitlement_source: 'admin', plan_expires_at: null }), NOW).canUseScenes).toBe(false);
    expect(studioPremiumAccess(profile({ entitlement_source: 'admin', plan_expires_at: '2026-01-01T00:00:00Z' }), NOW).canUseScenes).toBe(false);
  });
  it.each(['free', 'expired', 'unpaid', 'paused', 'incomplete', 'incomplete_expired', 'unrecognized'])('status %s bloqueia mesmo com campo plan Premium', status => {
    expect(studioPremiumAccess(profile({ subscription_status: status }), NOW).canUseScenes).toBe(false);
  });
  it('perfil desconhecido, prazo inválido/ausente, fonte inválida e Pro falham fechados', () => {
    for (const value of [null, profile({ plan_expires_at: null }), profile({ plan_expires_at: 'invalid' }), profile({ entitlement_source: 'client' }), profile({ plan: 'pro' }), profile({ plan: 'free' })]) expect(studioPremiumAccess(value, NOW).canUseScenes).toBe(false);
  });
  it('consulta o próprio perfil remoto e não invoca Stripe para ler o acesso', async () => {
    expect(await readStudioPremiumProfile('creator')).toEqual(profile());
    expect(io.eq).toHaveBeenCalledWith('id', 'creator'); expect(io.user).toHaveBeenCalledWith('fixture-session'); expect(io.select.mock.calls[0][0]).toContain('entitlement_source'); expect(io.invoke).not.toHaveBeenCalled();
  });
  it('verificação é explícita e lê o perfil depois; não libera usando resposta otimista da função', async () => {
    io.row = profile({ plan: 'free', entitlement_source: 'free' }); io.invoke.mockResolvedValue({ data: { plan: 'premium', hasSubscription: true }, error: null });
    const result = await readStudioPremiumProfile('creator', {}, true);
    expect(studioPremiumAccess(result, NOW).canUseScenes).toBe(false); expect(io.invoke).toHaveBeenCalledWith('verify-subscription', expect.objectContaining({ headers: { Authorization: 'Bearer fixture-session' }, signal: expect.any(AbortSignal) }));
  });
  it('não consulta perfil nem inicia checkout com owner diferente da sessão', async () => {
    io.owner = 'other'; await expect(readStudioPremiumProfile('creator')).rejects.toThrow('Sua sessão mudou');
    expect(io.select).not.toHaveBeenCalled(); await expect(requestStudioPremiumCheckout('creator')).rejects.toThrow('Sua sessão mudou'); expect(io.invoke).not.toHaveBeenCalled();
  });
  it('troca de sessão durante a leitura impede adotar o Premium da conta anterior', async () => {
    io.query = async () => { io.owner = 'other'; return { data: profile(), error: null }; };
    await expect(readStudioPremiumProfile('creator')).rejects.toThrow('Sua sessão mudou');
  });
  it('scope cancelado não executa leitura nem função e timeout não deixa a consulta pendente', async () => {
    await expect(readStudioPremiumProfile('creator', { isCurrent: () => false })).rejects.toMatchObject({ name: 'AbortError' }); expect(io.session).not.toHaveBeenCalled();
    io.session.mockImplementation(() => new Promise(() => {})); const waiting = readStudioPremiumProfile('creator').catch(cause => cause);
    await vi.advanceTimersByTimeAsync(15_001); expect((await waiting).message).toContain('demorou'); expect(vi.getTimerCount()).toBe(0);
  });
  it('checkout Free usa endpoint existente, upgrade Pro Stripe usa comando atual e admin Pro não finge assinatura Stripe', async () => {
    expect(studioPremiumCheckout(profile({ plan: 'pro' }))).toEqual({ name: 'manage-subscription', body: { action: 'upgrade', newPlan: 'premium' } });
    expect(studioPremiumCheckout(profile({ plan: 'pro', entitlement_source: 'admin' })).name).toBe('create-subscription-checkout');
    io.row = profile({ plan: 'free', entitlement_source: 'free', stripe_subscription_id: null });
    expect(await requestStudioPremiumCheckout('creator')).toEqual({ url: 'https://checkout.stripe.com/fixture' });
    expect(io.invoke).toHaveBeenCalledWith('create-subscription-checkout', expect.objectContaining({ body: { plan: 'premium' }, headers: { Authorization: 'Bearer fixture-session' } }));
  });
  it('Premium já vigente não inicia cobrança; URL não oficial não chega ao navegador', async () => {
    expect(await requestStudioPremiumCheckout('creator')).toEqual({ alreadyActive: true }); expect(io.invoke).not.toHaveBeenCalled();
    io.row = profile({ plan: 'free', entitlement_source: 'free' }); io.invoke.mockResolvedValue({ data: { url: 'https://untrusted.example/payment' }, error: null });
    await expect(requestStudioPremiumCheckout('creator')).rejects.toThrow('segurança');
  });
});

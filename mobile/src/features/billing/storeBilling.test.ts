import { describe, expect, it, vi } from 'vitest';
import type { ProductSubscription, Purchase } from 'expo-iap';
import { nativeBillingUnavailable, resolveStoreProducts, StoreBillingController, subscriptionRequest, type BillingMessage, type BillingProfile, type BillingState, type StoreBridge } from './storeBilling';

const owner = 'c273eb4a-d6a6-4898-8730-d2da2b5d5c42';
const catalog = [{ plan: 'pro' as const, productId: 'br.com.classfy.pro.monthly' }, { plan: 'premium' as const, productId: 'br.com.classfy.premium.monthly' }];
const product = { id: catalog[0].productId, type: 'subs', platform: 'ios', displayPrice: '€ 6,99', subscriptionPeriodUnitIOS: 'month', subscriptionPeriodNumberIOS: '1' } as ProductSubscription;
const purchase = { id: 'transaction-1', transactionId: 'transaction-1', appAccountToken: owner, productId: catalog[0].productId, purchaseState: 'purchased', store: 'apple', storeId: 'apple' } as Purchase;

function harness(overrides: { purchases?: Purchase[]; disabled?: boolean; profile?: BillingProfile; platform?: 'apple' | 'google'; verification?: Promise<any> | { verified: boolean; plan?: string; subscriptionEnd?: string; storeAcknowledged?: boolean }; loadBridgeError?: boolean } = {}) {
  let userId: string | null = owner;
  let listener: (p: Purchase) => void = () => undefined;
  let errorListener: (e: { code: string; message: string }) => void = () => undefined;
  const states: BillingState[] = [];
  const messages: BillingMessage[] = [];
  const bridge: StoreBridge = {
    initConnection: vi.fn(async () => true), endConnection: vi.fn(async () => true),
    fetchProducts: vi.fn(async () => [product]), requestPurchase: vi.fn(async () => undefined),
    getAvailablePurchases: vi.fn(async () => overrides.purchases ?? []), restorePurchases: vi.fn(async () => undefined),
    finishTransaction: vi.fn(async () => undefined), deepLinkToSubscriptions: vi.fn(async () => undefined),
    purchaseUpdatedListener: vi.fn((next) => { listener = next; return { remove: vi.fn() }; }),
    purchaseErrorListener: vi.fn((next) => { errorListener = next; return { remove: vi.fn() }; }),
  };
  const verification = overrides.verification ?? { verified: true, plan: 'pro', subscriptionEnd: '2099-01-01T00:00:00Z' };
  const verify = vi.fn(async () => await verification as any);
  const refresh = vi.fn(async () => undefined);
  const openStoreManagement = vi.fn(async () => undefined);
  const loadBridge = vi.fn(async () => { if (overrides.loadBridgeError) throw new Error('Módulo nativo indisponível'); return bridge; });
  const controller = new StoreBillingController({ ownerId: owner, platform: overrides.platform ?? 'apple', getUserId: () => userId,
    getProfile: () => overrides.profile ?? { id: owner, plan: 'free' }, loadBridge,
    catalog: async () => ({ enabled: !overrides.disabled, products: catalog }), verify,
    refreshProfile: refresh, openStoreManagement, onState: (state) => states.push(state), onMessage: (message) => messages.push(message),
  });
  return { controller, bridge, verify, refresh, loadBridge, openStoreManagement, states, messages,
    emit: (p: Purchase) => listener(p), error: (code: string) => errorListener({ code, message: '' }), switchUser: () => { userId = 'other-user'; },
  };
}

describe('catálogo e preços da loja', () => {
  it('exibe o preço localizado da loja, sem substituir por preço do site', () => {
    expect(resolveStoreProducts(catalog, [product], 'apple')).toEqual([{ ...catalog[0], displayPrice: '€ 6,99' }]);
    expect(resolveStoreProducts(catalog, [], 'apple')).toEqual([]);
  });
  it('omite produtos anuais e de outra plataforma', () => {
    expect(resolveStoreProducts(catalog, [{ ...product, subscriptionPeriodUnitIOS: 'year' } as ProductSubscription], 'apple')).toEqual([]);
    expect(resolveStoreProducts(catalog, [product], 'google')).toEqual([]);
  });
  it('seleciona apenas o plano mensal regular do Play e seu preço exato', () => {
    const android = { id: 'classfy_pro', type: 'subs', platform: 'android', displayPrice: 'Grátis', subscriptionOffers: [
      { id: 'trial', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'trial-token', pricingPhasesAndroid: { pricingPhaseList: [{ billingPeriod: 'P1M', recurrenceMode: 2, formattedPrice: 'Grátis' }, { billingPeriod: 'P1M', recurrenceMode: 1, formattedPrice: 'R$ 29,90' }] } },
      { id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'base-token', pricingPhasesAndroid: { pricingPhaseList: [{ billingPeriod: 'P1M', recurrenceMode: 1, formattedPrice: 'R$ 29,90' }] } },
    ] } as ProductSubscription;
    const result = resolveStoreProducts([{ plan: 'pro', productId: android.id, basePlanId: 'monthly' }], [android], 'google');
    expect(result[0]).toMatchObject({ displayPrice: 'R$ 29,90', offerToken: 'base-token' });
    expect(subscriptionRequest(result[0], 'google', owner)).toMatchObject({ request: { google: { obfuscatedAccountId: owner, subscriptionOffers: [{ sku: android.id, offerToken: 'base-token' }] } } });
  });
  it('vincula Apple à conta Classfy e desativa finalização automática', () => {
    expect(subscriptionRequest({ ...catalog[0], displayPrice: 'R$ 29,90' }, 'apple', owner)).toMatchObject({ request: { apple: { appAccountToken: owner, andDangerouslyFinishTransactionAutomatically: false } } });
  });
});

describe('ambientes sem compras configuradas', () => {
  it('bloqueia Expo Go e web antes de carregar módulo nativo', () => {
    expect(nativeBillingUnavailable('ios', true)).toContain('testes');
    expect(nativeBillingUnavailable('web', false)).toContain('App Store');
    expect(nativeBillingUnavailable('ios', false)).toBeNull();
  });
  it('não carrega nem solicita compra quando o servidor não habilitou a loja', async () => {
    const h = harness({ disabled: true }); await h.controller.start(); await h.controller.subscribe('pro');
    expect(h.loadBridge).not.toHaveBeenCalled(); expect(h.bridge.requestPurchase).not.toHaveBeenCalled();
    expect(h.states.at(-1)?.status).toBe('unavailable');
  });
  it('captura falta do módulo de uma instalação antiga', async () => {
    const h = harness({ loadBridgeError: true }); await h.controller.start();
    expect(h.states.at(-1)?.status).toBe('error'); expect(h.bridge.requestPurchase).not.toHaveBeenCalled();
  });
});

describe('compra, restauração e proteção de conta', () => {
  it('não libera ou finaliza apenas porque a solicitação de compra resolveu', async () => {
    const h = harness(); await h.controller.start(); await h.controller.subscribe('pro');
    expect(h.bridge.requestPurchase).toHaveBeenCalledOnce(); expect(h.verify).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled(); expect(h.bridge.finishTransaction).not.toHaveBeenCalled();
  });
  it('não abre outra compra enquanto consulta transações recuperáveis da loja', async () => {
    const h = harness();
    let resolve: (purchases: Purchase[]) => void = () => undefined;
    vi.mocked(h.bridge.getAvailablePurchases).mockImplementation(() => new Promise((next) => { resolve = next; }));
    const starting = h.controller.start();
    await vi.waitFor(() => expect(h.bridge.getAvailablePurchases).toHaveBeenCalledOnce());
    await h.controller.subscribe('pro'); expect(h.bridge.requestPurchase).not.toHaveBeenCalled();
    resolve([]); await starting;
    await h.controller.subscribe('pro'); expect(h.bridge.requestPurchase).toHaveBeenCalledOnce();
  });
  it('restaura após verificar no servidor e finaliza a transação uma vez', async () => {
    const h = harness(); await h.controller.start();
    vi.mocked(h.bridge.getAvailablePurchases).mockResolvedValue([purchase]);
    await h.controller.restore(); await h.controller.restore();
    expect(h.verify).toHaveBeenCalledOnce(); expect(h.bridge.finishTransaction).toHaveBeenCalledOnce();
    expect(h.verify.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(h.bridge.finishTransaction).mock.invocationCallOrder[0]);
    expect(h.refresh).toHaveBeenCalledOnce(); expect(h.messages.at(-1)?.tone).toBe('success');
  });
  it('mantém transação pendente de validação sem finalizar nem atualizar acesso', async () => {
    const h = harness({ purchases: [purchase], verification: { verified: false } }); await h.controller.start();
    expect(h.bridge.finishTransaction).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.title).toContain('validação');
  });
  it('uma compra pendente de validação impede uma segunda cobrança', async () => {
    const h = harness({ purchases: [purchase], verification: { verified: false } });
    await h.controller.start(); await h.controller.subscribe('pro');
    expect(h.bridge.requestPurchase).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.title).toContain('aguarda confirmação');
  });
  it('não reconhece novamente uma compra Google que o servidor já reconheceu', async () => {
    const googlePurchase = { ...purchase, purchaseToken: 'google-purchase-token', storeId: 'play', obfuscatedAccountIdAndroid: owner } as Purchase;
    const h = harness({ platform: 'google', purchases: [googlePurchase], verification: { verified: true, plan: 'pro', subscriptionEnd: '2099-01-01T00:00:00Z', storeAcknowledged: true } });
    await h.controller.start();
    expect(h.verify).toHaveBeenCalledWith({ action: 'verify', platform: 'google', productId: purchase.productId, purchaseToken: 'google-purchase-token' });
    expect(h.bridge.finishTransaction).not.toHaveBeenCalled(); expect(h.refresh).toHaveBeenCalledOnce();
  });
  it('não concede acesso para resultado de validação sem vigência futura', async () => {
    const h = harness({ purchases: [purchase], verification: { verified: true, plan: 'pro', subscriptionEnd: '2020-01-01T00:00:00Z' } });
    await h.controller.start(); expect(h.bridge.finishTransaction).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled();
  });
  it('pagamento pendente e cancelamento nunca finalizam uma transação', async () => {
    const h = harness({ purchases: [{ ...purchase, purchaseState: 'pending' }] }); await h.controller.start();
    expect(h.verify).not.toHaveBeenCalled(); expect(h.bridge.finishTransaction).not.toHaveBeenCalled();
    h.error('user-cancelled'); expect(h.states.at(-1)?.operation).toBeNull();
    expect(h.messages.some((m) => m.tone === 'error')).toBe(false);
  });
  it('restauração de compra de outra conta não chama verificação nem finalização', async () => {
    const h = harness({ purchases: [{ ...purchase, appAccountToken: 'other-user' } as Purchase] }); await h.controller.start();
    expect(h.verify).not.toHaveBeenCalled(); expect(h.bridge.finishTransaction).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.title).toContain('outra conta');
  });
  it('troca de usuário durante verificação impede finalização e refresh da nova conta', async () => {
    let resolve: (v: any) => void = () => undefined;
    const deferred = new Promise((next) => { resolve = next; });
    const h = harness({ purchases: [purchase], verification: deferred });
    const start = h.controller.start(); await vi.waitFor(() => expect(h.verify).toHaveBeenCalledOnce());
    h.switchUser(); resolve({ verified: true, plan: 'pro', subscriptionEnd: '2099-01-01T00:00:00Z' }); await start;
    expect(h.bridge.finishTransaction).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled();
  });
  it('assinante Stripe não inicia segunda compra nem abre gerenciamento nativo', async () => {
    const h = harness({ profile: { id: owner, plan: 'pro', entitlement_source: 'stripe' } });
    await h.controller.start(); await h.controller.subscribe('premium');
    expect(h.bridge.requestPurchase).not.toHaveBeenCalled(); expect(h.bridge.deepLinkToSubscriptions).not.toHaveBeenCalled();
    expect(h.messages.at(-1)?.description).toContain('Não é necessário assinar novamente');
  });
  it('mudança de plano já ativo vai ao gerenciamento original, sem segunda compra', async () => {
    const h = harness({ profile: { id: owner, plan: 'pro', entitlement_source: 'apple' } });
    await h.controller.start(); await h.controller.subscribe('premium');
    expect(h.bridge.deepLinkToSubscriptions).toHaveBeenCalledOnce(); expect(h.bridge.requestPurchase).not.toHaveBeenCalled();
  });
  it('assinante da loja consegue gerenciar mesmo com o catálogo temporariamente desabilitado', async () => {
    const h = harness({ disabled: true, profile: { id: owner, plan: 'pro', entitlement_source: 'apple' } });
    await h.controller.start(); await h.controller.manage();
    expect(h.openStoreManagement).toHaveBeenCalledWith('apple', undefined);
    expect(h.loadBridge).not.toHaveBeenCalled(); expect(h.bridge.requestPurchase).not.toHaveBeenCalled();
  });
});

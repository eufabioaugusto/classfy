import type { ProductSubscription, Purchase, RequestPurchaseProps } from 'expo-iap';

export type PaidPlan = 'pro' | 'premium';
export type StorePlatform = 'apple' | 'google';
export type StoreCatalogProduct = { plan: PaidPlan; productId: string; basePlanId?: string };
export type StoreCatalog = { enabled: boolean; products: StoreCatalogProduct[]; reason?: string };
export type StoreProduct = StoreCatalogProduct & { displayPrice: string; offerToken?: string };
export type BillingProfile = {
  id: string;
  plan: string | null;
  entitlement_source?: string | null;
  plan_expires_at?: string | null;
};
export type BillingMessage = { title: string; description: string; tone: 'success' | 'info' | 'error' };
export type BillingState = {
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  operation: 'purchase' | 'restore' | 'verify' | 'manage' | null;
  purchasingPlan: PaidPlan | null;
  products: StoreProduct[];
  reason?: string;
};
export const initialBillingState: BillingState = {
  status: 'loading', operation: null, purchasingPlan: null, products: [],
};

export interface StoreBridge {
  initConnection: () => Promise<boolean>;
  endConnection: () => Promise<boolean>;
  fetchProducts: (args: { skus: string[]; type: 'subs' }) => Promise<ProductSubscription[]>;
  requestPurchase: (args: RequestPurchaseProps) => Promise<unknown>;
  getAvailablePurchases: () => Promise<Purchase[]>;
  restorePurchases: () => Promise<unknown>;
  finishTransaction: (args: { purchase: Purchase; isConsumable: false }) => Promise<unknown>;
  deepLinkToSubscriptions: (args?: { packageNameAndroid: string; skuAndroid?: string }) => Promise<void>;
  purchaseUpdatedListener: (listener: (purchase: Purchase) => void) => { remove: () => void };
  purchaseErrorListener: (listener: (error: { code: string; message: string }) => void) => { remove: () => void };
}

export function nativeBillingUnavailable(os: string, expoGo: boolean): string | null {
  if (os !== 'ios' && os !== 'android') return 'As assinaturas deste aplicativo são gerenciadas pela App Store ou pelo Google Play.';
  if (expoGo) return 'As compras ficam disponíveis na versão instalada da Classfy. Este ambiente de testes ainda não permite pagamentos.';
  return null;
}

export function hasPaidAccess(profile: BillingProfile | null): boolean {
  return Boolean(profile && ['pro', 'premium'].includes(profile.plan ?? '')
    && (!profile.plan_expires_at || Date.parse(profile.plan_expires_at) > Date.now()));
}

export function storeForProfile(profile: BillingProfile | null): StorePlatform | null {
  if (profile?.entitlement_source === 'apple') return 'apple';
  if (profile?.entitlement_source === 'google') return 'google';
  return null;
}

// Only sell the regular monthly base plan. Introductory offers need their own
// disclosures; selecting one implicitly would show a misleading monthly price.
export function resolveStoreProducts(catalog: StoreCatalogProduct[], products: ProductSubscription[], platform: StorePlatform): StoreProduct[] {
  return catalog.flatMap((item) => {
    const product = products.find((candidate) => candidate.id === item.productId && candidate.type === 'subs');
    if (!product || product.platform !== (platform === 'apple' ? 'ios' : 'android')) return [];
    if (product.platform === 'ios') {
      if (product.subscriptionPeriodUnitIOS !== 'month' || product.subscriptionPeriodNumberIOS !== '1' || !product.displayPrice.trim()) return [];
      return [{ ...item, displayPrice: product.displayPrice }];
    }
    const offer = product.subscriptionOffers.find((candidate) => {
      const phases = candidate.pricingPhasesAndroid?.pricingPhaseList ?? [];
      return candidate.basePlanIdAndroid === item.basePlanId && Boolean(candidate.offerTokenAndroid)
        && phases.length === 1 && phases[0].billingPeriod === 'P1M' && phases[0].recurrenceMode === 1;
    });
    const displayPrice = offer?.pricingPhasesAndroid?.pricingPhaseList[0]?.formattedPrice;
    return offer && displayPrice?.trim()
      ? [{ ...item, displayPrice, offerToken: offer.offerTokenAndroid! }]
      : [];
  });
}

export function subscriptionRequest(product: StoreProduct, platform: StorePlatform, userId: string): RequestPurchaseProps {
  if (platform === 'apple') {
    return { type: 'subs', request: { apple: { sku: product.productId, appAccountToken: userId, andDangerouslyFinishTransactionAutomatically: false } } };
  }
  if (!product.offerToken) throw new Error('Este plano ainda não está disponível no Google Play.');
  return { type: 'subs', request: { google: { skus: [product.productId], obfuscatedAccountId: userId, subscriptionOffers: [{ sku: product.productId, offerToken: product.offerToken }] } } };
}

export function purchaseBelongsToUser(purchase: Purchase, platform: StorePlatform, userId: string): boolean {
  const owner = platform === 'apple'
    ? ('appAccountToken' in purchase ? purchase.appAccountToken : null)
    : ('obfuscatedAccountIdAndroid' in purchase ? purchase.obfuscatedAccountIdAndroid : null);
  // Some store responses omit the account field. The server always validates
  // the store-signed ownership before granting access, including restoration.
  return !owner || owner.toLowerCase() === userId.toLowerCase();
}

export class StoreBillingController {
  private state: BillingState = initialBillingState;
  private active = true;
  private bridge: StoreBridge | null = null;
  private catalog: StoreCatalogProduct[] = [];
  private listeners: Array<{ remove: () => void }> = [];
  private inFlight = new Map<string, Promise<boolean>>();
  private completed = new Set<string>();
  private purchaseFlow = false;
  private foregroundOperation: 'purchase' | 'restore' | 'manage' | null = null;
  private reconciling = false;
  private unresolvedProducts = new Set<string>();

  constructor(private options: {
    ownerId: string;
    platform: StorePlatform;
    getUserId: () => string | null;
    getProfile: () => BillingProfile | null;
    loadBridge: () => Promise<StoreBridge>;
    catalog: () => Promise<StoreCatalog>;
    verify: (body: { action: 'verify'; platform: StorePlatform; productId: string; transactionId?: string; purchaseToken?: string }) => Promise<{ verified: boolean; plan?: PaidPlan; subscriptionEnd?: string; storeAcknowledged?: boolean }>;
    refreshProfile: () => Promise<void>;
    openStoreManagement?: (platform: StorePlatform, productId?: string) => Promise<void>;
    onState: (state: BillingState) => void;
    onMessage: (message: BillingMessage) => void;
  }) {}

  private current() { return this.active && this.options.getUserId() === this.options.ownerId; }
  private update(patch: Partial<BillingState>) {
    this.state = { ...this.state, ...patch };
    if (this.current()) this.options.onState(this.state);
  }
  private notify(message: BillingMessage) { if (this.current()) this.options.onMessage(message); }

  async start() {
    try {
      const catalog = await this.options.catalog();
      if (!this.current()) return;
      if (!catalog.enabled || !catalog.products.length) {
        this.update({ status: 'unavailable', reason: 'As assinaturas pelo aplicativo ainda estão sendo preparadas. Seu acesso atual continua disponível.' });
        return;
      }
      this.catalog = catalog.products;
      const bridge = await this.options.loadBridge();
      if (!this.current()) return;
      this.bridge = bridge;
      this.listeners.push(bridge.purchaseUpdatedListener((purchase) => { void this.processPurchase(purchase).catch(() => undefined); }));
      this.listeners.push(bridge.purchaseErrorListener((error) => this.handleStoreError(error)));
      if (!await bridge.initConnection()) throw new Error('Não foi possível conectar à loja.');
      if (!this.current()) return;
      const products = resolveStoreProducts(this.catalog, await bridge.fetchProducts({ skus: this.catalog.map((p) => p.productId), type: 'subs' }), this.options.platform);
      if (!this.current()) return;
      this.update({ status: 'ready', products, reason: products.length ? undefined : 'Os planos ainda não estão disponíveis para sua conta na loja. Você pode restaurar uma assinatura existente.' });
      // Recover unfinished transactions after an interrupted checkout, without
      // opening a purchase sheet or granting client-side entitlements.
      await this.reconcile(false);
    } catch (error) {
      this.update({ status: 'error', reason: error instanceof Error ? error.message : 'Não foi possível carregar as assinaturas. Tente novamente.' });
    }
  }

  private handleStoreError(error: { code: string; message: string }) {
    if (!this.current()) return;
    this.purchaseFlow = false;
    this.foregroundOperation = null;
    this.update({ operation: null, purchasingPlan: null });
    if (error.code === 'user-cancelled') return;
    if (error.code === 'deferred-payment') {
      this.notify({ title: 'Aguardando aprovação', description: 'A loja está aguardando a confirmação do pagamento. Seu plano será liberado após a aprovação.', tone: 'info' });
      return;
    }
    this.notify({ title: 'Não foi possível concluir', description: 'Confira sua conta e a forma de pagamento na loja. Você pode tentar novamente ou restaurar uma compra já feita.', tone: 'error' });
  }

  async subscribe(plan: PaidPlan) {
    if (!this.current() || this.state.operation || this.foregroundOperation || this.inFlight.size || this.reconciling) return;
    const profile = this.options.getProfile();
    if (!profile || profile.id !== this.options.ownerId) {
      this.notify({ title: 'Atualize sua conta', description: 'Não foi possível confirmar seu plano atual. Tente novamente antes de iniciar uma assinatura.', tone: 'error' });
      return;
    }
    if (hasPaidAccess(profile)) { await this.manage(); return; }
    if (this.unresolvedProducts.size) {
      this.notify({ title: 'Uma compra aguarda confirmação', description: 'Aguarde a aprovação do pagamento ou use Restaurar compras para validar a assinatura já realizada antes de iniciar outra.', tone: 'info' });
      return;
    }
    const product = this.state.products.find((item) => item.plan === plan);
    if (!this.bridge || this.state.status !== 'ready' || !product) {
      this.notify({ title: 'Assinaturas em preparação', description: this.state.reason ?? 'Este plano ainda não está disponível na loja.', tone: 'info' });
      return;
    }
    try {
      this.purchaseFlow = true;
      this.foregroundOperation = 'purchase';
      this.update({ operation: 'purchase', purchasingPlan: plan });
      await this.bridge.requestPurchase(subscriptionRequest(product, this.options.platform, this.options.ownerId));
      // StoreKit and Play deliver the result through purchaseUpdatedListener.
      // Resolving requestPurchase itself is never proof of a successful charge.
    } catch (error) {
      this.handleStoreError({ code: typeof error === 'object' && error && 'code' in error ? String(error.code) : '', message: '' });
    }
  }

  private async processPurchase(purchase: Purchase): Promise<boolean> {
    if (!this.current() || !this.bridge || !this.catalog.some((p) => p.productId === purchase.productId)) return false;
    if (!purchaseBelongsToUser(purchase, this.options.platform, this.options.ownerId)) {
      this.purchaseFlow = false;
      if (this.foregroundOperation === 'purchase') this.foregroundOperation = null;
      this.update({ operation: null, purchasingPlan: null });
      this.notify({ title: 'Compra vinculada a outra conta', description: 'Entre na conta Classfy que realizou esta assinatura para restaurá-la.', tone: 'info' });
      return false;
    }
    if (purchase.purchaseState !== 'purchased' || ('isSuspendedAndroid' in purchase && purchase.isSuspendedAndroid)) {
      if (purchase.purchaseState === 'pending' || ('isSuspendedAndroid' in purchase && purchase.isSuspendedAndroid)) this.unresolvedProducts.add(purchase.productId);
      this.purchaseFlow = false;
      if (this.foregroundOperation === 'purchase') this.foregroundOperation = null;
      this.update({ operation: null, purchasingPlan: null });
      if (purchase.purchaseState === 'pending') this.notify({ title: 'Pagamento pendente', description: 'A loja ainda está confirmando sua compra. Seu plano será liberado quando o pagamento for aprovado.', tone: 'info' });
      return false;
    }
    const key = `${purchase.productId}:${this.options.platform === 'apple' && 'transactionId' in purchase ? purchase.transactionId : purchase.purchaseToken}`;
    if (this.completed.has(key)) return true;
    this.unresolvedProducts.add(purchase.productId);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const operation = this.verifyAndFinish(purchase, key);
    this.inFlight.set(key, operation);
    try { return await operation; } finally { this.inFlight.delete(key); }
  }

  private async verifyAndFinish(purchase: Purchase, key: string): Promise<boolean> {
    const announce = this.purchaseFlow;
    try {
      this.update({ operation: 'verify' });
      const transactionId = 'transactionId' in purchase ? purchase.transactionId ?? undefined : undefined;
      if ((this.options.platform === 'apple' && !transactionId) || (this.options.platform === 'google' && !purchase.purchaseToken)) throw new Error('missing_receipt');
      const result = await this.options.verify({ action: 'verify', platform: this.options.platform, productId: purchase.productId,
        ...(this.options.platform === 'apple' ? { transactionId } : { purchaseToken: purchase.purchaseToken! }) });
      if (!this.current()) return false;
      if (!result.verified || !['pro', 'premium'].includes(result.plan ?? '') || !result.subscriptionEnd || Date.parse(result.subscriptionEnd) <= Date.now() || !Number.isFinite(Date.parse(result.subscriptionEnd))) throw new Error('unverified_receipt');
      if (!(this.options.platform === 'google' && result.storeAcknowledged === true)) {
        await this.bridge!.finishTransaction({ purchase, isConsumable: false });
      }
      if (!this.current()) return false;
      await this.options.refreshProfile();
      if (!this.current()) return false;
      this.completed.add(key);
      this.unresolvedProducts.delete(purchase.productId);
      if (announce) this.notify({ title: 'Assinatura confirmada', description: `Seu Classfy ${result.plan === 'premium' ? 'Premium' : 'Pro'} está disponível.`, tone: 'success' });
      return true;
    } catch {
      if (this.current()) this.notify({ title: 'Compra aguardando validação', description: 'Não conseguimos confirmar esta compra agora. Ela permanece disponível para restauração; tente novamente em instantes.', tone: 'error' });
      return false;
    } finally {
      this.purchaseFlow = false;
      if (this.foregroundOperation === 'purchase') this.foregroundOperation = null;
      this.update({ operation: this.foregroundOperation ?? (this.reconciling ? 'verify' : null), purchasingPlan: null });
    }
  }

  private async reconcile(announce: boolean): Promise<void> {
    if (!this.bridge || !this.current() || this.reconciling) return;
    this.reconciling = true;
    this.update({ operation: this.foregroundOperation ?? 'verify' });
    try {
      const purchases = await this.bridge.getAvailablePurchases();
      let restored = 0;
      let unresolved = false;
      for (const purchase of purchases) {
        if (!this.current()) return;
        if (await this.processPurchase(purchase)) restored++;
        else if (this.catalog.some((p) => p.productId === purchase.productId)) unresolved = true;
      }
      if (announce && !unresolved) this.notify(restored
        ? { title: 'Assinatura restaurada', description: 'Seu acesso foi confirmado na loja e atualizado nesta conta.', tone: 'success' }
        : { title: 'Nenhuma assinatura restaurada', description: 'Não encontramos uma assinatura ativa que possa ser vinculada a esta conta Classfy.', tone: 'info' });
    } finally {
      this.reconciling = false;
      this.update({ operation: this.foregroundOperation });
    }
  }

  async restore() {
    if (!this.current() || this.state.operation || this.foregroundOperation || this.inFlight.size || this.reconciling) return;
    if (!this.bridge || this.state.status !== 'ready') {
      this.notify({ title: 'Restauração indisponível', description: this.state.reason ?? 'Não foi possível conectar à loja.', tone: 'info' });
      return;
    }
    try {
      this.foregroundOperation = 'restore';
      this.update({ operation: 'restore' });
      await this.bridge.restorePurchases();
      if (this.current()) await this.reconcile(true);
    } catch {
      this.notify({ title: 'Não foi possível restaurar', description: 'Confira se você está usando a mesma conta da App Store ou do Google Play da compra e tente novamente.', tone: 'error' });
    } finally { this.foregroundOperation = null; this.update({ operation: null }); }
  }

  async manage() {
    if (!this.current() || this.state.operation || this.foregroundOperation || this.inFlight.size || this.reconciling) return;
    const profile = this.options.getProfile();
    const source = storeForProfile(profile);
    if (hasPaidAccess(profile) && source !== this.options.platform) {
      this.notify({ title: 'Sua assinatura já está ativa', description: source
        ? `Esta assinatura é gerenciada ${source === 'apple' ? 'pela App Store' : 'pelo Google Play'}. Use a loja da compra original para alterar ou cancelar seu plano.`
        : 'Seu acesso contratado fora do aplicativo continua disponível. Para alterar ou cancelar, acesse sua conta Classfy pelo navegador. Não é necessário assinar novamente aqui.', tone: 'info' });
      return;
    }
    if (!this.bridge && !this.options.openStoreManagement) {
      this.notify({ title: 'Gerenciamento indisponível', description: this.state.reason ?? 'Não foi possível conectar à loja neste aplicativo.', tone: 'info' });
      return;
    }
    try {
      this.foregroundOperation = 'manage';
      this.update({ operation: 'manage' });
      const sku = this.catalog.find((p) => p.plan === profile?.plan)?.productId;
      if (this.bridge) {
        try { await this.bridge.deepLinkToSubscriptions(this.options.platform === 'google' ? { packageNameAndroid: 'br.com.classfy.mobile', skuAndroid: sku } : undefined); }
        catch (error) { if (this.options.openStoreManagement) await this.options.openStoreManagement(this.options.platform, sku); else throw error; }
      } else {
        await this.options.openStoreManagement!(this.options.platform, sku);
      }
    } catch {
      this.notify({ title: 'Abra as assinaturas da loja', description: `Você também pode alterar ou cancelar seu plano nas configurações de assinaturas ${this.options.platform === 'apple' ? 'da App Store' : 'do Google Play'}.`, tone: 'info' });
    } finally { this.foregroundOperation = null; this.update({ operation: null }); }
  }

  async resume() {
    if (!this.current() || this.state.operation || this.foregroundOperation || this.inFlight.size || this.reconciling || this.state.status !== 'ready') return;
    try { await this.reconcile(false); if (this.current()) await this.options.refreshProfile(); } catch { /* Try again on the next foreground or explicit restore. */ }
  }

  dispose() {
    this.active = false;
    this.listeners.forEach((listener) => listener.remove());
    this.listeners = [];
    if (this.bridge) void this.bridge.endConnection().catch(() => undefined);
  }
}

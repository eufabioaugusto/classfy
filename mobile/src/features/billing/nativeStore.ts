import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { nativeBillingUnavailable, type StoreBridge, type StorePlatform } from './storeBilling';

export function currentStorePlatform(): StorePlatform | null {
  return Platform.OS === 'ios' ? 'apple' : Platform.OS === 'android' ? 'google' : null;
}

export function nativeStoreReason(): string | null {
  return nativeBillingUnavailable(Platform.OS, Constants.executionEnvironment === ExecutionEnvironment.StoreClient);
}

export async function loadNativeStore(): Promise<StoreBridge> {
  const unavailable = nativeStoreReason();
  if (unavailable) throw new Error(unavailable);
  // The current development installation may predate expo-iap. Defer native
  // module loading, so opening Premium never crashes an older binary/Expo Go.
  try {
    const iap = await import('expo-iap');
    return {
      initConnection: async () => {
        try { return await iap.initConnection(); }
        catch { throw new Error('Esta instalação ainda não inclui as compras da loja. Atualize o aplicativo quando a nova versão estiver disponível.'); }
      },
      endConnection: iap.endConnection,
      fetchProducts: async (args) => (await iap.fetchProducts(args) ?? []).filter((p) => p.type === 'subs'),
      requestPurchase: iap.requestPurchase,
      getAvailablePurchases: () => iap.getAvailablePurchases(),
      restorePurchases: () => iap.restorePurchases(),
      finishTransaction: iap.finishTransaction,
      deepLinkToSubscriptions: iap.deepLinkToSubscriptions,
      purchaseUpdatedListener: (listener) => {
        try { return iap.purchaseUpdatedListener(listener); }
        catch { throw new Error('Esta instalação ainda não inclui as compras da loja. Atualize o aplicativo quando a nova versão estiver disponível.'); }
      },
      purchaseErrorListener: (listener) => iap.purchaseErrorListener((error) => listener({ code: error.code ?? '', message: error.message })),
    };
  } catch {
    throw new Error('As compras ainda não estão disponíveis nesta instalação. Seu acesso atual continua funcionando.');
  }
}

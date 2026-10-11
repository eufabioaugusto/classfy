import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ os: 'ios', environment: 'standalone', imported: vi.fn(), init: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { get OS() { return runtime.os; } } }));
vi.mock('expo-constants', () => ({
  default: { get executionEnvironment() { return runtime.environment; } },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));
vi.mock('expo-iap', () => {
  runtime.imported();
  return {
    initConnection: runtime.init,
    endConnection: vi.fn(async () => true),
    requestPurchase: vi.fn(async () => undefined),
    finishTransaction: vi.fn(async () => undefined),
    deepLinkToSubscriptions: vi.fn(async () => undefined),
    purchaseUpdatedListener: vi.fn(() => ({ remove: vi.fn() })),
    purchaseErrorListener: vi.fn(() => ({ remove: vi.fn() })),
  };
});

describe('carregamento seguro do módulo nativo de compras', () => {
  beforeEach(() => { runtime.os = 'ios'; runtime.environment = 'standalone'; vi.clearAllMocks(); vi.resetModules(); });
  it('Expo Go não importa nem tenta inicializar a biblioteca de compras', async () => {
    runtime.environment = 'storeClient';
    const { loadNativeStore } = await import('./nativeStore');
    await expect(loadNativeStore()).rejects.toThrow('ambiente de testes');
    expect(runtime.imported).not.toHaveBeenCalled(); expect(runtime.init).not.toHaveBeenCalled();
  });
  it('a versão web não tenta acessar StoreKit ou Google Billing', async () => {
    runtime.os = 'web';
    const { loadNativeStore, currentStorePlatform } = await import('./nativeStore');
    expect(currentStorePlatform()).toBeNull(); await expect(loadNativeStore()).rejects.toThrow('App Store');
    expect(runtime.imported).not.toHaveBeenCalled();
  });
  it('binário antigo sem ExpoIap exibe erro compreensível sem propagar falha nativa', async () => {
    runtime.init.mockRejectedValue(new Error("Cannot find native module 'ExpoIap'"));
    const { loadNativeStore } = await import('./nativeStore');
    const bridge = await loadNativeStore();
    await expect(bridge.initConnection()).rejects.toThrow('Esta instalação ainda não inclui');
    expect(runtime.init).toHaveBeenCalledOnce();
  });
});

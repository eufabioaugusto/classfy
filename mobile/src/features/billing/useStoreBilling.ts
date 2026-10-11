import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { currentStorePlatform, loadNativeStore, nativeStoreReason } from './nativeStore';
import { StoreBillingController, hasPaidAccess, storeForProfile, initialBillingState, type BillingMessage, type BillingState, type PaidPlan, type StoreCatalog } from './storeBilling';

export function useStoreBilling() {
  const { user, profile, refreshProfile } = useAuth();
  const [state, setState] = useState<BillingState>(initialBillingState);
  const [message, setMessage] = useState<BillingMessage | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<StoreBillingController | null>(null);
  const auth = useRef({ user, profile, refreshProfile });
  auth.current = { user, profile, refreshProfile };
  const platform = currentStorePlatform();
  const openStoreManagement = useCallback(async (store: 'apple' | 'google', productId?: string) => {
    const url = store === 'apple' ? 'https://apps.apple.com/account/subscriptions'
      : `https://play.google.com/store/account/subscriptions?package=br.com.classfy.mobile${productId ? `&sku=${encodeURIComponent(productId)}` : ''}`;
    await Linking.openURL(url);
  }, []);
  const fallbackMessage = useCallback(() => {
    const currentProfile = auth.current.profile;
    const source = storeForProfile(currentProfile);
    if (hasPaidAccess(currentProfile)) {
      setMessage({ title: 'Sua assinatura já está ativa', description: source
        ? `Gerencie ou cancele esta assinatura nas configurações ${source === 'apple' ? 'da App Store' : 'do Google Play'} da compra original.`
        : 'Seu acesso contratado fora do aplicativo continua disponível. Para alterar ou cancelar, acesse sua conta Classfy pelo navegador. Não é necessário assinar novamente aqui.', tone: 'info' });
      return;
    }
    setMessage({ title: 'Assinaturas em preparação', description: 'As compras e a restauração estarão disponíveis quando esta instalação estiver conectada à loja. Seu acesso atual continua funcionando.', tone: 'info' });
  }, []);

  useEffect(() => {
    setMessage(null);
    setState(initialBillingState);
    const reason = nativeStoreReason();
    if (reason || !platform) {
      setState({ ...initialBillingState, status: 'unavailable', reason: reason ?? 'A loja não está disponível neste dispositivo.' });
      return;
    }
    if (!user?.id) {
      setState({ ...initialBillingState, status: 'unavailable', reason: 'Entre na sua conta para consultar e restaurar as assinaturas.' });
      return;
    }
    const current = new StoreBillingController({
      ownerId: user.id,
      platform,
      getUserId: () => auth.current.user?.id ?? null,
      getProfile: () => auth.current.profile,
      loadBridge: loadNativeStore,
      catalog: async () => {
        const { data, error } = await supabase.functions.invoke('mobile-subscription', { body: { action: 'catalog', platform } });
        if (error) throw new Error('Não foi possível consultar as assinaturas. Confira sua conexão e tente novamente.');
        return { enabled: data?.enabled === true, products: Array.isArray(data?.products) ? data.products : [] } as StoreCatalog;
      },
      verify: async (body) => {
        const { data, error } = await supabase.functions.invoke('mobile-subscription', { body });
        if (error) throw new Error('purchase_verification_failed');
        return data;
      },
      refreshProfile: () => auth.current.refreshProfile(),
      openStoreManagement,
      onState: setState,
      onMessage: setMessage,
    });
    controller.current = current;
    void current.start();
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') void current.resume();
    });
    return () => {
      listener.remove();
      current.dispose();
      if (controller.current === current) controller.current = null;
    };
  }, [user?.id, platform, attempt, openStoreManagement]);

  return {
    ...state,
    platform,
    message,
    dismissMessage: useCallback(() => setMessage(null), []),
    retry: useCallback(() => setAttempt((value) => value + 1), []),
    subscribe: useCallback((plan: PaidPlan) => controller.current ? controller.current.subscribe(plan) : fallbackMessage(), [fallbackMessage]),
    restore: useCallback(() => controller.current ? controller.current.restore() : fallbackMessage(), [fallbackMessage]),
    manage: useCallback(() => controller.current ? controller.current.manage() : fallbackMessage(), [fallbackMessage]),
  };
}

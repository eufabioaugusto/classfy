import { useCallback, useEffect, useRef, useState } from 'react';
import { readStudioPremiumProfile, studioPremiumAccess, StudioPremiumError, type StudioPremiumProfile } from '@/lib/studio/editor/entitlementPremium';

type State = { owner: string | null; loading: boolean; profile: StudioPremiumProfile | null; error: string | null; now: number };
export function useStudioPremiumEntitlement(owner: string | null) {
  const [state, setState] = useState<State>({ owner, loading: !!owner, profile: null, error: null, now: Date.now() });
  const scope = useRef({ owner, epoch: 0, mounted: false });
  const flight = useRef<AbortController | null>(null);
  // Synchronously hide the previous account's result before effects run.
  if (scope.current.owner !== owner) { scope.current.owner = owner; scope.current.epoch++; }
  const refresh = useCallback(async (verifySubscription = false): Promise<boolean> => {
    if (!owner || !scope.current.mounted || scope.current.owner !== owner) return false;
    const epoch = ++scope.current.epoch, controller = new AbortController();
    flight.current?.abort(); flight.current = controller;
    const isCurrent = () => scope.current.mounted && scope.current.owner === owner && scope.current.epoch === epoch;
    setState({ owner, loading: true, profile: null, error: null, now: Date.now() });
    try {
      const profile = await readStudioPremiumProfile(owner, { signal: controller.signal, isCurrent }, verifySubscription);
      if (!isCurrent()) return false;
      const now = Date.now(); setState({ owner, loading: false, profile, error: null, now });
      return studioPremiumAccess(profile, now).canUseScenes;
    } catch (cause) {
      if (isCurrent() && !controller.signal.aborted) setState({ owner, loading: false, profile: null, error: cause instanceof StudioPremiumError ? cause.message : 'Não foi possível confirmar seu plano. Tente novamente.', now: Date.now() });
      return false;
    } finally { if (flight.current === controller) flight.current = null; }
  }, [owner]);
  useEffect(() => {
    const lifecycle = scope.current;
    lifecycle.mounted = true;
    if (owner) void refresh();
    // Focus and visibility often arrive together. A background read must not
    // supersede the explicit verification already reconciling Stripe/profile.
    const recheck = () => { if (!flight.current && document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', recheck); document.addEventListener('visibilitychange', recheck);
    return () => {
      lifecycle.mounted = false; lifecycle.epoch++; flight.current?.abort(); flight.current = null;
      window.removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', recheck);
    };
  }, [owner, refresh]);
  const view = state.owner === owner ? state : { owner, loading: !!owner, profile: null, error: null, now: Date.now() };
  const access = studioPremiumAccess(view.profile, view.now);
  useEffect(() => {
    if (access.expiresAt === null) return;
    const check = () => setState(previous => previous.owner === owner ? { ...previous, now: Date.now() } : previous);
    const timer = setTimeout(check, Math.min(2_147_483_647, Math.max(0, access.expiresAt - Date.now() + 1)));
    return () => clearTimeout(timer);
  }, [owner, access.expiresAt, view.now]);
  return { ...access, canUseScenes: !view.loading && !view.error && access.canUseScenes, loading: view.loading, profile: view.profile, error: view.error, refresh };
}

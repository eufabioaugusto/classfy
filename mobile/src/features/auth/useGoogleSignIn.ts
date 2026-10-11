import { useCallback, useEffect, useRef, useState } from 'react';

import { isGoogleSignInAvailable, startGoogleSignIn } from './googleOAuth';
import { AuthReturnParams, GoogleOAuthResult, MobileOAuthError } from './oauth';

export function useGoogleSignIn(params: AuthReturnParams = {}) {
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [googleChecking, setGoogleChecking] = useState(true);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    isGoogleSignInAvailable(controller.signal)
      .then((available) => { if (mounted.current) setGoogleAvailable(available); })
      .catch(() => { if (mounted.current) setGoogleAvailable(false); })
      .finally(() => { clearTimeout(timeout); if (mounted.current) setGoogleChecking(false); });
    return () => { mounted.current = false; clearTimeout(timeout); controller.abort(); };
  }, []);

  const clearGoogleError = useCallback(() => setGoogleError(null), []);
  const signInWithGoogle = useCallback(async (): Promise<GoogleOAuthResult | null> => {
    setGoogleError(null);
    setGoogleLoading(true);
    try {
      return await startGoogleSignIn(params);
    } catch (error) {
      if (mounted.current) setGoogleError(error instanceof MobileOAuthError
        ? error.message : 'Não foi possível entrar com Google. Tente novamente.');
      return null;
    } finally {
      if (mounted.current) setGoogleLoading(false);
    }
  }, [params.contentId, params.liveId]);

  return { googleAvailable, googleChecking, googleLoading, googleError, clearGoogleError, signInWithGoogle };
}

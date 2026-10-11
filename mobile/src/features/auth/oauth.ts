export const GOOGLE_OAUTH_REDIRECT = 'classfy://auth/callback';
export const OAUTH_ATTEMPT_TTL_MS = 20 * 60 * 1000;

export type AuthReturnParams = { contentId?: string; liveId?: string };
export type AuthDestination = '/(tabs)' | {
  pathname: '/live/[id]' | '/watch/[id]';
  params: { id: string };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveAuthDestination({ contentId, liveId }: AuthReturnParams = {}): AuthDestination {
  if (typeof liveId === 'string' && UUID.test(liveId)) {
    return { pathname: '/live/[id]', params: { id: liveId } };
  }
  if (typeof contentId === 'string' && UUID.test(contentId)) {
    return { pathname: '/watch/[id]', params: { id: contentId } };
  }
  return '/(tabs)';
}

export type PendingOAuthAttempt = {
  id: string;
  createdAt: number;
  destination: AuthDestination;
};

export type GoogleOAuthResult =
  | { status: 'success'; destination: AuthDestination }
  | { status: 'cancelled' };

export class MobileOAuthError extends Error {
  readonly code: 'expired' | 'callback' | 'provider' | 'exchange' | 'unavailable';

  constructor(code: 'expired' | 'callback' | 'provider' | 'exchange' | 'unavailable') {
    super({
      expired: 'Essa tentativa expirou. Toque em Google para tentar novamente.',
      callback: 'Não foi possível concluir o acesso. Tente entrar novamente.',
      provider: 'Não foi possível entrar com o Google. Tente novamente.',
      exchange: 'Não foi possível confirmar seu acesso. Tente novamente.',
      unavailable: 'O acesso com Google está indisponível agora. Tente novamente em instantes.',
    }[code]);
    this.code = code;
    this.name = 'MobileOAuthError';
  }
}

export function parseOAuthCallback(url: string) {
  let callback: URL;
  try {
    callback = new URL(url);
  } catch {
    throw new MobileOAuthError('callback');
  }
  if (callback.protocol !== 'classfy:' || callback.hostname !== 'auth' || callback.pathname !== '/callback'
    || callback.username || callback.password || callback.port) {
    throw new MobileOAuthError('callback');
  }
  // PKCE returns a one-time code. Never accept tokens from a deep link.
  const fragment = new URLSearchParams(callback.hash.slice(1));
  if (callback.searchParams.has('access_token') || callback.searchParams.has('refresh_token')
    || fragment.has('access_token') || fragment.has('refresh_token') || fragment.has('code')) {
    throw new MobileOAuthError('callback');
  }
  const attempt = callback.searchParams.get('attempt');
  if (!attempt || !UUID.test(attempt)) throw new MobileOAuthError('callback');
  const error = callback.searchParams.get('error') ?? fragment.get('error');
  const errorCode = callback.searchParams.get('error_code') ?? fragment.get('error_code');
  const code = callback.searchParams.get('code');
  if ((!code && !error && !errorCode) || (callback.hash && !error && !errorCode)) throw new MobileOAuthError('callback');
  return { attempt, code, error: error || errorCode };
}

export function readPendingOAuthAttempt(raw: string | null, now = Date.now()): PendingOAuthAttempt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PendingOAuthAttempt;
    if (!value || !UUID.test(value.id) || !Number.isFinite(value.createdAt) || value.createdAt > now
      || now - value.createdAt > OAUTH_ATTEMPT_TTL_MS) return null;
    const destination = value.destination;
    if (destination !== '/(tabs)' && (!destination || !UUID.test(destination.params?.id)
      || !['/live/[id]', '/watch/[id]'].includes(destination.pathname))) return null;
    return value;
  } catch {
    return null;
  }
}

type OAuthCoordinatorDependencies = {
  readPending: () => Promise<PendingOAuthAttempt | null>;
  clearPending: (attemptId: string) => Promise<void>;
  exchangeCode: (code: string) => Promise<void>;
};

/** Router callbacks and the browser result can arrive together on Android. */
export function createOAuthCallbackCoordinator(dependencies: OAuthCoordinatorDependencies) {
  const completions = new Map<string, Promise<GoogleOAuthResult>>();

  return function completeCallback(url: string): Promise<GoogleOAuthResult> {
    const callback = parseOAuthCallback(url);
    const key = `${callback.attempt}:${callback.code ?? callback.error}`;
    const existing = completions.get(key);
    if (existing) return existing;

    const completion = (async (): Promise<GoogleOAuthResult> => {
      const pending = await dependencies.readPending();
      if (!pending) throw new MobileOAuthError('expired');
      if (pending.id !== callback.attempt) throw new MobileOAuthError('callback');
      if (callback.error) {
        await dependencies.clearPending(pending.id);
        if (callback.error === 'access_denied') return { status: 'cancelled' };
        throw new MobileOAuthError('provider');
      }
      try {
        await dependencies.exchangeCode(callback.code!);
      } catch {
        await dependencies.clearPending(pending.id);
        throw new MobileOAuthError('exchange');
      }
      await dependencies.clearPending(pending.id);
      return { status: 'success', destination: pending.destination };
    })();
    completions.set(key, completion);
    // Retain the completed promise for duplicate browser/router delivery only.
    if (completions.size > 8) completions.delete(completions.keys().next().value!);
    return completion;
  };
}

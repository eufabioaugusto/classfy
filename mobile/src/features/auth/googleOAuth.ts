import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';

import { clearOAuthCodeVerifier, isSupabaseConfigured, storeOAuthCodeVerifier, supabase } from '@/lib/supabase';
import {
  AuthReturnParams, createOAuthCallbackCoordinator, GOOGLE_OAUTH_REDIRECT,
  GoogleOAuthResult, MobileOAuthError, PendingOAuthAttempt, readPendingOAuthAttempt, resolveAuthDestination,
} from './oauth';
import { createGoogleAuthorizeURL, createPKCEVerifier, toBase64URLDigest } from './oauthPkce';

const PENDING_OAUTH_KEY = 'classfy:auth:pending-google';
let activeSignIn: Promise<GoogleOAuthResult> | null = null;

WebBrowser.maybeCompleteAuthSession();

async function readPending() {
  return readPendingOAuthAttempt(await AsyncStorage.getItem(PENDING_OAUTH_KEY));
}

async function clearPending(attemptId: string) {
  const current = await AsyncStorage.getItem(PENDING_OAUTH_KEY);
  let belongsToAttempt = false;
  try {
    belongsToAttempt = Boolean(current && JSON.parse(current).id === attemptId);
  } catch {
    // Corrupted intent cannot be resumed; discard its verifier as well.
    belongsToAttempt = true;
  }
  if (belongsToAttempt) {
    await clearOAuthCodeVerifier();
    await AsyncStorage.removeItem(PENDING_OAUTH_KEY);
  }
}

export const completeGoogleOAuth = createOAuthCallbackCoordinator({
  readPending,
  clearPending,
  exchangeCode: async (code) => {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.session) throw new MobileOAuthError('exchange');
  },
});

export async function isGoogleSignInAvailable(signal?: AbortSignal): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '' },
    signal,
  });
  if (!response.ok) return false;
  const settings = await response.json();
  return settings.external?.google === true;
}

export function startGoogleSignIn(params: AuthReturnParams = {}): Promise<GoogleOAuthResult> {
  // A second tap must not replace the first flow's PKCE verifier.
  if (activeSignIn) return activeSignIn;
  activeSignIn = (async () => {
    if (!isSupabaseConfigured) throw new MobileOAuthError('unavailable');
    const pending: PendingOAuthAttempt = {
      id: Crypto.randomUUID(),
      createdAt: Date.now(),
      destination: resolveAuthDestination(params),
    };
    await AsyncStorage.setItem(PENDING_OAUTH_KEY, JSON.stringify(pending));
    const redirectTo = `${GOOGLE_OAUTH_REDIRECT}?attempt=${pending.id}`;
    try {
      // Hermes lacks WebCrypto: generate S256 with Expo's native crypto instead
      // of the SDK's plain/Math.random fallback. No global crypto shim is needed.
      const verifier = createPKCEVerifier(await Crypto.getRandomBytesAsync(32));
      const challenge = toBase64URLDigest(await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 },
      ));
      await storeOAuthCodeVerifier(verifier);
      const authorizeURL = createGoogleAuthorizeURL(process.env.EXPO_PUBLIC_SUPABASE_URL!, redirectTo, challenge);
      const result = await WebBrowser.openAuthSessionAsync(authorizeURL, GOOGLE_OAUTH_REDIRECT);
      if (result.type !== 'success') {
        await clearPending(pending.id);
        return { status: 'cancelled' } as GoogleOAuthResult;
      }
      return await completeGoogleOAuth(result.url);
    } catch (error) {
      await clearPending(pending.id);
      throw error instanceof MobileOAuthError ? error : new MobileOAuthError('provider');
    }
  })().finally(() => { activeSignIn = null; });
  return activeSignIn;
}

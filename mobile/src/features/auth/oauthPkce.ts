export function createPKCEVerifier(randomBytes: Uint8Array): string {
  if (randomBytes.length !== 32) throw new Error('PKCE requires 32 random bytes');
  return Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function toBase64URLDigest(digest: string) {
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** GoTrue's public /authorize endpoint is the same endpoint used by supabase-js. */
export function createGoogleAuthorizeURL(supabaseURL: string, redirectTo: string, challenge: string) {
  const url = new URL('/auth/v1/authorize', supabaseURL);
  if (url.protocol !== 'https:' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    throw new Error('Invalid OAuth configuration');
  }
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 's256');
  return url.href;
}

const CODE = /^[A-Za-z0-9_-]{3,50}$/;
export const REFERRAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
let volatileClaim: { code: string; expires: number } | null = null;
export function readReferralClaim(now = Date.now()) {
  let code = volatileClaim?.code;
  let expires = volatileClaim?.expires;
  try { code = localStorage.getItem('referral_code') || code; expires = Number(localStorage.getItem('referral_expires')) || expires; } catch { /* Storage may be blocked. */ }
  if (!code || !CODE.test(code) || !expires || expires <= now || expires > now + REFERRAL_WINDOW_MS) return null;
  return { code, expires };
}
export function captureReferral(url: string, now = Date.now()) {
  const parsed = new URL(url);
  const code = parsed.searchParams.get('ref');
  if (code === null) return null;
  parsed.searchParams.delete('ref');
  if (CODE.test(code)) {
    volatileClaim = { code, expires: now + REFERRAL_WINDOW_MS };
    try { localStorage.setItem('referral_code', code); localStorage.setItem('referral_expires', String(volatileClaim.expires)); } catch { /* Keep this page usable without storage. */ }
  }
  return { code: CODE.test(code) ? code : null, cleanPath: parsed.pathname + parsed.search + parsed.hash };
}
export function clearReferralClaim() {
  volatileClaim = null;
  try { localStorage.removeItem('referral_code'); localStorage.removeItem('referral_expires'); } catch { /* Best effort. */ }
}
export function referralShareUrl(code: string) {
  if (!CODE.test(code)) return '';
  return `https://classfy.com.br/?ref=${encodeURIComponent(code)}`;
}

export type LoginMethod = "google" | "email";
const LAST_LOGIN_KEY = "classfy:last-login-method";
const GOOGLE_PENDING_KEY = "classfy:google-login-started";

export function readLastLoginMethod(): LoginMethod | null {
  try {
    const value = localStorage.getItem(LAST_LOGIN_KEY);
    return value === "google" || value === "email" ? value : null;
  } catch { return null; }
}

export function rememberLoginMethod(method: LoginMethod) {
  try { localStorage.setItem(LAST_LOGIN_KEY, method); } catch { /* Optional preference. */ }
  clearPendingGoogleLogin();
}

export function startPendingGoogleLogin() {
  try { sessionStorage.setItem(GOOGLE_PENDING_KEY, String(Date.now())); } catch { /* Optional preference. */ }
}

export function clearPendingGoogleLogin() {
  try { sessionStorage.removeItem(GOOGLE_PENDING_KEY); } catch { /* Optional preference. */ }
}

export function rememberCompletedGoogleLogin(lastSignInAt?: string) {
  try {
    const started = Number(sessionStorage.getItem(GOOGLE_PENDING_KEY));
    const signedInAt = lastSignInAt ? Date.parse(lastSignInAt) : 0;
    if (started > 0 && Date.now() - started < 10 * 60 * 1000 && signedInAt >= started - 1000) rememberLoginMethod("google");
    else clearPendingGoogleLogin();
  } catch { /* Optional preference. */ }
}

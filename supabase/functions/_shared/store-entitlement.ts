export interface StoreProfile {
  plan?: string | null;
  plan_expires_at?: string | null;
  entitlement_source?: string | null;
  subscription_status?: string | null;
}

/** Dados protegidos do perfil, nunca campos enviados pelo cliente. */
export function activeStoreProvider(profile: StoreProfile | null | undefined, now = Date.now()): 'apple' | 'google' | null {
  if (!profile || !['pro', 'premium'].includes(profile.plan ?? '') ||
    !profile.plan_expires_at || Date.parse(profile.plan_expires_at) <= now ||
    !Number.isFinite(Date.parse(profile.plan_expires_at))) return null;
  return profile.entitlement_source === 'apple' || profile.entitlement_source === 'google'
    ? profile.entitlement_source : null;
}

export function storeManagementMessage(provider: 'apple' | 'google') {
  return `Sua assinatura é gerenciada pela ${provider === 'apple' ? 'App Store' : 'Google Play'}. Abra as assinaturas dessa loja para alterar ou cancelar seu plano.`;
}

export type CreatorRole = 'user' | 'creator' | 'admin';

// Same priority as the web AuthContext. Profile approval alone is not a role grant.
export function resolveCreatorRole(roles: readonly string[]): CreatorRole {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('creator')) return 'creator';
  return 'user';
}

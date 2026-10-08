export type CreatorRole = 'user' | 'creator' | 'admin';

// Same priority as the web AuthContext. Profile approval alone is not a role grant.
export function resolveCreatorRole(roles: readonly string[]): CreatorRole {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('creator')) return 'creator';
  return 'user';
}

export const publicationKinds = [
  {
    key: 'aula',
    title: 'Aula',
    description: 'Ensine em uma publicação de vídeo',
    icon: 'play-circle-outline',
    path: '/studio/upload?type=aula',
  },
  {
    key: 'curso',
    title: 'Curso',
    description: 'Organize uma sequência de aulas',
    icon: 'albums-outline',
    path: '/studio/upload/curso',
  },
  {
    key: 'podcast',
    title: 'Podcast',
    description: 'Compartilhe conhecimento em áudio',
    icon: 'mic-outline',
    path: '/studio/upload?type=podcast',
  },
  {
    key: 'short',
    title: 'Short',
    description: 'Publique um vídeo curto',
    icon: 'flash-outline',
    path: '/studio/upload?type=short',
  },
  {
    key: 'live',
    title: 'Live',
    description: 'Prepare sua próxima transmissão',
    icon: 'radio-outline',
    path: '/studio/live',
  },
] as const;

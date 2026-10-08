import type { HomeContent } from './homeData';

export type CatalogRow = {
  id: string | number;
  tags?: string[] | string | null;
  category_id?: string | null;
  published_at?: string | null;
  title?: string | null;
  description?: string | null;
  content_type?: string | null;
  thumbnail_url?: string | null;
  visibility?: string | null;
  views_count?: number | null;
  duration_seconds?: number | null;
  total_duration_seconds?: number | null;
  total_lessons?: number | null;
  lesson_count?: number | null;
  price?: number | null;
  discount?: number | null;
  profiles?: {
    display_name?: string | null;
    creator_channel_name?: string | null;
    avatar_url?: string | null;
  } | null;
};

export function formatDuration(value?: number | null) {
  const seconds = Math.max(0, Math.floor(value || 0));
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}

export function normalizeCatalog(
  rows: CatalogRow[],
  courses = false,
): HomeContent[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const id = String(row.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((row) => ({
      id: String(row.id),
      tags: row.tags,
      category_id: row.category_id,
      publishedAt: row.published_at,
      viewsCount: row.views_count || 0,
      durationSeconds: courses
        ? (row.total_duration_seconds ?? row.duration_seconds)
        : row.duration_seconds,
      lessonCount: courses ? (row.total_lessons ?? row.lesson_count) : null,
      title: row.title || (courses ? 'Curso Classfy' : 'Conteúdo Classfy'),
      creator:
        row.profiles?.display_name ||
        row.profiles?.creator_channel_name ||
        'Creator Classfy',
      creatorAvatarUrl: row.profiles?.avatar_url,
      views: courses
        ? `${row.total_lessons ?? row.lesson_count ?? 0} aulas`
        : `${(row.views_count || 0).toLocaleString('pt-BR')} visualizações`,
      duration: formatDuration(
        courses
          ? (row.total_duration_seconds ?? row.duration_seconds)
          : row.duration_seconds,
      ),
      access: ['pro', 'premium', 'paid'].includes(row.visibility || '')
        ? (row.visibility as HomeContent['access'])
        : 'free',
      category: courses ? 'Cursos' : row.content_type || 'aula',
      contentType: courses ? 'curso' : row.content_type || 'aula',
      tone: '#141414',
      thumbnailUrl: row.thumbnail_url,
      description: row.description,
      price: row.price,
      discount: row.discount,
    }));
}

export function matchesCategory(content: HomeContent, category: string) {
  const formats: Record<string, string> = {
    Aulas: 'aula',
    Cursos: 'curso',
    Podcasts: 'podcast',
    Shorts: 'short',
  };
  const access: Record<string, string> = {
    PRO: 'pro',
    Premium: 'premium',
    Pago: 'paid',
  };
  if (formats[category]) return content.contentType === formats[category];
  if (access[category]) return content.access === access[category];
  return true;
}

export function buildFeed(
  contents: HomeContent[],
  category: string,
  interests: string[],
) {
  const seen = new Set<string>();
  const unique = contents.filter((content) => {
    const key = `${content.contentType === 'curso' ? 'course' : 'content'}:${content.id}`;
    if (seen.has(key) || !matchesCategory(content, category)) return false;
    seen.add(key);
    return true;
  });
  if (category !== 'Para você' || !interests.length) return unique;
  const score = (content: HomeContent) =>
    interests.reduce((total, interest, index) => {
      const text =
        `${content.title} ${content.description || ''}`.toLocaleLowerCase(
          'pt-BR',
        );
      const term = interest.trim().toLocaleLowerCase('pt-BR');
      return total + (term && text.includes(term) ? Math.max(1, 5 - index) : 0);
    }, 0);
  return [...unique].sort((a, b) => score(b) - score(a));
}

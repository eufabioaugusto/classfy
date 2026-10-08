import type { HomeContent } from './homeData';
// Keep weights identical to web src/lib/personalization/interests.ts.
export function rankHomeContents<
  T extends {
    title?: string;
    description?: string | null;
    category_id?: string | null;
    tags?: string[] | string | null;
  },
>(contents: T[], interests: string[]): T[] {
  if (!interests.length) return contents;
  return [...contents].sort(
    (a, b) =>
      calculateContentScore(b, interests) - calculateContentScore(a, interests),
  );
}
export function calculateContentScore(
  content: {
    title?: string;
    description?: string | null;
    category_id?: string | null;
    tags?: string[] | string | null;
  },
  topInterests: string[],
): number {
  let score = 0;
  if (!content) return score;

  const title = (content.title || '').toLowerCase();
  const description = (content.description || '').toLowerCase();
  const categoryId = (content.category_id || '').toLowerCase();

  let tags: string[] = [];
  if (Array.isArray(content.tags)) {
    tags = content.tags.map((t: string) => t.toLowerCase());
  } else if (typeof content.tags === 'string') {
    tags = content.tags.split(',').map((t: string) => t.toLowerCase().trim());
  }

  topInterests.forEach((interest, index) => {
    const cleanInterest = interest.toLowerCase();
    // Rank boost: earlier interests in list (highest scores) get higher multiplier
    const multiplier = Math.max(1, 5 - index);

    if (title.includes(cleanInterest)) {
      score += 10 * multiplier;
    }
    if (description.includes(cleanInterest)) {
      score += 3 * multiplier;
    }
    if (categoryId === cleanInterest) {
      score += 12 * multiplier;
    }
    if (tags.includes(cleanInterest)) {
      score += 8 * multiplier;
    }
  });

  return score;
}

// Same sections and stable ranking as web Index.tsx; entitlement stays in Watch.
export function homeSections(
  contents: HomeContent[],
  courses: HomeContent[],
  interests: string[],
  authenticated: boolean,
) {
  const ranked = (items: HomeContent[]) => rankHomeContents(items, interests);
  const trending = (type: string) =>
    ranked(
      contents
        .filter((c) => c.contentType === type)
        .sort((a, b) => (b.viewsCount || 0) - (a.viewsCount || 0)),
    );
  return [
    {
      key: 'personalized',
      title: 'Para você',
      contents: authenticated ? ranked(contents).slice(0, 8) : [],
      layout: 'horizontal',
    },
    {
      key: 'trending',
      title: 'Em Alta',
      contents: trending('aula'),
      layout: 'horizontal',
    },
    {
      key: 'premium',
      title: 'Conhecimento para ir além do óbvio.',
      contents: ranked(contents.filter((c) => c.access === 'premium')),
      layout: 'horizontal',
    },
    {
      key: 'podcasts',
      title: 'Podcasts em Alta',
      contents: trending('podcast'),
      layout: 'square',
    },
    {
      key: 'shorts',
      title: 'Shorts',
      contents: ranked(contents.filter((c) => c.contentType === 'short')),
      layout: 'vertical',
    },
    {
      key: 'courses',
      title: 'Cursos para aprofundar',
      contents: ranked(courses),
      layout: 'horizontal',
    },
    {
      key: 'paid',
      title: 'Conteúdos exclusivos',
      contents: ranked(contents.filter((c) => c.access === 'paid')),
      layout: 'horizontal',
    },
    {
      key: 'pro',
      title: 'Mais para membros PRO',
      contents: ranked(contents.filter((c) => c.access === 'pro')),
      layout: 'horizontal',
    },
  ] as const;
}

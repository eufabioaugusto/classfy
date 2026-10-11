import type { FeaturedCreator } from '../../components/FeaturedCreators';
import type { HomeContent } from './homeData';
import type { HeroSettings } from './useHomeEditorial';

export type HeroEditorialState = {
  status: 'loading' | 'ready' | 'error';
  settings: HeroSettings | null;
  error: string | null;
};

export const initialHeroEditorialState: HeroEditorialState = {
  status: 'loading',
  settings: null,
  error: null,
};

export function resolveHeroEditorial(
  previous: HeroEditorialState,
  result: { settings: HeroSettings | null; error: string | null },
): HeroEditorialState {
  if (!result.error)
    return { status: 'ready', settings: result.settings, error: null };
  // Revalidation failures cannot replace a known editorial choice with fallback.
  return {
    ...previous,
    status: previous.status === 'ready' ? 'ready' : 'error',
    error: result.error,
  };
}

type HeroSelection = {
  status: 'loading' | 'ready' | 'error';
  content?: HomeContent;
  creator?: FeaturedCreator;
  settings: HeroSettings | null;
};

export function selectHomeHero({
  editorial,
  contents,
  candidates,
  creators,
  catalogLoading,
  catalogError,
  preferredContentId,
  plan,
}: {
  editorial: HeroEditorialState;
  contents: HomeContent[];
  candidates: HomeContent[];
  creators: FeaturedCreator[];
  catalogLoading: boolean;
  catalogError: string | null;
  preferredContentId?: string;
  plan?: string | null;
}): HeroSelection {
  if (editorial.status !== 'ready')
    return { status: editorial.status, settings: null };
  const configured = editorial.settings
    ? contents.find(
        (content) =>
          content.id === editorial.settings?.content_id && content.publishedAt,
      )
    : undefined;
  if (configured)
    return {
      status: 'ready',
      content: configured,
      settings: editorial.settings,
    };
  if (catalogLoading) return { status: 'loading', settings: null };
  // Failed requests are not evidence that the configured content is absent.
  if (catalogError) return { status: 'error', settings: null };
  const content =
    candidates.find((candidate) =>
      preferredContentId
        ? candidate.id === preferredContentId
        : candidate.title.trim().toLocaleLowerCase('pt-BR') === 'aula mux 1',
    ) ||
    candidates.find(
      (candidate) =>
        candidate.thumbnailUrl &&
        (candidate.access === 'free' ||
          (candidate.access === 'pro' && ['pro', 'premium'].includes(plan || '')) ||
          (candidate.access === 'premium' && plan === 'premium')),
    );
  return {
    status: 'ready',
    content,
    creator: content ? undefined : creators[0],
    settings: null,
  };
}

import { useEffect, useMemo, useState } from 'react';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { HomeContent, HomeSection, featuredContent, previewSections } from './homeData';

type HomeSectionsState = {
  featured: HomeContent;
  sections: HomeSection[];
  loading: boolean;
  error: string | null;
  usingFallback: boolean;
};

type SupabaseHomeRow = {
  id: string | number;
  title?: string | null;
  description?: string | null;
  thumbnail_url?: string | null;
  content_type?: string | null;
  visibility?: HomeContent['access'] | string | null;
  views_count?: number | null;
  duration_seconds?: number | null;
  total_lessons?: number | null;
  total_duration_seconds?: number | null;
  profiles?:
    | {
        display_name?: string | null;
        creator_channel_name?: string | null;
        avatar_url?: string | null;
      }
    | Array<{
        display_name?: string | null;
        creator_channel_name?: string | null;
        avatar_url?: string | null;
      }>
    | null;
};

const tones = ['#101826', '#1C1426', '#101F1A', '#241C0D', '#261014', '#111827'];

function formatViews(value?: number | null) {
  if (!value) return '0 views';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M views`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K views`;
  return `${value} views`;
}

function formatDuration(seconds?: number | null) {
  if (!seconds) return '--:--';
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${String(mins).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function profileName(item: SupabaseHomeRow) {
  const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
  return profile?.creator_channel_name || profile?.display_name || 'Creator Classfy';
}

function profileAvatar(item: SupabaseHomeRow) {
  const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
  return profile?.avatar_url ?? null;
}

function normalizeContent(item: SupabaseHomeRow, category: string, index: number): HomeContent {
  return {
    id: String(item.id),
    title: item.title || 'Conteudo Classfy',
    creator: profileName(item),
    views: formatViews(item.views_count),
    duration: formatDuration(item.duration_seconds),
    access: normalizeAccess(item.visibility),
    category,
    tone: tones[index % tones.length],
    contentType: item.content_type ?? undefined,
    thumbnailUrl: item.thumbnail_url ?? null,
    creatorAvatarUrl: profileAvatar(item),
    description: item.description ?? null,
  };
}

function normalizeCourse(item: SupabaseHomeRow, index: number): HomeContent {
  return {
    id: String(item.id),
    title: item.title || 'Curso Classfy',
    creator: profileName(item),
    views: `${item.total_lessons || 0} aulas`,
    duration: formatDuration(item.total_duration_seconds),
    access: normalizeAccess(item.visibility),
    category: 'Cursos',
    tone: tones[(index + 2) % tones.length],
    contentType: 'curso',
    thumbnailUrl: item.thumbnail_url ?? null,
    creatorAvatarUrl: profileAvatar(item),
    description: item.description ?? null,
  };
}

function normalizeAccess(value?: string | null): HomeContent['access'] {
  if (value === 'pro' || value === 'premium' || value === 'paid') {
    return value;
  }

  return 'free';
}

function firstAvailable(sections: HomeSection[]) {
  return sections.find((section) => section.contents.length > 0)?.contents[0] ?? featuredContent;
}

export function useHomeSections(): HomeSectionsState {
  const fallback = useMemo(
    () => ({
      featured: featuredContent,
      sections: previewSections,
      loading: false,
      error: null,
      usingFallback: true,
    }),
    [],
  );

  const [state, setState] = useState<HomeSectionsState>(
    isSupabaseConfigured
      ? { featured: featuredContent, sections: [], loading: true, error: null, usingFallback: false }
      : fallback,
  );

  useEffect(() => {
    let mounted = true;

    async function loadSections() {
      if (!isSupabaseConfigured) {
        return;
      }

      setState((current) => ({ ...current, loading: true, error: null }));

      const [
        trendingResult,
        proResult,
        podcastResult,
        shortsResult,
        premiumResult,
        coursesResult,
      ] = await Promise.all([
        supabase
          .from('contents')
          .select('id,title,description,thumbnail_url,content_type,visibility,views_count,duration_seconds,profiles:creator_id(display_name,creator_channel_name,avatar_url)')
          .eq('content_type', 'aula')
          .eq('status', 'approved')
          .order('views_count', { ascending: false })
          .limit(8),
        supabase
          .from('contents')
          .select('id,title,description,thumbnail_url,content_type,visibility,views_count,duration_seconds,profiles:creator_id(display_name,creator_channel_name,avatar_url)')
          .eq('visibility', 'pro')
          .eq('status', 'approved')
          .in('content_type', ['aula'])
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('contents')
          .select('id,title,description,thumbnail_url,content_type,visibility,views_count,duration_seconds,profiles:creator_id(display_name,creator_channel_name,avatar_url)')
          .eq('content_type', 'podcast')
          .eq('status', 'approved')
          .order('views_count', { ascending: false })
          .limit(8),
        supabase
          .from('contents')
          .select('id,title,description,thumbnail_url,content_type,visibility,views_count,duration_seconds,profiles:creator_id(display_name,creator_channel_name,avatar_url)')
          .eq('content_type', 'short')
          .eq('status', 'approved')
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('contents')
          .select('id,title,description,thumbnail_url,content_type,visibility,views_count,duration_seconds,profiles:creator_id(display_name,creator_channel_name,avatar_url)')
          .eq('visibility', 'premium')
          .eq('status', 'approved')
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('courses')
          .select('id,title,description,thumbnail_url,visibility,total_lessons,total_duration_seconds,profiles:creator_id(display_name,creator_channel_name,avatar_url)')
          .eq('status', 'approved')
          .order('created_at', { ascending: false })
          .limit(8),
      ]);

      if (!mounted) {
        return;
      }

      const firstError =
        trendingResult.error ||
        proResult.error ||
        podcastResult.error ||
        shortsResult.error ||
        premiumResult.error ||
        coursesResult.error;

      if (firstError) {
        setState({ ...fallback, error: firstError.message });
        return;
      }

      const rawSections: HomeSection[] = [
        {
          key: 'trending',
          title: 'Em Alta',
          layout: 'vertical',
          contents: (trendingResult.data ?? []).map((item, index) => normalizeContent(item, 'Aulas', index)),
        },
        {
          key: 'pro',
          title: 'Itens PRO',
          layout: 'horizontal',
          contents: (proResult.data ?? []).map((item, index) => normalizeContent(item, 'PRO', index)),
        },
        {
          key: 'podcasts',
          title: 'Podcasts em Alta',
          layout: 'horizontal',
          contents: (podcastResult.data ?? []).map((item, index) => normalizeContent(item, 'Podcasts', index)),
        },
        {
          key: 'shorts',
          title: 'Shorts',
          layout: 'shorts',
          contents: (shortsResult.data ?? []).map((item, index) => normalizeContent(item, 'Shorts', index)),
        },
        {
          key: 'premium',
          title: 'Itens Premium',
          layout: 'horizontal',
          contents: (premiumResult.data ?? []).map((item, index) => normalizeContent(item, 'Premium', index)),
        },
        {
          key: 'courses',
          title: 'Cursos',
          layout: 'horizontal',
          contents: (coursesResult.data ?? []).map((item, index) => normalizeCourse(item, index)),
        },
      ];

      const sections = rawSections.filter((section) => section.contents.length > 0);

      setState({
        featured: firstAvailable(sections),
        sections,
        loading: false,
        error: null,
        usingFallback: false,
      });
    }

    loadSections();

    return () => {
      mounted = false;
    };
  }, [fallback]);

  return state;
}

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/features/auth/authContext';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type Visibility = 'free' | 'pro' | 'premium' | 'paid';
export type AccessReason = 'plan' | 'purchase' | 'login' | null;

export type WatchCreator = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  creator_channel_name: string | null;
};

export type WatchContent = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  file_url: string | null;
  visibility: Visibility;
  price: number | null;
  duration_seconds: number | null;
  views_count: number | null;
  likes_count: number | null;
  status: string | null;
  creator_id: string;
  category_id: string | null;
  created_at: string | null;
  tags: string[] | null;
  content_type: string;
  isCourse: boolean;
  creator: WatchCreator | null;
};

type AccessState = {
  hasAccess: boolean;
  reason: AccessReason;
  requiredPlan: 'pro' | 'premium';
  isPurchased: boolean;
};

type WatchRow = {
  id: string | number;
  title?: string | null;
  description?: string | null;
  thumbnail_url?: string | null;
  file_url?: string | null;
  visibility?: string | null;
  price?: number | null;
  duration_seconds?: number | null;
  total_duration_seconds?: number | null;
  views_count?: number | null;
  likes_count?: number | null;
  status?: string | null;
  creator_id: string;
  category_id?: string | null;
  created_at?: string | null;
  tags?: string[] | null;
  content_type?: string | null;
  creator?: WatchCreator | WatchCreator[] | null;
};

const initialAccess: AccessState = {
  hasAccess: false,
  reason: null,
  requiredPlan: 'pro',
  isPurchased: false,
};

function normalizeVisibility(value?: string | null): Visibility {
  if (value === 'pro' || value === 'premium' || value === 'paid') return value;
  return 'free';
}

function normalizeCreator(value?: WatchCreator | WatchCreator[] | null): WatchCreator | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeContent(data: WatchRow): WatchContent {
  return {
    id: String(data.id),
    title: data.title || 'Conteudo Classfy',
    description: data.description ?? null,
    thumbnail_url: data.thumbnail_url ?? null,
    file_url: data.file_url ?? null,
    visibility: normalizeVisibility(data.visibility),
    price: data.price ?? null,
    duration_seconds: data.duration_seconds ?? null,
    views_count: data.views_count ?? null,
    likes_count: data.likes_count ?? null,
    status: data.status ?? null,
    creator_id: data.creator_id,
    category_id: data.category_id ?? null,
    created_at: data.created_at ?? null,
    tags: data.tags ?? null,
    content_type: data.content_type || 'aula',
    isCourse: false,
    creator: normalizeCreator(data.creator),
  };
}

function normalizeCourse(data: WatchRow): WatchContent {
  return {
    id: String(data.id),
    title: data.title || 'Curso Classfy',
    description: data.description ?? null,
    thumbnail_url: data.thumbnail_url ?? null,
    file_url: null,
    visibility: normalizeVisibility(data.visibility),
    price: data.price ?? null,
    duration_seconds: data.total_duration_seconds ?? null,
    views_count: data.views_count ?? null,
    likes_count: data.likes_count ?? null,
    status: data.status ?? null,
    creator_id: data.creator_id,
    category_id: data.category_id ?? null,
    created_at: data.created_at ?? null,
    tags: data.tags ?? null,
    content_type: 'curso',
    isCourse: true,
    creator: normalizeCreator(data.creator),
  };
}

export function useWatchContent(contentId?: string) {
  const { user, profile } = useAuth();
  const [content, setContent] = useState<WatchContent | null>(null);
  const [access, setAccess] = useState<AccessState>(initialAccess);
  const [followersCount, setFollowersCount] = useState(0);
  const [loading, setLoading] = useState(Boolean(contentId && isSupabaseConfigured));
  const [error, setError] = useState<string | null>(null);

  const checkAccess = useCallback(
    async (nextContent: WatchContent): Promise<AccessState> => {
      if (nextContent.visibility === 'free') {
        return { hasAccess: true, reason: null, requiredPlan: 'pro', isPurchased: false };
      }

      if (!user || !profile) {
        return {
          hasAccess: false,
          reason: nextContent.visibility === 'paid' ? 'purchase' : 'login',
          requiredPlan: nextContent.visibility === 'premium' ? 'premium' : 'pro',
          isPurchased: false,
        };
      }

      if (nextContent.creator_id === user.id) {
        return { hasAccess: true, reason: null, requiredPlan: 'pro', isPurchased: false };
      }

      const userPlan = profile.plan || 'free';

      if (nextContent.visibility === 'pro') {
        return {
          hasAccess: ['pro', 'premium'].includes(userPlan),
          reason: ['pro', 'premium'].includes(userPlan) ? null : 'plan',
          requiredPlan: 'pro',
          isPurchased: false,
        };
      }

      if (nextContent.visibility === 'premium') {
        return {
          hasAccess: userPlan === 'premium',
          reason: userPlan === 'premium' ? null : 'plan',
          requiredPlan: 'premium',
          isPurchased: false,
        };
      }

      if (nextContent.visibility === 'paid') {
        const table = nextContent.isCourse ? 'course_enrollments' : 'purchased_contents';
        const foreignKey = nextContent.isCourse ? 'course_id' : 'content_id';
        const { data } = await supabase
          .from(table)
          .select('id')
          .eq('user_id', user.id)
          .eq(foreignKey, nextContent.id)
          .maybeSingle();

        return {
          hasAccess: Boolean(data),
          reason: data ? null : 'purchase',
          requiredPlan: 'pro',
          isPurchased: Boolean(data),
        };
      }

      return initialAccess;
    },
    [profile, user],
  );

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!contentId) {
        setError('Conteudo sem id.');
        setLoading(false);
        return;
      }

      if (!isSupabaseConfigured) {
        setError('Supabase nao configurado no mobile.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const [contentResult, courseResult] = await Promise.all([
        supabase
          .from('contents')
          .select('id,content_type,title,description,file_url,thumbnail_url,visibility,price,duration_seconds,views_count,likes_count,status,creator_id,category_id,created_at,tags,creator:profiles!creator_id(id,display_name,avatar_url,creator_channel_name)')
          .eq('id', contentId)
          .maybeSingle(),
        supabase
          .from('courses')
          .select('id,title,description,thumbnail_url,visibility,price,total_duration_seconds,views_count,likes_count,status,creator_id,created_at,tags,creator:profiles!creator_id(id,display_name,avatar_url,creator_channel_name)')
          .eq('id', contentId)
          .maybeSingle(),
      ]);

      if (!mounted) return;

      if (contentResult.error || courseResult.error) {
        setError(contentResult.error?.message || courseResult.error?.message || 'Erro ao carregar conteudo.');
        setLoading(false);
        return;
      }

      const nextContent = contentResult.data
        ? normalizeContent(contentResult.data)
        : courseResult.data
          ? normalizeCourse(courseResult.data)
          : null;

      if (!nextContent || nextContent.status !== 'approved') {
        setContent(null);
        setError('Conteudo indisponivel.');
        setLoading(false);
        return;
      }

      const nextAccess = await checkAccess(nextContent);
      if (!mounted) return;

      setContent(nextContent);
      setAccess(nextAccess);
      setLoading(false);

      if (nextContent.creator?.id) {
        const { count } = await supabase
          .from('follows')
          .select('*', { count: 'exact', head: true })
          .eq('following_id', nextContent.creator.id);
        if (mounted) setFollowersCount(count || 0);
      }

      if (user && nextAccess.hasAccess) {
        const fn = nextContent.isCourse ? 'increment_course_view' : 'increment_content_view';
        const params = nextContent.isCourse
          ? { p_user_id: user.id, p_course_id: nextContent.id }
          : { p_user_id: user.id, p_content_id: nextContent.id };
        supabase.rpc(fn, params).then(() => {});
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [checkAccess, contentId, user]);

  return { content, access, followersCount, loading, error };
}

import { useEffect, useState } from 'react';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type WatchRelatedItem = {
  id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  views_count: number | null;
  content_type: string | null;
  visibility: string | null;
  creator: { display_name?: string | null } | null;
};

type UseWatchRelatedProps = {
  contentId?: string;
  categoryId?: string | null;
  tags?: string[] | null;
  contentType?: string | null;
};

type RelatedRow = Omit<WatchRelatedItem, 'id' | 'creator'> & {
  id: string | number;
  creator?: { display_name?: string | null } | { display_name?: string | null }[] | null;
};

function normalizeCreator(value?: RelatedRow['creator']) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function useWatchRelated({ contentId, categoryId, tags, contentType }: UseWatchRelatedProps) {
  const [items, setItems] = useState<WatchRelatedItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!contentId || !isSupabaseConfigured) return;
      setLoading(true);

      let query = supabase
        .from('contents')
        .select('id,title,thumbnail_url,duration_seconds,views_count,content_type,visibility,creator:profiles!creator_id(display_name)')
        .eq('status', 'approved')
        .neq('id', contentId)
        .limit(10);

      if (categoryId) query = query.eq('category_id', categoryId);
      if (tags?.length) query = query.overlaps('tags', tags);

      const { data, error } = await query;
      if (!mounted) return;

      if (!error && data?.length) {
        setItems(
          data.map((item: RelatedRow) => ({
            ...item,
            id: String(item.id),
            creator: normalizeCreator(item.creator),
          })),
        );
        setLoading(false);
        return;
      }

      let fallbackQuery = supabase
        .from('contents')
        .select('id,title,thumbnail_url,duration_seconds,views_count,content_type,visibility,creator:profiles!creator_id(display_name)')
        .eq('status', 'approved')
        .neq('id', contentId)
        .order('views_count', { ascending: false })
        .limit(10);

      if (contentType && contentType !== 'curso') fallbackQuery = fallbackQuery.eq('content_type', contentType);

      const fallback = await fallbackQuery;
      if (!mounted) return;

      setItems(
        (fallback.data || []).map((item: RelatedRow) => ({
          ...item,
          id: String(item.id),
          creator: normalizeCreator(item.creator),
        })),
      );
      setLoading(false);
    }

    load();

    return () => {
      mounted = false;
    };
  }, [categoryId, contentId, contentType, tags]);

  return { items, loading };
}

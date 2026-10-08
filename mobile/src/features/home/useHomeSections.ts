import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/authContext';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { HomeContent } from './homeData';
import { normalizeCatalog, type CatalogRow } from './catalog';

type CatalogState = {
  owner: string | null;
  contents: HomeContent[];
  courses: HomeContent[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
};
const empty = (owner: string | null): CatalogState => ({
  owner,
  contents: [],
  courses: [],
  loading: true,
  refreshing: false,
  error: null,
});
const fields =
  'id,title,description,tags,category_id,published_at,thumbnail_url,content_type,visibility,views_count,duration_seconds,price,discount,profiles:creator_id(display_name,creator_channel_name,avatar_url)';

export function useHomeSections() {
  const { user, loading: authLoading } = useAuth();
  const owner = user?.id || null;
  const [state, setState] = useState(() => empty(owner));
  const request = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      const id = ++request.current;
      setState((previous) =>
        previous.owner === owner
          ? { ...previous, loading: !refresh, refreshing: refresh, error: null }
          : empty(owner),
      );
      if (!isSupabaseConfigured) {
        setState({
          ...empty(owner),
          loading: false,
          error: 'Não foi possível conectar. Tente novamente mais tarde.',
        });
        return;
      }
      try {
        if (!owner) {
          // Same safe visitor contract as the web. Playback sources stay private.
          const { data, error } = await supabase.rpc('get_public_home_catalog');
          if (id !== request.current) return;
          if (error) throw error;
          const catalog = data as {
            contents?: CatalogRow[];
            courses?: CatalogRow[];
          } | null;
          setState({
            ...empty(owner),
            loading: false,
            contents: normalizeCatalog(
              Array.isArray(catalog?.contents) ? catalog.contents : [],
            ),
            courses: normalizeCatalog(
              Array.isArray(catalog?.courses) ? catalog.courses : [],
              true,
            ),
          });
        } else {
          const results = await Promise.allSettled([
            supabase
              .from('contents')
              .select(fields)
              .eq('status', 'approved')
              .order('created_at', { ascending: false }),
            supabase
              .from('courses')
              .select(
                'id,title,description,tags,published_at,thumbnail_url,visibility,views_count,total_lessons,total_duration_seconds,price,discount,profiles:creator_id(display_name,creator_channel_name,avatar_url)',
              )
              .eq('status', 'approved')
              .order('created_at', { ascending: false }),
          ]);
          if (id !== request.current) return;
          if (__DEV__) results.forEach((result, index) => {
            if (result.status === 'rejected' || result.value.error) {
              console.warn('Falha ao carregar catálogo', {
                table: index === 0 ? 'contents' : 'courses',
                code: result.status === 'fulfilled' ? result.value.error?.code : 'NETWORK',
              });
            }
          });
          setState((previous) => {
            const current = previous.owner === owner ? previous : empty(owner);
            const values = results.map((result, index) =>
              result.status === 'fulfilled' && !result.value.error
                ? normalizeCatalog(
                    (result.value.data || []) as unknown as CatalogRow[],
                    index === 1,
                  )
                : null,
            );
            return {
              ...current,
              loading: false,
              refreshing: false,
              contents: values[0] ?? current.contents,
              courses: values[1] ?? current.courses,
              error: values.some((value) => value === null)
                ? 'Parte do catálogo não carregou.'
                : null,
            };
          });
        }
      } catch {
        if (id === request.current)
          setState((current) => ({
            ...current,
            loading: false,
            refreshing: false,
            error: 'Não foi possível atualizar o catálogo. Tente novamente.',
          }));
      }
    },
    [owner],
  );

  useEffect(() => {
    if (!authLoading) void load();
    return () => {
      request.current++;
    };
  }, [authLoading, load]);

  return {
    ...(state.owner === owner ? state : empty(owner)),
    refresh: () => load(true),
  };
}

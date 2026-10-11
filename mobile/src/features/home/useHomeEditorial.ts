import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/authContext';
import type { FeaturedCreator } from '@/components/FeaturedCreators';
import { initialHeroEditorialState, resolveHeroEditorial, type HeroEditorialState } from './heroSelection';

export type HeroSettings = {
  content_id: string;
  title?: string;
  description?: string;
  thumbnail_url?: string;
  eyebrow_label?: string;
  chip_label?: string;
  show_chip?: boolean;
  alignment?: string;
  image_position?: string;
  primary_label?: string;
  secondary_label?: string;
  primary_href?: string;
  secondary_href?: string;
  show_secondary?: boolean;
};
export type HomeLive = {
  id: string;
  title: string;
  thumbnail_url: string | null;
  creator_name: string;
  viewer_count: number;
};
export function useHomeEditorial(revision: number) {
  const { user, loading: authLoading } = useAuth();
  const owner = user?.id || null;
  const navigation = useNavigation();
  const [creators, setCreators] = useState<FeaturedCreator[]>([]);
  const [heroState, setHeroState] = useState<HeroEditorialState & { owner: string | null }>(
    () => ({ ...initialHeroEditorialState, owner }),
  );
  const [lives, setLives] = useState<HomeLive[]>([]);
  useEffect(() => {
    let active = true;
    setCreators([]);
    void (async () => {
      const [featured, durations] = await Promise.all([
        supabase
          .from('featured_creators')
          .select('*,profiles:creator_id(display_name,creator_channel_name)')
          .eq('show_on_home', true)
          .order('order_index'),
        user
          ? supabase
              .from('contents')
              .select('creator_id,duration_seconds')
              .eq('status', 'approved')
          : Promise.resolve({ data: null }),
      ]);
      if (!active) return;
      if (!featured.error)
        setCreators(
          (featured.data || []).map((row) => {
            const seconds = (durations.data || [])
              .filter((c) => c.creator_id === row.creator_id)
              .reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
            return {
              ...row,
              creator_name:
                row.profiles?.creator_channel_name ||
                row.profiles?.display_name ||
                'Creator',
              total_duration: seconds
                ? `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}h ` : ''}${Math.floor((seconds % 3600) / 60)} minutos`
                : '',
            };
          }) as FeaturedCreator[],
        );
    })();
    return () => {
      active = false;
    };
  }, [user?.id, revision]);
  useEffect(() => {
    let active = true;
    let request = 0;
    setHeroState((previous) => previous.owner === owner
      ? previous
      : { ...initialHeroEditorialState, owner });
    const load = async () => {
      if (authLoading || AppState.currentState !== 'active' || !navigation.isFocused()) return;
      const current = ++request;
      try {
        if (!isSupabaseConfigured) throw new Error('unavailable');
        const { data, error } = await supabase
          .from('home_hero_settings')
          .select('*')
          .eq('id', 1)
          .eq('is_active', true)
          .maybeSingle();
        if (error) throw error;
        if (active && current === request)
          setHeroState({
            owner,
            ...resolveHeroEditorial(initialHeroEditorialState, {
              settings: data as HeroSettings | null,
              error: null,
            }),
          });
      } catch {
        if (active && current === request)
          setHeroState((previous) => ({
            owner,
            ...resolveHeroEditorial(previous.owner === owner ? previous : initialHeroEditorialState, {
              settings: null,
              error: 'Não foi possível atualizar o destaque.',
            }),
          }));
      }
    };
    void load();
    const focus = navigation.addListener('focus', () => {
      void load();
    });
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    // Same admin configuration, refreshed even when Home stays open.
    const timer = setInterval(() => {
      void load();
    }, 30000);
    return () => {
      active = false;
      request++;
      focus();
      foreground.remove();
      clearInterval(timer);
    };
  }, [owner, authLoading, revision, navigation]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (AppState.currentState !== 'active' || !navigation.isFocused()) return;
      const { data, error } = await supabase.rpc('get_public_home_lives');
      if (active && !error) setLives((data || []) as HomeLive[]);
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 15000);
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      active = false;
      clearInterval(timer);
      foreground.remove();
    };
  }, [revision, navigation]);
  const editorial = heroState.owner === owner ? heroState : initialHeroEditorialState;
  return { creators, editorial, lives };
}

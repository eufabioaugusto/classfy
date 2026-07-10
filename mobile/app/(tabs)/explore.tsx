import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppScreen } from '@/components/AppScreen';
import { HomeHeader } from '@/components/HomeHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, type } from '@/theme/tokens';

const RECENT_SEARCHES_KEY = '@classfy:recent_searches';
const categoryChips = ['Aulas', 'Shorts', 'Podcasts', 'Cursos', 'Creators'];

type SearchResult = {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  contentType: string; // 'aula' | 'short' | 'podcast' | 'curso' | 'creator'
  creatorChannelName?: string | null;
  viewsCount?: number | null;
  creator?: {
    display_name: string | null;
    avatar_url: string | null;
    creator_channel_name: string | null;
  } | null;
  type: 'content' | 'course' | 'creator';
};

export default function ExploreScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [trending, setTrending] = useState<SearchResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<any>(null);

  // Load initial data (trending contents and search history)
  useEffect(() => {
    loadRecentSearches();
    loadTrendingContent();
  }, []);

  const loadTrendingContent = async () => {
    try {
      const [contentsResult, coursesResult] = await Promise.all([
        supabase
          .from('contents')
          .select(`
            id,
            title,
            description,
            thumbnail_url,
            content_type,
            views_count,
            creator_id,
            creator:profiles!creator_id (display_name, avatar_url, creator_channel_name)
          `)
          .eq('status', 'approved')
          .order('views_count', { ascending: false })
          .limit(4),
        supabase
          .from('courses')
          .select(`
            id,
            title,
            description,
            thumbnail_url,
            views_count,
            creator_id,
            creator:profiles!creator_id (display_name, avatar_url, creator_channel_name)
          `)
          .eq('status', 'approved')
          .order('views_count', { ascending: false })
          .limit(2),
      ]);

      const contentItems: SearchResult[] = (contentsResult.data || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        thumbnailUrl: item.thumbnail_url,
        contentType: item.content_type,
        viewsCount: item.views_count,
        creator: Array.isArray(item.creator) ? item.creator[0] : item.creator,
        type: 'content',
      }));

      const courseItems: SearchResult[] = (coursesResult.data || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        thumbnailUrl: item.thumbnail_url,
        contentType: 'curso',
        viewsCount: item.views_count,
        creator: Array.isArray(item.creator) ? item.creator[0] : item.creator,
        type: 'course',
      }));

      // Combine and shuffle slightly to look organic
      setTrending([...courseItems, ...contentItems]);
    } catch (e) {
      console.error('Error loading trending items:', e);
    }
  };

  const loadRecentSearches = async () => {
    try {
      const stored = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Error loading search history:', e);
    }
  };

  const saveSearch = async (searchTerm: string) => {
    const cleanTerm = searchTerm.trim();
    if (!cleanTerm || cleanTerm.length < 2) return;

    try {
      const filtered = recentSearches.filter((item) => item !== cleanTerm);
      const updated = [cleanTerm, ...filtered].slice(0, 5); // Keep top 5
      setRecentSearches(updated);
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Error saving search history:', e);
    }
  };

  const deleteRecentSearch = async (term: string) => {
    try {
      const updated = recentSearches.filter((item) => item !== term);
      setRecentSearches(updated);
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Error deleting search history item:', e);
    }
  };

  const clearRecentSearches = async () => {
    try {
      setRecentSearches([]);
      await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch (e) {
      console.error('Error clearing search history:', e);
    }
  };

  const performSearch = useCallback(async (searchQuery: string, category: string | null) => {
    const cleanQuery = searchQuery.trim();
    if (cleanQuery.length < 2) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const searchPattern = `%${cleanQuery}%`;
      const promises: Promise<any>[] = [];

      const queryAulas = !category || category === 'Aulas';
      const queryShorts = !category || category === 'Shorts';
      const queryPodcasts = !category || category === 'Podcasts';
      const queryCursos = !category || category === 'Cursos';
      const queryCreators = !category || category === 'Creators';

      // 1. Contents Table Search
      if (queryAulas || queryShorts || queryPodcasts) {
        let typesToQuery = [];
        if (queryAulas) typesToQuery.push('aula');
        if (queryShorts) typesToQuery.push('short');
        if (queryPodcasts) typesToQuery.push('podcast');

        let contentsQuery = supabase
          .from('contents')
          .select(`
            id,
            title,
            description,
            thumbnail_url,
            content_type,
            views_count,
            tags,
            creator_id,
            creator:profiles!creator_id (display_name, avatar_url, creator_channel_name)
          `)
          .eq('status', 'approved')
          .or(`title.ilike.${searchPattern},description.ilike.${searchPattern}`);

        if (category) {
          contentsQuery = contentsQuery.in('content_type', typesToQuery);
        } else {
          contentsQuery = contentsQuery.in('content_type', ['aula', 'short', 'podcast']);
        }

        promises.push(contentsQuery.order('views_count', { ascending: false }).limit(12) as any);
      } else {
        promises.push(Promise.resolve({ data: [] }));
      }

      // 2. Courses Table Search
      if (queryCursos) {
        const coursesQuery = supabase
          .from('courses')
          .select(`
            id,
            title,
            description,
            thumbnail_url,
            views_count,
            creator_id,
            creator:profiles!creator_id (display_name, avatar_url, creator_channel_name)
          `)
          .eq('status', 'approved')
          .or(`title.ilike.${searchPattern},description.ilike.${searchPattern}`);

        promises.push(coursesQuery.order('views_count', { ascending: false }).limit(6) as any);
      } else {
        promises.push(Promise.resolve({ data: [] }));
      }

      // 3. Creators / Profiles Search
      if (queryCreators) {
        const profilesQuery = supabase
          .from('profiles')
          .select('id, display_name, avatar_url, creator_channel_name, bio')
          .or(`display_name.ilike.${searchPattern},creator_channel_name.ilike.${searchPattern}`);

        promises.push(profilesQuery.limit(10) as any);
      } else {
        promises.push(Promise.resolve({ data: [] }));
      }

      const [contentsResult, coursesResult, creatorsResult] = await Promise.all(promises);

      if (contentsResult.error) throw contentsResult.error;
      if (coursesResult?.error) throw coursesResult.error;
      if (creatorsResult?.error) throw creatorsResult.error;

      // Format results
      const contentList: SearchResult[] = (contentsResult.data || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        thumbnailUrl: item.thumbnail_url,
        contentType: item.content_type,
        viewsCount: item.views_count,
        creator: Array.isArray(item.creator) ? item.creator[0] : item.creator,
        type: 'content',
      }));

      const courseList: SearchResult[] = (coursesResult?.data || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        thumbnailUrl: item.thumbnail_url,
        contentType: 'curso',
        viewsCount: item.views_count,
        creator: Array.isArray(item.creator) ? item.creator[0] : item.creator,
        type: 'course',
      }));

      const creatorList: SearchResult[] = (creatorsResult?.data || []).map((item: any) => ({
        id: item.id,
        title: item.display_name || item.creator_channel_name || 'Criador',
        description: item.bio || 'Criador do Classfy.',
        thumbnailUrl: item.avatar_url,
        contentType: 'creator',
        creatorChannelName: item.creator_channel_name,
        type: 'creator',
      }));

      let combined: SearchResult[] = [...creatorList, ...courseList, ...contentList];

      // Sort by view popularity if searching generally
      if (!category) {
        combined.sort((a, b) => {
          if (a.type === 'creator' && b.type !== 'creator') return -1;
          if (b.type === 'creator' && a.type !== 'creator') return 1;
          return (b.viewsCount || 0) - (a.viewsCount || 0);
        });
      }

      setResults(combined);
    } catch (e) {
      console.error(e);
      setError('Problema ao buscar resultados.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const triggerSearch = (text: string, category: string | null) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    debounceRef.current = setTimeout(() => {
      performSearch(text, category);
      saveSearch(text);
    }, 300);
  };

  const handleInputChange = (text: string) => {
    setQuery(text);
    triggerSearch(text, selectedCategory);
  };

  const handleChipPress = (category: string) => {
    const nextCategory = selectedCategory === category ? null : category;
    setSelectedCategory(nextCategory);
    if (query.trim()) {
      performSearch(query, nextCategory);
    }
  };

  const handleRecentPress = (term: string) => {
    setQuery(term);
    performSearch(term, selectedCategory);
    saveSearch(term);
  };

  const handleResultPress = (item: SearchResult) => {
    if (item.type === 'creator') {
      router.push(`/creator/${item.id}`);
    } else if (item.contentType === 'short') {
      router.push(`/shorts?id=${item.id}`);
    } else {
      // Course or standard lessons/podcasts
      router.push(`/watch/${item.id}`);
    }
  };

  const formatViews = (count?: number | null) => {
    if (!count) return '0 views';
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M views`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K views`;
    return `${count} views`;
  };

  const getBadgeColor = (contentType: string) => {
    if (contentType === 'curso') return colors.amber;
    if (contentType === 'podcast') return colors.pro;
    if (contentType === 'short') return colors.accent;
    return '#3B82F6'; // Aula/standard blue
  };

  const getBadgeLabel = (contentType: string) => {
    if (contentType === 'curso') return 'CURSO';
    if (contentType === 'podcast') return 'PODCAST';
    if (contentType === 'short') return 'SHORT';
    if (contentType === 'creator') return 'CREATOR';
    return 'AULA';
  };

  const renderResultItem = ({ item }: { item: SearchResult }) => {
    const isCreator = item.type === 'creator';
    const badgeColor = getBadgeColor(item.contentType);
    const badgeLabel = getBadgeLabel(item.contentType);

    return (
      <Pressable style={styles.resultItem} onPress={() => handleResultPress(item)}>
        {isCreator ? (
          <View style={styles.creatorResultRow}>
            <View style={styles.avatarWrap}>
              {item.thumbnailUrl ? (
                <Image source={{ uri: item.thumbnailUrl }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarPlaceholderText}>{item.title[0]}</Text>
              )}
            </View>
            <View style={styles.creatorCopy}>
              <View style={styles.creatorTitleRow}>
                <Text style={styles.creatorName}>{item.title}</Text>
                <Ionicons name="checkmark-circle" color="#3B82F6" size={15} style={{ marginLeft: 4 }} />
              </View>
              <Text numberOfLines={1} style={styles.creatorHandle}>
                @{item.creatorChannelName || 'creator'}
              </Text>
              <Text numberOfLines={1} style={styles.creatorBio}>
                {item.description}
              </Text>
            </View>
            <View style={[styles.badgeWrap, { backgroundColor: 'rgba(59, 130, 246, 0.08)' }]}>
              <Text style={[styles.badgeText, { color: '#3B82F6' }]}>{badgeLabel}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.contentResultRow}>
            <View style={styles.thumbWrap}>
              {item.thumbnailUrl ? (
                <Image source={{ uri: item.thumbnailUrl }} style={styles.thumbImg} />
              ) : (
                <View style={styles.thumbPlaceholder}>
                  <Ionicons name="videocam-outline" size={24} color={colors.mutedDim} />
                </View>
              )}
              <View style={[styles.contentBadge, { backgroundColor: badgeColor }]}>
                <Text style={styles.contentBadgeText}>{badgeLabel}</Text>
              </View>
            </View>
            <View style={styles.contentCopy}>
              <Text numberOfLines={2} style={styles.contentTitle}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={styles.contentMeta}>
                {item.creator?.display_name || 'Classfy Creator'} • {formatViews(item.viewsCount)}
              </Text>
            </View>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <AppScreen scroll={false}>
      <HomeHeader />
      <View style={styles.header}>
        <Text style={styles.title}>Explore</Text>
        <Text style={styles.subtitle}>Encontre cursos, aulas, podcasts e seus criadores favoritos.</Text>
      </View>

      {/* Advanced Search Input Bar */}
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" color={colors.muted} size={20} />
        <TextInput
          placeholder="O que você quer aprender hoje?"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={handleInputChange}
          style={styles.input}
          autoCapitalize="none"
        />
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : query.length > 0 ? (
          <Pressable onPress={() => handleInputChange('')}>
            <Ionicons name="close-circle" color={colors.muted} size={20} />
          </Pressable>
        ) : null}
      </View>

      {/* Category Filter Chips */}
      <View style={styles.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
          {categoryChips.map((chip) => {
            const isActive = selectedCategory === chip;
            return (
              <Pressable
                key={chip}
                onPress={() => handleChipPress(chip)}
                style={[styles.chip, isActive && styles.chipActive]}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{chip}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Search results or Default explore modules */}
      {query.trim().length > 0 ? (
        <View style={{ flex: 1, marginTop: spacing.md }}>
          {results.length > 0 ? (
            <FlatList
              data={results}
              keyExtractor={(item, index) => `${item.id}-${item.type}-${index}`}
              renderItem={renderResultItem}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: spacing.xl }}
            />
          ) : !isLoading ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="search-outline" size={48} color={colors.mutedDim} style={{ marginBottom: spacing.md }} />
              <Text style={styles.emptyTitle}>Nenhum resultado</Text>
              <Text style={styles.emptyText}>Não encontramos nenhum item correspondente a "{query}".</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
          {/* Recent Searches */}
          {recentSearches.length > 0 && (
            <View style={styles.recentWrap}>
              <View style={styles.recentHeader}>
                <Text style={styles.recentTitle}>Pesquisas Recentes</Text>
                <Pressable onPress={clearRecentSearches}>
                  <Text style={styles.clearBtnText}>Limpar tudo</Text>
                </Pressable>
              </View>
              <View style={styles.recentList}>
                {recentSearches.map((term) => (
                  <View key={term} style={styles.recentRow}>
                    <Pressable style={styles.recentRowLeft} onPress={() => handleRecentPress(term)}>
                      <Ionicons name="time-outline" size={18} color={colors.mutedDim} style={{ marginRight: spacing.sm }} />
                      <Text style={styles.recentRowText}>{term}</Text>
                    </Pressable>
                    <Pressable onPress={() => deleteRecentSearch(term)}>
                      <Ionicons name="close-outline" size={18} color={colors.mutedDim} />
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Trending items section */}
          {trending.length > 0 && (
            <View style={styles.trendingSection}>
              <SectionHeader eyebrow="Para você" title="Conteúdos em Alta" />
              {trending.map((item) => {
                const badgeColor = getBadgeColor(item.contentType);
                const badgeLabel = getBadgeLabel(item.contentType);

                return (
                  <Pressable key={item.id} style={styles.trendingCard} onPress={() => handleResultPress(item)}>
                    <View style={styles.trendingThumb}>
                      {item.thumbnailUrl ? (
                        <Image source={{ uri: item.thumbnailUrl }} style={styles.trendingImg} />
                      ) : (
                        <View style={styles.trendingPlaceholder}>
                          <Ionicons name="play-circle-outline" size={36} color={colors.mutedDim} />
                        </View>
                      )}
                      <View style={[styles.trendingBadge, { backgroundColor: badgeColor }]}>
                        <Text style={styles.trendingBadgeText}>{badgeLabel}</Text>
                      </View>
                    </View>
                    <View style={styles.trendingCopy}>
                      <Text numberOfLines={2} style={styles.trendingTitle}>
                        {item.title}
                      </Text>
                      <Text style={styles.trendingMeta}>
                        {item.creator?.display_name || 'Classfy Creator'} • {formatViews(item.viewsCount)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: type.xxxl,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.muted,
    fontSize: type.sm,
  },
  searchBox: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    height: 48,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: type.sm,
    height: '100%',
  },
  chipsWrap: {
    marginVertical: spacing.md,
  },
  chipsScroll: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  chip: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#FAFAFA',
  },
  // Recent Searches
  recentWrap: {
    marginBottom: spacing.lg,
    backgroundColor: colors.backgroundElevated,
    borderRadius: radius.md,
    borderColor: colors.borderSubtle,
    borderWidth: 1,
    padding: spacing.md,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  recentTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  clearBtnText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
  recentList: {
    gap: spacing.sm,
  },
  recentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  recentRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  recentRowText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  // Trending Items
  trendingSection: {
    marginTop: spacing.sm,
  },
  trendingCard: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderColor: colors.borderSubtle,
    borderWidth: 1,
  },
  trendingThumb: {
    width: 110,
    aspectRatio: 16 / 9,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    overflow: 'hidden',
    position: 'relative',
  },
  trendingImg: {
    width: '100%',
    height: '100%',
  },
  trendingPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trendingBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  trendingBadgeText: {
    color: '#FAFAFA',
    fontSize: 8,
    fontWeight: '800',
  },
  trendingCopy: {
    flex: 1,
    justifyContent: 'center',
  },
  trendingTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    marginBottom: 4,
  },
  trendingMeta: {
    color: colors.muted,
    fontSize: 11,
  },
  // Search Results Layout
  resultItem: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  creatorResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.backgroundElevated,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholderText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  creatorCopy: {
    flex: 1,
  },
  creatorTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  creatorName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  creatorHandle: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  creatorBio: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  badgeWrap: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  contentResultRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  thumbWrap: {
    width: 100,
    aspectRatio: 16 / 9,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  contentBadgeText: {
    color: '#FAFAFA',
    fontSize: 8,
    fontWeight: '800',
  },
  contentCopy: {
    flex: 1,
    justifyContent: 'center',
  },
  contentTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    marginBottom: 4,
  },
  contentMeta: {
    color: colors.muted,
    fontSize: 11,
  },
  // Empty State
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});

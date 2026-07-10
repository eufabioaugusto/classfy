import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, useEffect } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View, Pressable, TextInput } from 'react-native';
import { useRouter } from 'expo-router';

import { AppScreen } from '@/components/AppScreen';
import { useTabScroll } from '@/contexts/TabScrollContext';
import { CategoryChips } from '@/components/CategoryChips';
import { HomeHeader } from '@/components/HomeHeader';
import { HomeSectionBlock } from '@/components/HomeSectionBlock';
import { MobileVideoCard } from '@/components/MobileVideoCard';
import { SectionHeader } from '@/components/SectionHeader';
import { FeaturedCreators } from '@/components/FeaturedCreators';
import { ContinueStudyCard } from '@/components/ContinueStudyCard';
import { ContinueWatching } from '@/components/ContinueWatching';
import { homeCategories, HomeSection } from '@/features/home/homeData';
import { useHomeSections } from '@/features/home/useHomeSections';
import { useAuth } from '@/features/auth/authContext';
import { getTopInterests, boostContentList } from '@/lib/interests';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const suggestions = ['Inteligência Artificial', 'Desenvolvimento Web', 'Marketing Digital', 'Design UX/UI'];

export default function HomeScreen() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState(homeCategories[0]);
  const [mode, setMode] = useState<'explorar' | 'foco'>('explorar');
  const [searchQuery, setSearchQuery] = useState('');
  const [topInterests, setTopInterests] = useState<string[]>([]);
  const { user } = useAuth();

  const { featured, sections, featuredCreators, loading, error, usingFallback } = useHomeSections();

  // Load user top interests on mount/user change
  useEffect(() => {
    if (user) {
      getTopInterests(user.id).then(setTopInterests);
    }
  }, [user]);

  let setIsScrolled: ((scrolled: boolean) => void) | undefined;
  try {
    const scrollContext = useTabScroll();
    setIsScrolled = scrollContext.setIsScrolled;
  } catch (e) {
    // Safely ignore if rendered outside TabScrollProvider
  }

  const handleScroll = (event: any) => {
    if (setIsScrolled) {
      const offsetY = event.nativeEvent.contentOffset.y;
      setIsScrolled(offsetY > 5);
    }
  };

  const visibleSections = useMemo(() => {
    if (activeCategory === 'Todos') {
      return sections;
    }

    return sections
      .map((section): HomeSection => {
        const contents = section.contents.filter((content) => {
          if (activeCategory === 'PRO') return content.access === 'pro';
          if (activeCategory === 'Premium') return content.access === 'premium';
          if (activeCategory === 'Shorts') return content.contentType === 'short';
          if (activeCategory === 'Podcasts') return content.contentType === 'podcast';
          if (activeCategory === 'Cursos') return content.contentType === 'curso';
          if (activeCategory === 'Aulas') return content.contentType === 'aula';
          return content.category === activeCategory;
        });

        return { ...section, contents };
      })
      .filter((section) => section.contents.length > 0);
  }, [activeCategory, sections]);

  // Dynamically sort collections boosting user interest matches
  const boostedSections = useMemo(() => {
    if (topInterests.length === 0) return visibleSections;
    return visibleSections.map((section) => ({
      ...section,
      contents: boostContentList(section.contents, topInterests),
    }));
  }, [visibleSections, topInterests]);

  const flatSections = useMemo(() => {
    if (activeCategory === 'Todos') {
      return boostedSections;
    }

    const mergedContents = boostedSections.flatMap((section) => section.contents);

    return mergedContents.length
      ? [
          {
            key: `filtered-${activeCategory}`,
            title: activeCategory,
            layout: activeCategory === 'Shorts' ? 'shorts' : 'vertical',
            contents: mergedContents,
          } satisfies HomeSection,
        ]
      : [];
  }, [activeCategory, boostedSections]);

  const showFeatured = activeCategory === 'Todos';

  const statusLabel = useMemo(() => {
    if (loading) return 'Atualizando';
    if (usingFallback) return 'Preview';
    return 'Ao vivo';
  }, [loading, usingFallback]);

  const handleCreateStudy = () => {
    if (!searchQuery.trim()) return;
    const topic = searchQuery.trim();
    setSearchQuery('');
    // Redirect to Study tab passing the new topic parameter
    router.push({
      pathname: '/study',
      params: { newTopic: topic },
    } as any);
  };

  // Header rendered on top of the feed list
  const renderHeader = () => (
    <View style={styles.headerBlock}>
      <HomeHeader mode={mode} onModeChange={setMode} />

      {error ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Feed em preview</Text>
          <Text style={styles.noticeBody}>{error}</Text>
        </View>
      ) : null}

      {mode === 'explorar' ? (
        <>
          <CategoryChips
            categories={homeCategories}
            activeCategory={activeCategory}
            onSelect={setActiveCategory}
          />

          {showFeatured ? (
            <>
              {/* Premium Studies Call-out Banner */}
              <View style={styles.studyBanner}>
                <View style={styles.studyBannerLeft}>
                  <Ionicons name="sparkles" size={18} color={colors.accent} />
                  <View style={styles.studyBannerTextCol}>
                    <Text style={styles.studyBannerTitle}>Plano Premium com mais profundidade</Text>
                    <Text style={styles.studyBannerBody}>Deixe a Classy montar seu foco de estudo.</Text>
                  </View>
                </View>
                <Pressable onPress={() => setMode('foco')} style={styles.studyBannerBtn}>
                  <Text style={styles.studyBannerBtnText}>Estudar</Text>
                  <Ionicons name="arrow-forward" size={12} color="#000" />
                </Pressable>
              </View>

              {/* Creators em Destaque Carousel */}
              <FeaturedCreators creators={featuredCreators} />

              {/* Continue estudando Section */}
              <ContinueWatching userId={user?.id || ''} />

              <SectionHeader title="Em destaque" actionLabel={statusLabel} />
              <MobileVideoCard content={featured} featured />
            </>
          ) : null}
        </>
      ) : (
        /* Modo Foco Dashboard input area */
        <View style={styles.focoPanel}>
          <Text style={styles.focoTitle}>O que você quer aprender?</Text>
          <Text style={styles.focoSubtitle}>
            Digite um tema e crie um estudo personalizado com a Classy
          </Text>

          <View style={styles.searchInputContainer}>
            <Ionicons name="search-outline" size={18} color={colors.muted} style={styles.searchIcon} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Pergunte qualquer coisa à Classy..."
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
            />
            {searchQuery.trim() ? (
              <Pressable onPress={handleCreateStudy} style={styles.searchSubmit}>
                <Ionicons name="arrow-up" size={16} color={colors.background} />
              </Pressable>
            ) : null}
          </View>

          {/* Quick suggestions pills */}
          <View style={styles.suggestionRow}>
            {suggestions.map((item) => (
              <Pressable
                key={item}
                onPress={() => setSearchQuery(item)}
                style={styles.suggestionChip}
              >
                <Text style={styles.suggestionText}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {loading && mode === 'explorar' ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
    </View>
  );

  return (
    <AppScreen scroll={false}>
      {mode === 'explorar' ? (
        <FlatList
          data={flatSections}
          keyExtractor={(item) => item.key}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={renderHeader()}
          renderItem={({ item }) => <HomeSectionBlock section={item} />}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nada nessa categoria ainda</Text>
                <Text style={styles.emptyBody}>Troque o filtro para continuar navegando pelo feed.</Text>
              </View>
            ) : null
          }
          contentContainerStyle={styles.listContent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        />
      ) : (
        /* Scrollable container for Modo Foco studies cards list */
        <FlatList
          data={[{ id: 'foco-dashboard' }]}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={renderHeader()}
          renderItem={() => (
            <View style={{ marginTop: spacing.md }}>
              <ContinueStudyCard userId={user?.id || ''} />
            </View>
          )}
          contentContainerStyle={styles.listContent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 110,
  },
  headerBlock: {
    marginBottom: spacing.md,
  },
  studyBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
  },
  studyBannerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  studyBannerTextCol: {
    flexShrink: 1,
  },
  studyBannerTitle: {
    color: colors.text,
    fontSize: 11,
    fontWeight: typography.weightBold,
  },
  studyBannerBody: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 2,
  },
  studyBannerBtn: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.xs,
    flexDirection: 'row',
    gap: 4,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  studyBannerBtnText: {
    color: '#000',
    fontSize: 11,
    fontWeight: typography.weightBold,
  },
  focoPanel: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  focoTitle: {
    color: colors.text,
    fontSize: typography.titleLarge,
    fontWeight: typography.weightBold,
    textAlign: 'center',
  },
  focoSubtitle: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    marginTop: spacing.xs,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.xl,
  },
  searchInputContainer: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    height: 52,
    paddingHorizontal: spacing.md,
    width: '100%',
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  searchSubmit: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: radius.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.lg,
    width: '100%',
  },
  suggestionChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  suggestionText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: typography.weightMedium,
  },
  notice: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  noticeTitle: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBold,
  },
  noticeBody: {
    color: colors.muted,
    fontSize: typography.caption,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  loading: {
    paddingVertical: spacing.xl,
  },
  empty: {
    paddingVertical: spacing.section,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.titleSmall,
    fontWeight: typography.weightBold,
  },
  emptyBody: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    marginTop: spacing.xs,
  },
});

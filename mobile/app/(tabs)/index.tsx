import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { CategoryChips } from '@/components/CategoryChips';
import { HomeHeader } from '@/components/HomeHeader';
import { HomeSectionBlock } from '@/components/HomeSectionBlock';
import { MobileVideoCard } from '@/components/MobileVideoCard';
import { SectionHeader } from '@/components/SectionHeader';
import { HomeSection, homeCategories } from '@/features/home/homeData';
import { useHomeSections } from '@/features/home/useHomeSections';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export default function HomeScreen() {
  const [activeCategory, setActiveCategory] = useState(homeCategories[0]);
  const { featured, sections, loading, error, usingFallback } = useHomeSections();

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

  const flatSections = useMemo(() => {
    if (activeCategory === 'Todos') {
      return visibleSections;
    }

    const mergedContents = visibleSections.flatMap((section) => section.contents);

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
  }, [activeCategory, visibleSections]);

  const showFeatured = activeCategory === 'Todos';

  const statusLabel = useMemo(() => {
    if (loading) return 'Atualizando';
    if (usingFallback) return 'Preview';
    return 'Ao vivo';
  }, [loading, usingFallback]);

  const header = (
    <View>
      <HomeHeader />
      <CategoryChips
        categories={homeCategories}
        activeCategory={activeCategory}
        onSelect={setActiveCategory}
      />

      {error ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Feed em preview</Text>
          <Text style={styles.noticeBody}>{error}</Text>
        </View>
      ) : null}

      {showFeatured ? (
        <>
          <SectionHeader title="Em destaque" actionLabel={statusLabel} />
          <MobileVideoCard content={featured} featured />
        </>
      ) : null}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
    </View>
  );

  return (
    <AppScreen scroll={false}>
      <FlatList
        data={flatSections}
        keyExtractor={(item) => item.key}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
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
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 92,
  },
  notice: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  noticeTitle: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBlack,
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
    fontWeight: typography.weightBlack,
  },
  emptyBody: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    marginTop: spacing.xs,
  },
});

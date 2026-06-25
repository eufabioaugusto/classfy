import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { CategoryChips } from '@/components/CategoryChips';
import { HomeHeader } from '@/components/HomeHeader';
import { MobileVideoCard } from '@/components/MobileVideoCard';
import { SectionHeader } from '@/components/SectionHeader';
import { ShortsRail } from '@/components/ShortsRail';
import { featuredContent, feedContents, homeCategories, shortContents } from '@/features/home/homeData';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export default function HomeScreen() {
  const [activeCategory, setActiveCategory] = useState(homeCategories[0]);

  const visibleContents = useMemo(() => {
    if (activeCategory === 'Todos') {
      return feedContents;
    }

    return feedContents.filter((content) => {
      if (activeCategory === 'Pro') return content.access === 'pro';
      if (activeCategory === 'Premium') return content.access === 'premium';
      return content.category === activeCategory;
    });
  }, [activeCategory]);

  return (
    <AppScreen scroll={false}>
      <FlatList
        data={visibleContents}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <HomeHeader />
            <CategoryChips
              categories={homeCategories}
              activeCategory={activeCategory}
              onSelect={setActiveCategory}
            />
            <SectionHeader title="Em destaque" actionLabel="Hoje" />
            <MobileVideoCard content={featuredContent} featured />
            <SectionHeader title="Shorts" actionLabel="Ver todos" />
            <ShortsRail shorts={shortContents} />
            <SectionHeader title="Continuar explorando" />
          </View>
        }
        renderItem={({ item }) => <MobileVideoCard content={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nada nessa categoria ainda</Text>
            <Text style={styles.emptyBody}>Troque o filtro para continuar navegando pelo feed.</Text>
          </View>
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

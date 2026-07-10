import { FlatList, StyleSheet, View } from 'react-native';

import { HomeContent } from '@/features/home/homeData';
import { spacing } from '@/theme/spacing';
import { MobileVideoCard } from './MobileVideoCard';

type ContentRailProps = {
  contents: HomeContent[];
  layout?: 'horizontal' | 'vertical' | 'square';
};

export function ContentRail({ contents, layout = 'horizontal' }: ContentRailProps) {
  const getItemWidth = () => {
    if (layout === 'square') return 140;
    return 272;
  };

  return (
    <FlatList
      horizontal
      data={contents}
      keyExtractor={(item) => item.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => (
        <View style={[styles.item, { width: getItemWidth() }]}>
          <MobileVideoCard content={item} layout={layout} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
    paddingHorizontal: 0, // Align exactly at 0 margin inside AppScreen
  },
  item: {
    // Width handled dynamically in inline styles
  },
});

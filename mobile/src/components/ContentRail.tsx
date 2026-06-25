import { FlatList, StyleSheet, View } from 'react-native';

import { HomeContent } from '@/features/home/homeData';
import { spacing } from '@/theme/spacing';
import { MobileVideoCard } from './MobileVideoCard';

type ContentRailProps = {
  contents: HomeContent[];
};

export function ContentRail({ contents }: ContentRailProps) {
  return (
    <FlatList
      horizontal
      data={contents}
      keyExtractor={(item) => item.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => (
        <View style={styles.item}>
          <MobileVideoCard content={item} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
  },
  item: {
    width: 272,
  },
});

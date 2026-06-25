import { FlatList, StyleSheet, Text, View } from 'react-native';

import { HomeShort } from '@/features/home/homeData';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type ShortsRailProps = {
  shorts: HomeShort[];
};

export function ShortsRail({ shorts }: ShortsRailProps) {
  return (
    <FlatList
      horizontal
      data={shorts}
      keyExtractor={(item) => item.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => (
        <View style={styles.item}>
          <View style={[styles.poster, { backgroundColor: item.tone }]}>
            <View style={styles.posterShade} />
            <Text style={styles.shortMark}>Short</Text>
          </View>
          <Text numberOfLines={2} style={styles.title}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={styles.creator}>
            {item.creator}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  item: {
    width: 132,
  },
  poster: {
    aspectRatio: 9 / 16,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  posterShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlaySoft,
  },
  shortMark: {
    bottom: spacing.sm,
    color: colors.text,
    fontSize: typography.label,
    fontWeight: typography.weightBlack,
    left: spacing.sm,
    position: 'absolute',
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBold,
    lineHeight: 18,
  },
  creator: {
    color: colors.muted,
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
});

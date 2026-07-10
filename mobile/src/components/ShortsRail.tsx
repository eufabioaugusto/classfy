import { FlatList, Image, StyleSheet, Text, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Video } from 'expo-av';

import { HomeShort } from '@/features/home/homeData';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type ShortsRailProps = {
  shorts: HomeShort[];
};

export function ShortsRail({ shorts }: ShortsRailProps) {
  const router = useRouter();

  // Pre-buffer only the top 4 visible shorts on the Home screen to conserve bandwidth
  const prebufferItems = shorts.slice(0, 4);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        horizontal
        data={shorts}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({
              pathname: '/shorts',
              params: {
                id: item.id,
                videoUrl: item.fileUrl || item.videoUrl || '',
                thumbnailUrl: item.thumbnailUrl || '',
              }
            } as any)}
            style={styles.item}
          >
            <View style={[styles.poster, { backgroundColor: item.tone }]}>
              {item.thumbnailUrl ? <Image source={{ uri: item.thumbnailUrl }} style={styles.posterImage} /> : null}
              <View style={styles.posterShade} />
              <Text style={styles.shortMark}>Short</Text>
            </View>
            <Text numberOfLines={2} style={styles.title}>
              {item.title}
            </Text>
            <Text numberOfLines={1} style={styles.creator}>
              {item.creator}
            </Text>
          </Pressable>
        )}
      />

      {/* Invisible Pre-buffering engine */}
      <View style={styles.prebufferContainer} pointerEvents="none">
        {prebufferItems.map((item) => {
          const videoUri = item.fileUrl || item.videoUrl;
          if (!videoUri) return null;
          return (
            <Video
              key={`prebuffer-${item.id}`}
              source={{ uri: videoUri }}
              shouldPlay={false}
              progressUpdateIntervalMillis={5000}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
    paddingHorizontal: 0, // Align exactly at 0 margin inside AppScreen
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
  posterImage: {
    height: '100%',
    width: '100%',
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
  prebufferContainer: {
    width: 0,
    height: 0,
    opacity: 0,
    position: 'absolute',
  },
});

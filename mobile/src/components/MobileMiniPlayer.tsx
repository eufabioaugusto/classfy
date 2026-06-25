import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMiniPlayer } from '@/features/watch/miniPlayerContext';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export function MobileMiniPlayer() {
  const insets = useSafeAreaInsets();
  const { content, visible, closeMiniPlayer } = useMiniPlayer();

  if (!visible || !content) return null;

  const expand = () => {
    closeMiniPlayer();
    router.push(`/watch/${content.id}`);
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={[styles.container, { bottom: insets.bottom + 72 }]}>
        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
        </View>
        <Pressable style={styles.main} onPress={expand}>
          <View style={styles.thumbnail}>
            {content.thumbnailUrl ? <Image source={{ uri: content.thumbnailUrl }} style={styles.image} /> : null}
            <View style={styles.thumbnailOverlay} />
            <Ionicons name="play" color={colors.text} size={22} />
          </View>

          <View style={styles.copy}>
            <Text numberOfLines={1} style={styles.title}>
              {content.title}
            </Text>
            <Text numberOfLines={1} style={styles.creator}>
              {content.creatorName || 'Creator Classfy'}
            </Text>
          </View>

          <Pressable hitSlop={10} style={styles.iconButton} onPress={expand}>
            <Ionicons name="chevron-up" color={colors.text} size={22} />
          </Pressable>
          <Pressable hitSlop={10} style={styles.iconButton} onPress={closeMiniPlayer}>
            <Ionicons name="close" color={colors.text} size={22} />
          </Pressable>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    left: spacing.sm,
    overflow: 'hidden',
    position: 'absolute',
    right: spacing.sm,
  },
  progressTrack: {
    backgroundColor: colors.surfaceMuted,
    height: 2,
  },
  progressFill: {
    backgroundColor: colors.accent,
    height: '100%',
    width: '34%',
  },
  main: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.sm,
  },
  thumbnail: {
    alignItems: 'center',
    aspectRatio: 16 / 9,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 112,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    height: '100%',
    width: '100%',
  },
  thumbnailOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBlack,
  },
  creator: {
    color: colors.muted,
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  iconButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 30,
  },
});

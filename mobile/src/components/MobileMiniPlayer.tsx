import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import { router } from 'expo-router';
import { Dimensions, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMiniPlayer } from '@/features/watch/miniPlayerContext';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const screenWidth = Dimensions.get('window').width;

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
      <Pressable style={[styles.container, { bottom: insets.bottom + 86 }]} onPress={expand}>
        <View style={styles.videoBox}>
          {content.fileUrl ? (
            <Video
              source={{ uri: content.fileUrl }}
              style={styles.video}
              resizeMode={ResizeMode.COVER}
              shouldPlay={content.shouldPlay ?? true}
              isMuted={false}
              posterSource={content.thumbnailUrl ? { uri: content.thumbnailUrl } : undefined}
              posterStyle={styles.video}
              progressUpdateIntervalMillis={1000}
              status={{
                positionMillis: content.startPositionMillis || 0,
                shouldPlay: content.shouldPlay ?? true,
              }}
            />
          ) : content.thumbnailUrl ? (
            <Image source={{ uri: content.thumbnailUrl }} style={styles.video} />
          ) : null}
          <View style={styles.shade} />
          <Ionicons name="pause" color={colors.text} size={32} style={styles.pauseIcon} />
          <Pressable hitSlop={12} style={styles.closeButton} onPress={closeMiniPlayer}>
            <Ionicons name="close" color={colors.text} size={24} />
          </Pressable>
        </View>
        <Text numberOfLines={1} style={styles.title}>
          {content.title}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: spacing.md,
    width: Math.min(230, screenWidth * 0.52),
  },
  videoBox: {
    aspectRatio: 16 / 9,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.36,
    shadowRadius: 16,
  },
  video: {
    height: '100%',
    width: '100%',
  },
  shade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  pauseIcon: {
    left: spacing.lg,
    position: 'absolute',
    top: '42%',
  },
  closeButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.xs,
    top: spacing.xs,
    width: 44,
  },
  title: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
    marginTop: spacing.xs,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

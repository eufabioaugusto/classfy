import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Audio, AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import { Animated, GestureResponderEvent, Image, LayoutChangeEvent, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export type ClassfyVideoPlayerRef = {
  seekTo: (seconds: number) => Promise<void>;
  getCurrentPosition: () => number;
};

type ClassfyVideoPlayerProps = {
  src: string;
  poster?: string | null;
  title: string;
  creatorName?: string | null;
  onMinimize?: () => void;
  onNotesPress?: () => void;
  onPlaybackPosition?: (positionSeconds: number) => void;
  onStatusUpdate?: (status: AVPlaybackStatus) => void;
  isFullscreen?: boolean;
  onFullscreenToggle?: (fullscreen: boolean) => void;
  playbackRate?: number;
  onControlsPress?: () => void;
  isLiked?: boolean;
  likesCount?: number;
  onLikePress?: () => void;
  isSaved?: boolean;
  onSavePress?: () => void;
  isFavorited?: boolean;
  onFavoritePress?: () => void;
  onCommentsPress?: () => void;
  onSharePress?: () => void;
  onStudyPress?: (tab: 'notes' | 'transcript' | 'quiz' | 'suggestions') => void;
};

const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatCount(value?: number | null) {
  if (!value) return '0';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return value.toString();
}

export const ClassfyVideoPlayer = forwardRef<ClassfyVideoPlayerRef, ClassfyVideoPlayerProps>(({
  src,
  poster,
  title,
  creatorName,
  onMinimize,
  onNotesPress,
  onPlaybackPosition,
  onStatusUpdate,
  isFullscreen = false,
  onFullscreenToggle,
  playbackRate = 1,
  onControlsPress,
  isLiked,
  likesCount,
  onLikePress,
  isSaved,
  onSavePress,
  isFavorited,
  onFavoritePress,
  onCommentsPress,
  onSharePress,
  onStudyPress,
}, ref) => {
  const videoRef = useRef<Video>(null);

  useImperativeHandle(ref, () => ({
    seekTo: async (seconds: number) => {
      const status = await videoRef.current?.getStatusAsync();
      if (status?.isLoaded) {
        await videoRef.current?.setPositionAsync(seconds * 1000);
        setPositionMillis(seconds * 1000);
      }
    },
    getCurrentPosition: () => {
      return positionMillis / 1000;
    },
  }));
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const lastLeftTapRef = useRef(0);
  const lastRightTapRef = useRef(0);
  const [showControls, setShowControls] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [progressWidth, setProgressWidth] = useState(0);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
    }).catch(() => {});

    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (showControls) {
      setControlsVisible(true);
      Animated.timing(controlsOpacity, {
        duration: 140,
        toValue: 1,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(controlsOpacity, {
      duration: 180,
      toValue: 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setControlsVisible(false);
    });
  }, [controlsOpacity, showControls]);

  const progressPercent = useMemo(() => {
    if (!durationMillis) return 0;
    return Math.min((positionMillis / durationMillis) * 100, 100);
  }, [durationMillis, positionMillis]);

  const resetControlsTimer = (playing = isPlaying) => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (playing) {
      controlsTimerRef.current = setTimeout(() => setShowControls(false), 2000);
    }
  };

  const toggleControls = () => {
    setShowControls((current) => {
      const next = !current;
      if (next) resetControlsTimer();
      return next;
    });
  };

  const togglePlay = async () => {
    if (!hasStartedPlaying) {
      setHasStartedPlaying(true);
      setIsPlaying(true);
      setShowControls(true);
      resetControlsTimer(true);
      return;
    }
    const status = await videoRef.current?.getStatusAsync();
    if (!status?.isLoaded) return;
    if (status.isPlaying) {
      await videoRef.current?.pauseAsync();
      setIsPlaying(false);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    } else {
      await videoRef.current?.playAsync();
      setIsPlaying(true);
    }
    setShowControls(true);
    resetControlsTimer(!status.isPlaying);
  };

  const seekBy = async (deltaMillis: number) => {
    const status = await videoRef.current?.getStatusAsync();
    if (!status?.isLoaded) return;
    const nextPosition = Math.max(0, Math.min((status.durationMillis || 0), status.positionMillis + deltaMillis));
    await videoRef.current?.setPositionAsync(nextPosition);
    setPositionMillis(nextPosition);
    setShowControls(true);
    resetControlsTimer();
  };

  const handleProgressLayout = (event: LayoutChangeEvent) => {
    setProgressWidth(event.nativeEvent.layout.width);
  };

  const seekToProgressLocation = (event: GestureResponderEvent) => {
    if (!durationMillis || !progressWidth) return;
    const locationX = Math.max(0, Math.min(progressWidth, event.nativeEvent.locationX));
    const nextPosition = Math.round((locationX / progressWidth) * durationMillis);
    videoRef.current?.setPositionAsync(nextPosition).catch(() => {});
    setPositionMillis(nextPosition);
    setShowControls(true);
    resetControlsTimer();
  };

  const handleSideTap = (side: 'left' | 'right') => {
    const now = Date.now();
    const ref = side === 'left' ? lastLeftTapRef : lastRightTapRef;
    if (now - ref.current < 320) {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      seekBy(side === 'left' ? -10000 : 10000);
      ref.current = 0;
      return;
    }
    ref.current = now;
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    singleTapTimerRef.current = setTimeout(toggleControls, 220);
  };

  const openSettings = () => {
    setShowControls(true);
    onControlsPress?.();
  };

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.setRateAsync(playbackRate, true).catch(() => {});
    }
    setShowControls(true);
    resetControlsTimer();
  }, [playbackRate]);

  const toggleFullscreen = () => {
    onFullscreenToggle?.(!isFullscreen);
  };

  const handleStatus = (status: AVPlaybackStatus) => {
    onStatusUpdate?.(status);
    if (!status.isLoaded) return;
    setIsPlaying(status.isPlaying);
    setPositionMillis(status.positionMillis);
    setDurationMillis(status.durationMillis || 0);
    if (status.isPlaying) onPlaybackPosition?.(status.positionMillis / 1000);
  };

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  return (
    <View style={[
      styles.container,
      isFullscreen && {
        aspectRatio: 16 / 9,
        height: windowHeight,
        width: undefined,
        justifyContent: 'center',
        alignItems: 'center',
      }
    ]}>
      <Video
        ref={videoRef}
        source={hasStartedPlaying ? { uri: src } : undefined}
        style={styles.video}
        resizeMode={ResizeMode.CONTAIN}
        posterSource={poster ? { uri: poster } : undefined}
        posterStyle={styles.video}
        shouldPlay={hasStartedPlaying}
        useNativeControls={false}
        progressUpdateIntervalMillis={350}
        onPlaybackStatusUpdate={handleStatus}
      />

      <Pressable pointerEvents={showControls ? 'none' : 'auto'} style={styles.leftTapZone} onPress={() => handleSideTap('left')} />
      <Pressable pointerEvents={showControls ? 'none' : 'auto'} style={styles.centerTapZone} onPress={toggleControls} />
      <Pressable pointerEvents={showControls ? 'none' : 'auto'} style={styles.rightTapZone} onPress={() => handleSideTap('right')} />

      {controlsVisible ? (
        <Animated.View pointerEvents={showControls ? 'box-none' : 'none'} style={[styles.controls, { opacity: controlsOpacity }]}>
          <Pressable style={styles.cleanTapZone} onPress={() => setShowControls(false)} />
          <View pointerEvents="box-none" style={styles.topRow}>
            <View style={styles.topLeft}>
              <Pressable hitSlop={12} style={styles.topButton} onPress={isFullscreen ? toggleFullscreen : onMinimize}>
                <Ionicons name="chevron-down" color={colors.text} size={30} />
              </Pressable>
              {isFullscreen && (
                <View style={styles.topMeta}>
                  <Text style={styles.fullscreenTitle} numberOfLines={1}>{title}</Text>
                  <Text style={styles.fullscreenCreator} numberOfLines={1}>
                    {'@' + (creatorName || 'classfy').toLowerCase().replace(/\s+/g, '.')}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.topActions}>
              <Pressable style={styles.controlPill} onPress={openSettings}>
                <Ionicons name="options-outline" color={colors.text} size={16} />
                <Text numberOfLines={1} style={styles.premiumText}>
                  Controles
                </Text>
              </Pressable>
              <Pressable style={styles.notePill} onPress={onNotesPress}>
                <Ionicons name="document-text-outline" color={colors.text} size={18} />
                <Text numberOfLines={1} style={styles.noteText}>
                  Notas
                </Text>
              </Pressable>
            </View>
          </View>

          <View pointerEvents="box-none" style={styles.centerControls}>
            <Pressable style={styles.roundButton} onPress={() => seekBy(-10000)}>
              <Ionicons name="play-skip-back" color={colors.text} size={23} />
            </Pressable>
            <Pressable style={styles.playButton} onPress={togglePlay}>
              <Ionicons name={isPlaying ? 'pause' : 'play'} color={colors.text} size={40} />
            </Pressable>
            <Pressable style={styles.roundButton} onPress={() => seekBy(10000)}>
              <Ionicons name="play-skip-forward" color={colors.text} size={23} />
            </Pressable>
          </View>

          {isFullscreen ? (
            <View pointerEvents="box-none" style={styles.fullscreenBottomRow}>
              <View style={styles.fullscreenActionsRow}>
                <View style={styles.fullscreenTimePill}>
                  <Text style={styles.timeText}>
                    {formatTime(positionMillis)} / {formatTime(durationMillis)}
                  </Text>
                </View>

                {/* Like Pill */}
                <Pressable style={styles.fullscreenLikePill} onPress={onLikePress}>
                  <Ionicons name={isLiked ? 'thumbs-up' : 'thumbs-up-outline'} color={colors.text} size={18} />
                  {likesCount !== undefined && likesCount > 0 ? (
                    <Text style={styles.fullscreenPillText}>{formatCount(likesCount)}</Text>
                  ) : null}
                </Pressable>

                {/* Comments Pill */}
                <Pressable style={styles.fullscreenSinglePill} onPress={onCommentsPress}>
                  <Ionicons name="chatbubble-outline" color={colors.text} size={18} />
                </Pressable>

                {/* Favorite/Save Pill */}
                <Pressable style={styles.fullscreenSinglePill} onPress={onSavePress}>
                  <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} color={colors.text} size={18} />
                </Pressable>

                {/* Star/Study Pill */}
                <Pressable style={styles.fullscreenSinglePill} onPress={() => onStudyPress?.('quiz')}>
                  <Ionicons name="sparkles-outline" color={colors.text} size={18} />
                </Pressable>
              </View>

              <View style={styles.fullscreenBottomRight}>
                {poster && (
                  <Pressable style={styles.moreVideosPill} onPress={() => onStudyPress?.('suggestions')}>
                    <Text style={styles.moreVideosText}>Mais vídeos</Text>
                    <Image source={{ uri: poster }} style={styles.moreVideosThumb} />
                  </Pressable>
                )}
                <Pressable style={styles.fullscreenMinimizeBtn} onPress={toggleFullscreen}>
                  <Feather name="minimize-2" color={colors.text} size={22} />
                </Pressable>
              </View>
            </View>
          ) : (
            <View pointerEvents="box-none" style={styles.bottomOverlay}>
              <View style={styles.metaPill}>
                <Text style={styles.timeText}>
                  {formatTime(positionMillis)} / {formatTime(durationMillis)}
                </Text>
              </View>
              <Pressable style={styles.floatButton} onPress={toggleFullscreen}>
                <Feather name={isFullscreen ? 'minimize-2' : 'maximize-2'} color={colors.text} size={23} />
              </Pressable>
            </View>
          )}

          <View
            style={[styles.progressRail, isFullscreen && { bottom: 68 }]}
            onLayout={handleProgressLayout}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={seekToProgressLocation}
            onResponderMove={seekToProgressLocation}
            onResponderRelease={() => resetControlsTimer()}
          >
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              <View style={[styles.progressThumb, { left: `${progressPercent}%` }]} />
            </View>
          </View>
        </Animated.View>
      ) : null}

    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    overflow: 'hidden',
    width: '100%',
  },
  video: {
    height: '100%',
    width: '100%',
  },
  leftTapZone: {
    bottom: 56,
    left: 0,
    position: 'absolute',
    top: 56,
    width: '33%',
    zIndex: 1,
  },
  centerTapZone: {
    bottom: 56,
    left: '33%',
    position: 'absolute',
    top: 56,
    width: '34%',
    zIndex: 1,
  },
  rightTapZone: {
    bottom: 56,
    position: 'absolute',
    right: 0,
    top: 56,
    width: '33%',
    zIndex: 1,
  },
  controls: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)',
    elevation: 4,
    zIndex: 4,
  },
  cleanTapZone: {
    bottom: 24,
    elevation: 2,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 52,
    zIndex: 2,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    position: 'absolute',
    right: 0,
    top: 0,
    elevation: 30,
    zIndex: 30,
  },
  topLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minWidth: 0,
  },
  topActions: {
    alignItems: 'center',
    elevation: 31,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'flex-end',
    minWidth: 0,
    zIndex: 31,
  },
  topButton: {
    alignItems: 'center',
    elevation: 32,
    height: 36,
    justifyContent: 'center',
    width: 36,
    zIndex: 32,
  },
  centerControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: '34%',
    elevation: 8,
    zIndex: 5,
  },
  roundButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.30)',
    borderRadius: radius.pill,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderRadius: radius.pill,
    height: 70,
    justifyContent: 'center',
    width: 70,
  },
  bottomOverlay: {
    alignItems: 'center',
    bottom: 14,
    flexDirection: 'row',
    gap: spacing.sm,
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
    elevation: 8,
    zIndex: 5,
  },
  metaPill: {
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  timeText: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBold,
  },
  controlPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: 116,
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    elevation: 32,
    zIndex: 32,
  },
  premiumText: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
  },
  notePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.34)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    elevation: 32,
    zIndex: 32,
  },
  noteText: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
  },
  floatButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.34)',
    borderRadius: radius.pill,
    height: 40,
    justifyContent: 'center',
    marginLeft: 'auto',
    width: 40,
  },
  progressRail: {
    bottom: 0,
    elevation: 12,
    height: 24,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 6,
  },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.26)',
    bottom: 9,
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  progressFill: {
    backgroundColor: colors.accent,
    height: '100%',
  },
  progressThumb: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    height: 12,
    marginLeft: -6,
    opacity: 0,
    position: 'absolute',
    top: -4.5,
    width: 12,
  },
  topMeta: {
    marginLeft: spacing.sm,
    justifyContent: 'center',
    flexShrink: 1,
  },
  fullscreenTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
  },
  fullscreenCreator: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    marginTop: 2,
  },
  fullscreenBottomRow: {
    alignItems: 'center',
    bottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
    zIndex: 5,
  },
  fullscreenActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  fullscreenTimePill: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
  },
  fullscreenLikePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderRadius: radius.pill,
    height: 38,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  fullscreenPillText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  fullscreenSinglePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderRadius: radius.pill,
    width: 38,
    height: 38,
    justifyContent: 'center',
  },
  fullscreenBottomRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  moreVideosPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    gap: spacing.sm,
  },
  moreVideosText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  moreVideosThumb: {
    width: 48,
    height: 27,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
  fullscreenMinimizeBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderRadius: radius.pill,
    width: 38,
    height: 38,
    justifyContent: 'center',
  },
});


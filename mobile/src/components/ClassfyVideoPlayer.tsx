import { useEffect, useMemo, useRef, useState } from 'react';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Audio, AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type ClassfyVideoPlayerProps = {
  src: string;
  poster?: string | null;
  title: string;
  creatorName?: string | null;
  onMinimize?: () => void;
  onNotesPress?: () => void;
  onPlaybackPosition?: (positionSeconds: number) => void;
  onStatusUpdate?: (status: AVPlaybackStatus) => void;
};

const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function ClassfyVideoPlayer({
  src,
  poster,
  creatorName,
  onMinimize,
  onNotesPress,
  onPlaybackPosition,
  onStatusUpdate,
}: ClassfyVideoPlayerProps) {
  const videoRef = useRef<Video>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const lastLeftTapRef = useRef(0);
  const lastRightTapRef = useRef(0);
  const [showControls, setShowControls] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

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

  const setRate = async (rate: number) => {
    await videoRef.current?.setRateAsync(rate, true);
    setPlaybackRate(rate);
    setSettingsOpen(false);
    setShowControls(true);
    resetControlsTimer();
  };

  const openSettings = () => {
    setShowControls(true);
    setSettingsOpen(true);
  };

  const openFullscreen = async () => {
    await videoRef.current?.presentFullscreenPlayer();
  };

  const handleStatus = (status: AVPlaybackStatus) => {
    onStatusUpdate?.(status);
    if (!status.isLoaded) return;
    setIsPlaying(status.isPlaying);
    setPositionMillis(status.positionMillis);
    setDurationMillis(status.durationMillis || 0);
    if (status.isPlaying) onPlaybackPosition?.(status.positionMillis / 1000);
  };

  return (
    <View style={styles.container}>
      <Video
        ref={videoRef}
        source={{ uri: src }}
        style={styles.video}
        resizeMode={ResizeMode.CONTAIN}
        posterSource={poster ? { uri: poster } : undefined}
        posterStyle={styles.video}
        shouldPlay={false}
        useNativeControls={false}
        progressUpdateIntervalMillis={350}
        onPlaybackStatusUpdate={handleStatus}
      />

      <Pressable pointerEvents={showControls ? 'none' : 'auto'} style={styles.leftTapZone} onPress={() => handleSideTap('left')} />
      <Pressable pointerEvents={showControls ? 'none' : 'auto'} style={styles.centerTapZone} onPress={toggleControls} />
      <Pressable pointerEvents={showControls ? 'none' : 'auto'} style={styles.rightTapZone} onPress={() => handleSideTap('right')} />

      {controlsVisible ? (
        <Animated.View pointerEvents={showControls ? 'box-none' : 'none'} style={[styles.controls, { opacity: controlsOpacity }]}>
          <Pressable style={styles.controlsBackdrop} onPress={() => setShowControls(false)} />
          <View style={styles.topRow}>
            <View style={styles.topLeft}>
              <Pressable hitSlop={12} style={styles.topButton} onPress={onMinimize}>
                <Ionicons name="chevron-down" color={colors.text} size={30} />
              </Pressable>
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

          <View style={styles.centerControls}>
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

          <View style={styles.bottomOverlay}>
            <View style={styles.metaPill}>
              <Text style={styles.timeText}>
                {formatTime(positionMillis)} / {formatTime(durationMillis)}
              </Text>
            </View>
            <Pressable style={styles.floatButton} onPress={openFullscreen}>
              <Feather name="maximize-2" color={colors.text} size={23} />
            </Pressable>
          </View>

          <View style={styles.progressRail}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              <View style={[styles.progressThumb, { left: `${progressPercent}%` }]} />
            </View>
          </View>
        </Animated.View>
      ) : null}

      <SettingsSheet
        visible={settingsOpen}
        playbackRate={playbackRate}
        creatorName={creatorName}
        onClose={() => setSettingsOpen(false)}
        onRateSelect={setRate}
      />
    </View>
  );
}

function SettingsSheet({
  visible,
  playbackRate,
  creatorName,
  onClose,
  onRateSelect,
}: {
  visible: boolean;
  playbackRate: number;
  creatorName?: string | null;
  onClose: () => void;
  onRateSelect: (rate: number) => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetSectionTitle}>Controles</Text>
          <SheetRow icon="options-outline" label="Qualidade" value="Automatica (720p)" />
          <View style={styles.speedBlock}>
            <View style={styles.speedHeader}>
              <Ionicons name="play-circle-outline" color={colors.text} size={28} />
              <Text style={styles.sheetLabel}>Velocidade da reproducao</Text>
            </View>
            <View style={styles.speedOptions}>
              {speedOptions.map((rate) => (
                <Pressable
                  key={rate}
                  style={[styles.speedChip, playbackRate === rate && styles.speedChipActive]}
                  onPress={() => onRateSelect(rate)}
                >
                  <Text style={[styles.speedText, playbackRate === rate && styles.speedTextActive]}>
                    {rate}x
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <SheetRow icon="text-outline" label="Legendas" value="Desativadas" />
          <SheetRow icon="lock-closed-outline" label="Tela de bloqueio" />
          <SheetRow icon="person-circle-outline" label="Criador" value={creatorName || 'Classfy'} />
          <Text style={styles.sheetSectionTitle}>Controles Premium</Text>
          <SheetRow icon="language-outline" label="Legendas traduzidas" value="Bloqueado" premium locked />
          <SheetRow icon="sparkles-outline" label="Resumo inteligente" value="Bloqueado" premium locked />
          <SheetRow icon="star-outline" label="Recompensas avancadas" value="Bloqueado" premium locked />
        </View>
      </View>
    </Modal>
  );
}

function SheetRow({
  icon,
  label,
  value,
  premium,
  locked,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  premium?: boolean;
  locked?: boolean;
}) {
  return (
    <View style={[styles.sheetRow, locked && styles.sheetRowLocked]}>
      <Ionicons name={icon} color={locked ? colors.muted : colors.text} size={29} />
      <Text style={styles.sheetLabel}>{label}</Text>
      {premium ? <Text style={styles.premiumBadge}>PRO</Text> : null}
      {value ? <Text numberOfLines={1} style={styles.sheetValue}>{value}</Text> : null}
      <Ionicons name={locked ? 'lock-closed-outline' : 'chevron-forward'} color={colors.muted} size={22} />
    </View>
  );
}

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
  controlsBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    zIndex: 5,
  },
  topLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minWidth: 0,
  },
  topActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'flex-end',
    minWidth: 0,
  },
  topButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
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
    height: 18,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 6,
  },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.26)',
    bottom: 6,
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
  sheetBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.54)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#202020',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 5,
    marginBottom: spacing.lg,
    marginTop: spacing.md,
    width: 52,
  },
  sheetSectionTitle: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: typography.weightBlack,
    letterSpacing: 0,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },
  sheetRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 58,
  },
  sheetRowLocked: {
    opacity: 0.58,
  },
  sheetLabel: {
    color: colors.text,
    flex: 1,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBold,
  },
  sheetValue: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: typography.body,
  },
  premiumBadge: {
    backgroundColor: colors.accent,
    borderRadius: radius.xs,
    color: colors.text,
    fontSize: typography.label,
    fontWeight: typography.weightBlack,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  speedBlock: {
    paddingVertical: spacing.sm,
  },
  speedHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  speedOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingLeft: 42,
  },
  speedChip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  speedChipActive: {
    backgroundColor: colors.text,
  },
  speedText: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
  },
  speedTextActive: {
    color: colors.background,
  },
});

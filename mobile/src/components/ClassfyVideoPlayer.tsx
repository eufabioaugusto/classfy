import { useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Audio, AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

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
  title,
  creatorName,
  onMinimize,
  onNotesPress,
  onPlaybackPosition,
  onStatusUpdate,
}: ClassfyVideoPlayerProps) {
  const videoRef = useRef<Video>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLeftTapRef = useRef(0);
  const lastRightTapRef = useRef(0);
  const [showControls, setShowControls] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
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
    };
  }, []);

  const progressPercent = useMemo(() => {
    if (!durationMillis) return 0;
    return Math.min((positionMillis / durationMillis) * 100, 100);
  }, [durationMillis, positionMillis]);

  const resetControlsTimer = () => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (isPlaying) {
      controlsTimerRef.current = setTimeout(() => setShowControls(false), 2800);
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
    } else {
      await videoRef.current?.playAsync();
      setIsPlaying(true);
    }
    setShowControls(true);
    resetControlsTimer();
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
      seekBy(side === 'left' ? -10000 : 10000);
      ref.current = 0;
      return;
    }
    ref.current = now;
    setShowControls(true);
    resetControlsTimer();
  };

  const setRate = async (rate: number) => {
    await videoRef.current?.setRateAsync(rate, true);
    setPlaybackRate(rate);
    setSettingsOpen(false);
    setShowControls(true);
    resetControlsTimer();
  };

  const toggleMute = async () => {
    await videoRef.current?.setIsMutedAsync(!isMuted);
    setIsMuted((current) => !current);
    setShowControls(true);
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

      <Pressable style={styles.leftTapZone} onPress={() => handleSideTap('left')} />
      <Pressable style={styles.centerTapZone} onPress={toggleControls} />
      <Pressable style={styles.rightTapZone} onPress={() => handleSideTap('right')} />

      {showControls ? (
        <View pointerEvents="box-none" style={styles.controls}>
          <View style={styles.topRow}>
            <Pressable hitSlop={12} style={styles.topButton} onPress={onMinimize}>
              <Ionicons name="chevron-down" color={colors.text} size={34} />
            </Pressable>
            <View style={styles.topActions}>
              <Pressable style={styles.topButton}>
                <Ionicons name="tv-outline" color={colors.text} size={28} />
              </Pressable>
              <Pressable style={styles.topButton}>
                <Ionicons name="chatbox-ellipses-outline" color={colors.text} size={28} />
              </Pressable>
              <Pressable style={styles.topButton} onPress={() => setSettingsOpen(true)}>
                <Ionicons name="settings-outline" color={colors.text} size={31} />
              </Pressable>
            </View>
          </View>

          <View style={styles.centerControls}>
            <Pressable style={styles.roundButton} onPress={() => seekBy(-10000)}>
              <Ionicons name="play-skip-back" color={colors.text} size={28} />
            </Pressable>
            <Pressable style={styles.playButton} onPress={togglePlay}>
              <Ionicons name={isPlaying ? 'pause' : 'play'} color={colors.text} size={48} />
            </Pressable>
            <Pressable style={styles.roundButton} onPress={() => seekBy(10000)}>
              <Ionicons name="play-skip-forward" color={colors.text} size={28} />
            </Pressable>
          </View>

          <View style={styles.bottomOverlay}>
            <View style={styles.metaPill}>
              <Text style={styles.timeText}>
                {formatTime(positionMillis)} / {formatTime(durationMillis)}
              </Text>
            </View>
            <Pressable style={styles.premiumPill} onPress={() => setSettingsOpen(true)}>
              <Ionicons name="options-outline" color={colors.text} size={20} />
              <Text numberOfLines={1} style={styles.premiumText}>
                Controles Premium
              </Text>
              <Ionicons name="close-circle-outline" color={colors.textSecondary} size={20} />
            </Pressable>
            <Pressable style={styles.floatButton} onPress={openFullscreen}>
              <Ionicons name="expand-outline" color={colors.text} size={27} />
            </Pressable>
          </View>

          <View style={styles.bottomActions}>
            <Pressable style={styles.bottomAction} onPress={toggleMute}>
              <Ionicons name={isMuted ? 'volume-mute' : 'volume-high'} color={colors.text} size={22} />
            </Pressable>
            <Pressable style={styles.bottomAction} onPress={onNotesPress}>
              <Ionicons name="document-text-outline" color={colors.text} size={22} />
            </Pressable>
            <Text style={styles.videoTitle} numberOfLines={1}>
              {title}
            </Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            <View style={[styles.progressThumb, { left: `${progressPercent}%` }]} />
          </View>
        </View>
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
          <SheetRow icon="language-outline" label="Legendas premium" value="Em breve" premium />
          <SheetRow icon="lock-closed-outline" label="Tela de bloqueio" />
          <SheetRow icon="star-outline" label="Recompensas" value="Progresso ativo" premium />
          <SheetRow icon="person-circle-outline" label="Criador" value={creatorName || 'Classfy'} />
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  premium?: boolean;
}) {
  return (
    <View style={styles.sheetRow}>
      <Ionicons name={icon} color={colors.text} size={29} />
      <Text style={styles.sheetLabel}>{label}</Text>
      {premium ? <Text style={styles.premiumBadge}>PRO</Text> : null}
      {value ? <Text numberOfLines={1} style={styles.sheetValue}>{value}</Text> : null}
      <Ionicons name="chevron-forward" color={colors.muted} size={22} />
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
  },
  centerTapZone: {
    bottom: 56,
    left: '33%',
    position: 'absolute',
    top: 56,
    width: '34%',
  },
  rightTapZone: {
    bottom: 56,
    position: 'absolute',
    right: 0,
    top: 56,
    width: '33%',
  },
  controls: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  topActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  topButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  centerControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xl,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: '34%',
  },
  roundButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.34)',
    borderRadius: radius.pill,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.44)',
    borderRadius: radius.pill,
    height: 82,
    justifyContent: 'center',
    width: 82,
  },
  bottomOverlay: {
    alignItems: 'center',
    bottom: spacing.xl,
    flexDirection: 'row',
    gap: spacing.sm,
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
  },
  metaPill: {
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  timeText: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBold,
  },
  premiumPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderRadius: radius.pill,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  premiumText: {
    color: colors.text,
    flex: 1,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBold,
  },
  floatButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.pill,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  bottomActions: {
    alignItems: 'center',
    bottom: 2,
    flexDirection: 'row',
    gap: spacing.sm,
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
  },
  bottomAction: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  videoTitle: {
    color: colors.text,
    flex: 1,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
  },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.24)',
    bottom: 0,
    height: 4,
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
    bottom: -5,
    height: 14,
    marginLeft: -7,
    position: 'absolute',
    width: 14,
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
  sheetRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 58,
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

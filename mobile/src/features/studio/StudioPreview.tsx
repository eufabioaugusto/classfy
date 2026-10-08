import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Mic, Pause, Play, RotateCcw, Video } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { formatStudioDuration, type StudioKind, type StudioTake } from './model';

export function StudioPreview({ takes, kind, activeTakeId, onActiveTakeChange, paused = false }: {
  takes: readonly StudioTake[]; kind: StudioKind; activeTakeId?: string; onActiveTakeChange?: (id: string) => void; paused?: boolean;
}) {
  const selected = takes.findIndex(take => take.id === activeTakeId);
  const [index, setIndex] = useState(selected < 0 ? 0 : selected);
  const take = takes[index] || takes[0];
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState(false);
  const [montage, setMontage] = useState(false);
  const progressWidth = useRef(1);
  const autoplay = useRef(false);
  const current = useRef({ take, index, takes, montage }); current.current = { take, index, takes, montage };
  const moving = useRef(false);
  const replacements = useRef<Promise<void>>(Promise.resolve());
  const player = useVideoPlayer(null, instance => {
    instance.timeUpdateEventInterval = 0.1;
    instance.audioMixingMode = 'doNotMix';
    instance.staysActiveInBackground = false;
  });
  useEffect(() => {
    if (selected >= 0 && selected !== index) { autoplay.current = false; setMontage(false); setIndex(selected); }
  }, [activeTakeId, selected]);
  useEffect(() => {
    if (index >= takes.length && takes.length) setIndex(takes.length - 1);
  }, [takes.length, index]);
  useEffect(() => {
    let active = true;
    try { player.pause(); } catch { /* The hook can release its shared object before cleanup. */ }
    setFailed(false); setPosition(take?.start || 0); moving.current = true;
    replacements.current = replacements.current.catch(() => {}).then(async () => {
      if (!active) return;
      await player.replaceAsync(take?.uri || null);
      if (!active) return;
      moving.current = false;
      if (take) player.currentTime = take.start;
      if (autoplay.current && AppState.currentState === 'active') { autoplay.current = false; player.play(); }
    }).catch(() => { if (active) { moving.current = false; setFailed(true); } });
    return () => { active = false; };
  }, [player, take?.id, take?.uri]);
  useEffect(() => {
    if (!take || moving.current) return;
    if (player.currentTime < take.start || player.currentTime > take.end) { player.pause(); player.currentTime = take.start; setPosition(take.start); }
  }, [take?.start, take?.end, player]);
  useEffect(() => { if (paused) { autoplay.current = false; setMontage(false); try { player.pause(); } catch { /* Released player. */ } } }, [paused, player]);
  useFocusEffect(useCallback(() => () => { autoplay.current = false; try { player.pause(); } catch { /* Already released on unmount/Fast Refresh. */ } }, [player]));
  useEffect(() => {
    const advance = () => {
      const live = current.current;
      if (!live.take || moving.current) return;
      player.pause();
      if (live.montage && live.index + 1 < live.takes.length) {
        moving.current = true; autoplay.current = true; setIndex(live.index + 1);
        onActiveTakeChange?.(live.takes[live.index + 1].id);
      } else { setMontage(false); autoplay.current = false; }
    };
    const subscriptions = [
      player.addListener('playingChange', event => setPlaying(event.isPlaying)),
      player.addListener('statusChange', event => { if (event.status === 'error') setFailed(true); else if (event.status === 'readyToPlay') setFailed(false); }),
      player.addListener('timeUpdate', event => {
        setPosition(event.currentTime);
        const live = current.current;
        if (!live.take || moving.current || !player.playing || event.currentTime < live.take.end - 0.04) return;
        advance();
      }),
      player.addListener('playToEnd', advance),
      AppState.addEventListener('change', state => { if (state !== 'active') { autoplay.current = false; setMontage(false); try { player.pause(); } catch { /* Released player. */ } } }),
    ];
    return () => { subscriptions.forEach(subscription => { try { subscription.remove(); } catch { /* Released native emitter. */ } }); };
  }, [player, onActiveTakeChange]);
  const play = () => {
    if (!take || failed || moving.current) return;
    if (player.playing) { player.pause(); setMontage(false); return; }
    if (player.currentTime >= take.end - 0.1 || player.currentTime < take.start) player.currentTime = take.start;
    player.play();
  };
  const playMontage = () => {
    if (!take || failed || moving.current) return;
    setMontage(true);
    if (index === 0) { player.currentTime = take?.start || 0; player.play(); }
    else { autoplay.current = true; setIndex(0); onActiveTakeChange?.(takes[0].id); }
  };
  const fraction = take ? Math.min(1, Math.max(0, (position - take.start) / Math.max(0.1, take.end - take.start))) : 0;
  const aspectRatio = kind === 'short' ? 9 / 16 : kind === 'podcast' ? 16 / 7 : 16 / 9;
  return <View style={{ gap: 12 }}>
    <View style={[styles.canvas, { aspectRatio }, kind === 'short' && { alignSelf: 'center', width: '65%' }]}>
      {take && kind !== 'podcast' ? <VideoView style={StyleSheet.absoluteFillObject} player={player} nativeControls={false} contentFit="contain" fullscreenOptions={{ enable: false }} /> : <View style={styles.placeholder}>
        {kind === 'podcast' ? <Mic size={36} color={colors.mutedDim} strokeWidth={1.25} /> : <Video size={28} color={colors.mutedDim} strokeWidth={1.25} />}
        <Text style={styles.placeholderText}>{take ? 'Seu áudio, no seu ritmo' : 'Seu próximo take começa aqui'}</Text>
      </View>}
      {failed ? <View style={styles.failure}><Text style={styles.placeholderText}>Não foi possível reproduzir este take.</Text></View> : null}
      {take && !failed ? <View pointerEvents="none" style={styles.previewBadge}><Text style={styles.previewBadgeText}>{montage ? 'Montagem' : `Take ${index + 1}`}</Text></View> : null}
    </View>
    {take ? <>
      <View style={styles.playback}>
        <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pausar prévia' : 'Reproduzir take'} onPress={play} style={styles.control}>
          {playing ? <Pause size={20} color={colors.text} fill={colors.text} strokeWidth={1.3} /> : <Play size={20} color={colors.text} fill={colors.text} strokeWidth={1.3} />}
        </Pressable>
        <Text style={styles.time}>{formatStudioDuration(Math.max(0, position - take.start))}</Text>
        <Pressable accessibilityRole="adjustable" accessibilityLabel="Posição da prévia" onLayout={event => { progressWidth.current = event.nativeEvent.layout.width; }}
          onPress={event => { setMontage(false); player.currentTime = take.start + Math.max(0, Math.min(1, event.nativeEvent.locationX / progressWidth.current)) * (take.end - take.start); }} style={styles.progressTouch}>
          <View style={styles.track}><View style={[styles.progress, { width: `${fraction * 100}%` }]} /></View>
        </Pressable>
        <Text style={styles.time}>{formatStudioDuration(take.end - take.start)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar ao início do take" style={styles.control} onPress={() => { player.currentTime = take.start; }}><RotateCcw size={17} color={colors.muted} strokeWidth={1.6} /></Pressable>
      </View>
      {takes.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="Assistir montagem completa" onPress={playMontage} style={{ alignSelf: 'center', minHeight: 40, justifyContent: 'center' }}><Text style={{ color: colors.textSecondary, fontSize: 12 }}>Assistir montagem completa · {takes.length} takes</Text></Pressable> : null}
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  canvas: { width: '100%', borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 14 },
  placeholderText: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  failure: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: colors.surface },
  previewBadge: { position: 'absolute', top: 10, left: 10, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 7, backgroundColor: 'rgba(0,0,0,0.65)' },
  previewBadgeText: { fontSize: 10, color: colors.textSecondary, fontWeight: '500' },
  playback: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  control: { width: 38, height: 40, alignItems: 'center', justifyContent: 'center' },
  time: { color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
  progressTouch: { flex: 1, height: 40, justifyContent: 'center', paddingHorizontal: 4 },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  progress: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
});

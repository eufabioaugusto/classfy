import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Mic, RotateCcw, Video } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { timelineDuration, type StudioKind, type StudioTake } from './model';
import { locateStudioTime, studioPreviewSourceTime } from './timeline';
import { replaceStudioPreviewSource } from './videoSourceReady';

export type StudioPlaybackState = { position: number; sourcePosition: number; playing: boolean; loading: boolean; takeId?: string };
export type StudioPreviewHandle = { togglePlayback: () => void; pause: () => void; seek: (seconds: number) => void };

// Playback positions belong to the editor session. Only cuts and take order are
// saved, so native timeUpdate events never trigger project writes.
export const StudioPreview = forwardRef<StudioPreviewHandle, {
  takes: readonly StudioTake[]; kind: StudioKind; activeTakeId?: string;
  onActiveTakeChange?: (id: string) => void; onPlaybackState?: (state: StudioPlaybackState) => void;
  onCanvasPress?: () => void; paused?: boolean;
}>(function StudioPreview({ takes, kind, activeTakeId, onActiveTakeChange, onPlaybackState, onCanvasPress, paused = false }, ref) {
  const [takeId, setTakeId] = useState(activeTakeId || takes[0]?.id);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const take = takes.find(item => item.id === takeId) || takes[0];
  const live = useRef({ takes, take, paused, onActiveTakeChange, onPlaybackState });
  live.current = { takes, take, paused, onActiveTakeChange, onPlaybackState };
  const focused = useRef(false);
  const moving = useRef(false);
  const autoplay = useRef(false);
  const intendedPlayback = useRef(false);
  const loadedUri = useRef<string | null>(null);
  const seeking = useRef<{ target: number; deadline: number } | null>(null);
  const pendingSeek = useRef<{ takeId: string; seconds: number } | null>(null);
  const replacements = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const failure = useRef(false);
  const player = useVideoPlayer(null, instance => {
    instance.timeUpdateEventInterval = 0.1;
    instance.audioMixingMode = 'doNotMix';
    instance.staysActiveInBackground = false;
  });
  const publish = useCallback((sourceSeconds?: number) => {
    const current = live.current;
    const source = sourceSeconds ?? seeking.current?.target ?? player.currentTime;
    const index = current.takes.findIndex(item => item.id === current.take?.id);
    const before = timelineDuration(current.takes.slice(0, Math.max(0, index)));
    const local = current.take ? Math.max(0, Math.min(current.take.end - current.take.start, source - current.take.start)) : 0;
    current.onPlaybackState?.({ position: before + local, sourcePosition: source, takeId: current.take?.id,
      playing: player.playing, loading: moving.current });
  }, [player]);
  const pause = useCallback(() => {
    autoplay.current = false;
    intendedPlayback.current = false;
    try { player.pause(); } catch { /* Native shared object may already be released. */ }
  }, [player]);
  const seek = useCallback((seconds: number) => {
    const location = locateStudioTime(live.current.takes, seconds);
    if (!location) return;
    pause();
    pendingSeek.current = { takeId: location.takeId, seconds: location.sourceSeconds };
    if (location.takeId !== live.current.take?.id) {
      moving.current = true;
      setTakeId(location.takeId);
      live.current.onActiveTakeChange?.(location.takeId);
    } else if (!moving.current) {
      player.currentTime = location.sourceSeconds;
      seeking.current = { target: location.sourceSeconds, deadline: Date.now() + 1500 };
      pendingSeek.current = null;
      publish(location.sourceSeconds);
    }
  }, [pause, player, publish]);
  useImperativeHandle(ref, () => ({ pause, seek, togglePlayback: () => {
    if (player.playing) { pause(); return; }
    const current = live.current;
    if (!current.take || current.paused || moving.current || failure.current || !focused.current) return;
    if ((seeking.current?.target ?? player.currentTime) >= current.take.end - 0.04) {
      const index = current.takes.findIndex(item => item.id === current.take?.id);
      const next = current.takes[index + 1] || current.takes[0];
      pendingSeek.current = { takeId: next.id, seconds: next.start };
      if (next.id !== current.take.id) {
        intendedPlayback.current = true; autoplay.current = true; moving.current = true; setTakeId(next.id); current.onActiveTakeChange?.(next.id); return;
      }
      player.currentTime = next.start; seeking.current = { target: next.start, deadline: Date.now() + 1500 }; pendingSeek.current = null;
    }
    intendedPlayback.current = true;
    player.play();
  } }), [pause, seek, player]);
  useEffect(() => {
    const selected = takes.find(item => item.id === activeTakeId);
    if (selected && selected.id !== take?.id) {
      pause(); pendingSeek.current = { takeId: selected.id, seconds: selected.start }; setTakeId(selected.id);
    }
  }, [activeTakeId, take?.id, takes, pause]);
  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    let cancelLoad: (() => void) | undefined;
    try { player.pause(); } catch { /* Released shared object. */ }
    moving.current = true; setLoading(true); failure.current = false; setFailed(false);
    const id = take?.id;
    const uri = take?.uri;
    publish(studioPreviewSourceTime(take, pendingSeek.current));
    replacements.current = replacements.current.catch(() => undefined).then(async () => {
      if (!active || request !== generation.current) return;
      if (loadedUri.current !== (uri || null) || player.status !== 'readyToPlay') {
        loadedUri.current = null;
        const loadingSource = replaceStudioPreviewSource(player, uri || null, () => active && request === generation.current);
        cancelLoad = loadingSource.cancel;
        try { await loadingSource.promise; }
        finally { await loadingSource.settled; }
        loadedUri.current = uri || null;
      }
      if (!active || request !== generation.current) return;
      const latest = live.current.take;
      if (latest?.id !== id || latest?.uri !== uri) return;
      const pending = pendingSeek.current;
      let target = 0;
      if (latest) {
        target = studioPreviewSourceTime(latest, pending);
        player.currentTime = target;
        seeking.current = { target, deadline: Date.now() + 1500 };
      }
      pendingSeek.current = null; moving.current = false; setLoading(false);
      publish(target);
      if (autoplay.current && intendedPlayback.current && focused.current && !live.current.paused && AppState.currentState === 'active') player.play();
      autoplay.current = false;
    }).catch(() => {
      if (active && request === generation.current) { moving.current = false; failure.current = true; setLoading(false); setFailed(true); publish(); }
    });
    return () => { active = false; cancelLoad?.(); };
  }, [player, take?.id, take?.uri, retry, publish]);
  useEffect(() => {
    if (!take || moving.current) return;
    if (player.currentTime < take.start || player.currentTime > take.end) {
      pause(); player.currentTime = take.start; seeking.current = { target: take.start, deadline: Date.now() + 1500 };
    }
    publish();
  }, [take?.start, take?.end, takes, player, pause, publish]);
  useEffect(() => { if (paused) pause(); }, [paused, pause]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; pause(); };
  }, [pause]));
  useEffect(() => {
    const advance = (nativeEnd = false) => {
      const current = live.current;
      if (!current.take || moving.current || !intendedPlayback.current || !focused.current || current.paused || AppState.currentState !== 'active' || (!nativeEnd && !player.playing)) return;
      const index = current.takes.findIndex(item => item.id === current.take?.id);
      const next = current.takes[index + 1];
      player.pause();
      if (next) {
        moving.current = true; autoplay.current = true;
        pendingSeek.current = { takeId: next.id, seconds: next.start };
        setTakeId(next.id); current.onActiveTakeChange?.(next.id);
      } else { autoplay.current = false; intendedPlayback.current = false; publish(current.take.end); }
    };
    const subscriptions = [
      player.addListener('playingChange', () => { if (!moving.current) publish(); }),
      player.addListener('statusChange', event => { if (event.status === 'error' && !moving.current) { failure.current = true; setFailed(true); } }),
      player.addListener('timeUpdate', event => {
        if (moving.current) return;
        if (seeking.current) {
          if (Math.abs(event.currentTime - seeking.current.target) <= 0.2 || Date.now() > seeking.current.deadline) seeking.current = null;
          else return;
        }
        publish(event.currentTime);
        const current = live.current;
        if (current.take && event.currentTime >= current.take.end - 0.04) advance();
      }),
      player.addListener('playToEnd', () => advance(true)),
      AppState.addEventListener('change', state => { if (state !== 'active') pause(); }),
    ];
    return () => { subscriptions.forEach(subscription => { try { subscription.remove(); } catch { /* Released native emitter. */ } }); };
  }, [player, pause, publish]);
  return <View style={styles.canvas}>
    {take && kind !== 'podcast' ? <VideoView style={StyleSheet.absoluteFillObject} player={player} nativeControls={false} contentFit="contain" fullscreenOptions={{ enable: false }} allowsPictureInPicture={false} /> : <View style={styles.placeholder}>
      {kind === 'podcast' ? <Mic size={56} color={take ? colors.text : colors.mutedDim} strokeWidth={1.1} /> : <Video size={40} color={colors.mutedDim} strokeWidth={1.1} />}
      <Text style={styles.placeholderTitle}>{take ? 'Sua voz em primeiro plano' : 'Comece pelo primeiro take'}</Text>
      <Text style={styles.placeholderText}>{take ? 'Podcast · áudio original' : 'Grave ou importe para montar seu conteúdo.'}</Text>
    </View>}
    <Pressable style={StyleSheet.absoluteFillObject} accessibilityRole="button" accessibilityLabel="Mostrar ou ocultar ferramentas do editor" onPress={onCanvasPress} />
    {loading && take ? <View pointerEvents="none" style={styles.loading}><ActivityIndicator size="small" color={colors.muted} /></View> : null}
    {failed ? <View style={styles.failure}><Text style={styles.placeholderText}>Não foi possível reproduzir este take.</Text><Pressable accessibilityRole="button" accessibilityLabel="Tentar reproduzir novamente" onPress={() => setRetry(value => value + 1)} style={styles.retry}><RotateCcw size={18} color={colors.text} /><Text style={styles.placeholderText}>Tentar novamente</Text></Pressable></View> : null}
  </View>;
});
const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: colors.background },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  placeholderTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  placeholderText: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  failure: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: colors.background },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  retry: { minHeight: 44, flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 18, borderRadius: 12, backgroundColor: colors.surface },
});

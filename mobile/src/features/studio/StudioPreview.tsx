import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Mic, RotateCcw, Video } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { timelineDuration, type StudioKind, type StudioTake } from './model';
import { locateStudioTime, studioPreviewBoundedSourceTime, studioPreviewSourceTime } from './timeline';
import { studioSourceFrame, type StudioSourceFrame } from './editorInteraction';
import { replaceStudioPreviewSource } from './videoSourceReady';

export type StudioPlaybackState = { position: number; sourcePosition: number; playing: boolean; loading: boolean; takeId?: string };
export type StudioPreviewHandle = { togglePlayback: () => void; pause: () => void; seek: (seconds: number, source?: StudioSourceFrame) => void; previewSourceFrame: (source: StudioSourceFrame) => void };

// Playback positions belong to the editor session. Only cuts and take order are
// saved, so native timeUpdate events never trigger project writes.
export const StudioPreview = forwardRef<StudioPreviewHandle, {
  takes: readonly StudioTake[]; kind: StudioKind; activeTakeId?: string;
  onActiveTakeChange?: (id: string) => void; onPlaybackState?: (state: StudioPlaybackState) => void;
  onCanvasPress?: () => void; canvasLabel?: string; paused?: boolean; muted?: boolean;
}>(function StudioPreview({ takes, kind, activeTakeId, onActiveTakeChange, onPlaybackState, onCanvasPress, canvasLabel = 'Mostrar ou ocultar ferramentas do editor', paused = false, muted = false }, ref) {
  const [takeId, setTakeId] = useState(activeTakeId || takes[0]?.id);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [sourceRequest, setSourceRequest] = useState(0);
  const [frameSource, setFrameSource] = useState<Pick<StudioSourceFrame, 'takeId' | 'uri'> | null>(null);
  const sourceFrame = useRef<StudioSourceFrame | null>(null);
  const take = takes.find(item => item.id === takeId) || takes[0];
  const displayTake = frameSource ? takes.find(item => item.id === frameSource.takeId && item.uri === frameSource.uri) : take;
  const live = useRef({ takes, take, paused, onActiveTakeChange, onPlaybackState });
  live.current = { takes, take, paused, onActiveTakeChange, onPlaybackState };
  const focused = useRef(false);
  const moving = useRef(false);
  const autoplay = useRef(false);
  const intendedPlayback = useRef(false);
  const loadedUri = useRef<string | null>(null);
  const seeking = useRef<{ takeId: string; uri: string; target: number; deadline: number } | null>(null);
  const pendingSeek = useRef<{ takeId: string; seconds: number } | null>(null);
  const replacements = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const failure = useRef(false);
  const player = useVideoPlayer(null, instance => {
    instance.timeUpdateEventInterval = 0.1;
    instance.audioMixingMode = 'doNotMix';
    instance.staysActiveInBackground = false;
  });
  useEffect(() => { try { player.muted = muted; } catch { /* Player was released. */ } }, [player, muted]);
  const publish = useCallback((sourceSeconds?: number) => {
    if (sourceFrame.current) return;
    const current = live.current;
    const pending = seeking.current;
    const source = sourceSeconds ?? (pending?.takeId === current.take?.id && pending?.uri === current.take?.uri ? pending?.target : undefined) ?? player.currentTime;
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
  const seek = useCallback((seconds: number, requestedSource?: StudioSourceFrame) => {
    const requestedTake = requestedSource ? live.current.takes.find(item => item.id === requestedSource.takeId && item.uri === requestedSource.uri) : undefined;
    const location = requestedTake && requestedSource && Number.isFinite(requestedSource.seconds)
      ? { take: requestedTake, takeId: requestedTake.id, sourceSeconds: studioPreviewBoundedSourceTime(requestedTake, requestedSource.seconds, null) }
      : locateStudioTime(live.current.takes, seconds);
    if (!location) return;
    const restoringFrame = sourceFrame.current !== null;
    if (restoringFrame) { moving.current = true; setSourceRequest(value => value + 1); }
    sourceFrame.current = null; setFrameSource(null);
    pause();
    pendingSeek.current = { takeId: location.takeId, seconds: location.sourceSeconds };
    if (restoringFrame || location.takeId !== live.current.take?.id) {
      moving.current = true;
      setTakeId(location.takeId);
      if (location.takeId !== live.current.take?.id) live.current.onActiveTakeChange?.(location.takeId);
      if (location.takeId === live.current.take?.id && location.take.uri === live.current.take.uri) publish(location.sourceSeconds);
    } else if (!moving.current) {
      player.currentTime = location.sourceSeconds;
      seeking.current = { takeId: location.takeId, uri: location.take.uri, target: location.sourceSeconds, deadline: Date.now() + 1500 };
      pendingSeek.current = null;
      publish(location.sourceSeconds);
    }
  }, [pause, player, publish]);
  const previewSourceFrame = useCallback((requested: StudioSourceFrame) => {
    const frame = studioSourceFrame(live.current.takes, requested);
    if (!frame) return;
    const beginning = sourceFrame.current === null;
    sourceFrame.current = frame;
    if (beginning) { pause(); setSourceRequest(value => value + 1); }
    setFrameSource(previous => previous?.takeId === frame.takeId && previous.uri === frame.uri ? previous : { takeId: frame.takeId, uri: frame.uri });
    if (!moving.current && loadedUri.current === frame.uri && player.status === 'readyToPlay') player.currentTime = frame.seconds;
  }, [pause, player]);
  useImperativeHandle(ref, () => ({ pause, seek, previewSourceFrame, togglePlayback: () => {
    if (sourceFrame.current) return;
    if (player.playing) { pause(); return; }
    const current = live.current;
    if (!current.take || current.paused || moving.current || failure.current || !focused.current) return;
    const pending = seeking.current;
    const source = pending?.takeId === current.take.id && pending.uri === current.take.uri ? pending.target : player.currentTime;
    if (source >= current.take.end - 0.04) {
      const index = current.takes.findIndex(item => item.id === current.take?.id);
      const next = current.takes[index + 1] || current.takes[0];
      pendingSeek.current = { takeId: next.id, seconds: next.start };
      if (next.id !== current.take.id) {
        intendedPlayback.current = true; autoplay.current = true; moving.current = true; setTakeId(next.id); current.onActiveTakeChange?.(next.id); return;
      }
      player.currentTime = next.start; seeking.current = { takeId: next.id, uri: next.uri, target: next.start, deadline: Date.now() + 1500 }; pendingSeek.current = null;
    }
    intendedPlayback.current = true;
    player.play();
  } }), [pause, seek, previewSourceFrame, player]);
  useEffect(() => {
    if (sourceFrame.current) return;
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
    const id = displayTake?.id;
    const uri = displayTake?.uri;
    const frameMode = frameSource !== null;
    const isCurrentSource = () => {
      if (!active || request !== generation.current) return false;
      const frame = sourceFrame.current;
      return frameMode ? !!frame && frame.takeId === id && frame.uri === uri : !frame && live.current.take?.id === id && live.current.take?.uri === uri;
    };
    if (!frameMode) publish(studioPreviewSourceTime(take, pendingSeek.current));
    replacements.current = replacements.current.catch(() => undefined).then(async () => {
      if (!isCurrentSource()) return;
      if (loadedUri.current !== (uri || null) || player.status !== 'readyToPlay') {
        loadedUri.current = null;
        const loadingSource = replaceStudioPreviewSource(player, uri || null, isCurrentSource);
        cancelLoad = loadingSource.cancel;
        try { await loadingSource.promise; }
        finally { await loadingSource.settled; }
        loadedUri.current = uri || null;
      }
      if (!isCurrentSource()) return;
      if (frameMode) {
        const frame = sourceFrame.current;
        if (!frame) return;
        player.currentTime = frame.seconds;
        moving.current = false; setLoading(false);
        return;
      }
      const latest = live.current.take;
      if (latest?.id !== id || latest?.uri !== uri) return;
      const pending = pendingSeek.current;
      let target = 0;
      if (latest) {
        target = studioPreviewSourceTime(latest, pending);
        player.currentTime = target;
        seeking.current = { takeId: latest.id, uri: latest.uri, target, deadline: Date.now() + 1500 };
      }
      pendingSeek.current = null; moving.current = false; setLoading(false);
      publish(target);
      if (autoplay.current && intendedPlayback.current && focused.current && !live.current.paused && AppState.currentState === 'active') player.play();
      autoplay.current = false;
    }).catch(() => {
      if (active && request === generation.current) { moving.current = false; failure.current = true; setLoading(false); setFailed(true); publish(); }
    });
    return () => { active = false; cancelLoad?.(); };
  }, [player, displayTake?.id, displayTake?.uri, !!frameSource, sourceRequest, retry, publish]);
  useEffect(() => {
    if (!take || moving.current || sourceFrame.current) return;
    const pending = seeking.current;
    const ownSeek = pending?.takeId === take.id && pending.uri === take.uri ? pending : null;
    const nativeSeconds = player.currentTime;
    const source = ownSeek?.target ?? nativeSeconds;
    const target = studioPreviewBoundedSourceTime(take, nativeSeconds, ownSeek ? { takeId: ownSeek.takeId, seconds: ownSeek.target } : null);
    if (!Number.isFinite(source) || target !== source) {
      pause(); player.currentTime = target;
      seeking.current = { takeId: take.id, uri: take.uri, target, deadline: Date.now() + 1500 };
    }
    publish(target);
  }, [take?.start, take?.end, takes, player, pause, publish]);
  useEffect(() => { if (paused) pause(); }, [paused, pause]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; pause(); };
  }, [pause]));
  useEffect(() => {
    const advance = (nativeEnd = false) => {
      const current = live.current;
      if (!current.take || moving.current || sourceFrame.current || !intendedPlayback.current || !focused.current || current.paused || AppState.currentState !== 'active' || (!nativeEnd && !player.playing)) return;
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
        if (moving.current || sourceFrame.current) return;
        const current = live.current;
        if (seeking.current && (seeking.current.takeId !== current.take?.id || seeking.current.uri !== current.take?.uri)) seeking.current = null;
        if (seeking.current) {
          if (Math.abs(event.currentTime - seeking.current.target) <= 0.2 || Date.now() > seeking.current.deadline) seeking.current = null;
          else return;
        }
        publish(event.currentTime);
        if (current.take && event.currentTime >= current.take.end - 0.04) advance();
      }),
      player.addListener('playToEnd', () => advance(true)),
      AppState.addEventListener('change', state => { if (state !== 'active') pause(); }),
    ];
    return () => { subscriptions.forEach(subscription => { try { subscription.remove(); } catch { /* Released native emitter. */ } }); };
  }, [player, pause, publish]);
  return <View style={styles.canvas}>
    {displayTake && kind !== 'podcast' ? <VideoView style={StyleSheet.absoluteFillObject} player={player} nativeControls={false} contentFit="contain" fullscreenOptions={{ enable: false }} allowsPictureInPicture={false} /> : <View style={styles.placeholder}>
      {kind === 'podcast' ? <Mic size={56} color={take ? colors.text : colors.mutedDim} strokeWidth={1.1} /> : <Video size={40} color={colors.mutedDim} strokeWidth={1.1} />}
      <Text style={styles.placeholderTitle}>{take ? 'Sua voz em primeiro plano' : 'Comece pelo primeiro take'}</Text>
      <Text style={styles.placeholderText}>{take ? 'Podcast · áudio original' : 'Grave ou importe para montar seu conteúdo.'}</Text>
    </View>}
    <Pressable style={StyleSheet.absoluteFillObject} accessibilityRole="button" accessibilityLabel={canvasLabel} onPress={onCanvasPress} />
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

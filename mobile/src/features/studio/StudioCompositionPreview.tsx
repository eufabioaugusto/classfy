import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { findNodeHandle, StyleSheet, Text, View } from 'react-native';
import Animated, { runOnJS, runOnUI, useAnimatedProps, useEvent, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { requireNativeViewManager } from 'expo-modules-core';
import { getStudioInteractiveCompositionVersionAsync, isStudioCompositionAvailable, isStudioInteractiveCompositionAvailable, previewStudioCompositionSourceAsync, seekStudioCompositionAsync, type StudioNativePlayback } from '../../../modules/classfy-studio-media';
import { compileStudioRecipe, type StudioProject, type StudioRenderRecipe } from './model';
import { StudioPreview, type StudioPlaybackState, type StudioPreviewHandle } from './StudioPreview';
import type { StudioTimelinePlaybackChannelRef } from './timelinePlaybackChannel';
import type { StudioCanvasTransformChannelRef } from './canvasTransformChannel';

type Props = {
  project: StudioProject; recipe?: StudioRenderRecipe; activeTakeId?: string; paused?: boolean; before?: boolean;
  onActiveTakeChange?: (id: string) => void; onPlaybackState?: (state: StudioPlaybackState) => void;
  onCanvasPress?: () => void; canvasLabel?: string;
  playbackChannel?: StudioTimelinePlaybackChannelRef;
  canvasTransformChannel?: StudioCanvasTransformChannelRef;
};
type NativeError = { message: string; code?: string; revision: string; token: number };
type NativeProps = { ref?: React.Ref<unknown>; recipeJSON: string; revision: string; paused: boolean; style: object; liveVisualJSON?: string;
  onPlaybackState: (event: { nativeEvent: StudioNativePlayback }) => void;
  onError: (event: { nativeEvent: NativeError }) => void;
};
const NativeCanvas = isStudioCompositionAvailable() ? requireNativeViewManager<NativeProps>('ClassfyStudioMedia', 'StudioCompositionView') : null;
const AnimatedNativeCanvas = NativeCanvas ? Animated.createAnimatedComponent(NativeCanvas) : null;
type PlaybackControls = {
  mounted: boolean; revision: string; minToken: number; intendedPaused: boolean;
  pendingPlay: boolean; transient: boolean; externalPaused: boolean; intentSequence: number;
  pendingSeek: { token: number; target: number } | null;
};

function stopPlaybackChannel(channel?: StudioTimelinePlaybackChannelRef, position?: number, loading = false) {
  'worklet';
  if (!channel) return;
  channel.value = { ...channel.value, sequence: channel.value.sequence + 1,
    position: position !== undefined && Number.isFinite(position) ? Math.max(0, position) : channel.value.position,
    playing: false, loading };
}

function receivePlaybackOnUI(value: StudioNativePlayback, controls: SharedValue<PlaybackControls>, channel: StudioTimelinePlaybackChannelRef) {
  'worklet';
  let intent = controls.value;
  if (!intent.mounted || !channel.value.active || value.revision !== intent.revision || value.token < intent.minToken || intent.transient
      || !Number.isFinite(value.positionSeconds) || value.playing && (intent.intendedPaused || intent.externalPaused)) return false;
  // claim() changes the native command token before await seekPlayer(). A
  // periodic event can therefore have the new token but the old position.
  if (intent.pendingSeek) {
    if (value.token === intent.pendingSeek.token && Math.abs(value.positionSeconds - intent.pendingSeek.target) > 0.05) return false;
    intent = { ...intent, pendingSeek: null }; controls.value = intent;
  }
  // Still forward this refused/old pause to JS, which owns the existing
  // bounded Play deadline. It must not replace the UI clock's latest sample.
  if (intent.pendingPlay && !intent.externalPaused && !value.playing && !value.loading) return 'pending';
  if (value.playing) controls.value = { ...intent, pendingPlay: false };
  else if (!value.loading) controls.value = { ...intent, intendedPaused: true, pendingPlay: false };
  channel.value = { active: true, sequence: channel.value.sequence + 1,
    position: Math.max(0, value.positionSeconds), playing: value.playing && !intent.externalPaused,
    loading: value.loading };
  return 'accepted';
}

export const StudioCompositionPreview = forwardRef<StudioPreviewHandle, Props>(function StudioCompositionPreview(props, ref) {
  const editing = props.project.editing;
  const native = !!NativeCanvas && editing?.output.profile === 'standard' && props.project.kind !== 'podcast';
  useLayoutEffect(() => {
    const channel = props.playbackChannel;
    if (!native && channel) runOnUI(() => {
      'worklet'; stopPlaybackChannel(channel); channel.value = { ...channel.value, active: false };
    })();
  }, [native, props.playbackChannel]);
  const enhanced = !!editing && (editing.mainMuted === true && props.project.kind !== 'podcast' || editing.layers.some(layer => layer.items.length) || editing.main.some(clip => clip.rect || clip.rotationDegrees || clip.fit === 'cover' || clip.grade || clip.effect && clip.effect !== 'natural' || clip.gain !== undefined && clip.gain !== 1) || editing.canvas.backgroundColor !== '#000000' || editing.canvas.aspectRatio !== (props.project.kind === 'short' ? 'portrait' : 'landscape'));
  if (enhanced && (!NativeCanvas || editing?.output.profile !== 'standard' || props.project.kind === 'podcast')) return <UnavailablePreview ref={ref} />;
  if (!NativeCanvas || editing?.output.profile !== 'standard' || props.project.kind === 'podcast') return <StudioPreview ref={ref} takes={props.project.takes} kind={props.project.kind} activeTakeId={props.activeTakeId} paused={props.paused} muted={editing?.mainMuted === true} onActiveTakeChange={props.onActiveTakeChange} onPlaybackState={props.onPlaybackState} onCanvasPress={props.onCanvasPress} canvasLabel={props.canvasLabel} />;
  return <NativePreview {...props} ref={ref} />;
});
const UnavailablePreview = forwardRef<StudioPreviewHandle>(function UnavailablePreview(_, ref) {
  useImperativeHandle(ref, () => ({ pause() {}, togglePlayback() {}, seek() {}, previewSourceFrame() {} }), []);
  return <View style={[styles.canvas, { justifyContent: 'center', padding: 20 }]}><Text style={styles.text}>Esta montagem usa camadas e tratamentos. Atualize o Classfy Dev para visualizar e exportar a edição completa.</Text></View>;
});
const NativePreview = forwardRef<StudioPreviewHandle, Props>(function NativePreview(props, ref) {
  const canvas = useRef(null);
  const [paused, setPaused] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const errorCode = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const live = useRef(props); live.current = props;
  const token = useRef(0);
  const transient = useRef(false);
  const position = useRef(0);
  const intendedPaused = useRef(true);
  const intentSequence = useRef(0);
  const pendingSeek = useRef<PlaybackControls['pendingSeek']>(null);
  const playback = useRef<StudioPlaybackState>({ position: 0, sourcePosition: 0, playing: false, loading: false });
  const pendingPlay = useRef<{ timer?: ReturnType<typeof setTimeout> } | null>(null);
  const controls = useSharedValue<PlaybackControls>({ mounted: false, revision: '', minToken: 0,
    intendedPaused: true, pendingPlay: false, transient: false, externalPaused: !!props.paused, intentSequence: 0, pendingSeek: null });
  const transformChannel = isStudioInteractiveCompositionAvailable() ? props.canvasTransformChannel : undefined;
  useEffect(() => {
    if (!transformChannel) return;
    let current = true;
    void getStudioInteractiveCompositionVersionAsync().then(value => {
      if (!current) return;
      runOnUI(() => { 'worklet'; transformChannel.value = { ...transformChannel.value, available: value.available && value.version === 1 }; })();
    }).catch(() => { /* Old/unsupported binaries retain the existing preview. */ });
    return () => { current = false; runOnUI(() => {
      'worklet'; transformChannel.value = { ...transformChannel.value, available: false, active: false,
        phase: 'idle', finish: 'cancel', sequence: transformChannel.value.sequence + 1 };
    })(); };
  }, [transformChannel]);
  const liveVisualProps = useAnimatedProps<NativeProps>(() => {
    'worklet';
    if (!transformChannel) return {};
    return { liveVisualJSON: JSON.stringify({ version: 1, revision: controls.value.revision, ...transformChannel.value }) };
  });
  // The editor already compiled the visible document. Reuse it and send the
  // JSON once; an opaque revision must not echo a whole lesson in every event.
  const compiled = useMemo(() => props.recipe || compileStudioRecipe(props.project), [props.recipe, props.project.editing, props.project.kind, props.project.takes]);
  const duration = useRef(0); duration.current = Math.max(0, compiled.durationTicks / compiled.timebase);
  const recipe = useMemo(() => JSON.stringify(props.before ? { ...compiled, clips: compiled.clips.map(clip => ({ ...clip, effect: 'natural', grade: { preset: 'natural', intensity: 0, exposure: 0, contrast: 0, saturation: 0, temperature: 0 } })) } : compiled), [compiled, props.before]);
  const revisionSequence = useRef({ recipe: '', projectId: '', value: 0 });
  if (revisionSequence.current.recipe !== recipe || revisionSequence.current.projectId !== props.project.id) {
    revisionSequence.current = { recipe, projectId: props.project.id, value: revisionSequence.current.value + 1 };
  }
  const revision = `${props.project.id}:${revisionSequence.current.value}`;
  const currentRevision = useRef(revision); currentRevision.current = revision;
  const lastSyncedRevision = useRef(revision);
  const channel = props.playbackChannel;
  const previousChannel = useRef(channel);
  const rebuildEvents = previousChannel.current !== channel; previousChannel.current = channel;
  useEffect(() => { errorCode.current = undefined; setError(null); }, [revision]);
  const clearPendingPlay = () => {
    if (pendingPlay.current?.timer !== undefined) clearTimeout(pendingPlay.current.timer);
    pendingPlay.current = null;
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pendingSeek.current = null; clearPendingPlay(); };
  }, []);
  const updateUI = (patch: Partial<PlaybackControls>, nextPosition?: number, freeze = false, loading = false) => {
    const destination = live.current.playbackChannel;
    runOnUI((next: Partial<PlaybackControls>, anchor?: number, stop: boolean = false, preparing: boolean = false) => {
      'worklet'; controls.value = { ...controls.value, ...next };
      if (stop) stopPlaybackChannel(destination, anchor, preparing);
    })(patch, nextPosition, freeze, loading);
  };
  useLayoutEffect(() => {
    const snapshot = { mounted: true, revision: currentRevision.current, minToken: token.current,
      intendedPaused: intendedPaused.current, pendingPlay: !!pendingPlay.current,
      transient: transient.current, externalPaused: !!live.current.paused, intentSequence: intentSequence.current, pendingSeek: pendingSeek.current };
    runOnUI(() => {
      'worklet'; controls.value = snapshot;
      if (channel) { stopPlaybackChannel(channel); channel.value = { ...channel.value, active: true }; }
    })();
    return () => runOnUI(() => {
      'worklet'; controls.value = { ...controls.value, mounted: false, intendedPaused: true, pendingPlay: false, pendingSeek: null };
      if (channel) { stopPlaybackChannel(channel); channel.value = { ...channel.value, active: false }; }
    })();
  }, [channel]);
  const pausePlayback = () => {
    // Prop delivery and native events are asynchronous. Stop the editor clock
    // now; a previously queued playing event cannot undo this local intent.
    clearPendingPlay(); intendedPaused.current = true; setPaused(true);
    updateUI({ intendedPaused: true, pendingPlay: false, intentSequence: ++intentSequence.current }, undefined, true);
    if (playback.current.playing) {
      const stopped = { ...playback.current, playing: false };
      playback.current = stopped;
      live.current.onPlaybackState?.(stopped);
    }
  };
  useLayoutEffect(() => {
    if (props.paused) pausePlayback();
    const revisionChanged = lastSyncedRevision.current !== revision;
    lastSyncedRevision.current = revision;
    if (revisionChanged) pendingSeek.current = null;
    // A native acknowledgement may already have reached UI while JS is still
    // queued. Recipe/prop delivery must not restore its older pending intent.
    updateUI({ revision, minToken: token.current, externalPaused: !!props.paused,
      ...(revisionChanged ? { pendingSeek: null } : {}) },
      undefined, true, !props.paused && !!channel);
  }, [revision, props.paused]);
  const accept = (value: StudioNativePlayback, fromUI = false, confirmedUI = false, expectedIntent?: number) => {
    if (!mounted.current || value.revision !== currentRevision.current || value.token < token.current
        || expectedIntent !== undefined && expectedIntent !== intentSequence.current) return;

    if (transient.current) return;
    if (value.playing && (intendedPaused.current || live.current.paused)) return;
    // The UI may have confirmed a seek while its earlier JS ACK was queued.
    // A newer Play supersedes that ACK's intent, but the current accepted UI
    // sample still proves that pendingSeek has already been resolved there.
    if (fromUI && confirmedUI) pendingSeek.current = null;
    if (pendingSeek.current) {
      if (value.token === pendingSeek.current.token && Math.abs(value.positionSeconds - pendingSeek.current.target) > 0.05) return;
      pendingSeek.current = null;
    }
    // UI can acknowledge Play while its JS callback is still queued (or was
    // superseded by a recipe revision). Its subsequent EOF is authoritative.
    if (fromUI && confirmedUI && !value.playing && !value.loading) clearPendingPlay();
    if (pendingPlay.current) {
      if (live.current.paused) { pausePlayback(); }
      else if (value.playing) { clearPendingPlay(); }
      else if (value.loading) {
        // A known build/replay is still progressing; it is not a failed Play.
        if (pendingPlay.current.timer !== undefined) clearTimeout(pendingPlay.current.timer);
        pendingPlay.current.timer = undefined;
      } else {
        // Play has no command token in older binaries. A paused event already
        // queued before the touch cannot cancel it before its first playing
        // acknowledgement. Native capture/foreground guards can also refuse
        // Play without onError, so bound that unconfirmed refusal only.
        const request = pendingPlay.current;
        if (request.timer === undefined) request.timer = setTimeout(() => {
          if (pendingPlay.current !== request) return;
          pausePlayback(); errorCode.current = 'E_STUDIO_PLAY_UNCONFIRMED';
          setError('A prévia não iniciou. Toque em reproduzir para tentar novamente.');
        }, 2000);
        return;
      }
    }
    // A successful playback confirms recovery of the shared audio session.
    // Periodic player events cannot dismiss a compositor/frame failure.
    if (value.playing && (errorCode.current === 'E_STUDIO_AUDIO_SESSION' || errorCode.current === 'E_STUDIO_PLAY_UNCONFIRMED')) { errorCode.current = undefined; setError(null); }
    position.current = value.positionSeconds;
    if (value.clipId) live.current.onActiveTakeChange?.(value.clipId);
    if (!value.playing && !value.loading) { intendedPaused.current = true; setPaused(true); }
    const state = { position: value.positionSeconds, sourcePosition: value.sourcePositionSeconds, takeId: value.clipId || undefined, playing: value.playing, loading: value.loading };
    playback.current = state;
    if (!fromUI && live.current.playbackChannel) {
      const destination = live.current.playbackChannel;
      runOnUI(() => { 'worklet'; receivePlaybackOnUI(value, controls, destination); })();
    }
    live.current.onPlaybackState?.(state);
  };
  const acceptError = (value: NativeError, expectedIntent?: number) => {
    if (mounted.current && value.revision === currentRevision.current && value.token >= token.current
        && (expectedIntent === undefined || expectedIntent === intentSequence.current)) {
      if (value.code === 'E_STUDIO_INTERACTION' && transformChannel) runOnUI(() => {
        'worklet'; transformChannel.value = { ...transformChannel.value, available: false,
          active: false, phase: 'idle', finish: 'cancel', sequence: transformChannel.value.sequence + 1 };
      })();
      pendingSeek.current = null; updateUI({ pendingSeek: null });
      pausePlayback(); errorCode.current = value.code; setError(value.message);
    }
  };
  // Expo Fabric dispatches the dictionary before React wraps it in nativeEvent.
  // Pass useEvent's holder directly to the animated host, never through a JS
  // arrow; otherwise Reanimated cannot register the native tag/event pair.
  const onUIPlayback = useEvent<StudioNativePlayback>(value => {
    'worklet';
    if (!channel) return;
    const result = receivePlaybackOnUI(value, controls, channel);
    if (result) runOnJS(accept)(value, true, result === 'accepted', controls.value.intentSequence);
  }, ['onPlaybackState'], rebuildEvents);
  const onUIError = useEvent<NativeError>(value => {
    'worklet';
    const intent = controls.value;
    if (!channel || !intent.mounted || !channel.value.active || value.revision !== intent.revision || value.token < intent.minToken) return;
    controls.value = { ...intent, intendedPaused: true, pendingPlay: false, pendingSeek: null };
    stopPlaybackChannel(channel); runOnJS(acceptError)(value, intent.intentSequence);
  }, ['onError'], rebuildEvents);
  const tag = () => { const value = findNodeHandle(canvas.current); if (!value) throw new Error('A prévia está preparando o vídeo.'); return value; };
  useImperativeHandle(ref, () => ({
    pause() { pausePlayback(); },
    togglePlayback() {
      transient.current = false;
      if (!intendedPaused.current) { pausePlayback(); return; }
      clearPendingPlay(); pendingPlay.current = {};
      intendedPaused.current = false; setPaused(false);
      updateUI({ intendedPaused: false, pendingPlay: true, transient: false, intentSequence: ++intentSequence.current }, undefined, true);
    },
    seek(seconds) {
      if (!Number.isFinite(seconds)) return;
      const target = Math.max(0, Math.min(seconds, Math.max(0, duration.current - 1 / 30)));
      transient.current = false; pausePlayback(); position.current = target;
      const request = ++token.current; const intentRevision = currentRevision.current;
      const expectedIntent = intentSequence.current;
      pendingSeek.current = { token: request, target };
      updateUI({ minToken: request, transient: false, pendingSeek: pendingSeek.current }, target, true);
      void seekStudioCompositionAsync(tag(), target, request).then(value => { if (mounted.current && request === token.current && intentRevision === currentRevision.current && expectedIntent === intentSequence.current) { pendingSeek.current = null; updateUI({ pendingSeek: null }); errorCode.current = undefined; setError(null); accept(value, false, false, expectedIntent); } }).catch(cause => { if (mounted.current && request === token.current && intentRevision === currentRevision.current && expectedIntent === intentSequence.current) { pendingSeek.current = null; updateUI({ pendingSeek: null }); errorCode.current = undefined; setError(cause instanceof Error ? cause.message : 'Não foi possível navegar no vídeo.'); } });
    },
    previewSourceFrame(source) {
      pausePlayback(); transient.current = true;
      pendingSeek.current = null;
      const request = ++token.current; const intentRevision = currentRevision.current;
      const expectedIntent = intentSequence.current;
      updateUI({ minToken: request, transient: true, pendingSeek: null }, undefined, true);
      void previewStudioCompositionSourceAsync(tag(), source.takeId, source.seconds, position.current, request).then(() => { if (mounted.current && request === token.current && intentRevision === currentRevision.current && expectedIntent === intentSequence.current) { errorCode.current = undefined; setError(null); } }).catch(cause => { if (mounted.current && request === token.current && intentRevision === currentRevision.current && expectedIntent === intentSequence.current) { errorCode.current = undefined; setError(cause instanceof Error ? cause.message : 'Não foi possível visualizar o corte.'); } });
    },
  }), []);
  return <View style={styles.canvas} accessibilityLabel={props.canvasLabel} onTouchEnd={props.onCanvasPress}>
    {(channel || transformChannel) && AnimatedNativeCanvas
      ? <AnimatedNativeCanvas ref={canvas} style={StyleSheet.absoluteFill} recipeJSON={recipe} revision={revision} paused={paused || !!props.paused}
        animatedProps={liveVisualProps} onPlaybackState={channel ? onUIPlayback as unknown as NativeProps['onPlaybackState'] : event => accept(event.nativeEvent)} onError={channel ? onUIError as unknown as NativeProps['onError'] : event => acceptError(event.nativeEvent)} />
      : NativeCanvas && <NativeCanvas ref={canvas} style={StyleSheet.absoluteFill} recipeJSON={recipe} revision={revision} paused={paused || !!props.paused} onPlaybackState={event => accept(event.nativeEvent)} onError={event => acceptError(event.nativeEvent)} />}
    {error && <View style={styles.message}><Text style={styles.text}>{error}</Text></View>}
  </View>;
});
const styles = StyleSheet.create({ canvas: { flex: 1, backgroundColor: '#000' }, message: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.75)' }, text: { color: '#FFF', fontSize: 12, textAlign: 'center' } });

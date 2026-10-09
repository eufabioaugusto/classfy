import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { findNodeHandle, StyleSheet, Text, View } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import { isStudioCompositionAvailable, previewStudioCompositionSourceAsync, seekStudioCompositionAsync, type StudioNativePlayback } from '../../../modules/classfy-studio-media';
import { compileStudioRecipe, type StudioProject, type StudioRenderRecipe } from './model';
import { StudioPreview, type StudioPlaybackState, type StudioPreviewHandle } from './StudioPreview';

type Props = {
  project: StudioProject; recipe?: StudioRenderRecipe; activeTakeId?: string; paused?: boolean; before?: boolean;
  onActiveTakeChange?: (id: string) => void; onPlaybackState?: (state: StudioPlaybackState) => void;
  onCanvasPress?: () => void; canvasLabel?: string;
};
type NativeProps = { ref?: React.Ref<unknown>; recipeJSON: string; revision: string; paused: boolean; style: object;
  onPlaybackState: (event: { nativeEvent: StudioNativePlayback }) => void;
  onError: (event: { nativeEvent: { message: string; code?: string; revision: string; token: number } }) => void;
};
const NativeCanvas = isStudioCompositionAvailable() ? requireNativeViewManager<NativeProps>('ClassfyStudioMedia', 'StudioCompositionView') : null;

export const StudioCompositionPreview = forwardRef<StudioPreviewHandle, Props>(function StudioCompositionPreview(props, ref) {
  const editing = props.project.editing;
  const enhanced = !!editing && (editing.layers.some(layer => layer.items.length) || editing.main.some(clip => clip.rect || clip.rotationDegrees || clip.fit === 'cover' || clip.grade || clip.effect && clip.effect !== 'natural' || clip.gain !== undefined && clip.gain !== 1) || editing.canvas.backgroundColor !== '#000000' || editing.canvas.aspectRatio !== (props.project.kind === 'short' ? 'portrait' : 'landscape'));
  if (enhanced && (!NativeCanvas || editing?.output.profile !== 'standard' || props.project.kind === 'podcast')) return <UnavailablePreview ref={ref} />;
  if (!NativeCanvas || editing?.output.profile !== 'standard' || props.project.kind === 'podcast') return <StudioPreview ref={ref} takes={props.project.takes} kind={props.project.kind} activeTakeId={props.activeTakeId} paused={props.paused} onActiveTakeChange={props.onActiveTakeChange} onPlaybackState={props.onPlaybackState} onCanvasPress={props.onCanvasPress} canvasLabel={props.canvasLabel} />;
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
  const live = useRef(props); live.current = props;
  const token = useRef(0);
  const transient = useRef(false);
  const position = useRef(0);
  const intendedPaused = useRef(true);
  const playback = useRef<StudioPlaybackState>({ position: 0, sourcePosition: 0, playing: false, loading: false });
  // The editor already compiled the visible document. Reuse it and send the
  // JSON once; an opaque revision must not echo a whole lesson in every event.
  const compiled = useMemo(() => props.recipe || compileStudioRecipe(props.project), [props.recipe, props.project.editing, props.project.kind, props.project.takes]);
  const recipe = useMemo(() => JSON.stringify(props.before ? { ...compiled, clips: compiled.clips.map(clip => ({ ...clip, effect: 'natural', grade: { preset: 'natural', intensity: 0, exposure: 0, contrast: 0, saturation: 0, temperature: 0 } })) } : compiled), [compiled, props.before]);
  const revisionSequence = useRef({ recipe: '', projectId: '', value: 0 });
  if (revisionSequence.current.recipe !== recipe || revisionSequence.current.projectId !== props.project.id) {
    revisionSequence.current = { recipe, projectId: props.project.id, value: revisionSequence.current.value + 1 };
  }
  const revision = `${props.project.id}:${revisionSequence.current.value}`;
  const currentRevision = useRef(revision); currentRevision.current = revision;
  useEffect(() => { errorCode.current = undefined; setError(null); }, [revision]);
  const pausePlayback = () => {
    // Prop delivery and native events are asynchronous. Stop the editor clock
    // now; a previously queued playing event cannot undo this local intent.
    intendedPaused.current = true; setPaused(true);
    if (playback.current.playing) {
      const stopped = { ...playback.current, playing: false };
      playback.current = stopped;
      live.current.onPlaybackState?.(stopped);
    }
  };
  const accept = (value: StudioNativePlayback) => {
    if (value.revision !== currentRevision.current || value.token < token.current) return;

    if (transient.current) return;
    if (value.playing && (intendedPaused.current || live.current.paused)) return;
    // A successful playback confirms recovery of the shared audio session.
    // Periodic player events cannot dismiss a compositor/frame failure.
    if (value.playing && errorCode.current === 'E_STUDIO_AUDIO_SESSION') { errorCode.current = undefined; setError(null); }
    position.current = value.positionSeconds;
    if (value.clipId) live.current.onActiveTakeChange?.(value.clipId);
    if (!value.playing && !value.loading) { intendedPaused.current = true; setPaused(true); }
    const state = { position: value.positionSeconds, sourcePosition: value.sourcePositionSeconds, takeId: value.clipId || undefined, playing: value.playing, loading: value.loading };
    playback.current = state;
    live.current.onPlaybackState?.(state);
  };
  const tag = () => { const value = findNodeHandle(canvas.current); if (!value) throw new Error('A prévia está preparando o vídeo.'); return value; };
  useImperativeHandle(ref, () => ({
    pause() { pausePlayback(); },
    togglePlayback() {
      transient.current = false;
      if (!intendedPaused.current) { pausePlayback(); return; }
      intendedPaused.current = false; setPaused(false);
    },
    seek(seconds) {
      transient.current = false; pausePlayback(); position.current = seconds;
      const request = ++token.current; const intentRevision = currentRevision.current;
      void seekStudioCompositionAsync(tag(), seconds, request).then(value => { if (request === token.current && intentRevision === currentRevision.current) { errorCode.current = undefined; setError(null); accept(value); } }).catch(cause => { if (request === token.current && intentRevision === currentRevision.current) { errorCode.current = undefined; setError(cause instanceof Error ? cause.message : 'Não foi possível navegar no vídeo.'); } });
    },
    previewSourceFrame(source) {
      pausePlayback(); transient.current = true;
      const request = ++token.current; const intentRevision = currentRevision.current;
      void previewStudioCompositionSourceAsync(tag(), source.takeId, source.seconds, position.current, request).then(() => { if (request === token.current && intentRevision === currentRevision.current) { errorCode.current = undefined; setError(null); } }).catch(cause => { if (request === token.current && intentRevision === currentRevision.current) { errorCode.current = undefined; setError(cause instanceof Error ? cause.message : 'Não foi possível visualizar o corte.'); } });
    },
  }), []);
  return <View style={styles.canvas} accessibilityLabel={props.canvasLabel} onTouchEnd={props.onCanvasPress}>
    {NativeCanvas && <NativeCanvas ref={canvas} style={StyleSheet.absoluteFill} recipeJSON={recipe} revision={revision} paused={paused || !!props.paused} onPlaybackState={event => accept(event.nativeEvent)} onError={event => { if (event.nativeEvent.revision === currentRevision.current && event.nativeEvent.token >= token.current) { errorCode.current = event.nativeEvent.code; setError(event.nativeEvent.message); } }} />}
    {error && <View style={styles.message}><Text style={styles.text}>{error}</Text></View>}
  </View>;
});
const styles = StyleSheet.create({ canvas: { flex: 1, backgroundColor: '#000' }, message: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.75)' }, text: { color: '#FFF', fontSize: 12, textAlign: 'center' } });

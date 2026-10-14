import { randomUUID } from 'expo-crypto';
import { requireNativeViewManager } from 'expo-modules-core';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { findNodeHandle, Platform, type StyleProp, type ViewStyle } from 'react-native';
import type { CameraView } from 'expo-camera';
import {
  isStudioNativeCameraAvailable, startStudioNativeCameraRecordingAsync, stopStudioNativeCameraRecordingAsync,
  isStudioNativeCameraEffectsAvailable, setStudioNativeCameraEffectAsync,
  isStudioNativeCameraSpeechAvailable,
  type StudioCameraState, type StudioNativeRecording, type StudioNativeCameraEffectAck, type StudioCaptureAudioEvent, type StudioCaptureSpeechEvent,
} from '../../../modules/classfy-studio-media';
import { normalizeStudioCaptureGrade, type StudioGrade } from './model';

export type StudioNativeRecordingState = {
  phase: 'preparing' | 'recording' | 'stopping' | 'finished'; operationId: string;
  generation: number; revision: number; startedAtEpochMs?: number; error?: string; recoveryUri?: string; result?: StudioNativeRecording;
};
export type StudioNativeCameraHandle = {
  readonly studioNative: true;
  getNativeTag(): number | null;
  setEffectAsync(grade: StudioGrade): Promise<StudioNativeCameraEffectAck>;
  recordAsync(options?: Parameters<CameraView['recordAsync']>[0]): Promise<StudioCaptureRecording>;
  stopRecording(): void;
};
export type StudioCaptureRecording = StudioNativeRecording & { grade?: StudioGrade };
export type StudioCaptureCameraHandle = CameraView | StudioNativeCameraHandle;
export function isStudioNativeCameraHandle(value: StudioCaptureCameraHandle | null | undefined): value is StudioNativeCameraHandle {
  return !!value && 'studioNative' in value && value.studioNative === true;
}
export class StudioNativeRecordingError extends Error {
  constructor(message: string, readonly recoveryUri?: string, readonly grade?: StudioGrade) { super(message); this.name = 'StudioNativeRecordingError'; }
}

type Props = {
  style?: StyleProp<ViewStyle>; active?: boolean; effectRecipeJSON?: string;
  speechEnabled?: boolean; speechSessionId?: string; speechLocale?: string;
  onSpeech?: (event: StudioCaptureSpeechEvent) => void;
  onCameraReady?: () => void; onMountError?: (event: { message: string }) => void;
  onRecordingState?: (event: StudioNativeRecordingState) => void;
  onAudioMonitor?: (event: StudioCaptureAudioEvent) => void;
  onInterruption?: (event: { message?: string; reason?: string; generation: number; revision: number }) => void;
};
type NativeProps = {
  ref?: React.Ref<unknown>; style?: StyleProp<ViewStyle>; active: boolean; effectRecipeJSON: string;
  speechEnabled?: boolean; speechSessionId?: string; speechLocale?: string;
  onSpeech?: (event: { nativeEvent: StudioCaptureSpeechEvent }) => void;
  onReady: (event: { nativeEvent: StudioCameraState }) => void;
  onState: (event: { nativeEvent: StudioCameraState }) => void;
  onError: (event: { nativeEvent: { message: string; generation?: number; revision?: number } }) => void;
  onRecordingState: (event: { nativeEvent: StudioNativeRecordingState }) => void;
  onAudioMonitor?: (event: { nativeEvent: StudioCaptureAudioEvent }) => void;
  onInterruption: (event: { nativeEvent: { message?: string; reason?: string; generation: number; revision: number } }) => void;
};
const NativeCanvas = Platform.OS === 'ios' && isStudioNativeCameraAvailable()
  ? requireNativeViewManager<NativeProps>('ClassfyStudioMedia', 'StudioCaptureView') : null;
const identityRecipe = JSON.stringify({ preset: 'natural', intensity: 0, exposure: 0, contrast: 0, saturation: 0, temperature: 0 });

/** One JS operation owns one native tag and file promise until finalization. */
export const StudioNativeCamera = forwardRef<StudioNativeCameraHandle, Props>(function StudioNativeCamera(props, ref) {
  const canvas = useRef(null);
  const live = useRef(props); live.current = props;
  const operation = useRef<{
    id: string; tag: number; finished?: StudioNativeRecordingState;
    finishedEvent: Promise<void>; notifyFinished: () => void; grade?: StudioGrade;
  } | null>(null);
  const confirmedEffect = useRef<{ tag: number; generation: number; grade?: StudioGrade } | null>(null);
  const nativeGeneration = useRef<number | undefined>(undefined);
  const effectToken = useRef(0), effectPending = useRef(false), effectRejected = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; effectToken.current++; confirmedEffect.current = null;
  }; }, []);
  const nativeTag = () => findNodeHandle(canvas.current);
  const observeState = (state: StudioCameraState) => {
    const generation = state.generation;
    if (typeof generation !== 'number' || nativeGeneration.current !== undefined && generation < nativeGeneration.current) return;
    nativeGeneration.current = generation;
    const confirmed = confirmedEffect.current;
    if (confirmed && (confirmed.generation !== generation || state.previewProcessed === false && confirmed.grade)) {
      if (confirmed.grade) effectRejected.current = true;
      confirmedEffect.current = null;
    }
  };
  const lastReadyGeneration = useRef<number | undefined>(undefined);
  useImperativeHandle(ref, () => ({
    studioNative: true as const,
    getNativeTag: nativeTag,
    async setEffectAsync(grade) {
      if (!isStudioNativeCameraEffectsAvailable()) throw new Error('Atualize o Classfy Dev para visualizar tratamentos na câmera.');
      if (operation.current) throw new Error('Finalize o take antes de trocar o tratamento.');
      const normalized = normalizeStudioCaptureGrade(grade);
      // Serialize a complete value even for identity, so reverting to Natural
      // actually clears the previous native grade instead of leaving it hidden.
      const requested = { ...grade };
      const tag = nativeTag();
      if (!tag) throw new Error('Aguarde a câmera preparar a imagem.');
      const token = ++effectToken.current;
      effectPending.current = true; effectRejected.current = true; confirmedEffect.current = null;
      try {
        const result = await setStudioNativeCameraEffectAsync(tag, JSON.stringify(requested));
        if (!mounted.current || token !== effectToken.current || nativeTag() !== tag
          || nativeGeneration.current !== undefined && result.generation < nativeGeneration.current) throw new Error('A câmera mudou durante o ajuste. Escolha o tratamento novamente.');
        if (normalized && !result.previewProcessed) throw new Error('Este formato não oferece prévia do tratamento. Use Natural ou outra qualidade.');
        if (Object.keys(requested).some(key => result.grade[key as keyof StudioGrade] !== requested[key as keyof StudioGrade])) {
          throw new Error('A câmera não confirmou os ajustes escolhidos. Tente novamente.');
        }
        nativeGeneration.current = result.generation;
        confirmedEffect.current = { tag, generation: result.generation, grade: normalized ? { ...normalized } : undefined };
        effectRejected.current = false;
        return result;
      } finally { if (token === effectToken.current) effectPending.current = false; }
    },
    async recordAsync() {
      if (operation.current) throw new Error('Finalize o take atual antes de gravar novamente.');
      if (effectPending.current) throw new Error('Aguarde a câmera confirmar o tratamento antes de gravar.');
      if (effectRejected.current) throw new Error('Escolha Natural ou confirme o tratamento novamente antes de gravar.');
      const tag = nativeTag();
      if (!tag) throw new Error('A câmera está preparando a imagem. Aguarde para gravar.');
      let notifyFinished = () => {};
      const finishedEvent = new Promise<void>(resolve => { notifyFinished = resolve; });
      const snapshot = confirmedEffect.current?.tag === tag ? confirmedEffect.current.grade : undefined;
      const owned = { id: randomUUID(), tag, grade: snapshot ? { ...snapshot } : undefined, finishedEvent, notifyFinished, finished: undefined as StudioNativeRecordingState | undefined };
      operation.current = owned;
      try { return { ...await startStudioNativeCameraRecordingAsync(tag, owned.id), ...(owned.grade ? { grade: owned.grade } : {}) }; }
      catch (cause) {
        // Events and promise rejection cross separate native queues. Briefly
        // wait for this operation's final event to retain a recoverable file.
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (!owned.finished) await Promise.race([owned.finishedEvent, new Promise<void>(resolve => { timer = setTimeout(resolve, 150); })]);
        if (timer) clearTimeout(timer);
        throw new StudioNativeRecordingError(cause instanceof Error ? cause.message : 'A gravação foi interrompida.', owned.finished?.recoveryUri, owned.grade);
      } finally { if (operation.current === owned) operation.current = null; }
    },
    stopRecording() {
      const owned = operation.current;
      if (!owned) return;
      // The session retains STOP even if MovieFileOutput has not started yet.
      // Never resolve a new tag or redirect this command after a remount.
      void stopStudioNativeCameraRecordingAsync(owned.tag, owned.id).catch(() => undefined);
    },
  }), []);
  if (!NativeCanvas) return null;
  return <NativeCanvas ref={canvas} style={props.style} active={props.active !== false} effectRecipeJSON={props.effectRecipeJSON || identityRecipe}
    {...(isStudioNativeCameraSpeechAvailable() ? {
      speechEnabled: props.speechEnabled === true, speechSessionId: props.speechSessionId || '', speechLocale: props.speechLocale || 'pt-BR',
      onSpeech: (event: { nativeEvent: StudioCaptureSpeechEvent }) => {
        const value = event.nativeEvent, current = live.current;
        if (!mounted.current || current.active === false || !current.speechEnabled || !current.speechSessionId
          || value.sessionId !== current.speechSessionId || nativeGeneration.current === undefined
          || value.generation !== nativeGeneration.current || !Number.isSafeInteger(value.sequence) || value.sequence < 1
          || !Number.isSafeInteger(value.segmentId) || value.segmentId < 0
          || value.type !== 'result' && value.type !== 'status') return;
        current.onSpeech?.(value);
      },
    } : {})}
    onReady={event => {
      observeState(event.nativeEvent);
      if (lastReadyGeneration.current === event.nativeEvent.generation) return;
      lastReadyGeneration.current = event.nativeEvent.generation;
      live.current.onCameraReady?.();
    }}
    onState={event => observeState(event.nativeEvent)}
    {...(props.onAudioMonitor ? { onAudioMonitor: (event: { nativeEvent: StudioCaptureAudioEvent }) => {
      if (!mounted.current || live.current.active === false || nativeGeneration.current === undefined
        || event.nativeEvent.generation !== nativeGeneration.current) return;
      live.current.onAudioMonitor?.(event.nativeEvent);
    } } : {})}
    onError={event => live.current.onMountError?.({ message: event.nativeEvent.message })}
    onRecordingState={event => {
      const value = event.nativeEvent; const owned = operation.current;
      if (!owned || owned.id !== value.operationId) return;
      if (value.phase === 'finished') { owned.finished = value; owned.notifyFinished(); }
      live.current.onRecordingState?.(value);
    }}
    onInterruption={event => {
      if (event.nativeEvent.reason === 'previewFallback') {
        if (confirmedEffect.current?.grade) effectRejected.current = true;
        confirmedEffect.current = null;
      }
      live.current.onInterruption?.(event.nativeEvent);
    }} />;
});

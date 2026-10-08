import { randomUUID } from 'expo-crypto';
import { requireNativeViewManager } from 'expo-modules-core';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { findNodeHandle, Platform, type StyleProp, type ViewStyle } from 'react-native';
import type { CameraView } from 'expo-camera';
import {
  isStudioNativeCameraAvailable, startStudioNativeCameraRecordingAsync, stopStudioNativeCameraRecordingAsync,
  type StudioCameraState, type StudioNativeRecording,
} from '../../../modules/classfy-studio-media';

export type StudioNativeRecordingState = {
  phase: 'preparing' | 'recording' | 'stopping' | 'finished'; operationId: string;
  generation: number; revision: number; error?: string; recoveryUri?: string; result?: StudioNativeRecording;
};
export type StudioNativeCameraHandle = {
  readonly studioNative: true;
  getNativeTag(): number | null;
  recordAsync(options?: Parameters<CameraView['recordAsync']>[0]): Promise<StudioNativeRecording>;
  stopRecording(): void;
};
export type StudioCaptureCameraHandle = CameraView | StudioNativeCameraHandle;
export function isStudioNativeCameraHandle(value: StudioCaptureCameraHandle | null | undefined): value is StudioNativeCameraHandle {
  return !!value && 'studioNative' in value && value.studioNative === true;
}
export class StudioNativeRecordingError extends Error {
  constructor(message: string, readonly recoveryUri?: string) { super(message); this.name = 'StudioNativeRecordingError'; }
}

type Props = {
  style?: StyleProp<ViewStyle>; active?: boolean; effectRecipeJSON?: string;
  onCameraReady?: () => void; onMountError?: (event: { message: string }) => void;
  onRecordingState?: (event: StudioNativeRecordingState) => void;
  onInterruption?: (event: { message?: string; reason?: string; generation: number; revision: number }) => void;
};
type NativeProps = {
  ref?: React.Ref<unknown>; style?: StyleProp<ViewStyle>; active: boolean; effectRecipeJSON: string;
  onReady: (event: { nativeEvent: StudioCameraState }) => void;
  onState: (event: { nativeEvent: StudioCameraState }) => void;
  onError: (event: { nativeEvent: { message: string; generation?: number; revision?: number } }) => void;
  onRecordingState: (event: { nativeEvent: StudioNativeRecordingState }) => void;
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
    finishedEvent: Promise<void>; notifyFinished: () => void;
  } | null>(null);
  const nativeTag = () => findNodeHandle(canvas.current);
  const lastReadyGeneration = useRef<number | undefined>(undefined);
  useImperativeHandle(ref, () => ({
    studioNative: true as const,
    getNativeTag: nativeTag,
    async recordAsync() {
      if (operation.current) throw new Error('Finalize o take atual antes de gravar novamente.');
      const tag = nativeTag();
      if (!tag) throw new Error('A câmera está preparando a imagem. Aguarde para gravar.');
      let notifyFinished = () => {};
      const finishedEvent = new Promise<void>(resolve => { notifyFinished = resolve; });
      const owned = { id: randomUUID(), tag, finishedEvent, notifyFinished, finished: undefined as StudioNativeRecordingState | undefined };
      operation.current = owned;
      try { return await startStudioNativeCameraRecordingAsync(tag, owned.id); }
      catch (cause) {
        // Events and promise rejection cross separate native queues. Briefly
        // wait for this operation's final event to retain a recoverable file.
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (!owned.finished) await Promise.race([owned.finishedEvent, new Promise<void>(resolve => { timer = setTimeout(resolve, 150); })]);
        if (timer) clearTimeout(timer);
        throw new StudioNativeRecordingError(cause instanceof Error ? cause.message : 'A gravação foi interrompida.', owned.finished?.recoveryUri);
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
    onReady={event => {
      if (lastReadyGeneration.current === event.nativeEvent.generation) return;
      lastReadyGeneration.current = event.nativeEvent.generation;
      live.current.onCameraReady?.();
    }}
    onState={() => {}}
    onError={event => live.current.onMountError?.({ message: event.nativeEvent.message })}
    onRecordingState={event => {
      const value = event.nativeEvent; const owned = operation.current;
      if (!owned || owned.id !== value.operationId) return;
      if (value.phase === 'finished') { owned.finished = value; owned.notifyFinished(); }
      live.current.onRecordingState?.(value);
    }}
    onInterruption={event => live.current.onInterruption?.(event.nativeEvent)} />;
});

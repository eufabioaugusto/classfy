import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

export type StudioMediaInfo = {
  duration: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
  fileSize: number;
  frameRate?: number;
};

export type StudioCameraQuality = '720p' | '1080p' | '2160p';
export type StudioCameraFPS = 24 | 30 | 60;
export type StudioCameraState = {
  deviceId: string;
  position: 'front' | 'back' | 'unspecified';
  qualities: { quality: StudioCameraQuality; width: number; height: number; fps: StudioCameraFPS[] }[];
  quality: StudioCameraQuality | null;
  fps: number | null;
  width: number;
  height: number;
  minZoom: number;
  maxZoom: number;
  zoom: number;
  minExposure: number;
  maxExposure: number;
  exposure: number;
  aperture: number | null;
  supportsFocus: boolean;
  supportsFocusLock: boolean;
  supportsExposure: boolean;
  supportsExposureLock: boolean;
  supportsTorch: boolean;
  focusLocked: boolean;
  exposureLocked: boolean;
  torchEnabled: boolean;
  isRecording: boolean;
  generation?: number; revision?: number; phase?: string;
  supportsCinematicCapture?: boolean; cinematic?: boolean; cinematicUnavailableReason?: string; previewProcessed?: boolean;
};
export type StudioExportOptions = {
  requestId: string;
  clips: { uri: string; startSeconds: number; endSeconds: number }[];
  outputUri: string;
  mediaType: 'video' | 'audio';
  aspectRatio: 'landscape' | 'portrait' | 'square';
};
export type StudioExportResult = StudioMediaInfo & { uri: string; mimeType: string };
type StudioMediaEvents = { onExportProgress: (event: { requestId: string; progress: number }) => void; onTranscriptionProgress: (event: { requestId: string; stage: string; progress: number }) => void };
declare class StudioMediaModule extends NativeModule<StudioMediaEvents> {
  getStudioTranscriptionCapabilitiesAsync(locale: string): Promise<StudioTranscriptionCapabilities>;
  installStudioTranscriptionModelAsync(requestId: string, locale: string): Promise<StudioTranscriptionCapabilities>;
  transcribeStudioAsync(requestId: string, uri: string, locale: string): Promise<StudioTranscript>;
  cancelStudioTranscriptionAsync(requestId: string): Promise<void>;
  exportRecipeAsync(options: { requestId: string; recipeJSON: string; outputUri: string }): Promise<StudioExportResult>;
  getStudioNativeCameraCapabilitiesAsync(tag: number): Promise<StudioCameraState>;
  configureStudioNativeCameraAsync(tag: number, options: StudioNativeCameraConfiguration): Promise<StudioCameraState>;
  startStudioNativeCameraRecordingAsync(tag: number, operationId: string): Promise<StudioNativeRecording>;
  stopStudioNativeCameraRecordingAsync(tag: number, operationId: string): Promise<StudioCameraState>;
  setStudioNativeCameraZoomAsync(tag: number, factor: number): Promise<StudioCameraState>;
  setStudioNativeCameraExposureAsync(tag: number, bias: number): Promise<StudioCameraState>;
  setStudioNativeCameraFocusAsync(tag: number, options: { x: number; y: number; locked: boolean }): Promise<StudioCameraState>;
  setStudioNativeCameraTorchAsync(tag: number, enabled: boolean): Promise<StudioCameraState>;
  seekStudioCompositionAsync(tag: number, seconds: number, token: number): Promise<StudioNativePlayback>;
  previewStudioCompositionSourceAsync(tag: number, clipId: string, sourceSeconds: number, timelineSeconds: number, token: number): Promise<StudioNativePlayback>;
  restoreStudioCompositionAsync(tag: number, token: number): Promise<StudioNativePlayback>;
  getMediaInfoAsync(uri: string): Promise<StudioMediaInfo>;
  generateThumbnailAsync(uri: string, outputUri: string, timeSeconds: number): Promise<{ uri: string }>;
  exportTimelineAsync(options: StudioExportOptions): Promise<StudioExportResult>;
  cancelExportAsync(requestId: string): Promise<void>;
  getStudioCameraCapabilitiesAsync(tag: number): Promise<StudioCameraState>;
  configureStudioCameraAsync(tag: number, options: { quality: StudioCameraQuality; fps: StudioCameraFPS }): Promise<StudioCameraState>;
  setStudioCameraZoomAsync(tag: number, factor: number): Promise<StudioCameraState>;
  setStudioCameraExposureAsync(tag: number, bias: number): Promise<StudioCameraState>;
  setStudioCameraFocusAsync(tag: number, options: { x: number; y: number; locked: boolean }): Promise<StudioCameraState>;
}
const native = requireOptionalNativeModule<StudioMediaModule>('ClassfyStudioMedia');

export function isStudioMediaAvailable() { return !!native; }
export function isStudioCameraControlsAvailable() {
  return !!native && typeof native.getStudioCameraCapabilitiesAsync === 'function' &&
    typeof native.configureStudioCameraAsync === 'function' && typeof native.setStudioCameraZoomAsync === 'function' &&
    typeof native.setStudioCameraExposureAsync === 'function' && typeof native.setStudioCameraFocusAsync === 'function';
}
function cameraModule() {
  if (!isStudioCameraControlsAvailable()) throw new Error('Os controles de câmera requerem a versão atual do Classfy para iPhone.');
  return native!;
}
export function getStudioCameraCapabilitiesAsync(tag: number) { return cameraModule().getStudioCameraCapabilitiesAsync(tag); }
export function configureStudioCameraAsync(tag: number, options: { quality: StudioCameraQuality; fps: StudioCameraFPS }) {
  return cameraModule().configureStudioCameraAsync(tag, options);
}
export function setStudioCameraZoomAsync(tag: number, factor: number) { return cameraModule().setStudioCameraZoomAsync(tag, factor); }
export function setStudioCameraExposureAsync(tag: number, bias: number) { return cameraModule().setStudioCameraExposureAsync(tag, bias); }
export function setStudioCameraFocusAsync(tag: number, options: { x: number; y: number; locked: boolean }) {
  return cameraModule().setStudioCameraFocusAsync(tag, options);
}
function mediaModule() {
  if (!native) throw new Error('A edição de takes requer a versão atual do Classfy para iPhone.');
  return native;
}
export function getMediaInfoAsync(uri: string) { return mediaModule().getMediaInfoAsync(uri); }
export function generateThumbnailAsync(uri: string, outputUri: string, timeSeconds = 0) {
  return mediaModule().generateThumbnailAsync(uri, outputUri, timeSeconds);
}
export async function exportTimelineAsync(options: StudioExportOptions, onProgress?: (progress: number) => void) {
  const module = mediaModule();
  const listener = onProgress ? module.addListener('onExportProgress', event => {
    if (event.requestId === options.requestId) onProgress(Math.max(0, Math.min(1, event.progress)));
  }) : undefined;
  try { return await module.exportTimelineAsync(options); }
  finally { listener?.remove(); }
}
export async function cancelExportAsync(requestId: string) { await native?.cancelExportAsync(requestId); }

// A stale development binary may run new JavaScript. Gate the entire native
// composition rather than silently exporting a sequential file without layers.
export function isStudioCompositionAvailable() { return !!native && typeof native.exportRecipeAsync === 'function' && typeof native.seekStudioCompositionAsync === 'function'; }
export function isStudioNativeCameraAvailable() { return !!native && ['getStudioNativeCameraCapabilitiesAsync','configureStudioNativeCameraAsync','startStudioNativeCameraRecordingAsync','stopStudioNativeCameraRecordingAsync','setStudioNativeCameraZoomAsync','setStudioNativeCameraExposureAsync','setStudioNativeCameraFocusAsync','setStudioNativeCameraTorchAsync'].every(name => typeof (native as unknown as Record<string, unknown>)[name] === 'function'); }
export type StudioNativeCameraConfiguration = { position: 'front' | 'back'; quality: StudioCameraQuality; fps: StudioCameraFPS; orientation: 'portrait' | 'landscapeLeft' | 'landscapeRight'; cinematic?: boolean; mirrored?: boolean };
export type StudioNativeRecording = { duration?: number; width?: number; height?: number; frameRate?: number; colorPrimaries?: string; transferFunction?: string; yCbCrMatrix?: string; fileSize?: number; uri: string; operationId: string; sourceKind?: 'standard' | 'cinematic'; sourceStage?: 'standard' | 'cinematicRaw' | 'cinematicRendered'; captureSnapshot?: StudioCameraState };
export type StudioNativePlayback = { positionSeconds: number; sourcePositionSeconds: number; clipId?: string | null; playing: boolean; loading: boolean; revision: string; token: number };
function studioNativeModule() { if (!isStudioNativeCameraAvailable()) throw new Error('Atualize o Classfy Dev para usar a câmera nativa.'); return native!; }
export function getStudioNativeCameraCapabilitiesAsync(tag: number) { return studioNativeModule().getStudioNativeCameraCapabilitiesAsync(tag); }
export function configureStudioNativeCameraAsync(tag: number, options: StudioNativeCameraConfiguration) { return studioNativeModule().configureStudioNativeCameraAsync(tag, options); }
export function startStudioNativeCameraRecordingAsync(tag: number, operationId: string) { return studioNativeModule().startStudioNativeCameraRecordingAsync(tag, operationId); }
export function stopStudioNativeCameraRecordingAsync(tag: number, operationId: string) { return studioNativeModule().stopStudioNativeCameraRecordingAsync(tag, operationId); }
export function setStudioNativeCameraZoomAsync(tag: number, factor: number) { return studioNativeModule().setStudioNativeCameraZoomAsync(tag, factor); }
export function setStudioNativeCameraExposureAsync(tag: number, bias: number) { return studioNativeModule().setStudioNativeCameraExposureAsync(tag, bias); }
export function setStudioNativeCameraFocusAsync(tag: number, options: { x: number; y: number; locked: boolean }) { return studioNativeModule().setStudioNativeCameraFocusAsync(tag, options); }
export function setStudioNativeCameraTorchAsync(tag: number, enabled: boolean) { return studioNativeModule().setStudioNativeCameraTorchAsync(tag, enabled); }
function compositionModule() { if (!isStudioCompositionAvailable()) throw new Error('Atualize o Classfy Dev para editar e exportar camadas e tratamentos de imagem.'); return native!; }
export function seekStudioCompositionAsync(tag: number, seconds: number, token: number) { return compositionModule().seekStudioCompositionAsync(tag, seconds, token); }
export function previewStudioCompositionSourceAsync(tag: number, clipId: string, sourceSeconds: number, timelineSeconds: number, token: number) { return compositionModule().previewStudioCompositionSourceAsync(tag, clipId, sourceSeconds, timelineSeconds, token); }
export function restoreStudioCompositionAsync(tag: number, token: number) { return compositionModule().restoreStudioCompositionAsync(tag, token); }
export async function exportRecipeAsync(options: { requestId: string; recipeJSON: string; outputUri: string }, onProgress?: (value: number) => void) {
  const module = compositionModule();
  const listener = onProgress ? module.addListener('onExportProgress', event => { if (event.requestId === options.requestId) onProgress(Math.max(0, Math.min(1, event.progress))); }) : undefined;
  try { return await module.exportRecipeAsync(options); } finally { listener?.remove(); }
}

export type StudioTranscriptionCapabilities = { available: boolean; installed: boolean; requiresModelDownload: boolean; locale: string; onDevice?: boolean; reason?: string };
export type StudioTranscript = { locale: string; onDevice: boolean; segments: { text: string; startSeconds: number; endSeconds: number; words: { text: string; startSeconds: number; endSeconds: number }[] }[] };
export async function getStudioTranscriptionCapabilitiesAsync() { if (!native || typeof native.getStudioTranscriptionCapabilitiesAsync !== 'function') return { available: false, installed: false, requiresModelDownload: false, locale: 'pt-BR', reason: 'Atualize o Classfy Dev para usar transcrição local.' }; return native.getStudioTranscriptionCapabilitiesAsync('pt-BR'); }
export async function transcribeStudioAsync(requestId: string, uri: string, progress?: (stage: string, value: number) => void) {
  if (!native || typeof native.transcribeStudioAsync !== 'function') throw new Error('Atualize o Classfy Dev para usar transcrição local.');
  const listener = progress ? native.addListener('onTranscriptionProgress', event => { if (event.requestId === requestId) progress(event.stage, event.progress); }) : undefined;
  try { return await native.transcribeStudioAsync(requestId, uri, 'pt-BR'); } finally { listener?.remove(); }
}
export async function cancelStudioTranscriptionAsync(requestId: string) { await native?.cancelStudioTranscriptionAsync?.(requestId); }

export async function installStudioTranscriptionModelAsync(requestId: string, progress?: (stage: string, value: number) => void) {
  if (!native || typeof native.installStudioTranscriptionModelAsync !== 'function') throw new Error('Atualize o Classfy Dev para instalar o modelo de transcrição.');
  const listener = progress ? native.addListener('onTranscriptionProgress', event => { if (event.requestId === requestId) progress(event.stage, event.progress); }) : undefined;
  try { return await native.installStudioTranscriptionModelAsync(requestId, 'pt-BR'); } finally { listener?.remove(); }
}

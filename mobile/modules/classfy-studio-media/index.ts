import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';
import type { StudioGrade, StudioRenderRecipe } from '../../src/features/studio/model';

export type StudioMediaInfo = {
  duration: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
  fileSize: number;
  frameRate?: number;
  colorSpace?: string;
  colorPrimaries?: string;
  transferFunction?: string;
  yCbCrMatrix?: string;
};

export type StudioCameraQuality = '720p' | '1080p' | '1440p' | '2160p';
export type StudioCameraProSettings = Partial<{ autoExposure: boolean; iso: number; shutterSeconds: number; autoWhiteBalance: boolean; redGain: number; greenGain: number; blueGain: number; temperatureKelvin: number; whiteBalanceTint: number; autoFocus: boolean; lensPosition: number }>;
export type StudioCameraProState = {
  version: 1; supportsExposure: boolean; autoExposure: boolean; minISO: number; maxISO: number; iso: number;
  minShutterSeconds: number; maxShutterSeconds: number; shutterSeconds: number;
  supportsWhiteBalance: boolean; autoWhiteBalance: boolean; minWhiteBalanceGain: number; maxWhiteBalanceGain: number;
  redGain: number; greenGain: number; blueGain: number;
  supportsTemperatureAndTint?: boolean; temperatureKelvin?: number; whiteBalanceTint?: number;
  supportsFocus: boolean; autoFocus: boolean; lensPosition: number;
};
export type StudioCameraFPS = 24 | 30 | 60;
export type StudioRemotePreviewDescriptor = { streamId: string; streamReactTag: string; tracks: { id: string; kind: 'video'; remote: false; enabled: boolean; readyState: 'live'; peerConnectionId: number; constraints: object; settings: object }[] };
export type StudioAudioInputPort = { id: string; name: string; type: string };
export type StudioAudioInputState = {
  version: 1; available: StudioAudioInputPort[]; preferredId: string | null;
  current: StudioAudioInputPort | null; confirmed: boolean; selecting: boolean; warning: string | null;
};
export type StudioCameraState = {
  deviceId: string;
  position: 'front' | 'back' | 'unspecified';
  qualities: { quality: StudioCameraQuality; width: number; height: number; fps: StudioCameraFPS[]; sourceWidth?: number; sourceHeight?: number; downsampled?: boolean }[];
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
  pro?: StudioCameraProState; proConfirmed?: boolean; sourceWidth?: number; sourceHeight?: number; downsampled?: boolean;
  generation?: number; revision?: number; phase?: string;
  supportsImageGrade?: boolean; imageGrade?: StudioGrade; imageGradeConfirmed?: boolean; remoteGradeConfirmed?: boolean;
  supportsCinematicCapture?: boolean; cinematic?: boolean; cinematicUnavailableReason?: string; previewProcessed?: boolean;
  supportsAudioInputSelection?: boolean; audioInput?: StudioAudioInputState;
};
export type StudioExportOptions = {
  requestId: string;
  clips: { uri: string; startSeconds: number; endSeconds: number }[];
  outputUri: string;
  mediaType: 'video' | 'audio';
  aspectRatio: 'landscape' | 'portrait' | 'square';
};
export type StudioExportResult = StudioMediaInfo & { uri: string; mimeType: string };
export type StudioExportCapabilities = {
  version: number; available: boolean; colorSpace: 'rec709'; minimumDimension: number;
  maximumDimension: number; maximumShortDimension: number; maximumPixels: number;
  arbitraryEvenDimensions: boolean; supportsHEVC: boolean;
  resolutions: readonly { id: '720p' | 'hd' | '2k' | '4k'; width: number; height: number; codec: 'h264' | 'hevc' }[];
  frameRates: readonly { numerator: number; denominator: number }[];
};
type StudioMediaEvents = { onExportProgress: (event: { requestId: string; progress: number }) => void; onTranscriptionProgress: (event: { requestId: string; stage: string; progress: number }) => void };
declare class StudioMediaModule extends NativeModule<StudioMediaEvents> {
  getStudioNativeCameraSpeechVersionAsync?(): Promise<{ version: number; available: boolean; onDeviceOnly: boolean }>;
  requestStudioCaptureSpeechPermissionAsync?(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  getStudioNativeCameraAudioMonitorVersionAsync?(): Promise<{ version: number; available: boolean }>;
  getStudioNativeAudioInputSelectionVersionAsync?(): Promise<{ version: number; available: boolean }>;
  setStudioNativeAudioInputAsync?(tag: number, inputId: string | null): Promise<StudioCameraState>;
  getStudioEditorCapabilitiesAsync?(): Promise<{ version: number; available: boolean }>;
  renderStudioRecipeThumbnailAsync?(recipeJSON: string, outputUri: string, seconds: number): Promise<{ uri: string; width: number; height: number; seconds: number }>;
  getStudioExportCapabilitiesAsync?(): Promise<StudioExportCapabilities>;
  getStudioInteractiveCompositionVersionAsync?(): Promise<{ version: number; available: boolean }>;
  performStudioSelectionFeedbackAsync?(): Promise<boolean>;
  getStudioTranscriptionCapabilitiesAsync(locale: string): Promise<StudioTranscriptionCapabilities>;
  installStudioTranscriptionModelAsync(requestId: string, locale: string): Promise<StudioTranscriptionCapabilities>;
  transcribeStudioAsync(requestId: string, uri: string, locale: string): Promise<StudioTranscript>;
  cancelStudioTranscriptionAsync(requestId: string): Promise<void>;
  exportRecipeAsync(options: { requestId: string; recipeJSON: string; outputUri: string }): Promise<StudioExportResult>;
  getStudioNativeCameraCapabilitiesAsync(tag: number): Promise<StudioCameraState>;
  configureStudioNativeCameraAsync(tag: number, options: StudioNativeCameraConfiguration): Promise<StudioCameraState>;
  startStudioNativeCameraRecordingAsync(tag: number, operationId: string): Promise<StudioNativeRecording>;
  getStudioRemoteCameraVersionAsync?(): Promise<{version: number; available: boolean; videoOnly: boolean}>;
  startStudioRemoteCameraPreviewAsync?(tag: number): Promise<StudioRemotePreviewDescriptor>;
  stopStudioRemoteCameraPreviewAsync?(tag: number): Promise<boolean>;
  startStudioRemoteCameraRecordingAsync?(tag: number, takeId: string, owner: string, session: string): Promise<StudioNativeRecording>;
  stopStudioNativeCameraRecordingAsync(tag: number, operationId: string): Promise<StudioCameraState>;
  setStudioNativeCameraZoomAsync(tag: number, factor: number): Promise<StudioCameraState>;
  setStudioNativeCameraExposureAsync(tag: number, bias: number): Promise<StudioCameraState>;
  setStudioNativeCameraProSettingsAsync?(tag: number, settings: StudioCameraProSettings): Promise<StudioCameraState>;
  setStudioNativeCameraFocusAsync(tag: number, options: { x: number; y: number; locked: boolean }): Promise<StudioCameraState>;
  setStudioNativeCameraTorchAsync(tag: number, enabled: boolean): Promise<StudioCameraState>;
  setStudioNativeCameraEffectAsync(tag: number, recipeJSON: string): Promise<StudioNativeCameraEffectAck>;
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
export function isStudioCameraProControlsAvailable() { return typeof native?.setStudioNativeCameraProSettingsAsync === 'function'; }
export function setStudioNativeCameraProSettingsAsync(tag: number, settings: StudioCameraProSettings) {
  if (!native?.setStudioNativeCameraProSettingsAsync) throw new Error('Os controles PRO precisam de uma versão nativa atualizada do Classfy.');
  return native.setStudioNativeCameraProSettingsAsync(tag, settings);
}
export async function performStudioSelectionFeedbackAsync(): Promise<boolean> {
  if (typeof native?.performStudioSelectionFeedbackAsync !== 'function') return false;
  return (await native.performStudioSelectionFeedbackAsync()) === true;
}
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
export function isStudioEditorToolsAvailable() { return isStudioCompositionAvailable() && typeof native?.getStudioEditorCapabilitiesAsync === 'function'; }
export function isStudioFilterPreviewAvailable() { return isStudioEditorToolsAvailable() && typeof native?.renderStudioRecipeThumbnailAsync === 'function'; }
export async function renderStudioRecipeThumbnailAsync(recipeJSON: string, outputUri: string, seconds: number) {
  if (!isStudioFilterPreviewAvailable()) throw new Error('Atualize o Classfy Dev para visualizar as miniaturas dos filtros.');
  return native!.renderStudioRecipeThumbnailAsync!(recipeJSON, outputUri, seconds);
}
export function studioRecipeNeedsEditorTools(recipe: StudioRenderRecipe) {
  return recipe.clips.some(clip => clip.kind === 'audio' && recipe.assets?.some(asset => asset.id === clip.assetId && asset.kind === 'video') || clip.zIndex === 0 && (clip.fadeInTicks > 0 || clip.fadeOutTicks > 0 || clip.opacity !== 1) || (clip.playbackRate ?? 1) !== 1 || clip.flipHorizontal || clip.flipVertical || clip.motion && clip.motion !== 'none'
    || clip.text && (clip.text.decoration && clip.text.decoration !== 'none' || clip.text.visualEffect && clip.text.visualEffect !== 'none'
      || clip.text.animation && clip.text.animation !== 'none' || clip.text.gradientColors));
}
export async function getStudioEditorCapabilitiesAsync() {
  if (!isStudioEditorToolsAvailable()) return { version: 0, available: false };
  try { const value = await native!.getStudioEditorCapabilitiesAsync!(); return { version: value.version, available: value.version === 1 && value.available === true }; }
  catch { return { version: 0, available: false }; }
}
export async function getStudioExportCapabilitiesAsync(): Promise<StudioExportCapabilities> {
  const fallback: StudioExportCapabilities = { version: 1, available: isStudioCompositionAvailable(), colorSpace: 'rec709',
    minimumDimension: 1080, maximumDimension: 1920, maximumShortDimension: 1080, maximumPixels: 1920 * 1080,
    arbitraryEvenDimensions: false, supportsHEVC: false,
    resolutions: [{ id: 'hd', width: 1920, height: 1080, codec: 'h264' }], frameRates: [{ numerator: 30, denominator: 1 }] };
  if (!isStudioCompositionAvailable() || typeof native?.getStudioExportCapabilitiesAsync !== 'function') return fallback;
  try {
    const value = await native.getStudioExportCapabilitiesAsync();
    if (value.version !== 2 || value.colorSpace !== 'rec709' || typeof value.available !== 'boolean'
      || !Number.isSafeInteger(value.minimumDimension) || value.minimumDimension < 64
      || !Number.isSafeInteger(value.maximumDimension) || value.maximumDimension > 3840
      || !Number.isSafeInteger(value.maximumShortDimension) || value.maximumShortDimension > 2160
      || !Number.isSafeInteger(value.maximumPixels) || value.maximumPixels > 3840 * 2160
      || typeof value.arbitraryEvenDimensions !== 'boolean' || typeof value.supportsHEVC !== 'boolean'
      || !Array.isArray(value.resolutions) || !Array.isArray(value.frameRates)) return fallback;
    const rates = new Set(['24/1', '25/1', '30/1', '50/1', '60/1', '24000/1001', '30000/1001', '60000/1001']);
    if (value.resolutions.some(item => !['720p', 'hd', '2k', '4k'].includes(item.id)
      || !Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height)
      || item.width < 64 || item.height < 64 || item.width > value.maximumDimension || item.height > value.maximumShortDimension
      || !['h264', 'hevc'].includes(item.codec))
      || value.frameRates.some(item => !rates.has(`${item.numerator}/${item.denominator}`)
        || item.numerator / item.denominator > 30.1 && !value.supportsHEVC)
      || value.available && (value.maximumDimension < value.minimumDimension || value.maximumShortDimension < value.minimumDimension
        || value.maximumPixels < value.minimumDimension ** 2 || !value.resolutions.length || !value.frameRates.length)) return fallback;
    return { ...value, resolutions: value.resolutions.map(item => ({ ...item })), frameRates: value.frameRates.map(item => ({ ...item })) };
  } catch { return fallback; }
}
// Presence gates old development clients. The view validates every v1 patch.
export function isStudioInteractiveCompositionAvailable() { return isStudioCompositionAvailable() && typeof native?.getStudioInteractiveCompositionVersionAsync === 'function'; }
export async function getStudioInteractiveCompositionVersionAsync() {
  if (!isStudioInteractiveCompositionAvailable()) return { version: 0, available: false };
  const value = await native!.getStudioInteractiveCompositionVersionAsync!();
  return { version: value.version, available: value.version === 1 && value.available === true };
}
export function isStudioNativeCameraAvailable() { return !!native && ['getStudioNativeCameraCapabilitiesAsync','configureStudioNativeCameraAsync','startStudioNativeCameraRecordingAsync','stopStudioNativeCameraRecordingAsync','setStudioNativeCameraZoomAsync','setStudioNativeCameraExposureAsync','setStudioNativeCameraFocusAsync','setStudioNativeCameraTorchAsync'].every(name => typeof (native as unknown as Record<string, unknown>)[name] === 'function'); }
export function isStudioNativeCameraEffectsAvailable() {
  return isStudioNativeCameraAvailable() && isStudioCompositionAvailable() && typeof native?.setStudioNativeCameraEffectAsync === 'function';
}
export function isStudioNativeCameraAudioMonitorAvailable() {
  return isStudioNativeCameraAvailable() && typeof native?.getStudioNativeCameraAudioMonitorVersionAsync === 'function';
}
export function isStudioNativeAudioInputSelectionAvailable() {
  return isStudioNativeCameraAvailable() && typeof native?.getStudioNativeAudioInputSelectionVersionAsync === 'function'
    && typeof native?.setStudioNativeAudioInputAsync === 'function';
}
export async function getStudioNativeAudioInputSelectionVersionAsync() {
  if (!isStudioNativeAudioInputSelectionAvailable()) return { version: 0, available: false };
  const value = await native!.getStudioNativeAudioInputSelectionVersionAsync!();
  return { version: value.version, available: value.version === 1 && value.available === true };
}
export async function setStudioNativeAudioInputAsync(tag: number, inputId: string | null): Promise<StudioCameraState> {
  if (!isStudioNativeAudioInputSelectionAvailable() || !(await getStudioNativeAudioInputSelectionVersionAsync()).available) {
    throw new Error('Atualize o Classfy Dev para escolher o microfone do iPhone.');
  }
  if (inputId !== null && (typeof inputId !== 'string' || !inputId.length || inputId.length > 512)) {
    throw new Error('Escolha uma entrada de áudio disponível no iPhone.');
  }
  return native!.setStudioNativeAudioInputAsync!(tag, inputId);
}
export function isStudioNativeCameraSpeechAvailable() {
  return isStudioNativeCameraAvailable() && typeof native?.getStudioNativeCameraSpeechVersionAsync === 'function'
    && typeof native?.requestStudioCaptureSpeechPermissionAsync === 'function';
}
/** Invoke only from an explicit reader action; native capture never prompts. */
export async function requestStudioCaptureSpeechPermissionAsync(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  if (!isStudioNativeCameraSpeechAvailable()) return { granted: false, canAskAgain: false };
  const value = await native!.requestStudioCaptureSpeechPermissionAsync!();
  return { granted: value.granted === true, canAskAgain: value.canAskAgain === true };
}
export type StudioCaptureSpeechEvent = {
  sessionId: string; generation: number; sequence: number; segmentId: number;
  type: 'result' | 'status'; transcript?: string; isFinal?: boolean;
  status?: 'listening' | 'paused' | 'unavailable' | 'denied' | 'error'; code?: string;
};
export type StudioCaptureAudioEvent = {
  version: 1; generation: number; revision: number; sequence: number; timestampMs: number; active: boolean;
  input: { id: string; name: string; type: string } | null;
  channels: { averageDb: number; peakDb: number }[];
  sampleRate: number | null; channelCount: number; ageMs: number | null;
  audioInput?: StudioAudioInputState;
  reason?: 'routeChanged' | 'inputLost' | 'interrupted' | 'inactive' | 'preparing' | 'unavailable';
};
export type StudioNativeCameraEffectAck = { effectRevision: number; previewProcessed: boolean; grade: StudioGrade; generation: number };
export type StudioNativeCameraConfiguration = { position: 'front' | 'back'; quality: StudioCameraQuality; fps: StudioCameraFPS; orientation: 'portrait' | 'landscapeLeft' | 'landscapeRight'; cinematic?: boolean; mirrored?: boolean };
export type StudioNativeRecording = { duration?: number; width?: number; height?: number; frameRate?: number; colorPrimaries?: string; transferFunction?: string; yCbCrMatrix?: string; fileSize?: number; uri: string; operationId: string; sourceKind?: 'standard' | 'cinematic'; sourceStage?: 'standard' | 'cinematicRaw' | 'cinematicRendered'; captureSnapshot?: StudioCameraState };
export type StudioNativePlayback = { positionSeconds: number; sourcePositionSeconds: number; clipId?: string | null; playing: boolean; loading: boolean; revision: string; token: number };
function studioNativeModule() { if (!isStudioNativeCameraAvailable()) throw new Error('Atualize o Classfy Dev para usar a câmera nativa.'); return native!; }
export function getStudioNativeCameraCapabilitiesAsync(tag: number) { return studioNativeModule().getStudioNativeCameraCapabilitiesAsync(tag); }
export function configureStudioNativeCameraAsync(tag: number, options: StudioNativeCameraConfiguration) { return studioNativeModule().configureStudioNativeCameraAsync(tag, options); }
export function startStudioNativeCameraRecordingAsync(tag: number, operationId: string) { return studioNativeModule().startStudioNativeCameraRecordingAsync(tag, operationId); }
export function isStudioRemoteCameraAvailable() { return !!native && ['getStudioRemoteCameraVersionAsync','startStudioRemoteCameraPreviewAsync','stopStudioRemoteCameraPreviewAsync','startStudioRemoteCameraRecordingAsync'].every(key => typeof (native as unknown as Record<string, unknown>)[key] === 'function'); }
function remoteCameraModule() { if (!isStudioRemoteCameraAvailable()) throw new Error('Atualize o Classfy Dev para conectar o iPhone ao computador.'); return native!; }
export function startStudioRemoteCameraPreviewAsync(tag: number) { return remoteCameraModule().startStudioRemoteCameraPreviewAsync!(tag); }
export function stopStudioRemoteCameraPreviewAsync(tag: number) { return remoteCameraModule().stopStudioRemoteCameraPreviewAsync!(tag); }
export function startStudioRemoteCameraRecordingAsync(tag: number, takeId: string, owner: string, session: string) { return remoteCameraModule().startStudioRemoteCameraRecordingAsync!(tag,takeId,owner,session); }
export function stopStudioNativeCameraRecordingAsync(tag: number, operationId: string) { return studioNativeModule().stopStudioNativeCameraRecordingAsync(tag, operationId); }
export function setStudioNativeCameraZoomAsync(tag: number, factor: number) { return studioNativeModule().setStudioNativeCameraZoomAsync(tag, factor); }
export function setStudioNativeCameraExposureAsync(tag: number, bias: number) { return studioNativeModule().setStudioNativeCameraExposureAsync(tag, bias); }
export function setStudioNativeCameraFocusAsync(tag: number, options: { x: number; y: number; locked: boolean; imageCoordinates?: boolean }) { return studioNativeModule().setStudioNativeCameraFocusAsync(tag, options); }
export function setStudioNativeCameraTorchAsync(tag: number, enabled: boolean) { return studioNativeModule().setStudioNativeCameraTorchAsync(tag, enabled); }
export function setStudioNativeCameraEffectAsync(tag: number, recipeJSON: string) {
  if (!isStudioNativeCameraEffectsAvailable()) throw new Error('Atualize o Classfy Dev para pré-visualizar tratamentos na câmera.');
  return native!.setStudioNativeCameraEffectAsync(tag, recipeJSON);
}
function compositionModule() { if (!isStudioCompositionAvailable()) throw new Error('Atualize o Classfy Dev para editar e exportar camadas e tratamentos de imagem.'); return native!; }
export function seekStudioCompositionAsync(tag: number, seconds: number, token: number) { return compositionModule().seekStudioCompositionAsync(tag, seconds, token); }
export function previewStudioCompositionSourceAsync(tag: number, clipId: string, sourceSeconds: number, timelineSeconds: number, token: number) { return compositionModule().previewStudioCompositionSourceAsync(tag, clipId, sourceSeconds, timelineSeconds, token); }
export function restoreStudioCompositionAsync(tag: number, token: number) { return compositionModule().restoreStudioCompositionAsync(tag, token); }
export async function exportRecipeAsync(options: { requestId: string; recipeJSON: string; outputUri: string }, onProgress?: (value: number) => void) {
  const module = compositionModule();
  if (studioRecipeNeedsEditorTools(JSON.parse(options.recipeJSON) as StudioRenderRecipe) && !(await getStudioEditorCapabilitiesAsync()).available) throw new Error('Instale o Classfy Dev atualizado para exportar os efeitos, o espelhamento e a velocidade desta montagem.');
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

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
};
export type StudioExportOptions = {
  requestId: string;
  clips: { uri: string; startSeconds: number; endSeconds: number }[];
  outputUri: string;
  mediaType: 'video' | 'audio';
  aspectRatio: 'landscape' | 'portrait' | 'square';
};
export type StudioExportResult = StudioMediaInfo & { uri: string; mimeType: string };
type StudioMediaEvents = { onExportProgress: (event: { requestId: string; progress: number }) => void };
declare class StudioMediaModule extends NativeModule<StudioMediaEvents> {
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

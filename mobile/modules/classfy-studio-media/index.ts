import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

export type StudioMediaInfo = {
  duration: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
  fileSize: number;
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
}
const native = requireOptionalNativeModule<StudioMediaModule>('ClassfyStudioMedia');

export function isStudioMediaAvailable() { return !!native; }
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

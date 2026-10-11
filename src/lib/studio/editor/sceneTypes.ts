export type StudioCaptureScene = 'camera' | 'screen' | 'screen-camera';
export type StudioScenePosition = { x: number; y: number };
export type StudioSceneConfiguration = { position: StudioScenePosition; size: number; transition: 'cut' | 'fade' };
export type StudioCaptureScenes = StudioSceneConfiguration & {
  selected: StudioCaptureScene; cameraReady: boolean; screenReady: boolean; screenName: string | null;
  preparingScreen: boolean; backgroundSupported: boolean; error: string | null;
};
export type StudioSceneConfigurationPatch = Partial<Omit<StudioSceneConfiguration, 'position'>> & { position?: StudioScenePosition };
export const studioDefaultSceneConfiguration = (): StudioSceneConfiguration => ({ position: { x: .82, y: .78 }, size: .26, transition: 'cut' });
/** size is the circle's diameter as a fraction of the shorter canvas edge; position is its center. */
export function normalizeStudioSceneConfiguration(previous: StudioSceneConfiguration, patch: StudioSceneConfigurationPatch, width: number, height: number): StudioSceneConfiguration {
  const size = patch.size ?? previous.size, position = patch.position ?? previous.position, transition = patch.transition ?? previous.transition;
  if (!Number.isFinite(size) || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !['cut', 'fade'].includes(transition)) throw new Error('Revise a posição e o tamanho da câmera.');
  const diameter = Math.min(width, height) * Math.max(.14, Math.min(.5, size));
  const x = diameter / (width * 2), y = diameter / (height * 2);
  return { size: diameter / Math.min(width, height), position: { x: Math.max(x, Math.min(1 - x, position.x)), y: Math.max(y, Math.min(1 - y, position.y)) }, transition };
}
export function studioScenesSupport(): { supported: boolean; reason?: string } {
  const scope = globalThis as typeof globalThis & { MediaStreamTrackProcessor?: unknown; MediaStreamTrackGenerator?: unknown };
  const supported = typeof scope.MediaStreamTrackProcessor === 'function' && typeof scope.MediaStreamTrackGenerator === 'function'
    && typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof VideoFrame === 'function'
    && typeof ReadableStream === 'function' && typeof WritableStream === 'function';
  return supported ? { supported: true } : { supported: false, reason: 'As cenas contínuas precisam das APIs de vídeo do Chrome ou Edge atualizado no computador. A gravação simples continua disponível.' };
}

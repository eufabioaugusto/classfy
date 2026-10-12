import { STUDIO_TIMEBASE, studioTicks, validateStudioGrade, type StudioAsset, type StudioGrade, type StudioRecipeClip, type StudioRenderRecipe } from '../../../../shared/studio/model';
import type { StudioRemoteTake } from '../../../../shared/studio/remoteCamera';
import { exportStudioRecipe, type StudioExportKernel, type StudioExportOptions } from './export';
import { assertStudioActive, studioCanvas, type StudioAssetResolver, type StudioMediaMetadata } from './media';
import { StudioRenderKernel } from './renderer';
import { drawStudioScene } from './sceneCompositionRender';
import { normalizeStudioSceneConfiguration, studioSceneOutputProfile, type StudioCaptureScene, type StudioSceneConfiguration, type StudioSceneOutputProfile } from './sceneTypes';

export type StudioRemoteSceneEvent = { atSeconds: number; scene: StudioCaptureScene; configuration: StudioSceneConfiguration; grade: StudioGrade; zoom: number };
export type StudioRemoteSceneTimeline = {
  output: StudioSceneOutputProfile; events: StudioRemoteSceneEvent[];
  startedAtServerMs: number | null; screenStartedAtServerMs: number | null; cameraOffsetSeconds: number | null;
};
/** Only a real native START acknowledgement establishes the relationship between originals. */
export function studioRemoteSceneOffset(screenStartedAtServerMs: number, startedAtServerMs: number) {
  if (![screenStartedAtServerMs, startedAtServerMs].every(Number.isFinite) || startedAtServerMs <= 0 || screenStartedAtServerMs < startedAtServerMs) throw new Error('Não foi possível confirmar a sincronização dos originais. Eles continuam disponíveis para recuperação.');
  return (screenStartedAtServerMs - startedAtServerMs) / 1000;
}
export function validateStudioRemoteSceneSources(timeline: StudioRemoteSceneTimeline, take: StudioRemoteTake, camera: StudioMediaMetadata, screen: StudioMediaMetadata) {
  const { output, startedAtServerMs, screenStartedAtServerMs, cameraOffsetSeconds } = timeline;
  studioSceneOutputProfile(output.width < output.height ? '9:16' : '16:9', output, {});
  if (startedAtServerMs === null || screenStartedAtServerMs === null || cameraOffsetSeconds === null || Math.abs(studioRemoteSceneOffset(screenStartedAtServerMs, startedAtServerMs) - cameraOffsetSeconds) > .001) throw new Error('A sincronização deste take não foi confirmada. Baixe os originais para preservar sua gravação.');
  const original = take.metadata;
  if (!original || take.status !== 'uploaded' || camera.kind !== 'video' || !camera.width || !camera.height || !camera.frameRate || camera.width !== original.width || camera.height !== original.height || Math.abs(camera.frameRate - original.fps) > Math.max(.05, original.fps * .01)) throw new Error('A resolução ou a cadência do original do iPhone não corresponde ao take confirmado.');
  if (original.startedAtServerMs !== undefined && Math.abs(original.startedAtServerMs - startedAtServerMs) > 50) throw new Error('Os relógios deste take não correspondem. Os originais foram preservados.');
  if (screen.kind !== 'video' || !screen.width || !screen.height || !screen.hasAudio || !Number.isFinite(screen.duration) || screen.duration < .1) throw new Error('A tela original não contém vídeo e áudio válidos.');
  // Never manufacture extra camera frames to fill a missing tail or unknown clock.
  if (!Number.isFinite(camera.duration) || cameraOffsetSeconds + screen.duration > camera.duration + .05) throw new Error('O original do iPhone não cobre toda a gravação da tela. Baixe os dois originais para recuperar o trecho.');
  if (Math.min(camera.width, camera.height) < Math.min(output.width, output.height) || camera.frameRate < output.frameRate - .05) throw new Error('O original do iPhone não entrega a resolução e os FPS escolhidos. Os originais foram preservados.');
  let last = -1;
  if (!timeline.events.length || timeline.events[0].atSeconds !== 0) throw new Error('A cena inicial não foi preservada.');
  for (const event of timeline.events) {
    if (!Number.isFinite(event.atSeconds) || event.atSeconds < last || event.atSeconds < 0 || !['camera', 'screen', 'screen-camera'].includes(event.scene) || validateStudioGrade(event.grade).length || !Number.isFinite(event.zoom) || event.zoom < 1 || event.zoom > 4) throw new Error('O histórico das cenas está incompleto.');
    const normalized = normalizeStudioSceneConfiguration(event.configuration, {}, output.width, output.height);
    if (Math.abs(normalized.size - event.configuration.size) > .000001 || Math.abs(normalized.position.x - event.configuration.position.x) > .000001 || Math.abs(normalized.position.y - event.configuration.position.y) > .000001) throw new Error('O enquadramento de uma cena não é válido.');
    last = event.atSeconds;
  }
  return Math.min(screen.duration, camera.duration - cameraOffsetSeconds);
}
export function studioRemoteSceneAt(events: StudioRemoteSceneEvent[], seconds: number) {
  let index = 0; while (index + 1 < events.length && events[index + 1].atSeconds <= seconds) index++;
  const current = events[index], previous = index ? events[index - 1] : null;
  return { current, previous, blend: previous && current.configuration.transition === 'fade' ? Math.max(0, Math.min(1, (seconds - current.atSeconds) / .22)) : 1 };
}
function sourceAsset(id: string, file: File, metadata: StudioMediaMetadata, audio: boolean): StudioAsset {
  return { id, kind: 'video', uri: `file://${id}`, name: file.name, durationTicks: studioTicks(metadata.duration), width: metadata.width, height: metadata.height, frameRate: metadata.frameRate, hasAudio: audio };
}
function clip(asset: StudioAsset, duration: number, offset: number, gain: number): StudioRecipeClip {
  return { id: asset.id, assetId: asset.id, kind: 'video', startTicks: 0, durationTicks: studioTicks(duration), sourceStartTicks: studioTicks(offset), sourceEndTicks: studioTicks(offset + duration), zIndex: gain ? 0 : 1, rect: { x: 0, y: 0, width: 1, height: 1 }, rotationDegrees: 0, fit: 'cover', opacity: 1, gain, fadeInTicks: 0, fadeOutTicks: 0, effect: 'natural' };
}
function sourceRecipe(asset: StudioAsset, duration: number, offset: number, gain: number): StudioRenderRecipe {
  return { version: 2, timebase: STUDIO_TIMEBASE, durationTicks: studioTicks(duration), mediaType: 'video', canvas: { aspectRatio: asset.width! < asset.height! ? 'portrait' : 'landscape', backgroundColor: '#000000' }, output: { profile: 'legacy-source', width: asset.width!, height: asset.height!, frameRateNumerator: Math.round((asset.frameRate ?? 30) * 1000), frameRateDenominator: 1000, colorSpace: 'source' }, assets: [asset], clips: [clip(asset, duration, offset, gain)] };
}
/** Native camera and raw screen are decoded independently; the transport preview is never an asset. */
export class StudioRemoteSceneRenderKernel implements StudioExportKernel {
  private camera: StudioRenderKernel; private screen: StudioRenderKernel;
  private cameraCanvas: HTMLCanvasElement; private screenCanvas: HTMLCanvasElement; private previousCanvas: HTMLCanvasElement;
  constructor(recipe: StudioRenderRecipe, resolver: StudioAssetResolver, private timeline: StudioRemoteSceneTimeline, private signal?: AbortSignal) {
    const duration = recipe.durationTicks / STUDIO_TIMEBASE, camera = recipe.assets.find(asset => asset.id === 'remote-camera-original')!, screen = recipe.assets.find(asset => asset.id === 'remote-screen-original')!;
    this.camera = new StudioRenderKernel(sourceRecipe(camera, duration, timeline.cameraOffsetSeconds!, 0), resolver, signal);
    this.screen = new StudioRenderKernel(sourceRecipe(screen, duration, 0, 1), resolver, signal);
    this.cameraCanvas = studioCanvas(camera.width!, camera.height!); this.screenCanvas = studioCanvas(screen.width!, screen.height!); this.previousCanvas = studioCanvas(recipe.output.width, recipe.output.height);
  }
  private async scene(canvas: HTMLCanvasElement, event: StudioRemoteSceneEvent, seconds: number) {
    assertStudioActive(this.signal);
    if (event.scene !== 'screen') {
      const clip = this.camera.recipe.clips[0]; clip.grade = { ...event.grade };
      clip.rect = { x: (1 - event.zoom) / 2, y: (1 - event.zoom) / 2, width: event.zoom, height: event.zoom };
      await this.camera.draw(this.cameraCanvas, seconds);
    }
    if (event.scene !== 'camera') await this.screen.draw(this.screenCanvas, seconds);
    assertStudioActive(this.signal); const context = canvas.getContext('2d'); if (!context) throw new Error('Não foi possível preparar a composição dos originais.');
    drawStudioScene(context as unknown as OffscreenCanvasRenderingContext2D, canvas.width, canvas.height, event.scene, event.configuration, this.cameraCanvas, this.screenCanvas);
  }
  async draw(canvas: HTMLCanvasElement, seconds: number) {
    const { current, previous, blend } = studioRemoteSceneAt(this.timeline.events, seconds);
    if (previous && blend < 1) await this.scene(this.previousCanvas, previous, seconds);
    await this.scene(canvas, current, seconds);
    if (previous && blend < 1) { const ctx = canvas.getContext('2d')!; ctx.save(); ctx.globalAlpha = 1 - blend; ctx.drawImage(this.previousCanvas, 0, 0); ctx.restore(); }
  }
  mixAudio(start: number, duration: number, sampleRate: number) { return this.screen.mixAudio(start, duration, sampleRate); }
  dispose() { this.camera.dispose(); this.screen.dispose(); for (const canvas of [this.cameraCanvas, this.screenCanvas, this.previousCanvas]) { canvas.width = 1; canvas.height = 1; } }
}
export async function renderStudioRemoteScene(timeline: StudioRemoteSceneTimeline, take: StudioRemoteTake, cameraFile: File, screenFile: File, cameraMetadata: StudioMediaMetadata, screenMetadata: StudioMediaMetadata, options: StudioExportOptions & { name?: string } = {}) {
  const snapshot = structuredClone(timeline), duration = validateStudioRemoteSceneSources(snapshot, take, cameraMetadata, screenMetadata);
  const camera = sourceAsset('remote-camera-original', cameraFile, cameraMetadata, false), screen = sourceAsset('remote-screen-original', screenFile, screenMetadata, true), { output } = snapshot;
  const recipe: StudioRenderRecipe = { version: 2, timebase: STUDIO_TIMEBASE, durationTicks: studioTicks(duration), mediaType: 'video', canvas: { aspectRatio: output.width < output.height ? 'portrait' : 'landscape', backgroundColor: '#000000' }, output: { profile: 'standard', width: output.width, height: output.height, frameRateNumerator: output.frameRate, frameRateDenominator: 1, colorSpace: 'rec709' }, assets: [camera, screen], clips: [clip(camera, duration, snapshot.cameraOffsetSeconds!, 0), clip(screen, duration, 0, 1)] };
  return exportStudioRecipe(recipe, async id => id === camera.id ? cameraFile : id === screen.id ? screenFile : null, { ...options, kernelFactory: (value, resolver, signal) => new StudioRemoteSceneRenderKernel(value, resolver, snapshot, signal) });
}

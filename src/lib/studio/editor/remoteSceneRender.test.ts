import { describe, expect, it, vi } from 'vitest';
import { studioGrade } from '../../../../shared/studio/model';
import type { StudioRemoteTake } from '../../../../shared/studio/remoteCamera';
import { renderStudioRemoteScene, studioRemoteSceneAt, studioRemoteSceneOffset, validateStudioRemoteSceneSources, type StudioRemoteSceneTimeline } from './remoteSceneRender';
import { studioDefaultSceneConfiguration } from './sceneTypes';
import type { StudioMediaMetadata } from './media';

const exports = vi.hoisted(() => ({ recipe: null as any, options: null as any, export: vi.fn() }));
vi.mock('./export', () => ({ exportStudioRecipe: exports.export }));
const metadata: StudioMediaMetadata = { kind: 'video', width: 3840, height: 2160, frameRate: 30, duration: 6, hasAudio: true, mimeType: 'video/mp4', warnings: [] };
const screen = { ...metadata, width: 2560, height: 1440, duration: 5 };
const take: StudioRemoteTake = { id: 'master', status: 'uploaded', createdAt: '', uploadedAt: '', metadata: { width: 3840, height: 2160, fps: 30, duration: 6, bytes: 1, mime: 'video/mp4', startedAtServerMs: 100_000 } };
const timeline = (): StudioRemoteSceneTimeline => ({ output: { width: 3840, height: 2160, frameRate: 30 }, startedAtServerMs: 100_000, screenStartedAtServerMs: 100_250, cameraOffsetSeconds: .25, events: [{ atSeconds: 0, scene: 'camera', configuration: studioDefaultSceneConfiguration(), grade: studioGrade(), zoom: 1 }, { atSeconds: 2, scene: 'screen-camera', configuration: { ...studioDefaultSceneConfiguration(), transition: 'fade' }, grade: studioGrade('cinematic'), zoom: 1.5 }] });
describe('originais de cenas remotas e sincronização real', () => {
  it('calcula offset do ACK nativo e impede relógio desconhecido ou invertido', () => { expect(studioRemoteSceneOffset(100250, 100000)).toBe(.25); expect(() => studioRemoteSceneOffset(NaN, 100000)).toThrow('sincronização'); expect(() => studioRemoteSceneOffset(99999, 100000)).toThrow('sincronização'); });
  it('recusa ausência de cobertura, fonte 1080 anunciada4K e FPS degradado', () => {
    expect(validateStudioRemoteSceneSources(timeline(), take, metadata, screen)).toBe(5);
    expect(() => validateStudioRemoteSceneSources(timeline(), take, { ...metadata, duration: 5 }, screen)).toThrow('cobre toda');
    expect(() => validateStudioRemoteSceneSources(timeline(), { ...take, metadata: { ...take.metadata!, width: 1920, height: 1080 } }, { ...metadata, width: 1920, height: 1080 }, screen)).toThrow('não entrega');
    expect(() => validateStudioRemoteSceneSources(timeline(), take, { ...metadata, frameRate: 24 }, screen)).toThrow('cadência');
  });
  it('não inventa sincronismo e rejeita histórico fora de ordem', () => {
    expect(() => validateStudioRemoteSceneSources({ ...timeline(), cameraOffsetSeconds: null }, take, metadata, screen)).toThrow('sincronização');
    expect(() => validateStudioRemoteSceneSources(timeline(), { ...take, metadata: { ...take.metadata!, startedAtServerMs: 99900 } }, metadata, screen)).toThrow('relógios');
    const value = timeline(); value.events[1].atSeconds = -1; expect(() => validateStudioRemoteSceneSources(value, take, metadata, screen)).toThrow('histórico');
  });
  it('respeita cada evento e transição de220ms sem mudar o relógio de fonte', () => {
    const events = timeline().events; expect(studioRemoteSceneAt(events, 1.99).current.scene).toBe('camera'); expect(studioRemoteSceneAt(events, 2).blend).toBe(0); expect(studioRemoteSceneAt(events, 2.11).blend).toBeCloseTo(.5); expect(studioRemoteSceneAt(events, 2.22).blend).toBe(1);
  });
  it('receita alimenta export com master e tela RAW, áudio sóMac e corte exatooffset', async () => {
    exports.export.mockImplementation(async (recipe, resolver, options) => { exports.recipe = recipe; exports.options = options; expect(await resolver('remote-camera-original')).toBe(cameraFile); expect(await resolver('remote-screen-original')).toBe(screenFile); return result; });
    const cameraFile = new File(['native'], 'camera.mp4'), screenFile = new File(['raw-screen'], 'screen.webm'), result = new File(['composed'], 'take.mp4');
    expect(await renderStudioRemoteScene(timeline(), take, cameraFile, screenFile, metadata, screen)).toBe(result);
    expect(exports.recipe.output).toMatchObject({ width: 3840, height: 2160, frameRateNumerator: 30 }); expect(exports.recipe.clips[0]).toMatchObject({ sourceStartTicks: 30000, sourceEndTicks: 630000, gain: 0 }); expect(exports.recipe.clips[1]).toMatchObject({ sourceStartTicks: 0, sourceEndTicks: 600000, gain: 1 }); expect(exports.recipe.assets[0].hasAudio).toBe(false); expect(exports.recipe.assets[1].hasAudio).toBe(true); expect(exports.options.kernelFactory).toBeTypeOf('function');
  });
});

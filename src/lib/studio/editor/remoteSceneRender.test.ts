import { beforeEach, describe, expect, it, vi } from 'vitest';
import { studioGrade } from '../../../../shared/studio/model';
import type { StudioRemoteTake } from '../../../../shared/studio/remoteCamera';
import { renderStudioRemoteScene, studioRemoteSceneAt, studioRemoteSceneNarrationSource, studioRemoteSceneOffset, validateStudioRemoteSceneSources, type StudioRemoteSceneTimeline } from './remoteSceneRender';
import { studioDefaultSceneConfiguration } from './sceneTypes';
import type { StudioMediaMetadata } from './media';

const exports = vi.hoisted(() => ({ recipe: null as any, options: null as any, export: vi.fn() }));
vi.mock('./export', () => ({ exportStudioRecipe: exports.export }));
// Decode boundary fixture: the real StudioRenderKernel trims/resamples/mixes these buffers.
const audio = vi.hoisted(() => ({ originals: new Map<string, any>(), requests: [] as { name: string; start: number; end: number }[] }));
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], BlobSource: class { constructor(public blob: File) {} },
  Input: class {
    constructor(private options: any) {}
    async getPrimaryVideoTrack() { return { canDecode: async () => true, getDisplayWidth: async () => 3840, getDisplayHeight: async () => 2160 }; }
    async getPrimaryAudioTrack() { const name = this.options.source.blob.name; return audio.originals.has(name) ? { name, canDecode: async () => true } : null; }
    dispose() {}
  },
  CanvasSink: class {},
  AudioBufferSink: class {
    constructor(private track: { name: string }) {}
    async *buffers(start: number, end: number) { audio.requests.push({ name: this.track.name, start, end }); const buffer = audio.originals.get(this.track.name); if (buffer) yield buffer; }
  },
}));
const metadata: StudioMediaMetadata = { kind: 'video', width: 3840, height: 2160, frameRate: 30, duration: 6, hasAudio: true, mimeType: 'video/mp4', warnings: [] };
const screen = { ...metadata, width: 2560, height: 1440, duration: 5 };
const take: StudioRemoteTake = { id: 'master', status: 'uploaded', createdAt: '', uploadedAt: '', metadata: { width: 3840, height: 2160, fps: 30, duration: 6, bytes: 1, mime: 'video/mp4', startedAtServerMs: 100_000 } };
const timeline = (): StudioRemoteSceneTimeline => ({ output: { width: 3840, height: 2160, frameRate: 30 }, startedAtServerMs: 100_000, screenStartedAtServerMs: 100_250, cameraOffsetSeconds: .25, events: [{ atSeconds: 0, scene: 'camera', configuration: studioDefaultSceneConfiguration(), grade: studioGrade(), zoom: 1 }, { atSeconds: 2, scene: 'screen-camera', configuration: { ...studioDefaultSceneConfiguration(), transition: 'fade' }, grade: studioGrade('cinematic'), zoom: 1.5 }] });
beforeEach(() => { audio.originals.clear(); audio.requests.length = 0; exports.export.mockReset(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
function decoded(name: string, channels: number[][], sampleRate: number) {
  const samples = channels.map(values => new Float32Array(values));
  audio.originals.set(name, { timestamp: 0, duration: samples[0].length / sampleRate, buffer: { sampleRate, length: samples[0].length, numberOfChannels: samples.length, getChannelData: (index: number) => samples[index] } });
}
async function kernel(value: StudioRemoteSceneTimeline, screenMetadata = screen) {
  const cameraFile = new File(['native'], 'camera.mp4'), screenFile = new File(['raw'], 'screen.webm');
  let renderer: any;
  exports.export.mockImplementation(async (recipe, resolver, options) => { exports.recipe = recipe; renderer = options.kernelFactory(recipe, resolver); return new File(['final'], 'final.mp4'); });
  await renderStudioRemoteScene(value, take, cameraFile, screenFile, metadata, screenMetadata);
  return renderer as import('./remoteSceneRender').StudioRemoteSceneRenderKernel;
}
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
    expect(() => validateStudioRemoteSceneSources({ ...timeline(), cameraOffsetSeconds: NaN }, take, metadata, screen)).toThrow('sincronização');
    expect(() => validateStudioRemoteSceneSources(timeline(), { ...take, metadata: { ...take.metadata!, startedAtServerMs: 99900 } }, metadata, screen)).toThrow('relógios');
    const value = timeline(); value.events[1].atSeconds = -1; expect(() => validateStudioRemoteSceneSources(value, take, metadata, screen)).toThrow('histórico');
  });
  it('respeita cada evento e transição de220ms sem mudar o relógio de fonte', () => {
    const events = timeline().events; expect(studioRemoteSceneAt(events, 1.99).current.scene).toBe('camera'); expect(studioRemoteSceneAt(events, 2).blend).toBe(0); expect(studioRemoteSceneAt(events, 2.11).blend).toBeCloseTo(.5); expect(studioRemoteSceneAt(events, 2.22).blend).toBe(1);
  });
  it('receita legada alimenta export com master e tela RAW, áudio sóMac e corte exatooffset', async () => {
    exports.export.mockImplementation(async (recipe, resolver, options) => { exports.recipe = recipe; exports.options = options; expect(await resolver('remote-camera-original')).toBe(cameraFile); expect(await resolver('remote-screen-original')).toBe(screenFile); return result; });
    const cameraFile = new File(['native'], 'camera.mp4'), screenFile = new File(['raw-screen'], 'screen.webm'), result = new File(['composed'], 'take.mp4');
    expect(await renderStudioRemoteScene(timeline(), take, cameraFile, screenFile, metadata, screen)).toBe(result);
    expect(exports.recipe.output).toMatchObject({ width: 3840, height: 2160, frameRateNumerator: 30 }); expect(exports.recipe.clips[0]).toMatchObject({ sourceStartTicks: 30000, sourceEndTicks: 630000, gain: 0 }); expect(exports.recipe.clips[1]).toMatchObject({ sourceStartTicks: 0, sourceEndTicks: 600000, gain: 1 }); expect(exports.recipe.assets[0].hasAudio).toBe(false); expect(exports.recipe.assets[1].hasAudio).toBe(true); expect(exports.options.kernelFactory).toBeTypeOf('function');
  });
  it('mantém ausência de escolha como browser e rejeita fonte ou mute corrompidos', () => {
    expect(studioRemoteSceneNarrationSource(timeline())).toBe('browser');
    expect(() => validateStudioRemoteSceneSources({ ...timeline(), narrationSource: 'unknown' as any }, take, metadata, screen)).toThrow('fonte de voz');
    const value = timeline(); value.events[0].microphoneEnabled = 'yes' as any;
    expect(() => validateStudioRemoteSceneSources(value, take, metadata, screen)).toThrow('histórico');
  });
  it('iPhone exige voz nativa e permite tela sem som; legado exige áudio na tela RAW', () => {
    const value = { ...timeline(), narrationSource: 'iphone' as const };
    expect(() => validateStudioRemoteSceneSources(value, take, { ...metadata, hasAudio: false }, screen)).toThrow('voz gravada');
    expect(validateStudioRemoteSceneSources(value, take, metadata, { ...screen, hasAudio: false })).toBe(5);
    expect(validateStudioRemoteSceneSources(timeline(), take, { ...metadata, hasAudio: false }, screen)).toBe(5);
    expect(() => validateStudioRemoteSceneSources(timeline(), take, metadata, { ...screen, hasAudio: false })).toThrow('vídeo e áudio');
  });
  it('aplica offset uma vez nos impulsos nativos, voz nas três cenas e último sample preservado', async () => {
    const value = { ...timeline(), narrationSource: 'iphone' as const };
    value.events.splice(1, 0, { ...value.events[0], scene: 'screen', atSeconds: 1 }); value.events[2].atSeconds = 3;
    const voice = Array(120).fill(0); voice[5] = .4; voice[30] = .6; voice[70] = .8; voice[104] = .5;
    decoded('camera.mp4', [voice], 20);
    const renderer = await kernel(value, { ...screen, hasAudio: false });
    try {
      const mixed = await renderer.mixAudio(0, 5, 20);
      expect(mixed[0]).toHaveLength(100); expect(mixed[0][0]).toBeCloseTo(.4); expect(mixed[0][25]).toBeCloseTo(.6); expect(mixed[0][65]).toBeCloseTo(.8); expect(mixed[0][99]).toBeCloseTo(.5);
      expect([...mixed[1]]).toEqual([...mixed[0]]); expect([...mixed[0]].filter(v => v !== 0)).toHaveLength(4);
      expect(audio.requests).toEqual([{ name: 'camera.mp4', start: .25, end: 5.3 }]);
      expect(exports.recipe.assets.map((asset: any) => asset.hasAudio)).toEqual([true, false]);
      expect(exports.recipe.clips[0]).toMatchObject({ gain: 1, sourceStartTicks: 30000, sourceEndTicks: 630000 });
    } finally { renderer.dispose(); }
  });
  it('soma voz contínua e sistema jámutado no RAW sem depender da cena visual ou fade', async () => {
    const value = { ...timeline(), narrationSource: 'iphone' as const };
    decoded('camera.mp4', [Array(24).fill(.5)], 4);
    decoded('screen.webm', [[0, 0, 0, 0, 0, 0, 0, 0, .2, .2, .2, .2, .2, .2, .2, .2, .2, .2, .2, .2]], 4);
    const renderer = await kernel(value);
    try {
      expect((await renderer.mixAudio(0, .25, 4))[0][0]).toBe(.5); // camera-only RAW system gate remains zero
      expect((await renderer.mixAudio(2, .25, 4))[0][0]).toBeCloseTo(.7); // visual fade does not fade voice
    } finally { renderer.dispose(); }
  });
  it('mute no meio do bloco afeta só voz, mantém sistema estéreo e limita clipping', async () => {
    const value = { ...timeline(), narrationSource: 'iphone' as const };
    value.events = [{ ...value.events[0], microphoneEnabled: true }, { ...value.events[0], atSeconds: 1.125, microphoneEnabled: false }];
    decoded('camera.mp4', [Array(48).fill(.5)], 8); decoded('screen.webm', [Array(40).fill(.8), Array(40).fill(-.8)], 8);
    const renderer = await kernel(value);
    try {
      const result = await renderer.mixAudio(1, .25, 8);
      expect(result[0][0]).toBe(1); expect(result[1][0]).toBeCloseTo(-.3);
      expect(result[0][1]).toBeCloseTo(.8); expect(result[1][1]).toBeCloseTo(-.8);
    } finally { renderer.dispose(); }
  });
  it.each([undefined, 'browser'] as const)('fonte %s usa só RAW e não duplica nem muta voz baked do browser', async narrationSource => {
    const value = { ...timeline(), narrationSource }; value.events[0].microphoneEnabled = false;
    decoded('camera.mp4', [Array(24).fill(.9)], 4); decoded('screen.webm', [Array(20).fill(.3)], 4);
    const renderer = await kernel(value);
    try { expect((await renderer.mixAudio(0, .25, 4))[0][0]).toBeCloseTo(.3); expect(audio.requests.map(request => request.name)).toEqual(['screen.webm']); }
    finally { renderer.dispose(); }
  });
});

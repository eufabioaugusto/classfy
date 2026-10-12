import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioSceneComposition } from './sceneComposition';
import { drawStudioScene, studioSceneSourceRect } from './sceneCompositionRender';
import { normalizeStudioSceneConfiguration, studioDefaultSceneConfiguration, studioScenesSupport } from './sceneTypes';
import { studioGrade } from '../../../../shared/studio/model';
class Track {
  static values: Track[] = []; kind = 'video'; readyState = 'live'; writable = new WritableStream(); id: number;
  constructor() { this.id = Track.values.length; Track.values.push(this); }
  clone() { return new Track(); } stop = vi.fn(() => { this.readyState = 'ended'; });
}
class Processor { static values: Processor[] = []; readable = new ReadableStream(); constructor(public options: { track: Track; maxBufferSize: number }) { Processor.values.push(this); } }
class Worker {
  static values: Worker[] = []; onmessage: ((event: { data: unknown }) => void) | null = null; onerror: (() => void) | null = null; messages: { message: Record<string, unknown>; transfers: unknown[] }[] = [];
  constructor() { Worker.values.push(this); }
  postMessage(message: Record<string, unknown>, transfers: unknown[] = []) { this.messages.push({ message, transfers }); if (message.type === 'init') queueMicrotask(() => this.emit({ type: 'ready', effects: true })); if (message.type === 'dispose') this.emit({ type: 'disposed' }); }
  emit(data: unknown) { this.onmessage?.({ data }); } terminate = vi.fn();
}
const callbacks = () => ({ onError: vi.fn(), onSourceLost: vi.fn() });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] }); Track.values = []; Worker.values = []; Processor.values = []; vi.stubGlobal('Worker', Worker); vi.stubGlobal('MediaStreamTrackProcessor', Processor); vi.stubGlobal('MediaStreamTrackGenerator', Track); vi.stubGlobal('OffscreenCanvas', function () {}); vi.stubGlobal('VideoFrame', function () {}); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('canal de composição contínua', () => {
  it('transfere streams ao worker sem DOM/RAF; primeiro output confirmado e cena mantêm mesma track', async () => {
    const cb = callbacks(), engine = createStudioSceneComposition({ width: 1920, height: 1080, fps: 30, ...cb }); const worker = Worker.values[0]; await engine.ready(); const source = new Track(), prepared = engine.setSource('camera', source as unknown as MediaStreamTrack); await flush();
    const request = worker.messages.find(value => value.message.type === 'source')!; expect(request.transfers).toEqual([request.message.readable]); expect(worker.messages[0].transfers).toEqual([(engine.track as unknown as Track).writable, worker.messages[0].message.outputReadable]);
    expect(Processor.values[0].options).toEqual({ track: Track.values[1], maxBufferSize: 1 });
    let done = false; void prepared.then(() => { done = true; }); worker.emit({ type: 'source-ready', source: 'camera', id: request.message.id }); await flush(); expect(done).toBe(false); worker.emit({ type: 'frame', timestamp: 123 }); await prepared; expect(done).toBe(true);
    const original = engine.track, configuring = engine.configure('screen-camera', studioDefaultSceneConfiguration(), studioGrade(), 2); const message = worker.messages.at(-1)!.message;
    expect(message).toMatchObject({ type: 'configure', selected: 'screen-camera', zoom: 2 }); worker.emit({ type: 'ack', request: message.request }); await configuring; expect(engine.track).toBe(original); expect(source.stop).not.toHaveBeenCalled(); engine.dispose(); expect(source.stop).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('troca fonte somente após primeiro frame; dispose cancela espera e fecha clones/output sem tocar fonte física', async () => {
    const engine = createStudioSceneComposition({ width: 1080, height: 1920, fps: 30, ...callbacks() }); const worker = Worker.values[0]; await engine.ready(); const source = new Track(), prepared = engine.setSource('screen', source as unknown as MediaStreamTrack); await flush(); const clone = Track.values.at(-1)!;
    engine.dispose(); await expect(prepared).rejects.toMatchObject({ name: 'AbortError' }); expect(clone.stop).toHaveBeenCalled(); expect(source.stop).not.toHaveBeenCalled(); expect((engine.track as unknown as Track).stop).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    worker.emit({ type: 'source-ready', source: 'screen', id: 1 }); expect(clone.readyState).toBe('ended');
  });
  it('falha/pista perdida só afeta a identidade atual; timeout não fabrica ready e output congelado gera erro explícito', async () => {
    const cb = callbacks(), engine = createStudioSceneComposition({ width: 1920, height: 1080, fps: 30, ...cb }); const worker = Worker.values[0]; await engine.ready(); const source = new Track(); const first = engine.setSource('screen', source as unknown as MediaStreamTrack); await flush(); worker.emit({ type: 'source-ready', source: 'screen', id: 1 }); await first;
    const next = engine.setSource('screen', source as unknown as MediaStreamTrack); await flush(); worker.emit({ type: 'source-ready', source: 'screen', id: 2 }); await next; worker.emit({ type: 'source-lost', source: 'screen', id: 1 }); expect(cb.onSourceLost).not.toHaveBeenCalled(); worker.emit({ type: 'source-lost', source: 'screen', id: 2 }); expect(cb.onSourceLost).toHaveBeenCalledWith('screen');
    const camera = engine.setSource('camera', source as unknown as MediaStreamTrack); await flush(); worker.emit({ type: 'source-ready', source: 'camera', id: 3 }); worker.emit({ type: 'frame', timestamp: 1 }); await camera;
    await vi.advanceTimersByTimeAsync(7000); expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('deixaram') })); engine.dispose();
  });
  it('preflight consulta APIs reais, não nome/versão do navegador', () => { expect(studioScenesSupport().supported).toBe(true); vi.stubGlobal('OffscreenCanvas', undefined); expect(studioScenesSupport()).toMatchObject({ supported: false, reason: expect.stringContaining('Chrome') }); });
  it('source-ready antigo após novo pedido não confirma nem substitui fonte mais recente', async () => {
    const cb = callbacks(), engine = createStudioSceneComposition({ width: 1920, height: 1080, fps: 30, ...cb }), worker = Worker.values[0]; await engine.ready(); const source = new Track();
    const old = engine.setSource('screen', source as unknown as MediaStreamTrack); await flush(); const next = engine.setSource('screen', source as unknown as MediaStreamTrack); await flush();
    worker.emit({ type: 'source-ready', source: 'screen', id: 1 }); await expect(old).rejects.toMatchObject({ name: 'AbortError' }); worker.emit({ type: 'source-ready', source: 'screen', id: 2 }); await next;
    worker.emit({ type: 'source-lost', source: 'screen', id: 1 }); expect(cb.onSourceLost).not.toHaveBeenCalled(); expect(source.stop).not.toHaveBeenCalled(); engine.dispose();
  });
  it('observer indisponível falha antes de criar worker ou abrir fontes físicas', () => {
    vi.stubGlobal('MediaStreamTrackProcessor', class { constructor() { throw new Error('Driver recusou observer'); } });
    expect(() => createStudioSceneComposition({ width: 3840, height: 2160, fps: 60, ...callbacks() })).toThrow('confirmar a saída');
    expect(Worker.values).toHaveLength(0); expect(Track.values).toHaveLength(2); expect(Track.values.every(track => track.stop.mock.calls.length === 1)).toBe(true);
  });
  it('dispose permite fechar frames no worker mas termina em prazo limitado se o worker não responde', async () => {
    const engine = createStudioSceneComposition({ width: 3840, height: 2160, fps: 60, ...callbacks() }), worker = Worker.values[0]; await engine.ready();
    worker.postMessage = message => { worker.messages.push({ message, transfers: [] }); };
    engine.dispose(); expect((engine.track as unknown as Track).stop).toHaveBeenCalledOnce(); expect(Track.values[1].stop).toHaveBeenCalledOnce(); expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0); engine.dispose(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
describe('pixels e geometria de cena', () => {
  it('câmera usa cover, tela preserva toda origem e bolha circular mantém proporção nos dois formatos', () => {
    expect(studioSceneSourceRect(1920, 1080, 1080, 1920, 'cover')).toMatchObject({ dw: expect.any(Number), dh: 1920, dy: 0 });
    expect(studioSceneSourceRect(1920, 1080, 1080, 1920, 'contain')).toMatchObject({ dw: 1080, dh: 607.5, dx: 0, dy: 656.25 });
    for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
      const configuration = normalizeStudioSceneConfiguration(studioDefaultSceneConfiguration(), { size: .5, position: { x: 1, y: 0 } }, width, height), diameter = Math.min(width, height) * configuration.size;
      expect(configuration.position.x * width + diameter / 2).toBeCloseTo(width); expect(configuration.position.y * height - diameter / 2).toBeCloseTo(0);
      const context = { save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), clip: vi.fn(), translate: vi.fn(), stroke: vi.fn() };
      const camera = { width: 1920, height: 1080 }, screen = { width: 1920, height: 1080 }; drawStudioScene(context as unknown as OffscreenCanvasRenderingContext2D, width, height, 'screen-camera', configuration, camera as CanvasImageSource, screen as CanvasImageSource);
      expect(context.drawImage).toHaveBeenCalledTimes(2); expect(context.drawImage.mock.calls[0][0]).toBe(screen); expect(context.drawImage.mock.calls[1][0]).toBe(camera); expect(context.clip).toHaveBeenCalledTimes(1); expect(context.arc.mock.calls[0][2]).toBe(diameter / 2);
    }
  });
  it('size/position inválidos rejeitam e zoom é aplicado uma única vez no recorte da câmera', () => {
    expect(() => normalizeStudioSceneConfiguration(studioDefaultSceneConfiguration(), { size: NaN }, 1920, 1080)).toThrow('Revise');
    expect(studioSceneSourceRect(1920, 1080, 1920, 1080, 'cover', 2)).toMatchObject({ sx: 480, sy: 270, sw: 960, sh: 540, dw: 1920, dh: 1080 });
  });
});

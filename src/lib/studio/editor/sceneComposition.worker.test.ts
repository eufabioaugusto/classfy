import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const paint = vi.hoisted(() => ({ draw: vi.fn(), processed: vi.fn((frame: unknown) => frame) }));
vi.mock('./sceneCompositionRender', () => ({ drawStudioScene: paint.draw, createStudioSceneCameraSurface: () => ({ effects: true, draw: paint.processed, dispose: vi.fn() }) }));
type Scope = typeof globalThis & { onmessage: ((event: { data: Record<string, unknown> }) => void) | null };
class Frame { static all: Frame[] = []; displayWidth = 1920; displayHeight = 1080; close = vi.fn(); timestamp = 0; duration = 0; constructor(source?: { width?: number; height?: number }, options?: { timestamp: number; duration?: number }) { this.timestamp = options?.timestamp ?? 0; this.duration = options?.duration ?? 0; this.displayWidth = source?.width ?? 1920; this.displayHeight = source?.height ?? 1080; Frame.all.push(this); } }
class Canvas { constructor(public width: number, public height: number) {} getContext() { return { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn() }; } }
const send = (data: Record<string, unknown>) => (globalThis as Scope).onmessage!({ data });
const source = () => { let control!: ReadableStreamDefaultController<Frame>; const stream = new ReadableStream<Frame>({ start(controller) { control = controller; } }); return { stream, push: (frame: Frame) => control.enqueue(frame), end: () => control.close() }; };
function program(options: { write?: (frame: Frame) => Promise<void> | void; automatic?: boolean } = {}) {
  const monitor = source(), written: Frame[] = [];
  const deliver = (frame = written.at(-1)!, patch: { timestamp?: number; width?: number; height?: number } = {}) => { const received = new Frame({ width: patch.width ?? frame.displayWidth, height: patch.height ?? frame.displayHeight }, { timestamp: patch.timestamp ?? frame.timestamp, duration: frame.duration }); monitor.push(received); return received; };
  const writable = new WritableStream<Frame>({ async write(frame) { written.push(frame); await options.write?.(frame); if (options.automatic !== false) deliver(frame); } });
  return { writable, outputReadable: monitor.stream, written, deliver, end: monitor.end };
}
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
beforeEach(async () => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] }); vi.resetModules(); Frame.all = []; paint.draw.mockClear(); paint.processed.mockClear(); vi.stubGlobal('OffscreenCanvas', Canvas); vi.stubGlobal('VideoFrame', Frame); vi.stubGlobal('postMessage', vi.fn()); await import('./sceneComposition.worker'); });
afterEach(() => { send({ type: 'dispose' }); vi.useRealTimers(); vi.unstubAllGlobals(); delete (globalThis as Scope).onmessage; });
it('worker usa relógio monotônico contínuo, fecha frames e mantém composição durante source/scene changes sem RAF', async () => {
  const output = program(), written = output.written; send({ type: 'init', width: 1920, height: 1080, fps: 30, ...output });
  const camera = source(), screen = source(); send({ type: 'source', source: 'camera', id: 1, readable: camera.stream }); const first = new Frame(); camera.push(first); await flush();
  expect(written).toHaveLength(1); expect(written[0].close).toHaveBeenCalled();
  send({ type: 'source', source: 'screen', id: 2, readable: screen.stream }); screen.push(new Frame()); await flush();
  send({ type: 'configure', selected: 'screen-camera', config: { position: { x: .8, y: .8 }, size: .26, transition: 'fade' }, request: 1 }); await flush();
  await vi.advanceTimersByTimeAsync(100); expect(written.length).toBeGreaterThan(2); expect(paint.draw.mock.calls.at(-1)![3]).toBe('screen-camera');
  const times = written.map(frame => frame.timestamp); expect(times.every((value, i) => i === 0 || value > times[i - 1])).toBe(true);
  const next = new Frame(); camera.push(next); await flush(); expect(first.close).toHaveBeenCalledTimes(1); send({ type: 'dispose' }); expect(next.close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('backpressure guarda só quadro recente e ACK acontece apenas após escrever Program; câmera stale não finge imagem viva', async () => {
  let release!: () => void; const block = new Promise<void>(resolve => { release = resolve; }); let writes = 0; const output = program({ write: async () => { if (writes++ === 0) await block; } });
  send({ type: 'init', width: 1080, height: 1920, fps: 30, ...output }); const camera = source(); send({ type: 'source', source: 'camera', id: 7, readable: camera.stream });
  const first = new Frame(); camera.push(first); await flush(); send({ type: 'configure', selected: 'camera', request: 12 }); const recent = new Frame(); camera.push(recent); await flush(); expect(first.close).toHaveBeenCalledTimes(1);
  expect((globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].type === 'ack')).toBe(false); release(); await flush(); expect((globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].type === 'ack' && call[0].request === 12 && call[0].revision === 1)).toBe(true);
  await vi.advanceTimersByTimeAsync(6100); expect((globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].type === 'source-lost' && call[0].id === 7)).toBe(true); expect(recent.close).toHaveBeenCalledTimes(1);
});
it('primeiro frame atrasado de um reader substituído é descartado e não reverte a câmera', async () => {
  send({ type: 'init', width: 1920, height: 1080, fps: 30, ...program() });
  const old = source(), next = source(), obsolete = new Frame(), current = new Frame();
  send({ type: 'source', source: 'camera', id: 10, readable: old.stream }); old.push(obsolete);
  send({ type: 'source', source: 'camera', id: 11, readable: next.stream }); next.push(current); await flush();
  const events = (globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0]); expect(events.some(event => event.type === 'source-cancelled' && event.id === 10)).toBe(true); expect(events.filter(event => event.type === 'source-ready').map(event => event.id)).toEqual([11]); expect(obsolete.close).toHaveBeenCalledTimes(1); expect(paint.draw.mock.calls.at(-1)![5]).toBe(current);
});
it.each([[3840, 2160], [2160, 3840]])('Program produz frames reais %i × %i a 60 FPS e limita buffers à última imagem', async (width, height) => {
  const output = program(), written = output.written; send({ type: 'init', width, height, fps: 60, ...output });
  const camera = source(); send({ type: 'source', source: 'camera', id: 1, readable: camera.stream }); const input = new Frame(); camera.push(input); await flush();
  await vi.advanceTimersByTimeAsync(100);
  expect(written.length).toBeGreaterThanOrEqual(6); expect(written.every(frame => frame.displayWidth === width && frame.displayHeight === height && frame.duration === 16667)).toBe(true);
  expect(written.every(frame => frame.close.mock.calls.length === 1)).toBe(true); expect(paint.processed).not.toHaveBeenCalled();
  const recent = new Frame(); camera.push(recent); await flush(); expect(input.close).toHaveBeenCalledOnce(); send({ type: 'dispose' }); expect(recent.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('cena de tela dispensa tratamento GPU da câmera mesmo com ajuste de cor ativo', async () => {
  send({ type: 'init', width: 3840, height: 2160, fps: 30, ...program() });
  const camera = source(), screen = source(); send({ type: 'source', source: 'camera', id: 1, readable: camera.stream }); camera.push(new Frame()); await flush();
  send({ type: 'source', source: 'screen', id: 2, readable: screen.stream }); screen.push(new Frame()); await flush();
  send({ type: 'configure', selected: 'screen', grade: { preset: 'natural', intensity: 1, exposure: 1, contrast: 0, saturation: 0, temperature: 0 }, request: 1 }); await flush(); await vi.advanceTimersByTimeAsync(50);
  expect(paint.processed).not.toHaveBeenCalled(); expect(paint.draw.mock.calls.at(-1)![5]).toBeNull();
  send({ type: 'configure', selected: 'screen-camera', request: 2 }); await flush(); expect(paint.processed).toHaveBeenCalled();
});
it('write aceito sem entrega nativa não libera ACK nem acumula outputs; observer fecha frames recebidos', async () => {
  const output = program({ automatic: false }); send({ type: 'init', width: 3840, height: 2160, fps: 60, ...output }); const camera = source(); send({ type: 'source', source: 'camera', id: 1, readable: camera.stream });
  const first = new Frame(); camera.push(first); await flush(); send({ type: 'configure', selected: 'camera', request: 9 });
  for (let i = 0; i < 30; i++) { camera.push(new Frame()); await flush(); await vi.advanceTimersByTimeAsync(16); }
  expect(output.written).toHaveLength(1); expect(first.close).toHaveBeenCalledOnce(); expect((globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].type === 'frame' || call[0].type === 'ack')).toBe(false);
  const observed = output.deliver(); await flush(); expect(observed.close).toHaveBeenCalledOnce(); expect(output.written).toHaveLength(2); expect(output.written[0].close).toHaveBeenCalledOnce();
  const latest = output.deliver(); await flush(); expect(latest.close).toHaveBeenCalledOnce(); expect((globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].type === 'ack' && call[0].request === 9)).toBe(true);
});
it('observer que não entrega frame falha em prazo limitado e fecha todas as referências de vídeo', async () => {
  const output = program({ automatic: false }); send({ type: 'init', width: 3840, height: 2160, fps: 60, ...output }); const camera = source(); send({ type: 'source', source: 'camera', id: 1, readable: camera.stream }); camera.push(new Frame()); await flush();
  await vi.advanceTimersByTimeAsync(8100); await flush(); expect((globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].type === 'error' && call[0].message.includes('saída das cenas não entregou'))).toBe(true);
  expect(Frame.all.every(frame => frame.close.mock.calls.length === 1)).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it.each([{ width: 1920 }, { timestamp: 999999 }])('ACK rejeita dimensão/timestamp diferente no Program observado %j', async patch => {
  const output = program({ automatic: false }); send({ type: 'init', width: 3840, height: 2160, fps: 30, ...output }); const camera = source(); send({ type: 'source', source: 'camera', id: 1, readable: camera.stream }); camera.push(new Frame()); await flush();
  const observed = output.deliver(undefined, patch); await flush(); expect(observed.close).toHaveBeenCalledOnce(); expect((globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].type === 'error' && call[0].message.includes('não confirmou'))).toBe(true); expect(output.written[0].close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('dispose fecha output em voo mesmo com writer travado e cancela observer sem esperar GPU', async () => {
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; }); const output = program({ automatic: false, write: () => blocked });
  send({ type: 'init', width: 3840, height: 2160, fps: 60, ...output }); const camera = source(); send({ type: 'source', source: 'camera', id: 1, readable: camera.stream }); camera.push(new Frame()); await flush();
  expect(output.written).toHaveLength(1); send({ type: 'dispose' }); await flush(); expect(Frame.all.every(frame => frame.close.mock.calls.length === 1)).toBe(true); expect(vi.getTimerCount()).toBe(0);
  release(); await flush(); expect(Frame.all.every(frame => frame.close.mock.calls.length === 1)).toBe(true);
});

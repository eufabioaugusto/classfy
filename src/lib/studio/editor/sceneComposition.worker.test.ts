import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const paint = vi.hoisted(() => ({ draw: vi.fn() }));
vi.mock('./sceneCompositionRender', () => ({ drawStudioScene: paint.draw, createStudioSceneCameraSurface: () => ({ effects: true, draw: (frame: unknown) => frame, dispose: vi.fn() }) }));
type Scope = typeof globalThis & { onmessage: ((event: { data: Record<string, unknown> }) => void) | null };
class Frame { static all: Frame[] = []; displayWidth = 1920; displayHeight = 1080; close = vi.fn(); timestamp = 0; constructor(_source?: unknown, options?: { timestamp: number }) { this.timestamp = options?.timestamp ?? 0; Frame.all.push(this); } }
class Canvas { constructor(public width: number, public height: number) {} getContext() { return { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn() }; } }
const send = (data: Record<string, unknown>) => (globalThis as Scope).onmessage!({ data });
const source = () => { let control!: ReadableStreamDefaultController<Frame>; const stream = new ReadableStream<Frame>({ start(controller) { control = controller; } }); return { stream, push: (frame: Frame) => control.enqueue(frame), end: () => control.close() }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(async () => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] }); vi.resetModules(); Frame.all = []; paint.draw.mockClear(); vi.stubGlobal('OffscreenCanvas', Canvas); vi.stubGlobal('VideoFrame', Frame); vi.stubGlobal('postMessage', vi.fn()); await import('./sceneComposition.worker'); });
afterEach(() => { send({ type: 'dispose' }); vi.useRealTimers(); vi.unstubAllGlobals(); delete (globalThis as Scope).onmessage; });
it('worker usa relógio monotônico contínuo, fecha frames e mantém composição durante source/scene changes sem RAF', async () => {
  const written: Frame[] = [], writable = new WritableStream<Frame>({ write(frame) { written.push(frame); } }); send({ type: 'init', width: 1920, height: 1080, fps: 30, writable });
  const camera = source(), screen = source(); send({ type: 'source', source: 'camera', id: 1, readable: camera.stream }); const first = new Frame(); camera.push(first); await flush();
  expect(written).toHaveLength(1); expect(written[0].close).toHaveBeenCalled();
  send({ type: 'source', source: 'screen', id: 2, readable: screen.stream }); screen.push(new Frame()); await flush();
  send({ type: 'configure', selected: 'screen-camera', config: { position: { x: .8, y: .8 }, size: .26, transition: 'fade' }, request: 1 }); await flush();
  await vi.advanceTimersByTimeAsync(100); expect(written.length).toBeGreaterThan(2); expect(paint.draw.mock.calls.at(-1)![3]).toBe('screen-camera');
  const times = written.map(frame => frame.timestamp); expect(times.every((value, i) => i === 0 || value > times[i - 1])).toBe(true);
  const next = new Frame(); camera.push(next); await flush(); expect(first.close).toHaveBeenCalledTimes(1); send({ type: 'dispose' }); expect(next.close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('backpressure guarda só quadro recente e ACK acontece apenas após escrever Program; câmera stale não finge imagem viva', async () => {
  let release!: () => void; const block = new Promise<void>(resolve => { release = resolve; }); let writes = 0; const writable = new WritableStream<Frame>({ async write() { if (writes++ === 0) await block; } });
  send({ type: 'init', width: 1080, height: 1920, fps: 30, writable }); const camera = source(); send({ type: 'source', source: 'camera', id: 7, readable: camera.stream });
  const first = new Frame(); camera.push(first); await flush(); send({ type: 'configure', selected: 'camera', request: 12 }); const recent = new Frame(); camera.push(recent); await flush(); expect(first.close).toHaveBeenCalledTimes(1);
  expect((globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].type === 'ack')).toBe(false); release(); await flush(); expect((globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].type === 'ack' && call[0].request === 12 && call[0].revision === 1)).toBe(true);
  await vi.advanceTimersByTimeAsync(6100); expect((globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].type === 'source-lost' && call[0].id === 7)).toBe(true); expect(recent.close).toHaveBeenCalledTimes(1);
});
it('primeiro frame atrasado de um reader substituído é descartado e não reverte a câmera', async () => {
  send({ type: 'init', width: 1920, height: 1080, fps: 30, writable: new WritableStream<Frame>() });
  const old = source(), next = source(), obsolete = new Frame(), current = new Frame();
  send({ type: 'source', source: 'camera', id: 10, readable: old.stream }); old.push(obsolete);
  send({ type: 'source', source: 'camera', id: 11, readable: next.stream }); next.push(current); await flush();
  const events = (globalThis.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0]); expect(events.some(event => event.type === 'source-cancelled' && event.id === 10)).toBe(true); expect(events.filter(event => event.type === 'source-ready').map(event => event.id)).toEqual([11]); expect(obsolete.close).toHaveBeenCalledTimes(1); expect(paint.draw.mock.calls.at(-1)![5]).toBe(current);
});

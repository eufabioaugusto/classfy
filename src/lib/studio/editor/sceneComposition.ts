import type { StudioGrade } from '../../../../shared/studio/model';
import type { StudioCaptureScene, StudioSceneConfiguration } from './sceneTypes';
import { studioScenesSupport } from './sceneTypes';

type ProcessorConstructor = new (init: { track: MediaStreamTrack; maxBufferSize: number }) => { readable: ReadableStream<VideoFrame> };
type GeneratorTrack = MediaStreamTrack & { writable: WritableStream<VideoFrame> };
type Scope = typeof globalThis & { MediaStreamTrackProcessor: ProcessorConstructor; MediaStreamTrackGenerator: new (init: { kind: 'video' }) => GeneratorTrack };
type Receipt = { type: string; id?: number; source?: 'camera' | 'screen'; request?: number; effects?: boolean; revision?: number; timestamp?: number; message?: string };
type Waiter = { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
export type StudioSceneComposition = {
  readonly track: MediaStreamTrack; readonly effects: boolean;
  ready(): Promise<void>; setSource(name: 'camera' | 'screen', track: MediaStreamTrack): Promise<void>;
  removeSource(name: 'camera' | 'screen'): void;
  configure(selected: StudioCaptureScene, config: StudioSceneConfiguration, grade: StudioGrade, zoom: number): Promise<void>;
  dispose(): void;
};
/** Transfer raw readable/writable streams to a worker. No DOM video, RAF or hidden-tab canvas clock drives recording. */
export function createStudioSceneComposition({ width, height, fps, onError, onSourceLost }: {
  width: number; height: number; fps: number; onError(error: Error): void; onSourceLost(source: 'camera' | 'screen'): void;
}): StudioSceneComposition {
  const support = studioScenesSupport(); if (!support.supported) throw new Error(support.reason);
  const scope = globalThis as Scope, track = new scope.MediaStreamTrackGenerator({ kind: 'video' });
  const observerTrack = track.clone();
  let observer: { readable: ReadableStream<VideoFrame> };
  try { observer = new scope.MediaStreamTrackProcessor({ track: observerTrack, maxBufferSize: 1 }); }
  catch (error) { observerTrack.stop(); track.stop(); throw new Error('O navegador não permite confirmar a saída das cenas.', { cause: error }); }
  let worker: Worker;
  try { worker = new Worker(new URL('./sceneComposition.worker.ts', import.meta.url), { type: 'module' }); }
  catch (error) { observerTrack.stop(); track.stop(); throw error; }
  let disposed = false, effects = false, sequence = 0, requestSequence = 0, sawFrame = false, lastFrame = performance.now(), rendering = false;
  let terminating: ReturnType<typeof setTimeout> | null = null, terminated = false;
  const terminate = () => { if (terminated) return; terminated = true; if (terminating) clearTimeout(terminating); terminating = null; worker.terminate(); };
  const readers = new Map<number, MediaStreamTrack>(), active: Partial<Record<'camera' | 'screen', number>> = {}, requested: Partial<Record<'camera' | 'screen', number>> = {};
  const waiting = new Map<string, Waiter>();
  const wait = (key: string) => { const pending = new Promise<void>((resolve, reject) => {
    waiting.set(key, { resolve, reject, timer: setTimeout(() => {
      const pending = waiting.get(key); if (!pending) return; waiting.delete(key);
      pending.reject(new Error('A entrada não entregou imagem para as cenas. Confira a câmera ou a tela e tente novamente.'));
    }, 8000) });
  }); void pending.catch(() => undefined); return pending; };
  const settle = (key: string, error?: Error) => { const pending = waiting.get(key); if (!pending) return; clearTimeout(pending.timer); waiting.delete(key); if (error) pending.reject(error); else pending.resolve(); };
  const ready = wait('ready'); void ready.catch(() => undefined);
  const fail = (error: Error) => { if (disposed) return; waiting.forEach(value => { clearTimeout(value.timer); value.reject(error); }); waiting.clear(); onError(error); };
  worker.onmessage = ({ data }: MessageEvent<Receipt>) => {
    if (data.type === 'disposed') { if (disposed) terminate(); return; }
    if (disposed) return;
    if (data.type === 'ready') { effects = !!data.effects; settle('ready'); }
    else if (data.type === 'frame') { lastFrame = performance.now(); sawFrame = true; settle('frame'); }
    else if (data.type === 'source-ready' && data.source && data.id !== undefined) {
      if (requested[data.source] !== data.id) { settle(`source:${data.id}`, new DOMException('Esta entrada foi substituída.', 'AbortError')); readers.get(data.id)?.stop(); readers.delete(data.id); return; }
      const old = active[data.source]; if (old !== undefined && old !== data.id) { readers.get(old)?.stop(); readers.delete(old); }
      active[data.source] = data.id; settle(`source:${data.id}`);
    } else if (data.type === 'source-cancelled' && data.id !== undefined) {
      settle(`source:${data.id}`, new DOMException('Esta entrada foi substituída.', 'AbortError'));
    } else if (data.type === 'ack' && data.request !== undefined) settle(`request:${data.request}`);
    else if ((data.type === 'source-lost' || data.type === 'source-error') && data.source && data.id !== undefined) {
      settle(`source:${data.id}`, new Error(data.message || 'A entrada não entregou imagem.'));
      if (active[data.source] === data.id) onSourceLost(data.source);
    } else if (data.type === 'error') fail(new Error(data.message || 'A composição das cenas foi interrompida.'));
  };
  worker.onerror = () => fail(new Error('O processamento contínuo das cenas foi interrompido. O trecho capturado será preservado.'));
  try { worker.postMessage({ type: 'init', width, height, fps, writable: track.writable, outputReadable: observer.readable }, [track.writable as unknown as Transferable, observer.readable]); }
  catch (error) { terminate(); observerTrack.stop(); track.stop(); settle('ready', error instanceof Error ? error : new Error('Este navegador não permite processar vídeo em segundo plano.')); }
  // This watchdog observes actual worker output, including while the page is hidden; it never manufactures fresh frames.
  const watchdog = setInterval(() => { if (!disposed && rendering && sawFrame && performance.now() - lastFrame > 6000) fail(new Error('As cenas deixaram de entregar imagem. O trecho capturado será preservado.')); }, 1000);
  return {
    track, get effects() { return effects; }, ready() { return ready; },
    async setSource(name, source) {
      await ready; if (disposed) throw new DOMException('Captura cancelada.', 'AbortError');
      const clone = source.clone(), id = ++sequence; readers.set(id, clone); requested[name] = id;
      const pending = wait(`source:${id}`);
      try {
        const input = new scope.MediaStreamTrackProcessor({ track: clone, maxBufferSize: 1 });
        worker.postMessage({ type: 'source', source: name, id, readable: input.readable }, [input.readable as unknown as Transferable]); await pending;
        if (disposed) throw new DOMException('Captura cancelada.', 'AbortError');
        if (name === 'camera' && !sawFrame) { const first = wait('frame'); await first; }
        rendering = true;
      } catch (error) { settle(`source:${id}`, error instanceof Error ? error : new Error('A entrada não entregou imagem.')); worker.postMessage({ type: 'remove', source: name, id }); clone.stop(); readers.delete(id); throw error; }
    },
    removeSource(name) { const id = active[name], candidate = requested[name]; worker.postMessage({ type: 'remove', source: name });
      for (const owned of new Set([id, candidate])) if (owned !== undefined) { settle(`source:${owned}`, new DOMException('Esta entrada foi interrompida.', 'AbortError')); readers.get(owned)?.stop(); readers.delete(owned); }
      delete active[name]; delete requested[name]; },
    async configure(selected, config, grade, zoom) {
      if (disposed) throw new DOMException('Captura cancelada.', 'AbortError'); const request = ++requestSequence, pending = wait(`request:${request}`);
      try { worker.postMessage({ type: 'configure', selected, config, grade, zoom, request }); await pending; }
      catch (error) { settle(`request:${request}`, error instanceof Error ? error : new Error('A configuração das cenas falhou.')); throw error; }
    },
    dispose() {
      if (disposed) return; disposed = true; clearInterval(watchdog); waiting.forEach(value => { clearTimeout(value.timer); value.reject(new DOMException('Captura cancelada.', 'AbortError')); }); waiting.clear(); readers.forEach(value => value.stop()); readers.clear();
      // Allow the worker to close its owned frames/readers before terminating its realm; the deadline also covers a stalled GPU callback.
      if (!terminated) { terminating = setTimeout(terminate, 1000); try { worker.postMessage({ type: 'dispose' }); } catch { terminate(); } }
      observerTrack.stop(); track.stop();
    },
  };
}

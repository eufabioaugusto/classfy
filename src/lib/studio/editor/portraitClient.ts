import type { StudioPortraitFace } from './portraitMask';
import type { StudioPortraitRequest, StudioPortraitResponse } from './portrait.worker';
import { assertStudioActive } from './media';
export type StudioPortraitDetector = { prepare(signal?: AbortSignal): Promise<void>; detect(bitmap: ImageBitmap, signal?: AbortSignal): Promise<StudioPortraitFace>; dispose(): void };
const cancelled = () => new DOMException('O processamento do retrato foi encerrado.', 'AbortError');
export function createStudioPortraitDetector(): StudioPortraitDetector {
  let worker: Worker | null = null, closed = false, serial = 0;
  const pending = new Map<number, { resolve(face: StudioPortraitFace): void; reject(error: unknown): void; cleanup(): void }>();
  const fail = (error: unknown) => { for (const value of pending.values()) { value.cleanup(); value.reject(error); } pending.clear(); worker?.terminate(); worker = null; };
  function initialize() {
    if (worker) return worker;
    try { worker = new Worker(new URL('./portrait.worker.ts', import.meta.url), { type: 'module' }); }
    catch { throw new Error('Este navegador não permite o processamento local do retrato.'); }
    worker.onmessage = ({ data }: MessageEvent<StudioPortraitResponse>) => {
      const value = pending.get(data.id); if (!value) return; pending.delete(data.id); value.cleanup();
      if (data.error) value.reject(new Error(`Não foi possível aplicar o retrato: ${data.error}`)); else value.resolve(data.face ?? []);
    };
    worker.onerror = () => fail(new Error('O processamento local do retrato foi interrompido. Reabra o editor para continuar.'));
    worker.onmessageerror = () => fail(new Error('O resultado do retrato não pôde ser lido.'));
    return worker;
  }
  function request(bitmap: ImageBitmap | null, signal?: AbortSignal): Promise<StudioPortraitFace> {
      if (closed || signal?.aborted) { bitmap?.close(); return Promise.reject(cancelled()); }
      let target: Worker; try { assertStudioActive(signal); target = initialize(); } catch (error) { bitmap?.close(); return Promise.reject(error); }
      const id = ++serial;
      return new Promise((resolve, reject) => {
        const abort = () => { const current = pending.get(id); if (!current) return; pending.delete(id); current.cleanup(); reject(cancelled()); };
        const timer = setTimeout(() => { if (pending.has(id)) fail(new Error('O processamento do retrato excedeu o tempo disponível. Reabra o editor para continuar.')); }, 90000);
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
        pending.set(id, { resolve, reject, cleanup }); signal?.addEventListener('abort', abort, { once: true });
        try { const data: StudioPortraitRequest = bitmap ? { type: 'detect', id, bitmap } : { type: 'prepare', id }; target.postMessage(data, bitmap ? [bitmap] : []); }
        catch (error) { pending.delete(id); cleanup(); bitmap?.close(); reject(error); }
      });
  }
  return {
    async prepare(signal) { await request(null, signal); },
    detect: request,
    dispose() { if (closed) return; closed = true; fail(cancelled()); },
  };
}

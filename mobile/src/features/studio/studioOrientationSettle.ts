import type { StudioOrientationMode } from './studioOrientationManager';

export type StudioOrientationSettlement = 'ready' | 'cancelled' | 'timeout' | 'failed';
export type StudioOrientationSource = {
  request: () => Promise<void>;
  read: () => Promise<StudioOrientationMode | undefined>;
  dimensions: () => { width: number; height: number };
  subscribe: (changed: () => void) => () => void;
  isCurrent: () => boolean;
};

export function studioOrientationDimensionsMatch(mode: StudioOrientationMode, { width, height }: { width: number; height: number }) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    && (mode === 'portrait' ? height > width : width > height);
}

/** A lock receipt is not a UIKit layout receipt. Observe both, within one deadline. */
export function settleStudioOrientation(mode: StudioOrientationMode, source: StudioOrientationSource,
  { signal, timeoutMs = 4000, pollMs = 60, stabilityMs = 120 }: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number; stabilityMs?: number } = {}): Promise<StudioOrientationSettlement> {
  return new Promise(resolve => {
    let done = false, requested = false, reading = false, stableAt: number | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    const deadline = setTimeout(() => finish('timeout'), timeoutMs);
    const cancelled = () => finish('cancelled');
    function finish(result: StudioOrientationSettlement) {
      if (done) return;
      done = true; clearTimeout(deadline);
      if (poll !== undefined) clearTimeout(poll);
      signal?.removeEventListener('abort', cancelled); unsubscribe?.();
      resolve(result);
    }
    function current() {
      if (signal?.aborted || !source.isCurrent()) { finish('cancelled'); return false; }
      return !done;
    }
    function schedule() {
      if (done || poll !== undefined) return;
      poll = setTimeout(() => { poll = undefined; void inspect(); }, pollMs);
    }
    async function inspect() {
      if (!current() || !requested) return;
      if (reading) return;
      reading = true;
      try {
        const observed = await source.read();
        if (!current()) return;
        if (observed === mode && studioOrientationDimensionsMatch(mode, source.dimensions())) {
          stableAt ??= Date.now();
          if (Date.now() - stableAt >= stabilityMs) { finish('ready'); return; }
        } else stableAt = undefined;
      } catch { if (current()) stableAt = undefined; }
      finally { reading = false; if (!done) schedule(); }
    }
    signal?.addEventListener('abort', cancelled, { once: true });
    if (!current()) return;
    try { unsubscribe = source.subscribe(() => { stableAt = undefined; void inspect(); }); }
    catch { finish('failed'); return; }
    Promise.resolve().then(() => current() ? source.request() : undefined).then(() => {
      if (!current()) return;
      requested = true; void inspect();
    }, () => { if (current()) finish('failed'); });
  });
}

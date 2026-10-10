export type StudioOrientationMode = 'landscape' | 'portrait';
export type StudioPresentation = 'capture' | 'editor' | 'preview';

export function studioOrientationMode(kind: string | undefined, presentation: StudioPresentation = 'capture'): StudioOrientationMode {
  return presentation !== 'editor' && kind === 'aula' ? 'landscape' : 'portrait';
}

export function createStudioOrientationManager(apply: (mode: StudioOrientationMode) => Promise<void>,
  { applyTimeoutMs = 1500 }: { applyTimeoutMs?: number } = {}) {
  const requests = new Map<symbol, { mode: StudioOrientationMode; sequence: number }>();
  let sequence = 0;
  let applied: StudioOrientationMode | undefined;
  let queue: Promise<void> = Promise.resolve();
  let attemptSequence = 0;
  function latestRequest() {
    let latest: { token: symbol; mode: StudioOrientationMode; sequence: number } | undefined;
    for (const [token, request] of requests) if (!latest || request.sequence > latest.sequence) latest = { token, ...request };
    return latest;
  }
  function target(): StudioOrientationMode { return latestRequest()?.mode || 'portrait'; }
  function boundedApply(mode: StudioOrientationMode) {
    const attempt = ++attemptSequence;
    let expired = false;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        expired = true; applied = undefined;
        reject(new Error('A orientação não respondeu a tempo.'));
      }, applyTimeoutMs);
      Promise.resolve().then(() => apply(mode)).then(() => {
        clearTimeout(timer);
        if (expired) {
          // A native request cannot be aborted. A late acknowledgement may
          // have changed the mask, so reassert the latest focus, never its caller.
          applied = undefined;
          if (target() !== mode) void reconcile(true).catch(() => undefined);
          return;
        }
        if (attempt === attemptSequence && target() === mode) applied = mode;
        resolve();
      }, error => {
        clearTimeout(timer);
        if (!expired) { applied = undefined; reject(error); }
      });
    });
  }
  function reconcile(force = false) {
    const operation = queue.catch(() => undefined).then(async () => {
      // Resolve the current focused screen at execution time, rather than
      // replaying a stale portrait cleanup after a new camera has entered.
      const wanted = target();
      if (!force && wanted === applied) return;
      await boundedApply(wanted);
    });
    queue = operation;
    return operation;
  }
  return {
    request(token: symbol, mode: StudioOrientationMode, { force = false }: { force?: boolean } = {}) {
      requests.set(token, { mode, sequence: ++sequence });
      return reconcile(force);
    },
    release(token: symbol) {
      if (!requests.delete(token)) return Promise.resolve();
      return reconcile();
    },
    target,
    isCurrent(token: symbol, mode: StudioOrientationMode) { const latest = latestRequest(); return latest?.token === token && latest.mode === mode; },
  };
}

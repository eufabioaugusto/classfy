export type StudioOrientationMode = 'landscape' | 'portrait';

export function createStudioOrientationManager(apply: (mode: StudioOrientationMode) => Promise<void>) {
  const requests = new Map<symbol, { mode: StudioOrientationMode; sequence: number }>();
  let sequence = 0;
  let applied: StudioOrientationMode | undefined;
  let queue: Promise<void> = Promise.resolve();
  function target(): StudioOrientationMode {
    let latest: { mode: StudioOrientationMode; sequence: number } | undefined;
    for (const request of requests.values()) if (!latest || request.sequence > latest.sequence) latest = request;
    return latest?.mode || 'portrait';
  }
  function reconcile() {
    const operation = queue.catch(() => undefined).then(async () => {
      // Resolve the current focused screen at execution time, rather than
      // replaying a stale portrait cleanup after a new camera has entered.
      const wanted = target();
      if (wanted === applied) return;
      await apply(wanted);
      applied = wanted;
    });
    queue = operation;
    return operation;
  }
  return {
    request(token: symbol, mode: StudioOrientationMode) {
      requests.set(token, { mode, sequence: ++sequence });
      return reconcile();
    },
    release(token: symbol) {
      requests.delete(token);
      return reconcile();
    },
    target,
  };
}

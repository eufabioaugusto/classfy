type VideoStopOptions = {
  stop: () => void;
  isCurrent: () => boolean;
  isRecording?: () => Promise<boolean | undefined>;
  timeoutMs?: number;
  intervalMs?: number;
  probeTimeoutMs?: number;
};

/** Stop belongs to one file promise and one camera, even before native REC starts. */
export function createStudioVideoStopOperation(options: VideoStopOptions) {
  const timeout = options.timeoutMs ?? 8000;
  const interval = options.intervalMs ?? 80;
  const probeTimeout = options.probeTimeoutMs ?? 300;
  const waits = new Map<ReturnType<typeof setTimeout>, () => void>();
  let active = true;
  let settled = false;
  let stopping: Promise<boolean> | null = null;

  function clearWaits() {
    for (const [timer, resolve] of waits) { clearTimeout(timer); resolve(); }
    waits.clear();
  }
  function wait(milliseconds: number) {
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => { waits.delete(timer); resolve(); }, milliseconds);
      waits.set(timer, resolve);
    });
  }
  function current() { return active && !settled && options.isCurrent(); }
  function stop() {
    if (!current()) return;
    try { options.stop(); } catch { /* The file promise still owns failure and recovery. */ }
  }
  async function requestStop() {
    if (settled) return true;
    if (stopping) return stopping;
    if (!current()) return false;
    const operation = (async () => {
      const deadline = Date.now() + timeout;
      // Immediate stop keeps ordinary, already-running captures responsive.
      // If it arrives before startRecording, retain the intent and retry.
      stop();
      while (current() && Date.now() < deadline) {
        let recording: boolean | undefined;
        if (options.isRecording) {
          const remaining = Math.max(1, Math.min(probeTimeout, deadline - Date.now()));
          recording = await Promise.race([
            Promise.resolve().then(options.isRecording).catch(() => undefined),
            wait(remaining).then(() => undefined),
          ]);
        }
        if (settled) return true;
        if (!current()) return false;
        stop();
        // isRecording was observed on the owned native session before this stop.
        // Its file promise now handles finalization and saving, without polling.
        if (recording === true) return true;
        await wait(Math.max(1, Math.min(interval, deadline - Date.now())));
      }
      return settled;
    })();
    stopping = operation;
    try { return await operation; }
    finally { if (stopping === operation) stopping = null; clearWaits(); }
  }
  return {
    requestStop,
    settle() { settled = true; clearWaits(); },
    dispose() { active = false; clearWaits(); },
  };
}

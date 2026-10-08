import type { VideoPlayerEvents, VideoPlayerStatus, VideoSource } from 'expo-video';
type PreviewEvents = Pick<VideoPlayerEvents, 'sourceChange' | 'sourceLoad' | 'statusChange'>;

export interface StudioPreviewSourcePlayer {
  readonly status: VideoPlayerStatus;
  replaceAsync(source: string | null): Promise<void>;
  addListener<E extends keyof PreviewEvents>(event: E, listener: PreviewEvents[E]): { remove(): void };
}

export class StudioPreviewSourceCancelledError extends Error {
  constructor() {
    super('A prévia mudou antes de terminar o carregamento.');
    this.name = 'StudioPreviewSourceCancelledError';
  }
}

export type StudioPreviewSourceReplacement = {
  promise: Promise<void>;
  cancel(): void;
  /** The native call cannot be aborted. Keep replacements serialized through this promise. */
  settled: Promise<void>;
};

function sourceUri(source: VideoSource): string | null | undefined {
  if (source === null || typeof source === 'string') return source;
  return typeof source === 'object' ? source.uri : undefined;
}

/**
 * iOS replaceAsync can resolve before its main-queue AVPlayerItem replacement.
 * Wait for that item's source, metadata and readiness before the caller seeks or plays.
 * This helper never changes playback position or starts playback.
 */
export function replaceStudioPreviewSource(
  player: StudioPreviewSourcePlayer,
  uri: string | null,
  isCurrent: () => boolean,
  timeoutMs = 15_000,
): StudioPreviewSourceReplacement {
  const subscriptions: { remove(): void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let started = false;
  let nativeResolved = false;
  let applied = false;
  let loaded = false;
  let ready = false;
  let initiallyIdle = false;
  let resolveHandshake!: () => void;
  let rejectHandshake!: (reason: Error) => void;
  let resolveNative!: () => void;
  let rejectNative!: (reason: Error) => void;
  const handshake = new Promise<void>((resolve, reject) => { resolveHandshake = resolve; rejectHandshake = reject; });
  const native = new Promise<void>((resolve, reject) => { resolveNative = resolve; rejectNative = reject; });

  function cleanup() {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    for (const subscription of subscriptions.splice(0)) {
      try { subscription.remove(); } catch { /* Native shared object may already be released. */ }
    }
  }
  function fail(reason: Error) {
    if (finished) return;
    finished = true;
    cleanup();
    rejectHandshake(reason);
    if (!started) resolveNative();
  }
  function cancel() { fail(new StudioPreviewSourceCancelledError()); }
  function current() {
    if (finished) return false;
    try { if (isCurrent()) return true; } catch { /* An obsolete caller is treated as cancellation. */ }
    cancel();
    return false;
  }
  function complete() {
    if (!current() || !nativeResolved || !applied || (uri !== null && (!loaded || !ready))) return;
    finished = true;
    cleanup();
    resolveHandshake();
  }

  // Register rejection handlers before native callbacks can fire synchronously.
  const promise = Promise.all([native, handshake]).then(() => undefined).finally(cleanup);
  const settled = native.then(() => undefined, () => undefined);
  try {
    initiallyIdle = player.status === 'idle';
    subscriptions.push(player.addListener('sourceChange', event => {
      if (!current()) return;
      applied = sourceUri(event.source) === uri;
      loaded = false;
      ready = false;
      complete();
    }));
    subscriptions.push(player.addListener('sourceLoad', event => {
      if (!current() || !applied || sourceUri(event.videoSource) !== uri) return;
      loaded = true;
      // The status getter also handles readyToPlay arriving before metadata.
      try {
        const status = player.status;
        if (status === 'error') { fail(new Error('Não foi possível carregar este take.')); return; }
        ready = status === 'readyToPlay';
      } catch { fail(new Error('Não foi possível preparar a prévia deste take.')); return; }
      complete();
    }));
    subscriptions.push(player.addListener('statusChange', event => {
      if (!current() || !applied) return;
      if (event.status === 'error') { fail(new Error('Não foi possível carregar este take.')); return; }
      ready = event.status === 'readyToPlay';
      complete();
    }));
    timer = setTimeout(() => {
      if (current()) fail(new Error('Este take demorou para carregar. Tente novamente.'));
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000);
    if (current()) {
      started = true;
      Promise.resolve(player.replaceAsync(uri)).then(() => {
        nativeResolved = true;
        resolveNative();
        if (!current()) return;
        // Clearing a player that was already empty may emit no sourceChange.
        // An idle player has no drawable item, so no metadata/readiness is needed.
        try {
          if (uri === null && initiallyIdle && player.status === 'idle') applied = true;
        } catch { fail(new Error('Não foi possível preparar a prévia deste take.')); return; }
        complete();
      }, () => {
        const error = new Error('Não foi possível carregar este take.');
        rejectNative(error);
        fail(error);
      });
    }
  } catch {
    const error = new Error('Não foi possível preparar a prévia deste take.');
    rejectNative(error);
    fail(error);
  }
  return { promise, cancel, settled };
}

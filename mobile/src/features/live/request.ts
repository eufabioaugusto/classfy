import { LiveBackendError, LiveCancelledError } from './model';

// A Live request has a 25 s deadline. A timeout means the server outcome may be
// unknown; callers must reconcile an initiated mutation instead of retrying it.
export const LIVE_REQUEST_TIMEOUT_MS = 25_000;
export const LIVE_REQUEST_TIMEOUT_MESSAGE = 'A conexão demorou mais que o esperado. Atualize a live para conferir o resultado antes de tentar novamente.';

export function withLiveDeadline<T>(run: (signal: AbortSignal) => PromiseLike<T>, signal?: AbortSignal | null,
  timeoutMs = LIVE_REQUEST_TIMEOUT_MS): Promise<T> {
  if (signal?.aborted) return Promise.reject(new LiveCancelledError());
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => { reject(new LiveCancelledError()); controller.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      // Reject first: an SDK AbortError must not hide the useful deadline error.
      reject(new LiveBackendError(LIVE_REQUEST_TIMEOUT_MESSAGE, undefined, 'request_timeout'));
      controller.abort();
    }, timeoutMs);
  });
  // Race explicitly: some native fetch implementations ignore AbortController.
  // The losing operation still has a rejection handler through Promise.race.
  const operation = Promise.resolve().then(() => {
    if (controller.signal.aborted) throw new LiveCancelledError();
    return run(controller.signal);
  });
  return Promise.race([operation, stopped]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  });
}

/** Bound the captured Live client only; the app's global Supabase is unchanged. */
export function createLiveFetch(check?: () => void, scopeSignal?: AbortSignal): typeof fetch {
  return async (input, init) => {
    check?.();
    // SDK/operation cancellation and the screen's signal both abort transport.
    const combined = new AbortController();
    const sources = [init?.signal, scopeSignal].filter((value): value is AbortSignal => !!value);
    const abort = () => combined.abort();
    for (const signal of sources) {
      if (signal.aborted) combined.abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    try {
      const response = await withLiveDeadline(signal => fetch(input, { ...init, signal }), combined.signal);
      check?.();
      return response;
    } finally { for (const signal of sources) signal.removeEventListener('abort', abort); }
  };
}

/** Functions/Auth wrap fetch errors; PostgREST serializes their messages. */
export function liveRequestFailure(error: unknown, depth = 0): LiveBackendError | LiveCancelledError | undefined {
  if (error instanceof LiveBackendError && error.code === 'request_timeout' || error instanceof LiveCancelledError) return error;
  if (!error || typeof error !== 'object' || depth > 3) return;
  const value = error as { message?: unknown; code?: unknown; context?: unknown; cause?: unknown; name?: unknown };
  if (value.code === 'request_timeout' || typeof value.message === 'string' && value.message.includes(LIVE_REQUEST_TIMEOUT_MESSAGE)) {
    return new LiveBackendError(LIVE_REQUEST_TIMEOUT_MESSAGE, undefined, 'request_timeout');
  }
  if (value.name === 'LiveCancelledError' || typeof value.message === 'string' && value.message.includes('LiveCancelledError:')) return new LiveCancelledError();
  return liveRequestFailure(value.context, depth + 1) ?? liveRequestFailure(value.cause, depth + 1);
}

export type StudioFilmstripSample = { key: string; seconds: number };
export type StudioFilmstripFrame = StudioFilmstripSample & { timestampMs: number };
export const STUDIO_FILMSTRIP_VERSION = 'v1-avasset-jpeg960-t100';

export function studioFilmstripSampleWindow(samples: readonly StudioFilmstripSample[], duration: number): StudioFilmstripFrame[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const lastMs = Math.max(0, Math.floor((duration - 0.01) * 1000));
  const keys = new Set<string>();
  const frames: StudioFilmstripFrame[] = [];
  for (const sample of samples) {
    if (!sample.key || keys.has(sample.key) || !Number.isFinite(sample.seconds)) continue;
    keys.add(sample.key);
    const requested = Math.max(0, Math.min(lastMs, sample.seconds * 1000));
    const timestampMs = Math.max(0, Math.min(lastMs, Math.round(requested / 250) * 250));
    frames.push({ key: sample.key, seconds: timestampMs / 1000, timestampMs });
  }
  return frames;
}

/** Ten source frames cover the whole visible window, including both ends. */
export function normalizeStudioFilmstripSamples(samples: readonly StudioFilmstripSample[], duration: number): StudioFilmstripFrame[] {
  const unique = new Map<number, StudioFilmstripFrame>();
  for (const frame of studioFilmstripSampleWindow(samples, duration)) if (!unique.has(frame.timestampMs)) unique.set(frame.timestampMs, frame);
  const window = [...unique.values()].sort((a, b) => a.timestampMs - b.timestampMs);
  if (window.length <= 10) return window;
  return Array.from({ length: 10 }, (_, index) => window[Math.round(index * (window.length - 1) / 9)]);
}

/** Only ready timestamps chosen for this window can fill its requested cells. */
export function mapStudioFilmstripSamples(requests: readonly StudioFilmstripFrame[], selected: readonly StudioFilmstripFrame[], ready: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const available = selected.filter(frame => typeof ready[String(frame.timestampMs)] === 'string' && !!ready[String(frame.timestampMs)]);
  if (!available.length) return {};
  return Object.fromEntries(requests.map(request => {
    let nearest = available[0];
    for (const frame of available) if (Math.abs(frame.timestampMs - request.timestampMs) < Math.abs(nearest.timestampMs - request.timestampMs)) nearest = frame;
    return [request.key, ready[String(nearest.timestampMs)]];
  }));
}

type FilmstripRequest = { sourceUri: string; outputUri: string; directory: string; seconds: number };
type FileInfo = { exists: boolean; isDirectory?: boolean; size?: number };
type FilmstripStorage = {
  info: (uri: string) => Promise<FileInfo>;
  makeDirectory: (uri: string) => Promise<void>;
  remove: (uri: string) => Promise<void>;
  move: (from: string, to: string) => Promise<void>;
  generate: (sourceUri: string, outputUri: string, seconds: number) => Promise<unknown>;
  uniqueId: () => string;
};
type Listener = (uri: string) => void;
type Job = { request: FilmstripRequest; listeners: Map<Listener, () => boolean>; started: boolean };

/** Shared decoder queue; unsubscribed cells never begin an expensive extraction. */
export function createStudioFilmstripCache(storage: FilmstripStorage) {
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let running = false;
  function wanted(job: Job) {
    for (const [listener, isWanted] of job.listeners) if (!isWanted()) job.listeners.delete(listener);
    return job.listeners.size > 0;
  }

  async function readable(uri: string) {
    try {
      const info = await storage.info(uri);
      return info.exists && !info.isDirectory && (info.size ?? 0) > 0;
    } catch { return false; }
  }
  async function load(job: Job): Promise<string | undefined> {
    const { sourceUri, outputUri, directory, seconds } = job.request;
    if (await readable(outputUri)) return outputUri;
    if (!wanted(job)) return undefined;
    await storage.makeDirectory(directory);
    if (!wanted(job)) return undefined;
    // Native extraction refuses existing destinations. A unique temporary file
    // also keeps a partially written JPEG out of the shared cache namespace.
    const temporary = `${outputUri}.${storage.uniqueId()}.tmp.jpg`;
    try {
      await storage.generate(sourceUri, temporary, seconds);
      if (!await readable(temporary)) return undefined;
      // Another runtime (e.g. Fast Refresh) may have finished the same frame.
      if (await readable(outputUri)) return outputUri;
      try {
        const existing = await storage.info(outputUri);
        if (existing.exists && !existing.isDirectory && (existing.size ?? 0) > 0) return outputUri;
        if (existing.exists) await storage.remove(outputUri);
      } catch { /* A missing cache file can still be moved into place. */ }
      try { await storage.move(temporary, outputUri); }
      catch { if (!await readable(outputUri)) return undefined; }
      return await readable(outputUri) ? outputUri : undefined;
    } finally { await storage.remove(temporary).catch(() => undefined); }
  }
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const job = queue.shift()!;
        const key = job.request.outputUri;
        if (jobs.get(key) !== job || !wanted(job)) {
          if (jobs.get(key) === job) jobs.delete(key);
          continue;
        }
        job.started = true;
        try {
          const uri = await load(job);
          // A listener can cause another cell to subscribe during notification.
          // Remove the completed job first so that subscriber gets a fresh
          // cache lookup rather than joining a notification already in progress.
          if (jobs.get(key) === job) jobs.delete(key);
          if (uri) for (const listener of [...job.listeners.keys()]) {
            if (job.listeners.get(listener)?.()) listener(uri);
          }
        } catch { /* The caller keeps its cover while a frame is unavailable. */ }
        finally { if (jobs.get(key) === job) jobs.delete(key); }
      }
    } finally { running = false; }
  }
  return {
    subscribe(request: FilmstripRequest, listener: Listener, isWanted = () => true) {
      const key = request.outputUri;
      let job = jobs.get(key);
      if (!job) {
        job = { request, listeners: new Map(), started: false };
        jobs.set(key, job); queue.push(job);
      }
      job.listeners.set(listener, isWanted);
      // Yield once so all cells in one render subscribe before processing begins.
      void Promise.resolve().then(pump);
      const subscribed = job;
      return () => {
        subscribed.listeners.delete(listener);
        if (!subscribed.started && !subscribed.listeners.size && jobs.get(key) === subscribed) {
          jobs.delete(key);
          const index = queue.indexOf(subscribed);
          if (index >= 0) queue.splice(index, 1);
        }
      };
    },
  };
}

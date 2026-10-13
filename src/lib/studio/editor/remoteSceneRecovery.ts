import type { StudioRemoteSession, StudioRemoteTake } from '../../../../shared/studio/remoteCamera';
import { inspectStudioMedia, assertStudioActive, type StudioMediaMetadata } from './media';
import { createStudioRemoteClient, type StudioRemoteClient } from './remoteCameraClient';
import { createStudioRemoteCapture, validateStudioRemoteMaster, type StudioRemoteCaptureController } from './remoteCameraCapture';
import { renderStudioRemoteScene, type StudioRemoteSceneTimeline } from './remoteSceneRender';
import { createStudioSceneRecordingBuffer } from './sceneRecordingBuffer';

export const STUDIO_REMOTE_SCREEN_DATABASE = 'classfy-studio-remote-screen-chunks-v1';
export function studioRemoteScreenFileName(mime: string) { return `Tela original Classfy.${mime.split(';')[0].trim() === 'video/mp4' ? 'mp4' : 'webm'}`; }
export type StudioRemoteSceneRecovery = StudioRemoteSceneTimeline & {
  version: 1; key: string; owner: string; sessionId: string; controllerId: string; takeId: string | null;
  bufferId: string; screenMime: string; title: string; createdAt: number;
  status: 'preparing' | 'recording' | 'awaiting-master' | 'exporting' | 'recoverable' | 'complete';
  screenFile?: File; screenMetadata?: StudioMediaMetadata; cameraFile?: File; cameraMetadata?: StudioMediaMetadata;
  take?: StudioRemoteTake; session?: StudioRemoteSession; outputFile?: File; error?: string;
};
export type StudioRemoteSceneStore = {
  save(entry: StudioRemoteSceneRecovery): Promise<void>;
  get(owner: string, key: string): Promise<StudioRemoteSceneRecovery | null>;
  list(owner: string): Promise<StudioRemoteSceneRecovery[]>;
};
const databaseName = 'classfy-studio-remote-scenes-v1';
export function createStudioRemoteSceneStore(factory: IDBFactory | undefined = globalThis.indexedDB, name = databaseName): StudioRemoteSceneStore {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    if (!factory) { reject(new Error('Este navegador não oferece armazenamento para preservar os originais.')); return; }
    const request = factory.open(name, 1); let rejected = false;
    request.onupgradeneeded = () => { const store = request.result.createObjectStore('takes', { keyPath: 'key' }); store.createIndex('owner', 'owner'); };
    request.onerror = () => reject(request.error); request.onblocked = () => { rejected = true; reject(new Error('Feche uma aba antiga do Studio para preservar os originais.')); };
    request.onsuccess = () => { if (rejected) request.result.close(); else resolve(request.result); };
  });
  async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    try { return await new Promise<T>((resolve, reject) => { const tx = db.transaction('takes', mode), request = operation(tx.objectStore('takes')); let result: T;
      request.onsuccess = () => { result = request.result; }; tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    }); } finally { db.close(); }
  }
  const own = (entry: StudioRemoteSceneRecovery, owner: string) => { if (!owner || entry.owner !== owner || !entry.key.startsWith(`${owner}:`)) throw new Error('Este original pertence a outra conta.'); return entry; };
  return {
    async save(entry) { own(entry, entry.owner); await transaction('readwrite', store => store.put(entry)); },
    async get(owner, key) { if (!key.startsWith(`${owner}:`)) throw new Error('Este original pertence a outra conta.'); const entry = await transaction<StudioRemoteSceneRecovery | undefined>('readonly', store => store.get(key)); return entry ? own(entry, owner) : null; },
    async list(owner) { if (!owner) return []; return (await transaction<StudioRemoteSceneRecovery[]>('readonly', store => store.index('owner').getAll(owner))).map(entry => own(entry, owner)).sort((a, b) => b.createdAt - a.createdAt); },
  };
}
const active = new Map<string, Promise<File>>();
export type StudioRemoteSceneRecoveryOptions = {
  remote?: StudioRemoteCaptureController; store?: StudioRemoteSceneStore; client?: StudioRemoteClient; signal?: AbortSignal;
  inspect?: typeof inspectStudioMedia; render?: typeof renderStudioRemoteScene;
};
/** Idempotent recovery never starts a second native take or deletes either original. */
export function recoverStudioRemoteScene(owner: string, key: string, options: StudioRemoteSceneRecoveryOptions = {}): Promise<File> {
  if (!owner || !key.startsWith(`${owner}:`)) return Promise.reject(new Error('Este original pertence a outra conta.'));
  const existing = active.get(key); if (existing) return existing;
  const work = (async () => {
    const store = options.store ?? createStudioRemoteSceneStore(), inspect = options.inspect ?? inspectStudioMedia;
    const stored = await store.get(owner, key); if (!stored) throw new Error('Os originais deste take não foram encontrados neste navegador.');
    const entry: StudioRemoteSceneRecovery = { ...stored, output: { ...stored.output }, events: structuredClone(stored.events) };
    assertStudioActive(options.signal); if (entry.outputFile) return entry.outputFile;
    // Freeze the recorded audio choice/mutes before downloads. UI changes or retry must never
    // reinterpret a legacy RAW microphone as native narration, nor add both microphones.
    const recordedTimeline: StudioRemoteSceneTimeline = { output: { ...entry.output }, events: structuredClone(entry.events), startedAtServerMs: entry.startedAtServerMs, screenStartedAtServerMs: entry.screenStartedAtServerMs, cameraOffsetSeconds: entry.cameraOffsetSeconds, ...(entry.narrationSource !== undefined ? { narrationSource: entry.narrationSource } : {}) };
    let ownedRemote: StudioRemoteCaptureController | null = null;
    let screenFailure: unknown = null;
    try {
      if (!entry.screenFile) {
        try { const buffer = createStudioSceneRecordingBuffer({ databaseName: STUDIO_REMOTE_SCREEN_DATABASE, id: entry.bufferId }); await buffer.prepare();
          entry.screenFile = await buffer.file(studioRemoteScreenFileName(entry.screenMime), entry.screenMime); await store.save(entry);
        } catch (error) { screenFailure = error; }
      }
      assertStudioActive(options.signal);
      if (!entry.cameraFile || !entry.take) {
        const client = options.client ?? createStudioRemoteClient(owner), scope = { signal: options.signal };
        const envelope = await client.request({ action: 'status', sessionId: entry.sessionId, clientId: entry.controllerId }, scope);
        const takeId = entry.takeId ?? envelope.session.activeTakeId;
        if (!takeId) throw new Error('O iPhone ainda não confirmou qual take foi iniciado. Os arquivos disponíveis continuam preservados.');
        entry.takeId = takeId; const take = envelope.takes.find(value => value.id === takeId);
        if (take?.status === 'uploaded') {
          const descriptor = await client.request({ action: 'download', sessionId: entry.sessionId, takeId, clientId: entry.controllerId, partStart: 0, partCount: 100 }, scope);
          if (!descriptor.download) throw new Error('O original do iPhone ainda não está disponível.');
          const blob = await client.download(descriptor.download, { ...scope, cacheKey: `${entry.sessionId}-${takeId}`, nextPage: async partStart => {
            const page = await client.request({ action: 'download', sessionId: entry!.sessionId, takeId, clientId: entry!.controllerId, partStart, partCount: 100 }, scope);
            if (!page.download) throw new Error('Uma parte do original está indisponível.'); return page.download;
          } });
          if (blob.size !== take.metadata?.bytes) throw new Error('O original recebido ficou incompleto. Tente novamente.');
          // Persist the real original before decoding: HEVC support must not prevent downloading it.
          entry.cameraFile = new File([blob], take.metadata.mime.includes('quicktime') ? 'iPhone original Classfy.mov' : 'iPhone original Classfy.mp4', { type: take.metadata.mime }); entry.take = take; entry.session = envelope.session; await store.save(entry);
          entry.cameraMetadata = await validateStudioRemoteMaster(blob, take, inspect, options.signal);
        } else {
          const remote = options.remote ?? (ownedRemote = createStudioRemoteCapture({ owner, kind: envelope.session.kind, resumeSessionId: entry.sessionId, controllerId: entry.controllerId, persist: false, client }));
          if (ownedRemote) await ownedRemote.prepare();
          const master = await remote.remoteStop(); entry.cameraFile = master.file; entry.cameraMetadata = master.metadata; entry.take = master.take; entry.session = master.session;
        }
        await store.save(entry);
      }
      if (screenFailure || !entry.screenFile) throw screenFailure ?? new Error('A tela original não foi encontrada. A câmera do iPhone continua disponível para download.');
      entry.screenMetadata ??= await inspect(entry.screenFile, { signal: options.signal });
      entry.cameraMetadata ??= await inspect(entry.cameraFile!, { signal: options.signal });
      entry.status = 'exporting'; entry.error = undefined; await store.save(entry); assertStudioActive(options.signal);
      const file = await (options.render ?? renderStudioRemoteScene)(recordedTimeline, entry.take!, entry.cameraFile!, entry.screenFile, entry.cameraMetadata, entry.screenMetadata, { signal: options.signal, name: entry.title });
      assertStudioActive(options.signal); entry.outputFile = file; entry.status = 'complete'; await store.save(entry); return file;
    } catch (error) { entry.status = 'recoverable'; entry.error = error instanceof Error ? error.message : 'Não foi possível montar este take. Seus originais foram preservados.'; await store.save(entry).catch(() => undefined); throw error; }
    finally { ownedRemote?.dispose(); }
  })();
  active.set(key, work); void work.finally(() => { if (active.get(key) === work) active.delete(key); }).catch(() => undefined); return work;
}

/** Disk-backed chunks keep a long scene take out of an unbounded JS array. */
type Chunk = { recordingId: string; sequence: number; blob: Blob; createdAt: number };
const databaseName = 'classfy-studio-recording-chunks-v1';
const maximumPendingBytes = 64 * 1024 * 1024;
export type StudioSceneRecordingBuffer = {
  prepare(): Promise<void>;
  append(blob: Blob): Promise<void>;
  file(name: string, mime: string): Promise<File>;
  dispose(): Promise<void>;
  readonly bytes: number;
};
const abort = () => new DOMException('Gravação cancelada.', 'AbortError');
const message = (cause: unknown) => new Error((cause as { name?: string })?.name === 'QuotaExceededError'
  ? 'O navegador ficou sem espaço durante a gravação. Vamos preservar o trecho capturado; libere espaço antes de continuar.'
  : 'O armazenamento da gravação foi interrompido. Vamos preservar o trecho capturado antes de continuar.', { cause });

export function createStudioSceneRecordingBuffer(options: { indexedDB?: IDBFactory; databaseName?: string; id?: string; maximumPendingBytes?: number } = {}): StudioSceneRecordingBuffer {
  const recordingId = options.id ?? crypto.randomUUID(), limit = options.maximumPendingBytes ?? maximumPendingBytes;
  let db: IDBDatabase | null = null, opening: Promise<void> | null = null, disposed = false;
  let sequence = 0, total = 0, pendingBytes = 0, durable = 0, failure: Error | null = null;
  const pending = new Map<number, Chunk>();
  let writes = Promise.resolve();
  const prepare = () => {
    if (disposed) return Promise.reject(abort());
    if (opening) return opening;
    opening = new Promise<void>((resolve, reject) => {
      const factory = options.indexedDB ?? globalThis.indexedDB;
      if (!factory) { reject(new Error('Este navegador não oferece armazenamento local para gravar com cenas.')); return; }
      let request: IDBOpenDBRequest;
      try { request = factory.open(options.databaseName ?? databaseName, 1); }
      catch (cause) { reject(message(cause)); return; }
      let rejected = false;
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('chunks', { keyPath: ['recordingId', 'sequence'] });
        store.createIndex('recording', 'recordingId');
      };
      request.onerror = () => { rejected = true; reject(message(request.error)); };
      request.onblocked = () => { rejected = true; reject(new Error('Feche outra aba antiga do Studio para preparar o armazenamento da gravação.')); };
      request.onsuccess = () => {
        if (disposed || rejected) { request.result.close(); if (disposed) reject(abort()); return; }
        db = request.result;
        db.onversionchange = () => { db?.close(); db = null; opening = null; failure = message(new Error('O armazenamento foi atualizado em outra aba.')); };
        resolve();
      };
    });
    return opening;
  };
  function append(blob: Blob) {
    if (disposed) return Promise.reject(abort());
    if (!blob.size) return Promise.resolve();
    const chunk: Chunk = { recordingId, sequence: sequence++, blob, createdAt: Date.now() };
    total += blob.size; pendingBytes += blob.size; pending.set(chunk.sequence, chunk);
    if (pendingBytes > limit && !failure) failure = new Error('O disco não está acompanhando a gravação. Vamos encerrar e preservar o trecho capturado.');
    const write = writes.then(async () => {
      if (disposed) throw abort();
      if (failure) throw failure;
      await prepare();
      if (disposed) throw abort();
      if (!db) throw message(null);
      await new Promise<void>((resolve, reject) => {
        const tx = db!.transaction('chunks', 'readwrite');
        tx.objectStore('chunks').add(chunk);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(message(tx.error));
        tx.onabort = () => reject(message(tx.error));
      });
      pending.delete(chunk.sequence); pendingBytes -= blob.size; ++durable;
    }).catch(cause => {
      if (disposed) throw abort();
      const reported = cause === failure ? cause : message(cause);
      failure ??= reported; throw reported;
    });
    // Queue stays drainable after failure; the tail remains available for salvage.
    writes = write.catch(() => undefined);
    return write;
  }
  async function file(name: string, mime: string) {
    if (disposed) throw abort();
    await writes;
    if (disposed) throw abort();
    if (!db && durable) await prepare();
    if (!db) { if (!pending.size) throw new Error('O trecho capturado não está disponível.'); return new File([...pending.values()].sort((a, b) => a.sequence - b.sequence).map(value => value.blob), name, { type: mime }); }
    const stored = await new Promise<Chunk[]>((resolve, reject) => {
      const tx = db!.transaction('chunks', 'readonly');
      const reading = tx.objectStore('chunks').index('recording').getAll(recordingId);
      let result: Chunk[] = [];
      reading.onsuccess = () => { result = reading.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(message(tx.error));
      tx.onabort = () => reject(message(tx.error));
    });
    if (disposed) throw abort();
    const chunks = [...stored, ...pending.values()].sort((a, b) => a.sequence - b.sequence);
    if (!chunks.length || chunks.some((value, index) => value.sequence !== index)) throw new Error('O trecho capturado está incompleto. Mantenha esta página aberta para tentar recuperar o arquivo.');
    return new File(chunks.map(value => value.blob), name, { type: mime });
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    await writes;
    await opening?.catch(() => undefined);
    if (db) {
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db!.transaction('chunks', 'readwrite'), cursor = tx.objectStore('chunks').index('recording').openKeyCursor(recordingId);
          cursor.onsuccess = () => { if (cursor.result) { tx.objectStore('chunks').delete(cursor.result.primaryKey); cursor.result.continue(); } };
          tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
      } finally { db?.close(); db = null; }
    }
    pending.clear(); pendingBytes = 0;
  }
  return { prepare, append, file, dispose, get bytes() { return total; } };
}

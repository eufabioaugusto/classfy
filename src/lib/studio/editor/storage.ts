import {
  emptyStudioEditing, migrateStudioProject, validateStudioEditing, withStudioOutputSelection, withStudioTakes,
  type StudioAsset, type StudioKind, type StudioProject,
} from '../../../../shared/studio';

export class StudioStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'StudioStorageError'; }
}
export class StudioStorageConflictError extends StudioStorageError {
  constructor() { super('Este projeto mudou em outra aba. Reabra a versão atual antes de salvar.'); this.name = 'StudioStorageConflictError'; }
}
export type StudioExportFile = File & { readonly revision: number; readonly exportedAt: string };
type AssetRecord = { ownerId: string; projectId: string; assetId: string; blob: Blob };
type ExportRecord = { ownerId: string; projectId: string; revision: number; artifactId?: string; blob?: Blob; opfsName?: string; retainedOpfsNames?: string[]; name: string; mime: string; exportedAt: string };
type StoredProject = Omit<StudioProject, 'takes'>;
const databaseName = 'classfy-studio-web-v1';
function identity(value: string) {
  if (typeof value !== 'string' || !value || value.length > 512) throw new StudioStorageError('A identificação do projeto não é válida.');
}
export function studioAssetUri(owner: string, projectId: string, assetId: string, name: string) {
  [owner, projectId, assetId, name].forEach(identity);
  return `file://classfy-studio/${[owner, projectId, assetId, name].map(encodeURIComponent).join('/')}`;
}
function storageError(error: unknown): StudioStorageError {
  if (error instanceof StudioStorageError) return error;
  if ((error as { name?: string })?.name === 'QuotaExceededError') return new StudioStorageError('O navegador ficou sem espaço. O projeto anterior continua salvo; libere espaço e tente novamente.', { cause: error });
  return new StudioStorageError('Não foi possível salvar ou ler o projeto neste navegador. Tente novamente.', { cause: error });
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
}
function materialize(record: StoredProject | StudioProject): StudioProject {
  return migrateStudioProject(record as StudioProject);
}
function canonical(owner: string, project: StudioProject): StoredProject {
  identity(owner); identity(project.id);
  if (project.ownerId !== owner) throw new StudioStorageError('Este projeto pertence a outra conta.');
  if (!['aula', 'short', 'podcast'].includes(project.kind) || !Number.isSafeInteger(project.revision) || project.revision < 0) throw new StudioStorageError('O projeto precisa de recuperação.');
  const migrated = materialize(project);
  const issues = validateStudioEditing(migrated.editing!, migrated.kind);
  if (issues.length) throw new StudioStorageError(issues[0]);
  for (const asset of migrated.editing!.assets) {
    if (asset.uri !== studioAssetUri(owner, project.id, asset.id, asset.name)) throw new StudioStorageError('O original não pertence à biblioteca deste projeto.');
  }
  // withStudioTakes keeps this derived adapter non-enumerable, so only editing
  // crosses the persistence boundary, never two competing canonical timelines.
  return JSON.parse(JSON.stringify(migrated)) as StoredProject;
}
function requireBlob(blob: Blob) {
  if (!blob || !Number.isFinite(blob.size) || blob.size <= 0 || typeof blob.slice !== 'function') throw new StudioStorageError('O arquivo está vazio ou não está disponível.');
}

/** Native IndexedDB is the only production boundary. Factories also exercise it in tests. */
export function createStudioBrowserStorage(options: { indexedDB?: IDBFactory; databaseName?: string; now?: () => Date; id?: () => string; getDirectory?: (() => Promise<FileSystemDirectoryHandle>) | null } = {}) {
  let opened: Promise<IDBDatabase> | undefined;
  const now = options.now ?? (() => new Date()), id = options.id ?? (() => crypto.randomUUID());
  function open() {
    if (opened) return opened;
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) return Promise.reject(new StudioStorageError('Este navegador não disponibiliza armazenamento local para o Studio.'));
    opened = new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open(options.databaseName ?? databaseName, 1);
      let rejected = false;
      opening.onupgradeneeded = () => {
        const db = opening.result;
        const projects = db.createObjectStore('projects', { keyPath: ['ownerId', 'id'] }); projects.createIndex('owner', 'ownerId');
        const assets = db.createObjectStore('assets', { keyPath: ['ownerId', 'projectId', 'assetId'] }); assets.createIndex('project', ['ownerId', 'projectId']);
        db.createObjectStore('exports', { keyPath: ['ownerId', 'projectId'] });
      };
      opening.onsuccess = () => {
        if (rejected) { opening.result.close(); return; }
        opening.result.onversionchange = () => { opening.result.close(); opened = undefined; };
        resolve(opening.result);
      };
      opening.onerror = () => { rejected = true; opened = undefined; reject(storageError(opening.error)); };
      opening.onblocked = () => { rejected = true; opened = undefined; reject(new StudioStorageError('Feche outra aba antiga do Studio e tente novamente.')); };
    });
    return opened;
  }
  async function transaction<T>(names: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode); let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(storageError(tx.error));
      tx.onabort = () => reject(storageError(tx.error));
      void work(tx).then(value => { result = value; }, error => {
        try { tx.abort(); } catch { /* already aborted by IndexedDB */ }
        reject(storageError(error));
      });
    });
  }
  async function listProjects(owner: string): Promise<StudioProject[]> {
    identity(owner);
    const rows = await transaction(['projects'], 'readonly', tx => request(tx.objectStore('projects').index('owner').getAll(owner)));
    return (rows as StoredProject[]).map(materialize).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }
  async function getProject(owner: string, projectId: string): Promise<StudioProject | null> {
    [owner, projectId].forEach(identity);
    const row = await transaction(['projects'], 'readonly', tx => request(tx.objectStore('projects').get([owner, projectId])));
    return row ? materialize(row) : null;
  }
  async function createProject(owner: string, kind: StudioKind, title = '', preferredId?: string): Promise<StudioProject> {
    identity(owner); if (preferredId !== undefined) identity(preferredId);
    const timestamp = now().toISOString();
    const project = withStudioTakes({ version: 2, id: preferredId ?? id(), ownerId: owner, kind, title, description: '', objective: '', audience: '', script: '', tags: [],
      visibility: 'free', price: '0', editing: withStudioOutputSelection(emptyStudioEditing(kind), { resolution: 'original', frameRate: 'original' }), createdAt: timestamp, updatedAt: timestamp, revision: 0, state: 'draft', progress: 0 });
    const row = canonical(owner, project);
    await transaction(['projects'], 'readwrite', async tx => { await request(tx.objectStore('projects').add(row)); });
    return materialize(row);
  }
  async function saveProject(owner: string, project: StudioProject): Promise<StudioProject> {
    const incoming = canonical(owner, project);
    const saved = await transaction(['projects', 'assets'], 'readwrite', async tx => {
      const projects = tx.objectStore('projects'), previous = await request(projects.get([owner, project.id])) as StoredProject | undefined;
      if (!previous) throw new StudioStorageError('Este projeto não está mais na biblioteca.');
      if (previous.revision !== project.revision) throw new StudioStorageConflictError();
      if (incoming.kind !== previous.kind) throw new StudioStorageError('O formato original do projeto deve ser preservado.');
      for (const asset of previous.editing?.assets ?? []) {
        if (JSON.stringify(incoming.editing!.assets.find(candidate => candidate.id === asset.id)) !== JSON.stringify(asset)) throw new StudioStorageError('A edição deve preservar seus arquivos originais.');
      }
      for (const asset of incoming.editing!.assets) {
        if (!await request(tx.objectStore('assets').getKey([owner, project.id, asset.id]))) throw new StudioStorageError('Um original não está disponível. Importe o arquivo antes de salvar a montagem.');
      }
      const next = { ...incoming, ownerId: owner, id: previous.id, kind: previous.kind, createdAt: previous.createdAt,
        revision: previous.revision + 1, updatedAt: now().toISOString() };
      await request(projects.put(next)); return next;
    });
    return materialize(saved);
  }
  async function putAsset(owner: string, projectId: string, assetId: string, blob: Blob): Promise<void> {
    [owner, projectId, assetId].forEach(identity); requireBlob(blob);
    await transaction(['projects', 'assets'], 'readwrite', async tx => {
      if (!await request(tx.objectStore('projects').get([owner, projectId]))) throw new StudioStorageError('Este projeto não pertence à conta atual.');
      // An existing ID is an immutable original, never an overwrite destination.
      await request(tx.objectStore('assets').add({ ownerId: owner, projectId, assetId, blob } satisfies AssetRecord));
    });
  }
  async function getAsset(owner: string, projectId: string, assetId: string): Promise<Blob | null> {
    [owner, projectId, assetId].forEach(identity);
    return transaction(['projects', 'assets'], 'readonly', async tx => {
      if (!await request(tx.objectStore('projects').get([owner, projectId]))) return null;
      const record = await request(tx.objectStore('assets').get([owner, projectId, assetId])) as AssetRecord | undefined;
      return record?.blob ?? null;
    });
  }
  let exportsDirectory: Promise<FileSystemDirectoryHandle | null> | undefined;
  function exportDirectory() {
    if (exportsDirectory) return exportsDirectory;
    const getDirectory = options.getDirectory === null ? undefined : options.getDirectory ??
      (typeof navigator !== 'undefined' && navigator.storage?.getDirectory ? () => navigator.storage.getDirectory() : undefined);
    return exportsDirectory = getDirectory ? getDirectory().then(root => root.getDirectoryHandle('classfy-studio-library-exports', { create: true })).catch(error => { exportsDirectory = undefined; throw storageError(error); }) : Promise.resolve(null);
  }
  async function copyExport(file: Blob): Promise<Pick<ExportRecord, 'blob' | 'opfsName'>> {
    const directory = await exportDirectory();
    if (!directory) {
      if (file.size > 100 * 1024 * 1024) throw new StudioStorageError('Este navegador precisa de armazenamento em disco para salvar aulas longas. Use Chrome ou Edge atualizado.');
      // Materialize a bounded fallback. Cloning an OPFS-backed File into IDB can
      // preserve its temporary backing path; wrapping that File in Blob does not
      // detach it. Byte materialization does.
      return { blob: new Blob([await file.arrayBuffer()], { type: file.type }) };
    }
    const opfsName = `${encodeURIComponent(id())}.media`;
    try {
      const handle = await directory.getFileHandle(opfsName, { create: true });
      const writer = await handle.createWritable();
      await file.stream().pipeTo(writer);
      if ((await handle.getFile()).size !== file.size) throw new StudioStorageError('O arquivo exportado não foi salvo por completo. Tente novamente.');
      return { opfsName };
    } catch (error) {
      await directory.removeEntry(opfsName).catch(() => {});
      throw storageError(error);
    }
  }
  async function removeExportFiles(names: string[]) {
    if (!names.length) return;
    const directory = await exportDirectory();
    if (!directory) throw new StudioStorageError('O armazenamento em disco desta exportação não está disponível.');
    for (const name of names) {
      try { await directory.removeEntry(name); } catch (error) {
        if ((error as { name?: string })?.name !== 'NotFoundError') throw storageError(error);
      }
    }
  }
  async function storeExport(owner: string, projectId: string, file: Blob | File, revision: number): Promise<void> {
    [owner, projectId].forEach(identity); requireBlob(file);
    const verify = (project?: StoredProject) => {
      if (!project) throw new StudioStorageError('Este projeto não pertence à conta atual.');
      if (project.revision !== revision) throw new StudioStorageConflictError();
      if (!file.type || !file.type.startsWith(project.kind === 'podcast' ? 'audio/' : 'video/')) throw new StudioStorageError('O formato exportado não corresponde ao projeto.');
      return project;
    };
    const project = verify(await transaction(['projects'], 'readonly', tx => request(tx.objectStore('projects').get([owner, projectId]))));
    const extension = file.type.includes('webm') ? 'webm' : project.kind === 'podcast' ? 'm4a' : 'mp4';
    const name = typeof (file as File).name === 'string' ? (file as File).name : `${project.title || 'Publicação'}.${extension}`;
    // File I/O occurs outside an IDB transaction; the revision is rechecked at
    // commit so a slow encoder/copy cannot supersede a newer edit.
    const copied = await copyExport(file);
    try {
      await transaction(['projects', 'exports'], 'readwrite', async tx => {
        verify(await request(tx.objectStore('projects').get([owner, projectId])));
        const previous = await request(tx.objectStore('exports').get([owner, projectId])) as ExportRecord | undefined;
        const retainedOpfsNames = [...new Set([...(previous?.retainedOpfsNames ?? []), ...(previous?.opfsName ? [previous.opfsName] : [])])];
        const record: ExportRecord = { ownerId: owner, projectId, revision, artifactId: id(), ...copied, retainedOpfsNames, name, mime: file.type, exportedAt: now().toISOString() };
        await request(tx.objectStore('exports').put(record));
      });
    } catch (error) {
      if (copied.opfsName) await removeExportFiles([copied.opfsName]).catch(() => {});
      throw storageError(error);
    }
  }
  async function getExport(owner: string, projectId: string, revision?: number): Promise<StudioExportFile | null> {
    [owner, projectId].forEach(identity);
    const record = await transaction(['projects', 'exports'], 'readonly', async tx => {
      const project = await request(tx.objectStore('projects').get([owner, projectId])) as StoredProject | undefined;
      if (!project || revision !== undefined && project.revision !== revision) return null;
      const output = await request(tx.objectStore('exports').get([owner, projectId])) as ExportRecord | undefined;
      return output?.revision === project.revision ? output : null;
    });
    if (!record) return null;
    let blob = record.blob;
    if (record.opfsName) {
      try {
        const directory = await exportDirectory();
        if (!directory) throw new StudioStorageError('O armazenamento em disco desta exportação não está disponível.');
        blob = await (await directory.getFileHandle(record.opfsName)).getFile();
      } catch (error) { throw storageError(error); }
    }
    if (!blob?.size) throw new StudioStorageError('O arquivo exportado não está disponível. Exporte a montagem novamente.');
    // Reading OPFS is asynchronous; an edit/reexport during that read must not
    // hand off an outdated artifact, even if its bytes remain safely retained.
    const current = await transaction(['projects', 'exports'], 'readonly', async tx => {
      const project = await request(tx.objectStore('projects').get([owner, projectId])) as StoredProject | undefined;
      const output = await request(tx.objectStore('exports').get([owner, projectId])) as ExportRecord | undefined;
      return project?.revision === record.revision && output?.revision === record.revision && output?.artifactId === record.artifactId && output?.opfsName === record.opfsName && output?.exportedAt === record.exportedAt;
    });
    if (!current) return null;
    const file = new File([blob], record.name, { type: record.mime, lastModified: Date.parse(record.exportedAt) }) as StudioExportFile;
    Object.defineProperties(file, { revision: { value: record.revision }, exportedAt: { value: record.exportedAt } });
    return file;
  }
  async function deleteProject(owner: string, projectId: string): Promise<void> {
    [owner, projectId].forEach(identity);
    // Keep the artifact locator until cleanup succeeds, so an interrupted delete
    // can be retried without orphaning large files. Its missing project already
    // makes it inaccessible through getExport.
    const record = await transaction(['projects', 'assets', 'exports'], 'readwrite', async tx => {
      const keys = await request(tx.objectStore('assets').index('project').getAllKeys(IDBKeyRange.only([owner, projectId])));
      for (const key of keys) tx.objectStore('assets').delete(key);
      tx.objectStore('projects').delete([owner, projectId]);
      return await request(tx.objectStore('exports').get([owner, projectId])) as ExportRecord | undefined;
    });
    await removeExportFiles([...(record?.retainedOpfsNames ?? []), ...(record?.opfsName ? [record.opfsName] : [])]);
    await transaction(['exports'], 'readwrite', async tx => { await request(tx.objectStore('exports').delete([owner, projectId])); });
  }
  async function duplicateProject(owner: string, projectId: string): Promise<StudioProject> {
    [owner, projectId].forEach(identity);
    const duplicate = await transaction(['projects', 'assets'], 'readwrite', async tx => {
      const originalRequest = request(tx.objectStore('projects').get([owner, projectId]));
      const mediaRequest = request(tx.objectStore('assets').index('project').getAll(IDBKeyRange.only([owner, projectId])));
      const [record, media] = await Promise.all([originalRequest, mediaRequest]) as [StoredProject | undefined, AssetRecord[]];
      if (!record) throw new StudioStorageError('Este projeto não pertence à conta atual.');
      const original = materialize(record);
      if (original.pendingTakes?.length || ['preparing', 'uploading', 'processing'].includes(original.state)) throw new StudioStorageError('Aguarde o projeto terminar a operação antes de duplicar.');
      const project = id(), timestamp = now().toISOString(), assetIds = new Map(original.editing!.assets.map(asset => [asset.id, id()]));
      const mainIds = new Map(original.editing!.main.map(clip => [clip.id, id()]));
      const assets: StudioAsset[] = original.editing!.assets.map(asset => {
        if (!media.some(value => value.assetId === asset.id)) throw new StudioStorageError('Um original não está disponível. Reabra o projeto antes de duplicar.');
        const assetId = assetIds.get(asset.id)!, uri = studioAssetUri(owner, project, assetId, asset.name);
        return { ...asset, id: assetId, uri, ...(asset.thumbnailUri ? { thumbnailUri: asset.thumbnailUri.replace(asset.uri, uri) } : {}) };
      });
      const remapUri = (uri?: string) => {
        if (!uri) return uri;
        for (let index = 0; index < original.editing!.assets.length; index++) {
          const before = original.editing!.assets[index];
          if (uri.startsWith(before.uri)) return uri.replace(before.uri, assets[index].uri);
        }
        return uri.replace(`/${encodeURIComponent(projectId)}/`, `/${encodeURIComponent(project)}/`);
      };
      const copied = withStudioTakes({ ...original, id: project, title: `${original.title || 'Projeto'} — cópia`, createdAt: timestamp, updatedAt: timestamp,
        revision: 0, state: 'draft', progress: 0, error: undefined, pendingTakes: undefined,
        coverUri: remapUri(original.coverUri),
        editing: { ...original.editing!, assets, main: original.editing!.main.map(clip => ({ ...clip, id: mainIds.get(clip.id)!, assetId: assetIds.get(clip.assetId)! })),
          layers: original.editing!.layers.map(layer => ({ ...layer, id: id(), items: layer.items.map(item => ({ ...item, id: id(),
            ...(item.assetId ? { assetId: assetIds.get(item.assetId)! } : {}), ...(item.anchor ? { anchor: { ...item.anchor, clipId: mainIds.get(item.anchor.clipId)! } } : {}) })) })) } });
      for (const key of ['remoteDraftId', 'remoteSavedAt', 'mediaAssetId', 'videoProvider', 'uploadSignature', 'exportedUri', 'exportedSignature', 'uploadUrl', 'uploadMethod', 'uploadHeaders', 'uploadExpiresAt', 'tusUrl', 'submissionId', 'contentId'] as const) delete copied[key];
      const next = canonical(owner, copied);
      tx.objectStore('projects').add(next);
      for (const source of media) {
        let nextId = assetIds.get(source.assetId);
        if (!nextId) {
          const originalId = [...assetIds.keys()].sort((a, b) => b.length - a.length).find(value => source.assetId.startsWith(`${value}:`));
          // Auxiliary files without an original prefix (for example a manually
          // chosen cover) retain their logical key in the new project scope.
          nextId = originalId ? `${assetIds.get(originalId)}${source.assetId.slice(originalId.length)}` : source.assetId;
        }
        tx.objectStore('assets').add({ ...source, projectId: project, assetId: nextId });
      }
      return next;
    });
    return materialize(duplicate);
  }
  return { listProjects, getProject, createProject, saveProject, deleteProject, duplicateProject, putAsset, getAsset, storeExport, getExport };
}
const storage = createStudioBrowserStorage();
export const { listProjects, getProject, createProject, saveProject, deleteProject, duplicateProject, putAsset, getAsset, storeExport, getExport } = storage;

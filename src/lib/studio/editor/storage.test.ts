// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { Blob, File } from 'node:buffer';
import { mkdtemp, mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileStudioRecipe, studioTicks, type StudioAsset } from '../../../../shared/studio';
import { addMainAsset, addText, patchClip, persistHistoryEdit, createStudioEditingHistory, undoProject, redoProject } from './commands';
import { createStudioBrowserStorage, studioAssetUri, StudioStorageConflictError } from './storage';

beforeEach(() => { vi.stubGlobal('IDBKeyRange', IDBKeyRange); vi.stubGlobal('File', File); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function library() {
  const factory = new IDBFactory(); let counter = 0;
  const options = { indexedDB: factory, databaseName: 'test-studio', id: () => `id-${++counter}`, now: () => new Date('2026-10-11T15:00:00Z') };
  return { storage: createStudioBrowserStorage(options), reopen: () => createStudioBrowserStorage(options) };
}
function source(owner: string, project: string, id = 'original'): StudioAsset {
  return { id, name: `${id}.mp4`, kind: 'video', uri: studioAssetUri(owner, project, id, `${id}.mp4`),
    durationTicks: studioTicks(12), width: 1920, height: 1080, frameRate: 30, hasAudio: true };
}
async function imported(owner = 'owner-a') {
  const h = library(), blank = await h.storage.createProject(owner, 'aula', 'Uma aula');
  const asset = source(owner, blank.id);
  await h.storage.putAsset(owner, blank.id, asset.id, new Blob(['immutable-original'], { type: 'video/mp4' }));
  const project = await h.storage.saveProject(owner, addMainAsset(blank, asset, 'main'));
  return { ...h, project, owner, asset };
}

describe('IndexedDB real com isolamento de conta e confirmação transacional', () => {
  it('novo projeto escolhe HD30 explicitamente e reabertura preserva a seleção', async () => {
    const h = library(), project = await h.storage.createProject('owner', 'short');
    expect(project.editing!.output.selection).toEqual({ resolution: 'hd', frameRate: 30 });
    const reopened = await h.reopen().getProject('owner', project.id);
    expect(reopened!.editing!.output.selection).toEqual({ resolution: 'hd', frameRate: 30 });
    expect(compileStudioRecipe(reopened!).output).toMatchObject({ width: 1080, height: 1920, frameRateNumerator: 30, frameRateDenominator: 1 });
  });
  it('salva schema único e reabre outro runtime com fonte e receita intactas', async () => {
    const h = await imported();
    const edited = await h.storage.saveProject(h.owner, addText(h.project, 'Aprender', 2, 3, { itemId: 'title', layerId: 'titles' }));
    const fresh = h.reopen(), loaded = await fresh.getProject(h.owner, edited.id);
    expect(loaded!.revision).toBe(2); expect(compileStudioRecipe(loaded!)).toEqual(compileStudioRecipe(edited));
    expect(loaded!.takes[0].assetId).toBe(h.asset.id); expect(JSON.parse(JSON.stringify(loaded))).not.toHaveProperty('takes');
    expect(await (await fresh.getAsset(h.owner, edited.id, h.asset.id))!.text()).toBe('immutable-original');
  });
  it('CAS impede escrita antiga e dois autosaves concorrentes não se sobrepõem', async () => {
    const h = await imported(), old = h.project;
    const results = await Promise.allSettled([
      h.storage.saveProject(h.owner, { ...old, title: 'Primeira' }),
      h.storage.saveProject(h.owner, { ...old, title: 'Antiga' }),
    ]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(value => value.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StudioStorageConflictError);
    const loaded = await h.storage.getProject(h.owner, old.id);
    expect(loaded!.title).toBe('Primeira'); expect(loaded!.revision).toBe(old.revision + 1);
    await expect(h.storage.saveProject(h.owner, { ...old, title: 'Resposta atrasada' })).rejects.toBeInstanceOf(StudioStorageConflictError);
    expect((await h.storage.getProject(h.owner, old.id))!.title).toBe('Primeira');
  });
  it('owner/project scope protege leitura, bytes, export, salvar, copiar e exclusão', async () => {
    const h = await imported();
    await h.storage.storeExport(h.owner, h.project.id, new File(['export'], 'lesson.mp4', { type: 'video/mp4' }), h.project.revision);
    expect(await h.storage.listProjects('owner-b')).toEqual([]);
    expect(await h.storage.getProject('owner-b', h.project.id)).toBeNull();
    expect(await h.storage.getAsset('owner-b', h.project.id, h.asset.id)).toBeNull();
    expect(await h.storage.getAsset(h.owner, 'different-project', h.asset.id)).toBeNull();
    expect(await h.storage.getExport('owner-b', h.project.id)).toBeNull();
    await expect(h.storage.saveProject('owner-b', h.project)).rejects.toThrow(/outra conta/);
    await expect(h.storage.duplicateProject('owner-b', h.project.id)).rejects.toThrow(/conta/);
    await expect(h.storage.putAsset('owner-b', h.project.id, 'foreign', new Blob(['x']))).rejects.toThrow(/conta/);
    await h.storage.deleteProject('owner-b', h.project.id);
    expect(await h.storage.getProject(h.owner, h.project.id)).not.toBeNull();
    await h.storage.deleteProject(h.owner, h.project.id);
    expect(await h.storage.getProject(h.owner, h.project.id)).toBeNull();
    expect(await h.storage.getAsset(h.owner, h.project.id, h.asset.id)).toBeNull(); expect(await h.storage.getExport(h.owner, h.project.id)).toBeNull();
  });
  it('quota durante autosave rejeita e rollback mantém revisão/edição anterior e histórico', async () => {
    const h = await imported(), history = createStudioEditingHistory(); history.sync(h.project);
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'projects') throw new DOMException('Disk full', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });
    const next = patchClip(h.project, 'main', { playbackRate: 2 });
    await expect(persistHistoryEdit(history, h.project, next, value => h.storage.saveProject(h.owner, value))).rejects.toThrow(/sem espaço/);
    expect(history.state().canUndo).toBe(false);
    const loaded = await h.storage.getProject(h.owner, h.project.id);
    expect(loaded!.revision).toBe(h.project.revision); expect(compileStudioRecipe(loaded!)).toEqual(compileStudioRecipe(h.project));
    vi.restoreAllMocks();
    const saved = await persistHistoryEdit(history, loaded!, next, value => h.storage.saveProject(h.owner, value));
    const undone = await undoProject(saved, history, value => h.storage.saveProject(h.owner, value));
    const redone = await redoProject(undone, history, value => h.storage.saveProject(h.owner, value));
    expect(compileStudioRecipe(redone)).toEqual(compileStudioRecipe(next));
    expect(await (await h.storage.getAsset(h.owner, h.project.id, h.asset.id))!.text()).toBe('immutable-original');
  });
  it('não certifica referência sem Blob nem aceita sobrescrever ou alterar original', async () => {
    const h = library(), project = await h.storage.createProject('owner', 'aula');
    const asset = source('owner', project.id);
    await expect(h.storage.saveProject('owner', addMainAsset(project, asset, 'main'))).rejects.toThrow(/original não está disponível/);
    expect((await h.storage.getProject('owner', project.id))!.takes).toHaveLength(0);
    await h.storage.putAsset('owner', project.id, asset.id, new Blob(['original']));
    await expect(h.storage.putAsset('owner', project.id, asset.id, new Blob(['overwrite']))).rejects.toThrow();
    const saved = await h.storage.saveProject('owner', addMainAsset(project, asset, 'main'));
    const changed = { ...saved, editing: { ...saved.editing!, assets: [{ ...asset, name: 'changed.mp4', uri: studioAssetUri('owner', project.id, asset.id, 'changed.mp4') }] } };
    await expect(h.storage.saveProject('owner', changed)).rejects.toThrow(/preservar/);
    expect(await (await h.storage.getAsset('owner', project.id, asset.id))!.text()).toBe('original');
  });
  it('export mantém nome/MIME/revisão após reload e rejeita arquivo vazio, formato ou resultado antigo', async () => {
    const h = await imported();
    const file = new File(['actual-output'], 'Nome da aula.mp4', { type: 'video/mp4' });
    await h.storage.storeExport(h.owner, h.project.id, file, h.project.revision);
    const output = await h.reopen().getExport(h.owner, h.project.id, h.project.revision);
    expect(output).toMatchObject({ name: 'Nome da aula.mp4', type: 'video/mp4', revision: h.project.revision, exportedAt: '2026-10-11T15:00:00.000Z' });
    expect(await output!.text()).toBe('actual-output');
    await expect(h.storage.storeExport(h.owner, h.project.id, new Blob([], { type: 'video/mp4' }), h.project.revision)).rejects.toThrow(/vazio/);
    await expect(h.storage.storeExport(h.owner, h.project.id, new Blob(['bad'], { type: 'audio/mp4' }), h.project.revision)).rejects.toThrow(/formato/);
    const edited = await h.storage.saveProject(h.owner, patchClip(h.project, 'main', { gain: .5 }));
    expect(await h.storage.getExport(h.owner, h.project.id)).toBeNull(); expect(await h.storage.getExport(h.owner, h.project.id, h.project.revision)).toBeNull();
    await expect(h.storage.storeExport(h.owner, h.project.id, file, h.project.revision)).rejects.toBeInstanceOf(StudioStorageConflictError);
    await h.storage.storeExport(h.owner, edited.id, file, edited.revision);
    expect((await h.storage.getExport(h.owner, edited.id))!.revision).toBe(edited.revision);
  });
  it('duplicate é atômico, copia thumbnail e remapeia IDs/âncoras sem export/estado remoto', async () => {
    const h = await imported();
    await h.storage.putAsset(h.owner, h.project.id, `${h.asset.id}:thumbnail`, new Blob(['thumb'], { type: 'image/jpeg' }));
    let original = addText(h.project, 'Texto', 1, 3, { itemId: 'title', layerId: 'titles' });
    original = { ...original, coverUri: `${h.asset.uri}:thumbnail`, remoteDraftId: 'remote-draft', mediaAssetId: 'cloud-asset',
      editing: { ...original.editing!, layers: original.editing!.layers.map(layer => ({ ...layer, hidden: true, items: layer.items.map(item => ({ ...item, anchor: { clipId: 'main', offsetTicks: studioTicks(1) } })) })) } };
    original = await h.storage.saveProject(h.owner, original);
    await h.storage.storeExport(h.owner, original.id, new Blob(['final'], { type: 'video/mp4' }), original.revision);
    const copy = await h.storage.duplicateProject(h.owner, original.id), asset = copy.editing!.assets[0];
    expect(copy.id).not.toBe(original.id); expect(copy.revision).toBe(0); expect(copy.state).toBe('draft');
    expect(copy).not.toHaveProperty('mediaAssetId'); expect(copy).not.toHaveProperty('remoteDraftId');
    expect(copy.editing!.main[0].id).not.toBe('main'); expect(asset.id).not.toBe(h.asset.id);
    expect(copy.editing!.layers[0].items[0].anchor!.clipId).toBe(copy.editing!.main[0].id);
    expect(copy.editing!.layers[0].hidden).toBe(true); expect(copy.coverUri).toBe(`${asset.uri}:thumbnail`);
    expect(await (await h.storage.getAsset(h.owner, copy.id, asset.id))!.text()).toBe('immutable-original');
    expect(await (await h.storage.getAsset(h.owner, copy.id, `${asset.id}:thumbnail`))!.text()).toBe('thumb');
    expect(await h.storage.getExport(h.owner, copy.id)).toBeNull();
    await h.storage.deleteProject(h.owner, original.id);
    expect(await (await h.storage.getAsset(h.owner, copy.id, asset.id))!.text()).toBe('immutable-original');
  });
  it('quota após primeiro item da duplicação reverte projeto e todos seus novos bytes', async () => {
    const h = await imported();
    await h.storage.putAsset(h.owner, h.project.id, `${h.asset.id}:thumbnail`, new Blob(['thumb']));
    const originalAdd = IDBObjectStore.prototype.add; let adds = 0;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'assets' && ++adds === 2) throw new DOMException('Full', 'QuotaExceededError');
      return originalAdd.apply(this, args);
    });
    await expect(h.storage.duplicateProject(h.owner, h.project.id)).rejects.toThrow(/sem espaço/);
    expect(await h.storage.listProjects(h.owner)).toHaveLength(1);
    expect(await (await h.storage.getAsset(h.owner, h.project.id, h.asset.id))!.text()).toBe('immutable-original');
  });
  it('duplicação mantém a referência e os bytes de capa manual auxiliar após excluir o projeto original', async () => {
    const h = await imported(), coverId = 'manual-cover';
    await h.storage.putAsset(h.owner, h.project.id, coverId, new Blob(['manual-cover-bytes'], { type: 'image/jpeg' }));
    const original = await h.storage.saveProject(h.owner, { ...h.project, coverUri: studioAssetUri(h.owner, h.project.id, coverId, 'Capa da aula.jpg') });
    const copied = await h.storage.duplicateProject(h.owner, original.id);
    expect(copied.coverUri).toBe(studioAssetUri(h.owner, copied.id, coverId, 'Capa da aula.jpg'));
    await h.storage.deleteProject(h.owner, original.id);
    expect(await (await h.reopen().getAsset(h.owner, copied.id, coverId))!.text()).toBe('manual-cover-bytes');
  });
});

// Filesystem is a boundary adapter over real temporary files, not a substitute
// for the IndexedDB/storage implementation. Chrome's backing-file lifetime is
// validated separately by the browser fixture.
async function diskLibrary(onClose?: () => Promise<void>) {
  const path = await mkdtemp(join(tmpdir(), 'classfy-studio-storage-'));
  const missing = (error: unknown) => (error as { code?: string })?.code === 'ENOENT' ? new DOMException('Missing file', 'NotFoundError') : error;
  const directory = (folder: string): FileSystemDirectoryHandle => ({
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const child = join(folder, name);
      if (options?.create) await mkdir(child, { recursive: true }); else await stat(child);
      return directory(child);
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const filePath = join(folder, name);
      if (options?.create) { const handle = await open(filePath, 'a'); await handle.close(); }
      else { try { await stat(filePath); } catch (error) { throw missing(error); } }
      return {
        async createWritable() {
          const handle = await open(filePath, 'w');
          return new WritableStream<Uint8Array>({
            async write(chunk) { await handle.write(chunk); },
            async close() { await handle.close(); await onClose?.(); },
            async abort() { await handle.close(); },
          });
        },
        async getFile() { try { return new File([await readFile(filePath)], name, { type: 'video/mp4' }); } catch (error) { throw missing(error); } },
      } as unknown as FileSystemFileHandle;
    },
    async removeEntry(name: string) { try { await rm(join(folder, name)); } catch (error) { throw missing(error); } },
  } as unknown as FileSystemDirectoryHandle);
  let counter = 0;
  const options = { indexedDB: new IDBFactory(), databaseName: 'disk-studio', id: () => `disk-${++counter}`, getDirectory: async () => directory(path) };
  return { storage: createStudioBrowserStorage(options), reopen: () => createStudioBrowserStorage(options),
    files: async () => readdir(join(path, 'classfy-studio-library-exports')).catch(() => []), dispose: () => rm(path, { recursive: true, force: true }) };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

describe('exportações duráveis com streaming OPFS', () => {
  it('copia por stream, reabre outro runtime e preserva Files anteriores até excluir o projeto', async () => {
    const h = await diskLibrary();
    try {
      const project = await h.storage.createProject('owner', 'aula');
      const bytes = new Blob(['first-export'], { type: 'video/mp4' });
      const arrayBuffer = vi.fn(() => Promise.reject(new Error('Large exports must stream'))), stream = vi.fn(() => bytes.stream());
      const sourceFile = { size: bytes.size, type: bytes.type, name: 'Aula original.mp4', slice: bytes.slice.bind(bytes), arrayBuffer, stream } as unknown as File;
      await h.storage.storeExport('owner', project.id, sourceFile, project.revision);
      expect(stream).toHaveBeenCalledOnce(); expect(arrayBuffer).not.toHaveBeenCalled();
      const first = await h.reopen().getExport('owner', project.id, 0);
      expect(first!.name).toBe('Aula original.mp4'); expect(await first!.text()).toBe('first-export');
      await h.storage.storeExport('owner', project.id, new File(['second-export'], 'Aula nova.mp4', { type: 'video/mp4' }), 0);
      expect(await h.files()).toHaveLength(2);
      expect(await first!.text()).toBe('first-export');
      const latest = await h.reopen().getExport('owner', project.id, 0);
      expect(latest!.name).toBe('Aula nova.mp4'); expect(await latest!.text()).toBe('second-export');
      expect(await h.storage.getExport('other-owner', project.id)).toBeNull();
      await h.storage.deleteProject('owner', project.id);
      expect(await h.files()).toHaveLength(0); expect(await h.reopen().getExport('owner', project.id)).toBeNull();
    } finally { await h.dispose(); }
  });
  it('escrita lenta revalida a revisão no commit e remove a cópia nova sem certificar resultado obsoleto', async () => {
    const entered = deferred(), continueWrite = deferred(), h = await diskLibrary(async () => { entered.resolve(); await continueWrite.promise; });
    try {
      const project = await h.storage.createProject('owner', 'aula');
      const writing = h.storage.storeExport('owner', project.id, new File(['old-export'], 'old.mp4', { type: 'video/mp4' }), 0);
      await entered.promise;
      const saved = await h.storage.saveProject('owner', { ...project, title: 'Edição durante a cópia' });
      continueWrite.resolve();
      await expect(writing).rejects.toBeInstanceOf(StudioStorageConflictError);
      expect(await h.files()).toHaveLength(0); expect(await h.storage.getExport('owner', project.id)).toBeNull();
      expect((await h.storage.getProject('owner', project.id))!.revision).toBe(saved.revision);
    } finally { continueWrite.resolve(); await h.dispose(); }
  });
  it('quota no commit do locator remove somente a nova cópia e preserva exportação já salva', async () => {
    const h = await diskLibrary();
    try {
      const project = await h.storage.createProject('owner', 'aula');
      await h.storage.storeExport('owner', project.id, new File(['previous'], 'previous.mp4', { type: 'video/mp4' }), 0);
      const originalPut = IDBObjectStore.prototype.put;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (this.name === 'exports') throw new DOMException('Full', 'QuotaExceededError');
        return originalPut.apply(this, args);
      });
      await expect(h.storage.storeExport('owner', project.id, new File(['failed'], 'failed.mp4', { type: 'video/mp4' }), 0)).rejects.toThrow(/sem espaço/);
      expect(await h.files()).toHaveLength(1);
      expect(await (await h.reopen().getExport('owner', project.id))!.text()).toBe('previous');
    } finally { await h.dispose(); }
  });
});

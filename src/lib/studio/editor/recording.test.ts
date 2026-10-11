// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { File, Blob } from 'node:buffer';
import { compileStudioRecipe, studioTicks, type StudioProject } from '../../../../shared/studio';
import { addText, patchClip } from './commands';
import { createStudioBrowserStorage, StudioStorageConflictError } from './storage';
import { createStudioRecordingSession, StudioRecordingBusyError, type StudioRecordingSessionOptions } from './recording';
import type { StudioMediaMetadata } from './media';

beforeEach(() => { vi.stubGlobal('IDBKeyRange', IDBKeyRange); vi.stubGlobal('File', File); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function file(name = 'take.webm', contents = 'original-encoded-bytes', mime = 'video/webm') {
  return new File([contents], name, { type: mime, lastModified: 123 }) as unknown as globalThis.File;
}
function video(duration = 2): StudioMediaMetadata {
  return { kind: 'video', duration, width: 1920, height: 1080, frameRate: 30, hasAudio: true, mimeType: 'video/webm',
    thumbnail: new Blob(['jpeg-thumbnail'], { type: 'image/jpeg' }), colorSpace: 'bt709/bt709/bt709', warnings: [] };
}
function library() {
  let counter = 0;
  const options = { indexedDB: new IDBFactory(), databaseName: 'recording-tests', id: () => `project-${++counter}`, getDirectory: null };
  return { storage: createStudioBrowserStorage(options), reopen: () => createStudioBrowserStorage(options) };
}
function session(h = library(), options: Partial<StudioRecordingSessionOptions> = {}, inspect = vi.fn(async () => video())) {
  let ids = 0;
  return { ...h, inspect, session: createStudioRecordingSession({ owner: 'owner', kind: 'aula', ...options }, {
    storage: h.storage, inspect, id: () => `take-${++ids}`,
  }) };
}

describe('sessão de gravação com comandos/receita e IndexedDB reais', () => {
  it('não cria projeto ao abrir, nem para mídia vazia, inválida ou formato incompatível', async () => {
    const h = session();
    expect(h.session.current()).toBeNull(); expect(await h.session.loadExisting()).toBeNull();
    expect(await h.storage.listProjects('owner')).toEqual([]);
    await expect(h.session.append(file('empty', ''))).rejects.toThrow(/vazia/);
    h.inspect.mockRejectedValueOnce(new Error('codec inválido'));
    await expect(h.session.append(file('bad.webm'))).rejects.toThrow('codec inválido');
    h.inspect.mockResolvedValueOnce({ ...video(), duration: .01 });
    await expect(h.session.append(file('short.webm'))).rejects.toThrow(/0,1 segundo/);
    h.inspect.mockResolvedValueOnce({ ...video(), kind: 'audio', width: undefined, height: undefined });
    await expect(h.session.append(file('wrong.webm'))).rejects.toThrow(/vídeo válida/);
    expect(await h.storage.listProjects('owner')).toEqual([]);
  });

  it('concatena takes e reabre fontes, miniaturas, duração e receita sem um segundo estado de montagem', async () => {
    const h = session(undefined, { title: 'Uma aula gravada' }), firstFile = file(), secondFile = file('segundo.webm', 'second-original');
    const first = await h.session.append(firstFile, { operationId: 'rec-1' });
    h.inspect.mockResolvedValueOnce(video(3));
    const second = await h.session.append(secondFile, { operationId: 'rec-2' });
    expect(second.id).toBe(first.id); expect(second.revision).toBe(2); expect(second.takes).toHaveLength(2);
    expect(second.title).toBe('Uma aula gravada'); expect(compileStudioRecipe(second).durationTicks).toBe(studioTicks(5));
    const fresh = h.reopen(), loaded = await fresh.getProject('owner', second.id);
    expect(compileStudioRecipe(loaded!)).toEqual(compileStudioRecipe(second));
    expect(JSON.parse(JSON.stringify(loaded))).not.toHaveProperty('takes');
    expect(loaded!.coverUri).toBe(loaded!.editing!.assets[0].thumbnailUri);
    const [a, b] = loaded!.editing!.assets;
    expect(await (await fresh.getAsset('owner', loaded!.id, a.id))!.text()).toBe(await firstFile.text());
    expect(await (await fresh.getAsset('owner', loaded!.id, b.id))!.text()).toBe(await secondFile.text());
    expect(await (await fresh.getAsset('owner', loaded!.id, `${a.id}:thumbnail`))!.text()).toBe('jpeg-thumbnail');
  });

  it('Short salva cover framing; projectId carrega kind real e Podcast aceita somente áudio confirmado', async () => {
    const h = library(), original = await h.storage.createProject('owner', 'short', 'Existente');
    const short = session(h, { kind: 'aula', projectId: original.id });
    expect((await short.session.loadExisting())!.kind).toBe('short');
    const saved = await short.session.append(file());
    expect(saved.editing!.main[0].fit).toBe('cover'); expect(compileStudioRecipe(saved).canvas.aspectRatio).toBe('portrait');
    const podcast = session(library(), { kind: 'podcast' });
    await expect(podcast.session.append(file())).rejects.toThrow(/áudio válida/);
    podcast.inspect.mockResolvedValueOnce({ kind: 'audio', duration: 4, hasAudio: true, mimeType: 'audio/webm', warnings: [] });
    const audio = await podcast.session.append(file('voz.webm', 'audio-original', 'audio/webm'));
    expect(audio.editing!.assets[0].kind).toBe('audio'); expect(compileStudioRecipe(audio).durationTicks).toBe(studioTicks(4));
  });

  it('isola owner, não lê projeto estrangeiro e preserva projeto bloqueado sem novos bytes', async () => {
    const h = session(), first = await h.session.append(file());
    const foreign = session(h, { owner: 'other', projectId: first.id });
    await expect(foreign.session.loadExisting()).rejects.toThrow(/conta/);
    await expect(foreign.session.append(file())).rejects.toThrow(/conta/);
    expect(await h.storage.listProjects('other')).toEqual([]); expect(foreign.inspect).not.toHaveBeenCalled();
    await h.storage.saveProject('owner', { ...first, state: 'submitted' });
    await expect(h.session.append(file('extra.webm'))).rejects.toThrow(/Aguarde/);
    await expect(h.session.remove(first.takes[0].id)).rejects.toThrow(/Aguarde/);
    expect((await h.storage.getProject('owner', first.id))!.editing!.assets).toHaveLength(1);
  });

  it('mesmo REC compartilha a operação, concorrência distinta é bloqueada e IDs não dependem do nome', async () => {
    const metadata = deferred<StudioMediaMetadata>(), h = session(undefined, {}, vi.fn(() => metadata.promise));
    const candidate = file(), first = h.session.append(candidate, { operationId: 'rec-1' });
    const repeated = h.session.append(candidate, { operationId: 'rec-1' });
    expect(repeated).toBe(first);
    await expect(h.session.append(file(), { operationId: 'rec-2' })).rejects.toBeInstanceOf(StudioRecordingBusyError);
    await expect(h.session.remove('old')).rejects.toBeInstanceOf(StudioRecordingBusyError);
    metadata.resolve(video()); const saved = await first;
    const idempotent = await h.session.append(candidate, { operationId: 'rec-1' });
    expect(idempotent.revision).toBe(saved.revision); expect(idempotent.takes).toHaveLength(1); expect(h.inspect).toHaveBeenCalledTimes(1);
    await expect(h.session.append(file(), { operationId: 'rec-1' })).rejects.toThrow(/outro arquivo/);
    const next = await h.session.append(file(), { operationId: 'rec-2' });
    expect(next.takes).toHaveLength(2); expect(new Set(next.takes.map(take => take.assetId)).size).toBe(2);
  });

  it('quota depois de salvar os bytes não perde File e retry reutiliza fontes/IDs sem duplicar', async () => {
    const h = session(), candidate = file(), add = vi.spyOn(h.storage, 'putAsset');
    const originalPut = IDBObjectStore.prototype.put;
    const failing = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'projects') throw new DOMException('Full', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });
    await expect(h.session.append(candidate, { operationId: 'retry' })).rejects.toThrow(/sem espaço/);
    expect(await candidate.text()).toBe('original-encoded-bytes');
    const blank = h.session.current()!;
    expect(blank.revision).toBe(0); expect((await h.storage.getProject('owner', blank.id))!.takes).toHaveLength(0);
    expect(add).toHaveBeenCalledTimes(2); const assetId = add.mock.calls[0][2];
    expect(await (await h.storage.getAsset('owner', blank.id, assetId))!.text()).toBe(await candidate.text());
    failing.mockRestore();
    const retried = await h.session.append(candidate, { operationId: 'retry' });
    expect(retried.takes).toHaveLength(1); expect(retried.takes[0].assetId).toBe(assetId); expect(add).toHaveBeenCalledTimes(2);
    expect(h.inspect).toHaveBeenCalledTimes(1);
  });

  it('erro após confirmação durável é recuperado, e retry não ressuscita take removido', async () => {
    const h = session(), candidate = file(), save = h.storage.saveProject;
    vi.spyOn(h.storage, 'saveProject').mockImplementationOnce(async (owner, project) => { await save(owner, project); throw new Error('receipt perdido'); });
    await expect(h.session.append(candidate, { operationId: 'rec' })).rejects.toThrow('receipt perdido');
    const saved = (await h.storage.listProjects('owner'))[0]; expect(saved.takes).toHaveLength(1);
    const retried = await h.session.append(candidate, { operationId: 'rec' });
    expect(retried.revision).toBe(1); expect(retried.takes).toHaveLength(1);
    const removed = await h.session.remove(retried.takes[0].id);
    const again = await h.session.append(candidate, { operationId: 'rec' });
    expect(again.revision).toBe(removed.revision); expect(again.takes).toHaveLength(0);
  });

  it('ao trocar candidato mantém ledger leve e reinspeciona somente retry ainda não confirmado', async () => {
    const h = session(), a = file('a.webm'), b = file('b.webm'), save = h.storage.saveProject;
    vi.spyOn(h.storage, 'saveProject').mockRejectedValueOnce(new Error('falha A')).mockRejectedValueOnce(new Error('falha B'));
    await expect(h.session.append(a, { operationId: 'a' })).rejects.toThrow('falha A');
    await expect(h.session.append(b, { operationId: 'b' })).rejects.toThrow('falha B');
    const retried = await h.session.append(a, { operationId: 'a' });
    expect(h.inspect).toHaveBeenCalledTimes(3); // A's previous decoded thumbnail was released.
    expect(retried.takes).toHaveLength(1);
    const again = await h.session.append(a, { operationId: 'a' });
    expect(again.revision).toBe(retried.revision); expect(h.inspect).toHaveBeenCalledTimes(3);
    await expect(h.session.append(file('a.webm'), { operationId: 'a' })).rejects.toThrow(/outro arquivo/);
    expect(await a.text()).toBe('original-encoded-bytes');
    expect((await save('owner', { ...again, title: 'Continua disponível' })).title).toBe('Continua disponível');
  });

  it('quota na miniatura depois do original preserva candidato e retry completa só o que falta', async () => {
    const h = session(), candidate = file(), put = h.storage.putAsset;
    vi.spyOn(h.storage, 'putAsset').mockImplementationOnce(put).mockRejectedValueOnce(new Error('quota da miniatura'));
    await expect(h.session.append(candidate, { operationId: 'thumb' })).rejects.toThrow('quota da miniatura');
    expect(h.session.current()!.takes).toHaveLength(0);
    const retried = await h.session.append(candidate, { operationId: 'thumb' });
    expect(retried.takes).toHaveLength(1); expect(h.storage.putAsset).toHaveBeenCalledTimes(3);
    expect(await (await h.reopen().getAsset('owner', retried.id, `${retried.takes[0].assetId}:thumbnail`))!.text()).toBe('jpeg-thumbnail');
    expect(await (await h.reopen().getAsset('owner', retried.id, retried.takes[0].assetId!))!.text()).toBe(await candidate.text());
  });

  it('CAS impede overwrite; retry combina o novo take com edição externa sem perder título/texto', async () => {
    const h = session(), first = await h.session.append(file('first.webm'));
    const save = h.storage.saveProject;
    vi.spyOn(h.storage, 'saveProject').mockImplementationOnce(async (owner, next) => {
      const external = (await h.storage.getProject(owner, next.id))!;
      await save(owner, { ...addText(external, 'Texto de outra aba', 0, 1, { itemId: 'text', layerId: 'titles' }), title: 'Nome atualizado' });
      return save(owner, next);
    });
    const candidate = file('second.webm');
    await expect(h.session.append(candidate, { operationId: 'second' })).rejects.toBeInstanceOf(StudioStorageConflictError);
    const retried = await h.session.append(candidate, { operationId: 'second' });
    expect(retried.takes).toHaveLength(2); expect(retried.title).toBe('Nome atualizado');
    expect(retried.editing!.layers[0].items[0].text!.content).toBe('Texto de outra aba'); expect(retried.revision).toBe(first.revision + 2);
  });

  it('remove o ID correto, conserva originais, ajusta autocapa e deixa último take vazio gravável', async () => {
    const h = session(), first = await h.session.append(file('one.webm')), firstAsset = first.editing!.assets[0];
    h.inspect.mockResolvedValueOnce(video(3));
    const all = await h.session.append(file('two.webm')), removed = await h.session.remove(first.takes[0].id);
    expect(removed.takes.map(take => take.id)).toEqual([all.takes[1].id]); expect(compileStudioRecipe(removed).durationTicks).toBe(studioTicks(3));
    expect(removed.coverUri).toBe(all.editing!.assets[1].thumbnailUri); expect(removed.editing!.assets).toHaveLength(2);
    expect(await h.storage.getAsset('owner', removed.id, firstAsset.id)).not.toBeNull();
    const empty = await h.session.remove(removed.takes[0].id);
    expect(empty.takes).toHaveLength(0); expect(empty.coverUri).toBeUndefined(); expect(compileStudioRecipe(empty).durationTicks).toBe(0);
    expect((await h.session.remove(removed.takes[0].id)).revision).toBe(empty.revision);
    expect((await h.session.append(file('three.webm'))).takes).toHaveLength(1);
  });

  it('remoção que falha mantém montagem/capa; retry conserva capa manual e edição externa', async () => {
    const h = session(), first = await h.session.append(file());
    const updated = await h.storage.saveProject('owner', { ...first, coverUri: 'manual-cover', coverUrl: 'https://example.invalid/cover' });
    const save = h.storage.saveProject;
    vi.spyOn(h.storage, 'saveProject').mockRejectedValueOnce(new Error('falha de disco'));
    await expect(h.session.remove(first.takes[0].id)).rejects.toThrow('falha de disco');
    expect((await h.storage.getProject('owner', first.id))!.takes).toHaveLength(1);
    await save('owner', patchClip(updated, first.takes[0].id, { gain: .5 }));
    const removed = await h.session.remove(first.takes[0].id);
    expect(removed.coverUri).toBe('manual-cover'); expect(removed.coverUrl).toBe(updated.coverUrl); expect(removed.editing!.assets).toEqual(first.editing!.assets);
  });

  it('cancelar codec ou contexto antes da escrita não cria projeto; callbacks antigos não escapam do owner', async () => {
    const metadata = deferred<StudioMediaMetadata>(); let active = true;
    const h = session(undefined, { isCurrent: () => active }, vi.fn(() => metadata.promise));
    const result = h.session.append(file()); active = false; metadata.resolve(video());
    await expect(result).rejects.toMatchObject({ name: 'AbortError' }); expect(await h.storage.listProjects('owner')).toEqual([]);
    active = true;
    const abort = new AbortController(); abort.abort();
    await expect(h.session.append(file(), { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(h.session.loadExisting({ isCurrent: () => false })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await h.storage.listProjects('owner')).toEqual([]);
  });

  it('durable save iniciado termina no owner capturado; nova operação espera a confirmação', async () => {
    const h = session(), hold = deferred<void>(), entered = deferred<void>(); let active = true;
    const save = h.storage.saveProject;
    vi.spyOn(h.storage, 'saveProject').mockImplementationOnce(async (owner, project) => { entered.resolve(); await hold.promise; return save(owner, project); });
    const result = h.session.append(file(), { isCurrent: () => active });
    await entered.promise; active = false;
    await expect(h.session.remove('something')).rejects.toBeInstanceOf(StudioRecordingBusyError);
    hold.resolve(); const saved = await result;
    expect(saved.ownerId).toBe('owner'); expect(saved.takes).toHaveLength(1); expect((await h.reopen().getProject('owner', saved.id))!.revision).toBe(1);
    expect(await h.storage.listProjects('other')).toEqual([]);
  });
});

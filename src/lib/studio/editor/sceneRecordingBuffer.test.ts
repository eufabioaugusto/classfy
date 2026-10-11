// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { Blob, File } from 'node:buffer';
import { createStudioSceneRecordingBuffer } from './sceneRecordingBuffer';
const buffers: ReturnType<typeof createStudioSceneRecordingBuffer>[] = [];
beforeEach(() => { vi.stubGlobal('File', File); });
afterEach(async () => { vi.restoreAllMocks(); for (const buffer of buffers.splice(0)) await buffer.dispose(); vi.unstubAllGlobals(); });
function make(options: Parameters<typeof createStudioSceneRecordingBuffer>[0] = {}) {
  const buffer = createStudioSceneRecordingBuffer({ indexedDB: new IDBFactory(), databaseName: 'scenes-buffer-test', id: `take-${buffers.length}`, ...options }); buffers.push(buffer); return buffer;
}
const chunk = (value: string) => new Blob([value], { type: 'video/webm' });

describe('gravação de cenas com chunks transacionais', () => {
  it('ordena chamadas concorrentes, ignora eventos vazios e lê bytes reais após flush', async () => {
    const buffer = make(); await buffer.prepare();
    const writes = [buffer.append(chunk('header/')), buffer.append(chunk('scene-one/')), buffer.append(chunk('')), buffer.append(chunk('scene-two'))];
    const file = await buffer.file('Aula.webm', 'video/webm'); await Promise.all(writes);
    expect(await file.text()).toBe('header/scene-one/scene-two'); expect(file.type).toBe('video/webm'); expect(file.name).toBe('Aula.webm'); expect(file.size).toBe(buffer.bytes);
  });
  it('cada sessão mantém seus chunks isolados e dispose não apaga outra gravação', async () => {
    const factory = new IDBFactory(), first = make({ indexedDB: factory }), second = make({ indexedDB: factory });
    await Promise.all([first.prepare(), second.prepare()]); await first.append(chunk('first')); await second.append(chunk('second'));
    const retained = await first.file('first.webm', 'video/webm'); await first.dispose();
    expect(await retained.text()).toBe('first'); expect(await (await second.file('second.webm', 'video/webm')).text()).toBe('second');
    await expect(first.append(chunk('late'))).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('file aguardando escrita não devolve um candidato incompleto', async () => {
    const buffer = make(); const writing = buffer.append(chunk('native-data'));
    const file = await buffer.file('take.webm', 'video/webm'); await writing; expect(await file.text()).toBe('native-data');
  });
  it('quota não perde header já durável nem o último chunk recebido', async () => {
    const buffer = make(); await buffer.prepare(); await buffer.append(chunk('header/'));
    const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await expect(buffer.append(chunk('last-frame/'))).rejects.toThrow('sem espaço'); add.mockRestore();
    await expect(buffer.append(chunk('stop-tail'))).rejects.toThrow();
    expect(await (await buffer.file('partial.webm', 'video/webm')).text()).toBe('header/last-frame/stop-tail');
  });
  it('backlog encerra com erro explícito mantendo o trecho recebido disponível', async () => {
    const buffer = make({ maximumPendingBytes: 2 }); await buffer.prepare();
    await expect(buffer.append(chunk('large-frame'))).rejects.toThrow('disco não está acompanhando');
    expect(await (await buffer.file('partial.webm', 'video/webm')).text()).toBe('large-frame');
  });
  it('sem IndexedDB não prepara uma gravação que não poderá ser salva', async () => {
    vi.stubGlobal('indexedDB', undefined); const buffer = make({ indexedDB: undefined });
    await expect(buffer.prepare()).rejects.toThrow('armazenamento local');
  });
  it('dispose invalida leituras e append pendentes sem reabrir a sessão', async () => {
    const buffer = make(); const writing = buffer.append(chunk('pending')); const file = buffer.file('take.webm', 'video/webm');
    const results = Promise.allSettled([writing, file]); await buffer.dispose();
    expect((await results).every(value => value.status === 'rejected' && value.reason.name === 'AbortError')).toBe(true);
    await expect(buffer.prepare()).rejects.toMatchObject({ name: 'AbortError' });
  });
});

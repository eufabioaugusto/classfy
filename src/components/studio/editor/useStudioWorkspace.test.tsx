import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyStudioEditing, studioTicks, withStudioTakes, type StudioProject } from '../../../../shared/studio';
import { useStudioWorkspace } from './useStudioWorkspace';

const storage = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/studio/editor/storage', () => ({ getProject: storage.get, saveProject: storage.save }));
let value: ReturnType<typeof useStudioWorkspace>, root: Root, host: HTMLDivElement;
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function project(owner = 'owner', id = 'project') { return withStudioTakes({ version: 2, id, ownerId: owner, kind: 'aula', title: 'Aula', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0', editing: emptyStudioEditing('aula'), createdAt: '2026-10-11', updatedAt: '2026-10-11', revision: 0, state: 'draft', progress: 0 }); }
function Probe({ owner = 'owner', id = 'project' }: { owner?: string; id?: string }) { value = useStudioWorkspace(owner, id); return <span>{value.project?.title}</span>; }
async function mount(owner = 'owner', id = 'project') { await act(async () => { root.render(<Probe owner={owner} id={id} />); }); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  storage.get.mockReset(); storage.save.mockReset(); storage.get.mockImplementation(async owner => project(owner));
  storage.save.mockImplementation(async (_owner: string, p: StudioProject) => withStudioTakes({ ...p, editing: p.editing!, revision: p.revision + 1 }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('workspace: autosave, scopes e originais', () => {
  it('risco de saída lê refs atuais antes do próximo render, quando dirty do render anterior ainda é false', async () => {
    await mount(); const snapshot = value; expect(snapshot.dirty).toBe(false);
    await act(async () => {
      snapshot.apply(p => withStudioTakes({ ...p, editing: p.editing!, title: 'Editar e voltar na mesma fila' }));
      expect(snapshot.dirty).toBe(false); expect(snapshot.hasPendingChanges()).toBe(true);
    });
    await act(async () => { await value.flush(); }); expect(snapshot.hasPendingChanges()).toBe(false);
  });
  it('serializa edição durante escrita pendente, usando revisão confirmada sem perder o texto novo', async () => {
    await mount(); const first = deferred<StudioProject>(); storage.save.mockImplementationOnce(() => first.promise);
    await act(async () => value.apply(p => withStudioTakes({ ...p, editing: p.editing!, title: 'Primeira' })));
    let saving!: Promise<StudioProject | null>; await act(async () => { saving = value.flush(); });
    expect(storage.save).toHaveBeenCalledTimes(1);
    await act(async () => value.apply(p => withStudioTakes({ ...p, editing: p.editing!, title: 'Segunda' })));
    await act(async () => { first.resolve(withStudioTakes({ ...storage.save.mock.calls[0][1], editing: storage.save.mock.calls[0][1].editing, revision: 1 })); await saving; });
    expect(storage.save).toHaveBeenCalledTimes(2); expect(storage.save.mock.calls[1][1].revision).toBe(1);
    expect(value.project?.title).toBe('Segunda'); expect(value.project?.revision).toBe(2); expect(value.dirty).toBe(false);
  });
  it('conserva draft e erro verdadeiro depois de quota, permitindo salvar novamente', async () => {
    await mount(); storage.save.mockRejectedValueOnce(new Error('Sem espaço no navegador'));
    await act(async () => value.apply(p => withStudioTakes({ ...p, editing: p.editing!, title: 'Não perder' })));
    await act(async () => { await expect(value.flush()).rejects.toThrow('Sem espaço'); });
    expect(value.project?.title).toBe('Não perder'); expect(value.error).toBe('Sem espaço no navegador'); expect(value.dirty).toBe(true);
    await act(async () => { await value.flush(); }); expect(value.dirty).toBe(false); expect(value.error).toBeNull();
  });
  it('undo de importação retira a montagem mas preserva o blob original referenciado pela biblioteca', async () => {
    await mount(); const asset = { id: 'video', kind: 'video' as const, name: 'aula.mp4', uri: 'file://original', durationTicks: studioTicks(5) };
    await act(async () => value.apply(p => withStudioTakes({ ...p, editing: { ...p.editing!, assets: [asset], main: [{ id: 'clip', assetId: asset.id, sourceStartTicks: 0, sourceEndTicks: asset.durationTicks }] } })));
    await act(async () => { await value.flush(); });
    await act(async () => value.undo());
    expect(value.project?.takes).toHaveLength(0); expect(value.project?.editing?.assets).toEqual([asset]);
    await act(async () => { await value.flush(); });
    await act(async () => value.redo()); expect(value.project?.takes).toHaveLength(1); expect(value.project?.takes[0].assetId).toBe('video');
  });
  it('desmontar antes do debounce termina o salvamento com owner e snapshot originais', async () => {
    await mount('first'); await act(async () => value.apply(p => withStudioTakes({ ...p, editing: p.editing!, title: 'Salvar ao sair' })));
    await mount('second');
    expect(storage.save.mock.calls[0][0]).toBe('first'); expect(storage.save.mock.calls[0][1].title).toBe('Salvar ao sair');
    expect(value.project?.ownerId).toBe('second'); expect(value.project?.title).toBe('Aula');
  });
  it('desmontar atrás de uma escrita pendente salva o último draft na revisão confirmada e nunca na conta nova', async () => {
    await mount('first'); const writing = deferred<StudioProject>(); storage.save.mockImplementationOnce(() => writing.promise);
    await act(async () => value.apply(p => withStudioTakes({ ...p, editing: p.editing!, title: 'Versão 1' })));
    let saving!: Promise<StudioProject | null>; await act(async () => { saving = value.flush(); });
    await act(async () => value.apply(p => withStudioTakes({ ...p, editing: p.editing!, title: 'Versão final' })));
    await mount('second'); await act(async () => { const first = storage.save.mock.calls[0][1]; writing.resolve(withStudioTakes({ ...first, editing: first.editing!, revision: 1 })); await saving; });
    expect(storage.save).toHaveBeenCalledTimes(2); expect(storage.save.mock.calls[1][0]).toBe('first'); expect(storage.save.mock.calls[1][1].revision).toBe(1); expect(storage.save.mock.calls[1][1].title).toBe('Versão final');
    expect(value.project?.ownerId).toBe('second'); expect(value.project?.title).toBe('Aula');
  });
  it('trocar conta rejeita resposta antiga de leitura e escrita sem contaminar a conta atual', async () => {
    const oldRead = deferred<StudioProject>(); storage.get.mockImplementationOnce(() => oldRead.promise);
    await mount('first'); await mount('second');
    await act(async () => oldRead.resolve(project('first'))); expect(value.project?.ownerId).toBe('second');
    const oldWrite = deferred<StudioProject>(); storage.save.mockImplementationOnce(() => oldWrite.promise);
    await act(async () => value.apply(p => withStudioTakes({ ...p, editing: p.editing!, title: 'Segunda edição' })));
    let saving!: Promise<StudioProject | null>; await act(async () => { saving = value.flush(); });
    await mount('third'); await act(async () => { oldWrite.resolve(project('second')); await saving; });
    expect(value.project?.ownerId).toBe('third'); expect(value.project?.title).toBe('Aula'); expect(value.saving).toBe(false);
  });
});

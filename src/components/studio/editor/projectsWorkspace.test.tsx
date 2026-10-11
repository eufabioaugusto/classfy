import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyStudioEditing, withStudioTakes, type StudioProject } from '../../../../shared/studio';
import { StudioProjectsWorkspace } from './StudioProjectsWorkspace';
const storage = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), save: vi.fn(), duplicate: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/studio/editor/storage', () => ({ listProjects: storage.list, createProject: storage.create, saveProject: storage.save, duplicateProject: storage.duplicate, deleteProject: storage.remove, getAsset: vi.fn(async () => null) }));
let host: HTMLDivElement, root: Root;
function fixture(owner = 'owner', id = 'project', title = 'Aula local'): StudioProject { return withStudioTakes({ version: 2, id, ownerId: owner, kind: 'aula', title, description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0', editing: emptyStudioEditing('aula'), revision: 0, state: 'draft', progress: 0, createdAt: '2026-10-11', updatedAt: '2026-10-11' }); }
function Location() { return <output data-location>{useLocation().pathname}</output>; }
async function mount(owner = 'owner') { await act(async () => root.render(<MemoryRouter initialEntries={['/studio/projects']}><StudioProjectsWorkspace key={owner} owner={owner} /><Location /></MemoryRouter>)); }
async function click(label: string) { const element = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === label || button.getAttribute('aria-label') === label); expect(element, label).toBeTruthy(); await act(async () => element!.click()); }
async function input(element: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  storage.list.mockReset().mockImplementation(async (owner: string) => [fixture(owner)]); storage.create.mockReset(); storage.save.mockReset().mockResolvedValue(fixture()); storage.duplicate.mockReset().mockResolvedValue(fixture('owner', 'copy', 'Aula local (cópia)')); storage.remove.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
describe('galeria desktop de projetos reais', () => {
  it('hold abre o mesmo menu de opções e suprime navegação no click seguinte', async () => {
    vi.useFakeTimers(); await mount(); const card = host.querySelector('[aria-label="Editar Aula local"]')!;
    await act(async () => { card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); vi.advanceTimersByTime(449); }); expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(1)); expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Duplicar projeto');
    await act(async () => { card.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); card.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/projects');
    await click('Fechar opções'); await click('Opções de Aula local'); expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Duplicar projeto');
  });
  it('renomeia preservando o projeto canônico e exige confirmação específica para excluir', async () => {
    await mount(); await click('Opções de Aula local'); await click('Renomear'); await input(host.querySelector('[role="dialog"] input')!, 'Aula editada'); await click('Salvar nome');
    expect(storage.save).toHaveBeenCalledTimes(1); const saved = storage.save.mock.calls[0][1] as StudioProject; expect(saved.title).toBe('Aula editada'); expect(saved.takes).toEqual([]); expect(saved.editing).toBeDefined();
    await click('Opções de Aula local'); await click('Excluir'); expect(storage.remove).not.toHaveBeenCalled(); await click('Cancelar'); expect(storage.remove).not.toHaveBeenCalled();
    await click('Excluir'); await click('Excluir projeto'); expect(storage.remove.mock.calls).toEqual([['owner', 'project']]);
  });
  it('a duplicação da conta antiga não troca a galeria depois da mudança de conta', async () => {
    let resolve!: () => void; const pending = new Promise<void>(accept => { resolve = accept; }); storage.duplicate.mockReturnValueOnce(pending);
    await mount('first'); await click('Opções de Aula local'); await click('Duplicar projeto'); await mount('second'); await act(async () => resolve());
    expect(storage.duplicate.mock.calls).toEqual([['first', 'project']]); expect(host.querySelectorAll('.se-project-card')).toHaveLength(1); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/projects');
    await click('Opções de Aula local'); await click('Duplicar projeto'); expect(storage.duplicate.mock.calls[1][0]).toBe('second');
  });
  it('busca local não modifica nem remove os projetos', async () => {
    storage.list.mockResolvedValue([fixture('owner', 'a', 'Iluminação'), fixture('owner', 'b', 'Edição')]); await mount(); await input(host.querySelector('[aria-label="Buscar projetos"]')!, 'ilumina');
    expect(host.querySelectorAll('.se-project-card')).toHaveLength(1); expect(host.querySelector('[aria-label="Editar Iluminação"]')).toBeTruthy(); expect(storage.remove).not.toHaveBeenCalled(); expect(storage.save).not.toHaveBeenCalled();
  });
});

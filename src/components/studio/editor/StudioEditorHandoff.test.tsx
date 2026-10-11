import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyStudioEditing, withStudioTakes } from '../../../../shared/studio';
import { StudioEditorHandoff } from './StudioEditorHandoff';
import type { StudioHandoff } from '@/lib/studio/editor/handoff';

const boundary = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/studio/editor/handoff', async importOriginal => ({ ...await importOriginal<object>(), readStudioHandoff: boundary.read }));
const prepared: StudioHandoff = {
  project: withStudioTakes({ version: 2, id: 'p', ownerId: 'owner', kind: 'aula', title: 'Aula preparada', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0', editing: emptyStudioEditing('aula'), createdAt: '', updatedAt: '', revision: 0, state: 'draft', progress: 0 }),
  file: new File(['render'], 'aula.mp4', { type: 'video/mp4' }),
};
function deferred() { let resolve!: (value: StudioHandoff) => void; const promise = new Promise<StudioHandoff>(yes => { resolve = yes; }); return { promise, resolve }; }
let root: Root, host: HTMLDivElement;
const button = () => [...host.querySelectorAll('button')].find(element => element.textContent.includes('Usar arquivo'))!;
async function render(disabled: boolean, onUse: (handoff: StudioHandoff) => void) {
  await act(async () => root.render(<MemoryRouter initialEntries={['/studio/upload?studioProject=p&studioRevision=0']}><StudioEditorHandoff owner="owner" kind="aula" disabled={disabled} onUse={onUse} /></MemoryRouter>));
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  boundary.read.mockReset().mockResolvedValue(prepared);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('seleção assíncrona do arquivo preparado', () => {
  it('preserva a seleção manual quando ela chega durante a leitura do editor', async () => {
    const onUse = vi.fn(), read = deferred();
    await render(false, onUse);
    boundary.read.mockReturnValueOnce(read.promise);
    await act(async () => button().click());
    await render(true, onUse);
    await act(async () => read.resolve(prepared));
    expect(onUse).not.toHaveBeenCalled();
    await render(false, onUse);
    expect(button().disabled).toBe(false);
  });

  it('usa o contexto atual do upload depois da leitura, sem callback antigo', async () => {
    const oldUse = vi.fn(), latestUse = vi.fn(), read = deferred();
    await render(false, oldUse);
    boundary.read.mockReturnValueOnce(read.promise);
    await act(async () => button().click());
    await render(false, latestUse);
    await act(async () => read.resolve(prepared));
    expect(oldUse).not.toHaveBeenCalled();
    expect(latestUse).toHaveBeenCalledWith(prepared);
  });
});

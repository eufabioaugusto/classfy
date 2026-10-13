import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyStudioEditing, studioTicks, withStudioTakes, type StudioProject, type StudioRenderRecipe } from '../../../../shared/studio';
import { addMainAsset } from '@/lib/studio/editor/commands';
import { StudioEditorWorkspace } from './StudioEditorWorkspace';
import { initializeStudioExitGuard } from './useStudioExitGuard';

const io = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), setRecipe: vi.fn(), preparePortrait: vi.fn() }));
vi.mock('@/lib/studio/editor/storage', () => ({
  getProject: io.get, saveProject: io.save, getAsset: vi.fn(async () => null), putAsset: vi.fn(),
  getExport: vi.fn(async () => null), storeExport: vi.fn(),
  studioAssetUri: (owner: string, project: string, id: string, name: string) => `file://classfy-studio/${owner}/${project}/${id}/${name}`,
}));
vi.mock('@/lib/studio/editor/export', () => ({
  getStudioExportCapabilities: vi.fn(async () => ({ available: true, audio: true, colorSpace: 'rec709', profiles: [] })),
  exportStudioProject: vi.fn(), releaseStudioExport: vi.fn(),
}));
vi.mock('@/lib/studio/editor/renderer', () => ({ createStudioRenderer: vi.fn(async () => ({
  setRecipe: io.setRecipe, preparePortrait: io.preparePortrait,
  subscribe: (callback: (state: unknown) => void) => { callback({ position: 0, playing: false, loading: false, error: null }); return () => undefined; },
  seek: vi.fn(async () => undefined), play: vi.fn(async () => undefined), pause: vi.fn(), dispose: vi.fn(),
})) }));
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, ResizableHandle: () => <div />,
}));

let host: HTMLDivElement, root: Root, saved: StudioProject | undefined;
function initialProject(): StudioProject {
  const base = withStudioTakes({ version: 2, id: 'magic-project', ownerId: 'owner', kind: 'aula', title: 'Cena de teste',
    description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0',
    editing: emptyStudioEditing('aula'), revision: 0, state: 'draft', progress: 0,
    createdAt: '2026-10-13', updatedAt: '2026-10-13' });
  const project = addMainAsset(base, { id: 'video-original', kind: 'video', name: 'Principal.mp4',
    uri: 'file://classfy-studio/owner/magic-project/video-original/Principal.mp4', durationTicks: studioTicks(10),
    width: 1920, height: 1080, hasAudio: true }, 'main');
  return withStudioTakes({ ...project, editing: { ...project.editing!, assets: [...project.editing!.assets,
    { id: 'image-original', kind: 'image', name: 'Retrato.jpg', uri: 'file://classfy-studio/owner/magic-project/image-original/Retrato.jpg',
      durationTicks: 0, width: 640, height: 640 }] } });
}
function button(label: string): HTMLButtonElement {
  const value = Array.from(host.querySelectorAll('button')).find(element => element.textContent?.trim() === label || element.getAttribute('aria-label') === label);
  expect(value, `botão ${label}`).toBeTruthy(); return value!;
}
async function click(label: string) { await act(async () => button(label).click()); }
function latestRecipe(): StudioRenderRecipe { return io.setRecipe.mock.calls.at(-1)![0]; }

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  initializeStudioExitGuard();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); saved = undefined;
  io.get.mockReset().mockResolvedValue(initialProject());
  io.save.mockReset().mockImplementation(async (_owner: string, value: StudioProject) => {
    saved = withStudioTakes({ ...value, editing: value.editing!, revision: value.revision + 1 }); return saved;
  });
  io.setRecipe.mockReset().mockResolvedValue(undefined); io.preparePortrait.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('comparação e histórico reais do editor', () => {
  it('comparar não persiste o original e Undo da inserção remove o alvo sem derrubar o workspace', async () => {
    await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="magic-project" /></MemoryRouter>));
    const image = Array.from(host.querySelectorAll('.se-asset-grid article')).find(article => article.textContent?.includes('Retrato.jpg'))!;
    await act(async () => (image.querySelector('.se-asset-overlay') as HTMLButtonElement).click());
    await click('Retoque natural');
    expect(io.preparePortrait).toHaveBeenCalledOnce();
    const id = saved!.editing!.layers[0].items[0].id;
    expect(saved!.editing!.layers[0].items[0].portrait).toEqual({ version: 1, strength: .4 });
    const writes = io.save.mock.calls.length;
    await click('Comparar com original');
    expect(host.textContent).toContain('Original · trecho selecionado');
    expect(latestRecipe().clips.find(clip => clip.id === id)!.portrait).toBeUndefined();
    expect(io.save).toHaveBeenCalledTimes(writes);
    expect(saved!.editing!.layers[0].items[0].portrait?.strength).toBe(.4);

    await click('Desfazer'); // Remove o tratamento, sem consumir uma entrada de comparação.
    expect(latestRecipe().clips.find(clip => clip.id === id)!.portrait).toBeUndefined();
    await click('Desfazer'); // O alvo selecionado deixa de existir.
    expect(latestRecipe().clips.map(clip => clip.id)).toEqual(['main']);
    expect(host.textContent).not.toContain('Original · trecho selecionado');
    expect(host.textContent).toContain('Selecione um elemento');
    expect(button('Reproduzir montagem').disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();

    await click('Refazer'); await click('Refazer');
    expect(latestRecipe().clips.find(clip => clip.id === id)!.portrait).toEqual({ version: 1, strength: .4 });
    expect(latestRecipe().requiredFeatures).toEqual(['portrait-v1']);
    expect(latestRecipe().assets.map(asset => asset.id).sort()).toEqual(['image-original', 'video-original']);
  });
});

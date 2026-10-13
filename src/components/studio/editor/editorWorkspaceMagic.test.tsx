import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyStudioEditing, studioGrade, studioTicks, withStudioTakes, type StudioEnhancement, type StudioProject, type StudioRenderRecipe } from '../../../../shared/studio';
import { measureStudioScene } from '../../../../shared/studio/autoEnhance';
import { addLayerAsset, addMainAsset, patchClip } from '@/lib/studio/editor/commands';
import { StudioEditorWorkspace } from './StudioEditorWorkspace';
import { initializeStudioExitGuard } from './useStudioExitGuard';

const io = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), getAsset: vi.fn(), setRecipe: vi.fn(), preparePortrait: vi.fn(), prepareSignature: vi.fn(), measureSignature: vi.fn() }));
vi.mock('@/lib/studio/editor/storage', () => ({
  getProject: io.get, saveProject: io.save, getAsset: io.getAsset, putAsset: vi.fn(),
  getExport: vi.fn(async () => null), storeExport: vi.fn(),
  studioAssetUri: (owner: string, project: string, id: string, name: string) => `file://classfy-studio/${owner}/${project}/${id}/${name}`,
}));
vi.mock('@/lib/studio/editor/export', () => ({
  getStudioExportCapabilities: vi.fn(async () => ({ available: true, audio: true, colorSpace: 'rec709', profiles: [] })),
  exportStudioProject: vi.fn(), releaseStudioExport: vi.fn(),
}));
vi.mock('@/lib/studio/editor/renderer', () => ({ createStudioRenderer: vi.fn(async () => ({
  setRecipe: io.setRecipe, preparePortrait: io.preparePortrait, prepareSignature: io.prepareSignature, measureSignature: io.measureSignature,
  subscribe: (callback: (state: unknown) => void) => { callback({ position: 0, playing: false, loading: false, error: null }); return () => undefined; },
  seek: vi.fn(async () => undefined), play: vi.fn(async () => undefined), pause: vi.fn(), dispose: vi.fn(),
})) }));
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, ResizableHandle: () => <div />,
}));

let host: HTMLDivElement, root: Root, saved: StudioProject | undefined;
const priorEnhancement: StudioEnhancement = { version: 1, strength: .5, exposure: .2, contrast: 0, saturation: 0, temperature: 0, tint: 0, shadows: 0, highlights: 0, analyzedFrames: 1 };
const selectiveSample = () => ({
  subject: measureStudioScene(new Uint8ClampedArray([120, 110, 100, 255])),
  background: measureStudioScene(new Uint8ClampedArray([210, 210, 210, 255])), personPresent: true, facePresent: true,
});
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
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
function signatureProject() {
  const base = initialProject(), image = base.editing!.assets.find(asset => asset.id === 'image-original')!;
  return patchClip(addLayerAsset(base, image, 0, { itemId: 'image', layerId: 'images' }), 'image', {
    enhancement: priorEnhancement, portrait: { version: 1, strength: .4 }, grade: studioGrade('cinematic'),
  });
}
async function mountSignatureProject() {
  io.get.mockResolvedValue(signatureProject());
  await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="magic-project" /></MemoryRouter>));
  await act(async () => host.querySelector('[aria-label="Selecionar camada"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

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
  io.prepareSignature.mockReset().mockResolvedValue(undefined); io.measureSignature.mockReset().mockImplementation(async () => selectiveSample());
  io.getAsset.mockReset().mockImplementation(async (_owner: string, _project: string, id: string) => id === 'image-original' ? new Blob(['local original'], { type: 'image/jpeg' }) : null);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 640, height: 640, close: vi.fn() })));
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
    expect(saved!.editing!.layers[0].items[0].portrait).toEqual({ version: 2, strength: .45 });
    const writes = io.save.mock.calls.length;
    await click('Comparar com original');
    expect(host.textContent).toContain('Original · trecho selecionado');
    expect(latestRecipe().clips.find(clip => clip.id === id)!.portrait).toBeUndefined();
    expect(io.save).toHaveBeenCalledTimes(writes);
    expect(saved!.editing!.layers[0].items[0].portrait?.strength).toBe(.45);

    await click('Desfazer'); // Remove o tratamento, sem consumir uma entrada de comparação.
    expect(latestRecipe().clips.find(clip => clip.id === id)!.portrait).toBeUndefined();
    await click('Desfazer'); // O alvo selecionado deixa de existir.
    expect(latestRecipe().clips.map(clip => clip.id)).toEqual(['main']);
    expect(host.textContent).not.toContain('Original · trecho selecionado');
    expect(host.textContent).toContain('Selecione um elemento');
    expect(button('Reproduzir montagem').disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();

    await click('Refazer'); await click('Refazer');
    expect(latestRecipe().clips.find(clip => clip.id === id)!.portrait).toEqual({ version: 2, strength: .45 });
    expect(latestRecipe().requiredFeatures).toEqual(['portrait-v2']);
    expect(latestRecipe().assets.map(asset => asset.id).sort()).toEqual(['image-original', 'video-original']);
  });

  it('assinatura substitui melhoria em um único undo, compare não salva, remoção e redo preservam retrato/grade e originais', async () => {
    await mountSignatureProject(); await click('Aplicar assinatura');
    expect(io.prepareSignature).toHaveBeenCalledOnce(); expect(io.measureSignature).toHaveBeenCalledOnce(); expect(io.save).toHaveBeenCalledOnce();
    const treated = latestRecipe().clips.find(clip => clip.id === 'image')!;
    expect(treated.signature?.strength).toBe(.85); expect(treated.enhancement).toBeUndefined();
    expect(treated.portrait).toEqual({ version: 1, strength: .4 }); expect(treated.grade).toEqual(studioGrade('cinematic'));
    expect(latestRecipe().requiredFeatures).toEqual(['portrait-v1', 'cinematic-signature-v1']);
    await click('Comparar com original');
    expect(latestRecipe().clips.find(clip => clip.id === 'image')).toMatchObject({ grade: studioGrade(), effect: 'natural' });
    expect(latestRecipe().clips.find(clip => clip.id === 'image')!.signature).toBeUndefined();
    expect(io.save).toHaveBeenCalledOnce(); expect(saved!.editing!.layers[0].items[0].signature).toEqual(treated.signature);
    await click('Desfazer'); await click('Voltar aos ajustes');
    expect(latestRecipe().clips.find(clip => clip.id === 'image')).toMatchObject({ enhancement: priorEnhancement, portrait: { version: 1, strength: .4 }, grade: studioGrade('cinematic') });
    expect(latestRecipe().clips.find(clip => clip.id === 'image')!.signature).toBeUndefined();
    await click('Refazer'); expect(latestRecipe().clips.find(clip => clip.id === 'image')!.signature).toEqual(treated.signature);
    await click('Remover assinatura');
    expect(latestRecipe().clips.find(clip => clip.id === 'image')!.signature).toBeUndefined();
    expect(latestRecipe().clips.find(clip => clip.id === 'image')!.portrait).toEqual(treated.portrait);
    await click('Desfazer'); expect(latestRecipe().clips.find(clip => clip.id === 'image')!.signature).toEqual(treated.signature);
    expect(latestRecipe().assets.map(asset => asset.id).sort()).toEqual(['image-original', 'video-original']);
  });

  it('Cancelar durante análise ignora resultado tardio, fecha bitmap e conserva melhoria anterior sem gravar', async () => {
    const pending = deferred<ReturnType<typeof selectiveSample>>(); io.measureSignature.mockImplementationOnce(() => pending.promise);
    await mountSignatureProject(); await click('Aplicar assinatura');
    expect(io.measureSignature).toHaveBeenCalledOnce();
    const signal = io.measureSignature.mock.calls[0][3] as AbortSignal;
    await click('Cancelar'); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(selectiveSample()));
    expect(io.save).not.toHaveBeenCalled();
    expect(latestRecipe().clips.find(clip => clip.id === 'image')).toMatchObject({ enhancement: priorEnhancement, portrait: { version: 1, strength: .4 } });
    expect(latestRecipe().clips.find(clip => clip.id === 'image')!.signature).toBeUndefined();
    const bitmap = await vi.mocked(createImageBitmap).mock.results[0].value; expect(bitmap.close).toHaveBeenCalledOnce();
    expect(host.querySelector('.se-progress-modal')).toBeNull(); expect(button('Aplicar assinatura').disabled).toBe(false);
  });

  it('troca de owner/projeto durante análise impede qualquer escrita ou resultado visual da sessão antiga', async () => {
    const pending = deferred<ReturnType<typeof selectiveSample>>(); io.measureSignature.mockImplementationOnce(() => pending.promise);
    await mountSignatureProject(); await click('Aplicar assinatura'); expect(io.measureSignature).toHaveBeenCalledOnce();
    const original = initialProject(), other = withStudioTakes({ ...original, editing: original.editing!, ownerId: 'other-owner', id: 'other-project', title: 'Outra conta' });
    io.get.mockResolvedValue(other);
    await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="other-owner" projectId="other-project" /></MemoryRouter>));
    await act(async () => pending.resolve(selectiveSample()));
    expect(io.save).not.toHaveBeenCalled(); expect(host.textContent).toContain('Outra conta');
    expect(latestRecipe().clips.map(clip => clip.id)).toEqual(['main']);
    expect(latestRecipe().requiredFeatures).toBeUndefined(); expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('.se-progress-modal')).toBeNull();
  });
});

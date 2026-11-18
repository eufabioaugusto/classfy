import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyStudioEditing, studioGrade, studioTicks, withStudioTakes, type StudioEnhancement, type StudioProject, type StudioRenderRecipe } from '../../../../shared/studio';
import { measureStudioScene } from '../../../../shared/studio/autoEnhance';
import { addLayerAsset, addMainAsset, patchClip } from '@/lib/studio/editor/commands';
import { StudioEditorWorkspace } from './StudioEditorWorkspace';
import { initializeStudioExitGuard } from './useStudioExitGuard';

const io = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), getAsset: vi.fn(), setRecipe: vi.fn(), preparePortrait: vi.fn(), prepareSignature: vi.fn(), measureSignature: vi.fn(), transcribe: vi.fn(), play: vi.fn(async () => undefined) }));
vi.mock('@/lib/studio/editor/storage', () => ({
  getProject: io.get, saveProject: io.save, getAsset: io.getAsset, putAsset: vi.fn(),
  getExport: vi.fn(async () => null), storeExport: vi.fn(),
  studioAssetUri: (owner: string, project: string, id: string, name: string) => `file://classfy-studio/${owner}/${project}/${id}/${name}`,
}));
vi.mock('@/lib/studio/editor/export', () => ({
  getStudioExportCapabilities: vi.fn(async () => ({ available: true, audio: true, colorSpace: 'rec709', profiles: [{ resolution: '2k', width: 2560, height: 1440, frameRate: 60 }] })),
  exportStudioProject: vi.fn(), releaseStudioExport: vi.fn(),
}));
vi.mock('@/lib/studio/editor/renderer', () => ({ createStudioRenderer: vi.fn(async () => ({
  setRecipe: io.setRecipe, preparePortrait: io.preparePortrait, prepareSignature: io.prepareSignature, measureSignature: io.measureSignature,
  subscribe: (callback: (state: unknown) => void) => { callback({ position: 0, playing: false, loading: false, error: null }); return () => undefined; },
  seek: vi.fn(async () => undefined), play: io.play, pause: vi.fn(), dispose: vi.fn(),
})) }));
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, ResizableHandle: () => <div />,
}));

vi.mock('@/lib/studio/editor/studioCaptions', () => ({ transcribeStudioCaptions: io.transcribe }));
vi.mock('@/lib/studio/editor/classEdit', () => ({
  findStudioPauses: vi.fn(async () => [{ start: 2, end: 3 }, { start: 6, end: 7 }]),
}));
vi.mock('@/lib/studio/editor/sceneAnalysis', () => ({
  analyzeStudioScene: vi.fn(async () => priorEnhancement),
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
  io.transcribe.mockReset().mockResolvedValue([]);
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
  it('abre o painel compartilhado e direciona contas Free para o Premium', async () => {
    await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="magic-project" /></MemoryRouter>));
    const panel = host.querySelector('.se-library-content');
    await click('ClassCut');
    expect(host.querySelector('.se-library-content')).toBe(panel);
    expect(panel?.querySelector('a')?.getAttribute('href')).toBe('/planos');
    expect(io.save).not.toHaveBeenCalled();
    await click('Legendas');
    expect(host.querySelector('.se-library-content')).toBe(panel);
    expect(button('Gerar legendas').disabled).toBe(true);
    expect(button('Importar SRT').disabled).toBe(false);
  });

  it('fecha o painel de ferramentas sem remontar a prévia e reabre na aba clicada', async () => {
    await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="magic-project" /></MemoryRouter>));
    const canvas = host.querySelector('canvas');
    await click('Fechar painel de ferramentas');
    expect(host.querySelector('.se-library-content')).toBeNull();
    expect(host.querySelector('canvas')).toBe(canvas);
    await click('Legendas');
    expect(host.querySelector('.se-library-content h2')?.textContent).toBe('Legendas');
    expect(host.querySelector('canvas')).toBe(canvas);
  });

  it('altera ferramenta pelo teclado e exclui a seleção em uma edição reversível', async () => {
    await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="magic-project" /></MemoryRouter>));
    const press = async (key: string, init?: KeyboardEventInit) => {
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...init })));
    };
    await press('b');
    expect(button('Lâmina').getAttribute('aria-pressed')).toBe('true');
    await press('t');
    expect(button('Encurtar pelas bordas').getAttribute('aria-pressed')).toBe('true');
    await press('a');
    expect(button('Seleção').getAttribute('aria-pressed')).toBe('true');
    await press('a', { metaKey: true });
    expect(host.querySelector('[data-timeline-clip]')?.getAttribute('aria-pressed')).toBe('true');
    await press('Backspace');
    expect(host.querySelector('[data-timeline-clip]')).toBeNull();
    await press('z', { metaKey: true });
    expect(host.querySelector('[data-timeline-clip]')).toBeTruthy();
  });

  it('encurta início e fim no cursor com Q e W e divide com Ctrl+B', async () => {
    await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="magic-project" /></MemoryRouter>));
    const ruler = host.querySelector<HTMLElement>('[aria-label="Posição da montagem"]')!;
    ruler.setPointerCapture = vi.fn();
    const seekTo = (seconds: number) => act(async () => {
      ruler.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: seconds * 72 }));
    });
    const press = (key: string, ctrlKey = false) => act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, cancelable: true }));
    });
    await seekTo(2);
    await press('q');
    expect(latestRecipe().clips[0].sourceStartTicks).toBe(studioTicks(2));
    await seekTo(5);
    await press('w');
    expect(latestRecipe().clips[0].sourceEndTicks).toBe(studioTicks(7));
    await seekTo(3);
    await press('b', true);
    expect(latestRecipe().clips.map(clip => [clip.sourceStartTicks, clip.sourceEndTicks])).toEqual([
      [studioTicks(2), studioTicks(5)], [studioTicks(5), studioTicks(7)],
    ]);
  });

  it('pesquisa ações no painel e executa recorte, colagem e agrupamento pelo teclado', async () => {
    await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="magic-project" /></MemoryRouter>));
    const press = (key: string, extra?: KeyboardEventInit) => act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...extra }));
    });
    const waitForSave = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 375)); });
    await click('Atalhos da montagem');
    expect(host.querySelector('[aria-label="Pesquisar ferramentas e atalhos"]')).toBeTruthy();
    await click('Fechar atalhos');
    await press('a', { metaKey: true });
    await press('d', { metaKey: true });
    expect(latestRecipe().clips).toHaveLength(2);
    await press('a', { metaKey: true });
    await press('g', { metaKey: true });
    await waitForSave();
    expect(saved!.editing!.clipGroups?.[0]).toHaveLength(2);
    await press('x', { metaKey: true });
    expect(latestRecipe().clips).toHaveLength(0);
    await press('v', { metaKey: true });
    expect(latestRecipe().clips).toHaveLength(2);
    await waitForSave();
    expect(saved!.editing!.clipGroups?.[0]).toHaveLength(2);
    await press('g', { metaKey: true, shiftKey: true });
    await waitForSave();
    expect(saved!.editing!.clipGroups).toEqual([]);
  });

  it('configura palco, resolução e compressão pelo cabeçalho', async () => {
    await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="magic-project" premium /></MemoryRouter>));
    expect(host.querySelector('.se-editor-brand .se-save-state')).toBeTruthy();
    expect(host.querySelector('.se-editor-header button[aria-label="Atalhos da montagem"]')).toBeTruthy();
    await click('Proporção do palco');
    await click('4:5');
    expect(latestRecipe().canvas.aspectRatio).toBe('4:5');
    await click('Proporção do palco');
    await click('Qualidade do vídeo');
    await click('2K');
    await click('60');
    await click('Alta');
    expect(latestRecipe().output).toMatchObject({ width: 1440, height: 1800, frameRateNumerator: 60,
      selection: { resolution: '2k', frameRate: 60, quality: 'high' } });
  });

  it('ClassCut salva os cortes e o ajuste em uma edição reversível', async () => {
    io.getAsset.mockResolvedValue(new Blob(['original']));
    await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="magic-project" premium /></MemoryRouter>));
    const transcription = deferred<{ text: string; start: number; end: number }[]>();
    io.transcribe.mockReturnValueOnce(transcription.promise);
    await click('ClassCut');
    const modal = host.querySelector('.se-class-edit-progress')!;
    expect(modal.textContent).toContain('Preparando áudio da montagem');
    expect(modal.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('58');
    const onStage = io.transcribe.mock.calls[0][4];
    vi.useFakeTimers();
    await act(async () => onStage('Preparando modelo de voz', .5));
    expect(host.querySelector('.se-class-edit-progress')).toBe(modal);
    expect(modal.textContent).toContain('67%');
    await act(async () => vi.advanceTimersByTimeAsync(1120));
    expect(Number(modal.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'))).toBeGreaterThan(67);
    await act(async () => onStage('Transcrevendo áudio', 0));
    expect(host.querySelector('.se-class-edit-progress')).toBe(modal);
    expect(modal.textContent).toContain('78%');
    await act(async () => vi.advanceTimersByTimeAsync(1120));
    expect(Number(modal.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'))).toBeGreaterThan(78);
    vi.useRealTimers();
    expect(modal.querySelector('progress')).toBeNull();
    await act(async () => transcription.resolve([
      { text: 'Hoje vamos aprender a editar vídeos pelo celular.', start: .3, end: 1.3 },
      { text: 'Hoje vamos aprender a editar vídeos pelo celular.', start: 3, end: 4 },
      { text: 'Hoje nós vamos aprender a editar vídeos pelo celular.', start: 5, end: 6 },
    ]));
    expect(modal.textContent).toContain('100%');
    await vi.waitFor(() => expect(host.querySelector('.se-class-edit-progress')).toBeNull());
    expect(io.save).toHaveBeenCalledOnce();
    expect(saved!.takes.map(take => [take.start, take.end])).toEqual([[0, 2], [3, 6], [7, 10]]);
    expect(latestRecipe().clips.filter(clip => clip.kind === 'video').every(clip => clip.enhancement?.strength === .35 && clip.grade.preset === 'studio')).toBe(true);
    expect(io.transcribe.mock.calls[0][0].takes.map((take: { start: number; end: number }) => [take.start, take.end])).toEqual([[0, 2], [3, 6], [7, 10]]);
    expect(latestRecipe().clips.find(clip => clip.kind === 'caption')?.startTicks).toBe(studioTicks(.3));
    expect(io.transcribe.mock.calls[0][2]).toBe('portuguese');
    expect(host.textContent).toContain('2 pausas encurtadas');
    const entry = button('ClassCut');
    entry.focus();
    const space = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    await act(async () => entry.dispatchEvent(space));
    expect(space.defaultPrevented).toBe(true);
    expect(io.play).toHaveBeenCalled();
    expect(host.querySelector('.se-retake-review summary')?.textContent).toContain('takes repetidos (1)');
    const suggested = host.querySelector<HTMLButtonElement>('.se-retake-group button:has(small)')!;
    expect(suggested.querySelector('time')?.textContent).toBe('0:05.0');
    await act(async () => suggested.click());
    expect(host.textContent).toContain('0:05.0');
    expect(io.play).toHaveBeenLastCalledWith(1, 6);
    await click('Manter take de 0:05.0 e remover os demais');
    expect(latestRecipe().durationTicks).toBe(studioTicks(6));
    expect(latestRecipe().clips.filter(clip => clip.kind === 'caption').map(clip => clip.startTicks)).toEqual([studioTicks(3)]);
    expect(host.textContent).toContain('2 takes removidos');
    await click('Desfazer');
    expect(latestRecipe().clips).toHaveLength(6);
    expect(host.querySelector('.se-retake-review summary')).toBeTruthy();
    await click('Desfazer');
    expect(latestRecipe().clips).toHaveLength(1);
    expect(latestRecipe().clips[0].enhancement).toBeUndefined();
    expect(latestRecipe().durationTicks).toBe(studioTicks(10));
    await click('Refazer');
    expect(latestRecipe().clips).toHaveLength(6);
    expect(latestRecipe().assets.map(asset => asset.id)).toEqual(['video-original']);
    expect(saved!.editing!.assets.map(asset => asset.id)).toEqual(['video-original', 'image-original']);
  });

  it('mantém ClassCut e o ajuste existente ao refazer os cortes', async () => {
    io.get.mockResolvedValue(patchClip(initialProject(), 'main', { enhancement: priorEnhancement }));
    io.getAsset.mockResolvedValue(new Blob(['original']));
    await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="magic-project" premium /></MemoryRouter>));
    expect(button('ClassCut').getAttribute('aria-disabled')).toBe('false');
    await click('ClassCut');
    await vi.waitFor(() => expect(host.querySelector('.se-class-edit-progress')).toBeNull());
    expect(latestRecipe().clips.every(clip => clip.enhancement?.strength === priorEnhancement.strength)).toBe(true);
    expect(button('ClassCut').getAttribute('aria-disabled')).toBe('true');
    await click('Desfazer');
    expect(latestRecipe().clips[0].enhancement).toEqual(priorEnhancement);
    expect(button('ClassCut').getAttribute('aria-disabled')).toBe('false');
  });

  it('mostra o preparo e inicia apenas um download para cliques repetidos', async () => {
    const read = deferred<Blob>();
    io.getAsset.mockImplementation((_owner, _project, id) => id === 'video-original' ? read.promise : null);
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: () => 'blob:original', revokeObjectURL: () => undefined }));
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="magic-project" /></MemoryRouter>));
      await click('Baixar original de Principal.mp4');
      expect(host.textContent).toContain('Preparando download…');
      await click('Baixar original de Principal.mp4');
      await act(async () => read.resolve(new Blob(['original'])));
      expect(host.textContent).toContain('Download iniciado');
      await click('Baixar original de Principal.mp4');
      expect(download).toHaveBeenCalledOnce();
    } finally { download.mockRestore(); }
  });

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

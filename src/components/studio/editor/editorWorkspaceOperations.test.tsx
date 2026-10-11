import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyStudioEditing, studioTicks, withStudioTakes, type StudioProject } from '../../../../shared/studio';
import { StudioEditorWorkspace } from './StudioEditorWorkspace';
import { addMainAsset, addText } from '@/lib/studio/editor/commands';
import { initializeStudioExitGuard } from './useStudioExitGuard';

const boundaries = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), put: vi.fn(), inspect: vi.fn(), capture: vi.fn() }));
vi.mock('@/lib/studio/editor/storage', () => ({
  getProject: boundaries.get, saveProject: boundaries.save, putAsset: boundaries.put, getAsset: vi.fn(async () => null),
  getExport: vi.fn(async () => null), storeExport: vi.fn(), studioAssetUri: (owner: string, project: string, id: string, name: string) => `file://classfy-studio/${owner}/${project}/${id}/${name}`,
}));
vi.mock('@/lib/studio/editor/media', () => ({ inspectStudioMedia: boundaries.inspect }));
vi.mock('@/lib/studio/editor/capture', () => ({ createStudioCapture: boundaries.capture }));
vi.mock('@/lib/studio/editor/export', () => ({
  getStudioExportCapabilities: vi.fn(async () => ({ available: true, audio: true, colorSpace: 'rec709', profiles: [{ resolution: 'hd', width: 1920, height: 1080, frameRate: 30 }] })), exportStudioProject: vi.fn(), releaseStudioExport: vi.fn(),
}));
vi.mock('@/lib/studio/editor/renderer', () => ({ createStudioRenderer: vi.fn(async () => ({
  subscribe: (callback: (state: unknown) => void) => { callback({ position: 0, playing: false, loading: false, error: null }); return () => undefined; },
  setRecipe: vi.fn(async () => undefined), seek: vi.fn(async () => undefined), play: vi.fn(async () => undefined), pause: vi.fn(), dispose: vi.fn(),
})) }));
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, ResizableHandle: () => <div />,
}));
let root: Root, host: HTMLDivElement, recording: File, lastSaved: StudioProject | undefined;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; };
function project(): StudioProject { return withStudioTakes({ version: 2, id: 'project', ownerId: 'owner', kind: 'aula', title: 'Aula', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0', editing: emptyStudioEditing('aula'), revision: 0, state: 'draft', progress: 0, createdAt: '2026-10-11', updatedAt: '2026-10-11' }); }
const info = { kind: 'video', duration: 2, width: 1920, height: 1080, frameRate: 30, hasAudio: true, colorSpace: 'rec709', warnings: [] };
const button = (label: string) => Array.from(host.querySelectorAll('button')).find(element => element.textContent?.trim() === label)!;
async function answer(label: string) { const dialog = document.querySelector('[role="alertdialog"]'); expect(dialog).toBeTruthy(); const element = Array.from(dialog!.querySelectorAll('button')).find(value => value.textContent?.trim() === label)!; expect(element).toBeTruthy(); await act(async () => element.click()); }
async function click(label: string) { const element = button(label); expect(element, `button ${label}`).toBeTruthy(); await act(async () => element.click()); }
async function mount() { await act(async () => root.render(<MemoryRouter><StudioEditorWorkspace owner="owner" projectId="project" /></MemoryRouter>)); }
async function openRecording() { await click('Câmera'); expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeTruthy(); }

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  initializeStudioExitGuard();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  recording = new File(['original recorded bytes'], 'camera.webm', { type: 'video/webm' }); lastSaved = undefined;
  boundaries.get.mockReset().mockResolvedValue(project()); boundaries.save.mockReset().mockImplementation(async (_owner: string, value: StudioProject) => { lastSaved = withStudioTakes({ ...value, editing: value.editing!, revision: value.revision + 1 }); return lastSaved; });
  const originals = new Set<string>();
  boundaries.put.mockReset().mockImplementation(async (_owner: string, _project: string, id: string) => { if (originals.has(id)) throw new Error('Original imutável já existe'); originals.add(id); });
  boundaries.inspect.mockReset().mockResolvedValue(info);
  boundaries.capture.mockReset().mockImplementation(() => ({
    subscribe: (callback: (state: unknown) => void) => { callback({ phase: 'recorded', stream: null, elapsed: 2, file: recording, error: null, input: null, levels: [] }); return () => undefined; },
    prepare: vi.fn(), start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), flip: vi.fn(),
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('fronteiras reais workspace → Recorder → persistência', () => {
  it('só conclui uma gravação depois da escrita durável, mantendo o original enquanto a escrita está pendente', async () => {
    await mount(); await openRecording(); const pending = deferred<StudioProject>(); boundaries.save.mockImplementationOnce(() => pending.promise);
    await click('Usar gravação');
    expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeTruthy(); expect(button('Usar gravação').disabled).toBe(true);
    expect(boundaries.put.mock.calls[0][3]).toBe(recording);
    const draft = boundaries.save.mock.calls[0][1] as StudioProject; expect(draft.takes).toHaveLength(1);
    await act(async () => pending.resolve(withStudioTakes({ ...draft, editing: draft.editing!, revision: 1 })));
    expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeNull();
  });
  it('quota conserva a gravação para retry e confirma o mesmo take, sem tentar sobrescrever o blob nem duplicar a montagem', async () => {
    await mount(); await openRecording(); boundaries.save.mockRejectedValueOnce(new Error('Sem espaço no navegador'));
    await click('Usar gravação'); expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeTruthy(); expect(host.textContent).toContain('Sem espaço no navegador');
    expect(button('Usar gravação').disabled).toBe(false); expect(boundaries.put).toHaveBeenCalledTimes(1);
    await click('Usar gravação');
    expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeNull(); expect(boundaries.inspect).toHaveBeenCalledTimes(1); expect(boundaries.put).toHaveBeenCalledTimes(1);
    expect(lastSaved?.takes).toHaveLength(1); expect(lastSaved?.editing?.assets).toHaveLength(1);
  });
  it('cancelar leitura conserva o mesmo File e só adiciona um take na nova tentativa', async () => {
    await mount(); await openRecording(); const pending = deferred<typeof info>(); boundaries.inspect.mockImplementationOnce(() => pending.promise);
    await click('Usar gravação'); await click('Cancelar'); await act(async () => pending.resolve(info));
    expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeTruthy(); expect(boundaries.put).not.toHaveBeenCalled(); expect(boundaries.save).not.toHaveBeenCalled();
    await click('Usar gravação'); expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeNull();
    expect(boundaries.put.mock.calls[0][3]).toBe(recording); expect(lastSaved?.takes).toHaveLength(1);
  });
  it('erro de codec permanece no Recorder com o arquivo intacto e sem persistir uma referência inválida', async () => {
    await mount(); await openRecording(); boundaries.inspect.mockRejectedValueOnce(new Error('Este codec não pode ser aberto neste navegador.'));
    await click('Usar gravação');
    expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeTruthy(); expect(host.querySelector('[aria-label="Gravar câmera"]')?.textContent).toContain('Este codec não pode ser aberto');
    expect(boundaries.put).not.toHaveBeenCalled(); expect(boundaries.save).not.toHaveBeenCalled(); expect(button('Usar gravação').disabled).toBe(false);
  });
  it('evento nativo cancel libera a reserva do seletor e permite abrir outro fluxo sem importar nada', async () => {
    await mount(); await click('Importar arquivos'); expect(host.querySelector('[aria-label="Escolhendo arquivo"]')).toBeTruthy();
    await act(async () => host.querySelector('input[type="file"][multiple]')!.dispatchEvent(new Event('cancel', { bubbles: true })));
    expect(host.querySelector('[aria-label="Escolhendo arquivo"]')).toBeNull(); expect(boundaries.inspect).not.toHaveBeenCalled(); await openRecording();
  });
  it('Back real do BrowserRouter pede decisão para o Recorder, conserva o arquivo ao cancelar e só descarta ao confirmar a saída', async () => {
    window.history.replaceState({ idx: 3, key: 'editor' }, '', '/editor');
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined), confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const pop = async (index: number, url: string) => { window.history.replaceState({ idx: index, key: `entry-${index}` }, '', url); await act(async () => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))); };
    try {
      await act(async () => root.render(<BrowserRouter><Routes><Route path="/editor" element={<StudioEditorWorkspace owner="owner" projectId="project" />} /><Route path="*" element={<span>Projetos</span>} /></Routes></BrowserRouter>));
      await openRecording(); const controller = boundaries.capture.mock.results[0].value;
      await pop(2, '/projects'); await pop(3, '/editor');
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Descartar a gravação e sair?'); await answer('Continuar no editor'); expect(confirm).not.toHaveBeenCalled(); expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeTruthy(); expect(controller.dispose).not.toHaveBeenCalled(); expect(boundaries.put).not.toHaveBeenCalled();
      await pop(2, '/projects'); await pop(3, '/editor'); await answer('Descartar e sair'); expect(go).toHaveBeenLastCalledWith(-1); expect(button('Usar gravação').disabled).toBe(true); await click('Usar gravação'); expect(boundaries.put).not.toHaveBeenCalled();
      await pop(2, '/projects'); expect(host.textContent).toBe('Projetos'); expect(controller.dispose).toHaveBeenCalledTimes(1); expect(boundaries.put).not.toHaveBeenCalled();
    } finally { go.mockRestore(); confirm.mockRestore(); window.history.replaceState(null, '', '/'); }
  });
  it('blur seguido de POP na mesma fila salva o texto antes de desmontar, mesmo sem render de dirty entre os eventos', async () => {
    const original = addText(addMainAsset(project(), { id: 'video', kind: 'video', name: 'Aula', uri: 'file://original', durationTicks: studioTicks(2), width: 1920, height: 1080 }), 'Seu texto', 0, 2, { itemId: 'text' });
    boundaries.get.mockResolvedValue(original); const writing = deferred<StudioProject>(); boundaries.save.mockImplementationOnce(() => writing.promise);
    window.history.replaceState({ idx: 3, key: 'editor' }, '', '/editor'); const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const pop = async (index: number, url: string) => { window.history.replaceState({ idx: index, key: `entry-${index}` }, '', url); await act(async () => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))); };
    try {
      await act(async () => root.render(<BrowserRouter><Routes><Route path="/editor" element={<StudioEditorWorkspace owner="owner" projectId="project" />} /><Route path="*" element={<span>Projetos</span>} /></Routes></BrowserRouter>));
      await act(async () => host.querySelector<HTMLElement>('[aria-label="Camada Seu texto"]')!.click());
      const field = host.querySelector<HTMLTextAreaElement>('[aria-label="Texto da cena"]')!;
      await act(async () => {
        field.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Texto salvo ao voltar'); field.dispatchEvent(new Event('input', { bubbles: true }));
        field.blur(); // settle clears pendingPatch before React can publish dirty.
        window.history.replaceState({ idx: 2, key: 'projects' }, '', '/projects'); window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
      });
      expect(go).toHaveBeenLastCalledWith(1); expect(host.querySelector('.se-editor')).toBeTruthy(); expect(boundaries.save).toHaveBeenCalledTimes(1);
      const saved = boundaries.save.mock.calls[0][1] as StudioProject; expect(saved.editing?.layers[0].items[0].text?.content).toBe('Texto salvo ao voltar');
      await pop(3, '/editor'); await act(async () => writing.resolve(withStudioTakes({ ...saved, editing: saved.editing!, revision: 1 })));
      expect(go).toHaveBeenLastCalledWith(-1); await pop(2, '/projects'); expect(host.textContent).toBe('Projetos');
    } finally { go.mockRestore(); window.history.replaceState(null, '', '/'); }
  });
  it('Back com seletor pendente bloqueia drop e atalhos antes do render e cancelar conserva a sessão do editor', async () => {
    const original = addText(addMainAsset(project(), { id: 'video', kind: 'video', name: 'Aula', uri: 'file://original', durationTicks: studioTicks(2), width: 1920, height: 1080 }), 'Seu texto', 0, 2, { itemId: 'text' });
    boundaries.get.mockResolvedValue(original); window.history.replaceState({ idx: 3, key: 'editor' }, '', '/editor');
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined), native = vi.spyOn(window, 'confirm');
    const pop = async (index: number, url: string) => { window.history.replaceState({ idx: index }, '', url); await act(async () => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))); };
    try {
      await act(async () => root.render(<BrowserRouter><Routes><Route path="/editor" element={<StudioEditorWorkspace owner="owner" projectId="project" />} /><Route path="*" element={<span>Projetos</span>} /></Routes></BrowserRouter>));
      await act(async () => host.querySelector<HTMLElement>('[aria-label="Camada Seu texto"]')!.click()); await click('Importar arquivos');
      await act(async () => {
        window.history.replaceState({ idx: 2 }, '', '/projects'); window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
        const drop = new Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(drop, 'dataTransfer', { value: { files: [recording], types: ['Files'] } }); host.querySelector('.se-preview-area')!.dispatchEvent(drop);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      });
      await pop(3, '/editor'); expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Cancelar a operação e sair?');
      expect(boundaries.inspect).not.toHaveBeenCalled(); expect(boundaries.save).not.toHaveBeenCalled(); expect(host.querySelector('[aria-label="Camada Seu texto"]')).toBeTruthy();
      await answer('Continuar no editor'); expect(go).toHaveBeenLastCalledWith(1); expect(host.querySelector('[aria-label="Escolhendo arquivo"]')).toBeTruthy(); expect(native).not.toHaveBeenCalled();
      await act(async () => host.querySelector('input[type="file"][multiple]')!.dispatchEvent(new Event('cancel', { bubbles: true }))); await openRecording();
    } finally { go.mockRestore(); native.mockRestore(); window.history.replaceState(null, '', '/'); }
  });
  it('aprovação de saída expira se o seletor autorizado já foi cancelado, sem cancelar um fluxo posterior', async () => {
    window.history.replaceState({ idx: 3, key: 'editor' }, '', '/editor'); const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const pop = async (index: number, url: string) => { window.history.replaceState({ idx: index }, '', url); await act(async () => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))); };
    try {
      await act(async () => root.render(<BrowserRouter><Routes><Route path="/editor" element={<StudioEditorWorkspace owner="owner" projectId="project" />} /><Route path="*" element={<span>Projetos</span>} /></Routes></BrowserRouter>));
      await click('Importar arquivos'); await pop(2, '/projects'); await pop(3, '/editor');
      await act(async () => host.querySelector('input[type="file"][multiple]')!.dispatchEvent(new Event('cancel', { bubbles: true })));
      await answer('Cancelar e sair'); expect(go).toHaveBeenLastCalledWith(1); expect(host.querySelector('.se-editor')).toBeTruthy();
      await openRecording(); expect(boundaries.capture.mock.results[0].value.cancel).not.toHaveBeenCalled(); expect(boundaries.put).not.toHaveBeenCalled();
    } finally { go.mockRestore(); window.history.replaceState(null, '', '/'); }
  });
  it('troca de conta durante a pergunta encerra apenas o Recorder antigo e não aceita uma saída tardia no novo projeto', async () => {
    window.history.replaceState({ idx: 3, key: 'editor' }, '', '/editor'); const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const render = (owner: string) => root.render(<BrowserRouter><Routes><Route path="/editor" element={<StudioEditorWorkspace owner={owner} projectId="project" />} /><Route path="*" element={<span>Projetos</span>} /></Routes></BrowserRouter>);
    const pop = async (index: number, url: string) => { window.history.replaceState({ idx: index }, '', url); await act(async () => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))); };
    try {
      await act(async () => render('owner')); await openRecording(); const old = boundaries.capture.mock.results[0].value;
      await pop(2, '/projects'); await pop(3, '/editor'); const oldAccept = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(element => element.textContent === 'Descartar e sair') as HTMLButtonElement;
      boundaries.get.mockResolvedValue(withStudioTakes({ ...project(), ownerId: 'other-owner', editing: emptyStudioEditing('aula') })); await act(async () => render('other-owner'));
      await act(async () => oldAccept.click()); expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeNull(); expect(old.dispose).toHaveBeenCalledTimes(1); expect(boundaries.put).not.toHaveBeenCalled(); expect(go).toHaveBeenLastCalledWith(1);
      await openRecording(); expect(boundaries.capture.mock.results.at(-1)!.value.cancel).not.toHaveBeenCalled(); expect(button('Usar gravação').disabled).toBe(false);
    } finally { go.mockRestore(); window.history.replaceState(null, '', '/'); }
  });

  it('após aprovar a saída o Recorder continua bloqueado até o flush resolver, e erro de disco mantém o original', async () => {
    window.history.replaceState({ idx: 3, key: 'editor' }, '', '/editor'); const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const pop = async (index: number, url: string) => { window.history.replaceState({ idx: index }, '', url); await act(async () => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))); };
    try {
      await act(async () => root.render(<BrowserRouter><Routes><Route path="/editor" element={<StudioEditorWorkspace owner="owner" projectId="project" />} /><Route path="*" element={<span>Projetos</span>} /></Routes></BrowserRouter>));
      await openRecording(); boundaries.save.mockRejectedValueOnce(new Error('Quota inicial')); await click('Usar gravação');
      expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeTruthy(); expect(boundaries.put).toHaveBeenCalledTimes(1);
      let reject!: (cause: Error) => void; const writing = new Promise<StudioProject>((_resolve, fail) => { reject = fail; }); boundaries.save.mockImplementationOnce(() => writing);
      await pop(2, '/projects'); await pop(3, '/editor'); await answer('Descartar e sair');
      expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(button('Usar gravação').disabled).toBe(true); expect(button('Gravar outro').disabled).toBe(true); expect(go).toHaveBeenLastCalledWith(1);
      await click('Usar gravação'); expect(boundaries.save).toHaveBeenCalledTimes(2);
      await act(async () => reject(new Error('Sem espaço para salvar')));
      expect(host.textContent).toContain('Sem espaço para salvar'); expect(go).toHaveBeenLastCalledWith(1); expect(host.querySelector('[aria-label="Gravar câmera"]')).toBeTruthy(); expect(button('Usar gravação').disabled).toBe(false);
      await click('Usar gravação'); expect(boundaries.put).toHaveBeenCalledTimes(1); expect(boundaries.put.mock.calls[0][3]).toBe(recording); expect(lastSaved?.takes).toHaveLength(1);
    } finally { go.mockRestore(); window.history.replaceState(null, '', '/'); }
  });

});

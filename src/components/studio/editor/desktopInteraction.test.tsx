import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileStudioRecipe, emptyStudioEditing, studioTicks, withStudioTakes, type StudioProject } from '../../../../shared/studio';
import { StudioDesktopTimeline } from './StudioDesktopTimeline';
import { StudioDesktopCanvas } from './StudioDesktopCanvas';

let host: HTMLDivElement, root: Root;
function fixture(): StudioProject { const editing = emptyStudioEditing('aula'); editing.assets = [{ id: 'asset', kind: 'video', name: 'Professor', uri: 'file://original', durationTicks: studioTicks(10), width: 1920, height: 1080 }]; editing.main = [{ id: 'clip', assetId: 'asset', sourceStartTicks: studioTicks(2), sourceEndTicks: studioTicks(8) }]; return withStudioTakes({ version: 2, id: 'p', ownerId: 'owner', kind: 'aula', title: 'Aula', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0', editing, revision: 0, state: 'draft', progress: 0, createdAt: '2026-10-11', updatedAt: '2026-10-11' }); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; } });
  Element.prototype.setPointerCapture = vi.fn();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const pointer = (element: Element, type: string, x: number, y: number) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
describe('componentes reais do editor desktop', () => {
  it('seleção na timeline conserva o cursor; apenas régua manda seek', async () => {
    const select = vi.fn(), seek = vi.fn();
    await act(async () => root.render(<StudioDesktopTimeline project={fixture()} position={3} thumbnails={{}} onSelect={select} onSeek={seek} onPreview={() => {}} onCommit={() => {}} onAdd={() => {}} onMainMute={() => {}} onLayerMute={() => {}} onLayerHide={() => {}} />));
    const clip = host.querySelector('[aria-label="Take Professor"]')!;
    await act(async () => clip.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(select.mock.calls).toEqual([['clip']]); expect(seek).not.toHaveBeenCalled();
    const ruler = host.querySelector('[aria-label="Posição da montagem"]')!;
    await act(async () => pointer(ruler, 'pointerdown', 144, 10)); expect(seek).toHaveBeenLastCalledWith(2);
  });
  it('corte pelo teclado trabalha na fonte selecionada sem buscar outro tempo', async () => {
    let current = fixture(); const seek = vi.fn(), commit = vi.fn((change: (p: StudioProject) => StudioProject) => { current = change(current); });
    await act(async () => root.render(<StudioDesktopTimeline project={current} selectedId="clip" position={3} thumbnails={{}} onSelect={() => {}} onSeek={seek} onPreview={() => {}} onCommit={commit} onAdd={() => {}} onMainMute={() => {}} onLayerMute={() => {}} onLayerHide={() => {}} />));
    const handle = host.querySelector('[aria-label="Cortar início de Professor"]')!;
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(commit).toHaveBeenCalledTimes(1); expect(current.takes[0].start).toBeCloseTo(2 + 1 / 30, 4); expect(current.takes[0].end).toBe(8); expect(seek).not.toHaveBeenCalled();
  });
  it('arrastar principal gera uma edição contínua e um único commit; cancelamento restaura sem gravar', async () => {
    const project = fixture(), draft = vi.fn(), commit = vi.fn(), begin = vi.fn();
    await act(async () => root.render(<StudioDesktopCanvas project={project} position={1} selectedId="clip" canvasRef={{ current: null }} onSelect={() => {}} onEditText={() => {}} onBegin={begin} onPreview={draft} onCommit={commit} />));
    const viewport = host.querySelector('.se-canvas')!;
    viewport.getBoundingClientRect = () => ({ x: 0, y: 0, width: 800, height: 450, left: 0, top: 0, right: 800, bottom: 450, toJSON: () => ({}) });
    const hit = host.querySelector('[aria-label="Selecionar vídeo principal"]')!;
    await act(async () => { pointer(hit, 'pointerdown', 200, 200); pointer(hit, 'pointermove', 280, 245); });
    expect(begin).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
    const changed = draft.mock.calls.at(-1)![0] as StudioProject;
    expect(compileStudioRecipe(changed).clips[0].rect.x).toBeCloseTo(.1); expect(compileStudioRecipe(changed).clips[0].rect.y).toBeCloseTo(.1);
    await act(async () => pointer(hit, 'pointerup', 280, 245));
    expect(commit).toHaveBeenCalledTimes(1); const saved = commit.mock.calls[0][0](project); expect(compileStudioRecipe(saved).clips[0].rect.x).toBeCloseTo(.1);
    await act(async () => { pointer(hit, 'pointerdown', 200, 200); pointer(hit, 'pointermove', 320, 230); pointer(hit, 'pointercancel', 320, 230); });
    expect(commit).toHaveBeenCalledTimes(1); expect(draft).toHaveBeenLastCalledWith(null);
  });
  it('um botão antigo fica inerte quando a operação externa bloqueia a edição', async () => {
    const select = vi.fn(), seek = vi.fn(), commit = vi.fn();
    const props = { project: fixture(), position: 3, selectedId: 'clip', thumbnails: {}, onSelect: select, onSeek: seek, onPreview: vi.fn(), onCommit: commit, onAdd: vi.fn(), onMainMute: vi.fn(), onLayerMute: vi.fn(), onLayerHide: vi.fn() };
    await act(async () => root.render(<StudioDesktopTimeline {...props} />));
    await act(async () => root.render(<StudioDesktopTimeline {...props} disabled />));
    await act(async () => host.querySelector('[aria-label="Take Professor"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(select).not.toHaveBeenCalled(); expect(seek).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
  it('reprodução acompanha o playhead horizontalmente sem seek; seleção e cursor pausado não deslocam a janela', async () => {
    const seek = vi.fn(), props = { project: fixture(), position: 2, thumbnails: {}, onSelect: vi.fn(), onSeek: seek, onPreview: vi.fn(), onCommit: vi.fn(), onAdd: vi.fn(), onMainMute: vi.fn(), onLayerMute: vi.fn(), onLayerHide: vi.fn() };
    await act(async () => root.render(<StudioDesktopTimeline {...props} />));
    const view = host.querySelector<HTMLDivElement>('.se-timeline-scroll')!; Object.defineProperty(view, 'clientWidth', { value: 400 });
    const scrollTo = vi.fn(({ left }: ScrollToOptions) => { view.scrollLeft = left ?? 0; }); Object.defineProperty(view, 'scrollTo', { value: scrollTo, configurable: true });
    await act(async () => root.render(<StudioDesktopTimeline {...props} position={5.1} playing />));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: expect.closeTo(7.2, 4), behavior: 'auto' }); expect(seek).not.toHaveBeenCalled();
    await act(async () => root.render(<StudioDesktopTimeline {...props} selectedId="clip" position={5.1} playing />)); expect(scrollTo).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<StudioDesktopTimeline {...props} selectedId="clip" position={6} />)); expect(scrollTo).toHaveBeenCalledTimes(1); expect(seek).not.toHaveBeenCalled();
  });
  it('alças alteram duração de imagem principal sem mudar o original e cancelam sem outro commit', async () => {
    const editing = emptyStudioEditing('aula'); editing.assets = [{ id: 'image', kind: 'image', name: 'Slide', uri: 'file://slide', durationTicks: 0, width: 1920, height: 1080 }]; editing.main = [{ id: 'still', assetId: 'image', sourceStartTicks: 0, sourceEndTicks: 0, durationTicks: studioTicks(3) }];
    let current: StudioProject = withStudioTakes({ ...fixture(), editing }); const preview = vi.fn(), seek = vi.fn(), commit = vi.fn((change: (p: StudioProject) => StudioProject) => { current = change(current); });
    const props = { project: current, position: 1, selectedId: 'still', thumbnails: {}, onSelect: vi.fn(), onSeek: seek, onPreview: preview, onCommit: commit, onAdd: vi.fn(), onMainMute: vi.fn(), onLayerMute: vi.fn(), onLayerHide: vi.fn() };
    await act(async () => root.render(<StudioDesktopTimeline {...props} />)); const handle = host.querySelector('[aria-label="Cortar fim de Slide"]')!;
    await act(async () => { pointer(handle, 'pointerdown', 200, 50); pointer(handle, 'pointermove', 236, 50); pointer(handle, 'pointerup', 236, 50); });
    expect(current.takes[0].duration).toBe(3.5); expect(current.editing?.assets[0].durationTicks).toBe(0); expect(current.editing?.main[0].sourceEndTicks).toBe(0); expect(commit).toHaveBeenCalledTimes(1); expect(seek).not.toHaveBeenCalled();
    await act(async () => { pointer(handle, 'pointerdown', 200, 50); pointer(handle, 'pointermove', 10, 50); pointer(handle, 'pointercancel', 10, 50); }); expect(commit).toHaveBeenCalledTimes(1); expect(preview).toHaveBeenLastCalledWith(null);
  });
});

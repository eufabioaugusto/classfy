import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeStudioExitGuard, useStudioExitGuard } from './useStudioExitGuard';

let host: HTMLDivElement, root: Root, risk: boolean, prepare: ReturnType<typeof vi.fn>, go: ReturnType<typeof vi.spyOn>;
const deferred = () => { let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(accept => { resolve = accept; }); return { promise, resolve }; };
function Editor() { useStudioExitGuard({ enabled: true, hasRisk: () => risk, prepare: () => prepare() }); return <span>Editor preservado</span>; }
async function mount() { await act(async () => root.render(<BrowserRouter><Routes><Route path="/editor" element={<Editor />} /><Route path="*" element={<span>Outra página</span>} /></Routes></BrowserRouter>)); }
async function pop(index: number, url: string) { window.history.replaceState({ idx: index, key: `entry-${index}` }, '', url); await act(async () => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({ idx: 3, key: 'editor' }, '', '/editor');
  initializeStudioExitGuard();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  risk = true; prepare = vi.fn(async () => true); go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); go.mockRestore(); });

describe('POP escopado com BrowserRouter instalado', () => {
  it('dispatcher cedo precede um Router que desmonta sincronamente, mesmo com o hook registrado depois', async () => {
    const saving = deferred(); prepare.mockImplementation(() => saving.promise);
    const routerPop = vi.fn(() => flushSync(() => root.render(<span>Router desmontou</span>)));
    // Same target and same registration mode as Chrome: the Router is registered
    // before the mounted hook. A late capture listener would never run here.
    window.addEventListener('popstate', routerPop);
    try {
      await mount(); await pop(2, '/projects'); expect(routerPop).not.toHaveBeenCalled(); expect(host.textContent).toBe('Editor preservado');
      await pop(3, '/editor'); expect(routerPop).not.toHaveBeenCalled(); await act(async () => saving.resolve(false));
      risk = false; await pop(2, '/projects'); expect(routerPop).toHaveBeenCalledTimes(1); expect(host.textContent).toBe('Router desmontou');
      await pop(3, '/editor'); expect(prepare).toHaveBeenCalledTimes(1); // Unmounted subscriptions are gone.
    } finally { window.removeEventListener('popstate', routerPop); }
  });
  it('inicialização repetida e Fast Refresh não adicionam outro listener global', async () => {
    const register = vi.spyOn(window, 'addEventListener');
    initializeStudioExitGuard(); initializeStudioExitGuard();
    vi.resetModules(); const reloaded = await import('./useStudioExitGuard'); reloaded.initializeStudioExitGuard();
    expect(register.mock.calls.filter(([type]) => type === 'popstate')).toHaveLength(0); register.mockRestore();
  });
  it('não intercepta uma saída tranquila nem cria entradas extras no histórico', async () => {
    risk = false; await mount(); const push = vi.spyOn(window.history, 'pushState'); await pop(2, '/projects');
    expect(host.textContent).toBe('Outra página'); expect(prepare).not.toHaveBeenCalled(); expect(go).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled(); push.mockRestore();
  });
  it('aguarda a escrita verdadeira e só libera a posição original solicitada depois da restauração', async () => {
    const saving = deferred(); prepare.mockImplementation(() => saving.promise); await mount(); await pop(1, '/projects');
    expect(host.textContent).toBe('Editor preservado'); expect(go).toHaveBeenLastCalledWith(2);
    await pop(3, '/editor'); expect(host.textContent).toBe('Editor preservado'); expect(go).toHaveBeenCalledTimes(1);
    await act(async () => saving.resolve(true)); expect(go).toHaveBeenLastCalledWith(-2); await pop(1, '/projects'); expect(host.textContent).toBe('Outra página');
  });
  it('cancelar mantém a entrada do editor e não impede uma futura saída tranquila', async () => {
    prepare.mockResolvedValue(false); await mount(); await pop(2, '/projects'); await pop(3, '/editor');
    expect(host.textContent).toBe('Editor preservado'); expect(go).toHaveBeenCalledTimes(1);
    risk = false; await pop(2, '/projects'); expect(host.textContent).toBe('Outra página');
  });
  it('duas solicitações de back durante a escrita respeitam a última posição, sem perder o editor antes do resultado', async () => {
    const saving = deferred(); prepare.mockImplementation(() => saving.promise); await mount(); await pop(2, '/middle'); await pop(3, '/editor');
    await pop(1, '/projects'); await pop(3, '/editor'); expect(host.textContent).toBe('Editor preservado'); expect(prepare).toHaveBeenCalledTimes(1);
    await act(async () => saving.resolve(true)); expect(go).toHaveBeenLastCalledWith(-2); await pop(1, '/projects'); expect(host.textContent).toBe('Outra página');
  });
  it('falha de escrita preserva a página e permite repetir depois de corrigir a falha', async () => {
    prepare.mockRejectedValueOnce(new Error('Quota')); await mount(); await pop(2, '/projects'); await pop(3, '/editor'); expect(host.textContent).toBe('Editor preservado');
    await pop(2, '/projects'); await pop(3, '/editor'); expect(go).toHaveBeenLastCalledWith(-1); await pop(2, '/projects'); expect(host.textContent).toBe('Outra página');
  });
  it('resposta antiga após desmontar o editor não percorre o histórico', async () => {
    const saving = deferred(); prepare.mockImplementation(() => saving.promise); await mount(); await pop(2, '/projects'); await pop(3, '/editor');
    await act(async () => root.render(<span>Conta alterada</span>)); const calls = go.mock.calls.length; await act(async () => saving.resolve(true)); expect(go).toHaveBeenCalledTimes(calls);
  });
});

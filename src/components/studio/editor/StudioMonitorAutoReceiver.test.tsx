import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createStudioMonitorAutoReceiver as ReceiverFactory } from '@/lib/studio/editor/cameraMonitorAutoReceiver';
const io = vi.hoisted(() => ({ owner: 'owner' as string | null, role: 'creator', mobile: false, premium: true, loading: false, disposed: vi.fn(), dismissed: vi.fn(), signal: vi.fn(), coordinationChanged: vi.fn(), manual: vi.fn(), factory: vi.fn(), open: null as null | ((monitor: { id: string }) => void), close: null as null | (() => void), mounted: vi.fn(), unmounted: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: io.owner ? { id: io.owner } : null, role: io.role, loading: false }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => io.mobile }));
vi.mock('./useStudioPremiumEntitlement', () => ({ useStudioPremiumEntitlement: () => ({ canUseScenes: io.premium, loading: io.loading }) }));
vi.mock('@/lib/studio/editor/cameraMonitorAutoReceiver', () => ({ createStudioMonitorAutoReceiver: io.factory }));
vi.mock('./StudioMonitorWorkspace', () => ({ StudioMonitorWorkspace: ({ onClose }: { onClose?: () => void }) => <div className="scm-monitor"><h1>Monitor do iPhone</h1><button aria-label="Fechar monitor" onClick={onClose}>Fechar</button><button onClick={event => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: event.currentTarget.parentElement }); document.dispatchEvent(new Event('fullscreenchange')); }}>Tela cheia</button></div> }));
import { StudioMonitorAutoLayer, StudioMonitorAutoReceiver } from './StudioMonitorAutoReceiver';
let root: Root, host: HTMLDivElement;
function Underlying() { const location = useLocation(), [title, setTitle] = useState('Meu projeto'); useEffect(() => { io.mounted(); return () => { io.unmounted(); }; }, []); return <><output>{location.pathname}</output><input aria-label="Nome do projeto" value={title} onChange={event => setTitle(event.target.value)} /></>; }
async function render(global = false, owner = 'owner') { await act(async () => root.render(<MemoryRouter initialEntries={['/studio/projects/existing']}><Underlying />{global ? <StudioMonitorAutoReceiver /> : <StudioMonitorAutoLayer owner={owner} createReceiver={io.factory as typeof ReceiverFactory} />}</MemoryRouter>)); }
async function open(id = 'session') { await act(async () => io.open?.({ id })); }
async function click(label: string) { const button = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); io.owner = 'owner'; io.role = 'creator'; io.mobile = false; io.premium = true; io.loading = false;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('min-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  io.factory.mockImplementation(options => { io.open = options.onOpen; io.close = options.onClose; return { start: vi.fn(), signal: io.signal, coordinationChanged: io.coordinationChanged, setManual: io.manual, dispose: io.disposed, dismiss: () => { io.dismissed(); options.onClose(); } }; });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null }); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('monitor automático preserva o trabalho aberto', () => {
  it('abre em portal, fecha só overlay e mantém rota/projeto montados', async () => {
    await render(); const input = host.querySelector('input'); await open(); expect(document.querySelector('[role="dialog"]')).toBeTruthy(); expect(host.querySelector('output')?.textContent).toBe('/studio/projects/existing'); expect(host.querySelector('input')).toBe(input); expect(io.unmounted).not.toHaveBeenCalled(); await click('Fechar'); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(io.dismissed).toHaveBeenCalledTimes(1); expect(host.querySelector('input')).toBe(input); expect(io.unmounted).not.toHaveBeenCalled();
  });
  it('Escape fecha monitor e atalhos de REC do documento não passam por trás dele', async () => {
    await render(); await open(); const rec = vi.fn(); document.addEventListener('keydown', rec); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))); expect(rec).not.toHaveBeenCalled(); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(document.querySelector('[role="dialog"]')).toBeNull(); document.removeEventListener('keydown', rec); expect(host.querySelector('output')?.textContent).toBe('/studio/projects/existing');
  });
  it('tela cheia do próprio monitor não move o portal para dentro de seu filho nem remonta projeto', async () => {
    await render(); await open(); const dialog = document.querySelector('[role="dialog"]'); await click('Tela cheia'); expect(document.querySelector('[role="dialog"]')).toBe(dialog); expect(dialog?.parentElement).toBe(document.body); expect(io.unmounted).not.toHaveBeenCalled();
  });
  it('storage de lease só coordena; heartbeat de outra aba não faz discover adicional', async () => {
    await render(); await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'classfy:studio:monitor:auto:v1:owner:lease', newValue: '{}' }))); expect(io.coordinationChanged).toHaveBeenCalledTimes(1); expect(io.signal).not.toHaveBeenCalled(); await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'classfy:studio:monitor:auto:v1:owner:lease', newValue: null }))); expect(io.signal).toHaveBeenCalledTimes(1);
  });
});
describe('receiver global só recebe na conta desktop Premium confirmada', () => {
  it('refresh do mesmo owner mantém listener e overlay; negativa final os remove', async () => {
    await render(true); await open(); expect(document.querySelector('[role="dialog"]')).toBeTruthy(); const factoryCount = io.factory.mock.calls.length; io.loading = true; io.premium = false; await render(true); expect(document.querySelector('[role="dialog"]')).toBeTruthy(); expect(io.factory).toHaveBeenCalledTimes(factoryCount); expect(io.disposed).not.toHaveBeenCalled(); io.loading = false; await render(true); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(io.disposed).toHaveBeenCalledTimes(1);
  });
  it('conta nova/logout apaga imagem anterior antes de receber confirmação', async () => {
    await render(true); await open(); io.owner = 'other'; io.loading = true; await render(true); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(io.disposed).toHaveBeenCalledTimes(1); io.owner = null; await render(true); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('mobile e conta sem Premium não montam listener', async () => {
    io.mobile = true; await render(true); expect(io.factory).not.toHaveBeenCalled(); io.mobile = false; io.premium = false; await render(true); expect(io.factory).not.toHaveBeenCalled();
  });
});

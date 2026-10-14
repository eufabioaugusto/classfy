import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioCameraMonitorView } from '@/lib/studio/editor/cameraMonitorViewer';
const io = vi.hoisted(() => ({ owner: 'creator' as string | null, role: 'creator', loading: false, premium: false, premiumLoading: false, premiumError: null as string | null, create: vi.fn(), checkout: vi.fn(), refresh: vi.fn(), controllers: [] as { start: ReturnType<typeof vi.fn>; reconnect: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; listener: ((view: StudioCameraMonitorView) => void) | null; unsubscribe: ReturnType<typeof vi.fn> }[] }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: io.owner ? { id: io.owner } : null, role: io.role, loading: io.loading }) }));
vi.mock('@/components/GlobalLoader', () => ({ GlobalLoader: ({ label }: { label: string }) => <p>{label}</p> }));
vi.mock('@/components/billing/SubscriptionCheckoutProvider', () => ({ useSubscriptionCheckout: () => ({ startSubscription: io.checkout }) }));
vi.mock('./useStudioPremiumEntitlement', () => ({ useStudioPremiumEntitlement: () => ({ canUseScenes: io.premium, loading: io.premiumLoading, error: io.premiumError, profile: { id: io.owner, plan: 'free' }, refresh: io.refresh }) }));
vi.mock('@/lib/studio/editor/cameraMonitorViewer', () => ({ createStudioCameraMonitorViewer: io.create }));
import StudioMonitor from '@/pages/StudioMonitor';
import { StudioMonitorWorkspace } from './StudioMonitorWorkspace';
const NOW = Date.parse('2026-10-14T12:00:00Z');
const freshView = (): StudioCameraMonitorView => ({ monitor: { id: 'monitor', ownerId: 'creator', deviceId: 'phone', kind: 'short', title: 'Câmera traseira', status: 'active', state: { recording: true, elapsedSeconds: 12, width: 2160, height: 3840, fps: 30, cameraFacing: 'back' }, createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 60000).toISOString(), deviceSeenAt: new Date(NOW).toISOString(), closedAt: null }, connection: 'connected', stream: {} as MediaStream, error: null, serverOffset: 0 });
let root: Root, host: HTMLDivElement;
async function page() { await act(async () => root.render(<MemoryRouter initialEntries={['/studio/monitor']}><Routes><Route path="/studio/monitor" element={<StudioMonitor />} /><Route path="/auth" element={<p>Entrar</p>} /><Route path="/" element={<p>Início</p>} /></Routes></MemoryRouter>)); }
async function workspace(owner = 'creator') { await act(async () => root.render(<MemoryRouter><StudioMonitorWorkspace key={owner} owner={owner} /></MemoryRouter>)); }
async function emit(view: StudioCameraMonitorView) { await act(async () => io.controllers.at(-1)!.listener?.(view)); }
async function click(label: string) { const button = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === label || node.getAttribute('aria-label') === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.setSystemTime(NOW);
  io.owner = 'creator'; io.role = 'creator'; io.loading = false; io.premium = false; io.premiumLoading = false; io.premiumError = null; io.controllers = []; io.refresh.mockResolvedValue(false);
  io.create.mockImplementation(() => { const controller = { start: vi.fn(async () => undefined), reconnect: vi.fn(async () => undefined), dispose: vi.fn(async () => undefined), listener: null as ((view: StudioCameraMonitorView) => void) | null, unsubscribe: vi.fn() }; io.controllers.push(controller); return { ...controller, subscribe: (listener: (view: StudioCameraMonitorView) => void) => { controller.listener = listener; listener({ monitor: null, stream: null, connection: 'waiting', serverOffset: 0, error: null }); return controller.unsubscribe; } }; });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers(); });
describe('rota do monitor com conta e entitlement confirmado', () => {
  it('login pendente e usuário sem sessão não criam viewer', async () => {
    io.loading = true; await page(); expect(host.textContent).toContain('Abrindo monitor'); expect(io.create).not.toHaveBeenCalled();
    io.loading = false; io.owner = null; await page(); expect(host.textContent).toBe('Entrar'); expect(io.create).not.toHaveBeenCalled();
  });
  it('conta sem acesso creator/admin não entra mesmo se Premium', async () => { io.role = 'user'; io.premium = true; await page(); expect(host.textContent).toBe('Início'); expect(io.create).not.toHaveBeenCalled(); });
  it('Premium em confirmação ou Free não descobre câmera nem cobra automaticamente', async () => {
    io.premiumLoading = true; await page(); expect(io.create).not.toHaveBeenCalled(); io.premiumLoading = false; await page(); expect(host.textContent).toContain('Veja sua cena no computador.'); expect(io.create).not.toHaveBeenCalled(); expect(io.checkout).not.toHaveBeenCalled();
    await click('Ativar Premium'); expect(io.checkout).toHaveBeenCalledWith('premium', expect.any(Function)); expect(host.textContent).toContain('Monitor do iPhone'); expect(io.create).not.toHaveBeenCalled();
  });
  it('creator e admin Premium confirmados podem abrir apenas o viewer', async () => { io.premium = true; await page(); expect(io.create).toHaveBeenCalledWith({ owner: 'creator' }); expect(io.controllers[0].start).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('Ver no computador'); });
  it('Premium revogado desmonta e limpa apenas o viewer', async () => { io.premium = true; await page(); const previous = io.controllers[0]; io.premium = false; await page(); expect(previous.unsubscribe).toHaveBeenCalledTimes(1); expect(previous.dispose).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('Ativar Premium'); });
});
describe('monitor mantém a gravação no iPhone', () => {
  it('mostra REC, tempo e resolução identificada como original, sem botão de gravação', async () => {
    await workspace(); await emit(freshView()); expect(host.textContent).toContain('Gravando no iPhone'); expect(host.querySelector('time')?.textContent).toBe('0:12'); expect(host.textContent).toContain('Gravação no iPhone: 2160 × 3840 · 30 FPS'); expect((host.querySelector('video') as HTMLVideoElement).srcObject).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(1500)); expect(host.querySelector('time')?.textContent).toBe('0:13');
    expect([...host.querySelectorAll('button')].map(button => button.textContent?.trim()).filter(Boolean)).toEqual(['Reconectar']); await click('Reconectar'); expect(io.controllers[0].reconnect).toHaveBeenCalledTimes(1);
  });
  it('imagem recebida antes do encerramento não segue visível após expirar', async () => {
    await workspace(); const view = freshView(); view.monitor!.expiresAt = new Date(NOW + 1000).toISOString(); await emit(view); const video = host.querySelector('video') as HTMLVideoElement;
    expect(video.srcObject).toBeTruthy(); await act(async () => vi.advanceTimersByTime(1500)); expect(video.srcObject).toBeNull(); expect(video.hidden).toBe(true); expect(host.textContent).toContain('Conexão perdida'); expect(host.textContent).not.toContain('Gravando no iPhone');
  });
  it('troca de conta descarta imagem anterior e dispose não altera o mobile', async () => {
    await workspace(); await emit(freshView()); const previous = io.controllers[0]; await workspace('other'); expect(previous.unsubscribe).toHaveBeenCalledTimes(1); expect(previous.dispose).toHaveBeenCalledTimes(1); expect(io.create).toHaveBeenLastCalledWith({ owner: 'other' }); expect((host.querySelector('video') as HTMLVideoElement).srcObject).toBeNull();
  });
});

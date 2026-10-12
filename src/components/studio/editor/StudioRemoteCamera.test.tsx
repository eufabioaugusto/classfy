import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const qr = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: qr.generate } }));
import { StudioRemoteCameraPairing, StudioRemoteCameraStatus } from './StudioRemoteCameraPairing';
import { StudioRemoteCameraControls } from './StudioRemoteCameraControls';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
const NOW = Date.parse('2026-10-12T12:00:00Z');
let root: Root, host: HTMLDivElement;
function view(): StudioRemoteView { return { pairing: { code: 'X'.repeat(43), expiresAt: new Date(NOW + 300_000).toISOString() }, connection: 'pairing', transfer: 'idle', pendingTakeId: null, error: null, session: null }; }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.setSystemTime(NOW); qr.generate.mockResolvedValue('data:image/png;base64,Zml4dHVyZQ=='); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('câmera remota com identidade do Studio', () => {
  it('QR usa somente o esquema Classfy e código completo opaco pode ser copiado por gesto', async () => {
    const state = view(), clipboard = vi.fn(async () => undefined); Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
    await act(async () => root.render(<StudioRemoteCameraPairing state={state} onReconnect={() => undefined} />));
    expect(qr.generate).toHaveBeenCalledWith(`classfy://studio/remote-camera?code=${state.pairing!.code}`, expect.any(Object)); expect(host.querySelector('img')?.getAttribute('alt')).toContain('parear seu iPhone');
    expect(host.textContent).toContain('OU COLE O CÓDIGO NO APP'); expect(host.textContent).toContain('Válido por 5:00'); expect(clipboard).not.toHaveBeenCalled();
    await act(async () => (host.querySelector('[aria-label="Copiar código de conexão"]') as HTMLButtonElement).click()); expect(clipboard).toHaveBeenCalledWith(state.pairing!.code); expect(host.textContent).toContain('Código copiado');
  });
  it('código expirado oferece reconexão e desmontagem encerra contador', async () => {
    const reconnect = vi.fn(); await act(async () => root.render(<StudioRemoteCameraPairing state={view()} onReconnect={reconnect} />));
    await act(async () => vi.advanceTimersByTime(300_001)); expect(host.textContent).toContain('Código expirado'); const retry = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Tentar novamente'))!;
    await act(async () => retry.click()); expect(reconnect).toHaveBeenCalledTimes(1); await act(async () => root.render(null)); expect(vi.getTimerCount()).toBe(0);
  });
  it('controles nativos permanecem confirmados até ACK; slider envia uma intenção ao soltar', async () => {
    const state = view(); state.session = { configuration: { cameraFacing: 'back' }, deviceState: { pro: { supportsExposure: true, autoExposure: false, iso: 100, minISO: 50, maxISO: 500, shutterSeconds: 1 / 60, minShutterSeconds: 1 / 1000, maxShutterSeconds: 1 / 30 } } } as unknown as StudioRemoteView['session'];
    const configure = vi.fn(); await act(async () => root.render(<StudioRemoteCameraControls state={state} disabled={false} onConfigure={configure} onClose={() => undefined} />));
    const slider = host.querySelector('[aria-label="ISO"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '200'); slider.dispatchEvent(new Event('input', { bubbles: true })); }); expect(configure).not.toHaveBeenCalled(); expect(slider.closest('label')?.querySelector('output')?.textContent).toBe('100');
    await act(async () => slider.dispatchEvent(new Event('pointerup', { bubbles: true }))); expect(configure).toHaveBeenCalledWith({ pro: { autoExposure: false, iso: 200 } });
    await act(async () => root.render(<StudioRemoteCameraControls state={state} disabled onConfigure={configure} onClose={() => undefined} />)); expect((host.querySelector('[aria-label="ISO"]') as HTMLInputElement).disabled).toBe(true);
    expect(host.textContent).not.toContain('Distância de foco');
  });
  it('zoom remoto usa faixa real do aparelho, e status desconectado reserva espaço acima do mic', async () => {
    const state = view(); state.connection = 'disconnected'; state.session = { configuration: { cameraFacing: 'back' }, deviceState: { pro: { supportsZoom: true, minZoom: 1, maxZoom: 5, zoom: 1.5 } } } as unknown as StudioRemoteView['session']; const configure = vi.fn();
    await act(async () => root.render(<><StudioRemoteCameraControls state={state} disabled={false} onConfigure={configure} onClose={() => undefined} /><StudioRemoteCameraStatus state={state} onReconnect={() => undefined} audioMonitorVisible /></>));
    const slider = host.querySelector('[aria-label="Zoom"]') as HTMLInputElement; expect(slider.min).toBe('1'); expect(slider.max).toBe('5');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '2'); slider.dispatchEvent(new Event('input', { bubbles: true })); }); await act(async () => slider.dispatchEvent(new Event('pointerup', { bubbles: true }))); expect(configure).toHaveBeenCalledWith({ pro: { zoom: 2 } }); expect(host.querySelector('.src-status--above-meter')).toBeTruthy();
  });
});

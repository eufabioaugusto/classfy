import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioCameraMonitorResponse } from '../../../../shared/studio/cameraMonitor';
import type { StudioMonitorAutoCoordination } from './cameraMonitorAutoLease';
import type { StudioCameraMonitorClient } from './cameraMonitorClient';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { createStudioMonitorAutoReceiver } from './cameraMonitorAutoReceiver';
const NOW = Date.parse('2026-10-14T12:00:00Z');
const response = (id = 'session'): StudioCameraMonitorResponse => ({ monitor: { id, ownerId: 'owner', deviceId: 'phone', title: 'Cena', kind: 'short', status: 'active', state: null, createdAt: new Date(NOW).toISOString(), expiresAt: new Date(Date.now() + 90000).toISOString(), deviceSeenAt: new Date().toISOString(), closedAt: null }, serverAt: new Date().toISOString() });
const empty = (): StudioCameraMonitorResponse => ({ monitor: null, serverAt: new Date().toISOString() });
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
let receiver: ReturnType<typeof createStudioMonitorAutoReceiver>;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { receiver?.dispose(); vi.clearAllTimers(); vi.useRealTimers(); });
function harness() {
  let changed!: () => void, ready!: (healthy: boolean) => void, visible = true, leaseCurrent = true; const dismissed = new Set<string>(), order: string[] = [];
  const onOpen = vi.fn(), onClose = vi.fn(), release = vi.fn(), unsubscribe = vi.fn(), request = vi.fn<StudioCameraMonitorClient['request']>(async () => empty());
  const coordination: StudioMonitorAutoCoordination = { dismissed: id => dismissed.has(id), dismiss: id => { dismissed.add(id); }, acquire: vi.fn(async () => ({ current: () => leaseCurrent, release })), manual: vi.fn(), dispose: vi.fn() };
  receiver = createStudioMonitorAutoReceiver({ owner: 'owner', onOpen, onClose, client: { request: (...args) => { order.push('discover'); return request(...args); } }, coordination, visible: () => visible,
    signals: (_owner, signal, connected) => { order.push('subscribe'); changed = signal; ready = connected; return unsubscribe; } });
  return { onOpen, onClose, request, release, coordination, unsubscribe, order, signal: () => changed(), status: (healthy: boolean) => ready(healthy), visibility: (value: boolean) => { visible = value; receiver.signal(); }, loseLease: () => { leaseCurrent = false; receiver.coordinationChanged(); } };
}
describe('recepção automática usa Realtime como sinal e Edge como autorização', () => {
  it('assina antes de descobrir; um INSERT fresco abre apenas após confirmação do servidor', async () => {
    const h = harness(); receiver.start(); await flush(); expect(h.order.slice(0, 2)).toEqual(['subscribe', 'discover']); expect(h.onOpen).not.toHaveBeenCalled(); h.request.mockResolvedValue(response()); h.signal(); await flush(); expect(h.onOpen).toHaveBeenCalledTimes(1); expect(h.onOpen.mock.calls[0][0].id).toBe('session'); expect(h.request.mock.calls.every(call => call[0].action === 'monitor-discover')).toBe(true);
    h.signal(); await flush(); expect(h.onOpen).toHaveBeenCalledTimes(1);
  });
  it('sinais simultâneos e SUBSCRIBED reconciliam sem duplicar uma requisição pendente', async () => {
    const h = harness(); let resolve!: (value: StudioCameraMonitorResponse) => void; h.request.mockImplementationOnce(() => new Promise(accept => { resolve = accept; })); receiver.start(); h.signal(); h.signal(); expect(h.request).toHaveBeenCalledTimes(1); resolve(empty()); await flush(); expect(h.request).toHaveBeenCalledTimes(2); expect(h.onOpen).not.toHaveBeenCalled();
  });
  it('monitor fechado, expirado ou sem sessão devolve a página sem comandos de câmera', async () => {
    const h = harness(); h.request.mockResolvedValue(response()); receiver.start(); await flush(); h.request.mockResolvedValue(empty()); h.signal(); await flush(); expect(h.onClose).toHaveBeenCalledTimes(1); expect(h.release).toHaveBeenCalledTimes(1); expect(h.coordination.dismissed('session')).toBe(false);
  });
  it('dismiss não reabre mesma lease; toggle seguinte gera sessão que pode abrir', async () => {
    const h = harness(); h.request.mockResolvedValue(response()); receiver.start(); await flush(); receiver.dismiss(); h.signal(); await flush(); expect(h.onOpen).toHaveBeenCalledTimes(1); h.request.mockResolvedValue(response('next')); h.signal(); await flush(); expect(h.onOpen).toHaveBeenCalledTimes(2);
  });
  it('não abre resposta de outra conta nem resposta recebida após logout/dispose', async () => {
    const h = harness(), other = response(); other.monitor!.ownerId = 'other'; h.request.mockResolvedValue(other); receiver.start(); await flush(); expect(h.onOpen).not.toHaveBeenCalled();
    let resolve!: (value: StudioCameraMonitorResponse) => void; h.request.mockImplementationOnce(() => new Promise(accept => { resolve = accept; })); h.signal(); receiver.dispose(); resolve(response()); await flush(); expect(h.onOpen).not.toHaveBeenCalled(); expect(h.unsubscribe).toHaveBeenCalledTimes(1); expect(h.request.mock.calls.at(-1)![1].signal.aborted).toBe(true);
  });
  it('aba oculta e rota manual não ganham overlay automático', async () => {
    const h = harness(); h.visibility(false); h.request.mockResolvedValue(response()); receiver.start(); await flush(); expect(h.request).not.toHaveBeenCalled(); h.visibility(true); await flush(); expect(h.onOpen).toHaveBeenCalledTimes(1); receiver.setManual(true); await flush(); expect(h.onClose).toHaveBeenCalledTimes(1); h.signal(); await flush(); expect(h.onOpen).toHaveBeenCalledTimes(1);
  });
  it('coordenação de outra aba remove apenas overlay e não dismiss nem revalida a cada heartbeat storage', async () => {
    const h = harness(); h.request.mockResolvedValue(response()); receiver.start(); await flush(); const reads = h.request.mock.calls.length; h.loseLease(); expect(h.onClose).toHaveBeenCalledTimes(1); expect(h.request).toHaveBeenCalledTimes(reads); expect(h.coordination.dismissed('session')).toBe(false);
  });
  it('fallback sem Realtime é limitado a uma leitura a cada 5 segundos e timeout cancela na saída', async () => {
    const h = harness(); receiver.start(); await flush(); h.status(false); await flush(); const reads = h.request.mock.calls.length; await vi.advanceTimersByTimeAsync(4999); expect(h.request).toHaveBeenCalledTimes(reads); await vi.advanceTimersByTimeAsync(1); expect(h.request).toHaveBeenCalledTimes(reads + 1); receiver.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
});

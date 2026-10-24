import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioRemoteDeviceState } from '../../../../shared/studio/remoteCamera';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import { StudioRemoteStorageIndicator } from './StudioRemoteStorageIndicator';

const NOW = Date.parse('2026-10-23T21:00:00Z');
function view(device: StudioRemoteDeviceState = { storageAvailableBytes: 6_300_000_000, storageTotalBytes: 128_000_000_000 }): StudioRemoteView {
  return { connection: 'connected', transfer: 'idle', pendingTakeId: null, pairing: null, error: null, session: { id: 'phone-session', deviceId: 'iphone', deviceSeenAt: new Date(NOW).toISOString(), deviceState: device } } as StudioRemoteView;
}
let host: HTMLDivElement, root: Root;
async function render(state = view()) { await act(async () => root.render(<StudioRemoteStorageIndicator state={state} />)); }
const meter = () => host.querySelector('[role="meter"][aria-label="Espaço livre no iPhone"]');
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.setSystemTime(NOW); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('armazenamento físico do iPhone', () => {
  it('mostra GB decimais, identifica o aparelho e calcula a barra somente com capacidade conhecida', async () => {
    await render(); expect(host.textContent).toContain('6,3 GB livres'); expect(host.querySelector('[aria-label="Armazenamento do iPhone"]')).toBeTruthy();
    expect(meter()?.getAttribute('aria-valuenow')).toBe('6300000000'); expect(meter()?.getAttribute('aria-valuemax')).toBe('128000000000'); expect(meter()?.getAttribute('aria-valuetext')).toContain('de 128,0 GB');
    expect(host.querySelector<HTMLElement>('.src-storage-meter > i')?.style.width).toBe('4.921875%'); expect(host.querySelector('.is-low')).toBeNull();
  });
  it.each([[5_000_000_000, '5,0', false], [4_999_999_999, '4,9', true], [4_990_000_000, '4,9', true], [0, '0,0', true]] as const)('aplica limiar estrito 5 GB sem arredondar alerta para cima: %s', async (bytes, text, low) => {
    await render(view({ storageAvailableBytes: bytes, storageTotalBytes: 64_000_000_000 })); expect(host.textContent).toContain(`${text} GB livres`); expect(!!host.querySelector('.is-low')).toBe(low);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(low ? 'Pouco espaço disponível no iPhone.' : ''); expect(meter()?.getAttribute('aria-valuenow')).toBe(String(bytes));
  });
  it.each([undefined, null, -1, NaN, Infinity, '6300000000', 12.5])('valor ausente ou inválido %s não vira zero nem alerta', async bytes => {
    await render(view({ storageAvailableBytes: bytes as number, storageTotalBytes: 64_000_000_000 })); expect(host.textContent).toContain('Indisponível'); expect(host.textContent).not.toContain('GB livres'); expect(host.querySelector('.is-low')).toBeNull(); expect(meter()).toBeNull();
  });
  it.each([undefined, null, -1, 0, NaN, Infinity, 1_000_000_000])('capacidade ausente ou incompatível %s não inventa porcentagem', async total => {
    await render(view({ storageAvailableBytes: 6_300_000_000, storageTotalBytes: total as number })); expect(host.textContent).toContain('6,3 GB livres'); expect(meter()).toBeNull();
  });
  it('atualiza livre/capacidade sem efeitos de captura e perde o valor antigo quando heartbeat expira', async () => {
    const state = view(); await render(state); state.session!.deviceState!.storageAvailableBytes = 4_950_000_000; await render(state);
    expect(host.textContent).toContain('4,9 GB livres'); expect(host.querySelector('.is-low')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(7000)); expect(host.textContent).toContain('Indisponível'); expect(host.textContent).not.toContain('4,9'); expect(meter()).toBeNull(); expect(host.querySelector('.is-low')).toBeNull();
    state.session!.deviceSeenAt = new Date(Date.now()).toISOString(); await render(state); expect(host.textContent).toContain('4,9 GB livres');
  });
  it.each(['disconnected', 'reconnecting', 'connecting'] as const)('conexão %s não conserva valor antigo mesmo com heartbeat recente', async connection => {
    const state = view(); state.connection = connection; await render(state); expect(host.textContent).toContain('Indisponível'); expect(meter()).toBeNull();
  });
  it('sem heartbeat ou com falha da prévia não usa o último valor e sem iPhone não cria chip', async () => {
    const state = view(); state.session!.deviceSeenAt = null; await render(state); expect(host.textContent).toContain('Indisponível');
    state.session!.deviceSeenAt = new Date(NOW).toISOString(); state.previewDiagnostic = { stage: 'disconnected', message: 'Sem conexão' }; await render(state); expect(host.textContent).toContain('Indisponível');
    state.session!.deviceId = null; await render(state); expect(host.childElementCount).toBe(0); state.session = null; await render(state); expect(host.childElementCount).toBe(0);
  });
});

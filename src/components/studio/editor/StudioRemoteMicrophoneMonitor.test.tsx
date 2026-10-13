import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import { StudioRemoteMicrophoneMonitor } from './StudioRemoteMicrophoneMonitor';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const builtin = { id: 'BuiltInMic', name: 'Microfone do iPhone', type: 'MicrophoneBuiltIn' };
const usb = { id: 'USB-Audio-1', name: 'Microfone USB externo', type: 'USBAudio' };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
function view(): StudioRemoteView {
  return { connection: 'connected', transfer: 'idle', pendingTakeId: null, pairing: null, error: null, session: {
    id: 'native-session', deviceSeenAt: new Date(NOW).toISOString(), deviceState: {
      capabilities: { audioInputSelection: true },
      audioInput: { version: 1, available: [builtin, usb], preferredId: null, current: builtin, confirmed: true, selecting: false, warning: null },
      audioMonitor: { status: 'live', input: builtin, channels: [{ averageDb: -30, peakDb: -12 }] },
    },
  } as unknown as StudioRemoteView['session'] };
}
let host: HTMLDivElement, root: Root;
const select = vi.fn<(_: string | null) => Promise<void>>();
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.getAttribute('aria-label') === name || value.textContent?.includes(name))!;
async function render(state = view(), disabled = false) { await act(async () => root.render(<StudioRemoteMicrophoneMonitor state={state} disabled={disabled} onSelect={select} />)); }
async function click(name: string) { await act(async () => button(name).click()); }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.setSystemTime(NOW); select.mockReset().mockResolvedValue(undefined); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('microfone do original no iPhone', () => {
  it('medidor abre entradas nativas e mantém Auto até o ACK da seleção USB', async () => {
    const state = view(), reply = deferred(); select.mockImplementation(() => reply.promise); await render(state);
    expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('-30'); await click('Selecionar microfone do iPhone');
    expect(host.querySelector('[role="dialog"]')).toBeTruthy(); expect(host.textContent).toContain('Microfone USB externo'); expect(host.textContent).toContain('USB · Conectado ao iPhone');
    await click('Microfone USB externo'); expect(select).toHaveBeenCalledWith(usb.id); expect(button('Automático').getAttribute('aria-pressed')).toBe('true'); expect(button('Microfone USB externo').getAttribute('aria-pressed')).toBe('false');
    await click('Microfone USB externo'); expect(select).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('Confirmando a entrada no iPhone');
    state.session!.deviceState!.audioInput = { ...state.session!.deviceState!.audioInput!, preferredId: usb.id, current: usb };
    state.session!.deviceState!.audioMonitor!.input = usb;
    await render(state); await act(async () => reply.resolve()); expect(host.querySelector('.src-audio-option[aria-pressed="true"]')?.textContent).toContain(usb.name);
    expect(host.querySelector('.src-audio-heading')?.textContent).toContain(usb.name); expect(host.textContent).toContain(`Em uso: ${usb.name}`);
  });
  it('retorna à rota automática por null e mostra perda de USB sem inventar uma entrada disponível', async () => {
    const state = view(); state.session!.deviceState!.audioInput = { ...state.session!.deviceState!.audioInput!, available: [builtin], preferredId: usb.id, current: builtin, confirmed: false, warning: 'O microfone USB foi desconectado.' };
    await render(state); expect(host.querySelector('[role="meter"]')).toBeNull(); expect(host.textContent).toContain('O microfone USB foi desconectado');
    await click('Selecionar microfone do iPhone'); expect(host.querySelectorAll('.src-audio-option')).toHaveLength(2); expect(host.textContent).not.toContain('Microfone USB externo');
    await click('Automático'); expect(select).toHaveBeenCalledWith(null);
  });
  it('não atribui PCM antigo ao novo input e expira níveis sem heartbeat fresco', async () => {
    const state = view(); state.session!.deviceState!.audioInput = { ...state.session!.deviceState!.audioInput!, preferredId: usb.id, current: usb };
    await render(state); expect(host.querySelector('.src-audio-heading')?.textContent).toContain(usb.name); expect(host.querySelector('[role="meter"]')).toBeNull();
    state.session!.deviceState!.audioMonitor!.input = usb; await render(state); expect(host.querySelector('[role="meter"]')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(7000)); expect(host.querySelector('[role="meter"]')).toBeNull(); expect(host.textContent).toContain('Aguardando áudio no iPhone');
  });
  it('flag confirmado isolada não marca USB quando a rota atual continua no microfone integrado', async () => {
    const state = view(); state.session!.deviceState!.audioInput = { ...state.session!.deviceState!.audioInput!, preferredId: usb.id, current: builtin, confirmed: true };
    await render(state); await click('Selecionar microfone do iPhone');
    expect(host.querySelector('.src-audio-option[aria-pressed="true"]')).toBeNull(); expect(host.querySelector('.src-audio-option em')).toBeNull(); expect(host.querySelector('[role="meter"]')).toBeNull();
    expect(host.querySelector('.src-audio-receipt')).toBeNull();
  });
  it('mantém medidor durante REC mas bloqueia mudança e fecha picker aberto', async () => {
    const state = view(); await render(state); await click('Selecionar microfone do iPhone'); await render(state, true);
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(host.querySelector('[role="meter"]')).toBeTruthy(); expect(button('Selecionar microfone do iPhone').disabled).toBe(true);
    await click('Selecionar microfone do iPhone'); expect(select).not.toHaveBeenCalled();
  });
  it('app antigo mostra orientação de atualização e preserva áudio atual sem seleção fictícia', async () => {
    const state = view(); delete state.session!.deviceState!.audioInput; state.session!.deviceState!.capabilities = {};
    state.session!.deviceState!.audioMonitor!.input = { name: builtin.name, type: builtin.type }; await render(state); await click('Selecionar microfone do iPhone');
    expect(host.textContent).toContain('Atualize o app do iPhone'); expect(host.querySelector('.src-audio-option')).toBeNull(); expect(host.querySelector('[role="meter"]')).toBeTruthy(); expect(select).not.toHaveBeenCalled();
  });
  it('falha de seleção mantém rota confirmada e popup fecha por Escape ou clique fora', async () => {
    select.mockRejectedValue(new Error('Esse microfone não está conectado ao iPhone.')); await render(); await click('Selecionar microfone do iPhone'); await click('Microfone USB externo');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('não está conectado'); expect(button('Automático').getAttribute('aria-pressed')).toBe('true');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(button('Selecionar microfone do iPhone'));
    await click('Selecionar microfone do iPhone'); await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

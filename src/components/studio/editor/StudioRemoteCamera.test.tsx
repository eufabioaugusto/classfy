import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const qr = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: qr.generate } }));
import { StudioRemoteCameraPairing, StudioRemoteCameraStatus } from './StudioRemoteCameraPairing';
import { StudioRemoteCameraControls } from './StudioRemoteCameraControls';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import { studioGrade } from '../../../../shared/studio';
import type { StudioCaptureState } from '@/lib/studio/editor/capture';
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
    await act(async () => vi.advanceTimersByTime(300_001)); expect(host.textContent).toContain('Código expirado'); const retry = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Gerar novo código'))!;
    await act(async () => retry.click()); expect(reconnect).toHaveBeenCalledTimes(1); await act(async () => root.render(null)); expect(vi.getTimerCount()).toBe(0);
  });
  it('slider mostra o ajuste desejado e distingue o valor confirmado pelo iPhone', async () => {
    const state = view(); state.session = { configuration: { cameraFacing: 'back' }, deviceState: { pro: { supportsExposure: true, autoExposure: false, iso: 100, minISO: 50, maxISO: 500, shutterSeconds: 1 / 60, minShutterSeconds: 1 / 1000, maxShutterSeconds: 1 / 30 } } } as unknown as StudioRemoteView['session'];
    const configure = vi.fn(); await act(async () => root.render(<StudioRemoteCameraControls state={state} disabled={false} onConfigure={configure} onClose={() => undefined} />));
    const slider = host.querySelector('[aria-label="ISO"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, String(Math.round(Math.log(200 / 50) / Math.log(500 / 50) * 1000))); slider.dispatchEvent(new Event('input', { bubbles: true })); }); expect(configure).not.toHaveBeenCalled(); expect(slider.closest('.src-control')?.querySelector('output')?.textContent).toBe('200'); expect(slider.closest('.src-control')?.textContent).toContain('No iPhone: 100');
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
  it('status de transferência distingue envio, recebimento e verificação com progresso real', async () => {
    const state = view(); state.connection = 'connected'; state.transfer = 'uploading'; state.transferBytes = 25; state.transferTotalBytes = 100;
    await act(async () => root.render(<StudioRemoteCameraStatus state={state} onReconnect={() => undefined} />)); expect(host.textContent).toContain('Enviando original do iPhone… 25%');
    state.transfer = 'downloading'; state.transferBytes = 75; await act(async () => root.render(<StudioRemoteCameraStatus state={state} onReconnect={() => undefined} />)); expect(host.textContent).toContain('Recebendo original no computador… 75%');
    state.transfer = 'validating'; await act(async () => root.render(<StudioRemoteCameraStatus state={state} onReconnect={() => undefined} />)); expect(host.textContent).toContain('Conferindo imagem, áudio e duração'); expect(host.textContent).not.toContain('75%');
  });
  it('exibe progresso de preparação do look antes de começar a transferência do original', async () => {
    const state = view(); state.connection = 'connected'; state.transfer = 'waiting';
    state.session = { deviceState: { processing: true, processingStage: 'rendering', processingProgress: .42 } } as unknown as StudioRemoteView['session'];
    await act(async () => root.render(<StudioRemoteCameraStatus state={state} onReconnect={() => undefined} />)); expect(host.textContent).toContain('Preparando imagem no iPhone · 42%');
    state.session!.deviceState!.processingStage = 'validating'; state.session!.deviceState!.processingProgress = 1;
    await act(async () => root.render(<StudioRemoteCameraStatus state={state} onReconnect={() => undefined} />)); expect(host.textContent).toContain('Conferindo imagem no iPhone · 100%');
    state.session!.deviceState!.processing = false; state.transfer = 'uploading'; state.transferBytes = 15; state.transferTotalBytes = 100;
    await act(async () => root.render(<StudioRemoteCameraStatus state={state} onReconnect={() => undefined} />)); expect(host.textContent).toContain('Enviando original do iPhone… 15%');
  });
  it('look é configurado antes do REC e a seleção reflete apenas a cor confirmada pelo iPhone', async () => {
    const state = view(), configure = vi.fn(), natural = studioGrade();
    state.session = { configuration: { cameraFacing: 'back' }, deviceState: { capabilities: { supportsImageGrade: true }, imageGrade: natural, imageGradeConfirmed: true } } as unknown as StudioRemoteView['session'];
    await act(async () => root.render(<StudioRemoteCameraControls initialTab="image" state={state} disabled={false} onConfigure={configure} onClose={() => undefined} />));
    const cinema = [...host.querySelectorAll('button')].find(button => button.textContent === 'Cinema')!;
    await act(async () => cinema.click()); expect(configure).toHaveBeenLastCalledWith({ imageGrade: { ...natural, preset: 'cinematic' } });
    expect(cinema.getAttribute('aria-pressed')).toBe('false'); expect(host.textContent).toContain('Aguardando a confirmação da imagem');
    const confirmed = { ...natural, preset: 'cinematic' as const, temperature: .2 }; state.session!.deviceState!.imageGrade = confirmed;
    await act(async () => root.render(<StudioRemoteCameraControls initialTab="image" state={state} disabled={false} onConfigure={configure} onClose={() => undefined} />));
    expect(cinema.getAttribute('aria-pressed')).toBe('true');
    const temperature = host.querySelector<HTMLInputElement>('[aria-label="Temperatura do look"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(temperature, '.7'); temperature.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(temperature.closest('.src-control')!.querySelector('output')!.textContent).toBe('+0.7'); expect(temperature.closest('.src-control')!.textContent).toContain('No iPhone: +0.2');
    await act(async () => temperature.dispatchEvent(new Event('pointerup', { bubbles: true }))); expect(configure).toHaveBeenLastCalledWith({ imageGrade: { ...confirmed, temperature: .7 } });
    await act(async () => root.render(<StudioRemoteCameraControls initialTab="image" state={state} disabled onConfigure={configure} onClose={() => undefined} />)); expect(temperature.disabled).toBe(true); expect(cinema.matches(':disabled')).toBe(true);
  });
  it('app antigo não promete tratamento e quatro tabs mantêm gravação e roteiro no mesmo painel', async () => {
    const state = view(), configure = vi.fn(), close = vi.fn(), onVideo = vi.fn(), onGuides = vi.fn();
    state.session = { configuration: { cameraFacing: 'back' }, deviceState: { pro: { supportsFocus: true, supportsFocusPoint: true, autoFocus: true } } } as unknown as StudioRemoteView['session'];
    const capture = { phase: 'ready', width: 3840, height: 2160, frameRate: 30, videoControls: null, outputVideo: { resolutions: [{ width: 3840, height: 2160, label: '4K' }], frameRates: [30] } } as StudioCaptureState;
    const recording = { state: capture, guides: { grid: false, mirrored: false, delay: 0, script: '', scriptEnabled: false, scriptSpeed: 140, scriptMode: 'timed' as const }, onVideo, onGuides };
    await act(async () => root.render(<StudioRemoteCameraControls initialTab="image" state={state} disabled={false} onConfigure={configure} onClose={close} recording={recording} />));
    expect(host.textContent).toContain('Atualize o app do iPhone'); expect(host.querySelector<HTMLInputElement>('[aria-label="Temperatura do look"]')!.disabled).toBe(true);
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; expect(tabs.map(tab => tab.textContent)).toEqual(['Imagem', 'Câmera', 'Gravação', 'Roteiro']);
    await act(async () => tabs[1].click()); expect(host.textContent).toContain('Clique na imagem para focar');
    await act(async () => tabs[2].click()); expect(host.querySelector('[aria-label="Resolução da gravação"]')).toBeTruthy();
    await act(async () => tabs[3].click()); expect(host.querySelector('[aria-label="Roteiro do teleprompter"]')).toBeTruthy();
    expect(host.querySelectorAll('[role="tablist"]')).toHaveLength(1); expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    await act(async () => tabs[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))); expect(tabs[0].getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(tabs[0]);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(close).toHaveBeenCalledTimes(1);
  });
  it('espera do aparelho já vinculado oferece cancelamento sem QR e desvinculação separada', async () => {
    const state = view(), cancel = vi.fn(), unpair = vi.fn(); state.pairing = null; state.connection = 'connecting'; state.session = { deviceId: 'paired-phone' } as StudioRemoteView['session'];
    await act(async () => root.render(<StudioRemoteCameraPairing state={state} onReconnect={() => undefined} onCancel={cancel} onUnpair={unpair} />));
    expect(host.textContent).toContain('Aguardando meu iPhone'); expect(host.textContent).toContain('já está vinculado'); expect(host.querySelector('.src-qr')).toBeNull(); expect(qr.generate).not.toHaveBeenCalled();
    const actions = [...host.querySelectorAll('button')]; await act(async () => actions.find(button => button.textContent === 'Cancelar conexão')!.click()); expect(cancel).toHaveBeenCalledTimes(1); expect(unpair).not.toHaveBeenCalled();
    await act(async () => actions.find(button => button.textContent === 'Desvincular iPhone')!.click()); expect(unpair).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<StudioRemoteCameraPairing state={state} onReconnect={() => undefined} onCancel={cancel} onUnpair={unpair} disabled />)); expect([...host.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
  });
});

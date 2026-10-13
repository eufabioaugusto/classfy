import { act, useLayoutEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import type { StudioRemoteConfiguration } from '../../../../shared/studio/remoteCamera';
import { studioGrade } from '../../../../shared/studio';
import { StudioRemoteCameraControls } from './StudioRemoteCameraControls';

let host: HTMLDivElement, root: Root;
function deferred() { let resolve!: () => void, reject!: (cause: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function view(pro: Record<string, unknown>): StudioRemoteView { return { pairing: null, connection: 'connected', transfer: 'idle', pendingTakeId: null, error: null, session: { configuration: { cameraFacing: 'back' }, deviceState: { pro } } as unknown as StudioRemoteView['session'] }; }
function slider(title: string) { return host.querySelector<HTMLInputElement>(`input[aria-label="${title}"]`)!; }
function input(element: HTMLInputElement, value: number) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(value)); element.dispatchEvent(new Event('input', { bubbles: true })); }
function pointer(element: HTMLInputElement, type: string) { element.dispatchEvent(new Event(type, { bubbles: true })); }
function text(title: string) { return slider(title).closest('.src-control')!.querySelector('output')!.textContent; }
function receipt(title: string) { return slider(title).closest('.src-control')!.querySelector('.src-control-receipt')!.textContent; }
function render(state: StudioRemoteView, configure: (patch: Partial<StudioRemoteConfiguration>) => void | Promise<void>, disabled = false, initialTab: 'camera' | 'image' = 'camera') { root.render(<StudioRemoteCameraControls state={state} disabled={disabled} initialTab={initialTab} onConfigure={configure} onClose={() => undefined} />); }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('sliders precisos da câmera remota', () => {
  it('envia o mínimo físico no primeiro gesto, sem perder input e pointerup no mesmo lote', async () => {
    const state = view({ supportsExposure: true, autoExposure: false, iso: 100, minISO: 45.23, maxISO: 1903.72 }), request = deferred(), configure = vi.fn(() => request.promise);
    await act(async () => render(state, configure));
    const iso = slider('ISO');
    await act(async () => { pointer(iso, 'pointerdown'); input(iso, 0); pointer(iso, 'pointerup'); });
    expect(configure).toHaveBeenCalledTimes(1); expect(configure).toHaveBeenCalledWith({ pro: { autoExposure: false, iso: 45.23 } });
    expect(text('ISO')).toBe('45.23'); expect(receipt('ISO')).toContain('Aplicando'); expect(receipt('ISO')).toContain('No iPhone: 100');
    // External disabling must not turn a pending request into a false receipt.
    await act(async () => render(state, configure, true)); expect(text('ISO')).toBe('45.23'); expect(iso.disabled).toBe(true);
    state.session!.deviceState!.pro!.iso = 45.23;
    await act(async () => { render(state, configure); request.resolve(); });
    expect(receipt('ISO')).toBe('No iPhone: 45.23'); expect(iso.value).toBe('0');
  });

  it('mostra o rascunho imediatamente, limita envios ao arrastar e entrega o extremo final', async () => {
    const state = view({ supportsZoom: true, zoom: 1, minZoom: 1, maxZoom: 5 }), request = deferred(), configure = vi.fn(() => request.promise);
    await act(async () => render(state, configure)); const zoom = slider('Zoom');
    await act(async () => { pointer(zoom, 'pointerdown'); input(zoom, 2); }); expect(text('Zoom')).toBe('2.0×');
    await act(async () => { vi.advanceTimersByTime(80); input(zoom, 3); vi.advanceTimersByTime(79); }); expect(configure).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1)); expect(configure).toHaveBeenCalledTimes(1); expect(configure).toHaveBeenCalledWith({ pro: { zoom: 3 } });
    await act(async () => { input(zoom, 4); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(zoom, '5'); pointer(zoom, 'pointerup'); });
    expect(configure).toHaveBeenLastCalledWith({ pro: { zoom: 5 } }); expect(text('Zoom')).toBe('5.0×'); expect(receipt('Zoom')).toContain('No iPhone: 1.0×');
    await act(async () => vi.advanceTimersByTime(1000)); expect(configure).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('input:not([type="range"])')).toHaveLength(0); expect(host.querySelector('[aria-label="Aumentar Zoom"]')).toBeNull();
  });

  it('mantém o último desejo durante ACK anterior e permite voltar ao valor confirmado', async () => {
    const state = view({ supportsZoom: true, zoom: 1, minZoom: 1, maxZoom: 5 }), first = deferred(), last = deferred(), configure = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    await act(async () => render(state, configure)); const zoom = slider('Zoom');
    await act(async () => { input(zoom, 3); pointer(zoom, 'pointerup'); });
    // A return to 1 must be queued even though 1 is still the confirmed value.
    await act(async () => { input(zoom, 1); pointer(zoom, 'pointerup'); }); expect(configure).toHaveBeenLastCalledWith({ pro: { zoom: 1 } });
    state.session!.deviceState!.pro!.zoom = 3;
    await act(async () => { render(state, configure); first.resolve(); }); expect(text('Zoom')).toBe('1.0×'); expect(receipt('Zoom')).toContain('No iPhone: 3.0×'); expect(zoom.disabled).toBe(false);
    state.session!.deviceState!.pro!.zoom = 1;
    await act(async () => { render(state, configure); last.resolve(); }); expect(text('Zoom')).toBe('1.0×'); expect(receipt('Zoom')).toBe('No iPhone: 1.0×');
  });

  it('reverte só após rejeição real e permite tentar o mesmo alvo novamente', async () => {
    const state = view({ supportsZoom: true, zoom: 1, minZoom: 1, maxZoom: 5 }), first = deferred(), retry = deferred(), configure = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    await act(async () => render(state, configure)); const zoom = slider('Zoom');
    await act(async () => { input(zoom, 2); pointer(zoom, 'pointerup'); }); expect(text('Zoom')).toBe('2.0×');
    await act(async () => first.reject(new Error('A lente não confirmou o zoom.')));
    expect(text('Zoom')).toBe('1.0×'); expect(receipt('Zoom')).toContain('Não aplicado'); expect(host.textContent).toContain('A lente não confirmou o zoom.');
    await act(async () => { input(zoom, 2); pointer(zoom, 'pointerup'); }); expect(configure).toHaveBeenCalledTimes(2); expect(configure).toHaveBeenLastCalledWith({ pro: { zoom: 2 } });
  });

  it('reconcilia ACK e estado do pai no mesmo lote sem pintar o valor antigo', async () => {
    const initial = view({ supportsZoom: true, zoom: 1, minZoom: 1, maxZoom: 5 }), request = deferred(), configure = vi.fn(() => request.promise), frames: (string | null)[] = [];
    let acknowledge!: (next: StudioRemoteView) => void;
    function Parent() { const [state, setState] = useState(initial); acknowledge = setState; useLayoutEffect(() => { frames.push(text('Zoom')); }); return <StudioRemoteCameraControls state={state} disabled={false} onConfigure={configure} onClose={() => undefined} />; }
    await act(async () => root.render(<Parent />));
    await act(async () => { input(slider('Zoom'), 3); pointer(slider('Zoom'), 'pointerup'); }); frames.length = 0;
    await act(async () => { acknowledge(view({ supportsZoom: true, zoom: 3, minZoom: 1, maxZoom: 5 })); request.resolve(); });
    expect(frames).not.toContain('1.0×'); expect(text('Zoom')).toBe('3.0×'); expect(receipt('Zoom')).toBe('No iPhone: 3.0×');
  });

  it('ACK com limite nativo igual ao valor anterior encerra a espera sem fingir aplicação', async () => {
    const state = view({ supportsZoom: true, zoom: 1, minZoom: 1, maxZoom: 5 }), request = deferred(), configure = vi.fn(() => request.promise);
    await act(async () => render(state, configure)); await act(async () => { input(slider('Zoom'), 2); pointer(slider('Zoom'), 'pointerup'); });
    await act(async () => request.resolve()); expect(text('Zoom')).toBe('1.0×'); expect(receipt('Zoom')).toBe('No iPhone: 1.0×');
  });

  it('confirma valor real recebido após falha de transporte, preservando a falha com props antigas', async () => {
    const state = view({ supportsZoom: true, zoom: 1, minZoom: 1, maxZoom: 5 }), request = deferred(), configure = vi.fn(() => request.promise);
    await act(async () => render(state, configure)); await act(async () => { input(slider('Zoom'), 2); pointer(slider('Zoom'), 'pointerup'); });
    await act(async () => request.reject(new Error('A confirmação demorou.'))); expect(receipt('Zoom')).toContain('Não aplicado'); expect(text('Zoom')).toBe('1.0×');
    await act(async () => render({ ...state }, configure)); expect(receipt('Zoom')).toContain('Não aplicado'); expect(host.textContent).toContain('A confirmação demorou.');
    state.session!.deviceState!.pro!.zoom = 2;
    await act(async () => render({ ...state }, configure)); expect(text('Zoom')).toBe('2.0×'); expect(receipt('Zoom')).toBe('No iPhone: 2.0×'); expect(host.textContent).not.toContain('A confirmação demorou.');
  });

  it('usa ISO logarítmico e tempos úteis de obturador com limites exatos do aparelho', async () => {
    const state = view({ supportsExposure: true, autoExposure: false, iso: 100, minISO: 40, maxISO: 2560, shutterSeconds: 1 / 60, minShutterSeconds: 1 / 1100, maxShutterSeconds: 1 / 29 }), configure = vi.fn(() => deferred().promise);
    await act(async () => render(state, configure));
    await act(async () => { input(slider('ISO'), 500); pointer(slider('ISO'), 'pointerup'); }); expect(configure).toHaveBeenLastCalledWith({ pro: { autoExposure: false, iso: 320 } });
    const shutter = slider('Obturador');
    await act(async () => { input(shutter, 0); pointer(shutter, 'pointerup'); }); expect(configure).toHaveBeenLastCalledWith({ pro: { autoExposure: false, shutterSeconds: 1 / 1100 } });
    await act(async () => { input(shutter, Number(shutter.max)); pointer(shutter, 'pointerup'); }); expect(configure).toHaveBeenLastCalledWith({ pro: { autoExposure: false, shutterSeconds: 1 / 29 } });
    await act(async () => { shutter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); shutter.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true })); }); expect(configure).toHaveBeenLastCalledWith({ pro: { autoExposure: false, shutterSeconds: 1 / 30 } });
  });

  it('teclado preserva passos e extremos, blur não duplica e cancelamento limpa envio pendente', async () => {
    const state = view({ supportsZoom: true, zoom: 1.5, minZoom: 1, maxZoom: 5 }), configure = vi.fn(() => deferred().promise);
    await act(async () => render(state, configure)); const zoom = slider('Zoom');
    await act(async () => { zoom.focus(); zoom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); zoom.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })); zoom.blur(); }); expect(configure).toHaveBeenCalledTimes(1); expect(configure).toHaveBeenCalledWith({ pro: { zoom: 1.51 } });
    await act(async () => { zoom.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); zoom.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', bubbles: true })); }); expect(configure).toHaveBeenLastCalledWith({ pro: { zoom: 5 } });
    await act(async () => { pointer(zoom, 'pointerdown'); input(zoom, 2); pointer(zoom, 'pointercancel'); vi.advanceTimersByTime(200); }); expect(configure).toHaveBeenCalledTimes(2); expect(text('Zoom')).toBe('5.0×');
  });

  it('preserva mudanças independentes do look antes da confirmação e trata rejeição de botões', async () => {
    const state = view({}), configure = vi.fn(() => deferred().promise), natural = studioGrade(); state.session!.deviceState = { capabilities: { supportsImageGrade: true }, imageGrade: natural, imageGradeConfirmed: true };
    await act(async () => render(state, configure, false, 'image'));
    await act(async () => { input(slider('Exposição do look'), .8); pointer(slider('Exposição do look'), 'pointerup'); });
    await act(async () => { input(slider('Contraste'), .6); pointer(slider('Contraste'), 'pointerup'); }); expect(configure).toHaveBeenLastCalledWith({ imageGrade: { ...natural, exposure: .8, contrast: .6 } });
    expect(host.textContent).toContain('Aguardando a confirmação da imagem');
    configure.mockImplementation(() => Promise.reject(new Error('O look não pôde ser aplicado.')));
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Cinema')!.click()); expect(host.textContent).toContain('O look não pôde ser aplicado.');
  });

  it('todos os ajustes usam o mesmo gesto e desmontagem cancela o trailing live', async () => {
    const state = view({ supportsFocus: true, autoFocus: false, lensPosition: .5, supportsWhiteBalance: true, autoWhiteBalance: false, supportsTemperatureAndTint: true, temperatureKelvin: 4500, whiteBalanceTint: 0 }), configure = vi.fn(() => deferred().promise);
    await act(async () => render(state, configure));
    for (const [title, position, expected] of [['Temperatura da câmera', 10000, { autoWhiteBalance: false, temperatureKelvin: 10000 }], ['Matiz', -150, { autoWhiteBalance: false, whiteBalanceTint: -150 }], ['Posição da lente', 0, { autoFocus: false, lensPosition: 0 }]] as const) {
      await act(async () => { input(slider(title), position); pointer(slider(title), 'pointerup'); }); expect(configure).toHaveBeenLastCalledWith({ pro: expected });
    }
    await act(async () => input(slider('Posição da lente'), 1)); await act(async () => root.render(null)); await act(async () => vi.advanceTimersByTime(200)); expect(configure).toHaveBeenCalledTimes(3);
  });
});

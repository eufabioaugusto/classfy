import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioCaptureState } from '@/lib/studio/editor/capture';
import { studioGrade } from '../../../../shared/studio';
import { StudioRecordingQuality } from './StudioRecordingQuality';
import { StudioRecordingTools, type RecordingGuides } from './StudioRecordingTools';

const profiles = [{ width: 1280, height: 720, label: '720p' }, { width: 1920, height: 1080, label: '1080p' }, { width: 2560, height: 1440, label: '2K' }, { width: 3840, height: 2160, label: '4K' }];
const guides: RecordingGuides = { grid: false, mirrored: false, delay: 0, script: '', scriptEnabled: false, scriptSpeed: 140, scriptMode: 'timed' };
function capture(patch: Partial<StudioCaptureState> = {}): StudioCaptureState {
  return { phase: 'ready', stream: null, elapsed: 0, file: null, error: null, input: null, camera: null, devices: { cameras: [], microphones: [] }, microphoneEnabled: true, levels: [], width: 1920, height: 1080, frameRate: 30,
    videoControls: { busy: false, processed: true, effects: true, grade: studioGrade(), zoom: { mode: 'digital', min: 1, max: 4, step: .01, value: 1 }, resolutions: profiles, frameRates: [24, 30, 60] }, ...patch };
}
let host: HTMLDivElement, root: Root;
const onVideo = vi.fn(), onGuides = vi.fn();
const button = () => host.querySelector<HTMLButtonElement>('.se-recording-quality button')!;
const control = <T extends HTMLElement,>(label: string) => host.querySelector<T>(`[aria-label="${label}"]`)!;
async function badge(state = capture(), disabled = false) { await act(async () => root.render(<StudioRecordingQuality state={state} disabled={disabled} onVideo={onVideo} />)); }
async function tools(state = capture(), camera = true, initialTab: 'image' | 'record' = 'record') { await act(async () => root.render(<StudioRecordingTools initialTab={initialTab} state={state} camera={camera} disabled={false} guides={guides} onVideo={onVideo} onGuides={onGuides} onClose={() => undefined} />)); }
async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('change', { bubbles: true })); if (element instanceof HTMLInputElement) element.dispatchEvent(new Event('input', { bubbles: true })); });
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); onVideo.mockReset(); onGuides.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('qualidade na prévia', () => {
  it('alterna as quatro resoluções com um toque e mantém a etiqueta na saída confirmada', async () => {
    for (const [index, profile] of profiles.entries()) {
      await badge(capture({ width: profile.width, height: profile.height, outputVideo: { resolutions: profiles, frameRates: [30] } }));
      expect(button().textContent).toContain(profile.label);
      await act(async () => button().click());
      expect(onVideo).toHaveBeenLastCalledWith({ output: { width: profiles[(index + 1) % profiles.length].width, height: profiles[(index + 1) % profiles.length].height } });
      expect(button().textContent).toContain(profile.label);
    }
  });
  it('usa as saídas de cenas/tela no formato vertical sem confundir com a câmera horizontal', async () => {
    const vertical = profiles.map(value => ({ ...value, width: value.height, height: value.width }));
    await badge(capture({ width: 1080, height: 1920, outputVideo: { resolutions: vertical, frameRates: [30, 60], sourceWidth: 1920, sourceHeight: 1080 } }));
    expect(button().textContent).toContain('1080p'); await act(async () => button().click());
    expect(onVideo).toHaveBeenLastCalledWith({ output: { width: 1440, height: 2560 } });
    await act(async () => host.querySelector<HTMLButtonElement>('.se-recording-quality button:last-child')!.click());
    expect(onVideo).toHaveBeenLastCalledWith({ output: { width: 1080, height: 1920, frameRate: 60 } });
  });
  it('não permite mudar o perfil durante preparação, REC ou operação reservada', async () => {
    for (const phase of ['preparing', 'recording', 'stopping'] as const) {
      await badge(capture({ phase })); expect(button().disabled).toBe(true); await act(async () => button().click());
    }
    await badge(capture(), true); expect(button().disabled).toBe(true); await act(async () => button().click()); expect(onVideo).not.toHaveBeenCalled();
  });
  it('mostra dimensões efetivas para perfil não padrão e não oferece perfis sem suporte', async () => {
    const value = capture({ width: 1600, height: 900 }); value.videoControls!.resolutions = [{ width: 1600, height: 900, label: '1600 × 900' }];
    await badge(value); expect(button().textContent).toContain('1600 × 900'); expect(button().disabled).toBe(true);
    await badge(capture({ phase: 'idle', width: undefined, height: undefined, frameRate: undefined, videoControls: null })); expect(button().textContent).toContain('Resolução'); expect(host.textContent).not.toContain('1080');
  });
});

describe('configurações de captura', () => {
  it('oferece saída 4K na tela e informa a ampliação de uma fonte 1080p', async () => {
    await tools(capture({ width: 3840, height: 2160, videoControls: null, outputVideo: { resolutions: profiles, frameRates: [30, 60], sourceWidth: 1920, sourceHeight: 1080, scaled: true } }), false);
    const select = control<HTMLSelectElement>('Resolução da gravação'); expect(select.options).toHaveLength(4); expect(select.value).toBe('3840x2160');
    expect(host.textContent).toContain('Gravação: 3840 × 2160'); expect(host.textContent).toContain('Entrada: 1920 × 1080'); expect(host.textContent).toContain('a ampliação não acrescenta detalhes');
    await setValue(select, '1280x720'); expect(onVideo).toHaveBeenLastCalledWith({ output: { width: 1280, height: 720 } });
  });
  it('separa controle físico do tratamento digital e não mostra controles ausentes', async () => {
    const value = capture(); value.videoControls!.hardware = { ranges: { iso: { min: 100, max: 1600, step: 100, value: 400 }, exposureTime: { min: 10, max: 1000, step: 1, value: 166.67 }, exposureCompensation: { min: -2, max: 2, step: .1, value: 0 } }, modes: { exposureMode: { values: ['continuous', 'manual'], value: 'continuous' } } };
    await tools(value, true, 'image');
    expect(host.textContent).toContain('CONTROLES REAIS'); expect(host.textContent).toContain('Tratamento de imagem'); expect(host.textContent).toContain('1/60 s'); expect(control('Balanço de branco')).toBeNull();
    const iso = control<HTMLInputElement>('ISO'); expect(iso.disabled).toBe(false); await setValue(iso, '800'); expect(onVideo).toHaveBeenLastCalledWith({ hardware: { iso: 800 } });
    await setValue(control<HTMLInputElement>('Exposição digital'), '1'); expect(onVideo).toHaveBeenLastCalledWith({ grade: { exposure: 1 } });
    value.videoControls!.hardware.modes.exposureMode!.value = 'manual'; await tools(value, true, 'image'); expect(control<HTMLInputElement>('Compensação de exposição').disabled).toBe(true);
  });
  it('oculta sliders físicos em fontes sem capacidades manuais e bloqueia ajustes durante REC', async () => {
    await tools(capture(), true, 'image'); expect(host.querySelector('[aria-label="ISO"]')).toBeNull(); expect(host.textContent).toContain('não disponibiliza controles manuais');
    const value = capture({ phase: 'recording' }); value.videoControls!.hardware = { ranges: { iso: { min: 100, max: 800, step: 100, value: 400 } }, modes: {} };
    await tools(value, true, 'image'); expect(control<HTMLInputElement>('ISO').disabled).toBe(true); expect(control<HTMLInputElement>('Exposição digital').disabled).toBe(true);
  });
});

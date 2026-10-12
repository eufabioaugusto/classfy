import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStudioCameraHardware, cloneStudioCameraHardware, formatStudioCameraValue, studioCameraHardwareControls, StudioCameraHardwareRestoreError, type StudioCameraHardwarePatch } from './cameraHardware';

type Settings = MediaTrackSettings & StudioCameraHardwarePatch;
function camera() {
  let settings: Settings = { width: 1920, height: 1080, frameRate: 30, iso: 100, exposureMode: 'continuous', exposureTime: 200, exposureCompensation: 0, colorTemperature: 5000, whiteBalanceMode: 'continuous', focusDistance: 1, focusMode: 'continuous', torch: false };
  let capabilities: Record<string, unknown> = { iso: { min: 100, max: 1600, step: 100 }, exposureTime: { min: 50, max: 10000, step: 10 }, exposureCompensation: { min: -2, max: 2, step: .1 }, colorTemperature: { min: 2500, max: 7500, step: 100 }, focusDistance: { min: 0, max: 10, step: .1 }, exposureMode: ['continuous', 'manual'], whiteBalanceMode: ['continuous', 'manual'], focusMode: ['continuous', 'manual'], torch: true };
  const constraints = { width: { exact: 1920 }, height: { exact: 1080 }, exposureMode: 'continuous', iso: 100, advanced: [{ zoom: 2, iso: 100 }] };
  const api = {
    getSettings: vi.fn(() => ({ ...settings })), getCapabilities: vi.fn(() => capabilities), getConstraints: vi.fn(() => constraints),
    applyConstraints: vi.fn(async (request: MediaTrackConstraints) => { Object.assign(settings, request.advanced?.at(-1)); }),
  };
  return { track: api as unknown as MediaStreamTrack, api, settings: () => ({ ...settings }), setSettings(patch: Partial<Settings>) { settings = { ...settings, ...patch }; }, setCapabilities(patch: Record<string, unknown>) { capabilities = patch; } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('controles físicos reconhecidos e confirmados', () => {
  it('exposição, WB e foco só aparecem com capacidade e valor atual válidos; snapshots são independentes', () => {
    const c = camera(), controls = studioCameraHardwareControls(c.track);
    expect(controls).toMatchObject({ ranges: { iso: { value: 100 }, exposureTime: { value: 200 }, colorTemperature: { value: 5000 }, focusDistance: { value: 1 } }, modes: { exposureMode: { value: 'continuous', values: ['continuous', 'manual'] } }, torch: false });
    const copied = cloneStudioCameraHardware(controls); copied.ranges.iso!.value = 800; copied.modes.exposureMode!.values.push('single-shot');
    expect(controls.ranges.iso!.value).toBe(100); expect(controls.modes.exposureMode!.values).toEqual(['continuous', 'manual']);
    c.setCapabilities({ iso: { min: 100, max: 1600 }, exposureMode: ['continuous'], colorTemperature: { min: 7500, max: 2500 }, torch: false });
    expect(studioCameraHardwareControls(c.track)).toEqual({ ranges: {}, modes: { exposureMode: { values: ['continuous'], value: 'continuous' } } });
    c.api.getCapabilities.mockImplementation(() => { throw new Error('Driver sem capabilities'); }); expect(studioCameraHardwareControls(c.track)).toEqual({ ranges: {}, modes: {} });
  });
  it('unidades de obturador correspondem ao tempo físico e balanço de branco usa Kelvin', () => {
    expect(formatStudioCameraValue('exposureTime', 200)).toBe('1/50 s'); expect(formatStudioCameraValue('exposureTime', 20000)).toBe('2 s'); expect(formatStudioCameraValue('colorTemperature', 5600)).toBe('5600 K'); expect(formatStudioCameraValue('exposureCompensation', .7)).toBe('+0.7 EV');
  });
  it('obturador de vídeo respeita a duração do frame e rejeita exposição longa antes de tocar a câmera', async () => {
    const c = camera();
    expect(studioCameraHardwareControls(c.track).ranges.exposureTime!.max).toBeCloseTo(10000 / 30);
    await expect(applyStudioCameraHardware(c.track, { exposureTime: 1000 })).rejects.toThrow('não está disponível');
    expect(c.api.applyConstraints).not.toHaveBeenCalled();
    c.setSettings({ frameRate: 60, exposureTime: 100 });
    expect(studioCameraHardwareControls(c.track).ranges.exposureTime!.max).toBeCloseTo(10000 / 60);
  });
  it('ISO muda para manual com ACK real e preserva resolução/zoom fora do ajuste', async () => {
    const c = camera(), result = await applyStudioCameraHardware(c.track, { iso: 400 });
    expect(c.api.applyConstraints).toHaveBeenCalledWith({ width: { exact: 1920 }, height: { exact: 1080 }, advanced: [{ zoom: 2 }, { iso: 400, exposureMode: 'manual' }] });
    expect(result.controls.ranges.iso!.value).toBe(400); expect(c.settings()).toMatchObject({ width: 1920, height: 1080, iso: 400, exposureMode: 'manual' });
    await result.restore(); expect(c.settings()).toMatchObject({ iso: 100, exposureMode: 'continuous', width: 1920, height: 1080 });
  });
  it('controle de branco e foco seguem modo manual, mantendo cada valor físico confirmado', async () => {
    const c = camera(); await applyStudioCameraHardware(c.track, { colorTemperature: 5600, focusDistance: 2, torch: true });
    expect(c.settings()).toMatchObject({ colorTemperature: 5600, whiteBalanceMode: 'manual', focusDistance: 2, focusMode: 'manual', torch: true, iso: 100, exposureMode: 'continuous' });
  });
  it.each([{ iso: 99 }, { iso: NaN }, { exposureMode: 'automatic' }, { iso: 400, exposureMode: 'continuous' }, {}, { unknown: 1 }] as StudioCameraHardwarePatch[])('rejeita ajuste inválido/ambíguo %j sem tocar driver', async patch => {
    const c = camera(); await expect(applyStudioCameraHardware(c.track, patch)).rejects.toThrow(); expect(c.api.applyConstraints).not.toHaveBeenCalled(); expect(c.settings()).toMatchObject({ iso: 100, exposureMode: 'continuous' });
  });
  it('não promete controle quando applyConstraints ou formato de capabilities não existe', async () => {
    const c = camera(); expect(studioCameraHardwareControls({ getSettings: c.api.getSettings, getCapabilities: c.api.getCapabilities } as unknown as MediaStreamTrack)).toEqual({ ranges: {}, modes: {} });
    c.setCapabilities({ torch: false }); await expect(applyStudioCameraHardware(c.track, { torch: true })).rejects.toThrow('não é exposto'); expect(c.api.applyConstraints).not.toHaveBeenCalled();
  });
  it('API que resolve antes do hardware não publica alvo até receber settings ACK', async () => {
    const c = camera(); c.api.applyConstraints.mockImplementationOnce(async () => { setTimeout(() => c.setSettings({ iso: 400, exposureMode: 'manual' }), 150); });
    let done = false; const request = applyStudioCameraHardware(c.track, { iso: 400 }); void request.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(100); expect(done).toBe(false); expect(c.settings().iso).toBe(100);
    await vi.advanceTimersByTimeAsync(100); const result = await request; expect(done).toBe(true); expect(result.controls.ranges.iso!.value).toBe(400); expect(c.api.applyConstraints).toHaveBeenCalledOnce();
  });
  it('constraint ignorada rejeita alvo e restaura valores anteriores em vez de reportar sucesso', async () => {
    const c = camera(); c.api.applyConstraints.mockImplementationOnce(async () => {});
    const request = applyStudioCameraHardware(c.track, { iso: 400 }), rejected = expect(request).rejects.toThrow('não confirmou'); await vi.advanceTimersByTimeAsync(1100); await rejected;
    expect(c.api.applyConstraints).toHaveBeenCalledTimes(2); expect(c.settings()).toMatchObject({ iso: 100, exposureMode: 'continuous' });
  });
  it('erro depois de alteração parcial faz rollback físico confirmado', async () => {
    const c = camera(); c.api.applyConstraints.mockImplementationOnce(async () => { c.setSettings({ iso: 400, exposureMode: 'manual' }); throw new Error('Driver falhou depois de aplicar'); });
    await expect(applyStudioCameraHardware(c.track, { iso: 400 })).rejects.toThrow('Driver falhou'); expect(c.settings()).toMatchObject({ iso: 100, exposureMode: 'continuous' }); expect(c.api.applyConstraints).toHaveBeenCalledTimes(2);
  });
  it('rollback que não recupera settings gera erro fatal próprio e não entrega controles otimistas', async () => {
    const c = camera(); c.api.applyConstraints.mockImplementationOnce(async () => { c.setSettings({ iso: 800, exposureMode: 'manual' }); throw new Error('Alteração parcial'); }).mockImplementationOnce(async () => {});
    const request = applyStudioCameraHardware(c.track, { iso: 400 }), rejected = expect(request).rejects.toBeInstanceOf(StudioCameraHardwareRestoreError); await vi.advanceTimersByTimeAsync(1100); await rejected;
    expect(c.settings().iso).toBe(800); expect(c.api.applyConstraints).toHaveBeenCalledTimes(2);
  });
  it('cancelamento durante espera de ACK não restaura uma entrada que já foi encerrada', async () => {
    const c = camera(); c.api.applyConstraints.mockImplementationOnce(async () => {}); let cancelled = false;
    const request = applyStudioCameraHardware(c.track, { iso: 400 }, () => { if (cancelled) throw new DOMException('Cancelado', 'AbortError'); }), rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100); cancelled = true; await vi.advanceTimersByTimeAsync(100); await rejected; expect(c.api.applyConstraints).toHaveBeenCalledOnce();
  });
});

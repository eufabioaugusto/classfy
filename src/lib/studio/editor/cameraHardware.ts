/** Video controls from the device/driver, distinct from our GPU image treatment.
 * Units follow https://www.w3.org/TR/image-capture/#constrainable-properties . */
export const studioCameraRangeNames = ['exposureCompensation', 'exposureTime', 'iso', 'colorTemperature', 'focusDistance', 'sharpness', 'brightness', 'contrast', 'saturation'] as const;
export const studioCameraModeNames = ['exposureMode', 'whiteBalanceMode', 'focusMode'] as const;
export type StudioCameraRangeName = typeof studioCameraRangeNames[number];
export type StudioCameraModeName = typeof studioCameraModeNames[number];
export type StudioCameraHardwarePatch = Partial<Record<StudioCameraRangeName, number> & Record<StudioCameraModeName, string> & { torch: boolean }>;
export type StudioCameraHardwareControls = {
  ranges: Partial<Record<StudioCameraRangeName, { min: number; max: number; step: number; value: number }>>;
  modes: Partial<Record<StudioCameraModeName, { values: string[]; value: string }>>;
  torch?: boolean;
};
type Range = { min?: number; max?: number; step?: number };
type CameraCapabilities = MediaTrackCapabilities & Partial<Record<StudioCameraRangeName, Range> & Record<StudioCameraModeName, string[]> & { torch: boolean }>;
type CameraSettings = MediaTrackSettings & StudioCameraHardwarePatch;
const manualMode: Partial<Record<StudioCameraRangeName, StudioCameraModeName>> = { exposureTime: 'exposureMode', iso: 'exposureMode', colorTemperature: 'whiteBalanceMode', focusDistance: 'focusMode' };
export const studioCameraControlLabels: Record<StudioCameraRangeName | StudioCameraModeName, string> = {
  exposureCompensation: 'Compensação de exposição', exposureTime: 'Obturador', iso: 'ISO', colorTemperature: 'Balanço de branco', focusDistance: 'Distância de foco', sharpness: 'Nitidez', brightness: 'Brilho da câmera', contrast: 'Contraste da câmera', saturation: 'Saturação da câmera',
  exposureMode: 'Exposição da câmera', whiteBalanceMode: 'Modo de balanço de branco', focusMode: 'Foco da câmera',
};
export function formatStudioCameraValue(name: StudioCameraRangeName, value: number) {
  if (name === 'exposureTime') return value > 0 ? value < 10000 ? `1/${Math.round(10000 / value)} s` : `${Number((value / 10000).toFixed(2))} s` : '—';
  if (name === 'colorTemperature') return `${Math.round(value)} K`;
  if (name === 'iso') return `${Math.round(value)}`;
  if (name === 'exposureCompensation') return `${value > 0 ? '+' : ''}${Number(value.toFixed(2))} EV`;
  if (name === 'focusDistance') return `${Number(value.toFixed(2))} m`;
  return `${Number(value.toFixed(2))}`;
}
export function studioCameraHardwareControls(track: MediaStreamTrack): StudioCameraHardwareControls {
  const controls: StudioCameraHardwareControls = { ranges: {}, modes: {} };
  if (typeof track.applyConstraints !== 'function') return controls;
  let caps: CameraCapabilities;
  try { caps = track.getCapabilities?.() as CameraCapabilities ?? {}; } catch { return controls; }
  const settings = track.getSettings() as CameraSettings;
  for (const name of studioCameraModeNames) {
    const values = caps[name]?.filter(value => ['none', 'manual', 'single-shot', 'continuous'].includes(value));
    if (values?.length && typeof settings[name] === 'string' && values.includes(settings[name]!)) controls.modes[name] = { values: [...new Set(values)], value: settings[name]! };
  }
  for (const name of studioCameraRangeNames) {
    const range = caps[name], value = settings[name], mode = manualMode[name];
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max! <= range.min! || !Number.isFinite(value) || value! < range.min! || value! > range.max!) continue;
    // A manual slider must have a real mode switch or already be in manual mode.
    if (mode && controls.modes[mode]?.value !== 'manual' && !controls.modes[mode]?.values.includes('manual')) continue;
    // Video shutter must fit the current frame duration (unit: 100 microseconds).
    const max = name === 'exposureTime' && settings.frameRate && settings.frameRate > 0 ? Math.min(range.max!, 10000 / settings.frameRate) : range.max!;
    if (max <= range.min! || value! > max) continue;
    controls.ranges[name] = { min: range.min!, max, step: Number.isFinite(range.step) && range.step! > 0 ? range.step! : Math.max(.001, (max - range.min!) / 100), value: value! };
  }
  if (caps.torch === true && typeof settings.torch === 'boolean') controls.torch = settings.torch;
  return controls;
}
export function cloneStudioCameraHardware(controls: StudioCameraHardwareControls): StudioCameraHardwareControls {
  return { ...controls, ranges: Object.fromEntries(Object.entries(controls.ranges).map(([key, value]) => [key, { ...value }])), modes: Object.fromEntries(Object.entries(controls.modes).map(([key, value]) => [key, { ...value, values: [...value.values] }])) };
}
export class StudioCameraHardwareRestoreError extends Error {}
/** Optional/advanced constraints can be silently ignored. Publish only settings ACK.
 * Caller serializes requests and invalidates this operation when the source changes. */
export async function applyStudioCameraHardware(track: MediaStreamTrack, patch: StudioCameraHardwarePatch, assert: () => void = () => {}) {
  assert();
  const controls = studioCameraHardwareControls(track), previous = track.getSettings() as CameraSettings;
  const values: StudioCameraHardwarePatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((studioCameraRangeNames as readonly string[]).includes(key)) {
      const name = key as StudioCameraRangeName, range = controls.ranges[name];
      if (!range || typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max) throw new Error(`${studioCameraControlLabels[name]} não está disponível nesse valor.`);
      values[name] = value;
      const mode = manualMode[name];
      if (mode) {
        if (patch[mode] !== undefined && patch[mode] !== 'manual') throw new Error('Escolha o modo manual para ajustar esse controle.');
        values[mode] = 'manual';
      }
    } else if ((studioCameraModeNames as readonly string[]).includes(key)) {
      const name = key as StudioCameraModeName;
      if (typeof value !== 'string' || !controls.modes[name]?.values.includes(value)) throw new Error(`${studioCameraControlLabels[name]} não oferece esse modo.`);
      values[name] = value;
    } else if (key === 'torch' && controls.torch !== undefined && typeof value === 'boolean') values.torch = value;
    else throw new Error('Esse controle não é exposto pela câmera neste navegador.');
  }
  if (!Object.keys(values).length) throw new Error('Escolha um controle da câmera.');
  const rollback = Object.fromEntries(Object.keys(values).map(key => [key, previous[key as keyof StudioCameraHardwarePatch]])) as StudioCameraHardwarePatch;
  const constraints = track.getConstraints?.() ?? {};
  const confirm = async (wanted: StudioCameraHardwarePatch) => {
    for (let attempt = 0; attempt <= 20; attempt++) {
      assert();
      const current = track.getSettings() as CameraSettings;
      const matches = Object.entries(wanted).every(([key, value]) => typeof value === 'number'
        ? Number.isFinite(current[key as StudioCameraRangeName]) && Math.abs(current[key as StudioCameraRangeName]! - value) <= Math.max(.00001, (controls.ranges[key as StudioCameraRangeName]?.step ?? .001) / 2)
        : current[key as keyof StudioCameraHardwarePatch] === value);
      if (matches) return;
      if (attempt < 20) await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('A câmera não confirmou o ajuste solicitado.');
  };
  const apply = (wanted: StudioCameraHardwarePatch) => {
    const clean = (old: object) => Object.fromEntries(Object.entries(old).filter(([key]) => !(key in values)));
    return track.applyConstraints({ ...clean(constraints), advanced: [...(constraints.advanced ?? []).map(clean), wanted] } as MediaTrackConstraints);
  };
  const restore = async () => { assert(); await apply(rollback); await confirm(rollback); };
  try { await apply(values); assert(); await confirm(values); }
  catch (error) {
    assert(); // Never restore a track after cancellation/replacement.
    try { await restore(); } catch (restoreError) { assert(); throw new StudioCameraHardwareRestoreError(`A câmera não recuperou o ajuste anterior. Ative a entrada novamente. ${restoreError instanceof Error ? restoreError.message : ''}`); }
    throw error;
  }
  return { controls: studioCameraHardwareControls(track), restore };
}

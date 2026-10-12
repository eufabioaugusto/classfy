import type { StudioCaptureState, StudioCaptureVideoPatch } from '@/lib/studio/editor/capture';
import { formatStudioCameraValue, studioCameraControlLabels, studioCameraModeNames, studioCameraRangeNames } from '@/lib/studio/editor/cameraHardware';

const modeLabels: Record<string, string> = { none: 'Desligado', manual: 'Manual', continuous: 'Automático', 'single-shot': 'Automático uma vez' };
const manualModes = { exposureTime: 'exposureMode', iso: 'exposureMode', colorTemperature: 'whiteBalanceMode', focusDistance: 'focusMode' } as const;

export function StudioCameraHardwareControls({ state, disabled, onVideo }: {
  state: StudioCaptureState; disabled: boolean; onVideo(patch: StudioCaptureVideoPatch): void;
}) {
  const hardware = state.videoControls?.hardware;
  const available = hardware && (Object.keys(hardware.ranges).length || Object.keys(hardware.modes).length || typeof hardware.torch === 'boolean');
  const locked = disabled || state.phase !== 'ready' || state.videoControls?.busy === true;
  return <section className="se-recording-hardware" aria-label="Controles reais da câmera">
    <header><h3>Câmera</h3><small>CONTROLES REAIS</small></header>
    {!available ? <p className="se-recording-tools-note">Esta conexão não disponibiliza controles manuais da câmera. Os ajustes de imagem abaixo continuam disponíveis.</p> : <>
      {studioCameraModeNames.map(name => {
        const mode = hardware.modes[name];
        return mode && <label key={name} className="se-recording-tool-select">{studioCameraControlLabels[name]}<select aria-label={studioCameraControlLabels[name]} disabled={locked} value={mode.value} onChange={event => onVideo({ hardware: { [name]: event.target.value } })}>{mode.values.map(value => <option key={value} value={value}>{modeLabels[value] ?? value}</option>)}</select></label>;
      })}
      {studioCameraRangeNames.map(name => {
        const range = hardware.ranges[name]; if (!range) return null;
        const modeName = manualModes[name as keyof typeof manualModes];
        const mode = modeName ? hardware.modes[modeName] : undefined;
        const enablesManual = !!mode && mode.value !== 'manual';
        const requiresAuto = name === 'exposureCompensation' && hardware.modes.exposureMode?.value === 'manual';
        return <label key={name} className="se-recording-tool-range"><span>{studioCameraControlLabels[name]}<output>{formatStudioCameraValue(name, range.value)}</output></span><input aria-label={studioCameraControlLabels[name]} type="range" min={range.min} max={range.max} step={range.step} value={range.value} disabled={locked || requiresAuto} onChange={event => onVideo({ hardware: { [name]: Number(event.target.value) } })} />{requiresAuto ? <small>Selecione exposição automática para ajustar a compensação.</small> : enablesManual && <small>Ao ajustar, {studioCameraControlLabels[modeName!].toLocaleLowerCase('pt-BR')} passa para Manual.</small>}</label>;
      })}
      {typeof hardware.torch === 'boolean' && <label className="se-recording-tool-toggle"><span>Luz da câmera</span><input type="checkbox" aria-label="Luz da câmera" checked={hardware.torch} disabled={locked} onChange={event => onVideo({ hardware: { torch: event.target.checked } })} /></label>}
      <p className="se-recording-tools-note">Ajustes aplicados ao dispositivo e confirmados pela câmera.</p>
    </>}
  </section>;
}

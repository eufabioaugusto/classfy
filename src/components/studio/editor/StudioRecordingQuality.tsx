import type { StudioCaptureState, StudioCaptureVideoPatch } from '@/lib/studio/editor/capture';

/** Labels follow the confirmed recording output, never the requested camera profile. */
export function studioRecordingQuality(state: StudioCaptureState) {
  const options = state.outputVideo ?? state.videoControls;
  const resolutions = [...(options?.resolutions ?? [])].sort((a, b) => a.width * a.height - b.width * b.height);
  const frameRates = [...(options?.frameRates ?? [])].sort((a, b) => a - b);
  const current = resolutions.find(value => value.width === state.width && value.height === state.height);
  const label = current?.label ?? (state.width && state.height ? `${state.width} × ${state.height}` : 'Resolução');
  const nextResolution = resolutions[(resolutions.findIndex(value => value === current) + 1) % resolutions.length];
  const nextFrameRate = frameRates[(frameRates.findIndex(value => Math.abs(value - (state.frameRate ?? 0)) < .01) + 1) % frameRates.length];
  return { resolutions, frameRates, label, nextResolution, nextFrameRate };
}

export function StudioRecordingQuality({ state, disabled, onVideo }: {
  state: StudioCaptureState; disabled: boolean; onVideo(patch: StudioCaptureVideoPatch): void;
}) {
  const quality = studioRecordingQuality(state);
  const locked = disabled || state.phase !== 'ready' || state.videoControls?.busy === true;
  return <div className="se-recording-quality" role="group" aria-label="Qualidade da gravação">
    <button type="button" aria-label={`Alterar resolução da gravação: ${quality.label}`} title={quality.resolutions.length > 1 && quality.nextResolution ? `Um toque para ${quality.nextResolution.label}` : state.phase === 'ready' ? 'Perfil confirmado disponível nesta entrada' : 'Abra a captura para selecionar a resolução'} disabled={locked || quality.resolutions.length < 2} onClick={() => { const next = quality.nextResolution; if (next) onVideo(state.outputVideo ? { output: { width: next.width, height: next.height } } : { width: next.width, height: next.height }); }}><strong>{quality.label}</strong><small>RESOLUÇÃO</small></button>
    <button type="button" aria-label={`Alterar quadros por segundo: ${state.frameRate ? `${Number(state.frameRate.toFixed(1))} fps` : 'aguardando entrada'}`} title={quality.frameRates.length > 1 && quality.nextFrameRate ? `Um toque para ${quality.nextFrameRate} fps` : state.phase === 'ready' ? 'Taxa de quadros confirmada nesta entrada' : 'Abra a captura para selecionar os quadros por segundo'} disabled={locked || quality.frameRates.length < 2} onClick={() => { if (quality.nextFrameRate) onVideo(state.outputVideo && state.width && state.height ? { output: { width: state.width, height: state.height, frameRate: quality.nextFrameRate } } : { frameRate: quality.nextFrameRate }); }}><strong>{state.frameRate ? Number(state.frameRate.toFixed(1)) : '—'}</strong><small>FPS</small></button>
  </div>;
}

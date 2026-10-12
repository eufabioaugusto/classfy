import { useEffect, useRef, useState } from 'react';
import { Camera, SlidersHorizontal, X } from 'lucide-react';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import type { StudioRemoteConfiguration } from '../../../../shared/studio/remoteCamera';

function ProSlider({ title, value, min, max, step, format, disabled, onCommit }: { title: string; value: number; min: number; max: number; step: number; format(value: number): string; disabled: boolean; onCommit(value: number): void }) {
  const [target, setTarget] = useState(value), committed = useRef(value);
  useEffect(() => { setTarget(value); committed.current = value; }, [value, disabled]);
  const commit = () => { if (disabled || target === committed.current) return; committed.current = target; onCommit(target); };
  return <label className="src-control"><span>{title}<output>{format(value)}</output></span><input aria-label={title} type="range" value={Math.max(min, Math.min(max, target))} min={min} max={max} step={step} disabled={disabled} onChange={event => setTarget(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /></label>;
}

/** These values are native device ACKs. They never describe the WebRTC preview. */
export function StudioRemoteCameraControls({ state, disabled, onConfigure, onClose }: { state: StudioRemoteView; disabled: boolean; onConfigure(patch: Partial<StudioRemoteConfiguration>): void; onClose(): void }) {
  const pro = state.session?.deviceState?.pro ?? {}, device = state.session?.deviceState;
  const numeric = (key: string, fallback = 0) => typeof pro[key] === 'number' && Number.isFinite(pro[key]) ? Number(pro[key]) : fallback;
  const automatic = (key: string) => pro[key] !== false;
  const mode = (title: string, key: string) => <div className="src-control-mode"><strong>{title}</strong><div>{[true, false].map(auto => <button type="button" key={String(auto)} aria-pressed={automatic(key) === auto} disabled={disabled} onClick={() => onConfigure({ pro: { [key]: auto } })}>{auto ? 'Auto' : 'Manual'}</button>)}</div></div>;
  const slider = (title: string, key: string, min: number, max: number, format: (value: number) => string, autoKey?: string, step?: number) => {
    const value = numeric(key); if (![value, min, max].every(Number.isFinite) || max <= min) return null;
    return <ProSlider key={key} title={title} value={value} min={min} max={max} step={step ?? (max - min) / 200} disabled={disabled} format={format} onCommit={next => onConfigure({ pro: { ...(autoKey ? { [autoKey]: false } : {}), [key]: next } })} />;
  };
  return <aside className="src-controls" aria-label="Controles Pro do iPhone"><header><div><span className="src-eyebrow">SEU IPHONE, EM FOCO</span><h2><SlidersHorizontal size={18} />Câmera Pro</h2></div><button type="button" className="se-recording-icon" aria-label="Fechar controles do iPhone" onClick={onClose}><X size={18} /></button></header><p>Ajustes físicos confirmados pelo iPhone. A prévia usa menos dados; o original mantém a qualidade selecionada.</p>
    <button type="button" className="src-secondary" disabled={disabled} onClick={() => onConfigure({ cameraFacing: state.session?.configuration.cameraFacing === 'back' ? 'front' : 'back' })}><Camera size={16} />{state.session?.configuration.cameraFacing === 'back' ? 'Usar câmera frontal' : 'Usar câmera traseira'}</button>
    {pro.supportsZoom === true && slider('Zoom', 'zoom', numeric('minZoom', 1), numeric('maxZoom', 1), value => `${value.toFixed(1)}×`, undefined, .01)}
    {pro.supportsExposure === true && <section>{mode('Exposição', 'autoExposure')}{!automatic('autoExposure') && <>{slider('ISO', 'iso', numeric('minISO'), numeric('maxISO'), value => Math.round(value).toString(), 'autoExposure')}{slider('Obturador', 'shutterSeconds', numeric('minShutterSeconds'), numeric('maxShutterSeconds'), value => value > 0 ? `1/${Math.round(1 / value)} s` : '—', 'autoExposure')}</>}</section>}
    {pro.supportsWhiteBalance === true && <section>{mode('Balanço de branco', 'autoWhiteBalance')}{!automatic('autoWhiteBalance') && pro.supportsTemperatureAndTint === true && <>{slider('Temperatura', 'temperatureKelvin', 2000, 10000, value => `${Math.round(value)} K`, 'autoWhiteBalance', 50)}{slider('Matiz', 'whiteBalanceTint', -150, 150, value => `${value >= 0 ? '+' : ''}${Math.round(value)}`, 'autoWhiteBalance', 1)}</>}</section>}
    {pro.supportsFocus === true && <section>{mode('Foco', 'autoFocus')}{!automatic('autoFocus') && slider('Posição da lente', 'lensPosition', 0, 1, value => `${Math.round(value * 100)}%`, 'autoFocus', .01)}</section>}
    {!pro.supportsExposure && !pro.supportsWhiteBalance && !pro.supportsFocus && !pro.supportsZoom && <p>Os controles disponíveis aparecerão quando o iPhone confirmar sua câmera.</p>}
    {device?.error && <p className="src-error" role="alert">{String(device.error)}</p>}
  </aside>;
}

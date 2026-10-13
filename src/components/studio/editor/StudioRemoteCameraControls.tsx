import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Crosshair, FileText, Loader2, Palette, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import type { StudioCaptureState, StudioCaptureVideoPatch } from '@/lib/studio/editor/capture';
import { studioGrade, validateStudioGrade, type StudioGrade } from '../../../../shared/studio';
import type { StudioRemoteConfiguration } from '../../../../shared/studio/remoteCamera';
import { StudioRecordingTools, type RecordingGuides } from './StudioRecordingTools';

export type StudioRemoteToolsTab = 'image' | 'camera' | 'record' | 'script';

function ProSlider({ title, value, min, max, step, format, disabled, onCommit }: { title: string; value: number; min: number; max: number; step: number; format(value: number): string; disabled: boolean; onCommit(value: number): void }) {
  const [target, setTarget] = useState(value), committed = useRef(value);
  useEffect(() => { setTarget(value); committed.current = value; }, [value, disabled]);
  const commit = () => { if (disabled || target === committed.current) return; committed.current = target; onCommit(target); };
  return <label className="src-control"><span>{title}<output>{format(value)}</output></span><input aria-label={title} type="range" value={Math.max(min, Math.min(max, target))} min={min} max={max} step={step} disabled={disabled} onChange={event => setTarget(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /></label>;
}

/** The selected look and physical settings describe native ACKs, not CSS on the preview. */
export function StudioRemoteCameraControls({ state, disabled, onConfigure, onClose, initialTab = 'camera', onTab, recording }: {
  state: StudioRemoteView; disabled: boolean; onConfigure(patch: Partial<StudioRemoteConfiguration>): void; onClose(): void;
  initialTab?: StudioRemoteToolsTab;
  onTab?(tab: StudioRemoteToolsTab): void;
  recording?: { state: StudioCaptureState; guides: RecordingGuides; onGuides(patch: Partial<RecordingGuides>): void; onVideo(patch: StudioCaptureVideoPatch): void };
}) {
  const [tab, setTab] = useState<StudioRemoteToolsTab>(initialTab);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('[aria-label="Fechar controles do iPhone"]')?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  const pro = state.session?.deviceState?.pro ?? {}, device = state.session?.deviceState;
  const numeric = (key: string, fallback = 0) => typeof pro[key] === 'number' && Number.isFinite(pro[key]) ? Number(pro[key]) : fallback;
  const automatic = (key: string) => pro[key] !== false;
  const mode = (title: string, key: string) => <div className="src-control-mode"><strong>{title}</strong><div>{[true, false].map(auto => <button type="button" key={String(auto)} aria-pressed={automatic(key) === auto} disabled={disabled} onClick={() => onConfigure({ pro: { [key]: auto } })}>{auto ? 'Auto' : 'Manual'}</button>)}</div></div>;
  const slider = (title: string, key: string, min: number, max: number, format: (value: number) => string, autoKey?: string, step?: number) => {
    const value = numeric(key); if (![value, min, max].every(Number.isFinite) || max <= min) return null;
    return <ProSlider key={key} title={title} value={value} min={min} max={max} step={step ?? (max - min) / 200} disabled={disabled} format={format} onCommit={next => onConfigure({ pro: { ...(autoKey ? { [autoKey]: false } : {}), [key]: next } })} />;
  };
  const supportsImageGrade = device?.capabilities?.supportsImageGrade === true;
  const grade = device?.imageGrade && !validateStudioGrade(device.imageGrade).length ? device.imageGrade as StudioGrade : studioGrade();
  const imageDisabled = disabled || !supportsImageGrade;
  const gradeConfirmed = device?.imageGradeConfirmed === true;
  const configureGrade = (patch: Partial<StudioGrade>) => onConfigure({ imageGrade: { ...grade, ...patch } });
  const tabs = [
    { id: 'image', name: 'Imagem', icon: Palette }, { id: 'camera', name: 'Câmera', icon: Camera },
    ...(recording ? [{ id: 'record', name: 'Gravação', icon: SlidersHorizontal }, { id: 'script', name: 'Roteiro', icon: FileText }] : []),
  ] as const;
  const changeTab = (next: StudioRemoteToolsTab) => { setTab(next); onTab?.(next); panel.current?.querySelector<HTMLElement>('.src-controls-body')?.scrollTo?.({ top: 0 }); };
  return <aside ref={panel} className="src-controls src-controls--production" aria-label="Controles Pro do iPhone">
    <header><div><span className="src-eyebrow">SEU IPHONE, EM FOCO</span><h2><SlidersHorizontal size={18} />Câmera Pro</h2></div><button type="button" className="se-recording-icon" aria-label="Fechar controles do iPhone" onClick={onClose}><X size={18} /></button></header>
    <div className="src-controls-tabs" role="tablist" aria-label="Ajustes do iPhone" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const index = tabs.findIndex(value => value.id === tab), next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault(); changeTab(tabs[next].id as StudioRemoteToolsTab); (event.currentTarget.children[next] as HTMLButtonElement)?.focus();
    }}>{tabs.map(({ id, name, icon: Icon }) => <button type="button" key={id} role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => changeTab(id as StudioRemoteToolsTab)}><Icon size={14} /><span>{name}</span></button>)}</div>
    <div className="src-controls-body" role="tabpanel" aria-label={tabs.find(value => value.id === tab)?.name}>
      {tab === 'image' && <>
        <div className="src-control-heading"><h3>Sua imagem, pronta para gravar.</h3><p>Escolha o look antes do REC. O iPhone aplica a mesma cor à prévia e ao original.</p></div>
        {!supportsImageGrade && <p className="src-controls-notice">{device ? 'Atualize o app do iPhone para aplicar filtros e cor antes de gravar.' : 'Conecte seu iPhone para preparar a imagem.'}</p>}
        <fieldset className="src-looks" disabled={imageDisabled}><legend>Look</legend>{(['natural', 'studio', 'cinematic'] as const).map(preset => <button type="button" key={preset} aria-pressed={grade.preset === preset} onClick={() => configureGrade({ preset })}><i className={`src-look-swatch src-look-swatch--${preset}`} /><span>{preset === 'natural' ? 'Natural' : preset === 'studio' ? 'Studio' : 'Cinema'}</span>{grade.preset === preset && <Check size={12} />}</button>)}</fieldset>
        <ProSlider title="Intensidade do filtro" value={grade.intensity} min={0} max={1} step={.05} disabled={imageDisabled} format={value => `${Math.round(value * 100)}%`} onCommit={intensity => configureGrade({ intensity })} />
        <section className="src-tone-controls"><div className="src-control-heading"><h3>Cor e luz</h3><p>Ajustes de aparência, aplicados na gravação.</p></div>{(['exposure', 'contrast', 'saturation', 'temperature'] as const).map(key => <ProSlider key={key} title={key === 'exposure' ? 'Exposição do look' : key === 'contrast' ? 'Contraste' : key === 'saturation' ? 'Saturação' : 'Temperatura do look'} value={grade[key]} min={key === 'exposure' ? -2 : -1} max={key === 'exposure' ? 2 : 1} step={.1} disabled={imageDisabled} format={value => `${value > 0 ? '+' : ''}${value.toFixed(1)}`} onCommit={value => configureGrade({ [key]: value })} />)}</section>
        <button type="button" className="src-secondary src-reset-look" disabled={imageDisabled} onClick={() => onConfigure({ imageGrade: studioGrade() })}><RotateCcw size={14} />Restaurar imagem</button>
        {supportsImageGrade && <p className={`src-look-receipt${gradeConfirmed ? ' is-confirmed' : ''}`} role="status">{gradeConfirmed ? <><Check size={13} />Imagem confirmada no iPhone.</> : <><Loader2 size={13} className="se-spin" />Aguardando a confirmação da imagem.</>}</p>}
      </>}
      {tab === 'camera' && <>
        <div className="src-control-heading"><h3>A câmera, nas suas mãos.</h3><p>Controles físicos da lente e do sensor, confirmados pelo iPhone.</p></div>
        <button type="button" className="src-secondary" disabled={disabled} onClick={() => onConfigure({ cameraFacing: state.session?.configuration.cameraFacing === 'back' ? 'front' : 'back' })}><Camera size={16} />{state.session?.configuration.cameraFacing === 'back' ? 'Usar câmera frontal' : 'Usar câmera traseira'}</button>
        {pro.supportsZoom === true && slider('Zoom', 'zoom', numeric('minZoom', 1), numeric('maxZoom', 1), value => `${value.toFixed(1)}×`, undefined, .01)}
        {pro.supportsExposure === true && <section>{mode('Exposição', 'autoExposure')}{!automatic('autoExposure') && <>{slider('ISO', 'iso', numeric('minISO'), numeric('maxISO'), value => Math.round(value).toString(), 'autoExposure')}{slider('Obturador', 'shutterSeconds', numeric('minShutterSeconds'), numeric('maxShutterSeconds'), value => value > 0 ? `1/${Math.round(1 / value)} s` : '—', 'autoExposure')}</>}</section>}
        {pro.supportsWhiteBalance === true && <section>{mode('Balanço de branco', 'autoWhiteBalance')}{!automatic('autoWhiteBalance') && pro.supportsTemperatureAndTint === true && <>{slider('Temperatura da câmera', 'temperatureKelvin', 2000, 10000, value => `${Math.round(value)} K`, 'autoWhiteBalance', 50)}{slider('Matiz', 'whiteBalanceTint', -150, 150, value => `${value >= 0 ? '+' : ''}${Math.round(value)}`, 'autoWhiteBalance', 1)}</>}</section>}
        {pro.supportsFocus === true && <section>{mode('Foco', 'autoFocus')}{!automatic('autoFocus') && slider('Posição da lente', 'lensPosition', 0, 1, value => `${Math.round(value * 100)}%`, 'autoFocus', .01)}{pro.supportsFocusPoint === true && <p className="src-focus-tip"><Crosshair size={15} />Clique na imagem para focar nesse ponto.</p>}</section>}
        {!pro.supportsExposure && !pro.supportsWhiteBalance && !pro.supportsFocus && !pro.supportsZoom && <p className="src-controls-notice">Os controles disponíveis aparecerão quando o iPhone confirmar sua câmera.</p>}
      </>}
      {(tab === 'record' || tab === 'script') && recording && <StudioRecordingTools embedded initialTab={tab} state={recording.state} camera disabled={disabled} guides={recording.guides} onGuides={recording.onGuides} onVideo={recording.onVideo} onClose={onClose} />}
      {device?.error && <p className="src-error" role="alert">{String(device.error)}</p>}
    </div>
  </aside>;
}

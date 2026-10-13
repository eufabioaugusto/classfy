import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Crosshair, FileText, Loader2, Palette, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import type { StudioCaptureState, StudioCaptureVideoPatch } from '@/lib/studio/editor/capture';
import { studioGrade, validateStudioGrade, type StudioGrade } from '../../../../shared/studio';
import type { StudioRemoteConfiguration } from '../../../../shared/studio/remoteCamera';
import { StudioRecordingTools, type RecordingGuides } from './StudioRecordingTools';

export type StudioRemoteToolsTab = 'image' | 'camera' | 'record' | 'script';

type ConfigureResult = void | Promise<void>;
type SliderScale = 'linear' | 'log' | 'shutter';
const closeEnough = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-8, Math.abs(b) * 1e-6);
const shutterDenominators = [10000, 8000, 6400, 5000, 4000, 3200, 2500, 2000, 1600, 1250, 1000, 800, 640, 500, 400, 320, 250, 200, 160, 125, 120, 100, 80, 60, 50, 48, 40, 30, 25, 24, 20, 15, 10, 8, 6, 5, 4, 3, 2];
function shutterText(value: number) {
  if (value >= 1) return `${Number(value.toFixed(3))} s`;
  const denominator = 1 / value, rounded = Math.round(denominator);
  return `1/${closeEnough(denominator, rounded) ? rounded : Number(denominator.toFixed(2))} s`;
}
/** Drafts belong to the gesture; only a device receipt can replace them. */
function ProSlider({ title, value, min, max, step, scale = 'linear', format, disabled, onCommit }: { title: string; value: number; min: number; max: number; step: number; scale?: SliderScale; format(value: number): string; disabled: boolean; onCommit(value: number): ConfigureResult }) {
  const descriptionId = useId(), confirmed = useRef(value), targetRef = useRef(value), gesture = useRef(false), dirty = useRef(false), sequence = useRef(0), failedValue = useRef<number | null>(null);
  const submitted = useRef<{ id: number; value: number; receipt?: { applied: boolean; cause?: unknown } } | null>(null), liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), mounted = useRef(true), disabledRef = useRef(disabled), commitRef = useRef(onCommit);
  const [target, setTarget] = useState(value), [phase, setPhase] = useState<'confirmed' | 'draft' | 'pending' | 'failed'>('confirmed'), [error, setError] = useState<string | null>(null), [receiptRevision, setReceiptRevision] = useState(0);
  const positions = useMemo(() => scale === 'shutter' ? [...new Set([min, ...shutterDenominators.map(number => 1 / number), 1, 2, 4, 8, 15, 30, max].filter(number => number >= min && number <= max))].sort((a, b) => a - b) : [], [min, max, scale]);
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  const normalize = (next: number) => next <= min ? min : next >= max ? max : scale === 'shutter' ? next : clamp(Number((Math.round(next / step) * step).toPrecision(12)));
  const fromPosition = (position: number) => scale === 'log' && min > 0 ? normalize(position <= 0 ? min : position >= 1000 ? max : min * (max / min) ** (position / 1000)) : scale === 'shutter' ? positions[Math.max(0, Math.min(positions.length - 1, Math.round(position)))] : normalize(position);
  const toPosition = (next: number) => scale === 'log' && min > 0 ? Math.round(Math.log(clamp(next) / min) / Math.log(max / min) * 1000) : scale === 'shutter' ? positions.reduce((nearest, position, index) => Math.abs(Math.log(position / clamp(next))) < Math.abs(Math.log(positions[nearest] / clamp(next))) ? index : nearest, 0) : clamp(next);
  const rangeMin = scale === 'log' || scale === 'shutter' ? 0 : min, rangeMax = scale === 'log' ? 1000 : scale === 'shutter' ? positions.length - 1 : max;
  const adjacent = (next: number, direction: number) => {
    if (scale !== 'shutter') return normalize(next + direction * step);
    return direction > 0 ? positions.find(position => position > next && !closeEnough(position, next)) ?? max : [...positions].reverse().find(position => position < next && !closeEnough(position, next)) ?? min;
  };
  confirmed.current = value; disabledRef.current = disabled; commitRef.current = onCommit;
  const clearLive = () => { if (liveTimer.current !== null) clearTimeout(liveTimer.current); liveTimer.current = null; };
  const setDraft = (next: number) => { targetRef.current = clamp(next); setTarget(targetRef.current); dirty.current = true; setError(null); setPhase('draft'); };
  const reset = (next = confirmed.current) => { targetRef.current = clamp(next); setTarget(targetRef.current); dirty.current = false; };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (liveTimer.current !== null) clearTimeout(liveTimer.current); }; }, []);
  useLayoutEffect(() => {
    // An earlier ACK may update the confirmed value while a newer value is queued.
    if (gesture.current || dirty.current) { if (submitted.current?.receipt) { submitted.current = null; setPhase('draft'); } return; }
    if (submitted.current) {
      const receipt = submitted.current.receipt;
      if (!receipt && (!closeEnough(value, submitted.current.value) || !closeEnough(targetRef.current, submitted.current.value))) return;
      submitted.current = null; setPhase(receipt?.applied === false ? 'failed' : 'confirmed');
      if (receipt?.applied === false) { failedValue.current = value; setError(receipt.cause instanceof Error ? receipt.cause.message : 'O iPhone não confirmou esse ajuste.'); }
      else { failedValue.current = null; setError(null); }
    } else if (failedValue.current !== null && !closeEnough(value, failedValue.current)) {
      // A native receipt may arrive after a transport timeout already rejected.
      failedValue.current = null; setPhase('confirmed'); setError(null);
    }
    targetRef.current = Math.max(min, Math.min(max, value)); setTarget(targetRef.current);
  }, [value, min, max, scale, receiptRevision]);
  const commit = (next = targetRef.current) => {
    if (disabledRef.current || !Number.isFinite(next)) return;
    next = normalize(next); targetRef.current = next; setTarget(next); dirty.current = false;
    if (submitted.current && closeEnough(next, submitted.current.value) || !submitted.current && closeEnough(next, confirmed.current)) { if (!submitted.current) setPhase('confirmed'); return; }
    const request = { id: ++sequence.current, value: next }; submitted.current = request; setPhase('pending'); setError(null);
    const settle = (applied: boolean, cause?: unknown) => {
      if (!mounted.current || submitted.current?.id !== request.id) return;
      // Parent device props and this receipt may be batched in the same render.
      // Reconcile before paint instead of resetting to the preceding render's value.
      submitted.current.receipt = { applied, cause }; setReceiptRevision(revision => revision + 1);
    };
    try { const result = commitRef.current(next); if (result) void result.then(() => settle(true), cause => settle(false, cause)); }
    catch (cause) { settle(false, cause); }
  };
  const scheduleLive = () => { if (liveTimer.current !== null) return; liveTimer.current = setTimeout(() => { liveTimer.current = null; commit(); }, 160); };
  const rangeKeys = ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'];
  const pending = phase === 'pending', changed = phase === 'draft' || pending;
  return <div className={`src-control${changed ? ' is-draft' : ''}${phase === 'failed' ? ' is-failed' : ''}`}>
    <span><label htmlFor={`${descriptionId}-range`}>{title}</label><output htmlFor={`${descriptionId}-range`}>{format(target)}</output></span>
    <input id={`${descriptionId}-range`} aria-label={title} aria-valuetext={format(target)} aria-describedby={descriptionId} type="range" value={toPosition(target)} min={rangeMin} max={rangeMax} step={scale === 'linear' ? 'any' : 1} disabled={disabled}
      onChange={event => { setDraft(fromPosition(Number(event.currentTarget.value))); scheduleLive(); }}
      onPointerDown={event => { gesture.current = true; try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Native range retains its normal gesture. */ } }}
      onPointerUp={event => { clearLive(); gesture.current = false; commit(fromPosition(Number(event.currentTarget.value))); }}
      onPointerCancel={() => { clearLive(); gesture.current = false; reset(submitted.current?.value ?? confirmed.current); setPhase(submitted.current ? 'pending' : 'confirmed'); }}
      onLostPointerCapture={() => { if (gesture.current) { clearLive(); gesture.current = false; commit(); } }}
      onKeyDown={event => { if (!rangeKeys.includes(event.key)) return; event.preventDefault(); const direction = ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key) ? -1 : 1; let next = event.key === 'Home' ? min : event.key === 'End' ? max : adjacent(targetRef.current, direction); if (event.key === 'PageDown' || event.key === 'PageUp') for (let index = 1; index < 10; index++) next = adjacent(next, direction); setDraft(next); }}
      onKeyUp={event => { if (rangeKeys.includes(event.key)) { clearLive(); commit(); } }} onBlur={() => { clearLive(); gesture.current = false; commit(); }} />
    <div className="src-control-bounds"><span>{format(min)}</span><span>{format(max)}</span></div>
    <small id={descriptionId} className={`src-control-receipt${pending ? ' is-pending' : ''}`} role="status">{pending ? <><Loader2 size={11} className="se-spin" />Aplicando · No iPhone: {format(value)}</> : phase === 'failed' ? <>Não aplicado · No iPhone: {format(value)}</> : <>No iPhone: {format(value)}</>}</small>
    {error && <small className="src-control-error" role="alert">{error}</small>}
  </div>;
}

/** The selected look and physical settings describe native ACKs, not CSS on the preview. */
export function StudioRemoteCameraControls({ state, disabled, onConfigure, onClose, initialTab = 'camera', onTab, recording }: {
  state: StudioRemoteView; disabled: boolean; onConfigure(patch: Partial<StudioRemoteConfiguration>): ConfigureResult; onClose(): void;
  initialTab?: StudioRemoteToolsTab;
  onTab?(tab: StudioRemoteToolsTab): void;
  recording?: { state: StudioCaptureState; guides: RecordingGuides; onGuides(patch: Partial<RecordingGuides>): void; onVideo(patch: StudioCaptureVideoPatch): void };
}) {
  const [tab, setTab] = useState<StudioRemoteToolsTab>(initialTab), [controlError, setControlError] = useState<string | null>(null), [imagePending, setImagePending] = useState(false);
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
  const fireConfigure = (operation: () => ConfigureResult) => {
    setControlError(null);
    const failed = (cause: unknown) => setControlError(cause instanceof Error ? cause.message : 'O iPhone não confirmou esse ajuste.');
    try { const result = operation(); if (result) void result.catch(failed); } catch (cause) { failed(cause); }
  };
  const mode = (title: string, key: string) => <div className="src-control-mode"><strong>{title}</strong><div>{[true, false].map(auto => <button type="button" key={String(auto)} aria-pressed={automatic(key) === auto} disabled={disabled} onClick={() => fireConfigure(() => onConfigure({ pro: { [key]: auto } }))}>{auto ? 'Auto' : 'Manual'}</button>)}</div></div>;
  const slider = (title: string, key: string, min: number, max: number, format: (value: number) => string, autoKey?: string, step = .01, scale: SliderScale = 'linear') => {
    const value = numeric(key); if (![value, min, max].every(Number.isFinite) || max <= min || scale !== 'linear' && min <= 0) return null;
    return <ProSlider key={key} title={title} value={value} min={min} max={max} step={step} scale={scale} disabled={disabled} format={format} onCommit={next => onConfigure({ pro: { ...(autoKey ? { [autoKey]: false } : {}), [key]: next } })} />;
  };
  const supportsImageGrade = device?.capabilities?.supportsImageGrade === true;
  const grade = device?.imageGrade && !validateStudioGrade(device.imageGrade).length ? device.imageGrade as StudioGrade : studioGrade();
  const imageDisabled = disabled || !supportsImageGrade;
  const gradeConfirmed = device?.imageGradeConfirmed === true && !imagePending;
  const confirmedGrade = useRef(grade), desiredGrade = useRef(grade), gradeSequence = useRef(0), gradeRequests = useRef(new Set<number>());
  confirmedGrade.current = grade;
  useEffect(() => {
    if (!gradeRequests.current.size) desiredGrade.current = grade;
    else if (Object.entries(desiredGrade.current).every(([key, value]) => value === grade[key as keyof StudioGrade])) { gradeRequests.current.clear(); desiredGrade.current = grade; setImagePending(false); }
  }, [grade]);
  const configureGrade = (patch: Partial<StudioGrade>): ConfigureResult => {
    const id = ++gradeSequence.current; gradeRequests.current.add(id); setImagePending(true);
    desiredGrade.current = { ...desiredGrade.current, ...patch };
    const settled = () => { gradeRequests.current.delete(id); if (!gradeRequests.current.size) { desiredGrade.current = confirmedGrade.current; setImagePending(false); } };
    try { const result = onConfigure({ imageGrade: { ...desiredGrade.current } }); if (result) return result.then(settled, cause => { settled(); throw cause; }); }
    catch (cause) { settled(); throw cause; }
  };
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
        <fieldset className="src-looks" disabled={imageDisabled}><legend>Look</legend>{(['natural', 'studio', 'cinematic'] as const).map(preset => <button type="button" key={preset} aria-pressed={grade.preset === preset} onClick={() => fireConfigure(() => configureGrade({ preset }))}><i className={`src-look-swatch src-look-swatch--${preset}`} /><span>{preset === 'natural' ? 'Natural' : preset === 'studio' ? 'Studio' : 'Cinema'}</span>{grade.preset === preset && <Check size={12} />}</button>)}</fieldset>
        <ProSlider title="Intensidade do filtro" value={grade.intensity} min={0} max={1} step={.05} disabled={imageDisabled} format={value => `${Math.round(value * 100)}%`} onCommit={intensity => configureGrade({ intensity })} />
        <section className="src-tone-controls"><div className="src-control-heading"><h3>Cor e luz</h3><p>Ajustes de aparência, aplicados na gravação.</p></div>{(['exposure', 'contrast', 'saturation', 'temperature'] as const).map(key => <ProSlider key={key} title={key === 'exposure' ? 'Exposição do look' : key === 'contrast' ? 'Contraste' : key === 'saturation' ? 'Saturação' : 'Temperatura do look'} value={grade[key]} min={key === 'exposure' ? -2 : -1} max={key === 'exposure' ? 2 : 1} step={.1} disabled={imageDisabled} format={value => `${value > 0 ? '+' : ''}${value.toFixed(1)}`} onCommit={value => configureGrade({ [key]: value })} />)}</section>
        <button type="button" className="src-secondary src-reset-look" disabled={imageDisabled} onClick={() => fireConfigure(() => configureGrade(studioGrade()))}><RotateCcw size={14} />Restaurar imagem</button>
        {supportsImageGrade && <p className={`src-look-receipt${gradeConfirmed ? ' is-confirmed' : ''}`} role="status">{gradeConfirmed ? <><Check size={13} />Imagem confirmada no iPhone.</> : <><Loader2 size={13} className="se-spin" />Aguardando a confirmação da imagem.</>}</p>}
      </>}
      {tab === 'camera' && <>
        <div className="src-control-heading"><h3>A câmera, nas suas mãos.</h3><p>Controles físicos da lente e do sensor, confirmados pelo iPhone.</p></div>
        <button type="button" className="src-secondary" disabled={disabled} onClick={() => fireConfigure(() => onConfigure({ cameraFacing: state.session?.configuration.cameraFacing === 'back' ? 'front' : 'back' }))}><Camera size={16} />{state.session?.configuration.cameraFacing === 'back' ? 'Usar câmera frontal' : 'Usar câmera traseira'}</button>
        {pro.supportsZoom === true && slider('Zoom', 'zoom', numeric('minZoom', 1), numeric('maxZoom', 1), value => `${value.toFixed(1)}×`, undefined, .01)}
        {pro.supportsExposure === true && <section>{mode('Exposição', 'autoExposure')}{!automatic('autoExposure') && <>{slider('ISO', 'iso', numeric('minISO'), numeric('maxISO'), value => Number(value.toFixed(2)).toString(), 'autoExposure', 1, 'log')}{slider('Obturador', 'shutterSeconds', numeric('minShutterSeconds'), numeric('maxShutterSeconds'), value => value > 0 ? shutterText(value) : '—', 'autoExposure', .000001, 'shutter')}</>}</section>}
        {pro.supportsWhiteBalance === true && <section>{mode('Balanço de branco', 'autoWhiteBalance')}{!automatic('autoWhiteBalance') && pro.supportsTemperatureAndTint === true && <>{slider('Temperatura da câmera', 'temperatureKelvin', 2000, 10000, value => `${Math.round(value)} K`, 'autoWhiteBalance', 50)}{slider('Matiz', 'whiteBalanceTint', -150, 150, value => `${value >= 0 ? '+' : ''}${Math.round(value)}`, 'autoWhiteBalance', 1)}</>}</section>}
        {pro.supportsFocus === true && <section>{mode('Foco', 'autoFocus')}{!automatic('autoFocus') && slider('Posição da lente', 'lensPosition', 0, 1, value => `${Math.round(value * 100)}%`, 'autoFocus', .01)}{pro.supportsFocusPoint === true && <p className="src-focus-tip"><Crosshair size={15} />Clique na imagem para focar nesse ponto.</p>}</section>}
        {!pro.supportsExposure && !pro.supportsWhiteBalance && !pro.supportsFocus && !pro.supportsZoom && <p className="src-controls-notice">Os controles disponíveis aparecerão quando o iPhone confirmar sua câmera.</p>}
      </>}
      {(tab === 'record' || tab === 'script') && recording && <StudioRecordingTools embedded initialTab={tab} state={recording.state} camera disabled={disabled || recording.state.videoControls?.busy === true} guides={recording.guides} onGuides={recording.onGuides} onVideo={recording.onVideo} onClose={onClose} />}
      {(controlError || device?.error) && <p className="src-error" role="alert">{controlError || String(device?.error)}</p>}
    </div>
  </aside>;
}

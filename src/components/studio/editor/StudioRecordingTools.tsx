import { useEffect, useRef, useState } from 'react';
import { Grid3X3, Palette, SlidersHorizontal, Timer, FileText, X } from 'lucide-react';
import { speechFollowerSupport } from '@/lib/studio/editor/teleprompter';
import type { StudioCaptureState } from '@/lib/studio/editor/capture';
import { studioGrade, type StudioGrade } from '../../../../shared/studio';

type VideoPatch = { zoom?: number; grade?: Partial<StudioGrade>; width?: number; height?: number; frameRate?: number };
export type RecordingGuides = { grid: boolean; mirrored: boolean; delay: number; script: string; scriptEnabled: boolean; scriptSpeed: number; scriptMode: 'voice' | 'timed' };

export function StudioRecordingTools({ state, camera, disabled, guides, onGuides, onVideo, onClose, initialTab }: {
  initialTab: 'image' | 'record' | 'script'; state: StudioCaptureState; camera: boolean; disabled: boolean; guides: RecordingGuides;
  onGuides(patch: Partial<RecordingGuides>): void; onVideo(patch: VideoPatch): void; onClose(): void;
}) {
  const [tab, setTab] = useState<'image' | 'record' | 'script'>(initialTab === 'image' && !camera ? 'record' : initialTab);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => setTab(initialTab === 'image' && !camera ? 'record' : initialTab), [initialTab, camera]);
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  const controls = state.videoControls, grade = controls?.grade ?? studioGrade('natural');
  const voiceSupport = speechFollowerSupport();
  const imageDisabled = disabled || state.phase !== 'ready' || !controls?.effects;
  return <aside ref={panel} className="se-recording-tools" aria-label="Configurações da gravação">
    <header><div><small>SEU ENQUADRAMENTO</small><h2>Configurações</h2></div><button className="se-recording-icon" aria-label="Fechar configurações" onClick={onClose}><X size={18} /></button></header>
    <div className="se-recording-tools-tabs" role="tablist" aria-label="Ajustes da gravação">
      {camera && <button role="tab" aria-selected={tab === 'image'} onClick={() => setTab('image')}><Palette size={15} />Imagem</button>}
      <button role="tab" aria-selected={tab === 'record'} onClick={() => setTab('record')}><SlidersHorizontal size={15} />Gravação</button>
      <button role="tab" aria-selected={tab === 'script'} onClick={() => setTab('script')}><FileText size={15} />Roteiro</button>
    </div>
    <div className="se-recording-tools-body" role="tabpanel">
      {tab === 'image' && <>
        {!controls && <p className="se-recording-tools-note">Abra a câmera para conferir os controles disponíveis.</p>}
        {controls && !controls.effects && <p className="se-recording-tools-note">Filtros e ajustes de cor não estão disponíveis neste navegador.</p>}
        {controls?.zoom && <label className="se-recording-tool-range"><span>Zoom <output>{controls.zoom.value.toFixed(1)}×</output></span><input aria-label="Zoom da câmera" type="range" dir="rtl" min={controls.zoom.min} max={controls.zoom.max} step={controls.zoom.step} value={controls.zoom.value} disabled={disabled || state.phase !== 'ready' || controls.zoom.mode === 'none'} onChange={event => onVideo({ zoom: Number(event.target.value) })} /><small>{controls.zoom.mode === 'hardware' ? 'Controle da câmera' : controls.zoom.mode === 'digital' ? 'Zoom digital · Recorta a imagem gravada' : 'Esta câmera não oferece zoom'}</small></label>}
        <fieldset disabled={imageDisabled} className="se-recording-filters"><legend>Filtro</legend>{(['natural', 'studio', 'cinematic'] as const).map(preset => <button key={preset} aria-pressed={grade.preset === preset} onClick={() => onVideo({ grade: { preset } })}><i className={preset} /><span>{preset === 'natural' ? 'Natural' : preset === 'studio' ? 'Studio' : 'Cinema'}</span></button>)}</fieldset>
        <label className="se-recording-tool-range"><span>Intensidade do filtro <output>{Math.round(grade.intensity * 100)}%</output></span><input aria-label="Intensidade do filtro" type="range" min="0" max="1" step="0.05" value={grade.intensity} disabled={imageDisabled} onChange={event => onVideo({ grade: { intensity: Number(event.target.value) } })} /></label>
        {(['exposure', 'contrast', 'saturation', 'temperature'] as const).map(name => {
          const label = name === 'exposure' ? 'Exposição' : name === 'contrast' ? 'Contraste' : name === 'saturation' ? 'Saturação' : 'Temperatura';
          return <label className="se-recording-tool-range" key={name}><span>{label}<output>{grade[name] > 0 ? '+' : ''}{grade[name].toFixed(1)}</output></span><input aria-label={label} type="range" min={name === 'exposure' ? '-2' : '-1'} max={name === 'exposure' ? '2' : '1'} step="0.1" value={grade[name]} disabled={imageDisabled} onChange={event => onVideo({ grade: { [name]: Number(event.target.value) } })} /></label>;
        })}
        <p className="se-recording-tools-note">Os ajustes de imagem entram no take gravado.</p>
        <button className="se-recording-button" disabled={imageDisabled} onClick={() => onVideo({ grade: studioGrade('natural'), zoom: controls?.zoom.min ?? 1 })}>Restaurar imagem</button>
      </>}
      {tab === 'record' && <>
        {camera && <><label className="se-recording-tool-select">Resolução<select aria-label="Resolução da gravação" disabled={disabled || !controls?.resolutions.length || state.phase !== 'ready'} value={`${state.width}x${state.height}`} onChange={event => { const [width, height] = event.target.value.split('x').map(Number); onVideo({ width, height }); }}>{state.width && state.height && !controls?.resolutions.some(value => value.width === state.width && value.height === state.height) && <option value={`${state.width}x${state.height}`}>{state.width} × {state.height}</option>}{controls?.resolutions.map(value => <option key={`${value.width}x${value.height}`} value={`${value.width}x${value.height}`}>{value.label}</option>)}</select></label>
          <label className="se-recording-tool-select">Quadros por segundo<select aria-label="Quadros por segundo" disabled={disabled || !controls?.frameRates.length || state.phase !== 'ready'} value={state.frameRate ?? ''} onChange={event => onVideo({ frameRate: Number(event.target.value) })}>{state.frameRate && !controls?.frameRates.includes(state.frameRate) && <option value={state.frameRate}>{Number(state.frameRate.toFixed(1))} fps</option>}{controls?.frameRates.map(value => <option key={value} value={value}>{value} fps</option>)}</select></label>
          <p className="se-recording-tools-note">{state.width && state.height ? `Entrada confirmada: ${state.width} × ${state.height}${state.frameRate ? ` · ${Number(state.frameRate.toFixed(1))} fps` : ''}.` : 'As opções aparecem depois de abrir a câmera.'}</p>
        </>}
        <label className="se-recording-tool-select"><span><Timer size={15} />Temporizador</span><select aria-label="Temporizador" disabled={disabled} value={guides.delay} onChange={event => onGuides({ delay: Number(event.target.value) })}><option value="0">Sem contagem</option><option value="3">3 segundos</option><option value="10">10 segundos</option></select></label>
        {camera && <><label className="se-recording-tool-toggle"><span><Grid3X3 size={15} />Grade de enquadramento</span><input type="checkbox" checked={guides.grid} disabled={disabled} onChange={event => onGuides({ grid: event.target.checked })} /></label><label className="se-recording-tool-toggle"><span>Espelhar prévia</span><input type="checkbox" checked={guides.mirrored} disabled={disabled} onChange={event => onGuides({ mirrored: event.target.checked })} /></label><p className="se-recording-tools-note">Grade e espelhamento ajudam a enquadrar; não alteram o vídeo salvo.</p></>}
      </>}
      {tab === 'script' && <>
        <label className="se-recording-tool-toggle"><span>Teleprompter</span><input type="checkbox" checked={guides.scriptEnabled} disabled={disabled} onChange={event => onGuides({ scriptEnabled: event.target.checked })} /></label>
        <textarea aria-label="Roteiro do teleprompter" placeholder="Cole seu roteiro ou tópicos aqui…" maxLength={30000} value={guides.script} disabled={disabled} onChange={event => onGuides({ script: event.target.value })} />
        <label className="se-recording-tool-select">Modo de leitura<select aria-label="Modo de leitura" value={guides.scriptMode} disabled={disabled} onChange={event => onGuides({ scriptMode: event.target.value as RecordingGuides['scriptMode'] })}><option value="voice">Acompanhar voz</option><option value="timed">Rolagem automática</option></select></label>
        {guides.scriptMode === 'voice' ? <>
          <p className="se-recording-tools-note">Avança conforme as palavras que você lê e espera nas suas pausas, usando o microfone selecionado.</p>
          <p className="se-recording-tools-note">O reconhecimento usa o serviço do navegador e pode enviar áudio para processamento. Nenhuma transcrição é salva no projeto.</p>
          {!voiceSupport.supported && <p className="se-recording-tools-note">{voiceSupport.reason}</p>}
        </> : <label className="se-recording-tool-range"><span>Velocidade da leitura<output>{guides.scriptSpeed} palavras/min</output></span><input aria-label="Velocidade da leitura" type="range" min="60" max="240" step="10" value={guides.scriptSpeed} disabled={disabled} onChange={event => onGuides({ scriptSpeed: Number(event.target.value) })} /></label>}
        <p className="se-recording-tools-note">Use Ensaiar na prévia ou comece a gravar para iniciar a leitura. Pause, retome ou reinicie quando precisar. O roteiro fica apenas na tela.</p>
      </>}

    </div>
  </aside>;
}

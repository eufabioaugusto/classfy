import { useId, useState } from 'react';
import { Camera, Check, ChevronDown, Layers3, Loader2, Monitor, PictureInPicture2, Settings2, X } from 'lucide-react';
import type { StudioCaptureScene, StudioCaptureScenes, StudioSceneConfigurationPatch } from '@/lib/studio/editor/sceneTypes';
import '@/styles/studio-scene-controls.css';

const scenes = [
  { id: 'camera' as const, label: 'Câmera', Icon: Camera },
  { id: 'screen' as const, label: 'Tela', Icon: Monitor },
  { id: 'screen-camera' as const, label: 'Tela + você', Icon: Layers3 },
];
const corners = [
  { label: 'Superior esquerdo', x: .18, y: .18 }, { label: 'Superior direito', x: .82, y: .18 },
  { label: 'Inferior esquerdo', x: .18, y: .82 }, { label: 'Inferior direito', x: .82, y: .82 },
];

/** Controls reflect the compositor's confirmed sources; they never open devices themselves. */
export function StudioSceneControls({ state, disabled, recording, onScene, onPrepareScreen, onConfigure, director }: {
  state: StudioCaptureScenes; disabled: boolean; recording: boolean;
  onScene(scene: StudioCaptureScene): void; onPrepareScreen(): void; onConfigure(patch: StudioSceneConfigurationPatch): void;
  director?: { supported: boolean; isOpen: boolean; error?: string | null; onOpen(): void };
}) {
  const [expanded, setExpanded] = useState(false);
  const directorHintId = useId();
  const available = (scene: StudioCaptureScene) => scene === 'camera' ? state.cameraReady : scene === 'screen' ? state.screenReady : state.cameraReady && state.screenReady;
  const blocked = disabled || state.preparingScreen;
  return <section className={`se-scenes${recording ? ' is-recording' : ''}`} aria-label="Cenas da gravação">
    <div className="se-scenes-row">
      <div className="se-scenes-choices" role="group" aria-label="Alternar cena">
        {scenes.map(({ id, label, Icon }, index) => <button type="button" key={id} aria-label={`Cena ${index + 1}: ${label}`} aria-keyshortcuts={String(index + 1)} aria-pressed={state.selected === id} disabled={blocked || !available(id)} onClick={() => { if (!blocked && available(id)) onScene(id); }}>
          <span className={`se-scene-thumbnail ${id}`} aria-hidden="true"><Icon size={21} /><small>{index + 1}</small>{id === 'screen-camera' && <i />}{state.selected === id && <Check className="se-scene-check" size={12} />}</span><strong>{label}</strong>
        </button>)}
      </div>
      <div className="se-scenes-actions">
        {!recording && <button className="se-scene-source" type="button" disabled={blocked} onClick={() => { if (!blocked) onPrepareScreen(); }}>{state.preparingScreen ? <Loader2 className="se-spin" size={16} /> : <Monitor size={16} />}<span>{state.preparingScreen ? 'Escolhendo tela…' : state.screenReady ? 'Trocar tela' : 'Compartilhar tela'}</span></button>}
        <button className="se-scenes-icon" type="button" title="Ajustar composição" aria-label="Ajustar composição" aria-expanded={expanded} disabled={blocked || !state.cameraReady} onClick={() => setExpanded(value => !value)}><Settings2 size={18} /></button>
        {director?.supported && <button className="se-scene-floating" type="button" aria-label={director.isOpen ? 'Mostrar prévia flutuante' : 'Abrir prévia flutuante'} aria-describedby={state.screenReady ? directorHintId : undefined} aria-pressed={director.isOpen} disabled={blocked} onClick={() => { if (!blocked) director.onOpen(); }}><PictureInPicture2 size={18} aria-hidden="true" /><span>{director.isOpen ? 'Mostrar prévia' : 'Prévia flutuante'}</span></button>}
      </div>
    </div>
    {!recording && <div className="se-scenes-source-state"><span><i className={state.cameraReady ? 'available' : ''} />Câmera {state.cameraReady ? 'pronta' : 'indisponível'}</span><span title={state.screenName ?? undefined}><i className={state.screenReady ? 'available' : ''} />{state.screenReady ? state.screenName || 'Tela compartilhada' : 'Tela não compartilhada'}</span><small>Cenas e transições entram no take.</small></div>}
    {state.screenReady && director && <p id={directorHintId} className="se-scenes-floating-hint">{director.supported ? 'Leve sua câmera e os controles para a aba que você vai explicar.' : 'A prévia flutuante está disponível em versões compatíveis do Chrome e Edge no computador.'}</p>}
    {director?.error && <p className="se-scenes-warning" role="status">{director.error}</p>}
    {state.error && <p className="se-scenes-warning" role="status">{state.error}</p>}
    {expanded && <div className="se-scenes-settings" aria-label="Composição das cenas" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setExpanded(false); } }}>
      <header><strong>Câmera sobre a tela</strong><button type="button" className="se-scenes-icon" aria-label="Fechar ajustes de cenas" onClick={() => setExpanded(false)}><X size={16} /></button></header>
      <div className="se-scenes-settings-fields">
        <fieldset disabled={blocked || !state.cameraReady}><legend>Posição</legend><div className="se-scenes-corners">{corners.map(corner => <button type="button" key={corner.label} aria-label={`Câmera no canto ${corner.label.toLowerCase()}`} aria-pressed={(state.position.x < .5) === (corner.x < .5) && (state.position.y < .5) === (corner.y < .5)} onClick={() => { if (!blocked && state.cameraReady) onConfigure({ position: { x: corner.x, y: corner.y } }); }}><i style={{ left: corner.x < .5 ? '5px' : undefined, right: corner.x > .5 ? '5px' : undefined, top: corner.y < .5 ? '5px' : undefined, bottom: corner.y > .5 ? '5px' : undefined }} /></button>)}</div></fieldset>
        <label className="se-scenes-size"><span>Tamanho da câmera</span><input type="range" aria-label="Tamanho da câmera na cena" min="0.14" max="0.5" step="0.01" value={state.size} disabled={blocked || !state.cameraReady} onChange={event => { if (!blocked && state.cameraReady) onConfigure({ size: Number(event.target.value) }); }} /></label>
        <label className="se-scenes-transition"><span>Troca de cena</span><div><select aria-label="Transição entre cenas" value={state.transition} disabled={blocked} onChange={event => { if (!blocked) onConfigure({ transition: event.target.value as 'cut' | 'fade' }); }}><option value="cut">Corte direto</option><option value="fade">Fade suave</option></select><ChevronDown size={14} aria-hidden="true" /></div></label>
      </div>
    </div>}
  </section>;
}

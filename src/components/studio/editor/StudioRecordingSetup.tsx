import { useId, type ReactNode } from 'react';
import { ArrowRight, Camera, Crown, Loader2, Mic, Monitor, Radio, ShieldCheck, Smartphone } from 'lucide-react';
import type { StudioKind } from '../../../../shared/studio';
import '@/styles/studio-recording-setup.css';

export type StudioRecordingLayout = 'camera' | 'screen' | 'scenes';
export type StudioRecordingCameraSource = 'computer' | 'iphone';

export interface StudioRecordingSetupProps {
  kind: StudioKind;
  liveSelected: boolean;
  mode: 'camera' | 'screen' | 'scenes' | 'remote';
  remoteScenes: boolean;
  title: string;
  formatLocked?: boolean;
  disabled?: boolean;
  openDisabled?: boolean;
  canUseScenes: boolean;
  premiumLoading?: boolean;
  cta: string;
  onFormat: (format: StudioKind | 'live') => void;
  onLayout: (layout: StudioRecordingLayout) => void;
  onCameraSource: (source: StudioRecordingCameraSource) => void;
  onTitle: (title: string) => void;
  onOpen: () => void;
  recovery?: ReactNode;
  error?: string | null;
  preview?: ReactNode;
  devices?: ReactNode;
  tools?: ReactNode;
  context?: string | null;
  preparing?: boolean;
  ready?: boolean;
  onCancelPreparation?: () => void;
}

const formats = [
  { value: 'aula', name: 'Aula', Icon: Monitor },
  { value: 'short', name: 'Short', Icon: Smartphone },
  { value: 'podcast', name: 'Podcast', Icon: Mic },
  { value: 'live', name: 'Live', Icon: Radio },
] as const;

function PremiumBadge() {
  return <span className="srs-premium" title="Premium"><Crown size={13} fill="currentColor" aria-hidden="true" /><span>Premium</span></span>;
}

/** Presentational preparation surface. Capture and its lifecycle belong to the workspace. */
export function StudioRecordingSetup({
  kind, liveSelected, mode, remoteScenes, title, formatLocked = false, disabled = false, openDisabled = false,
  canUseScenes, premiumLoading = false, cta, onFormat, onLayout, onCameraSource, onTitle, onOpen, recovery, error,
  preview, devices, tools, context, preparing = false, ready = false, onCancelPreparation,
}: StudioRecordingSetupProps) {
  const id = useId();
  const layout: StudioRecordingLayout = mode === 'remote' ? remoteScenes ? 'scenes' : 'camera' : mode;
  const iphone = mode === 'remote';
  const video = !liveSelected && kind !== 'podcast';
  const portrait = video && kind === 'short';
  const placeholder = kind === 'aula' ? 'Nova aula' : kind === 'short' ? 'Novo short' : 'Novo podcast';
  const CaptureIcon = liveSelected ? Radio : kind === 'podcast' ? Mic : layout === 'screen' ? Monitor : iphone ? Smartphone : Camera;
  const emptyTitle = liveSelected ? 'Prepare sua transmissão.' : kind === 'podcast' ? 'Confira sua voz.' : layout === 'screen' ? 'Sua apresentação começa aqui.' : iphone ? 'Seu iPhone é a câmera.' : 'Encontre seu enquadramento.';
  const emptyDescription = liveSelected ? 'Configure a sala antes de entrar ao vivo.' : kind === 'podcast' ? 'Ative o microfone para acompanhar o áudio antes de gravar.' : layout === 'screen' ? 'Compartilhe uma tela ou aba para conferir a cena.' : iphone ? 'Conecte o iPhone para ver a cena e ajustar a câmera.' : 'Ative a câmera para ver a cena antes de gravar.';
  const guidance = context ?? (liveSelected ? 'Você controla quando a transmissão começa.' : kind === 'podcast' ? 'Escolha seu microfone e confira o áudio.' : layout === 'scenes' ? 'Alterne entre câmera, tela e os dois juntos durante a gravação.' : portrait ? 'Short em 9:16. Confira o enquadramento vertical.' : 'Aula em 16:9. Confira o enquadramento horizontal.');

  return <main className={`srs-setup${portrait ? ' is-portrait' : ''}${!video ? ' is-audio' : ''}${ready ? ' is-ready' : ''}${preparing ? ' is-preparing' : ''}`}>
    <div className="srs-workbench">
      <aside className="srs-configuration" aria-label="Configuração da gravação">
        <header className="srs-heading">
          <div><span>CLASSFY STUDIO</span><h1>Prepare sua gravação.</h1></div>
          {!liveSelected && <label className="srs-title-field" htmlFor={`${id}-title`}><span>Nome da gravação <small>Opcional</small></span><input id={`${id}-title`} aria-label="Nome da gravação" placeholder={placeholder} value={title} maxLength={160} disabled={disabled || formatLocked} onChange={event => onTitle(event.target.value)} /></label>}
        </header>

        <div className="srs-options">
          <section className="srs-option-row" aria-labelledby={`${id}-format`}>
            <h2 id={`${id}-format`}>Formato</h2>
            <div className="srs-formats se-recording-formats" role="group" aria-labelledby={`${id}-format`}>
              {formats.map(({ value, name, Icon }) => {
                const selected = value === (liveSelected ? 'live' : kind);
                return <button type="button" key={value} aria-label={name} aria-pressed={selected} className={selected ? 'selected' : ''} disabled={disabled || formatLocked} onClick={() => onFormat(value)}><Icon size={17} strokeWidth={1.7} aria-hidden="true" /><span>{name}</span></button>;
              })}
            </div>
          </section>
          {video && <>
            <section className="srs-option-row" aria-labelledby={`${id}-layout`}>
              <h2 id={`${id}-layout`}>Cena</h2>
              <div className="srs-scene-choices" role="group" aria-labelledby={`${id}-layout`}>
                <div className="srs-layouts">
                  <button type="button" aria-label="Só câmera" aria-pressed={layout === 'camera'} disabled={disabled} onClick={() => onLayout('camera')}><Camera size={17} strokeWidth={1.7} aria-hidden="true" /><span>Só câmera</span></button>
                  <button type="button" aria-label="Só tela" aria-pressed={layout === 'screen'} disabled={disabled} onClick={() => onLayout('screen')}><Monitor size={17} strokeWidth={1.7} aria-hidden="true" /><span>Só tela</span></button>
                </div>
                <button type="button" className={`srs-scenes-card${!canUseScenes ? ' is-locked' : ''}`} aria-label="Câmera e tela · Premium" aria-pressed={layout === 'scenes'} aria-haspopup={!canUseScenes ? 'dialog' : undefined} aria-busy={premiumLoading || undefined} disabled={disabled} title={premiumLoading ? 'Confirmando seu plano.' : canUseScenes ? 'Novo · Liberado no seu Premium. Alterne câmera, tela e tela com você.' : 'Disponível no Premium. Assine aqui e continue sua preparação.'} onClick={() => onLayout('scenes')}><span className="srs-scenes-icon" aria-hidden="true"><Monitor size={20} strokeWidth={1.7} /><Camera size={10} strokeWidth={2} /></span><span>Câmera e tela</span>{premiumLoading ? <span className="srs-scenes-badge" role="status"><Loader2 size={15} className="srs-spin" aria-hidden="true" /><span className="srs-visually-hidden">Confirmando plano</span></span> : canUseScenes ? <span className="srs-scenes-badge">Novo</span> : <PremiumBadge />}</button>
              </div>
            </section>
            {layout !== 'screen' && <section className="srs-option-row" aria-labelledby={`${id}-camera`}>
              <h2 id={`${id}-camera`}>Câmera</h2>
              <div className="srs-sources" role="group" aria-labelledby={`${id}-camera`}>
                <button type="button" aria-label="Computador" aria-pressed={!iphone} disabled={disabled} onClick={() => onCameraSource('computer')}><Camera size={17} strokeWidth={1.7} aria-hidden="true" /><span>Computador</span></button>
                <button type="button" aria-label="Meu iPhone · Premium" aria-pressed={iphone} disabled={disabled} onClick={() => onCameraSource('iphone')}><Smartphone size={17} strokeWidth={1.7} aria-hidden="true" /><span>Meu iPhone</span><PremiumBadge /></button>
              </div>
            </section>}
          </>}
        </div>
      </aside>

      <div className="srs-output">
        <section className={`srs-scene${portrait ? ' is-portrait' : ''}${!video ? ' is-audio' : ''}`} aria-label="Prévia e preparação">
          <div className="srs-scene-top"><p className="srs-context" aria-live="polite">{guidance}</p>{ready ? <span className="srs-state"><i />Pronto para gravar</span> : preparing ? <span className="srs-state is-working" role="status"><Loader2 size={14} className="srs-spin" />Preparando…</span> : null}</div>
          <div className="srs-stage" aria-busy={preparing}>
            <div className="srs-frame">
              {preview ? <div className="srs-preview-content">{preview}</div> : <div className="srs-empty-scene"><span className="srs-empty-icon" aria-hidden="true"><CaptureIcon size={31} strokeWidth={1.35} /></span><h2>{emptyTitle}</h2><p>{emptyDescription}</p></div>}
            </div>
            {tools && <div className="srs-scene-tools">{tools}</div>}
          </div>
          {devices && <div className="srs-devices">{devices}</div>}
        </section>

        <div className="srs-action">
          {error && <p className="srs-error" role="alert">{error}</p>}
          <div className="srs-action-row">
            {preparing && onCancelPreparation && <button type="button" className="srs-cancel" onClick={onCancelPreparation}>Cancelar</button>}
            <button type="button" className={`srs-open${ready ? ' is-record' : ''}`} disabled={disabled || openDisabled} onClick={onOpen}>{preparing ? <Loader2 size={18} className="srs-spin" aria-hidden="true" /> : ready && !liveSelected ? <i className="srs-record-dot" aria-hidden="true" /> : <CaptureIcon size={18} aria-hidden="true" />}<span>{liveSelected ? 'Preparar live' : cta}</span>{!ready && !preparing && <ArrowRight size={17} aria-hidden="true" />}</button>
          </div>
          <p className="srs-private"><ShieldCheck size={13} aria-hidden="true" /><span>{liveSelected ? 'Você só entra ao vivo quando estiver pronto.' : 'Sua prévia é privada. A gravação começa quando você escolher.'}</span></p>
        </div>
      </div>
    </div>
    {!liveSelected && recovery && <div className="srs-recovery">{recovery}</div>}
  </main>;
}

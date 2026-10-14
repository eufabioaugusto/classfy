import { useId, type ReactNode } from 'react';
import { ArrowRight, AudioLines, Camera, Check, Crown, Layers3, Mic, Monitor, Radio, ShieldCheck, Smartphone, UserRound } from 'lucide-react';
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
  cta: string;
  onFormat: (format: StudioKind | 'live') => void;
  onLayout: (layout: StudioRecordingLayout) => void;
  onCameraSource: (source: StudioRecordingCameraSource) => void;
  onTitle: (title: string) => void;
  onOpen: () => void;
  recovery?: ReactNode;
  error?: string | null;
}

const formats = [
  { value: 'aula', name: 'Aula', detail: 'Horizontal · 16:9', Icon: Monitor },
  { value: 'short', name: 'Short', detail: 'Vertical · 9:16', Icon: Smartphone },
  { value: 'podcast', name: 'Podcast', detail: 'Somente áudio', Icon: Mic },
  { value: 'live', name: 'Live', detail: 'Transmissão ao vivo', Icon: Radio },
] as const;

function PremiumBadge() {
  return <span className="srs-premium"><Crown size={10} aria-hidden="true" />Premium</span>;
}

function StepHeading({ number, title, hint, id }: { number: number; title: string; hint?: string; id: string }) {
  return <div className="srs-step-heading"><span aria-hidden="true">{number}</span><div><h2 id={id}>{title}</h2>{hint && <p>{hint}</p>}</div></div>;
}

/** A composition illustration; no media is opened or represented as a live preview. */
function Composition({ kind, layout, iphone, live }: { kind: StudioKind; layout: StudioRecordingLayout; iphone: boolean; live: boolean }) {
  const audio = !live && kind === 'podcast';
  return <div className={`srs-composition${audio ? ' is-audio' : ''}${!live && kind === 'short' ? ' is-portrait' : ''}${live ? ' is-live' : ''}`} aria-hidden="true">
    <span className="srs-preview-type">{live ? <><Radio size={12} />Ao vivo</> : audio ? <><AudioLines size={12} />Áudio</> : <>{kind === 'short' ? '9:16' : '16:9'}</>}</span>
    {live ? <div className="srs-live-art"><Radio size={44} strokeWidth={1.25} /><span>Sua sala de transmissão</span><div><i /><i /><i /></div></div>
      : audio ? <div className="srs-audio-art"><div>{[12, 23, 38, 25, 53, 70, 43, 64, 85, 53, 34, 67, 44, 25, 50, 29, 15].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div><span>Sua voz em destaque</span></div>
        : <div className={`srs-frame is-${layout}`}>
          {layout === 'camera' ? <div className="srs-camera-art"><UserRound size={72} strokeWidth={.85} /><span>{iphone ? 'Câmera do iPhone' : 'Sua câmera'}</span><i /><i /><i /><i /></div>
            : <div className="srs-screen-art"><div className="srs-window-bar"><i /><i /><i /><span /></div><div className="srs-window-content"><b /><div><i /><i /><i /></div></div><span>{layout === 'scenes' && iphone ? 'Sua tela + iPhone' : 'Sua tela'}</span>{layout === 'scenes' && <div className="srs-picture-in-picture"><UserRound size={29} strokeWidth={1.2} /></div>}</div>}
        </div>}
    <span className="srs-illustration-label">{live ? 'Configure antes de entrar ao vivo' : audio ? 'Confira o microfone na próxima etapa' : 'Ilustração do enquadramento'}</span>
  </div>;
}

export function StudioRecordingSetup({ kind, liveSelected, mode, remoteScenes, title, formatLocked = false, disabled = false, openDisabled = false, canUseScenes, cta, onFormat, onLayout, onCameraSource, onTitle, onOpen, recovery, error }: StudioRecordingSetupProps) {
  const id = useId();
  const layout: StudioRecordingLayout = mode === 'remote' ? remoteScenes ? 'scenes' : 'camera' : mode;
  const iphone = mode === 'remote';
  const video = !liveSelected && kind !== 'podcast';
  const format = formats.find(item => item.value === (liveSelected ? 'live' : kind))!;
  const placeholder = kind === 'aula' ? 'Nova aula' : kind === 'short' ? 'Novo short' : 'Novo podcast';
  const contentLabel = layout === 'camera' ? 'Só câmera' : layout === 'screen' ? 'Só tela' : 'Câmera e tela';
  const OpenIcon = liveSelected ? Radio : kind === 'podcast' ? Mic : layout === 'screen' ? Monitor : iphone ? Smartphone : Camera;

  return <main className="srs-setup">
    <header className="srs-heading"><span>CLASSFY STUDIO</span><h1>Prepare sua gravação.</h1><p>Escolha como seu conteúdo vai aparecer. Depois, confira tudo antes de gravar.</p></header>
    <div className="srs-grid">
      <div className="srs-settings">
        <section className="srs-step" aria-labelledby={`${id}-format`}>
          <StepHeading number={1} title="Qual é o formato?" id={`${id}-format`} />
          <div className="srs-formats se-recording-formats" role="group" aria-labelledby={`${id}-format`}>
            {formats.map(({ value, name, detail, Icon }) => {
              const selected = value === (liveSelected ? 'live' : kind);
              return <button type="button" key={value} aria-label={name} aria-pressed={selected} className={selected ? 'selected' : ''} disabled={disabled || formatLocked} onClick={() => onFormat(value)}><Icon className="srs-format-icon" size={21} strokeWidth={1.65} aria-hidden="true" /><strong>{name}</strong><small>{detail}</small>{selected && <Check className="srs-option-check" size={15} aria-hidden="true" />}</button>;
            })}
          </div>
        </section>

        {video && <>
          <section className="srs-step" aria-labelledby={`${id}-layout`}>
            <StepHeading number={2} title="O que vai aparecer?" hint="O microfone acompanha todas as opções." id={`${id}-layout`} />
            <div className="srs-layouts" role="group" aria-labelledby={`${id}-layout`}>
              <button type="button" aria-label="Só câmera" aria-pressed={layout === 'camera'} disabled={disabled} onClick={() => onLayout('camera')}><span className="srs-layout-art is-camera" aria-hidden="true"><UserRound size={22} strokeWidth={1.4} /></span><strong>Só câmera</strong><small>Você em destaque</small>{layout === 'camera' && <Check className="srs-option-check" size={15} aria-hidden="true" />}</button>
              <button type="button" aria-label="Só tela" aria-pressed={layout === 'screen'} disabled={disabled} onClick={() => onLayout('screen')}><span className="srs-layout-art is-screen" aria-hidden="true"><Monitor size={24} strokeWidth={1.4} /></span><strong>Só tela</strong><small>Apresente uma tela ou aba</small>{layout === 'screen' && <Check className="srs-option-check" size={15} aria-hidden="true" />}</button>
              <button type="button" aria-label="Câmera e tela · Premium" aria-pressed={layout === 'scenes'} disabled={disabled} title={canUseScenes ? 'Alterne câmera, tela e tela com você.' : 'Gravação com cenas disponível no Premium.'} onClick={() => onLayout('scenes')}><span className="srs-layout-art is-scenes" aria-hidden="true"><Monitor size={24} strokeWidth={1.4} /><UserRound size={13} strokeWidth={1.7} /></span><strong>Câmera e tela</strong><small>Alterne as cenas ao gravar</small><PremiumBadge />{layout === 'scenes' && <Check className="srs-option-check" size={15} aria-hidden="true" />}</button>
            </div>
            {layout === 'scenes' && <p className="srs-context-note"><Layers3 size={14} aria-hidden="true" />Na gravação, alterne entre você, sua tela e os dois juntos.</p>}
          </section>

          {layout !== 'screen' && <section className="srs-step" aria-labelledby={`${id}-camera`}>
            <StepHeading number={3} title="Qual câmera você quer usar?" id={`${id}-camera`} />
            <div className="srs-sources" role="group" aria-labelledby={`${id}-camera`}>
              <button type="button" aria-label="Computador" aria-pressed={!iphone} disabled={disabled} onClick={() => onCameraSource('computer')}><span className="srs-source-icon" aria-hidden="true"><Camera size={21} strokeWidth={1.65} /></span><span className="srs-source-copy"><strong>Computador</strong><small>Webcam integrada ou conectada</small></span>{!iphone && <Check className="srs-source-check" size={16} aria-hidden="true" />}</button>
              <button type="button" aria-label="Meu iPhone · Premium" aria-pressed={iphone} disabled={disabled} onClick={() => onCameraSource('iphone')}><span className="srs-source-icon" aria-hidden="true"><Smartphone size={22} strokeWidth={1.65} /></span><span className="srs-source-copy"><strong>Meu iPhone <PremiumBadge /></strong><small>Conecte e controle pelo computador</small></span>{iphone && <Check className="srs-source-check" size={16} aria-hidden="true" />}</button>
            </div>
          </section>}
        </>}

        {!video && <section className="srs-simple-state" aria-label={liveSelected ? 'Como preparar sua live' : 'Como gravar seu podcast'}><span>{liveSelected ? <Radio size={24} strokeWidth={1.5} /> : <Mic size={24} strokeWidth={1.5} />}</span><div><h2>{liveSelected ? 'Tudo pronto antes de entrar ao vivo.' : 'O foco está na sua voz.'}</h2><p>{liveSelected ? 'Na sala de Live, prepare o título, a capa e seus dispositivos antes de começar a transmissão.' : 'Na próxima etapa, escolha seu microfone e confira o áudio antes de começar a gravar.'}</p></div></section>}

        {!liveSelected && <label className="srs-title-field" htmlFor={`${id}-title`}><span>Nome da gravação <small>Opcional</small></span><input id={`${id}-title`} aria-label="Nome da gravação" placeholder={placeholder} value={title} maxLength={160} disabled={disabled || formatLocked} onChange={event => onTitle(event.target.value)} /><small>Você pode dar um nome ao conteúdo depois.</small></label>}
        {!liveSelected && recovery && <div className="srs-recovery">{recovery}</div>}
      </div>

      <aside className="srs-summary" aria-label="Resumo da gravação">
        <div className="srs-summary-top"><span>{liveSelected ? 'SUA LIVE' : 'SUA GRAVAÇÃO'}</span><span className="srs-summary-format">{format.name}</span></div>
        <Composition kind={kind} layout={layout} iphone={iphone} live={liveSelected} />
        <div className="srs-summary-details"><h2>{liveSelected ? 'Prepare para entrar ao vivo' : kind === 'podcast' ? 'Seu podcast começa aqui' : layout === 'scenes' ? 'Você e seu conteúdo, juntos' : layout === 'screen' ? 'Sua apresentação em destaque' : 'Você em destaque'}</h2>
          <dl><div><dt>Formato</dt><dd>{liveSelected ? 'Ao vivo' : kind === 'podcast' ? 'Áudio' : kind === 'short' ? 'Vertical · 9:16' : 'Horizontal · 16:9'}</dd></div>{video && <><div><dt>Imagem</dt><dd>{contentLabel}</dd></div>{layout !== 'screen' && <div><dt>Câmera</dt><dd>{iphone ? 'Meu iPhone' : 'Computador'}</dd></div>}</>}<div><dt>{liveSelected ? 'Configuração' : 'Áudio'}</dt><dd>{liveSelected ? 'Na sala de Live' : 'Microfone'}</dd></div></dl>
        </div>
        <div className="srs-summary-action">{error && <p className="srs-error" role="alert">{error}</p>}<button type="button" className="srs-open" disabled={disabled || openDisabled} onClick={onOpen}><OpenIcon size={17} aria-hidden="true" /><span>{liveSelected ? 'Preparar live' : cta}</span><ArrowRight size={17} aria-hidden="true" /></button><p>{liveSelected ? 'Você só entra ao vivo quando estiver pronto.' : kind === 'podcast' ? 'Confira o áudio antes de gravar.' : 'Confira imagem e áudio antes de gravar.'}</p></div>
        <div className="srs-private"><ShieldCheck size={14} aria-hidden="true" /><span>{liveSelected ? 'Você controla quando a transmissão começa.' : 'Seus takes são privados e salvos neste navegador.'}</span></div>
      </aside>
    </div>
  </main>;
}

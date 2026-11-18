import { StudioColorPicker } from './StudioColorPicker';
import { useRef, useState } from 'react';
import { StudioFontPicker } from './StudioFontPicker';
import { StudioSelect } from './StudioSelect';
import { studioSliderFill } from './studioSliderFill';
import { AlignCenter, AlignLeft, AlignRight, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, Gauge, Move, Scan, Volume2, Wrench, Music2, AudioLines, Droplet, Palette, Captions, Copy, FlipHorizontal2, FlipVertical2, RotateCcw, Scissors, ScanFace, Sparkles, Trash2 } from 'lucide-react';
import { studioGrade, studioSeconds, type StudioRecipeClip } from '../../../../shared/studio';

export type StudioInspectorTrackProperty = 'style' | 'transform' | 'opacity';
type Props = { owner?: string; getColorCanvas?(): HTMLCanvasElement | null; clip?: StudioRecipeClip; disabled?: boolean; canSplit: boolean; canApplyTrack?: boolean; onApplyTrack?(property: StudioInspectorTrackProperty): void; outputHeight: number; comparing?: boolean; onExtractAudio?(): void; onRemovePauses?(): void; onCompare?(): void; onSignature?(): void; onEnhance?(): void; onPortrait?(): void; onDraft(patch: Record<string, unknown>): void; onCommit(): void; onRemove(): void; onDuplicate(): void; onSplit(): void };
export function StudioDesktopInspector({ owner = '', getColorCanvas, clip, disabled, canSplit, canApplyTrack, onApplyTrack, outputHeight, comparing, onExtractAudio, onRemovePauses, onCompare, onSignature, onEnhance, onPortrait, onDraft, onCommit, onRemove, onDuplicate, onSplit }: Props) {
  const [textTab, setTextTab] = useState('style');
  const [soundTab, setSoundTab] = useState('volume');
  const [adjustmentTab, setAdjustmentTab] = useState('light');
  const volumes = useRef(new Map<string, number>());
  if (!clip) return <aside className="se-inspector"><header>Propriedades</header><div className="se-inspector-empty"><span>Selecione um elemento</span><p>Edite o enquadramento, o texto ou o áudio da montagem.</p></div></aside>;
  const grade = clip.grade ?? studioGrade(clip.effect), visual = clip.kind !== 'audio', text = !!clip.text;
  const immediate = (patch: Record<string, unknown>) => { onDraft(patch); onCommit(); };
  const numeric = (label: string, value: number, makePatch: (value: number) => Record<string, unknown>, min?: number, max?: number, step = .01) => <label className="se-field se-number"><span>{label}</span><input aria-label={label} type="number" disabled={disabled} value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0} min={min} max={max} step={step} onChange={e => { const next = e.target.valueAsNumber; if (Number.isFinite(next)) onDraft(makePatch(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next)))); }} onBlur={onCommit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>;
  const range = (label: string, value: number, makePatch: (value: number) => Record<string, unknown>, min: number, max: number, step = .01, format: (value: number) => string = value => `${Math.round(value * 100)}%`) => <label className="se-range"><span>{label}<output>{format(value)}</output></span><input type="range" className="se-slider" style={studioSliderFill(value, min, max)} aria-label={label} disabled={disabled} min={min} max={max} step={step} value={value} onChange={e => onDraft(makePatch(+e.target.value))} onPointerUp={onCommit} onPointerCancel={onCommit} onBlur={onCommit} onKeyUp={onCommit} /></label>;
  const applyToTrack = (property: StudioInspectorTrackProperty) => canApplyTrack && <button type="button" className="se-inspector-apply"
    disabled={disabled} onClick={() => onApplyTrack?.(property)}>Aplicar à faixa</button>;
  const color = (label: string, value: string, field: 'color' | 'backgroundColor' | 'secondaryColor') =>
    <StudioColorPicker key={`${clip.id}:${field}`} label={label} value={value} disabled={disabled} getCanvas={getColorCanvas}
      onDraft={color => onDraft({ text: { [field]: color } })} onCommit={onCommit} />;
  return <aside className="se-inspector"><header>{text ? clip.kind === 'caption' ? 'Legenda' : 'Texto' : clip.kind === 'audio' ? 'Áudio' : 'Imagem e vídeo'}<span className="se-inspector-tools"><button className="se-icon" aria-label="Duplicar elemento" disabled={disabled} onClick={onDuplicate}><Copy size={16} /></button><button className="se-icon" aria-label="Dividir no cursor" disabled={disabled || !canSplit} onClick={onSplit}><Scissors size={16} /></button><button className="se-icon se-danger" aria-label="Excluir elemento" disabled={disabled} onClick={onRemove}><Trash2 size={16} /></button></span></header>
    <div className="se-inspector-content">
      {text && <section><h3><Captions size={16} />{clip.kind === 'caption' ? 'Texto da legenda' : 'Conteúdo'}{applyToTrack('style')}</h3><textarea aria-label="Texto da cena" data-studio-text-input value={clip.text!.content} disabled={disabled} onChange={e => onDraft({ text: { content: e.target.value } })} onBlur={onCommit} />
        <div className="se-inspector-segments se-text-tabs" role="group" aria-label="Propriedades do texto">
          {[['style', 'Estilo'], ['highlight', 'Destaque'], ['motion', 'Animação'], ['effects', 'Efeitos']].map(([id, label]) =>
            <button key={id} type="button" aria-pressed={textTab === id} onClick={() => setTextTab(id)}>{label}</button>)}
        </div>
        {textTab === 'style' && <>
          <div className="se-inspector-grid se-type-grid">
            <StudioFontPicker owner={owner} disabled={disabled} value={clip.text!.fontFamily} onChange={fontFamily => immediate({ text: { fontFamily } })} />
            {numeric('Tamanho do texto', clip.text!.fontSize * outputHeight, value => ({ text: { fontSize: value / outputHeight } }), 8, outputHeight, 1)}
          </div>
          {color('Cor do texto', clip.text!.color, 'color')}
          <div className="se-field">
            <span>Alinhamento</span>
            <div className="se-inspector-segments" role="group" aria-label="Alinhamento do texto">
              {([['left', 'Esquerda', AlignLeft], ['center', 'Centro', AlignCenter], ['right', 'Direita', AlignRight]] as const).map(([alignment, label, Icon]) =>
                <button key={alignment} type="button" title={label} aria-label={label} aria-pressed={clip.text!.alignment === alignment} disabled={disabled}
                  onClick={() => immediate({ text: { alignment } })}><Icon size={17} /></button>)}
            </div>
          </div>
          <div className="se-field"><span>Maiúsculas e minúsculas</span>
            <div className="se-inspector-segments" role="group" aria-label="Maiúsculas e minúsculas">
              {([['original', 'Original', 'Original'], ['upper', 'Maiúsculas', 'AA'], ['lower', 'Minúsculas', 'aa'], ['title', 'Iniciais maiúsculas', 'Aa']] as const).map(([casing, label, preview]) =>
                <button key={casing} type="button" title={label} aria-label={label} disabled={disabled}
                  aria-pressed={(clip.text!.casing ?? 'original') === casing} onClick={() => immediate({ text: { casing } })}>{preview}</button>)}
            </div>
          </div>
          {range('Altura da linha', clip.text!.lineHeight ?? 1.2, lineHeight => ({ text: { lineHeight } }), .7, 2, .05, value => value.toFixed(2))}
          {range('Espaçamento entre letras', clip.text!.letterSpacing ?? 0, letterSpacing => ({ text: { letterSpacing } }), -.1, .2)}
          {clip.kind === 'caption' && <label className="se-inspector-check"><input type="checkbox" disabled={disabled}
            checked={clip.text!.showPunctuation ?? true} onChange={event => immediate({ text: { showPunctuation: event.target.checked } })} />Mostrar pontuação</label>}
        </>}
        {textTab === 'highlight' && <>
          <div className="se-inspector-grid">{color('Cor secundária', clip.text!.secondaryColor ?? '#000000', 'secondaryColor')}
            {color('Cor do fundo do texto', clip.text!.backgroundColor, 'backgroundColor')}</div>
        <StudioSelect label="Estilo" disabled={disabled} value={clip.text!.decoration ?? 'none'} onChange={value => immediate({ text: { decoration: value } })} options={[['none', 'Simples'], ['outline', 'Contorno'], ['outline-inverse', 'Contorno invertido'], ['background', 'Bloco'], ['background-inverse', 'Bloco invertido']]} />
          {clip.text!.decoration?.startsWith('outline') && <>
            {range('Largura do contorno', clip.text!.outlineWidth ?? .08, outlineWidth => ({ text: { outlineWidth } }), 0, .2)}
            {range('Opacidade do contorno', clip.text!.outlineOpacity ?? 1, outlineOpacity => ({ text: { outlineOpacity } }), 0, 1)}
          </>}
        </>}
        {textTab === 'effects' && <StudioSelect label="Efeito" disabled={disabled} value={clip.text!.visualEffect ?? 'none'} onChange={value => immediate({ text: { visualEffect: value } })} options={[['none', 'Nenhum'], ['shadow-soft', 'Sombra suave'], ['shadow-strong', 'Sombra forte'], ['block', 'Destaque'], ['neon', 'Neon'], ['glow', 'Brilho'], ['halo', 'Halo']]} />}
        {textTab === 'motion' && <StudioSelect label="Animação" disabled={disabled} value={clip.text!.animation ?? 'none'} onChange={value => immediate({ text: { animation: value } })} options={[['none', 'Nenhuma'], ['typewriter', 'Máquina de escrever'], ['pop', 'Pop'], ['bounce', 'Salto'], ['fade', 'Aparecer'], ['zoom', 'Zoom'], ['slide-right', 'Deslizar']]} />}
      </section>}
      {visual && <section><h3><Move size={16} />Transformar{applyToTrack('transform')}</h3>
        {range('Escala', Math.max(clip.rect.width, clip.rect.height), value => {
          const factor = value / Math.max(clip.rect.width, clip.rect.height);
          const width = Math.max(.025, clip.rect.width * factor), height = Math.max(.025, clip.rect.height * factor);
          return { rect: { width, height, x: clip.rect.x + (clip.rect.width - width) / 2, y: clip.rect.y + (clip.rect.height - height) / 2 } };
        }, .025, 3)}
        <div className="se-inspector-grid">{numeric('X', clip.rect.x * 100, value => ({ rect: { x: value / 100 } }), -300, 300)}{numeric('Y', clip.rect.y * 100, value => ({ rect: { y: value / 100 } }), -300, 300)}{numeric('Largura', clip.rect.width * 100, value => ({ rect: { width: value / 100 } }), 2.5, 300)}{numeric('Altura', clip.rect.height * 100, value => ({ rect: { height: value / 100 } }), 2.5, 300)}</div>
        {numeric('Rotação', clip.rotationDegrees, value => ({ rotationDegrees: value }), -360, 360, 1)}
        <div className="se-inspector-segments" role="group" aria-label="Posição no quadro">
          {([
            ['Encostar à esquerda', AlignStartVertical, { x: 0 }],
            ['Centralizar na horizontal', AlignCenterVertical, { x: (1 - clip.rect.width) / 2 }],
            ['Encostar à direita', AlignEndVertical, { x: 1 - clip.rect.width }],
            ['Encostar no topo', AlignStartHorizontal, { y: 0 }],
            ['Centralizar na vertical', AlignCenterHorizontal, { y: (1 - clip.rect.height) / 2 }],
            ['Encostar embaixo', AlignEndHorizontal, { y: 1 - clip.rect.height }],
          ] as const).map(([label, Icon, rect]) => <button key={label} type="button" title={label} aria-label={label} disabled={disabled}
            onClick={() => immediate({ rect })}><Icon size={15} /></button>)}
        </div>
        <div className="se-inspector-segments se-inspector-flip" role="group" aria-label="Espelhamento">
          <button type="button" title="Espelhar horizontalmente" aria-label="Espelhar horizontalmente" aria-pressed={clip.flipHorizontal ?? false} disabled={disabled} onClick={() => immediate({ flipHorizontal: !clip.flipHorizontal })}><FlipHorizontal2 size={16} /></button>
          <button type="button" title="Espelhar verticalmente" aria-label="Espelhar verticalmente" aria-pressed={clip.flipVertical ?? false} disabled={disabled} onClick={() => immediate({ flipVertical: !clip.flipVertical })}><FlipVertical2 size={16} /></button>
        </div>
        <StudioSelect label="Enquadramento" disabled={disabled} value={clip.fit} onChange={value => immediate({ fit: value })} options={[['contain', 'Ajustar à área'], ['cover', 'Preencher a área']]} />
      </section>}
      {(clip.kind === 'video' || clip.kind === 'audio') && <>
        <section><h3><Volume2 size={16} />Som
          <button type="button" className={`se-effect-toggle se-inspector-sound ${clip.gain > 0 ? 'active' : ''}`}
            role="switch" aria-label="Som do clipe" aria-checked={clip.gain > 0} disabled={disabled}
            onClick={() => {
              if (clip.gain > 0) volumes.current.set(clip.id, clip.gain);
              immediate({ gain: clip.gain > 0 ? 0 : volumes.current.get(clip.id) ?? 1 });
            }}><span /></button>
        </h3>
          <div className="se-inspector-segments" role="group" aria-label="Ajustes de som">
            <button type="button" aria-pressed={soundTab === 'volume'} onClick={() => setSoundTab('volume')}>Volume</button>
            <button type="button" aria-pressed={soundTab === 'fade'} onClick={() => setSoundTab('fade')}>Entrada e saída</button>
          </div>
          {soundTab === 'volume'
            ? range('Volume do clipe', clip.gain, gain => ({ gain }), 0, 4, .01, gain => gain > 0 ? `${(20 * Math.log10(gain)).toFixed(1)} dB` : 'Mudo')
            : <div className="se-inspector-grid">
              {numeric('Fade de entrada (s)', studioSeconds(clip.fadeInTicks), value => ({ fadeInTicks: Math.round(value * 120000) }), 0, studioSeconds(clip.durationTicks - clip.fadeOutTicks), .1)}
              {numeric('Fade de saída (s)', studioSeconds(clip.fadeOutTicks), value => ({ fadeOutTicks: Math.round(value * 120000) }), 0, studioSeconds(clip.durationTicks - clip.fadeInTicks), .1)}
            </div>}
        </section>
        <section><h3><Gauge size={16} />Velocidade
          <output className="se-inspector-duration" aria-label="Duração do clipe">{studioSeconds(clip.durationTicks).toFixed(2)} s</output></h3>
          {range('Velocidade', clip.playbackRate ?? 1, playbackRate => ({ playbackRate }), .25, 4, .05, value => `${value.toFixed(2)}×`)}
          {(clip.playbackRate ?? 1) !== 1 && <p className="se-muted">A velocidade também altera o tom do áudio.</p>}
        </section>
      </>}
      {visual && <section><h3><Droplet size={16} />Opacidade{applyToTrack('opacity')}</h3>{range('Opacidade', clip.opacity, value => ({ opacity: value }), 0, 1)}</section>}
      {visual && !text && <section><h3><Scan size={16} />Máscara</h3>
        <StudioSelect label="Forma" disabled={disabled} value={clip.mask ?? 'none'} onChange={mask => immediate({ mask })}
          options={[['none', 'Nenhuma'], ['ellipse', 'Elipse'], ['rounded', 'Retângulo arredondado']]} />
      </section>}
      {visual && !text && <section><h3><Palette size={16} />Ajustar
        <button type="button" className="se-inspector-apply" disabled={disabled} onClick={() => immediate({ grade: studioGrade('natural'), effect: 'natural', enhancement: null })}>Redefinir</button></h3>
        <button className="se-button se-ai-action se-wide" disabled={disabled || !onEnhance} onClick={onEnhance}>Ajuste automático de luz e cor</button>
        <div className="se-preset-grid">{(['natural', 'studio', 'cinematic'] as const).map(preset => <button disabled={disabled} className={grade.preset === preset ? 'selected' : ''} key={preset} onClick={() => immediate({ grade: { ...grade, preset }, effect: preset })}>{preset === 'natural' ? 'Natural' : preset === 'studio' ? 'Studio' : 'Cinema'}</button>)}</div>
        <div className="se-inspector-segments" role="group" aria-label="Categorias de ajuste">
          <button type="button" aria-pressed={adjustmentTab === 'light'} onClick={() => setAdjustmentTab('light')}>Luz</button>
          <button type="button" aria-pressed={adjustmentTab === 'color'} onClick={() => setAdjustmentTab('color')}>Cor</button>
        </div>
        {adjustmentTab === 'light' ? <>
          {range('Intensidade', grade.intensity, intensity => ({ grade: { intensity } }), 0, 1)}
          {range('Exposição', grade.exposure, exposure => ({ grade: { exposure } }), -2, 2)}
          {range('Contraste', grade.contrast, contrast => ({ grade: { contrast } }), -1, 1)}
        </> : <>
          {range('Saturação', grade.saturation, saturation => ({ grade: { saturation } }), -1, 1)}
          {range('Temperatura', grade.temperature, temperature => ({ grade: { temperature } }), -1, 1)}
        </>}
      </section>}
      {visual && !text && <section className="se-magic-panel"><div className="se-magic-heading"><img src="/brand/classfy-icone-principal.svg" alt="" width={18} height={18} /><h3>Assinatura Classfy</h3></div><p className="se-muted">Você em foco. Fundo mais profundo, luz suave no rosto e cor de cinema.</p><button className="se-button se-ai-action se-magic-button se-wide" disabled={disabled || !onSignature} onClick={onSignature}><Sparkles size={16} />{clip.signature ? 'Refinar assinatura' : 'Aplicar assinatura'}</button>
        {clip.signature && <><div className="se-magic-result"><span>Luz no rosto</span><span>Fundo separado</span><span>Cor Classfy</span></div>{range('Intensidade da assinatura', clip.signature.strength, strength => ({ signature: { ...clip.signature!, strength } }), 0, 1)}{range('Suavidade do fundo', clip.signature.backgroundBlur, backgroundBlur => ({ signature: { ...clip.signature!, backgroundBlur } }), 0, 1)}{range('Luz do fundo', clip.signature.backgroundExposure, backgroundExposure => ({ signature: { ...clip.signature!, backgroundExposure } }), -2, 0, .05, value => `${value > 0 ? '+' : ''}${value.toFixed(2)} EV`)}{range('Luz no rosto', clip.signature.subjectExposure, subjectExposure => ({ signature: { ...clip.signature!, subjectExposure } }), -.5, 1, .05, value => `${value > 0 ? '+' : ''}${value.toFixed(2)} EV`)}<button className="se-text-button" disabled={disabled} onClick={() => immediate({ signature: null })}><RotateCcw size={12} />Remover assinatura</button></>}
        {clip.enhancement && <><div className="se-magic-result"><span>Luz</span><span>Cor</span><span>{clip.enhancement.analyzedFrames} {clip.enhancement.analyzedFrames === 1 ? 'quadro analisado' : 'quadros analisados'}</span></div>{range('Melhoria da cena', clip.enhancement.strength, strength => ({ enhancement: { ...clip.enhancement!, strength } }), 0, 1)}<button className="se-text-button" disabled={disabled} onClick={() => immediate({ enhancement: null })}><RotateCcw size={12} />Remover melhoria</button></>}
        <div className="se-portrait-heading"><ScanFace size={16} /><h3>Retoque natural</h3><button className={`se-effect-toggle ${clip.portrait ? 'active' : ''}`} role="switch" aria-label="Retoque natural" aria-checked={!!clip.portrait} disabled={disabled} onClick={() => clip.portrait ? immediate({ portrait: null }) : onPortrait?.()}><span /></button></div><p className="se-muted">Controle a suavização da pele. Use pouco para um acabamento natural ou aumente para um retoque intenso.</p>
        {clip.portrait && range('Suavização do rosto', clip.portrait.strength, strength => ({ portrait: { version: 2, strength } }), 0, 1)}
        {!!(clip.signature || clip.enhancement || clip.portrait || grade.preset !== 'natural' || grade.exposure || grade.contrast || grade.saturation || grade.temperature) && <button className={`se-button se-wide ${comparing ? 'active' : ''}`} aria-pressed={comparing ?? false} disabled={disabled} onClick={onCompare}>{comparing ? 'Voltar aos ajustes' : 'Comparar com original'}</button>}
      </section>}
      <section><h3><Wrench size={16} />Utilitários</h3>
        <div className="se-inspector-segments" role="group" aria-label="Ações do clipe">
          <button type="button" disabled={disabled || !canSplit} onClick={onSplit}><Scissors size={16} />Dividir</button>
          <button type="button" disabled={disabled} onClick={onDuplicate}><Copy size={16} />Duplicar</button>
          <button type="button" disabled={disabled} onClick={onRemove}><Trash2 size={16} />Excluir</button>
          {onExtractAudio && <button type="button" disabled={disabled} onClick={onExtractAudio}><Music2 size={16} />Extrair áudio</button>}
          {onRemovePauses && <button type="button" disabled={disabled} onClick={onRemovePauses}><AudioLines size={16} />Remover pausas</button>}
        </div>
        {visual && !text && <StudioSelect label="Movimento" disabled={disabled} value={clip.motion ?? 'none'} onChange={value => immediate({ motion: value })} options={[['none', 'Nenhum'], ['fade-in', 'Aparecer'], ['fade-out', 'Desaparecer'], ['zoom-in', 'Aproximar'], ['pulse', 'Pulso'], ['blink', 'Piscar']]} />}
      </section>
      <section><h3>Intervalo</h3><div className="se-inspector-grid"><span className="se-muted">Início {studioSeconds(clip.startTicks).toFixed(2)}s</span><span className="se-muted">Duração {studioSeconds(clip.durationTicks).toFixed(2)}s</span></div></section>
    </div>
  </aside>;
}

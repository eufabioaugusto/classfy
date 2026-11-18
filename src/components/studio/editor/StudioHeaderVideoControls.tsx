import { StudioToolbarPopover } from './StudioToolbarPopover';
import { Check, Scan, ZoomIn } from 'lucide-react';
import { studioCanvasRatios, type StudioCanvasRatio, type StudioOutputProfile, type StudioOutputSelection } from '../../../../shared/studio';
import type { StudioBrowserExportCapabilities } from '@/lib/studio/editor/export';
import { studioExportBitrate } from '@/lib/studio/editor/outputQuality';

const resolutions = [['original', 'Original'], ['720p', 'HD'], ['hd', 'FHD'], ['2k', '2K'], ['4k', '4K']] as const;
const rates = [['original', 'Original'], [24, '24'], [30, '30'], [60, '60']] as const;
const qualities = [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta']] as const;

export function studioCanvasRatioLabel(ratio: StudioCanvasRatio) {
  return studioCanvasRatios[ratio].join(':');
}

function Options<T extends string | number>({ label, choices, selected, onSelect, available }: {
  label: string; choices: readonly (readonly [T, string])[]; selected: T; onSelect(value: T): void; available?(value: T): boolean;
}) {
  return <fieldset className="se-video-options"><legend>{label}</legend><div>
    {choices.map(([value, name]) => <button key={value} type="button" aria-pressed={value === selected} disabled={available ? !available(value) : false} onClick={() => onSelect(value)}>{name}</button>)}
  </div></fieldset>;
}

export function StudioHeaderVideoControls({ zoom, onZoom, ratio, onRatio, output, onOutput, duration, capabilities, disabled, audioOnly }: {
  zoom: number | 'actual'; onZoom(value: number | 'actual'): void;
  ratio: StudioCanvasRatio; onRatio(value: StudioCanvasRatio): void;
  output: StudioOutputProfile; onOutput(patch: Partial<StudioOutputSelection>): void;
  duration: number; capabilities: StudioBrowserExportCapabilities | null; disabled: boolean; audioOnly: boolean;
}) {
  const fps = output.frameRateNumerator / output.frameRateDenominator;
  const resolution = output.selection?.resolution ?? 'original';
  const rate = output.selection?.frameRate ?? 'original';
  const quality = output.selection?.quality ?? 'medium';
  const size = duration * (studioExportBitrate(output.width, output.height, fps, quality) + 192000) / 8000000;
  if (audioOnly) return null;
  return <>
    <StudioToolbarPopover label="Zoom da prévia" icon={<ZoomIn size={18} />} disabled={disabled}>
        <div className="se-toolbar-popover-title"><strong>Zoom da prévia</strong><output>{zoom === 'actual' ? 'Tamanho real' : `${Math.round(zoom * 100)}%`}</output></div>
        <input type="range" min={25} max={400} step={1} value={zoom === 'actual' ? 100 : Math.round(zoom * 100)} aria-label="Ampliação da prévia" onChange={event => onZoom(+event.target.value / 100)} />
        <div className="se-zoom-presets"><button className="se-button" onClick={() => onZoom(1)}>Ajustar ao palco</button><button className="se-button" onClick={() => onZoom('actual')}>Tamanho real</button></div>
    </StudioToolbarPopover>
    <StudioToolbarPopover label="Proporção do palco" icon={<Scan size={18} />} disabled={disabled}>
        <div className="se-toolbar-popover-title"><strong>Proporção do palco</strong></div>
        <div className="se-ratio-options">
          {(Object.entries(studioCanvasRatios) as [StudioCanvasRatio, readonly [number, number]][]).map(([value, [w, h]]) => <button key={value} type="button" aria-pressed={ratio === value} onClick={() => onRatio(value)}>
            <span className="se-ratio-icon"><i style={{ width: w / Math.max(w, h) * 23, height: h / Math.max(w, h) * 23 }} /></span>
            <span>{w}:{h}</span>{ratio === value && <Check size={15} />}
          </button>)}
        </div>
    </StudioToolbarPopover>
    <StudioToolbarPopover label="Qualidade do vídeo" triggerClassName="se-quality-trigger" className="se-quality-popover" disabled={disabled} icon={<>
      <span>{resolution === 'original' ? 'AUTO' : resolutions.find(([value]) => value === resolution)?.[1]}</span><small>{Number(fps.toFixed(2))}</small>
    </>}>
        <div className="se-toolbar-popover-title"><strong>Qualidade do vídeo</strong><span>SDR</span></div>
        <Options label="Resolução" choices={resolutions} selected={resolution} onSelect={value => onOutput({ resolution: value })}
          available={value => value === 'original' || !!capabilities?.profiles.some(profile => profile.resolution === value && (rate === 'original' || profile.frameRate === rate))} />
        <Options label="Quadros por segundo" choices={rates} selected={rate} onSelect={value => onOutput({ frameRate: value })}
          available={value => value === 'original' || !!capabilities?.profiles.some(profile => profile.frameRate === value && (resolution === 'original' || profile.resolution === resolution))} />
        <Options label="Qualidade de compressão" choices={qualities} selected={quality} onSelect={value => onOutput({ quality: value })} />
        <div className="se-quality-summary"><span>{output.width} × {output.height}</span>{duration > 0 && <span>≈ {size.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB</span>}</div>
    </StudioToolbarPopover>
  </>;
}

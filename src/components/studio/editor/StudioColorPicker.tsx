import { studioSliderFill } from './studioSliderFill';
import { useEffect, useId, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Pipette, Plus, RefreshCw } from 'lucide-react';

const paletteKey = 'classfy-studio-saved-colors';
const suggestions = ['#FFFFFF', '#FBDDE8', '#EF5066', '#A14BD8', '#6357EF', '#478FF7', '#16ABB5', '#54D8A7', '#A8D957', '#FFDA54', '#FF913F', '#B86446', '#797E90', '#282B38', '#000000'];
type RGB = [number, number, number];
const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const hex = (channels: RGB) => '#' + channels.map(n => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
const rgb = (value: string): RGB => [1, 3, 5].map(at => parseInt(value.slice(at, at + 2), 16)) as RGB;

function toHsv(color: RGB) {
  const [r, g, b] = color.map(n => n / 255);
  const v = Math.max(r, g, b), delta = v - Math.min(r, g, b);
  const sector = !delta ? 0 : v === r ? (g - b) / delta : v === g ? 2 + (b - r) / delta : 4 + (r - g) / delta;
  return { h: (sector * 60 + 360) % 360, s: v ? delta / v : 0, v };
}

function fromHsv(h: number, s: number, v: number) {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return hex([channel(5), channel(3), channel(1)]);
}

function savedColors(): string[] {
  try {
    const colors = JSON.parse(localStorage.getItem(paletteKey) ?? '[]');
    return Array.isArray(colors) ? colors.filter(color => typeof color === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)).slice(0, 15) : [];
  } catch { return []; }
}

function frameColors(canvas?: HTMLCanvasElement | null) {
  if (!canvas?.width || !canvas.height) return [];
  const sample = document.createElement('canvas');
  sample.width = 24; sample.height = 16;
  const ctx = sample.getContext('2d');
  if (!ctx) return [];
  try {
    ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
    const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
    const bins = new Map<string, { count: number; color: string }>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const color: RGB = [data[i], data[i + 1], data[i + 2]];
      const key = color.map(n => Math.floor(n / 48)).join(',');
      const bin = bins.get(key);
      if (bin) bin.count++;
      else bins.set(key, { count: 1, color: hex(color) });
    }
    return [...bins.values()].sort((a, b) => b.count - a.count).slice(0, 7).map(bin => bin.color);
  } catch { return []; }
}

type Props = {
  label: string;
  value: string;
  disabled?: boolean;
  getCanvas?: () => HTMLCanvasElement | null;
  onDraft(color: string): void;
  onCommit(): void;
};

export function StudioColorPicker({ label, value, disabled, getCanvas, onDraft, onCommit }: Props) {
  const id = useId();
  const [hue, setHue] = useState(0);
  const [mode, setMode] = useState<'hex' | 'rgb'>('hex');
  const [saved, setSaved] = useState<string[]>([]);
  const [frame, setFrame] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const eyedropperRequest = useRef<AbortController>();
  useEffect(() => () => eyedropperRequest.current?.abort(), []);
  const EyeDropper = (globalThis as typeof globalThis & {
    EyeDropper?: new () => { open(options: { signal: AbortSignal }): Promise<{ sRGBHex: string }> };
  }).EyeDropper;
  const current = value.toUpperCase(), channels = rgb(current);
  const hsv = toHsv(channels);
  const alpha = current.length === 9 ? current.slice(7) : '';
  const opacity = alpha ? parseInt(alpha, 16) / 255 : 1;
  const apply = (color: string, commit = true) => {
    if (disabled) return;
    onDraft(color);
    if (commit) onCommit();
  };
  const save = () => {
    const next = [current, ...saved.filter(color => color !== current)].slice(0, 15);
    try {
      localStorage.setItem(paletteKey, JSON.stringify(next));
      setSaved(next);
      setNotice('Cor salva na paleta.');
    } catch { setNotice('O navegador não conseguiu salvar a cor.'); }
  };
  const swatches = (colors: string[]) => colors.map(color => <button type="button" key={color} title={color} aria-label={`Usar cor ${color}`}
    aria-pressed={color === current} className="se-color-swatch se-color-checker" onClick={() => {
      setHue(toHsv(rgb(color)).h);
      apply(color.length === 9 ? color : color + (alpha === '00' ? '' : alpha));
    }}><span style={{ backgroundColor: color }} /></button>);
  const updatePlane = (target: HTMLDivElement, x: number, y: number, commit: boolean) => {
    const bounds = target.getBoundingClientRect();
    const color = fromHsv(hue, clamp((x - bounds.left) / bounds.width), 1 - clamp((y - bounds.top) / bounds.height));
    apply(color + (alpha === '00' ? '' : alpha), commit);
  };

  return <div className="se-field">
    <span id={id}>{label}</span>
    <Popover.Root open={open} onOpenChange={next => {
      if (next) { setHue(hsv.h); setSaved(savedColors()); setFrame(frameColors(getCanvas?.())); setNotice(''); }
      if (!next) eyedropperRequest.current?.abort();
      setOpen(next);
    }}>
      <Popover.Trigger className="se-inspector-color" disabled={disabled} aria-labelledby={id}>
        <span>{current}</span><span className="se-color-swatch se-color-checker" aria-hidden="true"><span style={{ backgroundColor: current }} /></span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="se-color-picker" aria-label={label} side="left" align="center" sideOffset={10} collisionPadding={12}>
          <div className="se-color-picker-head"><strong>{label}</strong><span className="se-color-swatch se-color-checker" aria-hidden="true"><span style={{ backgroundColor: current }} /></span></div>
          <div className="se-color-plane" style={{ backgroundColor: `hsl(${hue} 100% 50%)` }} tabIndex={0}
            role="group" aria-label="Saturação e luminosidade. Use as setas para ajustar."
            onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); updatePlane(event.currentTarget, event.clientX, event.clientY, false); }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updatePlane(event.currentTarget, event.clientX, event.clientY, false); }}
            onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updatePlane(event.currentTarget, event.clientX, event.clientY, true); }}
            onLostPointerCapture={onCommit}
            onKeyDown={event => {
              const change = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, .02], ArrowDown: [0, -.02] }[event.key];
              if (!change) return;
              event.preventDefault();
              apply(fromHsv(hue, clamp(hsv.s + change[0]), clamp(hsv.v + change[1])) + (alpha === '00' ? '' : alpha));
            }}>
            <span style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: current.slice(0, 7) }} />
          </div>
          <input className="se-color-hue" type="range" min={0} max={359} value={hue} aria-label="Matiz"
            onChange={event => {
              const next = +event.target.value;
              setHue(next);
              if (hsv.s && hsv.v) apply(fromHsv(next, hsv.s, hsv.v) + alpha, false);
            }} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
          <label className="se-color-opacity">Opacidade <output>{Math.round(opacity * 100)}%</output>
            <input type="range" className="se-slider" style={studioSliderFill(opacity, 0, 1)} min={0} max={255} value={Math.round(opacity * 255)} onChange={event => {
              const a = +event.target.value;
              apply(current.slice(0, 7) + (a === 255 ? '' : a.toString(16).padStart(2, '0').toUpperCase()), false);
            }} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
          </label>
          <div className="se-color-values">
            <button type="button" title="Alternar formato" aria-label={`Formato ${mode.toUpperCase()}. Alternar formato`} onClick={() => setMode(mode === 'hex' ? 'rgb' : 'hex')}>{mode.toUpperCase()}</button>
            {mode === 'hex' ? <ColorValue key="hex" label="Código HEX" value={current} onSave={input => {
              const clean = input.trim().replace(/^#/, '').toUpperCase();
              if (!/^([0-9A-F]{6}|[0-9A-F]{8})$/.test(clean)) return;
              setHue(toHsv(rgb('#' + clean)).h);
              apply('#' + clean);
            }} /> : channels.map((channel, index) => <ColorValue key={index} label={['R', 'G', 'B'][index]} value={String(channel)} onSave={input => {
              if (!/^\d{1,3}$/.test(input) || +input > 255) return;
              const next: RGB = [...channels]; next[index] = +input;
              if (toHsv(next).s) setHue(toHsv(next).h);
              apply(hex(next) + alpha);
            }} />)}
            {EyeDropper && <button type="button" title="Conta-gotas" aria-label="Conta-gotas" onClick={() => {
              eyedropperRequest.current?.abort();
              const request = new AbortController();
              eyedropperRequest.current = request;
              void new EyeDropper().open({ signal: request.signal }).then(({ sRGBHex }) => {
                if (request.signal.aborted) return;
                setHue(toHsv(rgb(sRGBHex)).h);
                apply(sRGBHex.toUpperCase());
              }).catch(() => undefined);
            }}><Pipette size={15} /></button>}
          </div>
          <div className="se-color-palette"><span>Minhas cores</span><div><button type="button" aria-label="Salvar cor atual" title="Salvar cor atual" onClick={save}><Plus size={15} /></button>{swatches(saved)}</div></div>
          {getCanvas && <div className="se-color-palette"><span>No quadro</span><div><button type="button" className="se-color-refresh" aria-label="Atualizar cores do quadro" title="Atualizar cores do quadro" onClick={() => setFrame(frameColors(getCanvas()))}><RefreshCw size={14} /></button>{swatches(frame)}</div></div>}
          <div className="se-color-palette"><span>Sugestões</span><div>{swatches(suggestions)}</div></div>
          <span className="se-sr" role="status">{notice}</span>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}

function ColorValue({ label, value, onSave }: { label: string; value: string; onSave(input: string): void }) {
  const [draft, setDraft] = useState<string>();
  return <input aria-label={label} title={label} value={draft ?? value} spellCheck={false} onChange={event => setDraft(event.target.value)}
    onBlur={() => { if (draft !== undefined && draft !== value) onSave(draft); setDraft(undefined); }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}

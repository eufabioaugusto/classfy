import { studioSliderFill } from './studioSliderFill';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Hand, Repeat, Magnet, Mic, Minus, MousePointer2, Plus, Scissors, StretchHorizontal, Volume2, VolumeX } from 'lucide-react';
import { compileStudioRecipe, formatStudioEditorTime, studioSeconds, type StudioProject } from '../../../../shared/studio';
import { moveLayerClip, moveMainClip, patchClip, rollStudioBoundary, trimLayerClip, trimMainClip } from '@/lib/studio/editor/commands';
import { studioWaveformPath, type StudioWaveform } from '@/lib/studio/editor/audioEnvelope';
import { clampStudioTime, snapStudioTime, webStudioTrim } from './timelineGeometry';

export type TimelineTool = 'select' | 'blade' | 'trim' | 'hand';
type Box = { left: number; top: number; width: number; height: number };
type Marquee = { pointer: number; x: number; y: number; additive: boolean; clips: (Box & { id: string })[]; moved: boolean };
const timelineTools = [
  { id: 'select', label: 'Seleção', key: 'A', Icon: MousePointer2 },
  { id: 'blade', label: 'Lâmina', key: 'B', Icon: Scissors },
  { id: 'hand', label: 'Mão', key: 'H', Icon: Hand },
  { id: 'trim', label: 'Encurtar pelas bordas', key: 'T', Icon: StretchHorizontal },
] as const;

type Props = { zoomCommand?: { direction: number }; loop?: boolean; onToggleLoop?(): void; project: StudioProject; position: number; playing?: boolean; selectedIds: string[]; tool: TimelineTool; onTool(tool: TimelineTool): void; disabled?: boolean; thumbnails: Record<string, string>; waveforms?: ReadonlyMap<string, StudioWaveform>;
  onSelect(id?: string): void; onSelectMany(ids: string[]): void; onBlade(time: number, id: string): void; onSeek(seconds: number): void; onPreview(project: StudioProject | null): void;
  onCommit(change: (project: StudioProject) => StudioProject): void; onAdd(): void;
  onMainMute(): void; onLayerMute(layerId: string): void; onLayerHide(layerId: string): void };
type Drag = { pointer: number; id: string; x: number; y: number; clip: ReturnType<typeof compileStudioRecipe>['clips'][number]; base: StudioProject; edge?: 'start' | 'end'; slip?: boolean; roll?: [string, string]; lastX: number; lastY: number; moved: boolean; scale: number };

const ClipWaveform = memo(function ClipWaveform({ waveform, start, end, muted, gain }: {
  waveform: StudioWaveform; start: number; end: number; muted: boolean; gain: number;
}) {
  // Keep the sample grid in source time so zoom only stretches the existing path.
  const columns = Math.max(2, Math.min(4096, Math.ceil((end - start) / waveform.duration * waveform.peaks.length)));
  return <svg className={`se-clip-waveform${muted ? ' muted' : ''}`} viewBox={`0 0 ${columns} 20`}
    preserveAspectRatio="none" role="img" aria-label="Forma de onda do áudio original">
    <path d={studioWaveformPath(waveform, start, end, columns, gain)} />
  </svg>;
});

export function StudioDesktopTimeline(props: Props) {
  const { project, position, selectedIds, tool, disabled, onSelect, onSeek, onCommit, onPreview, thumbnails } = props;
  const recipe = useMemo(() => compileStudioRecipe(project), [project]), duration = studioSeconds(recipe.durationTicks);
  const [scale, setScale] = useState(72), [snapping, setSnapping] = useState(true), [dragging, setDragging] = useState<string>();
  const [marqueePreview, setMarqueePreview] = useState<{ box: Box; ids: Set<string> }>();
  const marquee = useRef<Marquee | null>(null);
  const frame = recipe.output.frameRateDenominator / recipe.output.frameRateNumerator;
  const transaction = useRef<Drag | null>(null), scroll = useRef<HTMLDivElement>(null), suppress = useRef(false);
  const pan = useRef<{ pointer: number; x: number; left: number }>();
  const volumeDrag = useRef<{ pointer: number; id: string; base: StudioProject; last: number; bounds: DOMRect; maximum: number }>();
  const zoomCommand = props.zoomCommand;
  useEffect(() => {
    if (!zoomCommand) return;
    if (zoomCommand.direction === 0) {
      setScale(Math.min(240, Math.max(.001, ((scroll.current?.clientWidth ?? 800) - 55) / Math.max(.1, duration))));
      if (scroll.current) scroll.current.scrollLeft = 0;
    } else setScale(value => Math.max(.001, Math.min(240, value * (zoomCommand.direction > 0 ? 1.3 : 1 / 1.3))));
  }, [zoomCommand]);
  const width = Math.max(800, duration * scale + 160), marks = Math.ceil(Math.max(duration, width / scale));
  const interval = scale < 8 ? Math.ceil(60 / scale / 10) * 10 : scale < 30 ? 10 : scale < 60 ? 5 : scale < 120 ? 2 : 1;
  useEffect(() => {
    const view = scroll.current;
    if (!props.playing || disabled || transaction.current || marquee.current || !view?.clientWidth) return;
    const cursor = position * scale, margin = Math.min(40, view.clientWidth / 4);
    let next = view.scrollLeft;
    if (cursor > next + view.clientWidth - margin) next = cursor - view.clientWidth + margin;
    else if (cursor < next + margin) next = Math.max(0, cursor - margin);
    if (Math.abs(next - view.scrollLeft) > .01) view.scrollTo({ left: next, behavior: 'auto' });
  }, [position, scale, props.playing, disabled]);
  const point = (event: React.PointerEvent, rect: DOMRect) => ({
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
  });
  const beginMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'select' || disabled || event.pointerType === 'touch' || event.button !== 0 ||
      (event.target as Element).closest('button, [role="slider"], [data-timeline-clip]')) return;
    const content = event.currentTarget, bounds = content.getBoundingClientRect();
    const clips = Array.from(content.querySelectorAll<HTMLElement>('[data-timeline-clip]'), element => {
      const rect = element.getBoundingClientRect();
      return { id: element.dataset.timelineClip!, left: rect.left - bounds.left, top: rect.top - bounds.top,
        width: rect.width, height: rect.height };
    });
    event.preventDefault();
    content.focus({ preventScroll: true });
    content.setPointerCapture(event.pointerId);
    marquee.current = { ...point(event, bounds), pointer: event.pointerId,
      additive: event.shiftKey, clips, moved: false };
  };
  const updateMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = marquee.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const { x, y } = point(event, event.currentTarget.getBoundingClientRect());
    if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 3) return;
    const box = { left: Math.min(x, drag.x), top: Math.min(y, drag.y), width: Math.abs(x - drag.x), height: Math.abs(y - drag.y) };
    drag.moved = true;
    const hits = drag.clips.filter(clip => clip.left < box.left + box.width && clip.left + clip.width > box.left &&
      clip.top < box.top + box.height && clip.top + clip.height > box.top).map(clip => clip.id);
    const ids = new Set(drag.additive ? [...selectedIds, ...hits] : hits);
    setMarqueePreview({ box, ids });
    return [...ids];
  };
  const cancelMarquee = () => { marquee.current = null; setMarqueePreview(undefined); };
  const finishMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = marquee.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const ids = updateMarquee(event);
    cancelMarquee();
    if (!disabled && (ids || !drag.additive)) props.onSelectMany(ids ?? []);
  };
  const applyDrag = (draft: Drag, dx: number, dy: number, target: StudioProject) => {
    const clip = draft.clip, start = studioSeconds(clip.startTicks), end = studioSeconds(clip.startTicks + clip.durationTicks);
    if (draft.roll) return rollStudioBoundary(target, ...draft.roll, dx / draft.scale);
    if (draft.slip) {
      const asset = target.editing!.assets.find(item => item.id === clip.assetId)!;
      const start = studioSeconds(clip.sourceStartTicks), end = studioSeconds(clip.sourceEndTicks);
      const offset = Math.max(-start, Math.min(studioSeconds(asset.durationTicks) - end, dx / draft.scale * (clip.playbackRate ?? 1)));
      return trimMainClip(target, clip.id, start + offset, end + offset);
    }
    if (draft.edge) {
      if (clip.zIndex === 0) {
        const asset = target.editing!.assets.find(a => a.id === clip.assetId)!;
        if (asset.kind === 'image') {
          const length = Math.max(.1, end - start + dx / draft.scale * (draft.edge === 'start' ? -1 : 1));
          return trimMainClip(target, clip.id, 0, length);
        }
        const range = webStudioTrim(studioSeconds(clip.sourceStartTicks), studioSeconds(clip.sourceEndTicks), studioSeconds(asset.durationTicks), draft.edge, dx, draft.scale, clip.playbackRate ?? 1);
        return trimMainClip(target, clip.id, range.start, range.end);
      }
      const offset = dx / draft.scale;
      return trimLayerClip(target, clip.id, draft.edge === 'start' ? Math.max(0, Math.min(end - .1, start + offset)) : start,
        draft.edge === 'end' ? Math.max(start + .1, end + offset) : end);
    }
    if (clip.zIndex === 0) return target;
    const candidates = [0, position, ...recipe.clips.filter(c => c.id !== clip.id).flatMap(c => [studioSeconds(c.startTicks), studioSeconds(c.startTicks + c.durationTicks)])];
    const at = snapStudioTime(start + dx / draft.scale, candidates, draft.scale, snapping);
    const lane = Math.max(1, Math.min(target.editing!.layers.length + 1, clip.zIndex + Math.round(dy / 46)));
    return moveLayerClip(target, clip.id, at, lane);
  };
  const begin = (event: React.PointerEvent, id: string, edge?: 'start' | 'end') => {
    if (disabled || event.button !== 0) return;
    event.stopPropagation(); const clip = recipe.clips.find(c => c.id === id); if (!clip) return;
    suppress.current = false;
    if (tool === 'blade' && !edge) {
      suppress.current = true;
      const bounds = event.currentTarget.getBoundingClientRect();
      const time = studioSeconds(clip.startTicks) + (event.clientX - bounds.left) / scale;
      props.onBlade(time, id);
      return;
    }
    if (tool !== 'trim' && !edge && (event.shiftKey || event.metaKey || event.ctrlKey)) return;
    const slip = tool === 'trim' && event.altKey && clip.zIndex === 0 && clip.kind !== 'image';
    if (tool === 'trim' && !edge && !slip) {
      const bounds = event.currentTarget.getBoundingClientRect();
      edge = event.clientX - bounds.left < bounds.width / 2 ? 'start' : 'end';
    }
    const mainIndex = project.editing!.main.findIndex(item => item.id === id);
    const adjacent = mainIndex >= 0 && edge ? project.editing!.main[mainIndex + (edge === 'start' ? -1 : 1)] : undefined;
    const roll: [string, string] | undefined = tool === 'trim' && event.shiftKey && adjacent
      ? edge === 'start' ? [adjacent.id, id] : [id, adjacent.id] : undefined;
    onSelect(id);
    if (clip.zIndex === 0 && !edge && !slip) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    transaction.current = { pointer: event.pointerId, id, x: event.clientX, y: event.clientY, clip, base: project, edge, slip, roll, lastX: 0, lastY: 0, moved: false, scale };
  };
  const move = (event: React.PointerEvent) => {
    const drag = transaction.current; if (!drag || drag.pointer !== event.pointerId || disabled) return;
    if (!recipe.clips.some(c => c.id === drag.id)) return cancel();
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) < 3 && !drag.moved) return;
    if (drag.clip.zIndex === 0 && !drag.edge && !drag.slip) return;
    drag.moved = true; drag.lastX = dx; drag.lastY = dy; setDragging(drag.id);
    try { onPreview(applyDrag(drag, dx, dy, drag.base)); } catch { /* Invalid source extensions stop at the last valid range. */ }
  };
  const finish = (event: React.PointerEvent) => {
    const drag = transaction.current; if (!drag || drag.pointer !== event.pointerId) return;
    transaction.current = null; setDragging(undefined); onPreview(null);
    if (drag.moved && !disabled) { suppress.current = true; try { onCommit(value => applyDrag(drag, drag.lastX, drag.lastY, value)); } catch { /* The command preserves the original when its bounds are invalid. */ } }
  };
  const cancel = () => { transaction.current = null; setDragging(undefined); onPreview(null); };
  const moveVolume = (event: React.PointerEvent) => {
    const drag = volumeDrag.current;
    if (!drag || drag.pointer !== event.pointerId || disabled) return;
    const { bounds, maximum } = drag;
    drag.last = Math.round(Math.min(maximum, Math.max(0, ((bounds.bottom - event.clientY) / bounds.height - .04) / .92 * maximum)) * 100) / 100;
    onPreview(patchClip(drag.base, drag.id, { gain: drag.last }));
  };
  const finishVolume = (event: React.PointerEvent, commit: boolean) => {
    const drag = volumeDrag.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    volumeDrag.current = undefined;
    onPreview(null);
    if (commit && !disabled) {
      suppress.current = true;
      onCommit(value => patchClip(value, drag.id, { gain: drag.last }));
    }
  };
  const rows = project.editing!.layers.map((layer, index) => ({ layer, z: index + 1 }));
  const clipView = (clip: typeof recipe.clips[number]) => {
    const asset = project.editing!.assets.find(a => a.id === clip.assetId);
    const title = clip.text?.content || asset?.name || 'Mídia';
    const isSelected = marqueePreview ? marqueePreview.ids.has(clip.id) : selectedIds.includes(clip.id);
    const main = clip.zIndex === 0;
    const clipWidth = Math.max(8, studioSeconds(clip.durationTicks) * scale);
    const waveform = asset && (clip.kind === 'video' || clip.kind === 'audio') ? props.waveforms?.get(asset.id) : undefined;
    const muted = main ? project.editing!.mainMuted === true : project.editing!.layers[clip.zIndex - 1]?.muted === true;
    const source = main ? project.editing!.main.find(item => item.id === clip.id) : project.editing!.layers[clip.zIndex - 1]?.items.find(item => item.id === clip.id);
    const gain = source?.gain ?? 1, maximumGain = Math.max(2, gain);
    return <div role="button" tabIndex={0} key={clip.id} aria-label={`${main ? 'Take' : 'Camada'} ${title}`} aria-pressed={isSelected} data-timeline-clip={clip.id} className={`se-timeline-clip se-clip-${clip.kind} ${isSelected ? 'selected' : ''} ${dragging === clip.id ? 'dragging' : ''}`}
      style={{ left: studioSeconds(clip.startTicks) * scale, width: clipWidth, ...(asset && thumbnails[asset.id] ? { backgroundImage: `url("${thumbnails[asset.id]}")` } : {}) }}
      onPointerDown={e => begin(e, clip.id)}
      onPointerMove={event => volumeDrag.current ? moveVolume(event) : move(event)}
      onPointerUp={event => volumeDrag.current ? finishVolume(event, true) : finish(event)}
      onPointerCancel={event => volumeDrag.current ? finishVolume(event, false) : cancel()}
      onLostPointerCapture={event => finishVolume(event, false)}
      draggable={main && !disabled && tool === 'select'} onDragStart={e => { e.dataTransfer.setData('application/classfy-clip', clip.id); cancel(); }} onDragOver={e => { if (main) e.preventDefault(); }} onDrop={e => { if (!main || disabled) return; e.preventDefault(); const from = e.dataTransfer.getData('application/classfy-clip'); if (from) onCommit(value => moveMainClip(value, from, value.editing!.main.findIndex(c => c.id === clip.id))); }}
      onClick={e => { e.stopPropagation(); if (suppress.current) { suppress.current = false; return; } if (disabled || tool === 'blade') return;
        if (e.shiftKey || e.metaKey || e.ctrlKey) props.onSelectMany(selectedIds.includes(clip.id)
          ? selectedIds.filter(id => id !== clip.id) : [...selectedIds, clip.id]);
        else onSelect(clip.id);
      }} onKeyDown={e => { if (e.key === 'Enter' && !disabled) { e.stopPropagation(); onSelect(clip.id); } }}>
      <span>{clip.kind === 'audio' ? <Mic size={13} /> : null}{title}</span>
      {waveform && <ClipWaveform waveform={waveform} start={studioSeconds(clip.sourceStartTicks)}
        end={studioSeconds(clip.sourceEndTicks)} muted={muted} gain={muted ? 0 : gain} />}
      {(clip.kind === 'audio' || clip.kind === 'video' && asset?.hasAudio !== false) && <div className="se-volume-overlay">
        <div className="se-clip-volume" role="slider" tabIndex={disabled ? -1 : 0} aria-label={`Volume de ${title}`}
          aria-valuemin={0} aria-valuemax={maximumGain * 100} aria-valuenow={Math.round(gain * 100)}
          aria-valuetext={`${Math.round(gain * 100)}%`} title={`Volume ${Math.round(gain * 100)}%`}
          style={{ bottom: `${4 + gain / maximumGain * 92}%` }}
          onClick={event => event.stopPropagation()}
          onPointerDown={event => {
            if (disabled || tool !== 'select' || event.button !== 0) return;
            event.stopPropagation(); event.preventDefault();
            onSelect(clip.id);
            const overlay = event.currentTarget.parentElement!;
            volumeDrag.current = { pointer: event.pointerId, id: clip.id, base: project, last: gain,
              bounds: overlay.getBoundingClientRect(), maximum: maximumGain };
            overlay.parentElement!.setPointerCapture(event.pointerId);
          }}
          onKeyDown={event => {
            if (disabled || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const value = event.key === 'Home' ? 0 : event.key === 'End' ? maximumGain :
              gain + (['ArrowUp', 'ArrowRight'].includes(event.key) ? .05 : -.05);
            onCommit(project => patchClip(project, clip.id, { gain: Math.max(0, Math.min(maximumGain, value)) }));
          }} />
      </div>}
      {isSelected && selectedIds.length === 1 && !marqueePreview && tool !== 'blade' && !disabled && <>{(['start', 'end'] as const).map(edge => <span key={edge} role="slider" tabIndex={0} aria-label={`Cortar ${edge === 'start' ? 'início' : 'fim'} de ${title}`} aria-valuenow={studioSeconds(main && asset?.kind !== 'image' ? edge === 'start' ? clip.sourceStartTicks : clip.sourceEndTicks : edge === 'start' ? clip.startTicks : clip.startTicks + clip.durationTicks)} className={`se-trim-handle ${edge}`}
        onPointerDown={e => begin(e, clip.id, edge)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}
        onKeyDown={e => { if (disabled || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); const fake: Drag = { pointer: 0, id: clip.id, x: 0, y: 0, clip, base: project, edge, lastX: 0, lastY: 0, moved: true, scale }; onCommit(p => applyDrag(fake, (e.key === 'ArrowRight' ? 1 : -1) * scale * frame, 0, p)); }} />)}</>}
    </div>;
  };
  return <section className="se-timeline" aria-label="Montagem"><header><strong>Montagem</strong><span className="se-muted">{formatStudioEditorTime(duration)}</span><div className="se-timeline-toolbar">
      {selectedIds.length > 1 && <span className="se-muted" role="status">{selectedIds.length} selecionados</span>}
      {timelineTools.map(({ id, label, key, Icon }) => <button key={id} className={`se-icon ${tool === id ? 'active' : ''}`}
        aria-pressed={tool === id} aria-label={label} aria-keyshortcuts={key} title={`${label} (${key})`} disabled={disabled}
        onClick={() => props.onTool(id)}><Icon size={16} /></button>)}
      {props.onToggleLoop && <button className={`se-icon ${props.loop ? 'active' : ''}`} aria-pressed={!!props.loop}
        aria-label="Reprodução em loop" onClick={props.onToggleLoop}><Repeat size={16} /></button>}<button className={`se-icon ${snapping ? 'active' : ''}`} aria-label={snapping ? 'Desativar alinhamento' : 'Ativar alinhamento'} aria-pressed={snapping} onClick={() => setSnapping(!snapping)}><Magnet size={16} /></button><button className="se-icon" aria-label="Diminuir zoom da montagem" onClick={() => setScale(s => Math.max(.001, s / 1.3))}><Minus size={16} /></button><input aria-label="Zoom da montagem" type="range" className="se-slider" style={studioSliderFill(scale, .001, 240)} min=".001" max="240" step="any" value={scale} onChange={e => setScale(+e.target.value)} /><button className="se-icon" aria-label="Aumentar zoom da montagem" onClick={() => setScale(s => Math.min(240, s * 1.3))}><Plus size={16} /></button></div></header>
    <div className="se-timeline-body"><aside className="se-track-rail"><div className="se-ruler-space" />{rows.map(({ layer, z }) => <div className="se-track-control" key={layer.id}><span>{z}</span>{layer.kind !== 'audio' && <button className="se-icon" disabled={disabled} aria-label={`${layer.hidden ? 'Mostrar' : 'Ocultar'} faixa ${z}`} onClick={() => props.onLayerHide(layer.id)}>{layer.hidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>}{(layer.kind === 'video' || layer.kind === 'audio') && <button className="se-icon" disabled={disabled} aria-label={`${layer.muted ? 'Ativar' : 'Silenciar'} áudio da faixa ${z}`} onClick={() => props.onLayerMute(layer.id)}>{layer.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>}</div>)}<div className="se-track-control se-main-control"><button className="se-icon" disabled={disabled} aria-label={project.editing?.mainMuted ? 'Ativar áudio principal' : 'Silenciar áudio principal'} onClick={props.onMainMute}>{project.editing?.mainMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button></div></aside>
      <div className={`se-timeline-scroll ${tool === 'hand' ? 'hand' : ''}`} ref={scroll}
        onPointerDownCapture={event => {
          if (tool !== 'hand' || disabled || event.button !== 0) return;
          event.stopPropagation(); event.preventDefault();
          const view = event.currentTarget;
          pan.current = { pointer: event.pointerId, x: event.clientX, left: view.scrollLeft };
          view.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = pan.current;
          if (drag?.pointer === event.pointerId) event.currentTarget.scrollLeft = drag.left + drag.x - event.clientX;
        }}
        onLostPointerCapture={event => { if (pan.current?.pointer === event.pointerId) pan.current = undefined; }}><div className={`se-timeline-content tool-${tool}`} style={{ width }} tabIndex={-1}
        onPointerDown={beginMarquee} onPointerMove={updateMarquee} onPointerUp={finishMarquee}
        onPointerCancel={cancelMarquee} onLostPointerCapture={event => { if (event.target === event.currentTarget) cancelMarquee(); }}
        onKeyDown={event => { if (event.key === 'Escape') cancelMarquee(); }}><div className="se-ruler" role="slider" tabIndex={0} aria-label="Posição da montagem" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={position}
        onPointerDown={e => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); onSeek(clampStudioTime((e.clientX - e.currentTarget.getBoundingClientRect().left) / scale, duration)); }} onPointerMove={e => { if (e.buttons === 1 && !disabled) onSeek(clampStudioTime((e.clientX - e.currentTarget.getBoundingClientRect().left) / scale, duration)); }}
        onKeyDown={e => { if (!disabled && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); onSeek(clampStudioTime(position + (e.key === 'ArrowRight' ? frame : -frame) * (e.shiftKey ? 10 : 1), duration)); } }}>
        {Array.from({ length: Math.ceil(marks / interval) + 1 }, (_, i) => <span key={i} style={{ left: i * interval * scale }}>{formatStudioEditorTime(i * interval).replace('.0', '')}</span>)}</div>
        {rows.map(({ layer, z }) => <div className={`se-track ${layer.hidden ? 'hidden' : ''}`} key={layer.id} >{recipe.clips.filter(c => c.zIndex === z).map(clipView)}</div>)}
        <div className="se-track se-main-track">{recipe.clips.filter(c => c.zIndex === 0).map(clipView)}<button className="se-append" style={{ left: duration * scale + 8 }} aria-label="Adicionar take" disabled={disabled} onClick={props.onAdd}><Plus size={20} /></button></div>
        {marqueePreview && <div className="se-timeline-marquee" aria-hidden="true" style={marqueePreview.box} />}
        <div className="se-playhead" style={{ left: position * scale }}><i /></div>
      </div></div></div>
  </section>;
}

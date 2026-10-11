import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Magnet, Mic, Minus, Plus, Volume2, VolumeX } from 'lucide-react';
import { compileStudioRecipe, formatStudioEditorTime, studioSeconds, type StudioProject } from '../../../../shared/studio';
import { moveLayerClip, moveMainClip, trimLayerClip, trimMainClip } from '@/lib/studio/editor/commands';
import { clampStudioTime, snapStudioTime, webStudioTrim } from './timelineGeometry';

type Props = { project: StudioProject; position: number; playing?: boolean; selectedId?: string; disabled?: boolean; thumbnails: Record<string, string>;
  onSelect(id?: string): void; onSeek(seconds: number): void; onPreview(project: StudioProject | null): void;
  onCommit(change: (project: StudioProject) => StudioProject): void; onAdd(): void;
  onMainMute(): void; onLayerMute(layerId: string): void; onLayerHide(layerId: string): void };
type Drag = { pointer: number; id: string; x: number; y: number; clip: ReturnType<typeof compileStudioRecipe>['clips'][number]; base: StudioProject; edge?: 'start' | 'end'; lastX: number; lastY: number; moved: boolean; scale: number };

export function StudioDesktopTimeline(props: Props) {
  const { project, position, selectedId, disabled, onSelect, onSeek, onCommit, onPreview, thumbnails } = props;
  const recipe = compileStudioRecipe(project), duration = studioSeconds(recipe.durationTicks);
  const [scale, setScale] = useState(72), [snapping, setSnapping] = useState(true), [dragging, setDragging] = useState<string>();
  const transaction = useRef<Drag | null>(null), scroll = useRef<HTMLDivElement>(null), suppress = useRef(false);
  const width = Math.max(800, duration * scale + 160), marks = Math.ceil(Math.max(duration, width / scale));
  const interval = scale < 30 ? 10 : scale < 60 ? 5 : scale < 120 ? 2 : 1;
  useEffect(() => {
    const view = scroll.current;
    if (!props.playing || disabled || transaction.current || !view?.clientWidth) return;
    const cursor = position * scale, margin = Math.min(40, view.clientWidth / 4);
    let next = view.scrollLeft;
    if (cursor > next + view.clientWidth - margin) next = cursor - view.clientWidth + margin;
    else if (cursor < next + margin) next = Math.max(0, cursor - margin);
    if (Math.abs(next - view.scrollLeft) > .01) view.scrollTo({ left: next, behavior: 'auto' });
  }, [position, scale, props.playing, disabled]);
  const applyDrag = (draft: Drag, dx: number, dy: number, target: StudioProject) => {
    const clip = draft.clip, start = studioSeconds(clip.startTicks), end = studioSeconds(clip.startTicks + clip.durationTicks);
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
    onSelect(id); event.currentTarget.setPointerCapture(event.pointerId);
    transaction.current = { pointer: event.pointerId, id, x: event.clientX, y: event.clientY, clip, base: project, edge, lastX: 0, lastY: 0, moved: false, scale };
  };
  const move = (event: React.PointerEvent) => {
    const drag = transaction.current; if (!drag || drag.pointer !== event.pointerId || disabled) return;
    if (!recipe.clips.some(c => c.id === drag.id)) return cancel();
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) < 3 && !drag.moved) return;
    if (drag.clip.zIndex === 0 && !drag.edge) return;
    drag.moved = true; drag.lastX = dx; drag.lastY = dy; setDragging(drag.id);
    try { onPreview(applyDrag(drag, dx, dy, drag.base)); } catch { /* Invalid source extensions stop at the last valid range. */ }
  };
  const finish = (event: React.PointerEvent) => {
    const drag = transaction.current; if (!drag || drag.pointer !== event.pointerId) return;
    transaction.current = null; setDragging(undefined); onPreview(null);
    if (drag.moved && !disabled) { suppress.current = true; try { onCommit(value => applyDrag(drag, drag.lastX, drag.lastY, value)); } catch { /* The command preserves the original when its bounds are invalid. */ } }
  };
  const cancel = () => { transaction.current = null; setDragging(undefined); onPreview(null); };
  const rows = project.editing!.layers.map((layer, index) => ({ layer, z: index + 1 }));
  const clipView = (clip: typeof recipe.clips[number]) => {
    const asset = project.editing!.assets.find(a => a.id === clip.assetId);
    const title = clip.text?.content || asset?.name || 'Mídia';
    const isSelected = selectedId === clip.id, main = clip.zIndex === 0;
    return <div role="button" tabIndex={0} key={clip.id} aria-label={`${main ? 'Take' : 'Camada'} ${title}`} aria-pressed={isSelected} className={`se-timeline-clip se-clip-${clip.kind} ${isSelected ? 'selected' : ''} ${dragging === clip.id ? 'dragging' : ''}`}
      style={{ left: studioSeconds(clip.startTicks) * scale, width: Math.max(8, studioSeconds(clip.durationTicks) * scale), ...(asset && thumbnails[asset.id] ? { backgroundImage: `url("${thumbnails[asset.id]}")` } : {}) }}
      onPointerDown={e => begin(e, clip.id)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}
      draggable={main && !disabled} onDragStart={e => { e.dataTransfer.setData('application/classfy-clip', clip.id); cancel(); }} onDragOver={e => { if (main) e.preventDefault(); }} onDrop={e => { if (!main || disabled) return; e.preventDefault(); const from = e.dataTransfer.getData('application/classfy-clip'); if (from) onCommit(value => moveMainClip(value, from, value.editing!.main.findIndex(c => c.id === clip.id))); }}
      onClick={e => { e.stopPropagation(); if (suppress.current) { suppress.current = false; return; } if (!disabled) onSelect(clip.id); }} onKeyDown={e => { if (e.key === 'Enter' && !disabled) { e.stopPropagation(); onSelect(clip.id); } }}>
      <span>{clip.kind === 'audio' ? <Mic size={13} /> : null}{title}</span>
      {isSelected && !disabled && <>{(['start', 'end'] as const).map(edge => <span key={edge} role="slider" tabIndex={0} aria-label={`Cortar ${edge === 'start' ? 'início' : 'fim'} de ${title}`} aria-valuenow={studioSeconds(main && asset?.kind !== 'image' ? edge === 'start' ? clip.sourceStartTicks : clip.sourceEndTicks : edge === 'start' ? clip.startTicks : clip.startTicks + clip.durationTicks)} className={`se-trim-handle ${edge}`}
        onPointerDown={e => begin(e, clip.id, edge)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}
        onKeyDown={e => { if (disabled || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); const fake: Drag = { pointer: 0, id: clip.id, x: 0, y: 0, clip, base: project, edge, lastX: 0, lastY: 0, moved: true, scale }; onCommit(p => applyDrag(fake, (e.key === 'ArrowRight' ? 1 : -1) * scale / 30, 0, p)); }} />)}</>}
    </div>;
  };
  return <section className="se-timeline" aria-label="Montagem"><header><strong>Montagem</strong><span className="se-muted">{formatStudioEditorTime(duration)}</span><div className="se-timeline-toolbar"><button className={`se-icon ${snapping ? 'active' : ''}`} aria-label={snapping ? 'Desativar alinhamento' : 'Ativar alinhamento'} aria-pressed={snapping} onClick={() => setSnapping(!snapping)}><Magnet size={16} /></button><button className="se-icon" aria-label="Diminuir zoom da montagem" onClick={() => setScale(s => Math.max(12, s / 1.3))}><Minus size={16} /></button><input aria-label="Zoom da montagem" type="range" min="12" max="240" value={scale} onChange={e => setScale(+e.target.value)} /><button className="se-icon" aria-label="Aumentar zoom da montagem" onClick={() => setScale(s => Math.min(240, s * 1.3))}><Plus size={16} /></button></div></header>
    <div className="se-timeline-body"><aside className="se-track-rail"><div className="se-ruler-space" />{rows.map(({ layer, z }) => <div className="se-track-control" key={layer.id}><span>{z}</span>{layer.kind !== 'audio' && <button className="se-icon" disabled={disabled} aria-label={`${layer.hidden ? 'Mostrar' : 'Ocultar'} faixa ${z}`} onClick={() => props.onLayerHide(layer.id)}>{layer.hidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>}{(layer.kind === 'video' || layer.kind === 'audio') && <button className="se-icon" disabled={disabled} aria-label={`${layer.muted ? 'Ativar' : 'Silenciar'} áudio da faixa ${z}`} onClick={() => props.onLayerMute(layer.id)}>{layer.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>}</div>)}<div className="se-track-control se-main-control"><button className="se-icon" disabled={disabled} aria-label={project.editing?.mainMuted ? 'Ativar áudio principal' : 'Silenciar áudio principal'} onClick={props.onMainMute}>{project.editing?.mainMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button></div></aside>
      <div className="se-timeline-scroll" ref={scroll}><div className="se-timeline-content" style={{ width }}><div className="se-ruler" role="slider" tabIndex={0} aria-label="Posição da montagem" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={position}
        onPointerDown={e => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); onSeek(clampStudioTime((e.clientX - e.currentTarget.getBoundingClientRect().left) / scale, duration)); }} onPointerMove={e => { if (e.buttons === 1 && !disabled) onSeek(clampStudioTime((e.clientX - e.currentTarget.getBoundingClientRect().left) / scale, duration)); }}
        onKeyDown={e => { if (!disabled && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); onSeek(clampStudioTime(position + (e.key === 'ArrowRight' ? 1 : -1) / 30, duration)); } }}>
        {Array.from({ length: Math.ceil(marks / interval) + 1 }, (_, i) => <span key={i} style={{ left: i * interval * scale }}>{formatStudioEditorTime(i * interval).replace('.0', '')}</span>)}</div>
        {rows.map(({ layer, z }) => <div className={`se-track ${layer.hidden ? 'hidden' : ''}`} key={layer.id} onClick={() => onSelect(undefined)}>{recipe.clips.filter(c => c.zIndex === z).map(clipView)}</div>)}
        <div className="se-track se-main-track">{recipe.clips.filter(c => c.zIndex === 0).map(clipView)}<button className="se-append" style={{ left: duration * scale + 8 }} aria-label="Adicionar take" disabled={disabled} onClick={props.onAdd}><Plus size={20} /></button></div>
        <div className="se-playhead" style={{ left: position * scale }}><i /></div>
      </div></div></div>
  </section>;
}

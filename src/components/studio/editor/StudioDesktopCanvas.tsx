import { useEffect, useRef, useState } from 'react';
import { compileStudioRecipe, studioSeconds, type StudioProject, type StudioRect } from '../../../../shared/studio';
import { patchClip } from '@/lib/studio/editor/commands';

type Props = { project: StudioProject; selectedId?: string; position: number; disabled?: boolean; canvasRef: React.RefObject<HTMLCanvasElement>;
  onSelect(id?: string): void; onEditText(id: string): void; onBegin(): void; onPreview(project: StudioProject | null): void;
  onCommit(change: (project: StudioProject) => StudioProject): void };
type Transaction = { id: string; base: StudioProject; rect: StudioRect; startX: number; startY: number; width: number; height: number; mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; next: StudioRect; pinch?: { distance: number; rect: StudioRect } };
export function StudioDesktopCanvas(props: Props) {
  const { project, selectedId, position, disabled, canvasRef, onSelect, onCommit, onPreview } = props;
  const recipe = compileStudioRecipe(project), ticks = position * recipe.timebase;
  const active = recipe.clips.filter(c => c.kind !== 'audio' && c.opacity > 0 && c.startTicks <= ticks && ticks < c.startTicks + c.durationTicks).sort((a, b) => a.zIndex - b.zIndex);
  const selection = active.find(c => c.id === selectedId);
  const selectedElsewhere = !!selectedId && !selection;
  const shell = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null), transaction = useRef<Transaction | null>(null), points = useRef(new Map<number, { x: number; y: number }>());
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    const target = shell.current; if (!target) return;
    const resize = () => { const ratio = recipe.output.width / recipe.output.height, w = Math.max(1, target.clientWidth - 44), h = Math.max(1, target.clientHeight - 32); const width = Math.min(w, h * ratio); setSize({ width, height: width / ratio }); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(target); return () => observer.disconnect();
  }, [recipe.output.width, recipe.output.height]);
  const [guides, setGuides] = useState({ x: false, y: false });
  const cancel = () => { transaction.current = null; points.current.clear(); setGuides({ x: false, y: false }); onPreview(null); };
  useEffect(() => { if (transaction.current && transaction.current.id !== selectedId || disabled) cancel(); }, [selectedId, disabled]);
  const begin = (event: React.PointerEvent, id: string, mode: Transaction['mode']) => {
    if (disabled || event.button !== 0) return;
    const clip = active.find(c => c.id === id); if (!clip || !viewport.current) return;
    event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (transaction.current?.id === id && points.current.size === 2) {
      const values = [...points.current.values()]; transaction.current.pinch = { distance: Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y), rect: transaction.current.next }; return;
    }
    props.onBegin(); onSelect(id);
    const bounds = viewport.current.getBoundingClientRect();
    transaction.current = { id, base: project, rect: clip.rect, next: clip.rect, startX: event.clientX, startY: event.clientY, width: bounds.width, height: bounds.height, mode };
  };
  const move = (event: React.PointerEvent) => {
    const draft = transaction.current; if (!draft || disabled || !points.current.has(event.pointerId)) return;
    if (!recipe.clips.some(c => c.id === draft.id)) { cancel(); return; }
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    let rect = { ...draft.rect }, xSnap = false, ySnap = false;
    if (draft.pinch && points.current.size === 2) {
      const pointsNow = [...points.current.values()], ratio = Math.hypot(pointsNow[1].x - pointsNow[0].x, pointsNow[1].y - pointsNow[0].y) / Math.max(1, draft.pinch.distance);
      const old = draft.pinch.rect, width = Math.max(.025, Math.min(3, old.width * ratio)), height = Math.max(.025, Math.min(3, old.height * ratio));
      rect = { x: old.x + (old.width - width) / 2, y: old.y + (old.height - height) / 2, width, height };
    } else {
      const dx = (event.clientX - draft.startX) / draft.width, dy = (event.clientY - draft.startY) / draft.height;
      if (draft.mode === 'move') {
        rect.x += dx; rect.y += dy;
        if (Math.abs(rect.x + rect.width / 2 - .5) * draft.width <= 7) { rect.x = .5 - rect.width / 2; xSnap = true; }
        if (Math.abs(rect.y + rect.height / 2 - .5) * draft.height <= 7) { rect.y = .5 - rect.height / 2; ySnap = true; }
      } else {
        const west = draft.mode.endsWith('w'), north = draft.mode.startsWith('n');
        rect.width = Math.max(.025, Math.min(3, rect.width + (west ? -dx : dx)));
        rect.height = Math.max(.025, Math.min(3, rect.height + (north ? -dy : dy)));
        if (event.shiftKey) rect.height = rect.width * draft.rect.height / draft.rect.width;
        if (west) rect.x = draft.rect.x + draft.rect.width - rect.width;
        if (north) rect.y = draft.rect.y + draft.rect.height - rect.height;
      }
    }
    rect.x = Math.max(-3, Math.min(3, rect.x)); rect.y = Math.max(-3, Math.min(3, rect.y));
    draft.next = rect; setGuides({ x: xSnap, y: ySnap }); onPreview(patchClip(draft.base, draft.id, { rect }));
  };
  const finish = (event: React.PointerEvent) => {
    const draft = transaction.current; if (!draft || !points.current.has(event.pointerId)) return;
    points.current.delete(event.pointerId);
    if (points.current.size) {
      const point = [...points.current.values()][0]; draft.rect = draft.next; draft.startX = point.x; draft.startY = point.y; draft.pinch = undefined; return;
    }
    const id = draft.id, rect = draft.next;
    transaction.current = null; setGuides({ x: false, y: false }); onPreview(null);
    if (!disabled) onCommit(value => patchClip(value, id, { rect }));
  };
  return <div className="se-preview-shell" ref={shell}><div className="se-canvas" ref={viewport} style={{ width: size.width, height: size.height }} onClick={() => { if (!disabled) onSelect(undefined); }}>
    <canvas ref={canvasRef} width={recipe.output.width} height={recipe.output.height} aria-label="Prévia da montagem" />
    <div className="se-canvas-items">{active.map(clip => <div key={clip.id} className={`se-canvas-hit ${clip.id === selectedId ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`Selecionar ${clip.text?.content || (clip.zIndex === 0 ? 'vídeo principal' : 'camada')}`} aria-pressed={clip.id === selectedId}
      style={{ left: `${clip.rect.x * 100}%`, top: `${clip.rect.y * 100}%`, width: `${clip.rect.width * 100}%`, height: `${clip.rect.height * 100}%`, transform: `rotate(${clip.rotationDegrees}deg)` }}
      onClick={e => { e.stopPropagation(); if (!disabled) onSelect(clip.id); }} onDoubleClick={e => { e.stopPropagation(); if (clip.text && !disabled) props.onEditText(clip.id); }}
      onKeyDown={e => { if (e.key === 'Enter' && !disabled) { e.stopPropagation(); onSelect(clip.id); } }} onPointerDown={e => begin(e, clip.id, 'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}>
      {clip.id === selectedId && <>{(['nw', 'ne', 'sw', 'se'] as const).map(corner => <span key={corner} className={`se-canvas-handle ${corner}`} role="slider" tabIndex={0} aria-label={`Redimensionar ${corner}`} aria-valuenow={Math.round(clip.rect.width * 100)} onPointerDown={e => begin(e, clip.id, corner)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}
        onKeyDown={e => { if (disabled || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); const ratio = e.key === 'ArrowRight' ? 1.03 : 1 / 1.03; onCommit(p => patchClip(p, clip.id, { rect: { ...clip.rect, width: clip.rect.width * ratio, height: clip.rect.height * ratio } })); }} />)}</>}
    </div>)}</div>
    {guides.x && <div className="se-snap-x" />}{guides.y && <div className="se-snap-y" />}
  </div><span className="se-sr" role="status">{selectedElsewhere ? `O elemento selecionado aparece em outro intervalo da montagem.` : ''}</span></div>;
}

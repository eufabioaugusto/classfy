import { compileStudioRecipe, patchStudioLayerItem, studioSeconds, studioTicks,
  type StudioEditing, type StudioLayerPatch } from './model';

export type StudioLayerTimelineRange = { startSeconds: number; endSeconds: number };
export type StudioLayerTimelineMode = 'start' | 'end' | 'move';
export type StudioLayerTimelineSnapshot = {
  id: string; signature: string; startSeconds: number; endSeconds: number; minimumDuration: number;
  minimumStart: number; maximumEnd: number; moveMinimum: number; moveMaximum: number;
  independentMoveMinimum?: number; independentMoveMaximum?: number;
  sourceStartSeconds: number; sourceEndSeconds: number; temporal: boolean;
};

/** Vertical intent is a final canonical lane position, never a media merge. */
export function studioLayerDragDestination(sourceZIndex: number, lanes: readonly number[], translationY: number, rowHeight = 28): number {
  'worklet';
  const sourceIndex = lanes.indexOf(sourceZIndex);
  if (sourceIndex < 0 || !Number.isFinite(translationY) || !Number.isFinite(rowHeight) || rowHeight <= 0) return sourceZIndex;
  const steps = Math.sign(translationY) * Math.floor(Math.abs(translationY) / rowHeight + 0.5);
  return lanes[Math.max(0, Math.min(lanes.length - 1, sourceIndex + steps))] ?? sourceZIndex;
}

/** Freeze the visible interval, original media and neighboring items together. */
export function freezeStudioLayerTimeline(editing: StudioEditing, id: string): StudioLayerTimelineSnapshot {
  const track = editing.layers.find(layer => layer.items.some(item => item.id === id));
  const item = track?.items.find(value => value.id === id);
  if (!track || !item) throw new Error('Este elemento não está mais na montagem.');
  const recipe = compileStudioRecipe({ kind: 'aula', takes: [], editing });
  const clip = recipe.clips.find(value => value.id === id && value.zIndex > 0);
  if (!clip || clip.durationTicks <= 0) throw new Error('Este elemento está fora do trecho visível da montagem.');
  const startSeconds = studioSeconds(clip.startTicks), endSeconds = studioSeconds(clip.startTicks + clip.durationTicks);
  const mainEnd = Math.max(0, ...recipe.clips.filter(value => value.zIndex === 0).map(value => studioSeconds(value.startTicks + value.durationTicks)));
  // Existing overlaps are preserved; a gesture cannot create additional
  // overlap with the previous/next item in this canonical track.
  const siblings = recipe.clips.filter(value => value.zIndex === clip.zIndex && value.id !== id);
  const moveMinimum = Math.max(0, ...siblings.filter(value => value.startTicks < clip.startTicks)
    .map(value => Math.min(startSeconds, studioSeconds(value.startTicks + value.durationTicks))));
  const moveMaximum = Math.max(endSeconds, Math.min(mainEnd, ...siblings.filter(value => value.startTicks >= clip.startTicks)
    .map(value => Math.max(endSeconds, studioSeconds(value.startTicks)))));
  const asset = editing.assets.find(value => value.id === item.assetId);
  const temporal = item.kind === 'video' || item.kind === 'audio';
  if (temporal && (!asset || asset.durationTicks <= 0)) throw new Error('O original deste elemento precisa de recuperação.');
  const sourceStartSeconds = studioSeconds(clip.sourceStartTicks), sourceEndSeconds = studioSeconds(clip.sourceEndTicks);
  const minimumStart = Math.max(moveMinimum, temporal ? startSeconds - sourceStartSeconds : 0);
  const maximumEnd = Math.max(endSeconds, Math.min(moveMaximum,
    temporal ? endSeconds + studioSeconds(asset!.durationTicks) - sourceEndSeconds : moveMaximum));
  return { id, startSeconds, endSeconds, minimumStart, maximumEnd, moveMinimum, moveMaximum,
    independentMoveMinimum: 0, independentMoveMaximum: Math.max(mainEnd, endSeconds),
    minimumDuration: Math.min(0.1, endSeconds - startSeconds), sourceStartSeconds, sourceEndSeconds, temporal,
    signature: JSON.stringify([track.id, item, editing.main, editing.assets.map(value => [value.id, value.uri, value.durationTicks, value.kind]),
      siblings.map(value => [value.id, value.startTicks, value.durationTicks]), mainEnd]) };
}
export function canContinueStudioLayerTimeline(snapshot: StudioLayerTimelineSnapshot, editing: StudioEditing, selectedId?: string) {
  if (selectedId !== snapshot.id) return false;
  try { return freezeStudioLayerTimeline(editing, snapshot.id).signature === snapshot.signature; }
  catch { return false; }
}

/** Shared with UI worklets: a trim changes source range, a move preserves it. */
export function studioLayerDragRange(snapshot: StudioLayerTimelineSnapshot, mode: StudioLayerTimelineMode, deltaSeconds: number, independentLane = false): StudioLayerTimelineRange {
  'worklet';
  const delta = Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
  const round = (value: number) => Math.round(value * 120000) / 120000;
  if (mode === 'move') {
    const duration = snapshot.endSeconds - snapshot.startSeconds;
    const minimum = independentLane ? snapshot.independentMoveMinimum ?? snapshot.moveMinimum : snapshot.moveMinimum;
    const maximum = independentLane ? snapshot.independentMoveMaximum ?? snapshot.moveMaximum : snapshot.moveMaximum;
    const startSeconds = Math.max(minimum, Math.min(maximum - duration, round(snapshot.startSeconds + delta)));
    return { startSeconds, endSeconds: startSeconds + duration };
  }
  return {
    startSeconds: mode === 'start' ? Math.max(snapshot.minimumStart, Math.min(snapshot.endSeconds - snapshot.minimumDuration, round(snapshot.startSeconds + delta))) : snapshot.startSeconds,
    endSeconds: mode === 'end' ? Math.min(snapshot.maximumEnd, Math.max(snapshot.startSeconds + snapshot.minimumDuration, round(snapshot.endSeconds + delta))) : snapshot.endSeconds,
  };
}

/** Convert absolute timeline intent to one canonical item patch. */
export function studioLayerTimelinePatch(editing: StudioEditing, id: string, range: StudioLayerTimelineRange, mode: 'trim' | 'move' = 'trim'): StudioLayerPatch {
  const frozen = freezeStudioLayerTimeline(editing, id);
  if (![range.startSeconds, range.endSeconds].every(Number.isFinite)) throw new Error('A duração do elemento não é válida.');
  const start = studioTicks(range.startSeconds), end = studioTicks(range.endSeconds);
  const minimum = studioTicks(frozen.minimumDuration);
  if (start < 0 || end - start < minimum) throw new Error('Mantenha um intervalo válido para este elemento.');
  const lower = studioTicks(mode === 'move' ? frozen.moveMinimum : frozen.minimumStart);
  const upper = studioTicks(mode === 'move' ? frozen.moveMaximum : frozen.maximumEnd);
  if (start < lower || end > upper || mode === 'move' && end - start !== studioTicks(frozen.endSeconds - frozen.startSeconds)) {
    throw new Error('O elemento ultrapassa a aula, um item vizinho ou o arquivo original.');
  }
  const item = editing.layers.flatMap(layer => layer.items).find(value => value.id === id)!;
  const durationTicks = end - start;
  const sourceStartTicks = frozen.temporal ? studioTicks(frozen.sourceStartSeconds) + (mode === 'move' ? 0 : start - studioTicks(frozen.startSeconds)) : 0;
  const sourceEndTicks = frozen.temporal ? sourceStartTicks + durationTicks : 0;
  const patch: StudioLayerPatch = { atTicks: start, durationTicks, sourceStartTicks, sourceEndTicks,
    fadeInTicks: Math.min(item.fadeInTicks ?? 0, durationTicks),
    fadeOutTicks: Math.min(item.fadeOutTicks ?? 0, Math.max(0, durationTicks - Math.min(item.fadeInTicks ?? 0, durationTicks))) };
  if (item.anchor) {
    const assets = new Map(editing.assets.map(value => [value.id, value]));
    let hostStart = 0;
    for (const main of editing.main) {
      const length = assets.get(main.assetId)?.kind === 'image' ? main.durationTicks ?? 0 : main.sourceEndTicks - main.sourceStartTicks;
      if (main.id === item.anchor.clipId) {
        if (start >= hostStart && end <= hostStart + length) {
          patch.anchor = item.anchor.sourceStartTicks !== undefined
            ? { clipId: main.id, sourceStartTicks: main.sourceStartTicks + start - hostStart, sourceEndTicks: main.sourceStartTicks + end - hostStart }
            : { clipId: main.id, offsetTicks: start - hostStart };
        } else patch.anchor = undefined; // Explicit drag beyond host becomes global.
        break;
      }
      hostStart += length;
    }
  }
  return patch;
}
export function applyStudioLayerTimelineRange(editing: StudioEditing, id: string, range: StudioLayerTimelineRange, mode: 'trim' | 'move' = 'trim') {
  return patchStudioLayerItem(editing, id, studioLayerTimelinePatch(editing, id, range, mode));
}

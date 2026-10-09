import { addStudioLayerItem, compileStudioRecipe, patchStudioLayerItem, studioSeconds, studioTicks, type StudioEditing } from './model';
import { studioLayerTimelinePatch } from './layerTimelineInteraction';

/** A duplicate remains at the same time on an independent, higher visual lane. */
export function duplicateStudioLayer(editing: StudioEditing, id: string, duplicateId: string): StudioEditing {
  const item = editing.layers.flatMap(layer => layer.items).find(value => value.id === id);
  if (!item) throw new Error('Este elemento não está mais na montagem.');
  const copy = { ...item, id: duplicateId, ...(item.rect ? { rect: { ...item.rect } } : {}),
    ...(item.text ? { text: { ...item.text } } : {}), ...(item.anchor ? { anchor: { ...item.anchor } } : {}),
    ...(item.grade ? { grade: { ...item.grade } } : {}) };
  return addStudioLayerItem(editing, copy, `layer:item:${duplicateId}`);
}

function splitPoint(editing: StudioEditing, id: string, seconds: number) {
  if (!Number.isFinite(seconds)) return undefined;
  const clip = compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.find(value => value.id === id && value.zIndex > 0);
  if (!clip) return undefined;
  const at = studioTicks(seconds), end = clip.startTicks + clip.durationTicks;
  if (at - clip.startTicks < studioTicks(0.1) || end - at < studioTicks(0.1)) return undefined;
  // The current recipe has only edge fades, without an envelope offset that
  // could continue a ramp on the second clip. Split only its constant region.
  return { clip, startSeconds: studioSeconds(clip.startTicks), endSeconds: studioSeconds(end),
    duringFade: at < clip.startTicks + clip.fadeInTicks || at > end - clip.fadeOutTicks };
}

export function canSplitStudioLayer(editing: StudioEditing, id: string, seconds: number): boolean {
  try { const point = splitPoint(editing, id, seconds); return !!point && !point.duringFade; }
  catch { return false; }
}

/** Resolve the visible interval first, so anchored/cropped media keep the same frames. */
export function splitStudioLayer(editing: StudioEditing, id: string, seconds: number, rightId: string): StudioEditing {
  const range = splitPoint(editing, id, seconds);
  if (!range) throw new Error('Posicione o cursor dentro do elemento, a pelo menos 0,1 segundo das bordas.');
  if (range.duringFade) throw new Error('Não é possível dividir dentro de uma entrada ou saída suave. Mova o cursor ou ajuste a duração do efeito.');
  const lane = editing.layers.find(layer => layer.items.some(value => value.id === id))!;
  const left = { ...studioLayerTimelinePatch(editing, id, { startSeconds: range.startSeconds, endSeconds: seconds }), fadeInTicks: range.clip.fadeInTicks, fadeOutTicks: 0 };
  const right = { ...studioLayerTimelinePatch(editing, id, { startSeconds: seconds, endSeconds: range.endSeconds }), fadeInTicks: 0, fadeOutTicks: range.clip.fadeOutTicks };
  const next = patchStudioLayerItem(editing, id, left);
  const rightItem = patchStudioLayerItem(editing, id, right).layers.flatMap(layer => layer.items).find(item => item.id === id)!;
  return addStudioLayerItem(next, { ...rightItem, id: rightId }, lane.id);
}

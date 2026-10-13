import { addStudioLayerItem, compileStudioRecipe, patchStudioClipProperties, patchStudioLayerItem, studioSeconds, studioTicks, validateStudioEditing, type StudioEditing, type StudioAsset } from './model';
import { studioLayerTimelinePatch } from './layerTimelineInteraction';

/** A duplicate remains at the same time on an independent, higher visual lane. */
export function duplicateStudioLayer(editing: StudioEditing, id: string, duplicateId: string): StudioEditing {
  const item = editing.layers.flatMap(layer => layer.items).find(value => value.id === id);
  if (!item) throw new Error('Este elemento não está mais na montagem.');
  const copy = { ...item, id: duplicateId, ...(item.rect ? { rect: { ...item.rect } } : {}),
    ...(item.text ? { text: { ...item.text, ...(item.text.gradientColors ? { gradientColors: [...item.text.gradientColors] as [string, string] } : {}) } } : {}), ...(item.anchor ? { anchor: { ...item.anchor } } : {}),
    ...(item.grade ? { grade: { ...item.grade } } : {}),
    ...(item.enhancement ? { enhancement: { ...item.enhancement } } : {}),
    ...(item.portrait ? { portrait: { ...item.portrait } } : {}),
    ...(item.signature ? { signature: { ...item.signature } } : {}) };
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
  return addStudioLayerItem(next, { ...rightItem, id: rightId,
    ...(rightItem.signature ? { signature: { ...rightItem.signature } } : {}) }, lane.id);
}

/** Detach the audible range, reusing the immutable original without double gain. */
export function extractStudioClipAudio(editing: StudioEditing, id: string, audioItemId: string, layerId = `layer:item:${audioItemId}`, confirmedAudioAsset?: StudioAsset): StudioEditing {
  const clip = compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.find(value => value.id === id);
  const asset = clip?.assetId ? editing.assets.find(value => value.id === clip.assetId) : undefined;
  if (!clip || clip.kind !== 'video' || !asset || asset.kind !== 'video') throw new Error('Selecione um vídeo para separar o áudio.');
  let source = asset, base = editing;
  if (confirmedAudioAsset) {
    // A legacy source may gain verified metadata, but an original record is
    // immutable. Add a new identity for the same bytes in this transaction.
    const keys = new Set([...Object.keys(asset), ...Object.keys(confirmedAudioAsset)]);
    if (!confirmedAudioAsset.id || editing.assets.some(value => value.id === confirmedAudioAsset.id)
      || confirmedAudioAsset.hasAudio !== true || [...keys].some(key => key !== 'id' && key !== 'hasAudio'
        && !Object.is(asset[key as keyof StudioAsset], confirmedAudioAsset[key as keyof StudioAsset]))) {
      throw new Error('A confirmação do áudio deve preservar o mesmo arquivo original e usar uma identificação nova.');
    }
    source = { ...confirmedAudioAsset }; base = { ...editing, assets: [...editing.assets, source] };
  }
  if (source.hasAudio !== true) throw new Error('Não foi confirmado áudio neste original. Importe novamente o vídeo antes de separar o áudio.');
  const next = addStudioLayerItem(patchStudioClipProperties(base, id, { gain: 0 }), {
    id: audioItemId, kind: 'audio', assetId: source.id, atTicks: clip.startTicks, durationTicks: clip.durationTicks,
    sourceStartTicks: clip.sourceStartTicks, sourceEndTicks: clip.sourceEndTicks,
    gain: clip.gain, fadeInTicks: clip.fadeInTicks, fadeOutTicks: clip.fadeOutTicks,
    ...(clip.playbackRate !== undefined ? { playbackRate: clip.playbackRate } : {}),
  }, layerId);
  const issues = validateStudioEditing(next, 'aula');
  if (issues.length) throw new Error(issues[0]);
  return next;
}

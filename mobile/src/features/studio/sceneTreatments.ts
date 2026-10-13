import type { StudioEditing, StudioRenderRecipe } from './model';
import { studioSeconds } from './model';

export function studioSceneAnalysisRequest(editing: StudioEditing, targetId: string) {
  const clip = editing.main.find(item => item.id === targetId) ?? editing.layers.flatMap(layer => layer.items).find(item => item.id === targetId);
  const asset = editing.assets.find(item => item.id === clip?.assetId);
  if (!clip || !asset || !['image', 'video'].includes(asset.kind) || asset.sourceStage === 'cinematicRaw') throw new Error('Selecione uma imagem ou um vídeo disponível para melhorar a cena.');
  const startSeconds = studioSeconds(clip.sourceStartTicks ?? 0), endSeconds = studioSeconds(clip.sourceEndTicks ?? asset.durationTicks);
  return { uri: asset.uri, kind: asset.kind as 'image' | 'video', startSeconds, endSeconds,
    frameCount: asset.kind === 'image' ? 1 : Math.min(12, Math.max(1, Math.ceil(endSeconds - startSeconds))) };
}
/** Compare while preserving all geometry, clocks, audio and target IDs. */
export function studioUntreatedPreviewRecipe(recipe: StudioRenderRecipe): StudioRenderRecipe {
  return { ...recipe, version: 2, requiredFeatures: undefined, clips: recipe.clips.map(clip => ({ ...clip,
    enhancement: undefined, portrait: undefined, signature: undefined, effect: 'natural',
    grade: { preset: 'natural', intensity: 0, exposure: 0, contrast: 0, saturation: 0, temperature: 0 } })) };
}

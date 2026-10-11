import { patchStudioLayerItem, type StudioEditing } from './model';
import type { StudioCanvasTransform } from './canvasGeometry';

/** A canvas gesture edits a single visual item, never its immutable source. */
export function patchStudioCanvasTransform(editing: StudioEditing, id: string, transform: StudioCanvasTransform): StudioEditing {
  const rect = transform.rect;
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0
    || rect.width > 3 || rect.height > 3 || rect.x < -2 || rect.y < -2 || rect.x > 3 || rect.y > 3) {
    throw new Error('A posição deste elemento não é válida.');
  }
  if (editing.main.some(clip => clip.id === id)) {
    return { ...editing, main: editing.main.map(clip => clip.id === id ? { ...clip, rect: { ...rect } } : clip) };
  }
  const item = editing.layers.flatMap(track => track.items).find(value => value.id === id);
  if (!item || item.kind === 'audio') throw new Error('Este elemento visual não está mais na montagem.');
  if (item.text && transform.textFontSize !== undefined && (!Number.isFinite(transform.textFontSize) || transform.textFontSize <= 0 || transform.textFontSize > 1)) {
    throw new Error('O tamanho deste texto não é válido.');
  }
  return patchStudioLayerItem(editing, id, { rect,
    ...(item.text && transform.textFontSize !== undefined ? { text: { ...item.text, fontSize: transform.textFontSize } } : {}) });
}

/** Merge only the selected item after a gesture, preserving unrelated edits. */
export function mergeStudioCanvasDraft(latest: StudioEditing, draft: StudioEditing, id: string): StudioEditing {
  const main = draft.main.find(clip => clip.id === id);
  if (main) {
    if (!latest.main.some(clip => clip.id === id)) throw new Error('Este vídeo não está mais na montagem.');
    return { ...latest, main: latest.main.map(clip => clip.id === id ? { ...clip, rect: main.rect, fit: main.fit, rotationDegrees: main.rotationDegrees } : clip) };
  }
  const item = draft.layers.flatMap(track => track.items).find(value => value.id === id);
  if (!item || !latest.layers.some(track => track.items.some(value => value.id === id))) throw new Error('Esta camada não está mais na montagem.');
  return patchStudioLayerItem(latest, id, item);
}

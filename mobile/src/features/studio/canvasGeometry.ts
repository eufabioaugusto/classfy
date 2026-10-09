import type { StudioEditing, StudioRecipeClip, StudioRect, StudioRenderRecipe } from './model';

export type StudioCanvasTransform = { rect: StudioRect; textFontSize?: number };
export type StudioCanvasCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
export type StudioCanvasFrame = { x: number; y: number; width: number; height: number };

const bounded = (value: number, minimum: number, maximum: number) => {
  'worklet';
  return Math.max(minimum, Math.min(maximum, value));
};

/** The editor and the native renderer use the same canvas, including letterbox. */
export function studioCanvasFrame(width: number, height: number, aspect: StudioEditing['canvas']['aspectRatio']): StudioCanvasFrame {
  'worklet';
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const ratio = aspect === 'portrait' ? 9 / 16 : aspect === 'square' ? 1 : 16 / 9;
  const canvasWidth = Math.min(width, height * ratio), canvasHeight = canvasWidth / ratio;
  return { x: (width - canvasWidth) / 2, y: (height - canvasHeight) / 2, width: canvasWidth, height: canvasHeight };
}

/** Last painted layer wins. Main clips and nonvisual or transparent layers are excluded. */
export function studioVisibleCanvasLayers(editing: StudioEditing, recipe: StudioRenderRecipe, positionSeconds: number, includeMain = false): StudioRecipeClip[] {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0 || recipe.durationTicks <= 0) return [];
  const position = Math.round(positionSeconds * recipe.timebase);
  if (position > recipe.durationTicks) return [];
  // A paused player at EOF still displays its final frame.
  const tick = Math.min(position, recipe.durationTicks - 1);
  const ids = new Set(editing.layers.flatMap(layer => layer.items.map(item => item.id)));
  if (includeMain) for (const clip of editing.main) ids.add(clip.id);
  return recipe.clips.map((clip, index) => ({ clip, index })).filter(({ clip }) => ids.has(clip.id)
    && (includeMain || clip.zIndex > 0) && clip.kind !== 'audio' && clip.opacity > 0
    && tick >= clip.startTicks && tick < clip.startTicks + clip.durationTicks)
    .sort((a, b) => b.clip.zIndex - a.clip.zIndex || b.index - a.index).map(({ clip }) => clip);
}

export function studioCanvasContains(clip: Pick<StudioRecipeClip, 'rect' | 'rotationDegrees'>, x: number, y: number, frame: StudioCanvasFrame) {
  'worklet';
  if (frame.width <= 0 || frame.height <= 0 || ![x, y].every(Number.isFinite)
    || x < frame.x || y < frame.y || x > frame.x + frame.width || y > frame.y + frame.height) return false;
  const { rect } = clip;
  const centerX = frame.x + (rect.x + rect.width / 2) * frame.width;
  const centerY = frame.y + (rect.y + rect.height / 2) * frame.height;
  const radians = -(clip.rotationDegrees || 0) * Math.PI / 180;
  const dx = x - centerX, dy = y - centerY;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
  return Math.abs(localX) <= rect.width * frame.width / 2 && Math.abs(localY) <= rect.height * frame.height / 2;
}

export function studioCanvasHitTest(layers: readonly StudioRecipeClip[], x: number, y: number, frame: StudioCanvasFrame) {
  return layers.find(clip => studioCanvasContains(clip, x, y, frame))?.id;
}

/** Allow intentional cropping, but keep a small piece of the frame reachable. */
export function studioCanvasMove(rect: StudioRect, translationX: number, translationY: number, canvasWidth: number, canvasHeight: number): StudioRect {
  'worklet';
  if (![translationX, translationY, canvasWidth, canvasHeight].every(Number.isFinite) || canvasWidth <= 0 || canvasHeight <= 0) return { ...rect };
  const visibleX = Math.min(rect.width, 0.04), visibleY = Math.min(rect.height, 0.04);
  return { ...rect, x: bounded(rect.x + translationX / canvasWidth, Math.max(-2, -rect.width + visibleX), Math.min(3, 1 - visibleX)),
    y: bounded(rect.y + translationY / canvasHeight, Math.max(-2, -rect.height + visibleY), Math.min(3, 1 - visibleY)) };
}

export function studioCanvasScale(transform: StudioCanvasTransform, requestedScale: number, canvasWidth: number, canvasHeight: number,
  corner?: StudioCanvasCorner, rotationDegrees = 0, minimumSize = 0.025): StudioCanvasTransform {
  'worklet';
  const { rect, textFontSize } = transform;
  if (![requestedScale, canvasWidth, canvasHeight, rect.width, rect.height].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return { rect: { ...rect }, ...(textFontSize !== undefined ? { textFontSize } : {}) };
  // Do not enlarge an existing unusually small imported frame just by touching it.
  const minimum = Math.max(Math.min(minimumSize, rect.width) / rect.width, Math.min(minimumSize, rect.height) / rect.height,
    textFontSize && textFontSize > 0 ? Math.min(0.008, textFontSize) / textFontSize : 0);
  const maximum = Math.min(3 / rect.width, 3 / rect.height, textFontSize && textFontSize > 0 ? 1 / textFontSize : Infinity);
  const scale = bounded(requestedScale, Math.min(minimum, maximum), maximum);
  const width = rect.width * scale, height = rect.height * scale;
  let centerX = (rect.x + rect.width / 2) * canvasWidth, centerY = (rect.y + rect.height / 2) * canvasHeight;
  if (corner) {
    const signX = corner === 'topLeft' || corner === 'bottomLeft' ? -1 : 1;
    const signY = corner === 'topLeft' || corner === 'topRight' ? -1 : 1;
    const radians = rotationDegrees * Math.PI / 180;
    const changeX = signX * (width - rect.width) * canvasWidth / 2;
    const changeY = signY * (height - rect.height) * canvasHeight / 2;
    centerX += changeX * Math.cos(radians) - changeY * Math.sin(radians);
    centerY += changeX * Math.sin(radians) + changeY * Math.cos(radians);
  }
  const next = { x: centerX / canvasWidth - width / 2, y: centerY / canvasHeight - height / 2, width, height };
  return { rect: studioCanvasMove(next, 0, 0, canvasWidth, canvasHeight),
    ...(textFontSize !== undefined ? { textFontSize: bounded(textFontSize * scale, Number.EPSILON, 1) } : {}) };
}

/** Project a corner drag onto the diagonal instead of independently stretching axes. */
export function studioCanvasResize(transform: StudioCanvasTransform, corner: StudioCanvasCorner, translationX: number, translationY: number,
  canvasWidth: number, canvasHeight: number, rotationDegrees = 0, minimumSize = 0.025): StudioCanvasTransform {
  'worklet';
  const radians = -rotationDegrees * Math.PI / 180;
  const dx = translationX * Math.cos(radians) - translationY * Math.sin(radians);
  const dy = translationX * Math.sin(radians) + translationY * Math.cos(radians);
  const signX = corner === 'topLeft' || corner === 'bottomLeft' ? -1 : 1;
  const signY = corner === 'topLeft' || corner === 'topRight' ? -1 : 1;
  const vx = signX * transform.rect.width * canvasWidth, vy = signY * transform.rect.height * canvasHeight;
  const denominator = vx * vx + vy * vy;
  const scale = denominator > 0 && Number.isFinite(dx) && Number.isFinite(dy) ? 1 + (dx * vx + dy * vy) / denominator : 1;
  return studioCanvasScale(transform, scale, canvasWidth, canvasHeight, corner, rotationDegrees, minimumSize);
}

export function studioCanvasTransformChanged(before: StudioCanvasTransform, after: StudioCanvasTransform) {
  'worklet';
  return ['x', 'y', 'width', 'height'].some(key => Math.abs(before.rect[key as keyof StudioRect] - after.rect[key as keyof StudioRect]) > 1e-7)
    || Math.abs((before.textFontSize ?? 0) - (after.textFontSize ?? 0)) > 1e-7;
}

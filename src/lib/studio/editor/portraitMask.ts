export type StudioPortraitPoint = { x: number; y: number; z?: number };
export type StudioPortraitFace = StudioPortraitPoint[];
export type StudioPortraitRegion = { points: StudioPortraitPoint[]; protected: boolean };

// MediaPipe Face Mesh contour indices (Apache-2.0); ordering follows each closed contour.
const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const leftEye = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
const rightEye = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398];
const leftBrow = [70,63,105,66,107,55,65,52,53,46], rightBrow = [336,296,334,293,300,276,283,282,295,285];
const mouth = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
// Nose nodes from MediaPipe FACEMESH_NOSE (Apache-2.0):
// https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py
const nose = [168,6,197,195,5,4,1,19,94,2,98,97,326,327,294,278,344,440,275,45,220,115,48,64];
export const STUDIO_PORTRAIT_MAX_ANALYSIS = 640;
export function studioPortraitAnalysisSize(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('O quadro do retrato não é válido.');
  const ratio = Math.min(1, STUDIO_PORTRAIT_MAX_ANALYSIS / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
function scaled(points: StudioPortraitPoint[], scaleX: number, scaleY: number) {
  const cx = points.reduce((n, p) => n + p.x, 0) / points.length, cy = points.reduce((n, p) => n + p.y, 0) / points.length;
  return points.map(p => ({ x: cx + (p.x - cx) * scaleX, y: cy + (p.y - cy) * scaleY }));
}
function hull(points: StudioPortraitPoint[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: StudioPortraitPoint, b: StudioPortraitPoint, c: StudioPortraitPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (values: StudioPortraitPoint[]) => { const result: StudioPortraitPoint[] = []; for (const value of values) { while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, value) <= 0) result.pop(); result.push(value); } return result; };
  return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
}
export function studioPortraitRegions(face: StudioPortraitFace, version: 1 | 2 = 1): StudioPortraitRegion[] {
  if (face.length < 468 || face.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < -.15 || point.x > 1.15 || point.y < -.15 || point.y > 1.15)) return [];
  const contour = (indices: number[], x: number, y = x) => scaled(indices.map(index => face[index]), x, y);
  const outer = contour(oval, .92), width = Math.max(...outer.map(p => p.x)) - Math.min(...outer.map(p => p.x));
  if (width < .045) return []; // A distant/partial face cannot justify altering pixels.
  return [{ points: outer, protected: false }, { points: contour(leftEye, 1.45, 1.8), protected: true }, { points: contour(rightEye, 1.45, 1.8), protected: true }, { points: contour(leftBrow, 1.4, 2.2), protected: true }, { points: contour(rightBrow, 1.4, 2.2), protected: true }, { points: contour(mouth, 1.4, 1.8), protected: true },
    ...(version === 2 ? [{ points: scaled(hull(nose.map(index => face[index])), 1.3, 1.25), protected: true }] : [])];
}
export function studioPortraitFaceWidth(face: StudioPortraitFace) {
  const regions = studioPortraitRegions(face); return regions.length ? Math.max(...regions[0].points.map(p => p.x)) - Math.min(...regions[0].points.map(p => p.x)) : 0;
}
export function drawStudioPortraitMask(canvas: HTMLCanvasElement, face: StudioPortraitFace, width: number, height: number, version: 1 | 2 = 1) {
  canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Não foi possível preparar a máscara do retrato.');
  const regions = studioPortraitRegions(face, version); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  if (!regions.length) return false;
  for (const region of regions) {
    // Feather only the contracted skin silhouette; hard feature exclusions are
    // drawn afterwards and never blurred back into the stronger v2 treatment.
    const boundedSkin = version === 2 && !region.protected;
    if (boundedSkin) ctx.save();
    ctx.filter = boundedSkin ? 'blur(1.5px)' : 'none';
    ctx.beginPath(); region.points.forEach((point, index) => { const x = point.x * width, y = point.y * height; if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath(); if (boundedSkin) ctx.clip();
    ctx.fillStyle = region.protected ? '#000' : '#fff'; ctx.fill();
    if (version === 2 && region.protected) {
      // A narrow/concave brow polygon alone may leave part of the hair line exposed.
      ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, studioPortraitFaceWidth(face) / .92 * width * .075); ctx.stroke();
    }
    if (boundedSkin) ctx.restore();
  }
  ctx.filter = 'none';
  return true;
}

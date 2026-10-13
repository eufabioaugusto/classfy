import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { StudioPortraitFace } from './portraitMask';
export type StudioPortraitRequest = { type: 'detect'; id: number; bitmap: ImageBitmap } | { type: 'prepare'; id: number };
export type StudioPortraitResponse = { id: number; face?: StudioPortraitFace; error?: string };
type Scope = { location: { origin: string }; onmessage: ((event: MessageEvent<StudioPortraitRequest>) => void) | null; postMessage(message: StudioPortraitResponse): void };
const scope = self as unknown as Scope;
const modelPath = '/studio/portrait/face-landmarker-float16-v1.task';
const wasmPath = '/studio/portrait/mediapipe-1.1.0';
let task: Promise<FaceLandmarker> | null = null, sequence = Promise.resolve();
async function model() {
  const url = new URL(modelPath, scope.location.origin).href;
  let cache: Cache | undefined;
  try { cache = await caches.open('classfy-portrait-face-landmarker-float16-v1'); const saved = await cache.match(url); if (saved) return new Uint8Array(await saved.arrayBuffer()); } catch { /* Storage unavailable still permits local inference. */ }
  const response = await fetch(url, { cache: 'force-cache' }); if (!response.ok) throw new Error('O modelo local de retrato não pôde ser carregado.');
  const bytes = new Uint8Array(await response.clone().arrayBuffer());
  if (bytes.byteLength !== 3758596) throw new Error('O modelo de retrato recebido está incompleto.');
  try { await cache?.put(url, response); } catch { /* Cache is an optimization, not an export dependency. */ }
  return bytes;
}
function initialize() {
  if (task) return task;
  const initializing = (async () => {
    if (!await FilesetResolver.isSimdSupported()) throw new Error('Este navegador não oferece o processamento local necessário para o retrato.');
    const files = await FilesetResolver.forVisionTasks(new URL(wasmPath, scope.location.origin).href, true);
    return FaceLandmarker.createFromOptions(files, { canvas: new OffscreenCanvas(1, 1), baseOptions: { modelAssetBuffer: await model(), delegate: 'GPU' }, runningMode: 'IMAGE', numFaces: 1, minFaceDetectionConfidence: .65, minFacePresenceConfidence: .65, outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false });
  })(); task = initializing; void initializing.catch(() => { if (task === initializing) task = null; }); return initializing;
}
scope.onmessage = ({ data }: MessageEvent<StudioPortraitRequest>) => {
  if (data.type !== 'detect' && data.type !== 'prepare') return;
  sequence = sequence.then(async () => {
    try {
      const detector = await initialize();
      if (data.type === 'prepare') { scope.postMessage({ id: data.id } satisfies StudioPortraitResponse); return; }
      // IMAGE is stateless: a seek, trim or export order never inherits another frame's tracking.
      const face = detector.detect(data.bitmap).faceLandmarks[0] ?? [];
      scope.postMessage({ id: data.id, face: face.map(point => ({ x: point.x, y: point.y })) } satisfies StudioPortraitResponse);
    } catch (error) {
      scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'O processamento local do retrato falhou.' } satisfies StudioPortraitResponse);
    } finally { if (data.type === 'detect') data.bitmap.close(); }
  });
};

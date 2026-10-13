import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { StudioRecipeClip, StudioSignature } from '../../../../shared/studio';
import { suggestStudioSignature, type StudioSignatureSample } from '../../../../shared/studio/signatureLook';
import { assertStudioActive } from './media';
import { studioAnalysisTimes } from './sceneAnalysis';

export type StudioSignatureMeasure = (source: CanvasImageSource, width: number, height: number, signal?: AbortSignal) => Promise<StudioSignatureSample>;
/** Decode source trim once; the retained renderer owns the lazy vision model. */
export async function analyzeStudioSignature(blob: Blob, clip: StudioRecipeClip, timebase: number, { measure, signal, onProgress }: { measure: StudioSignatureMeasure; signal?: AbortSignal; onProgress?: (value: number) => void }): Promise<StudioSignature> {
  assertStudioActive(signal);
  if (!['image', 'video'].includes(clip.kind)) throw new Error('Selecione uma cena com o creator para aplicar a assinatura.');
  if (clip.kind === 'image') {
    const image = await createImageBitmap(blob);
    try { assertStudioActive(signal); const sample = await measure(image, image.width, image.height, signal); assertStudioActive(signal); onProgress?.(1); return suggestStudioSignature([sample]); }
    finally { image.close(); }
  }
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const abort = () => input.dispose(); signal?.addEventListener('abort', abort, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack(); assertStudioActive(signal);
    if (!video || !await video.canDecode()) throw new Error('O original não pôde ser lido para destacar o creator.');
    const sink = new CanvasSink(video, { width: Math.min(512, await video.getDisplayWidth()), fit: 'contain' }), times = studioAnalysisTimes(clip, timebase), samples: StudioSignatureSample[] = [];
    for (let index = 0; index < times.length; index++) {
      assertStudioActive(signal); const frame = await sink.getCanvas(times[index]); assertStudioActive(signal);
      if (!frame) throw new Error('Um quadro deste trecho não pôde ser analisado. A assinatura não foi aplicada.');
      samples.push(await measure(frame.canvas, frame.canvas.width, frame.canvas.height, signal)); assertStudioActive(signal); onProgress?.((index + 1) / times.length);
    }
    return suggestStudioSignature(samples);
  } finally { signal?.removeEventListener('abort', abort); input.dispose(); }
}

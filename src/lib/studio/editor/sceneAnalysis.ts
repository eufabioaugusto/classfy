import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { measureStudioScene, suggestStudioEnhancement, type StudioSceneSample } from '../../../../shared/studio/autoEnhance';
import type { StudioRecipeClip, StudioEnhancement } from '../../../../shared/studio';
import { assertStudioActive, studioCanvas } from './media';

export function studioAnalysisTimes(clip: Pick<StudioRecipeClip, 'sourceStartTicks' | 'sourceEndTicks' | 'kind'>, timebase: number): number[] {
  if (clip.kind === 'image') return [0];
  const start = clip.sourceStartTicks / timebase, end = clip.sourceEndTicks / timebase;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Selecione um trecho com duração válida.');
  const count = Math.max(1, Math.min(12, Math.ceil((end - start) * 2)));
  return Array.from({ length: count }, (_, i) => start + (end - start) * (i + .5) / count);
}

export async function analyzeStudioScene(blob: Blob, clip: StudioRecipeClip, timebase: number, { signal, onProgress }: { signal?: AbortSignal; onProgress?: (value: number) => void } = {}): Promise<StudioEnhancement> {
  assertStudioActive(signal);
  if (!['video', 'image'].includes(clip.kind)) throw new Error('Selecione uma imagem ou um vídeo para melhorar a cena.');
  const samples: StudioSceneSample[] = [], canvas = studioCanvas(1, 1), ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const sample = (source: CanvasImageSource, width: number, height: number) => {
    const scale = Math.min(1, 256 / Math.max(width, height)); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    samples.push(measureStudioScene(ctx.getImageData(0, 0, canvas.width, canvas.height).data));
  };
  if (clip.kind === 'image') {
    const image = await createImageBitmap(blob);
    try { assertStudioActive(signal); sample(image, image.width, image.height); onProgress?.(1); return suggestStudioEnhancement(samples); }
    finally { image.close(); canvas.width = canvas.height = 1; }
  }
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const abort = () => input.dispose(); signal?.addEventListener('abort', abort, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack(); assertStudioActive(signal);
    if (!video || !await video.canDecode()) throw new Error('Não foi possível analisar o codec do original neste navegador.');
    const sink = new CanvasSink(video, { width: Math.min(256, await video.getDisplayWidth()), fit: 'contain' });
    const times = studioAnalysisTimes(clip, timebase);
    for (let i = 0; i < times.length; i++) {
      assertStudioActive(signal); const frame = await sink.getCanvas(times[i]); assertStudioActive(signal);
      if (!frame) throw new Error('Um quadro do trecho não pôde ser lido. A cena permanece sem alterações.');
      sample(frame.canvas, frame.canvas.width, frame.canvas.height); onProgress?.((i + 1) / times.length);
    }
    return suggestStudioEnhancement(samples);
  } finally { signal?.removeEventListener('abort', abort); input.dispose(); canvas.width = canvas.height = 1; }
}

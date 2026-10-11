import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';

export type StudioMediaMetadata = {
  kind: 'video' | 'audio' | 'image'; duration: number; width?: number; height?: number;
  frameRate?: number; hasAudio: boolean; mimeType: string; thumbnail?: Blob;
  colorSpace?: string; warnings: string[];
};
export type StudioAssetResolver = (assetId: string) => Promise<Blob | null>;

export function assertStudioActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Operação cancelada.', 'AbortError');
}
export function studioCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
export function studioCanvasBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível criar a miniatura.')), type, quality));
}

/** Reads the original bytes; MIME and file extensions are never accepted as metadata. */
export async function inspectStudioMedia(file: Blob, { signal }: { signal?: AbortSignal } = {}): Promise<StudioMediaMetadata> {
  assertStudioActive(signal);
  if (!file.size) throw new Error('O arquivo está vazio.');
  if (file.type.startsWith('image/')) {
    const image = await createImageBitmap(file);
    try {
      assertStudioActive(signal);
      const ratio = Math.min(1, 480 / Math.max(image.width, image.height));
      const canvas = studioCanvas(image.width * ratio, image.height * ratio);
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const thumbnail = await studioCanvasBlob(canvas); assertStudioActive(signal);
      return { kind: 'image', duration: 0, width: image.width, height: image.height, hasAudio: false, mimeType: file.type, thumbnail, warnings: [] };
    } finally { image.close(); }
  }
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const abort = () => input.dispose(); signal?.addEventListener('abort', abort, { once: true });
  try {
    const [video, audio, duration] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack(), input.computeDuration()]);
    assertStudioActive(signal);
    if ((!video && !audio) || !Number.isFinite(duration) || duration <= 0) throw new Error('Não foi possível ler a duração e as faixas deste arquivo.');
    if (video && !await video.canDecode() || audio && !await audio.canDecode()) throw new Error('Este navegador não consegue decodificar o codec do original. Experimente Chrome, Edge ou Safari atualizado.');
    const result: StudioMediaMetadata = { kind: video ? 'video' : 'audio', duration, hasAudio: !!audio, mimeType: file.type, warnings: [] };
    if (video) {
      const [width, height, metrics, color] = await Promise.all([video.getDisplayWidth(), video.getDisplayHeight(), video.computeFrameRateMetrics({ targetPacketCount: 100 }), video.getColorSpace()]);
      result.width = width; result.height = height;
      const frameRate = metrics.underlyingFrameRate ?? metrics.bestGuessFrameRate;
      if (Number.isFinite(frameRate) && frameRate > 0) result.frameRate = frameRate;
      if (!metrics.underlyingFrameRate) result.warnings.push('A cadência variável do original será convertida para a cadência da montagem.');
      result.colorSpace = [color.primaries, color.transfer, color.matrix].filter(Boolean).join('/') || undefined;
      if (['pq', 'hlg'].includes(String(color.transfer))) result.warnings.push('O original HDR será composto em SDR no navegador.');
      const frame = await new CanvasSink(video, { width: Math.min(480, width), fit: 'contain' }).getCanvas(Math.min(duration / 10, 0.3));
      if (frame) {
        const canvas = studioCanvas(frame.canvas.width, frame.canvas.height);
        canvas.getContext('2d')!.drawImage(frame.canvas, 0, 0); result.thumbnail = await studioCanvasBlob(canvas);
      }
    }
    assertStudioActive(signal); return result;
  } finally { signal?.removeEventListener('abort', abort); input.dispose(); }
}

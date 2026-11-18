import type { StudioVideoQuality } from '../../../../shared/studio';

export function studioExportBitrate(width: number, height: number, fps: number, quality: StudioVideoQuality = 'medium') {
  const density = { low: .07, medium: .11, high: .16 }[quality];
  return Math.max(quality === 'low' ? 1500000 : 2500000, Math.min(quality === 'high' ? 65000000 : 50000000, Math.round(width * height * fps * density)));
}

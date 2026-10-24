/** Storage uses decimal GB, matching iPhone storage settings and the product warning. */
export const studioLowStorageBytes = 5_000_000_000;
export type StudioCaptureStorage = {
  availableBytes: number | null; totalBytes: number | null; low: boolean;
  freeFraction: number | null; label: string; accessibilityLabel: string;
};
const validBytes = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function studioCaptureStorage(available: unknown, total?: unknown): StudioCaptureStorage {
  const availableBytes = validBytes(available) ? available : null;
  const totalBytes = validBytes(total) && total > 0 && (availableBytes === null || total >= availableBytes) ? total : null;
  const low = availableBytes !== null && availableBytes < studioLowStorageBytes;
  const freeFraction = availableBytes !== null && totalBytes !== null ? availableBytes / totalBytes : null;
  // Do not round 4.99 GB up to a seemingly safe 5.0 GB beside a red warning.
  const gb = availableBytes === null ? null : (Math.floor(availableBytes / 100_000_000) / 10).toFixed(1).replace('.', ',');
  const label = gb === null ? '— GB livres' : `${gb} GB livres`;
  return { availableBytes, totalBytes, low, freeFraction, label,
    accessibilityLabel: availableBytes === null ? 'Armazenamento do iPhone. Espaço livre indisponível.'
      : `Armazenamento do iPhone. ${label}.${low ? ' Pouco espaço disponível.' : ''}` };
}

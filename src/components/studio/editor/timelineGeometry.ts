export function clampStudioTime(value: number, duration: number) { return Math.max(0, Math.min(Number.isFinite(value) ? value : 0, Math.max(0, duration))); }
export function snapStudioTime(value: number, candidates: readonly number[], scale: number, enabled: boolean) {
  if (!enabled || !Number.isFinite(scale) || scale <= 0) return Math.max(0, value);
  let target = value, distance = 8 / scale;
  for (const candidate of candidates) if (Number.isFinite(candidate) && Math.abs(candidate - value) < distance) { target = candidate; distance = Math.abs(candidate - value); }
  return Math.max(0, Math.round(target * 1000) / 1000);
}
export function webStudioTrim(start: number, end: number, sourceDuration: number, edge: 'start' | 'end', dx: number, scale: number, rate = 1) {
  const change = Number.isFinite(dx / scale) ? dx / scale * rate : 0;
  const minimum = 0.1 * rate;
  return edge === 'start' ? { start: Math.max(0, Math.min(end - minimum, start + change)), end }
    : { start, end: Math.min(sourceDuration, Math.max(start + minimum, end + change)) };
}

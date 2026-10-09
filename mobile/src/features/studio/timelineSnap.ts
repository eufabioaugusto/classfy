export type StudioTimelineSnapPoint = { key: string; seconds: number };
export type StudioTimelineSnapMatch = { key: string; seconds: number; edge: 'start' | 'end' };
export type StudioTimelineSnapRange = { startSeconds: number; endSeconds: number };
export type StudioTimelineSnapBounds = {
  minimumStart: number; maximumEnd: number; minimumDuration: number;
  moveMinimum: number; moveMaximum: number;
};

/** Targets are frozen at gesture start; no draft or export state is changed. */
export function studioTimelineSnapPoints(
  main: readonly { id: string; start: number; end: number }[],
  layers: readonly { id: string; startTicks: number; durationTicks: number }[],
  cursorSeconds: number,
): StudioTimelineSnapPoint[] {
  const points: StudioTimelineSnapPoint[] = [];
  if (Number.isFinite(cursorSeconds) && cursorSeconds >= 0) points.push({ key: 'cursor', seconds: cursorSeconds });
  for (const clip of main) {
    if (Number.isFinite(clip.start)) points.push({ key: `main:${clip.id}:start`, seconds: clip.start });
    if (Number.isFinite(clip.end)) points.push({ key: `main:${clip.id}:end`, seconds: clip.end });
  }
  for (const clip of layers) {
    points.push({ key: `layer:${clip.id}:start`, seconds: clip.startTicks / 120000 });
    points.push({ key: `layer:${clip.id}:end`, seconds: (clip.startTicks + clip.durationTicks) / 120000 });
  }
  return points.filter(point => Number.isFinite(point.seconds) && point.seconds >= 0);
}

export function studioTimelineSnapTargets(points: readonly StudioTimelineSnapPoint[], excludedPrefix: string) {
  'worklet';
  return points.filter(point => !point.key.startsWith(excludedPrefix));
}

/** Pixel tolerance stays constant through zoom; the larger release radius
 * prevents a guide from flickering while the finger rests near a target. */
export function snapStudioTimelineRange(
  range: StudioTimelineSnapRange, mode: 'move' | 'start' | 'end', bounds: StudioTimelineSnapBounds,
  points: readonly StudioTimelineSnapPoint[], pixelsPerSecond: number,
  previous: StudioTimelineSnapMatch | null = null, acquirePixels = 8, releasePixels = 14,
): { range: StudioTimelineSnapRange; match: StudioTimelineSnapMatch | null } {
  'worklet';
  if (![range.startSeconds, range.endSeconds, pixelsPerSecond, acquirePixels, releasePixels].every(Number.isFinite)
    || pixelsPerSecond <= 0 || acquirePixels < 0 || releasePixels < acquirePixels) return { range, match: null };
  const duration = Math.round((range.endSeconds - range.startSeconds) * 120000) / 120000;
  const edges: readonly ('start' | 'end')[] = mode === 'move' ? ['start', 'end'] : [mode];
  const trial = (point: StudioTimelineSnapPoint, edge: 'start' | 'end') => {
    'worklet';
    const seconds = Math.round(point.seconds * 120000) / 120000;
    const candidate = mode === 'move'
      ? { startSeconds: edge === 'start' ? seconds : Math.round((seconds - duration) * 120000) / 120000, endSeconds: edge === 'end' ? seconds : Math.round((seconds + duration) * 120000) / 120000 }
      : { startSeconds: edge === 'start' ? seconds : range.startSeconds, endSeconds: edge === 'end' ? seconds : range.endSeconds };
    const lower = mode === 'move' ? bounds.moveMinimum : bounds.minimumStart;
    const upper = mode === 'move' ? bounds.moveMaximum : bounds.maximumEnd;
    if (candidate.startSeconds < lower - 1 / 120000 || candidate.endSeconds > upper + 1 / 120000
      || candidate.endSeconds - candidate.startSeconds < bounds.minimumDuration - 1 / 120000) return null;
    return candidate;
  };
  // Preserve the selected target until the finger leaves the release radius.
  if (previous && edges.includes(previous.edge)) {
    const point = points.find(value => value.key === previous.key && Math.abs(value.seconds - previous.seconds) < 1 / 120000);
    if (point && Math.abs((previous.edge === 'start' ? range.startSeconds : range.endSeconds) - point.seconds) * pixelsPerSecond <= releasePixels) {
      const candidate = trial(point, previous.edge);
      if (candidate) return { range: candidate, match: previous };
    }
  }
  let closest: { range: StudioTimelineSnapRange; match: StudioTimelineSnapMatch; distance: number } | null = null;
  for (const point of points) {
    if (!Number.isFinite(point.seconds)) continue;
    for (const edge of edges) {
      const distance = Math.abs((edge === 'start' ? range.startSeconds : range.endSeconds) - point.seconds) * pixelsPerSecond;
      if (distance > acquirePixels || closest && distance >= closest.distance) continue;
      const candidate = trial(point, edge);
      if (candidate) closest = { range: candidate, match: { key: point.key, seconds: point.seconds, edge }, distance };
    }
  }
  return closest ? { range: closest.range, match: closest.match } : { range, match: null };
}

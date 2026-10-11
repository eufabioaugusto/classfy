import type { StudioTake } from './model';

export type StudioTimelineTrim = { takeId: string; start: number; end: number; previewSourceSeconds?: number };
export type StudioTimelineSegment = { take: StudioTake; index: number; start: number; end: number; x: number; width: number };
export type StudioTrimGesture = {
  takeId: string; uri: string; duration: number; start: number; end: number; playbackRate?: number;
  preceding: { id: string; uri: string; start: number; end: number; playbackRate?: number }[];
};
export type StudioTimelineTouchState = { count: number; distance: number };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}
function touchPoint(value: unknown) {
  const point = record(value);
  if (typeof point?.pageX !== 'number' || typeof point.pageY !== 'number' || !Number.isFinite(point.pageX) || !Number.isFinite(point.pageY)) return null;
  return { pageX: point.pageX, pageY: point.pageY };
}
export function studioTimelineTouchState(event: unknown, gestureState?: unknown): StudioTimelineTouchState {
  // RN termination/cancellation events can omit nativeEvent.touches entirely.
  // An explicit empty list is authoritative; the gesture count is a fallback
  // only when the list is absent, and cannot supply coordinates for a pinch.
  const rawTouches = record(record(event)?.nativeEvent)?.touches;
  const touches: unknown[] | null = Array.isArray(rawTouches) ? rawTouches : null;
  const active = record(gestureState)?.numberActiveTouches;
  const fallback = typeof active === 'number' && Number.isFinite(active) ? Math.max(0, Math.floor(active)) : 0;
  const count = touches?.length ?? fallback;
  const first = touchPoint(touches?.[0]);
  const second = touchPoint(touches?.[1]);
  const distance = count >= 2 && first && second ? Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY) : 0;
  return { count, distance: Number.isFinite(distance) ? distance : 0 };
}

const minimum = 0.1;
export const minimumStudioTimelineScale = 12;
export const maximumStudioTimelineScale = 240;
export const defaultStudioTimelineScale = 60;
export function clampStudioTimelineScale(value: number) {
  return Math.min(maximumStudioTimelineScale, Math.max(minimumStudioTimelineScale, Number.isFinite(value) ? value : defaultStudioTimelineScale));
}
export function studioTimelinePinchScale(initialScale: number, initialDistance: number, distance: number) {
  const scale = clampStudioTimelineScale(initialScale);
  if (![initialDistance, distance].every(Number.isFinite) || initialDistance <= 0 || distance <= 0) return scale;
  return clampStudioTimelineScale(scale * distance / initialDistance);
}
export function studioTimelineZoomAnchor(offset: number, previousScale: number, nextScale: number, duration: number) {
  const seconds = studioTimelineSeconds(offset, previousScale, duration);
  return { seconds, offset: seconds * clampStudioTimelineScale(nextScale) };
}
function clipSeconds(take: StudioTake) {
  const rate = take.playbackRate ?? 1;
  const duration = Math.round((take.end - take.start) * 120000 / rate) / 120000;
  if (![take.duration, take.start, take.end, rate].every(Number.isFinite) || rate < .25 || rate > 4 || take.start < 0 || take.end > take.duration + 0.05 || duration < minimum - 1e-6) {
    throw new Error('Revise os limites dos takes.');
  }
  return duration;
}
export function studioTimelineLayout(takes: readonly StudioTake[], pixelsPerSecond: number) {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) throw new Error('A escala da montagem não é válida.');
  const ids = new Set<string>();
  let cursor = 0;
  const segments: StudioTimelineSegment[] = takes.map((take, index) => {
    if (!take.id || ids.has(take.id)) throw new Error('Revise a identificação dos takes.');
    ids.add(take.id);
    const duration = clipSeconds(take);
    const segment = { take, index, start: cursor, end: cursor + duration, x: cursor * pixelsPerSecond, width: duration * pixelsPerSecond };
    cursor += duration;
    return segment;
  });
  return { segments, duration: cursor, width: cursor * pixelsPerSecond };
}
export function studioTimelineSeconds(offset: number, pixelsPerSecond: number, duration: number) {
  if (![offset, pixelsPerSecond, duration].every(Number.isFinite) || pixelsPerSecond <= 0 || duration < 0) return 0;
  return Math.max(0, Math.min(duration, offset / pixelsPerSecond));
}
export function studioTimelineTicks(pixelsPerSecond: number, visibleStart: number, visibleEnd: number, duration: number) {
  if (![pixelsPerSecond, visibleStart, visibleEnd, duration].every(Number.isFinite) || pixelsPerSecond <= 0 || duration < 0) return [];
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600];
  const major = steps.find(step => step * pixelsPerSecond >= 64) || steps[steps.length - 1];
  const minor = major >= 5 ? major / 5 : major / 2;
  const first = Math.max(0, Math.floor(visibleStart / minor));
  const last = Math.max(first, Math.ceil(Math.min(duration, visibleEnd) / minor));
  const ticks: { seconds: number; major: boolean }[] = [];
  // Only the viewport is materialized, including for multi-hour lessons.
  for (let index = first; index <= last && ticks.length < 100; index++) {
    const seconds = index * minor;
    if (seconds <= duration + 1e-6) ticks.push({ seconds, major: Math.abs(seconds / major - Math.round(seconds / major)) < 1e-6 });
  }
  return ticks;
}
export function freezeStudioTrim(takes: readonly StudioTake[], takeId: string): StudioTrimGesture {
  const index = takes.findIndex(take => take.id === takeId);
  if (index < 0) throw new Error('Este take não está mais na montagem.');
  studioTimelineLayout(takes, 1);
  const take = takes[index];
  return { takeId, uri: take.uri, duration: take.duration, start: take.start, end: take.end,
    ...(take.playbackRate !== undefined ? { playbackRate: take.playbackRate } : {}),
    preceding: takes.slice(0, index).map(item => ({ id: item.id, uri: item.uri, start: item.start, end: item.end,
      ...(item.playbackRate !== undefined ? { playbackRate: item.playbackRate } : {}) })) };
}
export function canContinueStudioTrim(gesture: StudioTrimGesture, takes: readonly StudioTake[], activeTakeId?: string) {
  if (activeTakeId !== gesture.takeId) return false;
  const index = takes.findIndex(take => take.id === gesture.takeId);
  const take = takes[index];
  if (!take || index !== gesture.preceding.length || take.uri !== gesture.uri || take.duration !== gesture.duration || take.start !== gesture.start || take.end !== gesture.end || (take.playbackRate ?? 1) !== (gesture.playbackRate ?? 1)) return false;
  return gesture.preceding.every((previous, i) => {
    const current = takes[i];
    return current.id === previous.id && current.uri === previous.uri && current.start === previous.start && current.end === previous.end && (current.playbackRate ?? 1) === (previous.playbackRate ?? 1);
  });
}
export function studioTrimRange(gesture: StudioTrimGesture, edge: 'start' | 'end', deltaSeconds: number): StudioTimelineTrim {
  if (!Number.isFinite(deltaSeconds)) throw new Error('A posição do corte não é válida.');
  const rate = gesture.playbackRate ?? 1;
  const value = Math.round((gesture[edge] + deltaSeconds * rate) * 120000) / 120000;
  const start = edge === 'start' ? Math.max(0, Math.min(gesture.end - minimum * rate, value)) : gesture.start;
  const end = edge === 'end' ? Math.min(gesture.duration, Math.max(gesture.start + minimum * rate, value)) : gesture.end;
  return { takeId: gesture.takeId, start, end, previewSourceSeconds: edge === 'start' ? start : Math.max(start, end - 0.01) };
}
export function studioTrimTimelinePosition(gesture: StudioTrimGesture, range: StudioTimelineTrim) {
  if (range.takeId !== gesture.takeId) throw new Error('O cursor do corte pertence a outro take.');
  const preview = range.previewSourceSeconds ?? range.start;
  if (![range.start, range.end, preview].every(Number.isFinite)) throw new Error('A posição do corte não é válida.');
  const source = Math.max(range.start, Math.min(range.end, preview));
  const preceding = gesture.preceding.reduce((sum, take) => sum + Math.round((take.end - take.start) * 120000 / (take.playbackRate ?? 1)) / 120000, 0);
  // Draft playback has a new start; the timeline still displays the frozen
  // original range until commit. Expansion may legitimately map below zero.
  return preceding + (source - gesture.start) / (gesture.playbackRate ?? 1);
}

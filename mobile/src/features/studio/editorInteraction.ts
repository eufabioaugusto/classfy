import type { StudioTake } from './model';
import { locateStudioTime, studioPreviewBoundedSourceTime } from './timeline';

export type StudioSourceFrame = { takeId: string; uri: string; seconds: number };
export type StudioPlaybackAnchor = { takeId: string; uri: string; sourceSeconds: number; globalSeconds: number };
export type StudioRestoredPlayback = { position: number; source: StudioSourceFrame };

// Selection belongs to editing tools. Playback is anchored to an original
// source frame, so trimming an earlier clip only changes its global offset.
export function captureStudioPlaybackAnchor(takes: readonly StudioTake[], playback: { takeId?: string; sourcePosition: number; position: number }): StudioPlaybackAnchor | null {
  const take = takes.find(item => item.id === playback.takeId);
  if (take && Number.isFinite(playback.sourcePosition)) {
    const sourceSeconds = studioPreviewBoundedSourceTime(take, playback.sourcePosition, null);
    const index = takes.indexOf(take);
    const before = takes.slice(0, index).reduce((sum, item) => sum + item.end - item.start, 0);
    return { takeId: take.id, uri: take.uri, sourceSeconds, globalSeconds: before + sourceSeconds - take.start };
  }
  const location = locateStudioTime(takes, Number.isFinite(playback.position) ? playback.position : 0);
  return location ? { takeId: location.takeId, uri: location.take.uri, sourceSeconds: location.sourceSeconds, globalSeconds: location.timelineSeconds } : null;
}

export function restoreStudioPlaybackAnchor(takes: readonly StudioTake[], anchor: StudioPlaybackAnchor | null): StudioRestoredPlayback | null {
  if (!takes.length || !anchor) return null;
  const index = takes.findIndex(item => item.id === anchor.takeId && item.uri === anchor.uri);
  const take = takes[index];
  if (take && Number.isFinite(anchor.sourceSeconds)) {
    const seconds = studioPreviewBoundedSourceTime(take, anchor.sourceSeconds, null);
    const before = takes.slice(0, index).reduce((sum, item) => sum + item.end - item.start, 0);
    return { position: before + seconds - take.start, source: { takeId: take.id, uri: take.uri, seconds } };
  }
  // A split removes the old ID; a deleted/replaced source cannot be reused.
  // Preserve its global point and let the new montage determine the source.
  const location = locateStudioTime(takes, Number.isFinite(anchor.globalSeconds) ? anchor.globalSeconds : 0);
  return location ? { position: location.timelineSeconds, source: { takeId: location.takeId, uri: location.take.uri, seconds: location.sourceSeconds } } : null;
}

export function studioSourceFrame(takes: readonly StudioTake[], requested: StudioSourceFrame): StudioSourceFrame | null {
  const take = takes.find(item => item.id === requested.takeId && item.uri === requested.uri);
  if (!take || !Number.isFinite(requested.seconds) || !Number.isFinite(take.duration) || take.duration <= 0) return null;
  // Boundary previews can reveal frames excluded by the saved cut. They are
  // constrained by the immutable original, not its current timeline range.
  return { takeId: take.id, uri: take.uri, seconds: Math.max(0, Math.min(take.duration, requested.seconds)) };
}

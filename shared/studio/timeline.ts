import type { StudioTake } from './model';

export const minimumStudioClipSeconds = 0.1;
const epsilon = 0.000001;

function requireIdentity(takes: readonly StudioTake[]) {
  const ids = new Set<string>();
  for (const take of takes) {
    if (!take.id || ids.has(take.id)) throw new Error('A identificação dos takes precisa de recuperação.');
    ids.add(take.id);
  }
}
function requireTake(takes: readonly StudioTake[], id: string) {
  requireIdentity(takes);
  const index = takes.findIndex(take => take.id === id);
  if (index < 0) throw new Error('Este take não está mais na montagem.');
  return { take: takes[index], index };
}
function clipDuration(take: StudioTake) {
  const rate = take.playbackRate ?? 1;
  const duration = Math.round((take.end - take.start) * 120000 / rate) / 120000;
  if (![take.duration, take.start, take.end, rate].every(Number.isFinite) || rate < .25 || rate > 4 || take.start < 0 || take.end > take.duration + 0.05 || duration < minimumStudioClipSeconds - epsilon) {
    throw new Error('Revise os limites deste take antes de editar.');
  }
  return duration;
}
function requireNewIds(takes: readonly StudioTake[], ids: string[]) {
  if (ids.some(id => !id || takes.some(take => take.id === id)) || new Set(ids).size !== ids.length) throw new Error('Os novos takes precisam de identificações diferentes.');
}
function takeTreatments(take: StudioTake) {
  return { ...(take.enhancement ? { enhancement: { ...take.enhancement } } : {}),
    ...(take.portrait ? { portrait: { ...take.portrait } } : {}),
    ...(take.signature ? { signature: { ...take.signature } } : {}) };
}

function studioSplitLocation(takes: readonly StudioTake[], takeId: string, sourceSeconds: number) {
  const { take, index } = requireTake(takes, takeId);
  const durationTicks = Math.round(clipDuration(take) * 120000), rate = take.playbackRate ?? 1;
  const minimum = take.start + minimumStudioClipSeconds * rate, maximum = take.end - minimumStudioClipSeconds * rate;
  if (!Number.isFinite(sourceSeconds) || minimum > maximum + epsilon || sourceSeconds < minimum - epsilon || sourceSeconds > maximum + epsilon) throw new Error('Divida mais longe das bordas. Cada trecho precisa ter pelo menos 0,1 segundo.');
  const point = Math.max(minimum, Math.min(maximum, sourceSeconds)), localTicks = Math.round((point - take.start) * 120000 / rate);
  if (localTicks < (take.fadeInTicks ?? 0) || localTicks > durationTicks - (take.fadeOutTicks ?? 0)) throw new Error('Não é possível dividir dentro de uma entrada ou saída suave.');
  return { take, index, point, localTicks, durationTicks };
}
export function canSplitStudioTake(takes: readonly StudioTake[], takeId: string, sourceSeconds: number): boolean {
  try { studioSplitLocation(takes, takeId, sourceSeconds); return true; } catch { return false; }
}

// Keep the source file immutable. The exporter composes these two ranges from
// the same original; splitting never copies or deletes the underlying media.
export function splitStudioTake(takes: readonly StudioTake[], takeId: string, sourceSeconds: number, leftId: string, rightId: string): StudioTake[] {
  requireNewIds(takes, [leftId, rightId]);
  const { take, index, point, localTicks, durationTicks } = studioSplitLocation(takes, takeId, sourceSeconds);
  const result = [...takes];
  const fade = (take.fadeInTicks ?? 0) > 0 || (take.fadeOutTicks ?? 0) > 0;
  const motion = take.motion && take.motion !== 'none';
  result.splice(index, 1, { ...take, ...takeTreatments(take), id: leftId, end: point, ...(fade ? { fadeOutTicks: 0 } : {}),
    ...(motion ? { motionDurationTicks: take.motionDurationTicks ?? durationTicks } : {}) },
    { ...take, ...takeTreatments(take), id: rightId, start: point, ...(fade ? { fadeInTicks: 0 } : {}),
      ...(motion ? { motionOffsetTicks: (take.motionOffsetTicks ?? 0) + localTicks, motionDurationTicks: take.motionDurationTicks ?? durationTicks } : {}) });
  return result;
}

export function duplicateStudioTake(takes: readonly StudioTake[], takeId: string, newId: string): StudioTake[] {
  const { take, index } = requireTake(takes, takeId);
  clipDuration(take);
  requireNewIds(takes, [newId]);
  const result = [...takes];
  result.splice(index + 1, 0, { ...take, ...takeTreatments(take), id: newId });
  return result;
}

// IDs remain stable while a drag is in progress, even when an import appends
// another take. beforeId=null means the end of the latest saved montage.
export function moveStudioTake(takes: readonly StudioTake[], takeId: string, beforeId: string | null): StudioTake[] {
  const { take } = requireTake(takes, takeId);
  if (beforeId === takeId) return [...takes];
  if (beforeId !== null) requireTake(takes, beforeId);
  const result = takes.filter(item => item.id !== takeId);
  const destination = beforeId === null ? result.length : result.findIndex(item => item.id === beforeId);
  result.splice(destination, 0, take);
  return result;
}

export function removeStudioTake(takes: readonly StudioTake[], takeId: string): StudioTake[] {
  requireTake(takes, takeId);
  return takes.filter(take => take.id !== takeId);
}

export type StudioTimelineLocation = {
  take: StudioTake;
  takeId: string;
  index: number;
  sourceSeconds: number;
  localSeconds: number;
  timelineSeconds: number;
  timelineStartSeconds: number;
  duration: number;
};

export function locateStudioTime(takes: readonly StudioTake[], timelineSeconds: number): StudioTimelineLocation | undefined {
  requireIdentity(takes);
  if (!Number.isFinite(timelineSeconds)) throw new Error('A posição da montagem não é válida.');
  if (!takes.length) return undefined;
  const durations = takes.map(clipDuration);
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  const target = Math.max(0, Math.min(total, timelineSeconds));
  let cursor = 0;
  for (let index = 0; index < takes.length; index += 1) {
    const duration = durations[index];
    const end = cursor + duration;
    if (target < end || index === takes.length - 1) {
      const take = takes[index];
      const localSeconds = Math.max(0, Math.min(duration, target - cursor));
      return { take, takeId: take.id, index, sourceSeconds: Math.min(take.end, take.start + localSeconds * (take.playbackRate ?? 1)), localSeconds,
        timelineSeconds: target, timelineStartSeconds: cursor, duration };
    }
    cursor = end;
  }
}
// An empty editor can stay mounted below the camera. An absent take and an
// absent seek must never match just because both optional IDs are undefined.
export function studioPreviewSourceTime(take: { id: string; start: number; end: number } | undefined, pending: { takeId: string; seconds: number } | null) {
  if (!take) return 0;
  const seconds = pending && pending.takeId === take.id && Number.isFinite(pending.seconds) ? pending.seconds : take.start;
  return Math.max(take.start, Math.min(take.end, seconds));
}

// Native currentTime can lag behind an asynchronous seek while a cut is saved.
// Keep that take's requested source frame, then clamp it to the closest new
// boundary. A seek from another take never supplies this clip's position.
export function studioPreviewBoundedSourceTime(take: { id: string; start: number; end: number } | undefined, nativeSeconds: number, pending: { takeId: string; seconds: number } | null) {
  if (!take || !Number.isFinite(take.start) || !Number.isFinite(take.end) || take.end < take.start) return 0;
  const seconds = pending && pending.takeId === take.id && Number.isFinite(pending.seconds)
    ? pending.seconds : Number.isFinite(nativeSeconds) ? nativeSeconds : take.start;
  return Math.max(take.start, Math.min(take.end, seconds));
}

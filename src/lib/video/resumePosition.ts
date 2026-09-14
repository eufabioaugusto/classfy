interface ResumePositionInput {
  savedPosition?: number | null;
  completed?: boolean | null;
  duration?: number | null;
}

const REPLAY_END_TOLERANCE_SECONDS = 2;

export function resolveResumePosition({
  savedPosition,
  completed = false,
  duration,
}: ResumePositionInput): number {
  const position = Number(savedPosition || 0);
  const knownDuration = Number(duration || 0);

  if (!Number.isFinite(position) || position <= 0 || completed) return 0;

  if (
    Number.isFinite(knownDuration) &&
    knownDuration > 0 &&
    position >= Math.max(1, knownDuration - REPLAY_END_TOLERANCE_SECONDS)
  ) {
    return 0;
  }

  return position;
}

export function shouldRestartFromBeginning({
  currentTime,
  duration,
  ended,
}: {
  currentTime: number;
  duration: number;
  ended?: boolean;
}): boolean {
  if (ended) return true;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  return currentTime >= Math.max(0, duration - 0.25);
}

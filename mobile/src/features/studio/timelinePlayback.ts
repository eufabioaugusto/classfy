// AVPlayer sends time at 15 Hz (Expo's fallback at 10 Hz). These samples
// synchronize a visual clock; they are not animation frames or seek commands.
export type StudioTimelinePlaybackClock = {
  position: number;
  samplePosition: number;
  ageMs: number;
  correction: number;
  running: boolean;
  stalled: boolean;
};

const maximumSampleAgeMs = 250;

export function resetStudioTimelinePlayback(position: number, duration: number, running = false): StudioTimelinePlaybackClock {
  'worklet';
  const bounded = Math.max(0, Math.min(Math.max(0, duration), Number.isFinite(position) ? position : 0));
  return { position: bounded, samplePosition: bounded, ageMs: 0, correction: 0, running: running && bounded < duration, stalled: false };
}

export function sampleStudioTimelinePlayback(clock: StudioTimelinePlaybackClock, position: number, duration: number, running: boolean): StudioTimelinePlaybackClock {
  'worklet';
  const sample = resetStudioTimelinePlayback(position, duration, running);
  // Explicit pause/load, seek and replay establish a new media anchor. An
  // expired sample is different: playback still owns the same continuous run.
  // Never turn a delayed sample into a backward scroll or a periodic restart.
  if (!sample.running || !clock.running && !clock.stalled) return sample;
  // Old binaries may publish the desired rate while the media time is frozen.
  // Duplicate/out-of-order events are not evidence that playback advanced;
  // they must not renew the watchdog or let a buffering video drift forever.
  if (sample.position <= clock.samplePosition + 0.000001) return clock;
  const drift = sample.position - clock.position;
  return { ...clock, samplePosition: sample.position, ageMs: 0, correction: drift, running: true, stalled: false };
}

export function advanceStudioTimelinePlayback(clock: StudioTimelinePlaybackClock, elapsedMs: number | null, duration: number): StudioTimelinePlaybackClock {
  'worklet';
  if (!clock.running || elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return clock;
  // A suspended/dropped UI frame cannot justify jumping across a long gap.
  // Require a fresh player sample after it, including on app foregrounding.
  if (elapsedMs > 100) return { ...clock, running: false, stalled: true, correction: 0 };
  const elapsed = Math.min(elapsedMs, Math.max(0, maximumSampleAgeMs - clock.ageMs));
  const seconds = elapsed / 1000;
  const adjustment = Math.max(-seconds * 0.15, Math.min(seconds * 0.15, clock.correction * (1 - Math.exp(-elapsed / 120))));
  const position = Math.max(0, Math.min(duration, clock.position + seconds + adjustment));
  const ageMs = clock.ageMs + elapsedMs;
  // No advancing samples means a stall, even if an older native binary still
  // reports its desired playback rate as playing while it buffers.
  return { ...clock, position, ageMs, correction: clock.correction - adjustment,
    running: ageMs < maximumSampleAgeMs && position < duration,
    stalled: ageMs >= maximumSampleAgeMs && position < duration };
}

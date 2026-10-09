// AVPlayer sends time at 15 Hz (Expo's fallback at 10 Hz). These samples
// synchronize a visual clock; they are not animation frames or seek commands.
export type StudioTimelinePlaybackClock = {
  position: number;
  samplePosition: number;
  ageMs: number;
  correction: number;
  running: boolean;
};

const maximumSampleAgeMs = 250;
const discontinuitySeconds = 0.25;

export function resetStudioTimelinePlayback(position: number, duration: number, running = false): StudioTimelinePlaybackClock {
  'worklet';
  const bounded = Math.max(0, Math.min(Math.max(0, duration), Number.isFinite(position) ? position : 0));
  return { position: bounded, samplePosition: bounded, ageMs: 0, correction: 0, running: running && bounded < duration };
}

export function sampleStudioTimelinePlayback(clock: StudioTimelinePlaybackClock, position: number, duration: number, running: boolean): StudioTimelinePlaybackClock {
  'worklet';
  const sample = resetStudioTimelinePlayback(position, duration, running);
  // Pause, load, seek, replay and a stopped clock use the exact media time.
  // Ordinary samples gently correct drift without restarting the animation.
  const drift = sample.position - clock.position;
  if (!sample.running || !clock.running || clock.ageMs >= maximumSampleAgeMs || sample.position < clock.samplePosition - 0.001 || Math.abs(drift) >= discontinuitySeconds) return sample;
  return { ...clock, samplePosition: sample.position, ageMs: 0, correction: drift };
}

export function advanceStudioTimelinePlayback(clock: StudioTimelinePlaybackClock, elapsedMs: number | null, duration: number): StudioTimelinePlaybackClock {
  'worklet';
  if (!clock.running || elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return clock;
  // A suspended/dropped UI frame cannot justify jumping across a long gap.
  // Require a fresh player sample after it, including on app foregrounding.
  if (elapsedMs > 100) return { ...clock, running: false, correction: 0 };
  const elapsed = Math.min(elapsedMs, Math.max(0, maximumSampleAgeMs - clock.ageMs));
  const seconds = elapsed / 1000;
  const adjustment = Math.max(-seconds * 0.15, Math.min(seconds * 0.15, clock.correction * (1 - Math.exp(-elapsed / 120))));
  const position = Math.max(0, Math.min(duration, clock.position + seconds + adjustment));
  const ageMs = clock.ageMs + elapsedMs;
  // No advancing samples means a stall, even if an older native binary still
  // reports its desired playback rate as playing while it buffers.
  return { ...clock, position, ageMs, correction: clock.correction - adjustment,
    running: ageMs < maximumSampleAgeMs && position < duration };
}

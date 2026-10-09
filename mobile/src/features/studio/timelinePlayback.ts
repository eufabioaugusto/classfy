// AVPlayer sends time at 15 Hz (Expo's fallback at 10 Hz). These samples
// synchronize a visual clock; they are not animation frames or seek commands.
export type StudioTimelinePlaybackClock = {
  position: number;
  samplePosition: number;
  ageMs: number;
  correction: number;
  running: boolean;
  stalled: boolean;
  rate: number;
  rateSamples: number;
  frameTimestamp: number | null;
};

const maximumSampleAgeMs = 250;
const maximumPredictionLeadSeconds = 0.12;
const unconfirmedEndFrameSeconds = 1 / 30;

export function resetStudioTimelinePlayback(position: number, duration: number, running = false): StudioTimelinePlaybackClock {
  'worklet';
  const bounded = Math.max(0, Math.min(Math.max(0, duration), Number.isFinite(position) ? position : 0));
  return { position: bounded, samplePosition: bounded, ageMs: 0, correction: 0,
    running: running && bounded < duration, stalled: false, rate: 1, rateSamples: 0, frameTimestamp: null };
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
  // A positive media delta is not evidence of real-time playback. Simulator
  // decoding, buffering and sparse delivery can advance more slowly than wall
  // time while rate remains positive. Learn from advancing samples only; a
  // burst or an expired/dropped interval cannot establish a new playback rate.
  let rate = Number.isFinite(clock.rate) ? clock.rate : 1;
  let rateSamples = Number.isFinite(clock.rateSamples) ? clock.rateSamples : 0;
  if (clock.ageMs >= 8 && clock.ageMs <= maximumSampleAgeMs) {
    // Delivery jitter can alternate a long interval with a fast burst. Keep
    // that burst in the average; clipping each observation at1 would bias
    // otherwise normal playback permanently below its real rate.
    const observed = Math.max(0, Math.min(2, (sample.position - clock.samplePosition) * 1000 / clock.ageMs));
    rate = rateSamples === 0 ? observed : rate + (observed - rate) * 0.25;
    rateSamples += 1;
  }
  const drift = sample.position - clock.position;
  return { ...clock, samplePosition: sample.position, ageMs: 0, correction: drift, running: true, stalled: false, rate, rateSamples };
}

export function advanceStudioTimelinePlayback(clock: StudioTimelinePlaybackClock, elapsedMs: number | null, duration: number, frameTimestamp?: number): StudioTimelinePlaybackClock {
  'worklet';
  if (!clock.running && !clock.stalled) return clock;
  let interval = elapsedMs;
  const timestamp = frameTimestamp !== undefined && Number.isFinite(frameTimestamp) ? frameTimestamp : null;
  const previousTimestamp = Number.isFinite(clock.frameTimestamp) ? clock.frameTimestamp : null;
  if (timestamp !== null && previousTimestamp !== null) {
    if (timestamp <= previousTimestamp) return clock;
    interval = timestamp - previousTimestamp;
  }
  if (interval === null) return timestamp !== null ? { ...clock, frameTimestamp: timestamp } : clock;
  if (!Number.isFinite(interval) || interval <= 0) return clock;
  const ageMs = clock.ageMs + interval;
  const nextTimestamp = timestamp ?? previousTimestamp;
  // Count wall time even while prediction is frozen. Recovery must measure
  // the interval between media samples, rather than just moving UI frames.
  if (!clock.running) return { ...clock, ageMs, frameTimestamp: nextTimestamp };
  // A suspended/dropped UI frame cannot justify jumping across a long gap.
  // Require a fresh player sample after it, including on app foregrounding.
  if (interval > 100) return { ...clock, ageMs, frameTimestamp: nextTimestamp, running: false, stalled: true, correction: 0 };
  const elapsed = Math.min(interval, Math.max(0, maximumSampleAgeMs - clock.ageMs));
  const seconds = elapsed / 1000;
  const rate = Math.max(0, Math.min(1, Number.isFinite(clock.rate) ? clock.rate : 1));
  const adjustmentLimit = seconds * rate * 0.15;
  const adjustment = Math.max(-adjustmentLimit, Math.min(adjustmentLimit, clock.correction * (1 - Math.exp(-elapsed / 120))));
  // Never manufacture seconds beyond the latest decoder sample. Preserve an
  // already displayed position until media catches up, rather than rewinding
  // during Play. Leave an output frame before EOF until native confirms it.
  const end = Math.max(clock.samplePosition, Math.max(0, duration - Math.min(unconfirmedEndFrameSeconds, Math.max(0, duration) / 2)));
  const limit = Math.min(end, clock.samplePosition + maximumPredictionLeadSeconds);
  const position = Math.max(clock.position, Math.min(limit, clock.position + seconds * rate + adjustment));
  // No advancing samples means a stall, even if an older native binary still
  // reports its desired playback rate as playing while it buffers.
  const running = ageMs < maximumSampleAgeMs && position < limit - 1e-9;
  return { ...clock, position, ageMs, correction: clock.correction - adjustment,
    frameTimestamp: nextTimestamp, running, stalled: !running && clock.samplePosition < duration };
}

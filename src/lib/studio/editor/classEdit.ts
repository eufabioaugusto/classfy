import { studioAudioWindows, type StudioAudioWindow } from './audioEnvelope';

export type StudioPause = { start: number; end: number };

const minimumPause = .9;
const breathingRoom = .2;

// Decode a packet at a time to avoid holding the whole recording in memory.
export async function findStudioPauses(file: Blob, start: number, end: number, signal: AbortSignal): Promise<StudioPause[]> {
  const windows: StudioAudioWindow[] = [];
  const histogram = new Uint32Array(91);
  for await (const window of studioAudioWindows(file, start, end, signal)) {
    histogram[Math.round(window.level) + 90]++;
    windows.push(window);
  }
  if (!windows.length) throw new Error('O Class Edit não conseguiu ler amostras de áudio neste trecho.');
  const percentile = (fraction: number) => {
    const rank = Math.max(1, Math.ceil(windows.length * fraction));
    let count = 0;
    return histogram.findIndex(size => (count += size) >= rank) - 90;
  };
  // Allow room tone above the old fixed gate, but keep the gate well below
  // foreground audio. A flat or entirely quiet track never produces a cut.
  const noiseFloor = percentile(.2), foreground = percentile(.9);
  const threshold = Math.min(-30, foreground - 10, Math.max(-42, noiseFloor + 12));
  const pauses: StudioPause[] = [];
  const hasForeground = windows.reduce((seconds, window) =>
    window.level >= threshold + 6 ? seconds + window.end - window.start : seconds, 0) >= .16;
  if (!hasForeground) return [];
  let heardSound = false;
  let continuousFromStart = windows[0].start - start <= .05;
  let quietSince: number | undefined;
  let previousEnd = start;
  for (const window of windows) {
    if (window.start - previousEnd > .03) {
      heardSound = false;
      continuousFromStart = false;
      quietSince = undefined;
    }
    previousEnd = window.end;
    if (window.level < threshold) {
      if (heardSound || continuousFromStart) quietSince ??= window.start;
    } else {
      if (quietSince !== undefined && window.start - quietSince >= minimumPause) {
        pauses.push({ start: heardSound ? quietSince + breathingRoom : start, end: window.start - breathingRoom });
      }
      heardSound = true;
      quietSince = undefined;
    }
  }
  if (heardSound && quietSince !== undefined && end - previousEnd <= .05 && end - quietSince >= minimumPause) {
    pauses.push({ start: quietSince + breathingRoom, end });
  }
  return pauses;
}

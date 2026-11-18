import { studioAudioWindows, type StudioAudioWindow } from './audioEnvelope';

export type StudioPause = { start: number; end: number };

export const minimumStudioPause = .35;
const breathingRoom = .005;

// Decode a packet at a time to avoid holding the whole recording in memory.
export async function findStudioPauses(file: Blob, start: number, end: number, signal: AbortSignal): Promise<StudioPause[]> {
  const windows: StudioAudioWindow[] = [];
  const histogram = new Uint32Array(91);
  for await (const window of studioAudioWindows(file, start, end, signal)) {
    histogram[Math.round(window.level) + 90]++;
    windows.push(window);
  }
  if (!windows.length) throw new Error('O ClassCut não conseguiu ler amostras de áudio neste trecho.');
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
  const addPause = (from: number, to: number) => {
    const previous = pauses.at(-1)?.end ?? start;
    // A retained fragment must satisfy the Studio clip duration contract.
    if ((from === start || from - previous >= .1) && (to === end || end - to >= .1)) pauses.push({ start: from, end: to });
  };
  const hasForeground = windows.reduce((seconds, window) =>
    window.level >= threshold + 6 ? seconds + window.end - window.start : seconds, 0) >= .16;
  if (!hasForeground) return [];
  const runs: (StudioAudioWindow & { quiet: boolean })[] = [];
  for (const window of windows) {
    const quiet = window.level < threshold;
    const last = runs.at(-1);
    if (last?.quiet === quiet && window.start - last.end <= .03) last.end = window.end;
    else runs.push({ ...window, quiet });
  }

  // A click or bump inside otherwise sustained room tone should not keep a silent clip.
  for (let i = 1; i + 1 < runs.length;) {
    const [left, spike, right] = runs.slice(i - 1, i + 2);
    if (left.quiet && !spike.quiet && right.quiet && spike.end - spike.start <= .1
      && spike.start - left.end <= .03 && right.start - spike.end <= .03
      && right.end - left.start >= minimumStudioPause) {
      left.end = right.end;
      runs.splice(i, 2);
    } else i++;
  }
  for (const [i, run] of runs.entries()) {
    if (!run.quiet || run.end - run.start < minimumStudioPause) continue;
    const leading = i === 0 && run.start - start <= .05;
    const trailing = i === runs.length - 1 && end - run.end <= .05;
    if (leading && trailing) continue;
    if (!leading && (!runs[i - 1] || run.start - runs[i - 1].end > .03)) continue;
    if (!trailing && (!runs[i + 1] || runs[i + 1].start - run.end > .03)) continue;
    addPause(leading ? start : run.start + breathingRoom, trailing ? end : run.end - breathingRoom);
  }
  return pauses;
}

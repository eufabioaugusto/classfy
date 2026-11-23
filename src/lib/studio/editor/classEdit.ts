import { studioAudioWindows, type StudioAudioWindow } from './audioEnvelope';

export type StudioPause = { start: number; end: number };

export const minimumStudioPause = .35;
const speechTail = .18;
const speechLead = .10;

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
  // A quiet syllable can be far below foreground speech. Put the gate
  // close to the measured background, while preserving contrast on flat tracks.
  const noiseFloor = percentile(.05), foreground = percentile(.9);
  const threshold = Math.min(-30, foreground - 14, Math.max(-56, noiseFloor + 6));
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
    if (last?.quiet === quiet && window.start - last.end <= .03) {
      last.end = window.end;
      last.level = Math.max(last.level, window.level);
    }
    else runs.push({ ...window, quiet });
  }

  // A click or bump inside otherwise sustained room tone should not keep a silent clip.
  for (let i = 1; i + 1 < runs.length;) {
    const [left, spike, right] = runs.slice(i - 1, i + 2);
    if (left.quiet && !spike.quiet && right.quiet && spike.end - spike.start <= .085
      && spike.level >= threshold + 16 && spike.start - left.start >= .18 && right.end - spike.end >= .18
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
    addPause(leading ? start : run.start + speechTail, trailing ? end : run.end - speechLead);
  }
  return pauses;
}

import { studioAudioWindows, type StudioAudioWindow } from './audioEnvelope';

export type StudioPause = { start: number; end: number };

export const minimumStudioPause = .25;
const speechContinuityGap = .12;

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
  const runs: (StudioAudioWindow & { quiet: boolean; foregroundSeconds: number })[] = [];
  for (const window of windows) {
    const quiet = window.level < threshold;
    const foregroundSeconds = window.level >= threshold + 8 ? window.end - window.start : 0;
    const last = runs.at(-1);
    if (last?.quiet === quiet && window.start - last.end <= .03) {
      last.end = window.end;
      last.level = Math.max(last.level, window.level);
      last.foregroundSeconds += foregroundSeconds;
    } else runs.push({ ...window, quiet, foregroundSeconds });
  }

  // Group activity separated by small dips so a weak onset or final syllable
  // stays attached to nearby speech. Reject short, isolated room-noise bursts.
  const activity = runs.filter(run => !run.quiet);
  for (let from = 0; from < activity.length;) {
    let to = from;
    let foregroundSeconds = activity[from].foregroundSeconds;
    let activeSeconds = activity[from].end - activity[from].start;
    let peak = activity[from].level;
    while (to + 1 < activity.length && activity[to + 1].start - activity[to].end < speechContinuityGap) {
      const next = activity[++to];
      foregroundSeconds += next.foregroundSeconds;
      activeSeconds += next.end - next.start;
      peak = Math.max(peak, next.level);
    }
    const likelySpeech = foregroundSeconds > .085 || activeSeconds >= .3 ||
      (activeSeconds >= .1 && peak >= threshold + 5);
    if (!likelySpeech) {
      for (let index = from; index <= to; index++) activity[index].quiet = true;
    }
    from = to + 1;
  }

  const confirmed: typeof runs = [];
  for (const run of runs) {
    const previous = confirmed.at(-1);
    if (previous?.quiet === run.quiet && run.start - previous.end <= .03) previous.end = run.end;
    else confirmed.push(run);
  }
  for (const [index, run] of confirmed.entries()) {
    if (!run.quiet || run.end - run.start < minimumStudioPause) continue;
    const leading = index === 0 && run.start - start <= .05;
    const trailing = index === confirmed.length - 1 && end - run.end <= .05;
    if (leading && trailing) continue;
    if (!leading && (!confirmed[index - 1] || run.start - confirmed[index - 1].end > .03)) continue;
    if (!trailing && (!confirmed[index + 1] || confirmed[index + 1].start - run.end > .03)) continue;
    addPause(leading ? start : run.start, trailing ? end : run.end);
  }
  return pauses;
}

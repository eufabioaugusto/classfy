import type { StudioCaptionCue } from './studioCaptions';

type Attempt = StudioCaptionCue & { words: string[] };
export type StudioRetakeGroup = StudioCaptionCue[];

function matchingWords(a: string[], b: string[]) {
  const row = new Uint8Array(b.length + 1);
  for (const word of a) {
    let diagonal = 0;
    for (let i = 1; i <= b.length; i++) {
      const previous = row[i];
      row[i] = word === b[i - 1] ? diagonal + 1 : Math.max(row[i], row[i - 1]);
      diagonal = previous;
    }
  }
  return row[b.length];
}

export function findStudioRetakes(cues: readonly StudioCaptionCue[]): StudioRetakeGroup[] {
  const attempts: Attempt[] = [];
  for (let i = 0; i < cues.length; i++) {
    const start = cues[i].start;
    let text = '';
    for (let j = i; j < Math.min(cues.length, i + 3); j++) {
      const cue = cues[j];
      if (cue.end - start > 12 || j > i && cue.start - cues[j - 1].end > 1) break;
      text = (text + ' ' + cue.text).trim();
      const words = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      if (words.length >= 5 && words.length <= 48) attempts.push({ text, start, end: cue.end, words });
    }
  }

  const matches: { a: Attempt; b: Attempt; score: number }[] = [];
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    for (let j = i + 1; j < attempts.length; j++) {
      const b = attempts[j];
      if (b.start - a.end > 60) break;
      if (b.start < a.end || Math.min(a.words.length, b.words.length) / Math.max(a.words.length, b.words.length) < .65) continue;
      const shared = matchingWords(a.words, b.words);
      if (shared >= 5 && shared / Math.max(a.words.length, b.words.length) >= .75 &&
        shared / Math.min(a.words.length, b.words.length) >= .85) matches.push({ a, b, score: shared });
    }
  }

  const groups: Attempt[][] = [];
  const overlaps = (a: Attempt, b: Attempt) => a.start < b.end && b.start < a.end;
  for (const { a, b } of matches.sort((left, right) => right.score - left.score)) {
    const group = groups.find(entries => entries.some(entry => entry === a || entry === b));
    const additions = [a, b].filter(attempt => !group?.includes(attempt));
    if (additions.some(attempt => groups.some(entries => entries.some(entry => overlaps(attempt, entry))))) continue;
    if (group) group.push(...additions);
    else groups.push([a, b]);
  }
  return groups.map(group => group.sort((a, b) => a.start - b.start)
    .map(({ text, start, end }) => ({ text, start, end }))).sort((a, b) => a[0].start - b[0].start);
}

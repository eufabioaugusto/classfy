import type { StudioCaptionCue, StudioCaptionWord } from './studioCaptions';

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

const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function matchTimedPhrases(timed: readonly StudioCaptionWord[]) {
  const words = timed.flatMap(({ text, timestamp: [start, end] }) =>
    normalize(text).map(word => ({ text: text.trim(), word, start, end: end ?? start + .5 })));
  const positions = new Map<string, number[]>();
  const attempts = new Map<string, Attempt>();
  const matches: { a: Attempt; b: Attempt; score: number }[] = [];
  const continuous = (index: number) => index > 0 && words[index].start - words[index - 1].end <= 1;
  const attempt = (start: number, end: number) => {
    const key = `${start}:${end}`;
    const existing = attempts.get(key);
    if (existing) return existing;
    const span = words.slice(start, end);
    const value = { start: span[0].start, end: span[span.length - 1].end,
      text: span.map(word => word.text).join(' '), words: span.map(word => word.word) };
    attempts.set(key, value);
    return value;
  };

  const seedLength = 5;
  for (let i = 0; i + seedLength <= words.length; i++) {
    const seed = words.slice(i, i + seedLength);
    if (!seed.slice(1).every((_, index) => continuous(i + index + 1))) continue;
    const key = seed.map(word => word.word).join(' ');
    const previous = (positions.get(key) ?? []).filter(index => words[i].start - words[index].start <= 60);
    positions.set(key, [...previous, i]);
    for (const start of previous) {
      if (start + seedLength > i || words[start + seedLength - 1].end > words[i].start) continue;
      // Only the first seed of a longer exact match should propose the cut.
      if (continuous(start) && continuous(i) && words[start - 1].word === words[i - 1].word) continue;
      let length = seedLength;
      while (length < 48 && i + length < words.length && start + length < i &&
        continuous(start + length) && continuous(i + length) &&
        words[start + length].end <= words[i].start &&
        words[i + length].end - words[i].start <= 12 &&
        words[start + length].word === words[i + length].word) length++;
      const a = attempt(start, start + length), b = attempt(i, i + length);
      if (a.end - a.start <= 12 && b.end - b.start <= 12) matches.push({ a, b, score: length });
    }
  }
  return matches;
}

function matchFalseStarts(cues: readonly StudioCaptionCue[]) {
  const matches: { a: Attempt; b: Attempt; score: number }[] = [];
  const isIncomplete = (cue: StudioCaptionCue) => /(?:\.{3}|…)\s*$/.test(cue.text);
  const attempts = cues.map(cue => ({ ...cue, words: normalize(cue.text) }));
  for (let i = 0; i < attempts.length; i++) {
    const first = attempts[i];
    if (!isIncomplete(first) || first.words.length < 2) continue;
    const prefix = first.words.slice(0, 2).join(' ');
    const group = [first];
    for (let j = i + 1; j < attempts.length && attempts[j].start - first.start <= 8; j++) {
      const next = attempts[j];
      if (next.words.slice(0, 2).join(' ') !== prefix) continue;
      group.push(next);
      if (!isIncomplete(next) && next.words.length >= 4) break;
    }
    // A short common prefix alone is weak evidence. Require multiple interrupted starts.
    if (group.filter(isIncomplete).length < 2 || group.length < 3) continue;
    const last = group[group.length - 1];
    const continuation = attempts[attempts.indexOf(last) + 1];
    if (!/[.!?…]$/.test(last.text) && continuation && continuation.start - last.end <= .25 && continuation.end - last.start <= 8) {
      group[group.length - 1] = { ...last, end: continuation.end, text: last.text + ' ' + continuation.text };
    }
    for (const b of group.slice(1)) matches.push({ a: first, b, score: 2 });
  }
  return matches;
}

export function findStudioRetakes(cues: readonly StudioCaptionCue[], words: readonly StudioCaptionWord[] = []): StudioRetakeGroup[] {
  const attempts: Attempt[] = [];
  for (let i = 0; i < cues.length; i++) {
    const start = cues[i].start;
    let text = '';
    for (let j = i; j < Math.min(cues.length, i + 3); j++) {
      const cue = cues[j];
      if (cue.end - start > 12 || j > i && cue.start - cues[j - 1].end > 1) break;
      text = (text + ' ' + cue.text).trim();
      const words = normalize(text);
      if (words.length >= 5 && words.length <= 48) attempts.push({ text, start, end: cue.end, words });
    }
  }

  const matches = [...matchTimedPhrases(words), ...matchFalseStarts(cues)];
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

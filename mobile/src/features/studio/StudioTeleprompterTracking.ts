export type StudioTeleprompterWord = { index: number; text: string; normalized: string; start: number; end: number; punctuation: string };
export type StudioTeleprompterMatch = { readWordCount: number; offset: number; matched: boolean; confidence: number };
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/['’]/g, '').toLocaleLowerCase('pt-BR');
export function tokenizeStudioTeleprompterScript(script: string): StudioTeleprompterWord[] {
  const words = [...script.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];
  return words.map((word, index) => ({ index, text: word[0], normalized: normalize(word[0]), start: word.index!, end: word.index! + word[0].length, punctuation: script.slice(word.index! + word[0].length, words[index + 1]?.index ?? script.length) }));
}
const common = new Set('a o as os um uma uns umas de da do das dos e é em na no nas nos por para pra com sem que se eu tu ele ela eles elas nós nos você voces meu minha seu sua isso isto esse essa aqui ali já mais mas muito bem então hoje vamos sobre ao à às aos não sim como quando porque foi ser está tem ter'.split(' ').map(normalize));
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return 0;
  // A single small substitution/inflection is useful for ASR; short common words require exact matches.
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return 0;
    if (a.length >= b.length) i++; if (b.length >= a.length) j++;
  }
  edits += a.length - i + b.length - j; return edits <= 1 ? .82 : 0;
}
type Alignment = { score: number; matches: number; exact: number; distinct: number; lastMatched: boolean };
/** A bounded local alignment follows revisions of one interim segment from the same frozen origin. */
export function createStudioTeleprompterMatcher(script: string, initialIndex = 0) {
  const tokens = tokenizeStudioTeleprompterScript(script); let index = Math.max(0, Math.min(tokens.length, Math.floor(Number.isFinite(initialIndex) ? initialIndex : 0))), segment: string | number | null = null, base = index, consumedSpeech = 0;
  const finalized = new Set<string | number>();
  const position = (matched = false, confidence = 0): StudioTeleprompterMatch => ({ readWordCount: index, offset: tokens[index]?.start ?? script.length, matched, confidence });
  return {
    tokens,
    reset(next = 0) { index = Math.max(0, Math.min(tokens.length, Math.floor(Number.isFinite(next) ? next : 0))); base = index; consumedSpeech = 0; segment = null; finalized.clear(); return position(); },
    follow(update: { text: string; final?: boolean; confidence?: number | null; segmentId?: string | number }): StudioTeleprompterMatch {
      if (update.segmentId !== undefined) {
        if (finalized.has(update.segmentId)) return position();
        if (update.final) {
          finalized.add(update.segmentId);
          // The adapter drops the whole immutable final prefix; this bounded history also protects direct callers.
          if (finalized.size > 128) finalized.delete(finalized.values().next().value!);
        }
      }
      if (!tokens.length || index === tokens.length) return position();
      if (update.segmentId !== undefined && segment !== update.segmentId) { segment = update.segmentId; base = index; consumedSpeech = 0; }
      if (update.segmentId === undefined) { base = index; consumedSpeech = 0; }
      const allSpoken = tokenizeStudioTeleprompterScript(update.text).map(token => token.normalized); if (allSpoken.length < 2) return position();
      if (update.final && update.confidence !== null && update.confidence !== undefined && update.confidence > 0 && update.confidence < .35) return position();
      let progressed = false, acceptedConfidence = 0;
      // Keep four recognized words as context instead of arbitrarily dropping the beginning of a cumulative result.
      // Up to eight bounded windows handle unusually long final results without matching the whole script.
      for (let window = 0; window < 8; window++) {
      const speechOffset = Math.max(0, consumedSpeech - 4), spoken = allSpoken.slice(speechOffset, speechOffset + 64);
      if (spoken.length < 2) break;
      const alignmentBase = speechOffset > 0 ? index : base;
      let best: { end: number; spokenEnd: number; quality: number; rank: number } | null = null;
      const lower = Math.max(0, alignmentBase - 4), upper = Math.min(tokens.length - 1, alignmentBase + 5);
      for (let start = lower; start <= upper; start++) {
        const count = Math.min(tokens.length - start, spoken.length + 4, 68);
        let previous: Alignment[] = Array.from({ length: count + 1 }, (_, n) => ({ score: -n * .7, matches: 0, exact: 0, distinct: 0, lastMatched: false }));
        for (let m = 1; m <= spoken.length; m++) {
          const row: Alignment[] = [{ score: -m * .65, matches: 0, exact: 0, distinct: 0, lastMatched: false }];
          for (let n = 1; n <= count; n++) {
            const word = tokens[start + n - 1].normalized, match = similarity(spoken[m - 1], word), informative = !common.has(word);
            const diagonal = { score: previous[n - 1].score + (match ? match * (informative ? 1.4 : .7) : -1), matches: previous[n - 1].matches + (match ? 1 : 0), exact: previous[n - 1].exact + (match === 1 ? 1 : 0), distinct: previous[n - 1].distinct + (match && informative ? 1 : 0), lastMatched: !!match };
            const insertion = { ...previous[n], score: previous[n].score - .65, lastMatched: false }, omission = { ...row[n - 1], score: row[n - 1].score - .7, lastMatched: false };
            row[n] = [diagonal, insertion, omission].reduce((a, b) => b.score > a.score ? b : a);
            const value = row[n], quality = value.matches / Math.max(m, n), end = start + n;
            const shortExact = value.exact === 2 && n === 2 && m === 2 && start <= alignmentBase + 1;
            const commonPhrase = n >= 4 && m === n && value.exact === n && start >= alignmentBase - 1 && start <= alignmentBase + 1;
            const anchoredShortPhrase = n === 3 && m === n && value.exact === n && start === alignmentBase
              && (!update.final || update.confidence === undefined || (update.confidence ?? 0) >= .6);
            if (!value.lastMatched || value.distinct < 2 && !commonPhrase && !anchoredShortPhrase || value.matches < (shortExact ? 2 : 3) || quality < (update.final ? .64 : .74)) continue;
            // Prefer a longer, well-supported phrase near the current line; a common isolated word can never jump ahead.
            const rank = value.score + value.matches * .12 - Math.abs(start - alignmentBase) * .3;
            if (!best || rank > best.rank + .001) best = { end, spokenEnd: m, quality, rank };
          }
          previous = row;
        }
      }
      if (!best || best.end <= index) break;
      index = Math.max(index, best.end); consumedSpeech = Math.max(consumedSpeech, speechOffset + best.spokenEnd); progressed = true; acceptedConfidence = best.quality;
      if (speechOffset + spoken.length >= allSpoken.length || index === tokens.length) break;
      }
      return position(progressed, acceptedConfidence);
    },
  };
}

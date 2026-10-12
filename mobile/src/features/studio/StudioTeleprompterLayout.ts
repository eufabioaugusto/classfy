export type StudioTeleprompterWord = { index: number; start: number; end: number; text: string };
export type StudioTeleprompterBlock = { key: number; text: string; start: number; end: number; firstWord: number; lastWord: number };
export type StudioTeleprompterLine = { start: number; end: number; y: number; height: number };

/** Bound Text nodes, but preserve the exact script offsets used by speech. */
export function studioTeleprompterBlocks(script: string, words: readonly StudioTeleprompterWord[], maxCharacters = 700): StudioTeleprompterBlock[] {
  if (!script) return [];
  const blocks: StudioTeleprompterBlock[] = [];
  let start = 0, firstWord = 0;
  while (start < script.length) {
    let end = Math.min(script.length, start + Math.max(100, maxCharacters));
    if (end < script.length) {
      // Never split a lexical word; whitespace belongs to the preceding block.
      const next = words.find(word => word.start < end && word.end > end);
      if (next) end = next.end;
      while (end < script.length && /\s/.test(script[end])) end++;
    }
    let lastWord = firstWord - 1;
    while (lastWord + 1 < words.length && words[lastWord + 1].start < end) lastWord++;
    blocks.push({ key: start, text: script.slice(start, end), start, end, firstWord, lastWord });
    firstWord = lastWord + 1; start = end;
  }
  return blocks;
}

/** Map UIKit's actual wrapped lines to original character positions, never a word percentage. */
export function studioTeleprompterLines(block: StudioTeleprompterBlock, lines: readonly { text: string; y: number; height: number }[]): StudioTeleprompterLine[] {
  let cursor = 0;
  return lines.map(line => {
    const text = line.text.trim();
    const found = text ? block.text.indexOf(text, cursor) : cursor;
    const start = found < 0 ? cursor : found;
    const end = Math.min(block.text.length, start + (text || line.text).length);
    cursor = Math.max(cursor, end);
    return { start: block.start + start, end: block.start + end, y: line.y, height: line.height };
  });
}

export function studioTeleprompterReadEnd(block: StudioTeleprompterBlock, words: readonly StudioTeleprompterWord[], readWordCount: number) {
  const spoken = Math.min(block.lastWord, Math.max(-1, Math.floor(readWordCount) - 1));
  return spoken < block.firstWord ? 0 : Math.min(block.text.length, Math.max(0, words[spoken].end - block.start));
}

export function studioTeleprompterScrollTarget(
  character: number, measured: readonly { top: number; lines: readonly StudioTeleprompterLine[] }[], viewport: number, content: number,
) {
  for (const block of measured) {
    const line = block.lines.find(value => character >= value.start && character < value.end)
      || block.lines.find(value => character < value.start);
    if (!line) continue;
    return Math.max(0, Math.min(Math.max(0, content - viewport), block.top + line.y));
  }
  return null;
}

export function studioTeleprompterFrame({ width, height, top, left, right, landscape, immersive }: {
  width: number; height: number; top: number; left: number; right: number; landscape: boolean; immersive: boolean;
}) {
  const inset = Math.max(left, right, 18);
  const available = Math.max(120, width - 2 * inset);
  const frameWidth = landscape ? Math.min(620, Math.max(160, available - 150)) : available;
  return { top: top + (immersive ? 50 : 76), left: (width - frameWidth) / 2, width: frameWidth,
    maxTextHeight: landscape ? Math.max(56, Math.min(110, height * 0.25)) : Math.max(76, Math.min(128, height * 0.19)) };
}

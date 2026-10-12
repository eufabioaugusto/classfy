import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeStudioTeleprompterScript } from './StudioTeleprompterTracking.ts';
import { studioTeleprompterBlocks, studioTeleprompterLines, studioTeleprompterReadEnd, studioTeleprompterScrollTarget, studioTeleprompterFrame } from './StudioTeleprompterLayout.ts';

test('roteiro longo preserva cada caractere, os limites das palavras e blocos de texto limitados', () => {
  const script = 'Conexão interior: meditação e gratidão.\n\n'.repeat(1100);
  const words = tokenizeStudioTeleprompterScript(script), blocks = studioTeleprompterBlocks(script, words);
  assert.equal(blocks.map(block => block.text).join(''), script);
  assert.ok(blocks.length > 50 && blocks.length < 100);
  for (const block of blocks) {
    assert.equal(block.text, script.slice(block.start, block.end));
    assert.ok(block.text.length <= 720);
    assert.equal(words[block.firstWord].start >= block.start, true);
    assert.equal(words[block.lastWord].end <= block.end, true);
  }
});

test('palavras faladas recebem prefixo exato, preservando acentos, pontuação e quebras', () => {
  const script = 'Você já parou?\n\nA conexão começa aqui.';
  const words = tokenizeStudioTeleprompterScript(script), [block] = studioTeleprompterBlocks(script, words);
  assert.equal(studioTeleprompterReadEnd(block, words, 0), 0);
  assert.equal(block.text.slice(0, studioTeleprompterReadEnd(block, words, 2)), 'Você já');
  assert.equal(block.text.slice(0, studioTeleprompterReadEnd(block, words, 5)), 'Você já parou?\n\nA conexão');
  assert.equal(block.text.slice(0, studioTeleprompterReadEnd(block, words, 99)), 'Você já parou?\n\nA conexão começa aqui');
});

test('rolagem usa linha medida, inclusive linhas repetidas, em vez da proporção de palavras', () => {
  const script = 'Medite agora.\nMedite agora.\nRespire tranquilamente e observe sua mente.';
  const words = tokenizeStudioTeleprompterScript(script), [block] = studioTeleprompterBlocks(script, words);
  const lines = studioTeleprompterLines(block, [
    { text: 'Medite agora.', y: 0, height: 28 }, { text: 'Medite agora.', y: 36, height: 28 },
    { text: 'Respire tranquilamente', y: 72, height: 40 }, { text: 'e observe sua mente.', y: 112, height: 40 },
  ]);
  assert.equal(lines[1].start, script.indexOf('Medite', 1));
  assert.equal(studioTeleprompterScrollTarget(words[4].start, [{ top: 200, lines }], 128, 600), 272);
  assert.equal(studioTeleprompterScrollTarget(words[6].start, [{ top: 200, lines }], 128, 600), 312, 'Align the current line exactly; no fragments of the previous line remain at the top');
  assert.equal(studioTeleprompterScrollTarget(words[6].start, [{ top: 200, lines }], 128, 280), 152, 'Clamp to actual content extent');
  assert.equal(studioTeleprompterScrollTarget(words[6].start, [], 128, 600), null, 'Await real layout rather than guessing');
});

test('vertical mantém o eixo central e box logo abaixo do timer em diferentes safe areas', () => {
  for (const device of [{ width: 393, height: 852, top: 59, left: 0, right: 0 }, { width: 375, height: 667, top: 20, left: 0, right: 0 }, { width: 430, height: 932, top: 59, left: 34, right: 0 }]) {
    const frame = studioTeleprompterFrame({ ...device, landscape: false, immersive: true });
    assert.equal(frame.left + frame.width / 2, device.width / 2);
    assert.equal(frame.top, device.top + 50);
    assert.ok(frame.maxTextHeight >= 76 && frame.maxTextHeight <= 128);
  }
  const horizontal = studioTeleprompterFrame({ width: 844, height: 390, top: 14, left: 47, right: 0, landscape: true, immersive: false });
  assert.ok(horizontal.width > 0 && horizontal.maxTextHeight > 0);
  assert.equal(horizontal.left + horizontal.width / 2, 422);
});

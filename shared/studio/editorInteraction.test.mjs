// Ported from the mobile pure-core regressions; domain imports execute the extracted production TypeScript.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { splitStudioTake } from './timeline.ts';
import { captureStudioPlaybackAnchor, restoreStudioPlaybackAnchor, studioSourceFrame } from './editorInteraction.ts';

const take = (id, start = 2, end = 8, uri = `file:///${id}.mp4`) => ({ id, uri, name: id, duration: 10, start, end });
const position = (takeId, sourcePosition, global) => ({ takeId, sourcePosition, position: global });

test('cortar um take anterior conserva o frame original e muda só o deslocamento global', () => {
  const original = [take('a'), take('b')];
  const anchor = captureStudioPlaybackAnchor(original, position('b', 5, 9));
  assert.deepEqual(restoreStudioPlaybackAnchor([take('a', 4, 8), take('b')], anchor), {
    position: 7, source: { takeId: 'b', uri: 'file:///b.mp4', seconds: 5 },
  });
  assert.equal(restoreStudioPlaybackAnchor(original, anchor).position, 9);
});
test('cortar o frame ancorado conserva o ponto possível mais próximo, inclusive o fim exato', () => {
  const original = [take('a'), take('b')];
  const anchor = captureStudioPlaybackAnchor(original, position('b', 7, 11));
  assert.deepEqual(restoreStudioPlaybackAnchor([take('a'), take('b', 3.3, 5.6)], anchor), {
    position: 8.3, source: { takeId: 'b', uri: 'file:///b.mp4', seconds: 5.6 },
  });
  const beforeStart = captureStudioPlaybackAnchor(original, position('b', 2.5, 6.5));
  assert.equal(restoreStudioPlaybackAnchor([take('a'), take('b', 3.3, 5.6)], beforeStart).source.seconds, 3.3);
});
test('dividir mantém o ponto e encontra o novo ID do lado direito da fronteira', () => {
  const original = [take('a')];
  const anchor = captureStudioPlaybackAnchor(original, position('a', 5, 3));
  const divided = splitStudioTake(original, 'a', 5, 'left', 'right');
  assert.deepEqual(restoreStudioPlaybackAnchor(divided, anchor), {
    position: 3, source: { takeId: 'right', uri: 'file:///a.mp4', seconds: 5 },
  });
});
test('duplicar e reordenar conservam identidade e frame mesmo quando o índice muda', () => {
  const original = [take('a'), take('b')];
  const anchor = captureStudioPlaybackAnchor(original, position('b', 5, 9));
  assert.equal(restoreStudioPlaybackAnchor([take('a'), { ...take('a'), id: 'copy' }, take('b')], anchor).position, 15);
  assert.deepEqual(restoreStudioPlaybackAnchor([take('b'), take('a')], anchor), {
    position: 3, source: { takeId: 'b', uri: 'file:///b.mp4', seconds: 5 },
  });
});
test('fonte substituída ou take excluído não reutiliza tempo absoluto de outra mídia', () => {
  const original = [take('a'), take('b')];
  const anchor = captureStudioPlaybackAnchor(original, position('b', 7, 11));
  const replaced = [take('a'), take('b', 0, 4, 'file:///different.mp4')];
  assert.deepEqual(restoreStudioPlaybackAnchor(replaced, anchor), {
    position: 10, source: { takeId: 'b', uri: 'file:///different.mp4', seconds: 4 },
  });
  assert.equal(restoreStudioPlaybackAnchor([take('a')], anchor).position, 6);
});
test('prévia da borda pode expandir o corte sem alterar a montagem salva', () => {
  const original = [take('a', 3, 7)];
  assert.deepEqual(studioSourceFrame(original, { takeId: 'a', uri: 'file:///a.mp4', seconds: 1 }), { takeId: 'a', uri: 'file:///a.mp4', seconds: 1 });
  assert.equal(studioSourceFrame(original, { takeId: 'a', uri: 'file:///a.mp4', seconds: 12 }).seconds, 10);
  assert.equal(studioSourceFrame(original, { takeId: 'a', uri: 'file:///other.mp4', seconds: 4 }), null);
  assert.equal(studioSourceFrame(original, { takeId: 'gone', uri: 'file:///a.mp4', seconds: 4 }), null);
  assert.equal(studioSourceFrame(original, { takeId: 'a', uri: 'file:///a.mp4', seconds: NaN }), null);
  assert.equal(original[0].start, 3);
});
test('editor vazio e posição inválida são seguros ao capturar ou restaurar', () => {
  assert.equal(captureStudioPlaybackAnchor([], position(undefined, 0, 0)), null);
  assert.equal(restoreStudioPlaybackAnchor([], null), null);
  assert.equal(restoreStudioPlaybackAnchor([take('a')], null), null);
  assert.equal(captureStudioPlaybackAnchor([take('a')], position(undefined, NaN, NaN)).sourceSeconds, 2);
});

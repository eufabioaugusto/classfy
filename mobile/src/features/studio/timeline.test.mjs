import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateStudioTake, locateStudioTime, moveStudioTake, removeStudioTake, splitStudioTake, studioPreviewSourceTime } from './timeline.ts';
const take = (id, start = 2, end = 8) => ({ id, uri: 'file:///original.mp4', name: 'Original', duration: 10, start, end, thumbnailUri: 'file:///original.jpg' });

test('editor vazio sob a câmera não lê seconds de seek nulo ao abrir teleprompter', () => {
  assert.equal(studioPreviewSourceTime(undefined, null), 0);
  assert.equal(studioPreviewSourceTime(undefined, { takeId: 'removido', seconds: 4 }), 0);
  assert.equal(studioPreviewSourceTime(take('a'), null), 2);
  assert.equal(studioPreviewSourceTime(take('a'), { takeId: 'b', seconds: 5 }), 2);
  assert.equal(studioPreviewSourceTime(take('a'), { takeId: 'a', seconds: 5 }), 5);
  assert.equal(studioPreviewSourceTime(take('a'), { takeId: 'a', seconds: 20 }), 8);
});

test('split mantém mídia original, duração e continuidade em dois IDs novos', () => {
  const original = [take('a'), take('b')];
  const result = splitStudioTake(original, 'a', 5, 'a-left', 'a-right');
  assert.deepEqual(result.map(t => [t.id, t.start, t.end]), [['a-left', 2, 5], ['a-right', 5, 8], ['b', 2, 8]]);
  assert.ok(result.every(t => t.uri === 'file:///original.mp4' && t.duration === 10));
  assert.deepEqual(original.map(t => [t.id, t.start, t.end]), [['a', 2, 8], ['b', 2, 8]]);
});
test('split rejeita bordas, posições inválidas, IDs duplicados e take desaparecido', () => {
  const takes = [take('a'), take('b')];
  for (const point of [2, 8, 2.09, 7.91, NaN, Infinity]) assert.throws(() => splitStudioTake(takes, 'a', point, 'l', 'r'));
  assert.throws(() => splitStudioTake(takes, 'a', 5, 'l', 'l'));
  assert.throws(() => splitStudioTake(takes, 'a', 5, 'b', 'r'));
  assert.throws(() => splitStudioTake(takes, 'missing', 5, 'l', 'r'));
});
test('duplicar e remover alteram índice e preservam fonte referenciada por outros clips', () => {
  const original = [take('a')];
  const duplicate = duplicateStudioTake(original, 'a', 'copy');
  assert.deepEqual(duplicate.map(t => t.id), ['a', 'copy']);
  assert.notEqual(duplicate[0], duplicate[1]);
  assert.equal(duplicate[1].start, 2);
  const removed = removeStudioTake(duplicate, 'a');
  assert.equal(removed[0].uri, original[0].uri);
  assert.throws(() => duplicateStudioTake(original, 'a', 'a'));
});
test('reordenar por IDs não perde um take importado durante o gesto', () => {
  const latest = [take('a'), take('b'), take('imported')];
  assert.deepEqual(moveStudioTake(latest, 'b', 'a').map(t => t.id), ['b', 'a', 'imported']);
  assert.deepEqual(moveStudioTake(latest, 'a', null).map(t => t.id), ['b', 'imported', 'a']);
  assert.deepEqual(latest.map(t => t.id), ['a', 'b', 'imported']);
  assert.throws(() => moveStudioTake(latest, 'a', 'removed'));
});
test('scrub global encontra tempo absoluto da fonte e fronteira no próximo clip', () => {
  const takes = [take('a', 2, 5), take('b', 6, 10)];
  assert.equal(locateStudioTime(takes, 1).sourceSeconds, 3);
  assert.equal(locateStudioTime(takes, 3).takeId, 'b');
  assert.equal(locateStudioTime(takes, 3).sourceSeconds, 6);
  assert.equal(locateStudioTime(takes, 5).sourceSeconds, 8);
  assert.equal(locateStudioTime(takes, 99).sourceSeconds, 10);
  assert.equal(locateStudioTime(takes, -1).sourceSeconds, 2);
  assert.equal(locateStudioTime([], 0), undefined);
  assert.throws(() => locateStudioTime(takes, NaN));
});

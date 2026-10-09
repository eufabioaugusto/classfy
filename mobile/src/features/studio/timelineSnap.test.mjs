import test from 'node:test';
import assert from 'node:assert/strict';
import { snapStudioTimelineRange, studioTimelineSnapPoints, studioTimelineSnapTargets } from './timelineSnap.ts';

const bounds = { minimumStart: 0, maximumEnd: 12, minimumDuration: 0.1, moveMinimum: 0, moveMaximum: 12 };
const point = (seconds, key = 'target') => ({ key, seconds });

test('alvos incluem main, outras camadas e cursor; excluem só o próprio elemento', () => {
  const points = studioTimelineSnapPoints([{ id: 'a', start: 0, end: 6 }, { id: 'b', start: 6, end: 12 }],
    [{ id: 'title', startTicks: 120000, durationTicks: 240000 }, { id: 'image', startTicks: 480000, durationTicks: 120000 }], 2);
  assert.deepEqual(points.map(value => value.seconds), [2, 0, 6, 6, 12, 1, 3, 4, 5]);
  const filtered = studioTimelineSnapTargets(points, 'layer:title:');
  assert.ok(filtered.some(value => value.key === 'main:a:start'));
  assert.ok(filtered.some(value => value.key === 'cursor'));
  assert.equal(filtered.some(value => value.key.startsWith('layer:title:')), false);
});

for (const scale of [15, 60, 360]) test(`tolerância de 8px permanece visualmente igual com zoom ${scale}`, () => {
  const near = { startSeconds: 1, endSeconds: 6 - 7 / scale };
  const inside = snapStudioTimelineRange(near, 'end', bounds, [point(6)], scale);
  assert.equal(inside.range.endSeconds, 6); assert.equal(inside.match.seconds, 6);
  const outside = { ...near, endSeconds: 6 - 9 / scale };
  const result = snapStudioTimelineRange(outside, 'end', bounds, [point(6)], scale);
  assert.equal(result.match, null); assert.deepEqual(result.range, outside);
});

test('histerese retém encaixe até 14px e não salta para outro alvo próximo', () => {
  const points = [point(4), point(4.15, 'next')];
  const first = snapStudioTimelineRange({ startSeconds: 1, endSeconds: 3.9 }, 'end', bounds, points, 60);
  const retained = snapStudioTimelineRange({ startSeconds: 1, endSeconds: 4.16 }, 'end', bounds, points, 60, first.match);
  assert.equal(retained.match.key, 'target'); assert.equal(retained.range.endSeconds, 4);
  const released = snapStudioTimelineRange({ startSeconds: 1, endSeconds: 4.26 }, 'end', bounds, [point(4)], 60, first.match);
  assert.equal(released.match, null); assert.equal(released.range.endSeconds, 4.26);
});

test('movimento pode encaixar início ou fim e mantém duração sem esticar velocidade', () => {
  const start = snapStudioTimelineRange({ startSeconds: 4.1, endSeconds: 6.1 }, 'move', bounds, [point(4)], 60);
  assert.deepEqual(start.range, { startSeconds: 4, endSeconds: 6 }); assert.equal(start.match.edge, 'start');
  const end = snapStudioTimelineRange({ startSeconds: 3.9, endSeconds: 5.9 }, 'move', bounds, [point(6)], 60);
  assert.deepEqual(end.range, { startSeconds: 4, endSeconds: 6 }); assert.equal(end.match.edge, 'end');
});

test('corte encaixa somente a borda em arraste e rejeita alvos fora do original, vizinho ou mínimo', () => {
  const source = { ...bounds, minimumStart: 1, maximumEnd: 5, moveMinimum: 1, moveMaximum: 5 };
  const start = snapStudioTimelineRange({ startSeconds: 1.1, endSeconds: 4 }, 'start', source, [point(1)], 60);
  assert.deepEqual(start.range, { startSeconds: 1, endSeconds: 4 });
  for (const [range, mode, target] of [
    [{ startSeconds: 1, endSeconds: 4.99 }, 'end', 5.05],
    [{ startSeconds: 1.01, endSeconds: 4 }, 'start', 0.95],
    [{ startSeconds: 1, endSeconds: 1.11 }, 'end', 1.05],
    [{ startSeconds: 1.01, endSeconds: 3.01 }, 'move', 0.95],
  ]) assert.equal(snapStudioTimelineRange(range, mode, source, [point(target)], 60).match, null);
});

test('alvo retirado ou escala inválida não conserva guia de operação anterior', () => {
  const range = { startSeconds: 1, endSeconds: 3.95 };
  const snapped = snapStudioTimelineRange(range, 'end', bounds, [point(4)], 60);
  assert.equal(snapStudioTimelineRange(range, 'end', bounds, [], 60, snapped.match).match, null);
  for (const scale of [0, -1, NaN, Infinity]) assert.equal(snapStudioTimelineRange(range, 'end', bounds, [point(4)], scale, snapped.match).match, null);
});

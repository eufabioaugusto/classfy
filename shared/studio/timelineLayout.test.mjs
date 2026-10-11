// Ported from the mobile pure-core regressions; domain imports execute the extracted production TypeScript.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { studioTimelineLayout, studioTimelineSeconds, studioTimelineTicks, freezeStudioTrim, canContinueStudioTrim, studioTrimRange, clampStudioTimelineScale, studioTimelinePinchScale, studioTimelineTouchState, studioTimelineZoomAnchor, studioTrimTimelinePosition } from './timelineLayout.ts';
const take = (id, start = 2, end = 8) => ({ id, uri: `file:///${id}.mp4`, name: id, duration: 10, start, end });

test('faixa usa a duração real dos cortes, sem largura mínima falsa ou gaps', () => {
  const layout = studioTimelineLayout([take('a', 2, 3), take('b', 0, 10), take('c', 4, 4.1)], 24);
  assert.deepEqual(layout.segments.slice(0, 2).map(item => [item.x, item.width, item.start, item.end]), [[0, 24, 0, 1], [24, 240, 1, 11]]);
  assert.ok(Math.abs(layout.segments[2].width - 2.4) < 1e-6);
  assert.ok(Math.abs(layout.duration - 11.1) < 1e-6);
});
test('scroll se traduz em segundos e limita início/fim da montagem', () => {
  assert.equal(studioTimelineSeconds(72, 24, 8), 3);
  assert.equal(studioTimelineSeconds(-10, 24, 8), 0);
  assert.equal(studioTimelineSeconds(900, 24, 8), 8);
  assert.equal(studioTimelineSeconds(NaN, 24, 8), 0);
});
test('régua só materializa marcas perto do viewport em aulas longas', () => {
  const ticks = studioTimelineTicks(24, 1800, 1815, 7200);
  assert.ok(ticks.length < 30);
  assert.ok(ticks.every(item => item.seconds >= 1800 && item.seconds <= 1815));
  assert.ok(ticks.some(item => item.major));
});
test('corte inline usa timestamps da fonte e preserva intervalo mínimo', () => {
  const frozen = freezeStudioTrim([take('a')], 'a');
  assert.deepEqual(studioTrimRange(frozen, 'start', -9), { takeId: 'a', start: 0, end: 8, previewSourceSeconds: 0 });
  assert.equal(studioTrimRange(frozen, 'start', 99).start, 7.9);
  assert.equal(studioTrimRange(frozen, 'end', -99).end, 2.1);
  assert.equal(studioTrimRange(frozen, 'end', 99).end, 10);
  assert.equal(studioTrimRange(frozen, 'end', -1).previewSourceSeconds, 6.99);
});
test('gesto congela identidade, origem e posição mas aceita importação no fim', () => {
  const original = [take('a'), take('b')];
  const frozen = freezeStudioTrim(original, 'b');
  assert.equal(canContinueStudioTrim(frozen, [...original, take('new')], 'b'), true);
  assert.equal(canContinueStudioTrim(frozen, [take('b'), take('a')], 'b'), false);
  assert.equal(canContinueStudioTrim(frozen, [take('a'), { ...take('b'), uri: 'file:///other.mp4' }], 'b'), false);
  assert.equal(canContinueStudioTrim(frozen, [take('a', 2, 7), take('b')], 'b'), false);
  assert.equal(canContinueStudioTrim(frozen, [take('a'), take('b', 3, 8)], 'b'), false);
  assert.equal(canContinueStudioTrim(frozen, original, 'a'), false);
});
test('geometria rejeita ID repetido, limites inválidos e escala inválida', () => {
  assert.throws(() => studioTimelineLayout([take('a'), take('a')], 24));
  assert.throws(() => studioTimelineLayout([take('a', 8, 2)], 24));
  assert.throws(() => studioTimelineLayout([take('a')], 0));
});
test('pinça usa distância inicial e escala limitada sem deriva acumulada', () => {
  assert.equal(studioTimelinePinchScale(60, 100, 200), 120);
  assert.equal(studioTimelinePinchScale(60, 100, 150), 90);
  assert.equal(studioTimelinePinchScale(60, 100, 900), 240);
  assert.equal(studioTimelinePinchScale(60, 100, 1), 12);
  assert.equal(studioTimelinePinchScale(60, 0, 50), 60);
  assert.equal(clampStudioTimelineScale(NaN), 60);
});
test('zoom preserva o mesmo segundo sob cursor inclusive no fim da montagem', () => {
  assert.deepEqual(studioTimelineZoomAnchor(450, 60, 120, 30), { seconds: 7.5, offset: 900 });
  assert.deepEqual(studioTimelineZoomAnchor(450, 60, 12, 30), { seconds: 7.5, offset: 90 });
  assert.deepEqual(studioTimelineZoomAnchor(9000, 60, 240, 30), { seconds: 30, offset: 7200 });
});
test('cursor de corte segue fonte original e não o zero da prévia encurtada', () => {
  const frozen = freezeStudioTrim([take('a'), take('b')], 'b');
  assert.equal(studioTrimTimelinePosition(frozen, studioTrimRange(frozen, 'start', 2)), 8);
  assert.equal(studioTrimTimelinePosition(frozen, studioTrimRange(frozen, 'end', -1)), 10.99);
  assert.equal(studioTrimTimelinePosition(frozen, studioTrimRange(frozen, 'start', -2)), 4);
  const first = freezeStudioTrim([take('a')], 'a');
  assert.equal(studioTrimTimelinePosition(first, studioTrimRange(first, 'start', -2)), -2);
  assert.throws(() => studioTrimTimelinePosition(frozen, { takeId: 'other', start: 2, end: 8 }));
});
test('término e cancelamento sem touches não quebram e usam contagem do gesto', () => {
  for (const event of [undefined, null, {}, { nativeEvent: undefined }, { nativeEvent: null }, { nativeEvent: {} }, { nativeEvent: { touches: undefined } }]) {
    assert.deepEqual(studioTimelineTouchState(event), { count: 0, distance: 0 });
    assert.deepEqual(studioTimelineTouchState(event, { numberActiveTouches: 1 }), { count: 1, distance: 0 });
    assert.deepEqual(studioTimelineTouchState(event, { numberActiveTouches: 2 }), { count: 2, distance: 0 });
  }
  // A released/cancelled event explicitly reports no fingers even if RN's
  // gesture snapshot still holds its count from before termination.
  assert.deepEqual(studioTimelineTouchState({ nativeEvent: { touches: [] } }, { numberActiveTouches: 2 }), { count: 0, distance: 0 });
});
test('um dedo corta e dois dedos fornecem distância real para pinça', () => {
  const first = { pageX: 0, pageY: 0 };
  const second = { pageX: 3, pageY: 4 };
  assert.deepEqual(studioTimelineTouchState({ nativeEvent: { touches: [first] } }, { numberActiveTouches: 2 }), { count: 1, distance: 0 });
  assert.deepEqual(studioTimelineTouchState({ nativeEvent: { touches: [first, second] } }), { count: 2, distance: 5 });
});
test('contagem inválida e coordenadas ausentes não inventam uma pinça', () => {
  for (const numberActiveTouches of [undefined, NaN, Infinity, -1, '2']) {
    assert.deepEqual(studioTimelineTouchState({}, { numberActiveTouches }), { count: 0, distance: 0 });
  }
  assert.deepEqual(studioTimelineTouchState({ nativeEvent: { touches: { length: 2 } } }, { numberActiveTouches: 1 }), { count: 1, distance: 0 });
  for (const point of [undefined, null, {}, { pageX: NaN, pageY: 1 }, { pageX: 2, pageY: Infinity }]) {
    assert.deepEqual(studioTimelineTouchState({ nativeEvent: { touches: [{ pageX: 0, pageY: 0 }, point] } }), { count: 2, distance: 0 });
  }
});

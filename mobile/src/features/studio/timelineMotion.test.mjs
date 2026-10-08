import test from 'node:test';
import assert from 'node:assert/strict';
import { studioLiveSegment, studioTrimDragValues, studioTrimAutoscrollStep, studioTimelineAutoScrollVelocity } from './timelineMotion.ts';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const live = (start, end, index, draftStart, draftEnd, leading = 0) => studioLiveSegment(start, end, index, 1, 4, 7, draftStart, draftEnd, 40, leading);

test('corte esquerdo move uma faixa contínua e mantém borda oposta fixa', () => {
  for (const start of [2, 5]) {
    const leading = start - 4;
    const before = live(0, 2, 0, start, 7, leading);
    const selected = live(2, 5, 1, start, 7, leading);
    const after = live(5, 9, 2, start, 7, leading);
    close(before.x + before.width, selected.x);
    close(selected.x + selected.width, after.x);
    close(selected.x + selected.width, 5 * 40);
    close(selected.width, (7 - start) * 40);
  }
});

test('corte direito mantém início e desloca todos os próximos clips sem gaps', () => {
  for (const end of [6, 9]) {
    const before = live(0, 2, 0, 4, end);
    const selected = live(2, 5, 1, 4, end);
    const after = live(5, 9, 2, 4, end);
    const last = live(9, 10, 3, 4, end);
    assert.deepEqual(before, { x: 0, width: 80 });
    close(selected.x, 80);
    close(before.x + before.width, selected.x);
    close(selected.x + selected.width, after.x);
    close(after.x + after.width, last.x);
  }
});

test('sem corte ativo preserva segmentos, duração e posição', () => {
  assert.deepEqual(studioLiveSegment(3, 5, 2, -1, 0, 5, 2, 3, 60), { x: 180, width: 120 });
  assert.deepEqual(studioLiveSegment(0, 2, 0, 0, 1, 3, 0, 3, 60, -1), { x: -60, width: 180 });
});

test('rolagem acumulada entra no delta da fonte e o gesto mantém precisão em ms', () => {
  assert.deepEqual(studioTrimDragValues('start', 0, 4, 5, 80, 20, 100), { start: 1, end: 4, leadingSeconds: 1 });
  assert.deepEqual(studioTrimDragValues('end', 1, 4, 5, 80, 20, 100), { start: 1, end: 5, leadingSeconds: 0 });
  assert.deepEqual(studioTrimDragValues('start', 1, 4, 5, 100, -100, 100), { start: 1, end: 4, leadingSeconds: 0 });
  const precise = studioTrimDragValues('start', 0, 1.3333333, 2, 33.333333, 0, 100);
  assert.equal(precise.start, 0.333);
  assert.equal(precise.end, 1.3333333);
  assert.equal(precise.leadingSeconds, 0.333);
});

test('bordas respeitam fonte e intervalo mínimo inclusive primeiro e último clip', () => {
  assert.deepEqual(studioTrimDragValues('start', 0, 3, 3, -10000, 0, 100), { start: 0, end: 3, leadingSeconds: 0 });
  const minimumLeft = studioTrimDragValues('start', 0, 3, 3, 10000, 0, 100);
  close(minimumLeft.start, 2.9);
  close(minimumLeft.end - minimumLeft.start, 0.1);
  assert.deepEqual(studioTrimDragValues('end', 0, 3, 3, -10000, 0, 100), { start: 0, end: 0.1, leadingSeconds: 0 });
  assert.deepEqual(studioTrimDragValues('end', 0, 3, 3, 10000, 0, 100), { start: 0, end: 3, leadingSeconds: 0 });
  assert.deepEqual(studioTrimDragValues('start', 0, 0.05, 0.05, 10000, 0, 100), { start: 0, end: 0.05, leadingSeconds: 0 });
});

test('dados não finitos nunca geram geometria ou deslocamentos não finitos', () => {
  for (const scale of [0, -1, NaN, Infinity]) {
    assert.deepEqual(studioTrimDragValues('start', 1, 4, 5, 100, 100, scale), { start: 1, end: 4, leadingSeconds: 0 });
  }
  assert.deepEqual(studioTrimDragValues('start', 1, 4, 5, NaN, Infinity, 60), { start: 1, end: 4, leadingSeconds: 0 });
  assert.deepEqual(studioTrimDragValues('end', NaN, Infinity, NaN, 100, 0, 60), { start: 0, end: 0, leadingSeconds: 0 });
  const segment = studioLiveSegment(NaN, Infinity, 0, 0, NaN, Infinity, NaN, Infinity, Infinity, NaN);
  assert.ok(Object.values(segment).every(Number.isFinite));
});

test('autoscroll tem direção, velocidade proporcional e limite nas bordas', () => {
  assert.equal(studioTimelineAutoScrollVelocity(200, 400), 0);
  assert.equal(studioTimelineAutoScrollVelocity(40, 400), 0);
  assert.equal(studioTimelineAutoScrollVelocity(360, 400), 0);
  assert.equal(studioTimelineAutoScrollVelocity(20, 400), -120);
  assert.equal(studioTimelineAutoScrollVelocity(380, 400), 120);
  assert.equal(studioTimelineAutoScrollVelocity(-100, 400), -240);
  assert.equal(studioTimelineAutoScrollVelocity(900, 400), 240);
  assert.equal(studioTimelineAutoScrollVelocity(15, 30), 0);
  assert.equal(studioTimelineAutoScrollVelocity(0, 30), -240);
});

test('autoscroll não inicia quando posição ou configuração são inválidas', () => {
  for (const value of [NaN, Infinity]) {
    assert.equal(studioTimelineAutoScrollVelocity(value, 400), 0);
    assert.equal(studioTimelineAutoScrollVelocity(20, value), 0);
    assert.equal(studioTimelineAutoScrollVelocity(20, 400, value), 0);
    assert.equal(studioTimelineAutoScrollVelocity(20, 400, 40, value), 0);
  }
  assert.equal(studioTimelineAutoScrollVelocity(20, 0), 0);
  assert.equal(studioTimelineAutoScrollVelocity(20, 400, 0), 0);
  assert.equal(studioTimelineAutoScrollVelocity(20, 400, 40, -1), 0);
});

test('autoscroll virtual restaura primeiro clip até fonte zero mantendo alça sob dedo', () => {
  let state = { offset: 0, virtualOffset: 0 };
  for (let frame = 0; frame < 100; frame++) {
    state = studioTrimAutoscrollStep('start', 10, 20, 20, -195, 0, state.offset, state.virtualOffset, 100, -24, 2000);
    const selected = studioLiveSegment(0, 10, 0, 0, 10, 20, state.start, state.end, 100, state.leadingSeconds);
    const after = studioLiveSegment(10, 15, 1, 0, 10, 20, state.start, state.end, 100, state.leadingSeconds);
    close(selected.x - state.offset - state.virtualOffset, -195);
    close(selected.x + selected.width, after.x);
    close(selected.x + selected.width, 1000);
    assert.equal(state.offset, 0);
  }
  assert.equal(state.start, 0);
  assert.equal(state.end, 20);
  assert.equal(state.virtualOffset, -805);
});

test('autoscroll consome rolagem nativa antes de compensar o excesso virtual', () => {
  const state = studioTrimAutoscrollStep('start', 4, 14, 20, -100, 100, 100, 0, 100, -150, 2000);
  assert.deepEqual(state, { start: 1.5, end: 14, leadingSeconds: -2.5, offset: 0, virtualOffset: -50 });
  const next = studioTrimAutoscrollStep('start', 4, 14, 20, -100, 100, state.offset, state.virtualOffset, 100, -50, 2000);
  assert.deepEqual(next, { start: 1, end: 14, leadingSeconds: -3, offset: 0, virtualOffset: -100 });
});

test('autoscroll direito virtual respeita fim da fonte sem crescer após clamp', () => {
  let state = { offset: 0, virtualOffset: 0 };
  for (let frame = 0; frame < 100; frame++) {
    state = studioTrimAutoscrollStep('end', 0, 10, 12, 0, 0, state.offset, state.virtualOffset, 100, 1000, 0);
    assert.deepEqual(state, { start: 0, end: 12, leadingSeconds: 0, offset: 0, virtualOffset: 200 });
  }
});

test('autoscroll virtual rejeita valores não finitos e conserva intervalo mínimo', () => {
  const minimum = studioTrimAutoscrollStep('end', 1, 10, 12, 0, 0, 0, 0, 100, -10000, 0);
  close(minimum.end - minimum.start, 0.1);
  close(minimum.virtualOffset, -890);
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const state = studioTrimAutoscrollStep('start', invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid);
    assert.ok(Object.values(state).every(Number.isFinite));
    assert.deepEqual(state, { start: 0, end: 0, leadingSeconds: 0, offset: 0, virtualOffset: 0 });
  }
});

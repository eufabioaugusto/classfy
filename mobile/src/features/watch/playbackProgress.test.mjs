import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackProgress, createSessionId } from './playbackProgress.ts';

test('retomar um vídeo em 120 segundos não concede 120 segundos assistidos', () => {
  const progress = new PlaybackProgress();
  progress.sample(120, true, 0);
  progress.sample(120.5, true, 500);
  assert.equal(progress.watched, 0.5);
});
test('saltos, retorno e pausa não geram progresso', () => {
  const progress = new PlaybackProgress();
  progress.sample(0, true, 0);
  progress.sample(0.5, true, 500);
  progress.discontinuity();
  progress.sample(200, true, 1000);
  progress.sample(200.5, true, 1500);
  progress.sample(20, true, 2000);
  progress.sample(20, false, 2500);
  progress.sample(20.5, true, 10000);
  assert.equal(progress.watched, 1);
});
test('background e intervalos longos não contam como tempo observado', () => {
  const progress = new PlaybackProgress();
  progress.sample(0, true, 0);
  progress.sample(10, true, 10000);
  assert.equal(progress.watched, 0);
  progress.sample(10.5, true, 10500);
  assert.equal(progress.watched, 0.5);
});
test('velocidade 2x conta tempo assistido, sem multiplicar a recompensa', () => {
  const progress = new PlaybackProgress();
  progress.sample(0, true, 0, 2);
  progress.sample(1, true, 500, 2);
  assert.equal(progress.watched, 0.5);
});
test('cada sessão recebe um UUID v4 independente', () => {
  const first = createSessionId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, createSessionId());
});

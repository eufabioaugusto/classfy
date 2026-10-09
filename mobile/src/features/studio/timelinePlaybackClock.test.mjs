import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceStudioTimelinePlayback, resetStudioTimelinePlayback, sampleStudioTimelinePlayback } from './timelinePlayback.ts';

const lead = .12;
const epsilon = 1e-8;

function exercise({ fps, rate, delaySeconds = 0, seconds = 8, duplicateFrames = false }) {
  const interval = 1000 / fps;
  let clock = resetStudioTimelinePlayback(.5, 30, true), native = .5;
  let previous = clock.position, maximumLead = 0, maximumStep = 0;
  for (let frame = 1; frame <= fps * seconds; frame++) {
    if (frame % (fps / 15) === 0 && frame / fps > delaySeconds) {
      native = .5 + (frame / fps - delaySeconds) * rate;
      clock = sampleStudioTimelinePlayback(clock, native, 30, true);
    }
    const timestamp = 1000 + frame * interval;
    clock = advanceStudioTimelinePlayback(clock, interval, 30, timestamp);
    if (duplicateFrames) {
      const once = clock;
      clock = advanceStudioTimelinePlayback(clock, interval, 30, timestamp);
      assert.equal(clock, once, 'a second callback at the same display timestamp cannot advance time');
    }
    assert.ok(clock.position >= previous - epsilon, 'Play cannot move backward when samples are late');
    assert.ok(clock.position <= native + lead + epsilon, 'display prediction must stay close to actual media');
    maximumLead = Math.max(maximumLead, clock.position - native);
    maximumStep = Math.max(maximumStep, clock.position - previous);
    previous = clock.position;
  }
  return { clock, native, maximumLead, maximumStep };
}

for (const fps of [60, 120]) {
  for (const rate of [.25, .5, .75, 1]) {
    test(`mídia a${rate}x em${fps}Hz define a taxa visual e nunca acumula segundos de antecipação`, () => {
      const result = exercise({ fps, rate });
      assert.ok(Math.abs(result.clock.rate - rate) < .005, 'effective rate follows advancing media, not a constant wall clock');
      assert.ok(Math.abs(result.clock.position - result.native) <= lead + epsilon);
      assert.ok(result.maximumStep <= 1.15 / fps + epsilon);
      assert.ok(result.clock.position > .5 + rate * 7.7, 'the bound cannot disguise a permanently stopped strip');
    });
  }
  test(`entrega atrasada250ms em${fps}Hz preserva continuidade e limite absoluto`, () => {
    const result = exercise({ fps, rate: 1, delaySeconds: .25 });
    assert.ok(result.maximumStep <= 1.15 / fps + epsilon);
    assert.ok(result.clock.position > 8, 'advancing samples recover from the initial waiting interval');
    assert.ok(result.clock.rate > .95);
  });
  test(`callbacks duplicados em${fps}Hz são idempotentes no timestamp do display`, () => {
    const once = exercise({ fps, rate: 1 });
    const twice = exercise({ fps, rate: 1, duplicateFrames: true });
    assert.deepEqual(twice, once);
  });
}

test('duplicatas e timestamps de mídia fora de ordem não renovam previsão ou watchdog', () => {
  let clock = resetStudioTimelinePlayback(1, 30, true);
  for (let frame = 1; frame <= 300; frame++) {
    const beforeSample = clock;
    clock = sampleStudioTimelinePlayback(clock, frame % 2 ? 1 : .9, 30, true);
    assert.equal(clock, beforeSample);
    clock = advanceStudioTimelinePlayback(clock, 1000 / 60, 30, 1000 + frame * 1000 / 60);
  }
  assert.ok(Math.abs(clock.position - 1.12) < epsilon);
  assert.ok(clock.ageMs > 4900, 'a frozen predictor still tracks the interval since real media progress');
  assert.equal(clock.running, false); assert.equal(clock.stalled, true);
  const before = clock.position;
  clock = sampleStudioTimelinePlayback(clock, 1.13, 30, true);
  clock = advanceStudioTimelinePlayback(clock, 1000 / 60, 30, 6016.666666666667);
  assert.ok(clock.position > before && clock.position <= 1.25 + epsilon);
});

test('jitter e bursts de delivery não transformam taxa irregular em segundos fictícios', () => {
  let clock = resetStudioTimelinePlayback(.5, 30, true), native = .5, previous = .5;
  const packets = new Map();
  for (let packet = 1; packet <= 120; packet++) {
    const at = packet * 4 + [0, 2, 0, 1][packet % 4];
    const values = packets.get(at) || []; values.push(.5 + packet / 15 * .5); packets.set(at, values);
  }
  for (let frame = 1; frame <= 500; frame++) {
    for (const value of packets.get(frame) || []) {
      native = Math.max(native, value);
      clock = sampleStudioTimelinePlayback(clock, value, 30, true);
      clock = sampleStudioTimelinePlayback(clock, value - .02, 30, true);
    }
    clock = advanceStudioTimelinePlayback(clock, 1000 / 60, 30, 1000 + frame * 1000 / 60);
    assert.ok(clock.position >= previous - epsilon);
    assert.ok(clock.position <= native + lead + epsilon);
    assert.ok(clock.position - previous <= 1.15 / 60 + epsilon);
    previous = clock.position;
  }
  assert.ok(clock.position > 4.4 && clock.position <= 4.62 + epsilon);
});

test('jitter±20ms de delivery não cria uma desaceleração permanente em mídia1x', () => {
  let clock = resetStudioTimelinePlayback(.5, 30, true), native = .5;
  const packets = new Map();
  for (let packet = 1; packet <= 150; packet++) {
    const at = packet * 4 + [1, -1, 0][packet % 3];
    const values = packets.get(at) || []; values.push(.5 + packet / 15); packets.set(at, values);
  }
  for (let frame = 1; frame <= 600; frame++) {
    for (const value of packets.get(frame) || []) {
      native = value; clock = sampleStudioTimelinePlayback(clock, value, 30, true);
    }
    clock = advanceStudioTimelinePlayback(clock, 1000 / 60, 30, 1000 + frame * 1000 / 60);
    assert.ok(clock.position <= native + lead + epsilon);
  }
  assert.ok(Math.abs(clock.position - 10.5) < .1, 'normal decoding remains near ten real elapsed seconds');
});

test('preview não alcança EOF antes da confirmação nativa, mantendo pelo menos um frame de saída', () => {
  let clock = resetStudioTimelinePlayback(1.94, 2, true);
  for (let frame = 1; frame <= 30; frame++) clock = advanceStudioTimelinePlayback(clock, 1000 / 60, 2, 1000 + frame * 1000 / 60);
  assert.ok(clock.position <= 2 - 1 / 30 + epsilon);
  clock = sampleStudioTimelinePlayback(clock, 1.99, 2, true);
  for (let frame = 31; frame <= 60; frame++) clock = advanceStudioTimelinePlayback(clock, 1000 / 60, 2, 1000 + frame * 1000 / 60);
  assert.ok(clock.position <= 1.99 + epsilon && clock.position < 2);
  clock = sampleStudioTimelinePlayback(clock, 2, 2, false);
  assert.equal(clock.position, 2); assert.equal(clock.running, false); assert.equal(clock.stalled, false);
});

test('pausa, seek para trás e replay continuam sendo âncoras explícitas', () => {
  const moving = exercise({ fps: 60, rate: .5 }).clock;
  const paused = sampleStudioTimelinePlayback(moving, 4.5, 30, false);
  assert.equal(paused.position, 4.5); assert.equal(paused.running, false);
  const sought = resetStudioTimelinePlayback(2, 30);
  assert.equal(sought.position, 2); assert.equal(sought.rate, 1);
  const replay = sampleStudioTimelinePlayback(sought, 0, 30, true);
  assert.equal(replay.position, 0); assert.equal(replay.rate, 1);
  assert.equal(replay.frameTimestamp, null);
});

test('timestamp monotônico vence delta incorreto e frames antigos não alteram a posição', () => {
  let clock = resetStudioTimelinePlayback(0, 30, true);
  clock = advanceStudioTimelinePlayback(clock, 1000 / 60, 30, 1000);
  const first = clock.position;
  clock = advanceStudioTimelinePlayback(clock, 50, 30, 1000 + 1000 / 60);
  assert.ok(Math.abs(clock.position - first - 1 / 60) < epsilon);
  const current = clock;
  assert.equal(advanceStudioTimelinePlayback(clock, 50, 30, 1000), current);
  assert.equal(advanceStudioTimelinePlayback(clock, 50, 30, 1000 + 1000 / 60), current);
});

test('primeiro frame com delta nulo registra timestamp para o próximo intervalo real', () => {
  let clock = resetStudioTimelinePlayback(0, 30, true);
  clock = advanceStudioTimelinePlayback(clock, null, 30, 1000);
  assert.equal(clock.position, 0); assert.equal(clock.frameTimestamp, 1000);
  clock = advanceStudioTimelinePlayback(clock, 90, 30, 1000 + 1000 / 60);
  assert.ok(Math.abs(clock.position - 1 / 60) < epsilon);
});

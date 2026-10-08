import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioVideoStopOperation } from './StudioCaptureRecording.ts';

test('STOP antes do início nativo continua até encerrar o take da mesma operação', async () => {
  let nativeRecording = false;
  let probes = 0;
  let earlyStops = 0;
  let realStops = 0;
  const operation = createStudioVideoStopOperation({
    isCurrent: () => true,
    isRecording: async () => {
      probes++;
      if (probes === 2) nativeRecording = true;
      return nativeRecording;
    },
    stop: () => {
      if (!nativeRecording) { earlyStops++; return; }
      realStops++; nativeRecording = false; operation.settle();
    },
    intervalMs: 1,
  });
  assert.equal(await operation.requestStop(), true);
  assert.ok(earlyStops >= 1);
  assert.equal(realStops, 1);
});

test('arquivo já resolvido termina a espera e não encerra uma gravação posterior', async () => {
  let stops = 0;
  let resolveProbe;
  const operation = createStudioVideoStopOperation({
    isCurrent: () => true,
    isRecording: () => new Promise(resolve => { resolveProbe = resolve; }),
    stop: () => { stops++; },
  });
  const stopped = operation.requestStop();
  await Promise.resolve();
  operation.settle();
  assert.equal(await stopped, true);
  resolveProbe(true);
  await Promise.resolve();
  assert.equal(stops, 1);
  assert.equal(await operation.requestStop(), true);
  assert.equal(stops, 1);
});

test('desmontagem invalida confirmação nativa atrasada e limpa esperas', async () => {
  let stops = 0;
  let resolveProbe;
  const operation = createStudioVideoStopOperation({
    isCurrent: () => true,
    isRecording: () => new Promise(resolve => { resolveProbe = resolve; }),
    stop: () => { stops++; },
  });
  const stopped = operation.requestStop();
  await Promise.resolve();
  operation.dispose();
  assert.equal(await stopped, false);
  resolveProbe(true);
  await Promise.resolve();
  assert.equal(stops, 1);
});

test('troca de câmera impede STOP depois da consulta da câmera anterior', async () => {
  let current = true;
  let stops = 0;
  const operation = createStudioVideoStopOperation({
    isCurrent: () => current,
    isRecording: async () => { current = false; return true; },
    stop: () => { stops++; },
  });
  assert.equal(await operation.requestStop(), false);
  assert.equal(stops, 1);
});

test('nativo sem resposta tem limite e permite tentar encerrar novamente', async () => {
  let responds = false;
  let stops = 0;
  const operation = createStudioVideoStopOperation({
    isCurrent: () => true,
    isRecording: () => responds ? Promise.resolve(true) : new Promise(() => {}),
    stop: () => { stops++; },
    timeoutMs: 25, probeTimeoutMs: 5, intervalMs: 1,
  });
  assert.equal(await operation.requestStop(), false);
  const beforeRetry = stops;
  responds = true;
  assert.equal(await operation.requestStop(), true);
  assert.ok(stops > beforeRetry);
  operation.settle();
});

test('fallback mantém intenção até a promise resolver sem exigir bridge nativa', async () => {
  let stops = 0;
  const operation = createStudioVideoStopOperation({
    isCurrent: () => true,
    stop: () => { if (++stops === 3) operation.settle(); },
    intervalMs: 1,
  });
  assert.equal(await operation.requestStop(), true);
  assert.equal(stops, 3);
});

test('duas intenções de STOP compartilham a mesma espera nativa', async () => {
  let stops = 0;
  let resolveProbe;
  const operation = createStudioVideoStopOperation({
    isCurrent: () => true,
    isRecording: () => new Promise(resolve => { resolveProbe = resolve; }),
    stop: () => { stops++; },
  });
  const first = operation.requestStop();
  const second = operation.requestStop();
  await Promise.resolve();
  resolveProbe(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(stops, 2);
  operation.settle();
});

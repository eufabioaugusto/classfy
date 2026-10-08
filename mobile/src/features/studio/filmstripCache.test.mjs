import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioFilmstripCache, mapStudioFilmstripSamples, normalizeStudioFilmstripSamples, studioFilmstripSampleWindow } from './studioFilmstripCache.ts';

const frame = (timestamp = 250) => ({ sourceUri: 'file:///original.mp4', directory: 'file:///cache/version/hash/',
  outputUri: `file:///cache/version/hash/${timestamp}.jpg`, seconds: timestamp / 1000 });
function deferred() { let resolve; return { promise: new Promise(done => { resolve = done; }), release: value => resolve(value) }; }
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('A fila não avançou para a etapa esperada');
}
function harness() {
  const disk = new Map([['file:///original.mp4', 4096]]);
  let sequence = 0;
  const calls = []; const moves = [];
  let generate = async () => {};
  let inspect = async () => {};
  const cache = createStudioFilmstripCache({
    uniqueId: () => `tmp-${++sequence}`,
    info: async uri => { await inspect(uri); return { exists: disk.has(uri), isDirectory: false, size: disk.get(uri) }; },
    makeDirectory: async () => {},
    remove: async uri => { disk.delete(uri); },
    move: async (from, to) => {
      moves.push([from, to]);
      if (disk.has(to)) throw new Error('Destination exists');
      disk.set(to, disk.get(from)); disk.delete(from);
    },
    generate: async (source, output, seconds) => {
      calls.push({ source, output, seconds }); disk.set(output, 400);
      await generate(source, output, seconds);
    },
  });
  return { cache, disk, calls, moves, generate: next => { generate = next; }, inspect: next => { inspect = next; } };
}

test('frames absolutos quantizam250ms, respeitam duração e deduplicam timestamps', () => {
  const result = normalizeStudioFilmstripSamples([
    { key: 'negative', seconds: -10 }, { key: 'middle', seconds: 0.61 },
    { key: 'end', seconds: 4 }, { key: 'middle', seconds: 0.9 },
    { key: 'invalid', seconds: NaN }, ...Array.from({ length: 20 }, (_, index) => ({ key: `cell-${index}`, seconds: 0.4 })),
  ], 1.14);
  assert.equal(result.length, 3);
  assert.deepEqual(result.slice(0, 3), [
    { key: 'negative', seconds: 0, timestampMs: 0 }, { key: 'middle', seconds: 0.5, timestampMs: 500 },
    { key: 'end', seconds: 1.13, timestampMs: 1130 },
  ]);
  assert.deepEqual(normalizeStudioFilmstripSamples([{ key: 'x', seconds: 1 }], Infinity), []);
});

test('janela horizontal de19células distribui10frames até a última célula', () => {
  const samples = Array.from({ length: 19 }, (_, index) => ({ key: String(index + 12), seconds: (index + 12.5) * 48 / 60 }));
  const selected = normalizeStudioFilmstripSamples(samples, 60);
  assert.equal(selected.length, 10);
  assert.deepEqual(selected.map(frame => frame.key), ['12', '14', '16', '18', '20', '22', '24', '26', '28', '30']);
  const ready = Object.fromEntries(selected.map(frame => [String(frame.timestampMs), `file:///frame-${frame.key}.jpg`]));
  const visible = mapStudioFilmstripSamples(studioFilmstripSampleWindow(samples, 60), selected, ready);
  assert.equal(Object.keys(visible).length, 19);
  assert.equal(visible['12'], 'file:///frame-12.jpg');
  assert.equal(visible['30'], 'file:///frame-30.jpg');
  for (let key = 22; key <= 28; key++) assert.ok(visible[String(key)], 'lado direito recebe frame real');
});

test('vizinhos usam apenas frames disponíveis da janela atual e preservam fallback vazio', () => {
  const samples = [{ key: 'a', seconds: 1 }, { key: 'b', seconds: 2 }, { key: 'c', seconds: 3 }];
  const requests = studioFilmstripSampleWindow(samples, 10);
  const selected = normalizeStudioFilmstripSamples(samples, 10);
  assert.deepEqual(mapStudioFilmstripSamples(requests, selected, { '0': 'file:///stale.jpg' }), {});
  assert.deepEqual(mapStudioFilmstripSamples(requests, selected, { '3000': 'file:///right.jpg' }), {
    a: 'file:///right.jpg', b: 'file:///right.jpg', c: 'file:///right.jpg',
  });
  assert.deepEqual(mapStudioFilmstripSamples(requests, selected, { '1000': 'file:///left.jpg', '3000': 'file:///right.jpg' }), {
    a: 'file:///left.jpg', b: 'file:///left.jpg', c: 'file:///right.jpg',
  });
});

test('Fast Refresh com frames antigos em objeto nunca entrega objeto como URI', () => {
  const samples = [{ key: '0', seconds: 0 }, { key: '1', seconds: 1 }];
  const requests = studioFilmstripSampleWindow(samples, 10);
  const selected = normalizeStudioFilmstripSamples(samples, 10);
  const oldFrame = { timestampMs: 0, uri: 'file:///old.jpg' };
  assert.deepEqual(mapStudioFilmstripSamples(requests, selected, { '0': oldFrame }), {});
  assert.deepEqual(mapStudioFilmstripSamples(requests, selected, { '0': oldFrame, '1000': 'file:///current.jpg' }), {
    '0': 'file:///current.jpg', '1': 'file:///current.jpg',
  });
});

test('dois cards do mesmo original compartilham uma extração e arquivo de cache', async () => {
  const h = harness(); const delivered = [];
  h.cache.subscribe(frame(), uri => delivered.push(['one', uri]));
  h.cache.subscribe(frame(), uri => delivered.push(['two', uri]));
  await until(() => delivered.length === 2);
  assert.equal(h.calls.length, 1);
  assert.equal(delivered[0][1], delivered[1][1]);
  assert.equal(h.disk.get('file:///original.mp4'), 4096);
});

test('fila serial remove o frame que saiu da tela antes de começar', async () => {
  const h = harness(); const gate = deferred(); const delivered = [];
  h.generate(() => gate.promise);
  h.cache.subscribe(frame(250), uri => delivered.push(uri));
  const unsubscribe = h.cache.subscribe(frame(500), () => assert.fail('Frame fora da tela não deve ser entregue'));
  await until(() => h.calls.length === 1);
  unsubscribe(); gate.release();
  await until(() => delivered.length === 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.disk.has(frame(500).outputUri), false);
});

test('cancelar durante consulta do disco evita iniciar o decoder', async () => {
  const h = harness(); const gate = deferred(); let inspected = false;
  h.inspect(uri => { if (uri === frame().outputUri) { inspected = true; return gate.promise; } });
  const unsubscribe = h.cache.subscribe(frame(), () => assert.fail('Assinante cancelado recebeu frame'));
  await until(() => inspected);
  unsubscribe(); gate.release();
  await new Promise(resolve => setTimeout(resolve, 3));
  assert.equal(h.calls.length, 0);
});

test('visibilidade mais recente invalida queued antes mesmo do cleanup React', async () => {
  const h = harness(); const gate = deferred(); let visible = true; let delivered = false;
  h.generate(() => gate.promise);
  h.cache.subscribe(frame(250), () => { delivered = true; });
  h.cache.subscribe(frame(500), () => assert.fail('Célula invisível recebeu frame'), () => visible);
  await until(() => h.calls.length === 1);
  visible = false; gate.release();
  await until(() => delivered);
  assert.equal(h.calls.length, 1);
});

test('cancelar um card duplicado preserva o pedido do card ainda visível', async () => {
  const h = harness(); const gate = deferred(); let delivered = false;
  h.generate(() => gate.promise);
  const unsubscribe = h.cache.subscribe(frame(), () => assert.fail('Card removido recebeu frame'));
  h.cache.subscribe(frame(), () => { delivered = true; });
  await until(() => h.calls.length === 1);
  unsubscribe(); gate.release();
  await until(() => delivered);
  assert.equal(h.calls.length, 1);
});

test('JPEG parcial não aparece no cache final; conclusão move e limpa temporário', async () => {
  const h = harness(); const gate = deferred(); let delivered;
  h.generate(() => gate.promise);
  h.cache.subscribe(frame(), uri => { delivered = uri; });
  await until(() => h.calls.length === 1);
  assert.equal(h.disk.has(frame().outputUri), false);
  assert.equal(delivered, undefined);
  assert.ok(h.calls[0].output.endsWith('.tmp.jpg'));
  gate.release();
  await until(() => !!delivered);
  assert.equal(delivered, frame().outputUri);
  assert.equal(h.disk.has(h.calls[0].output), false);
});

test('cache existente evita extração e é revalidado após purge do sistema', async () => {
  const h = harness(); h.disk.set(frame().outputUri, 100);
  let delivered = 0;
  h.cache.subscribe(frame(), () => { delivered++; });
  await until(() => delivered === 1);
  assert.equal(h.calls.length, 0);
  h.disk.delete(frame().outputUri);
  h.cache.subscribe(frame(), () => { delivered++; });
  await until(() => delivered === 2);
  assert.equal(h.calls.length, 1);
});

test('runtime concorrente que completa o mesmo JPEG não é sobrescrito', async () => {
  const h = harness(); let delivered;
  h.generate(() => { h.disk.set(frame().outputUri, 900); });
  h.cache.subscribe(frame(), uri => { delivered = uri; });
  await until(() => !!delivered);
  assert.equal(h.disk.get(frame().outputUri), 900);
  assert.equal(h.moves.length, 0);
  assert.equal(h.disk.has(h.calls[0].output), false);
});

test('falha de extração limpa temporário e pode ser repetida sem erro de destino', async () => {
  const h = harness(); let delivered;
  h.generate(() => { throw new Error('Decoder failure'); });
  h.cache.subscribe(frame(), () => assert.fail('Extração falhou mas entregou URI'));
  await until(() => h.calls.length === 1 && !h.disk.has(h.calls[0].output));
  h.generate(async () => {});
  h.cache.subscribe(frame(), uri => { delivered = uri; });
  await until(() => !!delivered);
  assert.equal(h.calls.length, 2);
  assert.equal(h.disk.get('file:///original.mp4'), 4096);
});

test('extração já iniciada termina em cache, sem callback obsoleto; reentrada reaproveita', async () => {
  const h = harness(); const gate = deferred(); let delivered;
  h.generate(() => gate.promise);
  const unsubscribe = h.cache.subscribe(frame(), () => assert.fail('Componente desmontado recebeu frame'));
  await until(() => h.calls.length === 1);
  unsubscribe(); gate.release();
  await until(() => h.disk.has(frame().outputUri));
  h.cache.subscribe(frame(), uri => { delivered = uri; });
  await until(() => !!delivered);
  assert.equal(h.calls.length, 1);
});

test('assinatura criada durante entrega de outro card não fica perdida', async () => {
  const h = harness(); let second;
  h.cache.subscribe(frame(), () => { h.cache.subscribe(frame(), uri => { second = uri; }); });
  await until(() => !!second);
  assert.equal(h.calls.length, 1);
});

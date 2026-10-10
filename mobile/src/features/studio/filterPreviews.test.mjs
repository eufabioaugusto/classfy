import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';

function compile(file, dependencies) {
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    assert.ok(name in dependencies, `Missing protocol dependency ${name}`); return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const catalog = compile('./filterCatalog.ts', { './model': model }).studioFilterPresets;
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
function fixture() {
  const ticks = model.studioTicks;
  return { ...model.emptyStudioEditing('aula'),
    assets: [{ id: 'source', kind: 'video', name: 'Original', uri: 'file:///source.mp4', durationTicks: ticks(8), width: 1920, height: 1080 }],
    main: [{ id: 'previous', assetId: 'source', sourceStartTicks: 0, sourceEndTicks: ticks(2) },
      { id: 'target', assetId: 'source', sourceStartTicks: ticks(3), sourceEndTicks: ticks(5), rect: { x: .15, y: .1, width: .7, height: .8 } }],
  };
}
function harness({ available = true, cacheDirectory = 'file:///cache/' } = {}) {
  const requests = [], received = [], operations = [], disk = new Set(); let active = 0, peak = 0, uuid = 0;
  const fileSystem = { cacheDirectory,
    makeDirectoryAsync: async directory => { operations.push({ type: 'mkdir', directory, active }); },
    deleteAsync: async directory => { operations.push({ type: 'delete', directory, active }); for (const file of disk) if (file.startsWith(directory)) disk.delete(file); },
  };
  const native = {
    isStudioFilterPreviewAvailable: () => available,
    renderStudioRecipeThumbnailAsync: (recipeJSON, uri, seconds) => {
      active++; peak = Math.max(peak, active); let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = { recipe: JSON.parse(recipeJSON), uri, seconds, settled: false,
        complete: () => { assert.equal(request.settled, false); request.settled = true; disk.add(uri); active--; operations.push({ type: 'rendered', uri, active }); resolve({ uri }); },
        fail: () => { assert.equal(request.settled, false); request.settled = true; active--; operations.push({ type: 'failed', uri, active }); reject(new Error('Decoder unavailable')); },
      };
      requests.push(request); operations.push({ type: 'render', uri, active }); return promise;
    },
  };
  const preview = compile('./filterPreviews.ts', { 'expo-file-system/legacy': fileSystem, 'expo-crypto': { randomUUID: () => `cache-${++uuid}` },
    '../../../modules/classfy-studio-media': native, './filterCatalog': { studioFilterPresets: catalog }, './model': model,
  }).prepareStudioFilterPreviews;
  return { requests, received, operations, disk, active: () => active, peak: () => peak,
    start: (editing = fixture(), target = 'target', position = 2.8, receive = (id, uri) => received.push({ id, uri })) => preview(editing, target, position, receive),
    completeAll: async () => {
      for (let iteration = 0; iteration < 20; iteration++) {
        await settle(); const pending = requests.filter(request => !request.settled); if (!pending.length) return;
        for (const request of pending) request.complete();
      }
      throw new Error('Native filter work did not settle');
    },
  };
}
test('nove filtros enviam receitas reais, preservam originais e nunca excedem três decoders na sessão', async () => {
  const h = harness(), editing = fixture(), original = JSON.stringify(editing), cancel = h.start(editing);
  await settle(); assert.equal(h.requests.length, 3); assert.equal(h.active(), 3);
  // A completed decoder can take another preset while the other two remain busy.
  h.requests[1].complete(); await settle(); assert.equal(h.requests.length, 4); assert.equal(h.active(), 3);
  await h.completeAll(); assert.equal(catalog.length, 9); assert.equal(h.requests.length, 9); assert.equal(h.peak(), 3); assert.equal(h.received.length, 9);
  const expectedBase = model.compileStudioRecipe({ kind: 'aula', takes: [], editing });
  for (const preset of catalog) {
    const request = h.requests.find(request => request.uri.endsWith(`/${preset.id}.jpg`)); assert.ok(request, preset.id);
    const target = request.recipe.clips.find(clip => clip.id === 'target');
    assert.deepEqual(target.grade, preset.grade, `${preset.title} uses actual grade, rather than an illustrative bitmap`);
    assert.deepEqual(target.rect, expectedBase.clips.find(clip => clip.id === 'target').rect);
    assert.deepEqual(request.recipe.assets, expectedBase.assets); assert.equal(request.seconds, 2.8);
  }
  assert.equal(JSON.stringify(editing), original); assert.equal(h.operations.some(operation => operation.type === 'delete'), false, 'cache remains available while sheet is open');
  cancel(); await settle(); assert.equal(h.disk.size, 0); assert.equal(h.operations.filter(operation => operation.type === 'delete').length, 1);
});
test('cancelamento não publica thumbnails tardias e limpa cache somente após todos os workers terminarem', async () => {
  const h = harness(), cancel = h.start(); await settle(); assert.equal(h.requests.length, 3);
  cancel(); await settle(); assert.equal(h.operations.some(operation => operation.type === 'delete'), false);
  h.requests[0].complete(); h.requests[2].complete(); await settle(); assert.equal(h.active(), 1); assert.equal(h.disk.size, 2); assert.equal(h.operations.some(operation => operation.type === 'delete'), false);
  h.requests[1].fail(); await settle(); assert.equal(h.requests.length, 3, 'cancel stops scheduling more presets'); assert.deepEqual(h.received, []); assert.equal(h.disk.size, 0);
  const removal = h.operations.find(operation => operation.type === 'delete'); assert.ok(removal); assert.equal(removal.active, 0);
  assert.equal(h.operations.at(-1).type, 'delete');
});
for (const [label, position, expected] of [['before', -99, 2], ['after', 99, 3.96], ['invalid', NaN, 2]]) {
  test(`quadro de filtro fica dentro do clip selecionado: cursor ${label}`, async () => {
    const h = harness(), cancel = h.start(fixture(), 'target', position); await settle();
    assert.equal(h.requests.length, 3); for (const request of h.requests) assert.equal(request.seconds, expected);
    cancel(); await h.completeAll(); assert.deepEqual(h.received, []);
  });
}
test('sessão nova usa cache independente e frames da sessão cancelada não substituem o novo alvo', async () => {
  const h = harness(), old = [], current = [], cancelOld = h.start(fixture(), 'target', 2.5, (id, uri) => old.push({ id, uri })); await settle();
  h.requests[0].complete(); await settle(); assert.equal(old.length, 1); cancelOld();
  const cancelCurrent = h.start(fixture(), 'previous', 1, (id, uri) => current.push({ id, uri })); await settle();
  await h.completeAll(); assert.equal(old.length, 1); assert.equal(current.length, 9); assert.ok(current.every(value => value.uri.includes('/cache-2/')));
  assert.equal(h.operations.filter(operation => operation.type === 'delete').length, 1); assert.ok([...h.disk].every(uri => uri.includes('/cache-2/')));
  cancelCurrent(); await settle(); assert.equal(h.disk.size, 0);
});
for (const options of [{ available: false }, { cacheDirectory: null }]) test(`capacidade/cache indisponível não abre decoder: ${JSON.stringify(options)}`, async () => {
  const h = harness(options), cancel = h.start(); await settle(); assert.equal(h.requests.length, 0); assert.deepEqual(h.received, []); cancel(); await settle();
});
test('falha de um filtro não impede outros presets nem deixa cache após fechar', async () => {
  const h = harness(), cancel = h.start(); await settle(); h.requests[0].fail(); await h.completeAll();
  assert.equal(h.requests.length, 9); assert.equal(h.received.length, 8); assert.ok(!h.received.some(value => value.id === 'natural')); cancel(); await settle(); assert.equal(h.disk.size, 0);
});

test('trocar geração cancelada com três renders pendentes compartilha teto global de três decoders', async () => {
  const h = harness(), old = [], current = [];
  const cancelOld = h.start(fixture(), 'target', 2.5, (id, uri) => old.push({ id, uri })); await settle();
  assert.equal(h.requests.length, 3); assert.equal(h.active(), 3); cancelOld();
  const cancelCurrent = h.start(fixture(), 'previous', 1, (id, uri) => current.push({ id, uri })); await settle();
  assert.equal(h.requests.length, 3, 'replacement waits for native decoder leases'); assert.equal(h.peak(), 3);
  assert.equal(h.operations.some(operation => operation.type === 'delete'), false, 'cancelled cache survives pending writers');
  await h.completeAll(); assert.equal(h.peak(), 3); assert.equal(h.requests.length, 12);
  assert.deepEqual(old, []); assert.equal(current.length, 9); assert.ok(current.every(value => value.uri.includes('/cache-2/')));
  assert.equal(h.operations.filter(operation => operation.type === 'delete').length, 1); assert.ok([...h.disk].every(uri => uri.includes('/cache-2/')));
  cancelCurrent(); await settle(); assert.equal(h.disk.size, 0); assert.equal(h.operations.filter(operation => operation.type === 'delete').length, 2);
});
test('geração cancelada enquanto aguarda lease não abre decoder nem retém seu diretório', async () => {
  const h = harness(), middle = [], current = [], cancelFirst = h.start(); await settle(); cancelFirst();
  const cancelMiddle = h.start(fixture(), 'previous', 1, (id, uri) => middle.push({ id, uri })); await settle(); cancelMiddle();
  const cancelCurrent = h.start(fixture(), 'target', 3, (id, uri) => current.push({ id, uri })); await settle();
  assert.equal(h.requests.length, 3); await h.completeAll(); assert.equal(h.requests.length, 12); assert.equal(h.peak(), 3);
  assert.ok(!h.requests.some(request => request.uri.includes('/cache-2/'))); assert.deepEqual(middle, []); assert.equal(current.length, 9);
  assert.equal(h.operations.filter(operation => operation.type === 'delete').length, 2); assert.ok([...h.disk].every(uri => uri.includes('/cache-3/')));
  cancelCurrent(); await settle(); assert.equal(h.disk.size, 0); assert.equal(h.operations.filter(operation => operation.type === 'delete').length, 3);
});

test('miniaturas conservam os ajustes e a intensidade que serão aplicados ao escolher o filtro', async () => {
  const h = harness(), grade = { ...model.studioGrade(), exposure: .6, contrast: .2, temperature: -.1, intensity: .4 };
  const editing = model.patchStudioClipGrade(fixture(), 'target', grade), cancel = h.start(editing);
  await h.completeAll();
  for (const preset of catalog) {
    const request = h.requests.find(request => request.uri.endsWith(`/${preset.id}.jpg`));
    const actual = request.recipe.clips.find(clip => clip.id === 'target').grade;
    assert.deepEqual(actual, preset.preserveAdjustments ? { ...grade, preset: preset.grade.preset } : { ...preset.grade, intensity: grade.intensity });
  }
  cancel(); await settle(); assert.equal(h.disk.size, 0);
});

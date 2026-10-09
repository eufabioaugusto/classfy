import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
import { compileStudioRecipe, emptyStudioEditing, moveStudioLayerItemToLane, studioTicks,
  validateStudioEditing, validateStudioPendingTakes } from './model.ts';

const ticks = studioTicks;
const text = id => ({ id, kind: 'text', atTicks: ticks(1), durationTicks: ticks(2),
  anchor: { clipId: 'main', offsetTicks: ticks(1) },
  rect: { x: 0.1, y: 0.2, width: 0.5, height: 0.2 },
  text: { content: id, fontFamily: 'System', fontSize: 0.06, color: '#FFFFFF', backgroundColor: '#00000000', alignment: 'center' } });
function fixture(grouped = false) {
  return { ...emptyStudioEditing('aula'),
    assets: [
      { id: 'video', kind: 'video', uri: 'file:///main.mp4', name: 'Main', durationTicks: ticks(8), width: 1920, height: 1080 },
      { id: 'image', kind: 'image', uri: 'file:///overlay.png', name: 'Imagem', durationTicks: 0, width: 800, height: 600 },
    ], main: [{ id: 'main', assetId: 'video', sourceStartTicks: ticks(2), sourceEndTicks: ticks(8) }],
    layers: [
      { id: 'titles', kind: 'text', items: [text('a'), ...(grouped ? [{ ...text('b'), atTicks: ticks(3), anchor: { clipId: 'main', offsetTicks: ticks(3) } }] : [])] },
      { id: 'images', kind: 'image', items: [{ id: 'photo', kind: 'image', assetId: 'image', atTicks: 0, durationTicks: ticks(5),
        rect: { x: 0.65, y: 0.05, width: 0.3, height: 0.3 } }] },
    ] };
}
const recipe = editing => compileStudioRecipe({ kind: 'aula', takes: [], editing });

test('reordenar item único muda zIndex preservando faixa, pixels, tempo, vínculo e original', () => {
  const original = fixture(); const snapshot = JSON.stringify(original);
  const moved = moveStudioLayerItemToLane(original, 'a', 2);
  assert.deepEqual(moved.layers.map(layer => layer.id), ['images', 'titles']);
  assert.equal(moved.layers[1], original.layers[0]);
  assert.equal(moved.main, original.main); assert.equal(moved.assets, original.assets);
  const before = recipe(original).clips.find(clip => clip.id === 'a');
  assert.deepEqual(recipe(moved).clips.find(clip => clip.id === 'a'), { ...before, zIndex: 2 });
  assert.equal(JSON.stringify(original), snapshot);
  assert.deepEqual(validateStudioEditing(moved, 'aula'), []);
});

test('extrair só o texto segurado mantém legendas irmãs e tipo das faixas de destino', () => {
  const original = fixture(true);
  const moved = moveStudioLayerItemToLane(original, 'a', 3);
  assert.deepEqual(moved.layers.map(layer => [layer.id, layer.kind, layer.items.map(item => item.id)]), [
    ['titles', 'text', ['b']], ['images', 'image', ['photo']], ['layer:item:a', 'text', ['a']],
  ]);
  assert.equal(moved.layers[0].items[0], original.layers[0].items[1]);
  assert.equal(moved.layers[2].items[0], original.layers[0].items[0]);
  assert.deepEqual(recipe(moved).clips.find(clip => clip.id === 'b'), recipe(original).clips.find(clip => clip.id === 'b'));
  assert.deepEqual(validateStudioEditing(moved, 'aula'), []);
});

test('mudar faixa não faz merge ou colisão temporal e permite ordens sucessivas sem IDs duplicados', () => {
  const original = fixture(true);
  const extracted = moveStudioLayerItemToLane(original, 'a', 2);
  assert.deepEqual(extracted.layers.map(layer => layer.items.map(item => item.id)), [['b'], ['a'], ['photo']]);
  const back = moveStudioLayerItemToLane(extracted, 'a', 1);
  assert.deepEqual(back.layers.map(layer => layer.items.map(item => item.id)), [['a'], ['b'], ['photo']]);
  assert.equal(back.layers[0].id, 'layer:item:a');
  assert.equal(new Set(back.layers.map(layer => layer.id)).size, 3);
  assert.equal(recipe(back).clips.find(clip => clip.id === 'a').startTicks, ticks(1));
  assert.equal(recipe(back).clips.find(clip => clip.id === 'a').durationTicks, ticks(2));
});

test('ID de faixa nova evita colisão com faixa legada sem substituir dados', () => {
  const original = fixture(true);
  original.layers[1].id = 'layer:item:a';
  const moved = moveStudioLayerItemToLane(original, 'a', 3);
  assert.equal(moved.layers[2].id, 'layer:item:a:1');
  assert.equal(moved.layers[1].items[0].id, 'photo');
  assert.deepEqual(validateStudioEditing(moved, 'aula'), []);
});

test('posição atual é noop; índices extrapolados são limitados e valores não inteiros rejeitados', () => {
  const original = fixture(true);
  assert.equal(moveStudioLayerItemToLane(original, 'a', 1), original);
  assert.equal(moveStudioLayerItemToLane(original, 'a', -10), original);
  assert.equal(moveStudioLayerItemToLane(original, 'a', 100).layers.at(-1).items[0].id, 'a');
  for (const target of [NaN, Infinity, 1.5, undefined]) assert.throws(() => moveStudioLayerItemToLane(original, 'a', target), /posição/);
  assert.throws(() => moveStudioLayerItemToLane(original, 'missing', 1), /não está/);
});

test('elemento oculto pelo corte pode mudar zIndex sem inventar intervalo visível', () => {
  const original = fixture();
  original.layers[0].items[0].anchor = { clipId: 'main', sourceStartTicks: ticks(0), sourceEndTicks: ticks(1) };
  assert.equal(recipe(original).clips.some(clip => clip.id === 'a'), false);
  const moved = moveStudioLayerItemToLane(original, 'a', 2);
  assert.equal(recipe(moved).clips.some(clip => clip.id === 'a'), false);
  assert.deepEqual(moved.layers[1].items[0], original.layers[0].items[0]);
});

test('journal permite metadados válidos de imagem e rejeita dimensões ou tipo corrompidos', () => {
  const pending = { id: 'image', uri: 'file:///image.heic', name: 'Imagem', kind: 'image', imageSize: { width: 3024, height: 4032 } };
  assert.deepEqual(validateStudioPendingTakes([pending]), []);
  for (const patch of [{ imageSize: { width: 0, height: 100 } }, { imageSize: { width: NaN, height: 100 } },
    { imageSize: { width: 100, height: Infinity } }, { kind: 'video' }, { imageSize: null }]) {
    assert.match(validateStudioPendingTakes([{ ...pending, ...patch }])[0], /dimensões/);
  }
});

test('faixa vertical e deslocamento temporal persistem juntos; restart conserva item e irmãos', async () => {
  const data = new Map();
  function loadStore() {
    const compiled = ts.transpileModule(readFileSync(new URL('./store.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    const dependencies = {
      './model': model,
      'expo-crypto': { randomUUID: () => 'project' },
      'expo-file-system/legacy': { documentDirectory: 'file:///current/Documents/' },
      '@react-native-async-storage/async-storage': {
        getItem: async key => data.get(key) ?? null,
        setItem: async (key, value) => data.set(key, value),
      },
    };
    new Function('require', 'module', 'exports', compiled)(name => dependencies[name], module, module.exports);
    return module.exports;
  }
  const store = loadStore(); const project = await store.createStudioProject('owner', 'aula');
  const initial = await store.updateStudioProject('owner', project.id, { editing: fixture(true) });
  const saved = await store.mutateStudioProject('owner', project.id, current => ({
    editing: moveStudioLayerItemToLane(model.patchStudioLayerItem(current.editing, 'a', {
      atTicks: ticks(2), anchor: { clipId: 'main', offsetTicks: ticks(2) },
    }), 'a', 3),
  }));
  assert.equal(saved.revision, initial.revision + 1, 'the two directions share one persistent operation');
  const restarted = loadStore(); await restarted.loadStudioProjects('owner');
  const loaded = restarted.getStudioProject('owner', project.id);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.editing)), JSON.parse(JSON.stringify(saved.editing)));
  const movedClip = recipe(loaded.editing).clips.find(clip => clip.id === 'a');
  const siblingClip = recipe(loaded.editing).clips.find(clip => clip.id === 'b');
  assert.equal(movedClip.startTicks, ticks(2)); assert.equal(movedClip.zIndex, 3);
  assert.equal(siblingClip.startTicks, ticks(3)); assert.equal(siblingClip.zIndex, 1);
  assert.equal(loaded.editing.assets[1].uri, 'file:///overlay.png');
});

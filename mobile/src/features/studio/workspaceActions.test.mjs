import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
function compile(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  return module.exports;
}
function harness() {
  const data = new Map(), files = new Map(), copies = [], deleted = [];
  let sequence = 0, copyFailure = false, diskFailure = false, current = true, pauseCopy, pauseWrite;
  const fs = { documentDirectory: 'file:///Documents/', makeDirectoryAsync: async () => {}, getInfoAsync: async uri => ({ exists: files.has(uri), isDirectory: false, size: files.get(uri)?.length || 0 }),
    copyAsync: async ({ from, to }) => {
      if (copyFailure) throw new Error('Falha na cópia');
      files.set(to, files.get(from)); copies.push({ from, to });
      if (pauseCopy) { const pause = pauseCopy; pauseCopy = undefined; await pause; }
    }, deleteAsync: async uri => { deleted.push(uri); for (const path of files.keys()) if (path.startsWith(uri)) files.delete(path); } };
  const crypto = { randomUUID: () => `uuid-${++sequence}` };
  const storage = { getItem: async key => data.get(key) || null, setItem: async (key, value) => {
    if (diskFailure) { diskFailure = false; throw new Error('Disco cheio'); }
    if (pauseWrite) { const pause = pauseWrite; pauseWrite = undefined; await pause; }
    data.set(key, value);
  } };
  const store = compile('./store.ts', { '@react-native-async-storage/async-storage': { default: storage }, 'expo-crypto': crypto, 'expo-file-system/legacy': fs, './model': model });
  const actions = compile('./workspaceActions.ts', { 'expo-file-system/legacy': fs, 'expo-crypto': crypto, './store': store, './model': model });
  const scope = { isCurrent: () => current };
  return { store, actions, files, copies, deleted, data, scope, cancel: () => { current = false; }, failCopy: () => { copyFailure = true; }, failDisk: () => { diskFailure = true; },
    deferCopy: () => { let resolve; pauseCopy = new Promise(done => { resolve = done; }); return resolve; },
    deferWrite: () => { let resolve; pauseWrite = new Promise(done => { resolve = done; }); return resolve; } };
}
async function original(h, state = 'draft') {
  let project = await h.store.createStudioProject('owner', 'aula');
  const uri = name => `file:///Documents/classfy-studio/owner/${project.id}/${name}`;
  const ticks = model.studioTicks;
  const editing = { ...model.emptyStudioEditing('aula'), mainMuted: true,
    assets: [{ id: 'video', kind: 'video', uri: uri('video.mp4'), thumbnailUri: uri('thumb.jpg'), name: 'Aula original', durationTicks: ticks(5), width: 1920, height: 1080, frameRate: 30 },
      { id: 'image', kind: 'image', uri: uri('image.png'), thumbnailUri: uri('image.png'), name: 'Imagem', durationTicks: 0, width: 600, height: 400 },
      { id: 'audio', kind: 'audio', uri: uri('audio.m4a'), name: 'Narração', durationTicks: ticks(5) }],
    main: [{ id: 'clip-a', assetId: 'video', sourceStartTicks: ticks(1), sourceEndTicks: ticks(3), grade: model.studioGrade('studio') }, { id: 'clip-b', assetId: 'video', sourceStartTicks: ticks(3), sourceEndTicks: ticks(5) }],
    layers: [{ id: 'image-lane', kind: 'image', hidden: true, items: [{ id: 'image-item', kind: 'image', assetId: 'image', atTicks: 0, durationTicks: ticks(3), rect: { x: .5, y: .5, width: .3, height: .3 } }] },
      { id: 'text-lane', kind: 'text', items: [{ id: 'text-item', kind: 'text', atTicks: 0, durationTicks: ticks(1), anchor: { clipId: 'clip-a', sourceStartTicks: ticks(1), sourceEndTicks: ticks(2) }, text: { content: 'Aula em português', fontFamily: 'System', fontSize: .06, color: '#FFFFFF', backgroundColor: '#000000', alignment: 'center' } }] },
      { id: 'audio-lane', kind: 'audio', muted: true, items: [{ id: 'audio-item', kind: 'audio', assetId: 'audio', atTicks: 0, durationTicks: ticks(4), sourceStartTicks: 0, sourceEndTicks: ticks(4), gain: .7 }] }] };
  project = await h.store.updateStudioProject('owner', project.id, { editing, title: 'Aula em português', description: 'Aprendizado', objective: 'Objetivo', script: 'Roteiro', coverUri: uri('cover.jpg'), tags: ['educação'],
    state, exportedUri: uri('export.mp4'), exportedSignature: 'old-export', remoteDraftId: 'remote', uploadUrl: 'old-upload', mediaAssetId: 'old-media', submissionId: 'submitted', contentId: 'content' });
  for (const path of [uri('video.mp4'), uri('thumb.jpg'), uri('image.png'), uri('audio.m4a'), uri('cover.jpg')]) h.files.set(path, `original:${path}`);
  return project;
}
test('duplicar preserva cortes e camadas, copia originais uma vez e remove vínculos de envio', async () => {
  const h = harness(), source = await original(h, 'submitted');
  const before = JSON.stringify(source), copy = await h.actions.duplicateStudioProject('owner', source.id, h.scope);
  assert.equal(JSON.stringify(h.store.getStudioProject('owner', source.id)), before);
  assert.equal(copy.title, 'Aula em português (cópia)'); assert.equal(copy.state, 'draft');
  assert.equal(copy.exportedUri, undefined); assert.equal(copy.remoteDraftId, undefined); assert.equal(copy.mediaAssetId, undefined); assert.equal(copy.uploadUrl, undefined); assert.equal(copy.submissionId, undefined); assert.equal(copy.contentId, undefined);
  assert.equal(copy.takes.length, 2); assert.equal(copy.takes[0].uri, copy.takes[1].uri);
  assert.equal(copy.takes[0].start, 1); assert.equal(copy.takes[1].end, 5);
  assert.equal(copy.editing.mainMuted, true); assert.equal(copy.editing.layers[0].hidden, true); assert.equal(copy.editing.layers[2].muted, true);
  assert.equal(copy.editing.layers[1].items[0].text.content, 'Aula em português');
  assert.equal(copy.editing.layers[1].items[0].anchor.clipId, copy.editing.main[0].id);
  assert.notEqual(copy.editing.main[0].id, source.editing.main[0].id);
  assert.equal(h.copies.length, 5); assert.ok(h.copies.every(file => file.to.includes(`/${copy.id}/`)));
  assert.deepEqual(model.validateStudioRecipe(model.compileStudioRecipe(copy)), []);
  await h.store.removeStudioProject('owner', source.id);
  assert.ok(copy.editing.assets.every(asset => h.files.has(asset.uri))); assert.ok(h.files.has(copy.coverUri));
  const reopened = JSON.parse(h.data.get('classfy:studio:v2:owner')).find(project => project.id === copy.id);
  assert.equal(model.migrateStudioProject(reopened).takes.length, 2);
  await h.store.removeStudioProject('owner', copy.id);
  assert.ok(h.files.has(source.editing.assets[0].uri), 'excluir a cópia não remove originais');
});
for (const failure of ['copy', 'disk', 'scope']) test(`duplicação interrompida por ${failure} não publica cópia parcial nem apaga o original`, async () => {
  const h = harness(), source = await original(h), before = h.data.get('classfy:studio:v2:owner');
  let release;
  if (failure === 'copy') h.failCopy(); else if (failure === 'disk') h.failDisk(); else release = h.deferCopy();
  const operation = h.actions.duplicateStudioProject('owner', source.id, h.scope);
  if (failure === 'scope') { await new Promise(resolve => setImmediate(resolve)); h.cancel(); release(); }
  await assert.rejects(operation, /cópia|Disco cheio|cancelada/);
  assert.equal(h.store.studioSnapshot('owner').projects.length, 1); assert.equal(h.data.get('classfy:studio:v2:owner'), before);
  assert.ok(h.files.has(source.editing.assets[0].uri)); assert.ok(h.deleted.every(uri => !uri.includes(`/${source.id}/`)));
});
test('cópia já persistida sobrevive se foco mudar durante a escrita do índice', async () => {
  const h = harness(), source = await original(h), release = h.deferWrite();
  const operation = h.actions.duplicateStudioProject('owner', source.id, h.scope);
  await new Promise(resolve => setImmediate(resolve)); h.cancel(); release();
  const copy = await operation;
  assert.ok(h.store.getStudioProject('owner', copy.id)); assert.ok(h.files.has(copy.takes[0].uri)); assert.deepEqual(h.deleted, []);
});
test('rename verifica foco dentro da fila e não sobrescreve depois de trocar de sessão', async () => {
  const h = harness(), source = await original(h), release = h.deferWrite();
  const prior = h.store.updateStudioProject('owner', source.id, { description: 'Atualizada' });
  const rename = h.actions.renameStudioProject('owner', source.id, 'Outro nome', h.scope);
  await new Promise(resolve => setImmediate(resolve)); h.cancel(); release(); await prior;
  await assert.rejects(rename, /cancelada/); assert.equal(h.store.getStudioProject('owner', source.id).title, source.title);
});
test('rename é durável e a cópia recusa outra conta ou arquivos ainda pendentes', async () => {
  const h = harness(), source = await original(h);
  await h.actions.renameStudioProject('owner', source.id, '  Novo nome  ', h.scope);
  assert.equal(JSON.parse(h.data.get('classfy:studio:v2:owner'))[0].title, 'Novo nome');
  await assert.rejects(h.actions.duplicateStudioProject('other', source.id, h.scope), /sessão atual/);
  await h.store.updateStudioProject('owner', source.id, { pendingTakes: [{ id: 'pending', uri: 'file:///pending.mp4', name: 'Pendente' }] });
  await assert.rejects(h.actions.duplicateStudioProject('owner', source.id, h.scope), /recuperação/); assert.equal(h.copies.length, 0);
});

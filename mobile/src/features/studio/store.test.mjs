import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function compile(file, dependencies = {}) {
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => dependencies[name], Promise, Date, Error });
  return module.exports;
}
function harness(initial = {}) {
  const data = new Map(Object.entries(initial));
  let failure = false, sequence = 0, failKey = '', readbackKey = '';
  const writes = [];
  const storage = { getItem: async key => key === readbackKey && writes.includes(key) ? 'corrupted-readback' : data.get(key) || null, setItem: async (key, value) => {
    if (key === failKey) throw new Error('Interrupted migration');
    if (failure) { failure = false; throw new Error('Disk full'); }
    writes.push(key); data.set(key, value);
  } };
  const store = compile('./store.ts', {
    '@react-native-async-storage/async-storage': storage, 'expo-crypto': { randomUUID: () => `project-${++sequence}` },
    'expo-file-system/legacy': { documentDirectory: 'file:///new/Documents/' }, './model': compile('./model.ts'),
  });
  return { store, data, writes, failNext: () => { failure = true; }, failKey: key => { failKey = key; }, corruptReadback: key => { readbackKey = key; } };
}
const take = id => ({ id, uri: `file:///${id}.mp4`, name: id, duration: 10, start: 0, end: 10 });
test('duas anexações concorrentes e metadados não perdem takes ou texto', async () => {
  const { store } = harness();
  const p = await store.createStudioProject('owner', 'aula');
  await Promise.all([
    store.mutateStudioProject('owner', p.id, current => ({ takes: [...current.takes, take('a')] })),
    store.updateStudioProject('owner', p.id, { title: 'Título salvo' }),
    store.mutateStudioProject('owner', p.id, current => ({ takes: [...current.takes, take('b')] })),
  ]);
  const saved = store.getStudioProject('owner', p.id);
  assert.equal(saved.takes.map(t => t.id).join(','), 'a,b');
  assert.equal(saved.title, 'Título salvo');
});
test('falha no disco não exibe salvamento fictício e pode ser repetida', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  h.failNext();
  await assert.rejects(h.store.updateStudioProject('owner', p.id, { script: 'Roteiro novo' }), /Disk full/);
  assert.equal(h.store.getStudioProject('owner', p.id).script, '');
  await h.store.updateStudioProject('owner', p.id, { script: 'Roteiro novo' });
  assert.equal(h.store.getStudioProject('owner', p.id).script, 'Roteiro novo');
});
test('journal só retira o arquivo pendente quando ele entra de fato na montagem', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  await h.store.updateStudioProject('owner', p.id, { pendingTakes: [{ id: 'a', uri: 'file:///a.mp4', name: 'a' }, { id: 'b', uri: 'file:///b.mp4', name: 'b' }] });
  await h.store.updateStudioProject('owner', p.id, { title: 'Novo título' });
  assert.equal(h.store.getStudioProject('owner', p.id).pendingTakes.length, 2);
  await h.store.updateStudioProject('owner', p.id, { takes: [take('a')] });
  assert.equal(h.store.getStudioProject('owner', p.id).pendingTakes.map(t => t.id).join(','), 'b');
});
test('dados de outra conta e índices corrompidos não podem ser sobrescritos', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  assert.equal(h.store.getStudioProject('other', p.id), undefined);
  await assert.rejects(h.store.updateStudioProject('other', p.id, { title: 'Outra conta' }), /sessão atual/);
  const raw = JSON.stringify([{ version: 1, ownerId: 'someone', kind: 'aula', takes: [] }]);
  const corrupt = harness({ 'classfy:studio:v1:owner': raw });
  await assert.rejects(corrupt.store.createStudioProject('owner', 'aula'), /recuperação/);
  assert.equal(corrupt.data.get('classfy:studio:v1:owner'), raw);
});
test('edição durante upload e escrita depois da submissão ficam bloqueadas', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  await h.store.updateStudioProject('owner', p.id, { state: 'uploading' });
  await assert.rejects(h.store.updateStudioProject('owner', p.id, { takes: [take('a')] }), /interrompa/);
  await h.store.updateStudioProject('owner', p.id, { state: 'submitted' });
  await assert.rejects(h.store.updateStudioProject('owner', p.id, { title: 'Reabrir' }), /já foi enviado/);
});
test('abrir e preparar câmera temporária não cria índice, disco ou projeto em outra conta', async () => {
  const h = harness();
  const p = await h.store.createStudioProject('owner', 'short', { transient: true });
  assert.equal(h.store.getStudioProject('owner', p.id).id, p.id);
  assert.equal(h.store.getStudioProject('other', p.id), undefined);
  assert.equal(h.store.studioSnapshot('owner').projects.length, 0);
  assert.equal(h.data.has('classfy:studio:v1:owner'), false);
  await h.store.updateStudioProject('owner', p.id, { script: 'Texto da sessão' });
  assert.equal(h.store.getStudioProject('owner', p.id).script, 'Texto da sessão');
  assert.equal(h.data.has('classfy:studio:v1:owner'), false);
  assert.equal(await h.store.discardTransient('other', p.id), false);
  assert.equal(await h.store.discardTransient('owner', p.id), true);
  assert.equal(h.store.getStudioProject('owner', p.id), undefined);
});
test('primeiro journal promove o mesmo ID e sobrevive ao restart para recuperar mídia', async () => {
  const h = harness();
  const p = await h.store.createStudioProject('owner', 'aula', { transient: true });
  await h.store.updateStudioProject('owner', p.id, { title: 'Minha aula', pendingTakes: [{ id: 'a', uri: 'file:///a.mp4', name: 'a' }] });
  assert.equal(h.store.isTransientStudioProject('owner', p.id), false);
  assert.equal(h.store.studioSnapshot('owner').projects[0].id, p.id);
  assert.equal(await h.store.discardTransient('owner', p.id), false);
  const restarted = harness(Object.fromEntries(h.data));
  await restarted.store.loadStudioProjects('owner');
  const saved = restarted.store.getStudioProject('owner', p.id);
  assert.equal(saved.title, 'Minha aula');
  assert.equal(saved.pendingTakes.length, 1);
});
test('promoção concorrente anexando takes não duplica card nem perde clipes', async () => {
  const h = harness();
  const p = await h.store.createStudioProject('owner', 'aula', { transient: true });
  await Promise.all(['a', 'b'].map(id => h.store.mutateStudioProject('owner', p.id, current => ({ takes: [...current.takes, take(id)] }))));
  assert.equal(h.store.studioSnapshot('owner').projects.length, 1);
  assert.equal(h.store.getStudioProject('owner', p.id).takes.map(t => t.id).join(','), 'a,b');
});
test('falha ao promover não anuncia rascunho salvo e retry conserva ID e texto', async () => {
  const h = harness();
  const p = await h.store.createStudioProject('owner', 'aula', { transient: true });
  await h.store.updateStudioProject('owner', p.id, { title: 'Minha aula' });
  h.failNext();
  await assert.rejects(h.store.updateStudioProject('owner', p.id, { takes: [take('a')] }), /Disk full/);
  assert.equal(h.store.studioSnapshot('owner').projects.length, 0);
  assert.equal(h.store.getStudioProject('owner', p.id).takes.length, 0);
  assert.equal(h.store.isTransientStudioProject('owner', p.id), true);
  await h.store.updateStudioProject('owner', p.id, { takes: [take('a')] });
  assert.equal(h.store.studioSnapshot('owner').projects.length, 1);
  assert.equal(h.store.getStudioProject('owner', p.id).title, 'Minha aula');
});
test('descarte/remoção não quebram sessão com primeiro arquivo em escrita', async () => {
  const h = harness();
  const p = await h.store.createStudioProject('owner', 'aula', { transient: true });
  const release = h.store.retainStudioProjectMedia('owner', p.id);
  assert.equal(await h.store.discardTransient('owner', p.id), false);
  await assert.rejects(h.store.removeStudioProject('owner', p.id), /arquivos serem salvos/);
  assert.throws(() => h.store.retainStudioProjectMedia('other', p.id), /sessão atual/);
  release(); release();
  assert.equal(await h.store.discardTransient('owner', p.id), true);
});
test('primeiro take promovido mantém invalidação de export ao cortar e bloquear edits em upload', async () => {
  const h = harness(); const model = compile('./model.ts');
  const p = await h.store.createStudioProject('owner', 'short', { transient: true });
  const promoted = await h.store.updateStudioProject('owner', p.id, { takes: [take('a')] });
  await h.store.updateStudioProject('owner', p.id, { exportedUri: 'file:///export.mp4', exportedSignature: model.timelineSignature(promoted) });
  await h.store.updateStudioProject('owner', p.id, { takes: [{ ...take('a'), start: 1.1, end: 1.2 }] });
  const cut = h.store.getStudioProject('owner', p.id);
  assert.equal(cut.exportedUri, undefined);
  assert.equal(cut.takes[0].duration, 10);
  assert.equal(h.store.isTransientStudioProject('owner', p.id), false);
  await h.store.updateStudioProject('owner', p.id, { state: 'uploading' });
  await assert.rejects(h.store.updateStudioProject('owner', p.id, { takes: [] }), /interrompa/);
});

const v1Project = (patch = {}) => ({ version: 1, id: 'legacy', ownerId: 'owner', kind: 'aula', title: 'Título anterior', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '', takes: [take('a')], state: 'draft', progress: 0, revision: 2, createdAt: 'date', updatedAt: 'date', ...patch });
test('migração grava backup intacto antes de v2, confirma readback e serializa apenas edição', async () => {
  const raw = JSON.stringify([v1Project({ state: 'ready', mediaAssetId: 'remote' })]);
  const h = harness({ 'classfy:studio:v1:owner': raw });
  await h.store.loadStudioProjects('owner');
  assert.equal(h.store.studioSnapshot('owner').error, null);
  assert.equal(h.data.get('classfy:studio:v1:backup:owner'), raw);
  assert.equal(h.data.get('classfy:studio:v1:owner'), raw);
  assert.deepEqual(h.writes.slice(0, 2), ['classfy:studio:v1:backup:owner', 'classfy:studio:v2:owner']);
  const encoded = JSON.parse(h.data.get('classfy:studio:v2:owner'))[0];
  assert.equal(encoded.version, 2);
  assert.equal('takes' in encoded, false);
  const p = h.store.getStudioProject('owner', 'legacy');
  assert.equal(p.state, 'ready'); assert.equal(p.mediaAssetId, 'remote');
  assert.equal(p.takes[0].id, 'a');
});
test('falha em backup ou escrita v2 preserva índice anterior e bloqueia novo projeto', async () => {
  for (const failKey of ['classfy:studio:v1:backup:owner', 'classfy:studio:v2:owner']) {
    const raw = JSON.stringify([v1Project()]); const h = harness({ 'classfy:studio:v1:owner': raw });
    h.failKey(failKey);
    await h.store.loadStudioProjects('owner');
    assert.ok(h.store.studioSnapshot('owner').error);
    await assert.rejects(h.store.createStudioProject('owner', 'aula'));
    assert.equal(h.data.get('classfy:studio:v1:owner'), raw);
    assert.equal(h.data.has('classfy:studio:v2:owner'), false);
  }
});
test('readback diferente não anuncia migração concluída e backup permite recuperação explícita', async () => {
  const raw = JSON.stringify([v1Project()]); const h = harness({ 'classfy:studio:v1:owner': raw });
  h.corruptReadback('classfy:studio:v2:owner');
  await h.store.loadStudioProjects('owner');
  assert.ok(h.store.studioSnapshot('owner').error.includes('confirmar'));
  assert.equal(h.store.studioSnapshot('owner').projects.length, 0);
  assert.equal(h.data.get('classfy:studio:v1:backup:owner'), raw);
  h.corruptReadback('');
  await h.store.recoverStudioProjects('owner');
  assert.equal(h.store.studioSnapshot('owner').error, null);
  assert.equal(h.store.getStudioProject('owner', 'legacy').title, 'Título anterior');
  assert.ok([...h.data.keys()].some(key => key.startsWith('classfy:studio:v2:recovery:owner:')));
});
test('v2 corrompido não é sobrescrito no load; recuperação mantém os bytes danificados', async () => {
  const bad = '{corrupted'; const raw = JSON.stringify([v1Project()]);
  const h = harness({ 'classfy:studio:v2:owner': bad, 'classfy:studio:v1:backup:owner': raw });
  await h.store.loadStudioProjects('owner');
  assert.equal(h.data.get('classfy:studio:v2:owner'), bad);
  assert.equal(h.writes.length, 0);
  await h.store.recoverStudioProjects('owner');
  const recovery = [...h.data.keys()].find(key => key.startsWith('classfy:studio:v2:recovery:owner:'));
  assert.equal(h.data.get(recovery), bad);
  assert.equal(h.store.getStudioProject('owner', 'legacy').takes[0].id, 'a');
});
test('camada altera assinatura e upload bloqueia edição completa; disk full mantém projeto anterior', async () => {
  const h = harness(), model = compile('./model.ts'); const p = await h.store.createStudioProject('owner', 'aula');
  const base = await h.store.updateStudioProject('owner', p.id, { takes: [take('a')] });
  await h.store.updateStudioProject('owner', p.id, { exportedUri: 'file:///render.mp4', exportedSignature: model.timelineSignature(base), mediaAssetId: 'remote' });
  const editing = model.addStudioLayerItem(base.editing, model.createStudioTextItem({ id: 'text', clipId: 'a' }));
  h.failNext();
  await assert.rejects(h.store.updateStudioProject('owner', p.id, { editing }), /Disk full/);
  assert.equal(h.store.getStudioProject('owner', p.id).editing.layers.length, 0);
  assert.equal(h.store.getStudioProject('owner', p.id).exportedUri, 'file:///render.mp4');
  const saved = await h.store.updateStudioProject('owner', p.id, { editing });
  assert.equal(saved.exportedUri, undefined); assert.equal(saved.mediaAssetId, undefined);
  await h.store.updateStudioProject('owner', p.id, { state: 'uploading' });
  await assert.rejects(h.store.updateStudioProject('owner', p.id, { editing: model.removeStudioLayerItem(saved.editing, 'text') }), /interrompa/);
});
test('journal de camada mantém destino ao restart e só limpa quando o asset entra na camada', async () => {
  const h = harness(), model = compile('./model.ts'); const p = await h.store.createStudioProject('owner', 'short', { transient: true });
  const layerItem = { id: 'overlay', kind: 'image', assetId: 'original', atTicks: 0, durationTicks: model.studioTicks(3) };
  const journal = [{ id: 'original', kind: 'image', uri: 'file:///slide.jpg', name: 'Slide', layerItem, layerId: 'images' }];
  const pending = await h.store.updateStudioProject('owner', p.id, { pendingTakes: journal });
  assert.equal(h.store.isTransientStudioProject('owner', p.id), false);
  const restarted = harness(Object.fromEntries(h.data)); await restarted.store.loadStudioProjects('owner');
  assert.equal(restarted.store.getStudioProject('owner', p.id).pendingTakes[0].layerItem.id, 'overlay');
  let editing = { ...pending.editing, assets: [{ id: 'original', kind: 'image', uri: 'file:///slide.jpg', name: 'Slide', durationTicks: 0 }] };
  const onlyAsset = await h.store.updateStudioProject('owner', p.id, { editing });
  assert.equal(onlyAsset.pendingTakes.length, 1);
  editing = model.addStudioLayerItem(editing, layerItem, 'images');
  const saved = await h.store.updateStudioProject('owner', p.id, { editing });
  assert.equal(saved.takes.length, 0); assert.equal(saved.pendingTakes.length, 0);
  assert.equal(saved.editing.layers[0].items[0].id, 'overlay');
  await assert.rejects(h.store.updateStudioProject('owner', p.id, { pendingTakes: [{ ...journal[0], layerItem: { ...layerItem, assetId: 'different' } }] }), /destino/);
});

test('journal recuperado aplica grade mesmo quando caller antigo anexa sem metadata e falha de disco conserva a receita', async () => {
  const h = harness(), model = compile('./model.ts'); const p = await h.store.createStudioProject('owner', 'aula', { transient: true });
  const grade = { ...model.studioGrade('studio'), intensity: 0.6 };
  await h.store.updateStudioProject('owner', p.id, { pendingTakes: [{ id: 'a', uri: 'file:///a.mp4', name: 'a', grade }] });
  const restarted = harness(Object.fromEntries(h.data)); await restarted.store.loadStudioProjects('owner'); restarted.failNext();
  await assert.rejects(restarted.store.updateStudioProject('owner', p.id, { takes: [take('a')] }), /Disk full/);
  const preserved = restarted.store.getStudioProject('owner', p.id);
  assert.equal(preserved.takes.length, 0); assert.equal(preserved.pendingTakes[0].grade.intensity, 0.6);
  const saved = await restarted.store.updateStudioProject('owner', p.id, { takes: [take('a')] });
  assert.equal(saved.pendingTakes.length, 0); assert.equal(saved.editing.main[0].grade.intensity, 0.6);
  assert.equal(saved.editing.main[0].grade.preset, 'studio'); assert.equal(Object.hasOwn(saved.editing.assets[0], 'grade'), false);
});

test('journal só conclui quando o clip principal preserva a grade capturada, não por uso do original em camada', async () => {
  const h = harness(), model = compile('./model.ts'); const p = await h.store.createStudioProject('owner', 'aula');
  const grade = { ...model.studioGrade('cinematic'), intensity: 0.7 };
  const pending = await h.store.updateStudioProject('owner', p.id, { pendingTakes: [{ id: 'a', uri: 'file:///a.mp4', name: 'a', grade }] });
  let editing = { ...pending.editing, assets: [{ id: 'original', uri: 'file:///a.mp4', name: 'a', kind: 'video', durationTicks: model.studioTicks(10) }] };
  editing = model.addStudioLayerItem(editing, { id: 'pip', assetId: 'original', kind: 'video', atTicks: 0, durationTicks: model.studioTicks(1), sourceStartTicks: 0, sourceEndTicks: model.studioTicks(1) });
  const overlay = await h.store.updateStudioProject('owner', p.id, { editing }); assert.equal(overlay.pendingTakes.length, 1);
  editing = { ...editing, main: [{ id: 'a', assetId: 'original', sourceStartTicks: 0, sourceEndTicks: model.studioTicks(10) }] };
  const untreated = await h.store.updateStudioProject('owner', p.id, { editing }); assert.equal(untreated.pendingTakes.length, 1);
  const finished = await h.store.updateStudioProject('owner', p.id, { editing: model.patchStudioClipGrade(editing, 'a', grade) });
  assert.equal(finished.pendingTakes.length, 0);
});

test('journal com grade inválida não pode corromper índice nem ser reinterpretado como uma camada', async () => {
  const h = harness(), model = compile('./model.ts'); const p = await h.store.createStudioProject('owner', 'aula');
  for (const patch of [{ preset: 'outro' }, { intensity: 1.1 }, { exposure: Infinity }, { saturation: -1.1 }]) {
    await assert.rejects(h.store.updateStudioProject('owner', p.id, { pendingTakes: [{ id: 'a', uri: 'file:///a.mp4', name: 'a', grade: { ...model.studioGrade(), ...patch } }] }), /tratamento.*recuperação/);
  }
  assert.equal(h.store.getStudioProject('owner', p.id).pendingTakes, undefined);
  const layerItem = { id: 'pip', kind: 'video', assetId: 'a', atTicks: 0, durationTicks: model.studioTicks(1) };
  await assert.rejects(h.store.updateStudioProject('owner', p.id, { pendingTakes: [{ id: 'a', uri: 'file:///a.mp4', name: 'a', grade: model.studioGrade('studio'), layerItem }] }), /destino/);
  const valid = await h.store.updateStudioProject('owner', p.id, { pendingTakes: [{ id: 'a', uri: 'file:///a.mp4', name: 'a', grade: model.studioGrade('studio') }] });
  const corrupted = JSON.parse(JSON.stringify([valid])); corrupted[0].pendingTakes[0].grade.intensity = 2;
  const raw = JSON.stringify(corrupted), restarted = harness({ 'classfy:studio:v2:owner': raw }); await restarted.store.loadStudioProjects('owner');
  assert.ok(restarted.store.studioSnapshot('owner').error); assert.equal(restarted.data.get('classfy:studio:v2:owner'), raw);
});

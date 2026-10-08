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
  let failure = false, sequence = 0;
  const storage = { getItem: async key => data.get(key) || null, setItem: async (key, value) => {
    if (failure) { failure = false; throw new Error('Disk full'); }
    data.set(key, value);
  } };
  const store = compile('./store.ts', {
    '@react-native-async-storage/async-storage': storage, 'expo-crypto': { randomUUID: () => `project-${++sequence}` },
    'expo-file-system/legacy': { documentDirectory: 'file:///new/Documents/' }, './model': compile('./model.ts'),
  });
  return { store, data, failNext: () => { failure = true; } };
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

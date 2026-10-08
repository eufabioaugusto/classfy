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

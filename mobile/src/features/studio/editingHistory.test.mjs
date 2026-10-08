import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioEditingHistory, studioEditingFingerprint } from './editingHistory.ts';
import { duplicateStudioTake, moveStudioTake, removeStudioTake, splitStudioTake } from './timeline.ts';

const take = (id, uri = `file:///Documents/${id}.mp4`) => ({ id, uri, name: id, duration: 10, start: 0, end: 10,
  width: 1920, height: 1080, thumbnailUri: `${uri}.jpg` });
const project = (takes = [take('a'), take('b')]) => ({ id: 'project', ownerId: 'owner', kind: 'aula', takes,
  title: 'Título atual', revision: 1, state: 'draft', coverUri: 'file:///cover.jpg' });
const persist = (history, current, operation) => {
  assert.ok(operation);
  const saved = { ...current, revision: current.revision + 1, takes: [...operation.takes] };
  assert.equal(history.commit(operation, saved), true);
  return saved;
};

test('corte, ordem, split, duplicação e remoção voltam somente após o save, preservando IDs e fontes', () => {
  const history = createStudioEditingHistory();
  let current = project();
  const initial = structuredClone(current);
  const snapshots = [studioEditingFingerprint(current)];
  const changes = [
    takes => takes.map(t => t.id === 'a' ? { ...t, start: 2, end: 8 } : t),
    takes => moveStudioTake(takes, 'b', 'a'),
    takes => splitStudioTake(takes, 'a', 5, 'left', 'right'),
    takes => duplicateStudioTake(takes, 'right', 'copy'),
    takes => removeStudioTake(takes, 'b'),
  ];
  for (const change of changes) {
    const beforeCount = history.state().undoCount;
    const op = history.beginEdit(current, change(current.takes));
    assert.equal(history.state().undoCount, beforeCount);
    assert.equal(history.state().canUndo, false);
    current = persist(history, current, op);
    snapshots.push(studioEditingFingerprint(current));
  }
  for (let index = snapshots.length - 2; index >= 0; index--) {
    current = persist(history, current, history.beginUndo(current));
    assert.equal(studioEditingFingerprint(current), snapshots[index]);
  }
  assert.deepEqual(current.takes, initial.takes);
  assert.equal(current.title, initial.title);
  assert.equal(current.coverUri, initial.coverUri);
  for (let index = 1; index < snapshots.length; index++) {
    current = persist(history, current, history.beginRedo(current));
    assert.equal(studioEditingFingerprint(current), snapshots[index]);
  }
});

test('save rejeitado de edit, undo e redo não avança histórico nem descarta um redo válido', () => {
  const history = createStudioEditingHistory();
  let current = project();
  const failedEdit = history.beginEdit(current, removeStudioTake(current.takes, 'a'));
  history.abort(failedEdit);
  assert.equal(history.state().undoCount, 0);
  current = persist(history, current, history.beginEdit(current, removeStudioTake(current.takes, 'a')));
  const failedUndo = history.beginUndo(current);
  history.abort(failedUndo);
  assert.deepEqual(history.state(), { canUndo: true, canRedo: false, undoCount: 1, redoCount: 0 });
  current = persist(history, current, history.beginUndo(current));
  const failedRedo = history.beginRedo(current);
  history.abort(failedRedo);
  assert.deepEqual(history.state(), { canUndo: false, canRedo: true, undoCount: 0, redoCount: 1 });
  assert.equal(history.beginEdit(current, current.takes.map(t => ({ ...t }))), null);
  assert.equal(history.state().canRedo, true);
  current = persist(history, current, history.beginEdit(current, removeStudioTake(current.takes, 'b')));
  assert.equal(history.state().canRedo, false);
});

test('publish do próprio save pode chegar antes do commit sem apagar o histórico', () => {
  const history = createStudioEditingHistory();
  let current = project();
  current = persist(history, current, history.beginEdit(current, removeStudioTake(current.takes, 'a')));
  const operation = history.beginEdit(current, current.takes.map(t => ({ ...t, end: 6 })));
  const saved = { ...current, title: 'Outro título salvo', takes: [...operation.takes] };
  history.sync(saved, 'owner');
  history.sync(saved, 'owner');
  assert.equal(history.state().undoCount, 1);
  assert.equal(history.state().canUndo, false);
  assert.equal(history.commit(operation, saved), true);
  assert.equal(history.state().undoCount, 2);
  history.sync({ ...saved, revision: 50, title: 'Metadados independentes' });
  assert.equal(history.state().canUndo, true);
});

test('importação externa, rebase, troca de projeto, formato, conta ou sessão invalidam históricos e tickets', () => {
  for (const external of [
    p => ({ ...p, takes: [...p.takes, take('imported')] }),
    p => ({ ...p, takes: p.takes.map(t => ({ ...t, uri: t.uri.replace('/Documents/', '/New/Documents/') })) }),
    p => ({ ...p, id: 'other-project' }),
    p => ({ ...p, kind: 'short' }),
    p => ({ ...p, ownerId: 'other-owner' }),
  ]) {
    const history = createStudioEditingHistory();
    let current = project();
    current = persist(history, current, history.beginEdit(current, removeStudioTake(current.takes, 'a')));
    const operation = history.beginUndo(current);
    history.sync(external(current));
    assert.equal(history.state().undoCount, 0);
    assert.equal(history.state().redoCount, 0);
    assert.equal(history.commit(operation, { ...current, takes: [...operation.takes] }), false);
    assert.equal(history.state().undoCount, 0);
  }
  const history = createStudioEditingHistory();
  let current = project();
  current = persist(history, current, history.beginEdit(current, removeStudioTake(current.takes, 'a')));
  history.sync(current, 'new-session');
  assert.equal(history.state().canUndo, false);
  history.sync(null);
  history.sync(current);
  assert.equal(history.state().canUndo, false);
});

test('snapshots não compartilham objetos mutáveis e uma operação não pode substituir fontes', () => {
  const history = createStudioEditingHistory();
  let current = project();
  const originalUri = current.takes[0].uri;
  const originalName = current.takes[0].name;
  const operation = history.beginEdit(current, removeStudioTake(current.takes, 'b'));
  assert.throws(() => { operation.takes[0].uri = 'file:///tampered.mp4'; }, TypeError);
  assert.throws(() => { operation.takes.pop(); }, TypeError);
  const saved = { ...current, takes: [...operation.takes] };
  assert.equal(history.commit(operation, saved), true);
  current.takes[0].name = 'Nome modificado fora do histórico';
  const undone = history.beginUndo(saved);
  assert.equal(undone.takes[0].name, originalName);
  assert.equal(undone.takes[0].uri, originalUri);
  history.abort(undone);
  for (const patch of [{ uri: 'file:///another.mp4' }, { duration: 20 }, { width: 3840 }, { thumbnailUri: 'file:///another.jpg' }]) {
    assert.throws(() => history.beginEdit(saved, [{ ...saved.takes[0], ...patch }]), /preservar/);
  }
  assert.throws(() => history.beginEdit(saved, [...saved.takes, take('new-original')]), /preservar/);
  assert.equal(history.state().undoCount, 1);
});

test('resultado diferente do esperado limpa histórico; abort/commit antigo não interferem em nova edição', () => {
  const history = createStudioEditingHistory();
  let current = project();
  const old = history.beginEdit(current, removeStudioTake(current.takes, 'a'));
  history.abort(old);
  const active = history.beginEdit(current, removeStudioTake(current.takes, 'b'));
  assert.equal(history.commit(old, { ...current, takes: [...old.takes] }), false);
  history.abort(old);
  assert.equal(history.state().canUndo, false);
  current = persist(history, current, active);
  const undo = history.beginUndo(current);
  assert.equal(history.commit(undo, { ...current, takes: [take('external')] }), false);
  assert.deepEqual(history.state(), { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 });
});

test('abort após publish não deixa histórico preso a uma versão que já mudou no disco', () => {
  const history = createStudioEditingHistory();
  let current = project();
  current = persist(history, current, history.beginEdit(current, removeStudioTake(current.takes, 'a')));
  const operation = history.beginUndo(current);
  history.sync({ ...current, takes: [...operation.takes] });
  history.abort(operation);
  assert.equal(history.state().canUndo, false);
  assert.equal(history.state().canRedo, false);
});

test('limite do histórico é aplicado após save; cortes inválidos e IDs duplicados não criam operações', () => {
  const history = createStudioEditingHistory({ limit: 2 });
  let current = project([take('a')]);
  for (const end of [9, 8, 7]) current = persist(history, current, history.beginEdit(current, [{ ...current.takes[0], end }]));
  assert.equal(history.state().undoCount, 2);
  current = persist(history, current, history.beginUndo(current));
  current = persist(history, current, history.beginUndo(current));
  assert.equal(current.takes[0].end, 9);
  assert.equal(history.beginUndo(current), null);
  for (const patch of [{ start: -1 }, { end: 10.2 }, { start: NaN }, { start: 1.1, end: 1.19 }]) {
    assert.throws(() => history.beginEdit(current, [{ ...current.takes[0], ...patch }]), /limites/);
  }
  assert.throws(() => history.beginEdit(current, [current.takes[0], { ...current.takes[0] }]), /identificação/);
  const exactTenth = history.beginEdit(current, [{ ...current.takes[0], start: 1.1, end: 1.2 }]);
  assert.ok(exactTenth);
  history.abort(exactTenth);
  assert.equal(history.state().redoCount, 2);
});

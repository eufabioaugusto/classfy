import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationIssues, rebaseStudioProject, timelineDuration, timelineSignature } from './model.ts';
const take = (id, duration, start = 0, end = duration) => ({ id, uri: `file:///${id}.mp4`, duration, start, end, name: id });
const project = (patch = {}) => ({ kind: 'short', title: 'Uma ideia', description: '', takes: [take('a', 180)], coverUri: 'file:///cover.jpg', visibility: 'free', price: '', ...patch });
test('limite de Short considera duração final e frações, sem arredondar para baixo', () => {
  assert.deepEqual(publicationIssues(project()), []);
  assert.ok(publicationIssues(project({ takes: [take('a', 180.01)] })).some(i => i.includes('3 minutos')));
  assert.deepEqual(publicationIssues(project({ takes: [take('a', 240, 20, 100), take('b', 200, 0, 100)] })), []);
});
test('exportação reutilizada é invalidada por corte, ordem, take ou formato, mas não por título', () => {
  const p = project({ takes: [take('a', 50), take('b', 20)] });
  const signature = timelineSignature(p);
  assert.equal(signature, timelineSignature({ ...p, title: 'Outro título' }));
  assert.notEqual(signature, timelineSignature({ ...p, takes: [...p.takes].reverse() }));
  assert.notEqual(signature, timelineSignature({ ...p, takes: [take('a', 50, 1), take('b', 20)] }));
  assert.notEqual(signature, timelineSignature({ ...p, kind: 'aula' }));
  assert.equal(timelineDuration(p.takes), 70);
});
test('publicação rejeita corte vazio, fora da origem ou não finito', () => {
  for (const t of [take('a', 10, 0, 11), take('a', 10, -1, 9), take('a', 10, 5, 5), take('a', 10, NaN, 9), take('a', Infinity)]) {
    assert.ok(publicationIssues(project({ takes: [t] })).some(i => i.includes('cortes')));
  }
});
test('corte mínimo de 0,1 segundo tolera precisão decimal sem aceitar corte menor', () => {
  assert.deepEqual(publicationIssues(project({ takes: [take('a', 2, 1.1, 1.2)] })), []);
  assert.ok(publicationIssues(project({ takes: [take('a', 2, 1.1, 1.199)] })).some(i => i.includes('cortes')));
});
test('arquivo copiado mas ainda fora da montagem exige recuperação ou retirada explícita', () => {
  assert.ok(publicationIssues(project({ pendingTakes: [{ id: 'pending', uri: 'file:///pending.mp4', name: 'Take interrompido' }] })).some(i => i.includes('pendentes')));
});
test('aula/podcast exigem descrição e conteúdo pago exige preço positivo', () => {
  assert.ok(publicationIssues(project({ kind: 'aula' })).some(i => i.includes('aprender')));
  assert.ok(publicationIssues(project({ visibility: 'paid', price: '0' })).some(i => i.includes('preço')));
  assert.deepEqual(publicationIssues(project({ visibility: 'paid', price: '19,90' })), []);
});
test('atualização do iPhone recupera arquivos após mudança do container, preservando a assinatura de edição', () => {
  const p = project({ ownerId: 'owner', id: 'project', takes: [{ ...take('a', 10), uri: 'file:///old/Documents/classfy-studio/owner/project/take.mp4' }],
    coverUri: 'file:///old/Documents/classfy-studio/owner/project/cover.jpg', exportedUri: 'file:///old/Documents/classfy-studio/owner/project/export.mp4' });
  p.exportedSignature = timelineSignature(p);
  p.uploadSignature = p.exportedSignature;
  const rebased = rebaseStudioProject(p, 'file:///new/Documents/');
  assert.equal(rebased.takes[0].uri, 'file:///new/Documents/classfy-studio/owner/project/take.mp4');
  assert.equal(rebased.exportedSignature, timelineSignature(rebased));
  assert.equal(rebased.uploadSignature, timelineSignature(rebased));
  assert.equal(rebaseStudioProject(project(), 'file:///new/Documents/').takes[0].uri, 'file:///a.mp4');
});

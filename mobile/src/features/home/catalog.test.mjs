import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, normalizeCatalog, buildFeed } from './catalog.ts';

test('a duração usa os segundos reais, inclusive acima de uma hora', () => {
  assert.equal(formatDuration(125), '2:05');
  assert.equal(formatDuration(3671), '1:01:11');
  assert.equal(formatDuration(0), '');
});
test('o contrato público de cursos usa lesson_count e duration_seconds sem expor playback', () => {
  const [course] = normalizeCatalog([{ id: 'course', lesson_count: 12, duration_seconds: 125, visibility: 'paid', profiles: { display_name: 'Fabio' } }], true);
  assert.equal(course.duration, '2:05');
  assert.equal(course.views, '12 aulas');
  assert.equal(course.contentType, 'curso');
  assert.equal(course.access, 'paid');
  assert.equal(course.fileUrl, undefined);
});
test('itens duplicados não reaparecem e filtros de formato e acesso são independentes', () => {
  const items = normalizeCatalog([{ id: '1', content_type: 'podcast', visibility: 'premium' }, { id: '1' }, { id: '2', content_type: 'aula' }]);
  assert.equal(items.length, 2);
  assert.deepEqual(buildFeed([...items, ...items], 'Premium', []).map((item) => item.id), ['1']);
  assert.deepEqual(buildFeed(items, 'Aulas', []).map((item) => item.id), ['2']);
});
test('interesses só reordenam Para você e não alteram o catálogo original', () => {
  const items = normalizeCatalog([{ id: '1', title: 'Fotografia' }, { id: '2', title: 'Aprender inteligência artificial' }]);
  assert.deepEqual(buildFeed(items, 'Para você', ['inteligência artificial']).map((item) => item.id), ['2', '1']);
  assert.deepEqual(buildFeed(items, 'Aulas', ['inteligência artificial']).map((item) => item.id), ['1', '2']);
  assert.deepEqual(items.map((item) => item.id), ['1', '2']);
});

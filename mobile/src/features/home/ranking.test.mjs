import test from 'node:test';
import assert from 'node:assert/strict';
import { homeSections, rankHomeContents } from './ranking.ts';
const content = (id, extra = {}) => ({ id, title: id, creator: 'Creator', views: '', duration: '', access: 'free', category: 'aula', contentType: 'aula', tone: '#000', viewsCount: 0, ...extra });
test('guest hierarchy retains all catalog sections and hides personalized', () => {
  const contents = [content('class'), content('podcast', { contentType: 'podcast' }), content('short', { contentType: 'short' }), content('pro', { access: 'pro' }), content('premium', { access: 'premium' }), content('paid', { access: 'paid' })];
  const sections = homeSections(contents, [content('course', { contentType: 'curso' })], [], false);
  assert.deepEqual(sections.map(s => s.key), ['personalized', 'trending', 'premium', 'podcasts', 'shorts', 'courses', 'paid', 'pro']);
  assert.equal(sections[0].contents.length, 0);
  assert.equal(sections[2].contents[0].id, 'premium');
  assert.equal(sections[7].contents[0].id, 'pro');
  assert.equal(sections[5].contents[0].id, 'course');
});
test('trending uses views with stable personalization and never mutates catalog', () => {
  const contents = [content('low', { viewsCount: 1 }), content('high', { viewsCount: 80 }), content('interest', { title: 'Design', viewsCount: 2 })];
  assert.deepEqual(homeSections(contents, [], [], true)[1].contents.map(c => c.id), ['high', 'interest', 'low']);
  assert.deepEqual(homeSections(contents, [], ['design'], true)[1].contents.map(c => c.id), ['interest', 'high', 'low']);
  assert.deepEqual(contents.map(c => c.id), ['low', 'high', 'interest']);
});
test('ranking shares web weights for category, title, tags and description', () => {
  const items = [content('description', { description: 'design' }), content('tag', { tags: ['design'] }), content('title', { title: 'Design' }), content('category', { category_id: 'design' })];
  assert.deepEqual(rankHomeContents(items, ['design']).map(c => c.id), ['category', 'title', 'tag', 'description']);
});
test('personalized feed has eight entries and empty sections remain empty', () => {
  const sections = homeSections(Array.from({ length: 12 }, (_, i) => content(String(i))), [], [], true);
  assert.equal(sections[0].contents.length, 8);
  assert.equal(sections[2].contents.length, 0);
  assert.equal(sections[4].contents.length, 0);
});

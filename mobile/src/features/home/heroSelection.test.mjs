import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialHeroEditorialState,
  resolveHeroEditorial,
  selectHomeHero,
} from './heroSelection.ts';

const fallback = {
  id: 'fallback', title: 'AULA MUX 1', creator: 'Creator Mentor',
  views: '', duration: '2:00', access: 'free', category: 'Aula', tone: '#111',
  publishedAt: '2026-10-01', thumbnailUrl: 'https://example.test/fallback.jpg',
};
const configured = {
  ...fallback, id: 'configured', title: 'A LUZ - Aula 1', access: 'pro',
};
const settings = { content_id: configured.id, title: 'Título editorial' };
const ready = (value) => resolveHeroEditorial(initialHeroEditorialState, {
  settings: value, error: null,
});
const select = (overrides = {}) => selectHomeHero({
  editorial: ready(settings), contents: [fallback, configured],
  candidates: [fallback, configured], creators: [], catalogLoading: false,
  catalogError: null, plan: 'free', ...overrides,
});

test('catálogo chega primeiro: nenhuma aula fallback aparece antes do destaque configurado', () => {
  const beforeSettings = select({ editorial: initialHeroEditorialState });
  assert.equal(beforeSettings.status, 'loading');
  assert.equal(beforeSettings.content, undefined);
  const afterSettings = select();
  assert.equal(afterSettings.content.id, configured.id);
  assert.equal(afterSettings.settings, settings);
});

test('configuração chega primeiro: aguarda catálogo e abre diretamente a aula configurada', () => {
  const beforeCatalog = select({
    catalogLoading: true, contents: [], candidates: [],
  });
  assert.equal(beforeCatalog.status, 'loading');
  assert.equal(beforeCatalog.content, undefined);
  assert.equal(select().content.id, configured.id);
});

test('ausência confirmada permite fallback, mas catálogo ainda pendente não permite', () => {
  const absent = ready(null);
  assert.equal(select({ editorial: absent, catalogLoading: true }).status, 'loading');
  const resolved = select({ editorial: absent });
  assert.equal(resolved.content.id, fallback.id);
  assert.equal(resolved.settings, null);
});

test('falha inicial na configuração não é tratada como ausência de destaque', () => {
  const failed = resolveHeroEditorial(initialHeroEditorialState, {
    settings: null, error: 'Sem conexão',
  });
  const result = select({ editorial: failed });
  assert.equal(result.status, 'error');
  assert.equal(result.content, undefined);
});

test('falha ao revalidar preserva o último destaque editorial, sem piscar fallback', () => {
  const previous = ready(settings);
  const failedRefresh = resolveHeroEditorial(previous, {
    settings: null, error: 'Sem conexão',
  });
  assert.equal(failedRefresh.error, 'Sem conexão');
  assert.equal(select({ editorial: failedRefresh }).content.id, configured.id);
  const recovered = resolveHeroEditorial(failedRefresh, {
    settings: { content_id: fallback.id }, error: null,
  });
  assert.equal(recovered.error, null);
  assert.equal(select({ editorial: recovered }).content.id, fallback.id);
});

test('catálogo com erro não confirma ausência do item configurado', () => {
  const missing = { contents: [fallback], catalogError: 'Parte do catálogo não carregou.' };
  assert.equal(select(missing).status, 'error');
  assert.equal(select(missing).content, undefined);
  assert.equal(select({ ...missing, catalogError: null }).content.id, fallback.id);
});

test('item editorial sem publicação não recebe configuração nem ações do destaque', () => {
  const result = select({ contents: [fallback, { ...configured, publishedAt: null }] });
  assert.equal(result.content.id, fallback.id);
  assert.equal(result.settings, null);
});

test('fallback de conteúdo mantém elegibilidade de acesso; creator é último recurso', () => {
  const premium = { ...configured, id: 'premium', access: 'premium' };
  const creator = { id: 'creator', creator_id: 'user', creator_name: 'Creator' };
  const guest = select({
    editorial: ready(null), contents: [premium], candidates: [premium], creators: [creator],
  });
  assert.equal(guest.content, undefined);
  assert.equal(guest.creator, creator);
  const member = select({
    editorial: ready(null), candidates: [premium], plan: 'premium',
  });
  assert.equal(member.content.id, premium.id);
});

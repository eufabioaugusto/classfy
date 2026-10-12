import {
  contextCacheKey, generationPrompt, IdeasError, runStudioIdeas, validateScript, validateSuggestions,
  type IdeasContext, type IdeasDependencies, type IdeasStore, type GenerationResult,
  type Reservation, type StoredSuggestion,
} from './core.ts';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CATEGORY = '33333333-3333-4333-8333-333333333333';
const CONTENT = '44444444-4444-4444-8444-444444444444';
const IDEA = '55555555-5555-4555-8555-555555555555';
const REQUEST = '66666666-6666-4666-8666-666666666666';
const JOB = '77777777-7777-4777-8777-777777777777';
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown) { assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
async function rejects(call: () => unknown | Promise<unknown>, code: string) {
  try { await call(); throw new Error(`Expected ${code}`); }
  catch (error) { assert(error instanceof IdeasError, `Unexpected error ${String(error)}`); equal(error.code, code); }
}
const context: IdeasContext = {
  categories: [{ id: CATEGORY, name: 'Design', slug: 'design' }],
  recentContents: [{ id: CONTENT, title: 'Introdução ao design acessível', description: 'Princípios de contraste e legibilidade.', tags: ['design'], categoryId: CATEGORY, categoryName: 'Design' }],
  source: { type: 'recent', label: 'Seus últimos conteúdos', contentIds: [CONTENT], categoryId: null },
  editorial: { categoryId: CATEGORY, categoryName: 'Design', teachingFocus: 'Ensino design acessível para interfaces.', ready: true },
  creatorBio: '', topicCategoryId: null,
  editorialRevision: { categoryId: CATEGORY, categoryName: 'Design', teachingFocus: 'Ensino design acessível para interfaces.', bio: '', creatorBio: '' },
};
const aiSuggestions = { suggestions: ['Contraste na prática', 'Erros de legibilidade', 'Design para todos'].map(title => ({
  title, summary: 'Uma explicação prática para melhorar a leitura das interfaces.',
  objective: 'Ensinar como avaliar contraste.', audience: 'Quem cria interfaces', tags: ['design', 'acessibilidade'], kind: 'aula', durationMinutes: 4,
})) };
const script = { description: 'Aprenda a pensar em contraste para construir interfaces acessíveis.', script: Array(130).fill('exemplo').join(' '), tags: ['design'] };
const idea = { ...aiSuggestions.suggestions[0], id: IDEA, kind: 'aula' as const };
function request(body: unknown, signal?: AbortSignal) {
  return new Request('https://example.test/studio-ideas', { method: 'POST', body: JSON.stringify(body), signal });
}
function fixture() {
  const calls = { context: [] as string[], suggestion: [] as string[], reserve: [] as string[], complete: 0, fail: [] as string[], generate: 0, cancel: [] as string[], save: [] as string[] };
  let cached: GenerationResult | null = null;
  let reservation: Reservation = { state: 'reserved', jobId: JOB };
  let stored: StoredSuggestion | null = { suggestion: idea, context };
  let activeContext = context;
  const store: IdeasStore = {
    context: async (owner, categoryId) => { calls.context.push(owner); if (categoryId && categoryId !== CATEGORY) throw new IdeasError('category_not_found', 'Categoria indisponível', 404); return activeContext; },
    suggestion: async (owner, id) => { calls.suggestion.push(owner); return owner === OWNER && id === IDEA ? stored : null; },
    cached: async owner => owner === OWNER ? cached : null,
    reserve: async input => { calls.reserve.push(input.ownerId); return reservation; },
    complete: async (owner, _job, result) => { assert(owner === OWNER); calls.complete++; cached = result; return true; },
    fail: async (_owner, _job, code) => { calls.fail.push(code); },
    cancel: async (owner, id) => { calls.cancel.push(`${owner}:${id}`); },
    saveEditorial: async (owner, categoryId, focus) => {
      calls.save.push(`${owner}:${categoryId}:${focus}`);
      if (categoryId !== CATEGORY) throw new IdeasError('category_not_found', 'Categoria indisponível', 404);
      activeContext = { ...activeContext, editorial: { categoryId, categoryName: 'Design', teachingFocus: focus, ready: true },
        editorialRevision: { ...activeContext.editorialRevision, categoryId, categoryName: 'Design', teachingFocus: focus } };
    },
  };
  const deps: IdeasDependencies = {
    authenticate: async () => ({ id: OWNER, admin: false, approvedCreator: true }), store,
    generate: async input => { calls.generate++; return input.action === 'suggest' ? aiSuggestions : script; },
    providerAvailable: () => true, id: () => crypto.randomUUID(), now: () => new Date('2026-10-11T20:00:00Z'),
  };
  return { calls, deps, setCached(value: GenerationResult) { cached = value; }, setReservation(value: Reservation) { reservation = value; }, setStored(value: StoredSuggestion | null) { stored = value; }, setContext(value: IdeasContext) { activeContext = value; } };
}

Deno.test('authentication and approved creator gate precede parsing or owner data access', async () => {
  const f = fixture();
  f.deps.authenticate = async () => { throw new IdeasError('unauthorized', 'Entre', 401); };
  await rejects(() => runStudioIdeas(new Request('https://example.test', { method: 'POST', body: 'broken json' }), f.deps), 'unauthorized');
  equal(f.calls.context.length, 0);
  f.deps.authenticate = async () => ({ id: OWNER, admin: false, approvedCreator: false });
  await rejects(() => runStudioIdeas(request({ action: 'context' }), f.deps), 'creator_required');
  equal(f.calls.context.length, 0);
});
Deno.test('admin is allowed without a creator profile; context never calls AI', async () => {
  const f = fixture();
  f.deps.authenticate = async () => ({ id: OWNER, admin: true, approvedCreator: false });
  const result = await runStudioIdeas(request({ action: 'context' }), f.deps);
  equal(result.suggestions, []); equal(result.source, context.source); equal(f.calls.generate, 0); equal(f.calls.reserve.length, 0);
});
Deno.test('client cannot inject another owner, publications, script or suggestion context', async () => {
  const f = fixture();
  const result = await runStudioIdeas(request({ action: 'suggest', ownerId: OTHER, context: { contents: [{ title: 'Private other user' }] }, requestId: REQUEST }), f.deps);
  equal(f.calls.context, [OWNER, OWNER]); equal(f.calls.reserve, [OWNER]); equal(result.source, context.source);
  assert((result.suggestions as Array<{ id: string }>).every(item => item.id !== IDEA));
});
Deno.test('script lookup is owner scoped and forged/other-owner suggestion fails before generation', async () => {
  const f = fixture();
  f.deps.authenticate = async () => ({ id: OTHER, admin: true, approvedCreator: false });
  await rejects(() => runStudioIdeas(request({ action: 'script', suggestionId: IDEA, kind: 'aula', durationMinutes: 1, requestId: REQUEST }), f.deps), 'suggestion_not_found');
  equal(f.calls.suggestion, [OTHER]); equal(f.calls.generate, 0); equal(f.calls.reserve.length, 0);
});
Deno.test('creator needs confirmed editorial fields, and an unknown category is rejected', async () => {
  const f = fixture();
  f.setContext({ ...context, editorial: { categoryId: null, categoryName: null, teachingFocus: '', ready: false }, recentContents: [], source: { type: 'empty', label: 'Escolha uma categoria', categoryId: null, contentIds: [] } });
  await rejects(() => runStudioIdeas(request({ action: 'suggest', requestId: REQUEST }), f.deps), 'editorial_required');
  await rejects(() => runStudioIdeas(request({ action: 'suggest', categoryId: OTHER, requestId: REQUEST }), f.deps), 'category_not_found');
  equal(f.calls.generate, 0);
});
Deno.test('exactly three distinct, typed and bounded ideas are required; IDs are minted on server', () => {
  const ideas = validateSuggestions(aiSuggestions, () => IDEA);
  equal(ideas.length, 3); equal(ideas[0].id, IDEA);
  for (const value of [{ suggestions: aiSuggestions.suggestions.slice(0, 2) }, { suggestions: [...aiSuggestions.suggestions, aiSuggestions.suggestions[0]] }, { suggestions: Array(3).fill(aiSuggestions.suggestions[0]) }, { suggestions: aiSuggestions.suggestions.map(item => ({ ...item, kind: 'live' })) }]) {
    let caught = false; try { validateSuggestions(value, () => IDEA); } catch (error) { caught = error instanceof IdeasError && error.code === 'ai_invalid_response'; } assert(caught);
  }
});
Deno.test('invalid provider JSON/result cannot be saved and errors never expose provider details', async () => {
  const f = fixture();
  f.deps.generate = async () => ({ suggestions: [] });
  await rejects(() => runStudioIdeas(request({ action: 'suggest', requestId: REQUEST }), f.deps), 'ai_invalid_response');
  equal(f.calls.complete, 0); equal(f.calls.fail, ['ai_invalid_response']);
  f.deps.generate = async () => { throw new Error('secret provider token or diagnostic payload'); };
  await rejects(() => runStudioIdeas(request({ action: 'suggest', requestId: REQUEST }), f.deps), 'generation_failed');
  equal(f.calls.complete, 0);
});
Deno.test('context reload and generation retry return cache without another AI call', async () => {
  const f = fixture();
  const initial = await runStudioIdeas(request({ action: 'suggest', requestId: REQUEST }), f.deps);
  const loaded = await runStudioIdeas(request({ action: 'context' }), f.deps);
  equal(loaded.cached, true); equal(loaded.suggestions, initial.suggestions); equal(f.calls.generate, 1);
  const cached = { suggestions: initial.suggestions, source: context.source, generatedAt: initial.generatedAt } as GenerationResult;
  f.setReservation({ state: 'cached', result: cached });
  f.deps.providerAvailable = () => false;
  const reused = await runStudioIdeas(request({ action: 'suggest', requestId: REQUEST }), f.deps);
  equal(reused.cached, true); equal(f.calls.generate, 1);
});
Deno.test('reservation conflicts, active generation and daily budget prevent AI work', async () => {
  for (const [state, code] of [['pending', 'generation_in_progress'], ['limit', 'generation_limit'], ['conflict', 'request_conflict'], ['failed', 'request_failed']] as const) {
    const f = fixture(); f.setReservation({ state, retryAfterSeconds: 10 });
    await rejects(() => runStudioIdeas(request({ action: 'suggest', requestId: REQUEST }), f.deps), code);
    equal(f.calls.generate, 0); equal(f.calls.complete, 0);
  }
});
Deno.test('cancelled requests cannot start AI or commit output after cancellation', async () => {
  const before = fixture(); const controller = new AbortController(); controller.abort();
  await rejects(() => runStudioIdeas(request({ action: 'suggest', requestId: REQUEST }, controller.signal), before.deps), 'generation_cancelled');
  equal(before.calls.generate, 0); equal(before.calls.reserve.length, 0);
  const during = fixture(); const controller2 = new AbortController();
  during.deps.generate = async () => { controller2.abort(); return aiSuggestions; };
  await rejects(() => runStudioIdeas(request({ action: 'suggest', requestId: REQUEST }, controller2.signal), during.deps), 'generation_cancelled');
  equal(during.calls.complete, 0); equal(during.calls.fail, ['generation_cancelled']);
  const cancel = fixture(); await runStudioIdeas(request({ action: 'cancel', ownerId: OTHER, requestId: REQUEST }), cancel.deps);
  equal(cancel.calls.cancel, [`${OWNER}:${REQUEST}`]);
});
Deno.test('script validates duration, preserves selected idea, and is teleprompter-ready', async () => {
  const f = fixture();
  for (const durationMinutes of [0, 4, 1.5]) await rejects(() => runStudioIdeas(request({ action: 'script', suggestionId: IDEA, kind: 'short', durationMinutes, requestId: REQUEST }), f.deps), 'invalid_request');
  const result = await runStudioIdeas(request({ action: 'script', suggestionId: IDEA, kind: 'short', durationMinutes: 1, requestId: REQUEST, title: 'Replace idea' }), f.deps);
  equal((result.draft as Record<string, unknown>).title, idea.title); equal((result.draft as Record<string, unknown>).script, script.script);
  equal((result.draft as Record<string, unknown>).kind, 'short'); equal(f.calls.complete, 1);
  let rejected = false; try { validateScript({ ...script, script: 'too short' }, idea, 'aula', 4); } catch { rejected = true; } assert(rejected);
});
Deno.test('context fingerprint changes with metadata and confirmed editorial anchors', async () => {
  const key = await contextCacheKey(context);
  assert(key !== await contextCacheKey({ ...context, recentContents: [{ ...context.recentContents[0], title: 'New topic' }] }));
  const categoryContext: IdeasContext = { ...context, source: { type: 'category', label: 'Categoria: Design', categoryId: CATEGORY, contentIds: [] } };
  assert(await contextCacheKey(categoryContext) !== await contextCacheKey({ ...categoryContext, recentContents: [] }));
  assert(key !== await contextCacheKey({ ...context, creatorBio: 'Nova bio sobre design.' }));
  assert(key !== await contextCacheKey({ ...context, editorial: { ...context.editorial, teachingFocus: 'Ensino escrita de interfaces.' } }));
  assert(key !== await contextCacheKey({ ...context, editorialRevision: { ...context.editorialRevision, bio: 'Bio editada' } }));
});
Deno.test('JSONB recursively reordered snapshot keys preserve fingerprint and permit fresh script', async () => {
  function reorder(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reorder);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]));
    return value;
  }
  const snapshot = reorder(JSON.parse(JSON.stringify(context))) as IdeasContext;
  equal(await contextCacheKey(snapshot), await contextCacheKey(context));
  const f = fixture(); f.setStored({ suggestion: idea, context: snapshot });
  const result = await runStudioIdeas(request({ action: 'script', suggestionId: IDEA, kind: 'aula', durationMinutes: 1, requestId: REQUEST }), f.deps);
  equal((result.draft as Record<string, unknown>).title, idea.title); equal(f.calls.generate, 1);
  assert(await contextCacheKey(snapshot) !== await contextCacheKey({ ...snapshot, recentContents: [{ ...snapshot.recentContents[0], title: 'Novo conteúdo' }] }));
  assert(await contextCacheKey(snapshot) !== await contextCacheKey({ ...snapshot, editorial: { ...snapshot.editorial, teachingFocus: 'Novo foco editorial confirmado.' } }));
  assert(await contextCacheKey(snapshot) !== await contextCacheKey({ ...snapshot, editorialRevision: { ...snapshot.editorialRevision, bio: 'Nova bio.' } }));
});
Deno.test('prompts describe only real metadata sources, isolate untrusted context and budget long scripts', () => {
  const suggestionPrompt = generationPrompt({ action: 'suggest', context });
  assert(suggestionPrompt.systemPrompt.includes('Não invente comentários'));
  assert(suggestionPrompt.userPrompt.includes('<CONTEXTO_DADOS>'));
  assert(!suggestionPrompt.userPrompt.includes('views_count'));
  const long = generationPrompt({ action: 'script', context, suggestion: idea, kind: 'aula', durationMinutes: 10 });
  assert(long.maxTokens >= 7_000); assert(long.userPrompt.includes('1300 palavras'));
});

Deno.test('ambiguous Luz title and even a meaningful bio cannot replace confirmed editorial setup', async () => {
  const f = fixture();
  const incomplete: IdeasContext = { ...context, editorial: { categoryId: null, categoryName: null, teachingFocus: '', ready: false },
    creatorBio: 'Eu ensino espiritualidade e desenvolvimento interior.',
    source: { type: 'empty', label: 'Defina seu foco editorial', contentIds: [], categoryId: null },
    recentContents: [{ ...context.recentContents[0], title: 'A LUZ - Aula 1', description: 'ddasdasdsa', tags: [], categoryId: null, categoryName: null }] };
  f.setContext(incomplete); f.setCached({ suggestions: validateSuggestions(aiSuggestions, () => IDEA), generatedAt: '2026-10-11T20:00:00Z' });
  const loaded = await runStudioIdeas(request({ action: 'context' }), f.deps);
  equal(loaded.suggestions, []); equal(loaded.cached, false); assert(typeof loaded.contextKey === 'string');
  await rejects(() => runStudioIdeas(request({ action: 'suggest', requestId: REQUEST }), f.deps), 'editorial_required');
  await rejects(() => runStudioIdeas(request({ action: 'script', suggestionId: IDEA, kind: 'aula', durationMinutes: 1, requestId: REQUEST }), f.deps), 'editorial_required');
  equal(f.calls.generate, 0); equal(f.calls.reserve.length, 0);
});
Deno.test('saving editorial is owner scoped, atomic in store and never automatically generates', async () => {
  const f = fixture();
  for (const teachingFocus of ['', 'curto', 'x'.repeat(281)]) await rejects(() => runStudioIdeas(request({ action: 'save_editorial', categoryId: CATEGORY, teachingFocus }), f.deps), 'invalid_editorial');
  equal(f.calls.save.length, 0);
  const result = await runStudioIdeas(request({ action: 'save_editorial', ownerId: OTHER, categoryId: CATEGORY, teachingFocus: '  Ensino escrita acessível para interfaces.  ' }), f.deps);
  equal(f.calls.save, [`${OWNER}:${CATEGORY}:Ensino escrita acessível para interfaces.`]);
  equal((result.editorial as Record<string, unknown>).teachingFocus, 'Ensino escrita acessível para interfaces.');
  assert(typeof result.contextKey === 'string'); equal(f.calls.generate, 0);
  assert(!Object.hasOwn(result, 'editorialRevision'));
});
Deno.test('changed editorial blocks old suggestions and cached script retries before AI or reserve', async () => {
  const f = fixture();
  f.setContext({ ...context, editorial: { ...context.editorial, teachingFocus: 'Ensino espiritualidade e desenvolvimento interior.' },
    editorialRevision: { ...context.editorialRevision, teachingFocus: 'Ensino espiritualidade e desenvolvimento interior.' } });
  f.setReservation({ state: 'cached', result: { generatedAt: '2026-10-11T20:00:00Z', draft: { ...script, title: idea.title, kind: 'aula', objective: idea.objective, audience: idea.audience } } });
  await rejects(() => runStudioIdeas(request({ action: 'script', suggestionId: IDEA, kind: 'aula', durationMinutes: 1, requestId: REQUEST }), f.deps), 'editorial_context_changed');
  equal(f.calls.generate, 0); equal(f.calls.reserve.length, 0);
  f.setStored({ suggestion: idea, context: { ...context, editorial: undefined } as unknown as IdeasContext });
  await rejects(() => runStudioIdeas(request({ action: 'script', suggestionId: IDEA, kind: 'aula', durationMinutes: 1, requestId: REQUEST }), f.deps), 'editorial_context_changed');
});
Deno.test('editorial or bio changes while AI runs cannot commit a stale output', async () => {
  const f = fixture();
  f.deps.generate = async () => {
    f.setContext({ ...context, creatorBio: 'Uma nova bio sobre espiritualidade.', editorialRevision: { ...context.editorialRevision, creatorBio: 'Uma nova bio sobre espiritualidade.' } });
    return aiSuggestions;
  };
  await rejects(() => runStudioIdeas(request({ action: 'suggest', requestId: REQUEST }), f.deps), 'editorial_context_changed');
  equal(f.calls.complete, 0); equal(f.calls.fail, ['editorial_context_changed']);
  const late = fixture();
  late.deps.store.complete = async () => { late.setContext({ ...context, editorialRevision: { ...context.editorialRevision, bio: 'A bio mudou entre check e commit.' } }); return false; };
  await rejects(() => runStudioIdeas(request({ action: 'suggest', requestId: REQUEST }), late.deps), 'editorial_context_changed');
});
Deno.test('spirituality is an explicit prompt anchor; Luz is not silently translated into physics', () => {
  const anchored: IdeasContext = { ...context, editorial: { categoryId: CATEGORY, categoryName: 'Espiritualidade', teachingFocus: 'Ensino espiritualidade e desenvolvimento interior.', ready: true },
    source: { type: 'profile', label: 'Seu foco editorial', categoryId: CATEGORY, contentIds: [CONTENT] },
    recentContents: [{ ...context.recentContents[0], title: 'A LUZ - Aula 1', description: 'ddasdasdsa', tags: [], categoryId: null, categoryName: null }] };
  const prompt = generationPrompt({ action: 'suggest', context: anchored });
  assert(prompt.userPrompt.includes('Espiritualidade')); assert(prompt.userPrompt.includes('desenvolvimento interior'));
  assert(prompt.systemPrompt.includes('Nunca mude essa área')); assert(prompt.systemPrompt.includes('Bio e publicações recentes são apenas apoio'));
});

import { requireUser, corsHeaders, json } from '../_shared/video/http.ts';
import { resolveAiProvider } from '../_shared/ai-provider.ts';
import { generateStudioIdeas, IdeasAiError } from './ai.ts';
import {
  IdeasError, runStudioIdeas,
  type IdeasContext, type IdeasStore, type Reservation,
  type GenerationResult, type Suggestion,
} from './core.ts';

// Client is scoped to each authenticated request; service credentials stay server-side.
type ServiceClient = Awaited<ReturnType<typeof requireUser>>['client'];
function storageError(): never {
  throw new IdeasError('context_unavailable', 'Não foi possível carregar seus conteúdos agora. Tente novamente.', 503);
}
function clipped(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').trim().slice(0, max) : '';
}
export function createIdeasStore(db: ServiceClient): IdeasStore {
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(name, args);
    if (error) {
      if (error.message === 'editorial_required') throw new IdeasError('editorial_required', 'Escolha sua categoria e conte sobre o que você ensina.', 422);
      if (error.message === 'editorial_context_changed') throw new IdeasError('editorial_context_changed', 'Seu contexto editorial mudou. Atualize as ideias.', 409);
      if (error.message === 'invalid_editorial') throw new IdeasError('invalid_editorial', 'Escolha sua categoria e descreva seu foco em 12 a 280 caracteres.');
      if (error.message === 'category_not_found') throw new IdeasError('category_not_found', 'Esta categoria não está disponível. Escolha outra.', 404);
      if (error.message === 'creator_required') throw new IdeasError('creator_required', 'Este recurso está disponível para creators aprovados.', 403);
      storageError();
    }
    return data as T;
  };
  return {
    async context(ownerId, categoryId) {
      const [categoriesResult, recentResult, profileResult] = await Promise.all([
        db.from('categories').select('id,name,slug').order('name').limit(200),
        db.from('contents').select('id,title,description,tags,category_id')
          .eq('creator_id', ownerId).eq('status', 'approved').in('content_type', ['aula', 'short', 'podcast'])
          .order('published_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(8),
        db.from('profiles').select('creator_category_id,creator_teaching_focus,bio,creator_bio').eq('id', ownerId).maybeSingle(),
      ]);
      if (categoriesResult.error || recentResult.error || profileResult.error || !profileResult.data) storageError();
      const categories = (categoriesResult.data ?? []).map(row => ({ id: row.id, name: clipped(row.name, 160), slug: clipped(row.slug, 160) }));
      const recentContents = (recentResult.data ?? []).map(row => ({
        id: row.id, title: clipped(row.title, 200), description: clipped(row.description, 1_600),
        tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 10).map(tag => clipped(tag, 80)) : [],
        categoryId: row.category_id, categoryName: categories.find(category => category.id === row.category_id)?.name ?? null,
      }));
      const category = categoryId ? categories.find(item => item.id === categoryId) : undefined;
      if (categoryId && !category) throw new IdeasError('category_not_found', 'Esta categoria não está disponível. Escolha outra.', 404);
      const profile = profileResult.data;
      const editorialCategory = categories.find(item => item.id === profile.creator_category_id);
      const teachingFocus = clipped(profile.creator_teaching_focus, 280);
      const ready = !!editorialCategory && teachingFocus.length >= 12 && teachingFocus.length <= 280;
      return {
        categories, recentContents,
        editorial: { categoryId: profile.creator_category_id ?? null, categoryName: editorialCategory?.name ?? null, teachingFocus, ready },
        // The editable profile bio is newer than the creator application bio.
        creatorBio: clipped(profile.bio, 1_600) || clipped(profile.creator_bio, 1_600),
        editorialRevision: { categoryId: profile.creator_category_id ?? null, categoryName: categoriesResult.data?.find(item => item.id === profile.creator_category_id)?.name ?? null,
          teachingFocus: profile.creator_teaching_focus ?? '', bio: profile.bio ?? '', creatorBio: profile.creator_bio ?? '' },
        topicCategoryId: category?.id ?? null,
        source: !ready
          ? { type: 'empty', label: 'Defina seu foco editorial', contentIds: [], categoryId: null }
          : category
          ? { type: 'category', label: `Categoria: ${category.name}`, contentIds: [], categoryId: category.id }
          : { type: 'profile', label: 'Seu foco editorial', contentIds: recentContents.map(item => item.id), categoryId: editorialCategory!.id },
      };
    },
    async suggestion(ownerId, suggestionId) {
      const { data, error } = await db.from('studio_idea_jobs').select('result,context_snapshot')
        .eq('owner_id', ownerId).eq('action', 'suggest').eq('status', 'ready')
        .gt('expires_at', new Date().toISOString()).contains('result', { suggestions: [{ id: suggestionId }] })
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) storageError();
      if (!data) return null;
      const suggestion = (data.result as GenerationResult).suggestions?.find(item => item.id === suggestionId);
      return suggestion ? { suggestion: suggestion as Suggestion, context: data.context_snapshot as IdeasContext } : null;
    },
    async cached(ownerId, action, cacheKey) {
      const { data, error } = await db.from('studio_idea_jobs').select('result').eq('owner_id', ownerId)
        .eq('action', action).eq('cache_key', cacheKey).eq('status', 'ready').gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) storageError();
      return data?.result as GenerationResult ?? null;
    },
    reserve(input) {
      return rpc<Reservation>('studio_ideas_reserve_editorial', {
        p_owner_id: input.ownerId, p_request_id: input.requestId, p_action: input.action,
        p_cache_key: input.cacheKey, p_context: input.context, p_refresh: input.refresh,
      });
    },
    complete(ownerId, jobId, result) {
      return rpc<boolean>('studio_ideas_complete', { p_owner_id: ownerId, p_job_id: jobId, p_result: result });
    },
    async fail(ownerId, jobId, code) { await rpc('studio_ideas_fail', { p_owner_id: ownerId, p_job_id: jobId, p_code: code }); },
    async cancel(ownerId, requestId) { await rpc('studio_ideas_cancel', { p_owner_id: ownerId, p_request_id: requestId }); },
    async saveEditorial(ownerId, categoryId, teachingFocus) {
      await rpc('studio_ideas_save_editorial', { p_owner_id: ownerId, p_category_id: categoryId, p_teaching_focus: teachingFocus });
    },
  };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  try {
    // Resolve the trusted identity once. Never accept owner, context or draft data from the client.
    let identity: Awaited<ReturnType<typeof requireUser>>;
    try { identity = await requireUser(request); }
    catch { throw new IdeasError('unauthorized', 'Entre na sua conta para usar a Classy.', 401); }
    const { user, client } = identity;
    const [roles, profile] = await Promise.all([
      client.from('user_roles').select('role').eq('user_id', user.id).in('role', ['creator', 'admin']),
      client.from('profiles').select('creator_status').eq('id', user.id).maybeSingle(),
    ]);
    if (roles.error || profile.error) storageError();
    const response = await runStudioIdeas(request, {
      authenticate: async () => ({
        id: user.id, admin: roles.data?.some(role => role.role === 'admin') ?? false,
        approvedCreator: (roles.data?.some(role => role.role === 'creator') ?? false) && profile.data?.creator_status === 'approved',
      }),
      store: createIdeasStore(client),
      providerAvailable: () => resolveAiProvider() !== 'none',
      id: () => crypto.randomUUID(), now: () => new Date(),
      generate: input => generateStudioIdeas(input),
    });
    return json(response);
  } catch (error) {
    const safe = error instanceof IdeasError ? error : new IdeasError('generation_failed', 'Não foi possível preparar seu conteúdo agora. Tente novamente.', 503);
    // Only a stable diagnostic code is logged; no metadata, token or provider output.
    console.warn('[studio-ideas]', safe.code);
    return json({ error: safe.message, code: safe.code, ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}), ...(safe instanceof IdeasAiError ? { diagnostic: safe.diagnostic } : {}) }, safe.status);
  }
});

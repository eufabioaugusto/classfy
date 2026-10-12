export type StudioIdeaKind = 'aula' | 'short' | 'podcast';
export type StudioIdeaCategory = { id: string; name: string; slug: string };
export type StudioIdeaSource = { type: 'profile' | 'recent' | 'category' | 'empty'; label: string; contentIds: string[]; categoryId: string | null };
export type StudioIdeasEditorial = { categoryId: string | null; categoryName: string | null; teachingFocus: string; ready: boolean };
export type StudioIdeaSuggestion = {
  id: string; title: string; summary: string; objective: string; audience: string; tags: string[];
  kind: StudioIdeaKind; durationMinutes: number;
};
export type StudioIdeaDraft = {
  kind: StudioIdeaKind; title: string; description: string; objective: string; audience: string; script: string; tags: string[];
  suggestionId: string; durationMinutes: number;
};
export type StudioIdeasContext = {
  categories: StudioIdeaCategory[];
  recentContents: { id: string; title: string; description: string; tags: string[]; categoryId: string | null; categoryName: string | null }[];
  source: StudioIdeaSource; editorial: StudioIdeasEditorial; contextKey: string | null; suggestions: StudioIdeaSuggestion[]; cached: boolean;
};
export type StudioIdeasSuggestions = { suggestions: StudioIdeaSuggestion[]; source: StudioIdeaSource; contextKey: string | null; cached: boolean; generatedAt?: string };
export type StudioIdeasScript = { draft: StudioIdeaDraft; cached: boolean; generatedAt?: string };
export type StudioIdeasRequest =
  | { action: 'context'; categoryId?: string }
  | { action: 'save_editorial'; categoryId: string; teachingFocus: string }
  | { action: 'suggest'; categoryId?: string; refresh?: boolean; requestId: string }
  | { action: 'script'; suggestionId: string; kind: StudioIdeaKind; durationMinutes: number; requestId: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resposta de sugestões inválida.');
  return value as Record<string, unknown>;
};
const text = (value: unknown, limit: number, required = false) => {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new Error('Resposta de sugestões inválida.');
  return value.trim();
};
const id = (value: unknown) => { if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Identificação de sugestão inválida.'); return value; };
const optionalId = (value: unknown) => value == null ? null : id(value);
const strings = (value: unknown) => {
  if (!Array.isArray(value) || value.length > 20) throw new Error('Resposta de sugestões inválida.');
  return value.map(item => text(item, 100, true));
};
const kind = (value: unknown): StudioIdeaKind => {
  if (value !== 'aula' && value !== 'short' && value !== 'podcast') throw new Error('Formato de roteiro inválido.');
  return value;
};
export function studioIdeaDuration(value: unknown, format: StudioIdeaKind) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > (format === 'short' ? 3 : 10)) throw new Error('Duração de roteiro inválida.');
  return Number(value);
}
function source(value: unknown): StudioIdeaSource {
  const item = object(value);
  if (item.type !== 'profile' && item.type !== 'recent' && item.type !== 'category' && item.type !== 'empty') throw new Error('Contexto de sugestões inválido.');
  if (!Array.isArray(item.contentIds) || item.contentIds.length > 8) throw new Error('Contexto de sugestões inválido.');
  return { type: item.type, label: text(item.label, 300), contentIds: item.contentIds.map(id), categoryId: optionalId(item.categoryId) };
}
function suggestions(value: unknown): StudioIdeaSuggestion[] {
  if (!Array.isArray(value) || value.length > 3) throw new Error('Resposta de sugestões inválida.');
  const result = value.map(value => {
    const item = object(value), format = kind(item.kind);
    return { id: id(item.id), title: text(item.title, 180, true), summary: text(item.summary, 1500, true), objective: text(item.objective, 1500), audience: text(item.audience, 1000), tags: strings(item.tags), kind: format, durationMinutes: studioIdeaDuration(item.durationMinutes, format) };
  });
  if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('Sugestões duplicadas.');
  return result;
}
export function parseStudioIdeasContext(value: unknown): StudioIdeasContext {
  const item = object(value);
  if (!Array.isArray(item.categories) || item.categories.length > 200 || !Array.isArray(item.recentContents) || item.recentContents.length > 8) throw new Error('Contexto de sugestões inválido.');
  const categories = item.categories.map(value => { const category = object(value); return { id: id(category.id), name: text(category.name, 180, true), slug: text(category.slug, 180, true) }; });
  const editorial = parseStudioIdeasEditorial(item.editorial, categories);
  return {
    categories,
    recentContents: item.recentContents.map(value => { const content = object(value); return { id: id(content.id), title: text(content.title, 1000), description: text(content.description, 10000), tags: strings(content.tags), categoryId: optionalId(content.categoryId), categoryName: content.categoryName == null ? null : text(content.categoryName, 180) }; }),
    source: source(item.source), editorial, contextKey: parseContextKey(item.contextKey), suggestions: editorial.ready ? suggestions(item.suggestions) : [], cached: editorial.ready && item.cached === true,
  };
}
function parseContextKey(value: unknown): string | null { return value == null ? null : text(value, 180, true); }
function parseStudioIdeasEditorial(value: unknown, categories: StudioIdeaCategory[]): StudioIdeasEditorial {
  if (value == null) return { categoryId: null, categoryName: null, teachingFocus: '', ready: false };
  const item = object(value), categoryId = optionalId(item.categoryId), teachingFocus = text(item.teachingFocus, 280);
  const category = categories.find(item => item.id === categoryId);
  return { categoryId, categoryName: category?.name || null, teachingFocus, ready: item.ready === true && !!category && teachingFocus.length >= 12 };
}
export function validateStudioIdeasEditorial(categoryId: unknown, teachingFocus: unknown, categories: StudioIdeaCategory[]) {
  const selected = id(categoryId), focus = text(teachingFocus, 280, true);
  if (!categories.some(item => item.id === selected)) throw new Error('Escolha sua área principal.');
  if (focus.length < 12) throw new Error('Conte um pouco mais sobre o que você ensina (pelo menos 12 caracteres).');
  return { categoryId: selected, teachingFocus: focus };
}
export function parseStudioIdeasSuggestions(value: unknown): StudioIdeasSuggestions {
  const item = object(value), result = suggestions(item.suggestions);
  if (result.length !== 3) throw new Error('Não foi possível receber as três sugestões.');
  return { suggestions: result, source: source(item.source), contextKey: parseContextKey(item.contextKey), cached: item.cached === true, generatedAt: typeof item.generatedAt === 'string' ? item.generatedAt : undefined };
}
export function validateStudioIdeaDraft(value: unknown): StudioIdeaDraft {
  const item = object(value), format = kind(item.kind);
  return { kind: format, title: text(item.title, 150, true), description: text(item.description, 10000), objective: text(item.objective, 1000), audience: text(item.audience, 500), script: text(item.script, 50000, true), tags: strings(item.tags), suggestionId: id(item.suggestionId), durationMinutes: studioIdeaDuration(item.durationMinutes, format) };
}
export function parseStudioIdeasScript(value: unknown, expected: Extract<StudioIdeasRequest, { action: 'script' }>): StudioIdeasScript {
  const item = object(value), draft = object(item.draft);
  if (item.suggestionId !== expected.suggestionId || item.durationMinutes !== expected.durationMinutes || draft.kind !== expected.kind) throw new Error('O roteiro recebido pertence a outra pauta.');
  return { draft: validateStudioIdeaDraft({ ...draft, suggestionId: item.suggestionId, durationMinutes: item.durationMinutes }), cached: item.cached === true, generatedAt: typeof item.generatedAt === 'string' ? item.generatedAt : undefined };
}
export function studioIdeasSourceKey(value: StudioIdeaSource) {
  return `${value.type}:${value.categoryId || ''}:${value.contentIds.join(',')}`;
}
export function studioIdeasContextKey(value: StudioIdeasContext) {
  return value.contextKey || JSON.stringify({ source: studioIdeasSourceKey(value.source), categoryId: value.editorial.categoryId, teachingFocus: value.editorial.teachingFocus });
}
export class StudioIdeasRequestError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
// A known failed/cancelled server job is terminal. An ambiguous transport
// failure keeps its UUID, so retry can retrieve the already generated output.
export function studioIdeasRetryNeedsNewId(cause: unknown) {
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  return typeof code === 'string' && ['request_failed', 'request_conflict', 'generation_failed', 'generation_cancelled', 'ai_invalid_response', 'ai_unavailable'].includes(code);
}
export function studioIdeasNeedsFreshContext(cause: unknown) {
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  return typeof code === 'string' && ['editorial_required', 'editorial_context_changed', 'suggestion_not_found'].includes(code);
}
export function studioIdeasFriendlyError(code: unknown, retryAfterSeconds?: unknown) {
  switch (code) {
    case 'context_required': case 'editorial_required': return 'Escolha sua área e conte sobre o que você ensina para personalizar as sugestões.';
    case 'editorial_context_changed': return 'Seu contexto mudou. Atualize as sugestões antes de preparar outro roteiro.';
    case 'invalid_editorial': return 'Escolha sua área principal e descreva o que você ensina em 12 a 280 caracteres.';
    case 'generation_in_progress': return 'A Classy já está preparando esse pedido. Aguarde um pouco e tente novamente.';
    case 'request_conflict': return 'Esse pedido mudou. Feche o painel e escolha a pauta novamente.';
    case 'request_failed': case 'generation_cancelled': return 'Essa geração foi encerrada. Tente novamente para preparar seu conteúdo.';
    case 'generation_limit': return typeof retryAfterSeconds === 'number' && retryAfterSeconds >= 3600 ? 'Você chegou ao limite de gerações por agora. Suas sugestões e roteiros já criados continuam disponíveis.' : 'Você fez vários pedidos em sequência. Aguarde um pouco e tente novamente.';
    case 'unauthorized': return 'Entre novamente na sua conta para criar com a Classy.';
    case 'forbidden': case 'creator_required': return 'A criação com a Classy está disponível para contas com acesso de creator.';
    case 'category_not_found': return 'Esta categoria não está mais disponível. Escolha outra categoria.';
    case 'suggestion_not_found': return 'Esta pauta não está mais disponível. Volte às ideias e peça novas sugestões.';
    default: return 'Não foi possível falar com a Classy agora. Seu texto permanece aqui; tente novamente.';
  }
}

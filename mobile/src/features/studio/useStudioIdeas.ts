import { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard } from 'react-native';
import { newStudioIdeasRequestId, requestStudioIdeas, studioIdeasContextKey, studioIdeasNeedsFreshContext, studioIdeasRetryNeedsNewId, validateStudioIdeasEditorial, type StudioIdeaDraft, type StudioIdeaKind, type StudioIdeaSuggestion, type StudioIdeasContext, type StudioIdeasRequest, type StudioIdeasScript, type StudioIdeasSuggestions } from './studioIdeas';

// Only the current account is retained. Context reads are free; automatic
// generation is attempted once for each set of published videos this session.
const cache = { owner: '', needsRefresh: false, contexts: new Map<string, StudioIdeasContext>(), readAt: new Map<string, number>(), attempted: new Set<string>(), requests: new Map<string, string>() };
const categoryKey = (category?: string) => category || 'recent';
type Operation = { epoch: number; owner: string; controller: AbortController };
type Retry = { action: 'context' | 'suggest' | 'script' | 'save_editorial'; category?: string; refresh?: boolean };
export function useStudioIdeas(owner: string | undefined, active: boolean, disabled = false) {
  if (cache.owner !== (owner || '')) { cache.owner = owner || ''; cache.needsRefresh = false; cache.contexts.clear(); cache.readAt.clear(); cache.attempted.clear(); cache.requests.clear(); }
  const [context, setContext] = useState<StudioIdeasContext | null>(() => cache.contexts.get('recent') || null);
  const [category, setCategory] = useState<string | undefined>();
  const [visible, setVisible] = useState(false);
  const [categoriesVisible, setCategoriesVisible] = useState(false);
  const [editorialCategory, setEditorialCategory] = useState<string | null>(context?.editorial?.categoryId || null);
  const [teachingFocus, setTeachingFocus] = useState(context?.editorial?.teachingFocus || '');
  const [selected, setSelected] = useState<StudioIdeaSuggestion | null>(null);
  const [kind, setKind] = useState<StudioIdeaKind>('aula');
  const [minutes, setMinutes] = useState(3);
  const [draft, setDraft] = useState<StudioIdeaDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!context);
  const [error, setError] = useState('');
  const mounted = useRef(true), epoch = useRef(0), operation = useRef<Operation | null>(null);
  const foreground = useRef(AppState.currentState === 'active');
  const scope = useRef({ owner, active, disabled });
  if (scope.current.owner !== owner || scope.current.active !== active || scope.current.disabled !== disabled) epoch.current++;
  scope.current = { owner, active, disabled };
  const selection = useRef({ selected, kind, minutes }); selection.current = { selected, kind, minutes };
  const drafts = useRef(new Map<string, StudioIdeaDraft>()), scriptRequests = useRef(new Map<string, string>());
  const lastRetry = useRef<Retry | null>(null);
  const contextRef = useRef(context); contextRef.current = context;
  const categoryRef = useRef(category); categoryRef.current = category;
  const draftRef = useRef(draft); draftRef.current = draft;
  const editorialFields = useRef({ categoryId: editorialCategory, teachingFocus }); editorialFields.current = { categoryId: editorialCategory, teachingFocus };
  const editorialDirty = useRef(false);
  const invalidatedOwner = useRef(owner);
  const resume = useRef<() => void>(() => {});
  const canAct = () => mounted.current && !!scope.current.owner && cache.owner === scope.current.owner && scope.current.owner === invalidatedOwner.current && scope.current.active && !scope.current.disabled && foreground.current;
  const invalidate = () => {
    epoch.current++; operation.current?.controller.abort(); operation.current = null;
    if (mounted.current) { setBusy(false); setLoading(false); }
  };
  const current = (token: Operation) => canAct() && operation.current === token && token.owner === scope.current.owner && token.epoch === epoch.current;
  const begin = (): Operation | null => {
    if (!canAct() || operation.current) return null;
    const token = { owner: scope.current.owner!, epoch: epoch.current, controller: new AbortController() };
    operation.current = token; setBusy(true); setError(''); return token;
  };
  const finish = (token: Operation) => { if (operation.current === token) { operation.current = null; if (mounted.current) { setBusy(false); setLoading(false); } } };
  const failure = (token: Operation, cause: unknown) => {
    if (!current(token)) return;
    if (studioIdeasNeedsFreshContext(cause)) { cache.needsRefresh = true; lastRetry.current = { action: 'context' }; }
    setError(cause instanceof Error ? cause.message : 'A Classy não respondeu. Tente novamente.');
  };
  const suggestionRequest = (data: StudioIdeasContext, categoryId?: string, refresh = false) => {
    const key = `${categoryKey(categoryId)}:${studioIdeasContextKey(data)}:${refresh ? 'refresh' : 'initial'}`;
    if (!cache.requests.has(key)) cache.requests.set(key, newStudioIdeasRequestId());
    return { key, request: { action: 'suggest', ...(categoryId ? { categoryId } : {}), refresh, requestId: cache.requests.get(key)! } as const };
  };
  const suggestions = async (categoryId = categoryRef.current, refresh = false, suppliedContext = contextRef.current) => {
    if (cache.needsRefresh) { void loadContext(); return; }
    if (!suppliedContext?.editorial.ready) { setCategoriesVisible(true); return; }
    const token = begin(); if (!token) return;
    lastRetry.current = { action: 'suggest', category: categoryId, refresh };
    const input = suggestionRequest(suppliedContext, categoryId, refresh);
    cache.attempted.add(studioIdeasContextKey(suppliedContext));
    try {
      const result = await requestStudioIdeas(input.request, token.controller.signal, token.owner, () => current(token)) as StudioIdeasSuggestions;
      if (!current(token)) return;
      const next = { ...suppliedContext, ...result };
      cache.contexts.set(categoryKey(categoryId), next); cache.readAt.set(categoryKey(categoryId), Date.now()); cache.requests.delete(input.key);
      setContext(next); setCategoriesVisible(false); lastRetry.current = null;
    } catch (cause) { if (current(token) && studioIdeasRetryNeedsNewId(cause)) cache.requests.delete(input.key); failure(token, cause); }
    finally { finish(token); }
  };
  const loadContext = async (categoryId?: string, generateAfter = false) => {
    const token = begin(); if (!token) return;
    setLoading(true); lastRetry.current = { action: 'context', category: categoryId };
    let next: StudioIdeasContext | null = null;
    try {
      next = await requestStudioIdeas({ action: 'context', ...(categoryId ? { categoryId } : {}) }, token.controller.signal, token.owner, () => current(token)) as StudioIdeasContext;
      if (!current(token)) { next = null; return; }
      const changed = contextRef.current && studioIdeasContextKey(contextRef.current) !== studioIdeasContextKey(next);
      if (changed) { cache.contexts.clear(); cache.readAt.clear(); cache.attempted.clear(); cache.requests.clear(); drafts.current.clear(); scriptRequests.current.clear(); setSelected(null); setDraft(null); draftRef.current = null; }
      cache.needsRefresh = false; cache.contexts.set(categoryKey(categoryId), next); cache.readAt.set(categoryKey(categoryId), Date.now()); setContext(next); contextRef.current = next;
      if (!editorialDirty.current) { setEditorialCategory(next.editorial.categoryId); setTeachingFocus(next.editorial.teachingFocus); editorialFields.current = { categoryId: next.editorial.categoryId, teachingFocus: next.editorial.teachingFocus }; }
      setCategory(categoryId); categoryRef.current = categoryId; setCategoriesVisible(!next.editorial.ready); lastRetry.current = null;
    } catch (cause) { failure(token, cause); }
    finally { finish(token); }
    if (next && canAct() && !next.suggestions.length && next.editorial.ready
      && (generateAfter || !cache.attempted.has(studioIdeasContextKey(next)))) await suggestions(categoryId, false, next);
  };
  const saveEditorial = async () => {
    if (!canAct() || operation.current || !contextRef.current) return;
    let input: ReturnType<typeof validateStudioIdeasEditorial>;
    try { input = validateStudioIdeasEditorial(editorialFields.current.categoryId, editorialFields.current.teachingFocus, contextRef.current.categories); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Escolha sua área e conte o que você ensina.'); return; }
    const token = begin(); if (!token) return;
    // The write can commit on the server even when its response is interrupted.
    // Never reopen old cached ideas before reconciling that outcome.
    cache.needsRefresh = true;
    lastRetry.current = { action: 'save_editorial' }; Keyboard.dismiss();
    let next: StudioIdeasContext | null = null;
    try {
      next = await requestStudioIdeas({ action: 'save_editorial', ...input }, token.controller.signal, token.owner, () => current(token)) as StudioIdeasContext;
      if (!current(token)) { next = null; return; }
      if (!next.editorial.ready || next.editorial.categoryId !== input.categoryId || next.editorial.teachingFocus !== input.teachingFocus) throw new Error('Não foi possível confirmar seu contexto. Tente salvar novamente.');
      cache.contexts.clear(); cache.readAt.clear(); cache.attempted.clear(); cache.requests.clear(); drafts.current.clear(); scriptRequests.current.clear();
      cache.needsRefresh = false; cache.contexts.set('recent', next); cache.readAt.set('recent', Date.now());
      setCategory(undefined); categoryRef.current = undefined; setContext(next); contextRef.current = next;
      setSelected(null); setDraft(null); draftRef.current = null; setCategoriesVisible(false);
      editorialDirty.current = false; setEditorialCategory(next.editorial.categoryId); setTeachingFocus(next.editorial.teachingFocus); editorialFields.current = { categoryId: next.editorial.categoryId, teachingFocus: next.editorial.teachingFocus }; lastRetry.current = null;
    } catch (cause) { next = null; failure(token, cause); }
    finally { finish(token); }
    if (next && canAct() && !next.suggestions.length) await suggestions(undefined, false, next);
  };
  const generateScript = async () => {
    const picked = selection.current;
    if (cache.needsRefresh) { if (canAct() && !operation.current) void loadContext(); return; }
    if (!picked.selected || draftRef.current || !contextRef.current?.editorial.ready || !canAct()) return;
    const token = begin(); if (!token) return;
    const key = `${picked.selected.id}:${picked.kind}:${picked.minutes}`;
    if (!scriptRequests.current.has(key)) scriptRequests.current.set(key, newStudioIdeasRequestId());
    const request: Extract<StudioIdeasRequest, { action: 'script' }> = { action: 'script', suggestionId: picked.selected.id, kind: picked.kind, durationMinutes: picked.minutes, requestId: scriptRequests.current.get(key)! };
    lastRetry.current = { action: 'script' }; Keyboard.dismiss();
    try {
      const result = await requestStudioIdeas(request, token.controller.signal, token.owner, () => current(token)) as StudioIdeasScript;
      if (!current(token) || selection.current.selected?.id !== picked.selected.id || selection.current.kind !== picked.kind || selection.current.minutes !== picked.minutes) return;
      drafts.current.set(picked.selected.id, result.draft); draftRef.current = result.draft; setDraft(result.draft); lastRetry.current = null;
    } catch (cause) { if (current(token) && studioIdeasRetryNeedsNewId(cause)) scriptRequests.current.delete(key); failure(token, cause); }
    finally { finish(token); }
  };
  resume.current = () => {
    // Launching a deep link can mount the route while iOS is still inactive.
    // Resume the free context read once foregrounded, including externally
    // edited creator profiles; automatic AI keeps its context-key guard.
    if (canAct() && !operation.current) void loadContext(categoryRef.current);
  };
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (state !== 'active') { invalidate(); Keyboard.dismiss(); setVisible(false); }
      else resume.current();
    });
    // A foreground transition may finish between render and passive effects.
    foreground.current = AppState.currentState === 'active';
    if (foreground.current) resume.current();
    return () => { mounted.current = false; epoch.current++; operation.current?.controller.abort(); operation.current = null; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (invalidatedOwner.current !== owner) {
      invalidatedOwner.current = owner; invalidate(); drafts.current.clear(); scriptRequests.current.clear(); lastRetry.current = null;
      setContext(null); contextRef.current = null; setCategory(undefined); categoryRef.current = undefined; setSelected(null); setDraft(null); setVisible(false); setError('');
      editorialDirty.current = false; setEditorialCategory(null); setTeachingFocus(''); editorialFields.current = { categoryId: null, teachingFocus: '' };
    }
    if (!active || disabled || !owner) { invalidate(); Keyboard.dismiss(); setVisible(false); return; }
    if (cache.needsRefresh || !cache.contexts.get(categoryKey(categoryRef.current)) || Date.now() - (cache.readAt.get(categoryKey(categoryRef.current)) || 0) > 120000) void loadContext(categoryRef.current);
    else { const saved = cache.contexts.get(categoryKey(categoryRef.current))!; setContext(saved); setLoading(false); }
  }, [owner, active, disabled]);
  const close = () => { invalidate(); Keyboard.dismiss(); setVisible(false); };
  const choose = (idea: StudioIdeaSuggestion) => {
    if (cache.needsRefresh) { if (canAct() && !operation.current) void loadContext(); return; }
    if (!canAct() || operation.current || !contextRef.current?.editorial.ready || !contextRef.current.suggestions.some(item => item.id === idea.id)) return;
    const saved = drafts.current.get(idea.id);
    setSelected(idea); setKind(saved?.kind || idea.kind); setMinutes(saved?.durationMinutes || idea.durationMinutes); draftRef.current = saved || null; setDraft(saved || null);
    setCategoriesVisible(false); setError(''); setVisible(true);
  };
  const sameOwner = invalidatedOwner.current === owner;
  return { context: sameOwner ? context : null, reconciling: cache.needsRefresh, category: sameOwner ? category : undefined, editorialCategory: sameOwner ? editorialCategory : null, teachingFocus: sameOwner ? teachingFocus : '', visible: sameOwner && active && !disabled && visible, categoriesVisible, selected: sameOwner ? selected : null, kind, minutes, draft: sameOwner ? draft : null, busy, loading, error: sameOwner ? error : '', close, choose, generateScript, saveEditorial,
    canUseDraft: () => canAct() && !cache.needsRefresh && !!contextRef.current?.editorial.ready && !!draftRef.current,
    open: () => { if (!canAct() || operation.current) return; setVisible(true); setError(''); if (!contextRef.current || cache.needsRefresh) void loadContext(categoryRef.current); else if (!contextRef.current.editorial.ready) setCategoriesVisible(true); else if (!contextRef.current.suggestions.length) void suggestions(); },
    retry: () => { const action = lastRetry.current; if (!action) { void loadContext(categoryRef.current); return; } if (action.action === 'save_editorial') void saveEditorial(); else if (action.action === 'script') void generateScript(); else if (action.action === 'suggest') void suggestions(action.category, action.refresh); else void loadContext(action.category); },
    refresh: () => { if (operation.current || !canAct()) return; setSelected(null); setDraft(null); void suggestions(categoryRef.current, true); },
    showCategories: () => { if (operation.current || !canAct()) return; setCategoriesVisible(true); setVisible(true); setError(''); if (!editorialDirty.current && contextRef.current) { setEditorialCategory(contextRef.current.editorial.categoryId); setTeachingFocus(contextRef.current.editorial.teachingFocus); editorialFields.current = { categoryId: contextRef.current.editorial.categoryId, teachingFocus: contextRef.current.editorial.teachingFocus }; } },
    chooseCategory: (categoryId: string) => { if (operation.current || !canAct() || !contextRef.current?.categories.some(item => item.id === categoryId)) return; editorialDirty.current = true; editorialFields.current = { ...editorialFields.current, categoryId }; setEditorialCategory(categoryId); setError(''); },
    editTeachingFocus: (value: string) => { if (operation.current || !canAct()) return; editorialDirty.current = true; editorialFields.current = { ...editorialFields.current, teachingFocus: value }; setTeachingFocus(value); setError(''); },
    useRecent: () => { if (operation.current || !canAct()) return; setSelected(null); setDraft(null); void loadContext(undefined, true); },
    back: () => { if (operation.current || !canAct()) return; setSelected(null); setDraft(null); setCategoriesVisible(false); setError(''); },
    setKind: (value: StudioIdeaKind) => { if (!operation.current && !draft && canAct()) { setKind(value); setMinutes(current => Math.min(current, value === 'short' ? 3 : 10)); setError(''); } },
    setMinutes: (value: number) => { if (!operation.current && !draft && canAct()) { setMinutes(Math.max(1, Math.min(value, kind === 'short' ? 3 : 10))); setError(''); } },
    edit: (field: 'title' | 'script', value: string) => { if (operation.current || !draftRef.current || !canAct()) return; const next = { ...draftRef.current, [field]: value }; drafts.current.set(next.suggestionId, next); draftRef.current = next; setDraft(next); setError(''); },
  };
}

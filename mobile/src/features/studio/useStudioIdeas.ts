import { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard } from 'react-native';
import { newStudioIdeasRequestId, requestStudioIdeas, studioIdeasRetryNeedsNewId, studioIdeasSourceKey, type StudioIdeaDraft, type StudioIdeaKind, type StudioIdeaSuggestion, type StudioIdeasContext, type StudioIdeasRequest, type StudioIdeasScript, type StudioIdeasSuggestions } from './studioIdeas';

// Only the current account is retained. Context reads are free; automatic
// generation is attempted once for each set of published videos this session.
const cache = { owner: '', contexts: new Map<string, StudioIdeasContext>(), readAt: new Map<string, number>(), attempted: new Set<string>(), requests: new Map<string, string>() };
const categoryKey = (category?: string) => category || 'recent';
type Operation = { epoch: number; owner: string; controller: AbortController };
type Retry = { action: 'context' | 'suggest' | 'script'; category?: string; refresh?: boolean };
export function useStudioIdeas(owner: string | undefined, active: boolean, disabled = false) {
  if (cache.owner !== (owner || '')) { cache.owner = owner || ''; cache.contexts.clear(); cache.readAt.clear(); cache.attempted.clear(); cache.requests.clear(); }
  const [context, setContext] = useState<StudioIdeasContext | null>(() => cache.contexts.get('recent') || null);
  const [category, setCategory] = useState<string | undefined>();
  const [visible, setVisible] = useState(false);
  const [categoriesVisible, setCategoriesVisible] = useState(false);
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
  const invalidatedOwner = useRef(owner);
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
  const failure = (token: Operation, cause: unknown) => { if (current(token)) setError(cause instanceof Error ? cause.message : 'A Classy não respondeu. Tente novamente.'); };
  const suggestionRequest = (data: StudioIdeasContext, categoryId?: string, refresh = false) => {
    const key = `${categoryKey(categoryId)}:${studioIdeasSourceKey(data.source)}:${refresh ? 'refresh' : 'initial'}`;
    if (!cache.requests.has(key)) cache.requests.set(key, newStudioIdeasRequestId());
    return { key, request: { action: 'suggest', ...(categoryId ? { categoryId } : {}), refresh, requestId: cache.requests.get(key)! } as const };
  };
  const suggestions = async (categoryId = categoryRef.current, refresh = false, suppliedContext = contextRef.current) => {
    if (!suppliedContext || suppliedContext.source.type === 'empty') { setCategoriesVisible(true); return; }
    const token = begin(); if (!token) return;
    lastRetry.current = { action: 'suggest', category: categoryId, refresh };
    const input = suggestionRequest(suppliedContext, categoryId, refresh);
    cache.attempted.add(studioIdeasSourceKey(suppliedContext.source));
    try {
      const result = await requestStudioIdeas(input.request, token.controller.signal) as StudioIdeasSuggestions;
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
      next = await requestStudioIdeas({ action: 'context', ...(categoryId ? { categoryId } : {}) }, token.controller.signal) as StudioIdeasContext;
      if (!current(token)) { next = null; return; }
      cache.contexts.set(categoryKey(categoryId), next); cache.readAt.set(categoryKey(categoryId), Date.now()); setContext(next); contextRef.current = next;
      setCategory(categoryId); categoryRef.current = categoryId; setCategoriesVisible(next.source.type === 'empty'); lastRetry.current = null;
    } catch (cause) { failure(token, cause); }
    finally { finish(token); }
    if (next && canAct() && !next.suggestions.length && next.source.type !== 'empty'
      && (generateAfter || !cache.attempted.has(studioIdeasSourceKey(next.source)))) await suggestions(categoryId, false, next);
  };
  const generateScript = async () => {
    const picked = selection.current;
    if (!picked.selected || draftRef.current || !canAct()) return;
    const token = begin(); if (!token) return;
    const key = `${picked.selected.id}:${picked.kind}:${picked.minutes}`;
    if (!scriptRequests.current.has(key)) scriptRequests.current.set(key, newStudioIdeasRequestId());
    const request: Extract<StudioIdeasRequest, { action: 'script' }> = { action: 'script', suggestionId: picked.selected.id, kind: picked.kind, durationMinutes: picked.minutes, requestId: scriptRequests.current.get(key)! };
    lastRetry.current = { action: 'script' }; Keyboard.dismiss();
    try {
      const result = await requestStudioIdeas(request, token.controller.signal) as StudioIdeasScript;
      if (!current(token) || selection.current.selected?.id !== picked.selected.id || selection.current.kind !== picked.kind || selection.current.minutes !== picked.minutes) return;
      drafts.current.set(picked.selected.id, result.draft); draftRef.current = result.draft; setDraft(result.draft); lastRetry.current = null;
    } catch (cause) { if (current(token) && studioIdeasRetryNeedsNewId(cause)) scriptRequests.current.delete(key); failure(token, cause); }
    finally { finish(token); }
  };
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (state !== 'active') { invalidate(); Keyboard.dismiss(); setVisible(false); }
    });
    return () => { mounted.current = false; epoch.current++; operation.current?.controller.abort(); operation.current = null; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (invalidatedOwner.current !== owner) {
      invalidatedOwner.current = owner; invalidate(); drafts.current.clear(); scriptRequests.current.clear(); lastRetry.current = null;
      setContext(null); setCategory(undefined); setSelected(null); setDraft(null); setVisible(false); setError('');
    }
    if (!active || disabled || !owner) { invalidate(); Keyboard.dismiss(); setVisible(false); return; }
    if (!cache.contexts.get(categoryKey(categoryRef.current)) || Date.now() - (cache.readAt.get(categoryKey(categoryRef.current)) || 0) > 120000) void loadContext(categoryRef.current);
    else { const saved = cache.contexts.get(categoryKey(categoryRef.current))!; setContext(saved); setLoading(false); }
  }, [owner, active, disabled]);
  const close = () => { invalidate(); Keyboard.dismiss(); setVisible(false); };
  const choose = (idea: StudioIdeaSuggestion) => {
    if (!canAct() || operation.current) return;
    const saved = drafts.current.get(idea.id);
    setSelected(idea); setKind(saved?.kind || idea.kind); setMinutes(saved?.durationMinutes || idea.durationMinutes); draftRef.current = saved || null; setDraft(saved || null);
    setCategoriesVisible(false); setError(''); setVisible(true);
  };
  const sameOwner = invalidatedOwner.current === owner;
  return { context: sameOwner ? context : null, category: sameOwner ? category : undefined, visible: sameOwner && active && !disabled && visible, categoriesVisible, selected: sameOwner ? selected : null, kind, minutes, draft: sameOwner ? draft : null, busy, loading, error: sameOwner ? error : '', close, choose, generateScript,
    open: () => { if (!canAct() || operation.current) return; setVisible(true); setError(''); if (!contextRef.current) void loadContext(categoryRef.current); else if (contextRef.current.source.type === 'empty') setCategoriesVisible(true); else if (!contextRef.current.suggestions.length) void suggestions(); },
    retry: () => { const action = lastRetry.current; if (!action) { void loadContext(categoryRef.current); return; } if (action.action === 'script') void generateScript(); else if (action.action === 'suggest') void suggestions(action.category, action.refresh); else void loadContext(action.category); },
    refresh: () => { if (operation.current || !canAct()) return; setSelected(null); setDraft(null); void suggestions(categoryRef.current, true); },
    showCategories: () => { if (operation.current || !canAct()) return; setCategoriesVisible(true); setSelected(null); setDraft(null); setVisible(true); setError(''); },
    chooseCategory: (categoryId: string) => { if (operation.current || !canAct() || !contextRef.current?.categories.some(item => item.id === categoryId)) return; setSelected(null); setDraft(null); void loadContext(categoryId, true); },
    useRecent: () => { if (operation.current || !canAct()) return; setSelected(null); setDraft(null); void loadContext(undefined, true); },
    back: () => { if (operation.current || !canAct()) return; setSelected(null); setDraft(null); setCategoriesVisible(false); setError(''); },
    setKind: (value: StudioIdeaKind) => { if (!operation.current && !draft && canAct()) { setKind(value); setMinutes(current => Math.min(current, value === 'short' ? 3 : 10)); setError(''); } },
    setMinutes: (value: number) => { if (!operation.current && !draft && canAct()) { setMinutes(Math.max(1, Math.min(value, kind === 'short' ? 3 : 10))); setError(''); } },
    edit: (field: 'title' | 'script', value: string) => { if (operation.current || !draftRef.current || !canAct()) return; const next = { ...draftRef.current, [field]: value }; drafts.current.set(next.suggestionId, next); draftRef.current = next; setDraft(next); setError(''); },
  };
}

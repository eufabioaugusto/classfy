import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as contract from './studioIdeasContract.ts';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ideas = [1, 2, 3].map(n => ({ id: uuid(n), title: `Pauta ${n}`, summary: `Como explicar o assunto ${n}`, objective: 'Ensinar na prática', audience: 'Iniciantes', tags: ['teste'], kind: 'aula', durationMinutes: 4 }));
const recentSource = { type: 'recent', label: 'Seus últimos conteúdos', contentIds: [uuid(10)], categoryId: null };
const categories = [{ id: uuid(20), name: 'Tecnologia', slug: 'tecnologia' }, { id: uuid(21), name: 'Criação', slug: 'criacao' }];
const readyEditorial = { categoryId: uuid(20), categoryName: 'Tecnologia', teachingFocus: 'Ensino tecnologia para creators iniciantes.', ready: true };
const contextFixture = (suggestions = ideas, source = recentSource, editorial = source.type === 'empty' ? { categoryId: null, categoryName: null, teachingFocus: '', ready: false } : readyEditorial, contextKey = 'context-original') => ({ categories, source, editorial, contextKey, recentContents: source.type === 'recent' || source.type === 'profile' ? [{ id: uuid(10), title: 'A LUZ - Aula 1', description: '', tags: [], categoryId: null, categoryName: null }] : [], suggestions, cached: !!suggestions.length });
const scriptFixture = request => ({ draft: { kind: request.kind, title: 'Minha pauta', description: 'Descrição', objective: 'Ensinar', audience: 'Iniciantes', script: 'Um roteiro completo para gravar.', tags: ['aula'] }, suggestionId: request.suggestionId, durationMinutes: request.durationMinutes, cached: false });
const transpile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness({ empty = false, noCache = false, missingEditorial = false, component = false, initialAppState = 'active', useScript = async () => true } = {}) {
  const slots = [], listeners = new Map(), keyboardListeners = new Map(), frames = new Map(), scrollRequests = [], calls = [], aborts = [], busyChanges = [];
  let frameId = 0;
  let owner = uuid(90), active = true, disabled = false, cursor = 0, dirty = true, effects = [], current, tree, sequence = 100, failures = 0, failureCode, contextFailure = false, suggestFailure = false, suggestFailureCode, saveFailure = false, deferredSave, deferredScript, dismissed = 0, keyboardDismissed = 0;
  let serverEditorial = empty || missingEditorial ? { categoryId: null, categoryName: null, teachingFocus: '', ready: false } : { ...readyEditorial }, serverContextKey = 'context-original', profileSaved = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useRef: value => { const i = cursor++; return slots[i] ||= { current: value }; },
    useState: initial => { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }]; },
    useEffect: (callback, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) effects.push({ i, callback, deps }); },
  };
  const appState = { currentState: initialAppState, addEventListener: (event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); return { remove: () => listeners.get(event).delete(callback) }; } };
  const keyboard = { dismiss: () => { keyboardDismissed++; }, addListener: (event, listener) => { if (!keyboardListeners.has(event)) keyboardListeners.set(event, new Set()); keyboardListeners.get(event).add(listener); return { remove: () => keyboardListeners.get(event).delete(listener) }; } };
  const requestStudioIdeas = async (request, signal) => {
    calls.push(request); signal?.addEventListener('abort', () => aborts.push(request));
    if (request.action === 'context') {
      if (contextFailure) { contextFailure = false; throw new Error('Contexto indisponível'); }
      const source = profileSaved ? { type: 'profile', label: `Seu contexto: ${serverEditorial.categoryName}`, contentIds: [uuid(10)], categoryId: serverEditorial.categoryId } : request.categoryId ? { type: 'category', label: 'Categoria: Tecnologia', contentIds: [], categoryId: request.categoryId } : empty ? { type: 'empty', label: 'Escolha uma categoria', contentIds: [], categoryId: null } : recentSource;
      const payload = contextFixture(noCache || source.type === 'empty' || profileSaved ? [] : ideas, source, serverEditorial, serverContextKey);
      if (missingEditorial && !profileSaved) delete payload.editorial;
      return contract.parseStudioIdeasContext(payload);
    }
    if (request.action === 'save_editorial') {
      if (saveFailure) { saveFailure = false; throw Object.assign(new Error('Não foi possível salvar o contexto'), { code: 'transport' }); }
      serverEditorial = { categoryId: request.categoryId, categoryName: categories.find(item => item.id === request.categoryId)?.name || null, teachingFocus: request.teachingFocus, ready: true };
      serverContextKey = `context-new:${request.categoryId}:${request.teachingFocus}`; profileSaved = true;
      if (deferredSave) await deferredSave;
      return contract.parseStudioIdeasContext(contextFixture([], { type: 'profile', label: `Seu contexto: ${serverEditorial.categoryName}`, contentIds: [uuid(10)], categoryId: serverEditorial.categoryId }, serverEditorial, serverContextKey));
    }
    if (request.action === 'suggest') {
      if (suggestFailure) { suggestFailure = false; throw Object.assign(new Error('Sugestões indisponíveis'), { code: suggestFailureCode }); }
      return { suggestions: ideas, source: profileSaved ? { type: 'profile', label: `Seu contexto: ${serverEditorial.categoryName}`, contentIds: [uuid(10)], categoryId: serverEditorial.categoryId } : request.categoryId ? { type: 'category', label: 'Categoria: Tecnologia', contentIds: [], categoryId: request.categoryId } : recentSource, contextKey: serverContextKey, cached: false };
    }
    if (deferredScript) await deferredScript;
    if (failures > 0) { failures--; throw Object.assign(new Error('Roteiro indisponível'), { code: failureCode }); }
    return contract.parseStudioIdeasScript(scriptFixture(request), request);
  };
  const api = { ...contract, requestStudioIdeas, newStudioIdeasRequestId: () => uuid(sequence++) };
  const hookModule = { exports: {} };
  new Function('require', 'module', 'exports', transpile('./useStudioIdeas.ts'))(name => ({ react: hooks, 'react-native': { AppState: appState, Keyboard: keyboard }, './studioIdeas': api }[name]), hookModule, hookModule.exports);
  const jsx = (type, props) => { if (type === 'ScrollView' && props.ref) props.ref.current = { scrollTo: input => scrollRequests.push(input) }; return { type, props }; };
  const rn = { AppState: appState, Keyboard: keyboard, Platform: { OS: 'ios' }, StyleSheet: { create: value => value, absoluteFill: {} }, useWindowDimensions: () => ({ width: 390, height: 844 }), ...Object.fromEntries('ActivityIndicator KeyboardAvoidingView Pressable ScrollView Text TextInput TouchableWithoutFeedback View'.split(' ').map(name => [name, name])) };
  const deps = { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': rn, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 50, bottom: 34, left: 0, right: 0 }) }, 'lucide-react-native': Object.fromEntries('ArrowLeft ArrowRight Check ChevronRight FileText Film Lightbulb Mic Minus Plus RefreshCw Sparkles Video'.split(' ').map(name => [name, name])), '@/components/ClassyAvatar': { ClassyAvatar: 'Avatar' }, '@/components/SheetModal': { SheetCloseButton: 'SheetCloseButton', SheetModal: 'SheetModal', sheetStyles: {} }, '@/features/auth/authContext': { useAuth: () => ({ user: owner ? { id: owner } : null }) }, '@/theme/colors': { colors: {} }, './useStudioIdeas': { useStudioIdeas: (...args) => { current = hookModule.exports.useStudioIdeas(...args); return current; } }, './studioIdeas': api };
  const componentModule = { exports: {} };
  if (component) new Function('require', 'module', 'exports', 'requestAnimationFrame', 'cancelAnimationFrame', transpile('./StudioIdeasCard.tsx'))(name => { assert.ok(name in deps, name); return deps[name]; }, componentModule, componentModule.exports, callback => { const id = ++frameId; frames.set(id, callback); return id; }, id => frames.delete(id));
  const render = () => {
    cursor = 0; dirty = false; effects = [];
    if (component) tree = componentModule.exports.StudioIdeasCard({ active, disabled, onUseScript: useScript, onSheetDismiss: () => dismissed++, onBusyChange: value => busyChanges.push(value) });
    else current = hookModule.exports.useStudioIdeas(owner, active, disabled);
    for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }; }
  };
  const pump = async () => { for (let i = 0; i < 30; i++) { if (dirty) render(); for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } await new Promise(resolve => setImmediate(resolve)); if (!dirty) return; } throw new Error('Ideas did not settle'); };
  const visit = (node, predicate, includeHidden = false) => { if (Array.isArray(node)) { for (const child of node) { const found = visit(child, predicate, includeHidden); if (found) return found; } } else if (node && typeof node === 'object') { if (!includeHidden && node.type === 'SheetModal' && !node.props?.visible) return; if (predicate(node)) return node; return visit(node.props?.children, predicate, includeHidden); } };
  return { pump, calls, aborts, busyChanges, scrollRequests, state: () => current, control: label => visit(tree, node => node.props?.accessibilityLabel === label)?.props, modal: () => visit(tree, node => node.type === 'SheetModal', true)?.props,
    visibleText: () => { const values = []; visit(tree, node => { if (node.type === 'Text' && typeof node.props?.children === 'string') values.push(node.props.children); return false; }); return values.join('\n'); },
    update: values => { if ('owner' in values) owner = values.owner; if ('active' in values) active = values.active; if ('disabled' in values) disabled = values.disabled; dirty = true; },
    appState: state => { appState.currentState = state; for (const listener of listeners.get('change') || []) listener(state); },
    keyboard: (event, endCoordinates) => { for (const listener of keyboardListeners.get(event) || []) listener({ endCoordinates }); },
    sheetHeight: () => visit(tree, node => node.type === 'View' && Array.isArray(node.props?.style) && node.props.style.some(style => style?.maxHeight))?.props.style.find(style => style?.maxHeight)?.maxHeight,
    hasContentTouchWrapper: () => !!visit(tree, node => node.type === 'TouchableWithoutFeedback'),
    layoutField: (label, y) => visit(tree, node => node.type === 'View' && node.props?.onLayout && visit(node.props.children, item => item.props?.accessibilityLabel === label))?.props.onLayout({ nativeEvent: { layout: { y } } }),
    failScript: (count, code) => { failures = count; failureCode = code; }, failSuggestions: code => { suggestFailure = true; suggestFailureCode = code; }, failContext: () => { contextFailure = true; },
    failSave: () => { saveFailure = true; },
    deferSave: () => { let release; deferredSave = new Promise(resolve => { release = resolve; }); return release; },
    deferScript: () => { let release; deferredScript = new Promise(resolve => { release = resolve; }); return release; },
    dismissed: () => dismissed, keyboardDismissed: () => keyboardDismissed,
    dispose: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}
async function openIdeas(h) {
  const launcher = h.control('Abrir Classy para criar');
  assert.ok(launcher); assert.equal(launcher.disabled, false);
  launcher.onPress(); await h.pump(); assert.equal(h.modal().visible, true);
}
test('contrato rejeita resposta de outra pauta, formato, duração e roteiro vazio', () => {
  const request = { action: 'script', suggestionId: uuid(1), kind: 'short', durationMinutes: 2, requestId: uuid(99) };
  assert.equal(contract.parseStudioIdeasScript(scriptFixture(request), request).draft.kind, 'short');
  assert.throws(() => contract.parseStudioIdeasScript({ ...scriptFixture(request), suggestionId: uuid(2) }, request));
  assert.throws(() => contract.parseStudioIdeasScript({ ...scriptFixture(request), durationMinutes: 3 }, request));
  assert.throws(() => contract.validateStudioIdeaDraft({ ...scriptFixture(request).draft, suggestionId: uuid(1), durationMinutes: 4 }));
  assert.throws(() => contract.validateStudioIdeaDraft({ ...scriptFixture(request).draft, script: ' ', suggestionId: uuid(1), durationMinutes: 2 }));
  assert.throws(() => contract.parseStudioIdeasSuggestions({ suggestions: ideas.slice(0, 2), source: recentSource }));
});
test('entrada compacta mantém pautas e contexto no sheet e não bloqueia a biblioteca fechada', async () => {
  const h = harness({ component: true }); try {
    await h.pump(); assert.deepEqual(h.calls.map(call => call.action), ['context']); assert.equal(h.state().context.suggestions.length, 3); assert.deepEqual(h.busyChanges, [false]);
    assert.equal(h.modal().visible, false); assert.equal(h.control('Criar roteiro: Pauta 1'), undefined); assert.equal(h.control('Seu contexto de criação'), undefined); assert.equal(h.control('Conteúdo das sugestões da Classy'), undefined);
    assert.match(h.visibleText(), /Classy para criar/); assert.doesNotMatch(h.visibleText(), /Pauta 1|Seus últimos conteúdos|Sua próxima ideia começa aqui|Área principal/);
    await openIdeas(h); assert.ok(h.control('Criar roteiro: Pauta 1')); assert.ok(h.control('Seu contexto de criação')); assert.equal(h.busyChanges.at(-1), true); assert.deepEqual(h.calls.map(call => call.action), ['context']);
    h.control('Seu contexto de criação').onPress(); await h.pump(); assert.ok(h.control('Sobre o que você ensina?')); h.control('Voltar às sugestões').onPress(); await h.pump(); assert.ok(h.control('Criar roteiro: Pauta 1'));
    h.modal().onRequestClose(); await h.pump(); assert.equal(h.modal().visible, false); assert.equal(h.control('Criar roteiro: Pauta 1'), undefined); assert.equal(h.control('Seu contexto de criação'), undefined); assert.equal(h.busyChanges.at(-1), false);
  } finally { h.dispose(); }
});
test('histórico inicia sugestões uma vez e reabrir/foco usa cache sem custo novo', async () => {
  const h = harness({ noCache: true, component: true }); try { await h.pump(); assert.deepEqual(h.calls.map(call => call.action), ['context', 'suggest']); await openIdeas(h); h.modal().onRequestClose(); await h.pump(); assert.equal(h.control('Criar roteiro: Pauta 1'), undefined); h.update({ active: false }); await h.pump(); h.update({ active: true }); await h.pump(); await openIdeas(h); assert.ok(h.control('Criar roteiro: Pauta 1')); assert.equal(h.calls.filter(call => call.action === 'suggest').length, 1); } finally { h.dispose(); }
});
test('falha automática não gera em cada foco e retry conserva idempotência', async () => {
  const h = harness({ noCache: true }); try { h.failSuggestions(); await h.pump(); const request = h.calls.find(call => call.action === 'suggest'); assert.equal(h.state().error, 'Sugestões indisponíveis'); h.update({ active: false }); await h.pump(); h.update({ active: true }); await h.pump(); assert.equal(h.calls.filter(call => call.action === 'suggest').length, 1); h.state().retry(); await h.pump(); assert.equal(h.calls.filter(call => call.action === 'suggest')[1].requestId, request.requestId); } finally { h.dispose(); }
});
test('creator sem contexto escolhe área e foco; perfil salvo precede qualquer geração', async () => {
  const h = harness({ empty: true, noCache: true, component: true }); try { await h.pump(); assert.deepEqual(h.calls.map(call => call.action), ['context']); assert.equal(h.control('Sobre o que você ensina?'), undefined); await openIdeas(h); assert.equal(h.state().categoriesVisible, true); h.state().chooseCategory(uuid(200)); await h.pump(); assert.equal(h.calls.length, 1); h.control('Área principal: Tecnologia').onPress(); h.control('Sobre o que você ensina?').onChangeText('Ensino tecnologia aplicada ao dia a dia.'); await h.pump(); assert.equal(h.calls.length, 1); const save = h.control('Salvar contexto e gerar sugestões').onPress; save(); save(); await h.pump(); assert.deepEqual(h.calls.map(call => call.action), ['context', 'save_editorial', 'suggest']); assert.equal(h.calls[1].categoryId, uuid(20)); assert.equal(h.calls[1].teachingFocus, 'Ensino tecnologia aplicada ao dia a dia.'); assert.equal(h.state().context.editorial.ready, true); assert.ok(h.control('Criar roteiro: Pauta 1')); } finally { h.dispose(); }
});
test('geração limita Short, bloqueia clique duplo e retry recupera mesmo pedido', async () => {
  const h = harness(); try { await h.pump(); h.state().choose(ideas[0]); await h.pump(); h.state().setKind('short'); await h.pump(); h.state().setMinutes(10); await h.pump(); assert.equal(h.state().minutes, 3); h.failScript(1); const generate = h.state().generateScript; generate(); generate(); await h.pump(); assert.equal(h.calls.filter(call => call.action === 'script').length, 1); assert.equal(h.state().error, 'Roteiro indisponível'); h.state().retry(); await h.pump(); const requests = h.calls.filter(call => call.action === 'script'); assert.equal(requests[0].requestId, requests[1].requestId); assert.equal(h.state().draft.durationMinutes, 3); } finally { h.dispose(); }
});
for (const code of ['request_failed', 'generation_failed', 'ai_invalid_response', 'generation_cancelled', 'ai_unavailable']) test(`retry explícito de roteiro renova UUID após falha terminal ${code}`, async () => {
  const h = harness(); try { await h.pump(); h.state().choose(ideas[0]); await h.pump(); h.failScript(1, code); await h.state().generateScript(); await h.pump(); h.state().retry(); await h.pump(); const requests = h.calls.filter(call => call.action === 'script'); assert.equal(requests.length, 2); assert.notEqual(requests[0].requestId, requests[1].requestId); assert.equal(h.state().draft.title, 'Minha pauta'); } finally { h.dispose(); }
});
test('falha terminal de sugestões renova UUID, mantendo contexto da categoria', async () => {
  const h = harness({ empty: true, noCache: true }); try { await h.pump(); h.failSuggestions('generation_failed'); h.state().chooseCategory(uuid(20)); h.state().editTeachingFocus('Ensino tecnologia aplicada ao dia a dia.'); await h.pump(); await h.state().saveEditorial(); await h.pump(); h.state().retry(); await h.pump(); const requests = h.calls.filter(call => call.action === 'suggest'); assert.notEqual(requests[0].requestId, requests[1].requestId); assert.equal(h.state().context.editorial.categoryId, uuid(20)); } finally { h.dispose(); }
});
test('edições permanecem após fechar e visitar outra pauta sem regenerar', async () => {
  const h = harness({ component: true }); try { await h.pump(); await openIdeas(h); h.control('Criar roteiro: Pauta 1').onPress(); await h.pump(); const oldGenerate = h.state().generateScript; h.control('Gerar roteiro com a Classy').onPress(); await h.pump(); h.control('Título do roteiro da Classy').onChangeText('Meu título'); h.control('Roteiro da Classy').onChangeText('Meu texto revisado.'); await h.pump(); await oldGenerate(); assert.equal(h.state().draft.title, 'Meu título'); h.modal().onRequestClose(); await h.pump(); assert.equal(h.control('Roteiro da Classy'), undefined); await openIdeas(h); assert.equal(h.control('Título do roteiro da Classy').value, 'Meu título'); assert.equal(h.control('Roteiro da Classy').value, 'Meu texto revisado.'); h.control('Escolher outra pauta').onPress(); await h.pump(); h.control('Criar roteiro: Pauta 2').onPress(); await h.pump(); assert.equal(h.state().draft, null); h.control('Escolher outra pauta').onPress(); await h.pump(); h.control('Criar roteiro: Pauta 1').onPress(); await h.pump(); assert.equal(h.control('Roteiro da Classy').value, 'Meu texto revisado.'); await h.state().generateScript(); assert.equal(h.calls.filter(call => call.action === 'script').length, 1); } finally { h.dispose(); }
});
for (const interruption of ['close', 'focus', 'background', 'owner']) test(`retorno tardio após ${interruption} não troca pauta nem preenche texto`, async () => {
  const h = harness(); try { await h.pump(); h.state().choose(ideas[0]); await h.pump(); const release = h.deferScript(); void h.state().generateScript(); await h.pump(); if (interruption === 'close') h.state().close(); else if (interruption === 'focus') h.update({ active: false }); else if (interruption === 'owner') h.update({ owner: uuid(91) }); else h.appState('background'); await h.pump(); release(); await h.pump(); assert.equal(h.state().draft, null); assert.ok(h.aborts.some(call => call.action === 'script')); if (interruption === 'owner') assert.equal(h.state().selected, null); } finally { h.dispose(); }
});
test('handoff com falha mantém texto editado e sheet; sucesso aguarda dismiss nativo', async () => {
  let failures = 1, accepted = [];
  const h = harness({ component: true, useScript: async draft => { accepted.push(draft); if (failures--) throw new Error('Não foi possível salvar'); return true; } });
  try { await h.pump(); await openIdeas(h); h.control('Criar roteiro: Pauta 1').onPress(); await h.pump(); h.control('Gerar roteiro com a Classy').onPress(); await h.pump(); h.control('Roteiro da Classy').onChangeText('Roteiro editado e pronto.'); await h.pump(); h.control('Gravar com este roteiro').onPress(); await h.pump(); assert.equal(h.modal().visible, true); assert.equal(h.control('Roteiro da Classy').value, 'Roteiro editado e pronto.'); assert.equal(h.dismissed(), 0); h.control('Gravar com este roteiro').onPress(); await h.pump(); assert.equal(h.modal().visible, false); assert.equal(h.control('Gravar com este roteiro'), undefined); assert.equal(h.dismissed(), 0); h.modal().onDismiss(); h.modal().onDismiss(); assert.equal(h.dismissed(), 1); assert.equal(accepted.length, 2); assert.equal(accepted[1].script, 'Roteiro editado e pronto.'); } finally { h.dispose(); }
});
test('mensagens públicas traduzem limites e falhas sem copiar texto sensível do serviço', () => {
  assert.match(contract.studioIdeasFriendlyError('generation_limit', 3600), /limite/);
  assert.match(contract.studioIdeasFriendlyError('context_required'), /área/);
  assert.match(contract.studioIdeasFriendlyError('unexpected secret'), /Seu texto permanece/);
});
test('cliente lê código HTTP estruturado, conserva erro de transporte e não mostra diagnóstico bruto', async () => {
  let mode = 'terminal', options;
  const module = { exports: {} };
  const dependencies = { 'expo-crypto': { randomUUID: () => uuid(999) }, '@/lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: uuid(90) }, access_token: 'fixture-token' } }, error: null }) }, functions: { invoke: async (_name, input) => {
    options = input;
    if (mode === 'transport') throw new Error('Internal transport diagnostic');
    if (mode === 'invalid') return { data: { source: { type: 'wrong' } }, error: null };
    return { data: null, error: { context: new Response(JSON.stringify({ error: 'Internal provider diagnostic', code: 'request_failed' }), { status: 409 }) } };
  } } } }, './studioIdeasContract': contract };
  new Function('require', 'module', 'exports', transpile('./studioIdeas.ts'))(name => dependencies[name], module, module.exports);
  await assert.rejects(module.exports.requestStudioIdeas({ action: 'context' }, undefined, uuid(90)), error => error.code === 'request_failed' && contract.studioIdeasRetryNeedsNewId(error) && !error.message.includes('Internal'));
  assert.equal(options.timeout, 90000);
  mode = 'transport';
  await assert.rejects(module.exports.requestStudioIdeas({ action: 'context' }, undefined, uuid(90)), error => error.code === 'transport' && !contract.studioIdeasRetryNeedsNewId(error) && !error.message.includes('Internal'));
  mode = 'invalid';
  await assert.rejects(module.exports.requestStudioIdeas({ action: 'context' }, undefined, uuid(90)), error => error.code === 'invalid_response' && !error.message.includes('inválida'));
});
test('sheet desconta teclado da altura para manter cabeçalho abaixo da safe area', async () => {
  const h = harness({ component: true });
  try {
    await h.pump(); await openIdeas(h); h.control('Criar roteiro: Pauta 1').onPress(); await h.pump();
    assert.equal(h.sheetHeight(), 844 - 50 - 16);
    h.keyboard('keyboardWillShow', { height: 336, screenY: 508 }); await h.pump();
    assert.equal(h.sheetHeight(), 844 - 50 - 336 - 16); assert.ok(h.control('Concluir digitação do roteiro'));
    h.keyboard('keyboardWillChangeFrame', { height: 356, screenY: 488 }); await h.pump();
    assert.equal(h.sheetHeight(), 844 - 50 - 356 - 16);
    h.keyboard('keyboardWillHide', { height: 0, screenY: 844 }); await h.pump();
    assert.equal(h.sheetHeight(), 844 - 50 - 16); assert.equal(h.control('Concluir digitação do roteiro'), undefined);
  } finally { h.dispose(); }
});
test('rolagem do roteiro não tem responder touch no container e recolhe teclado ao arrastar', async () => {
  const h = harness({ component: true });
  try {
    await h.pump(); await openIdeas(h); h.control('Criar roteiro: Pauta 1').onPress(); await h.pump();
    assert.equal(h.hasContentTouchWrapper(), false);
    const scroll = h.control('Conteúdo das sugestões da Classy');
    assert.equal(scroll.style.flexShrink, 1); assert.equal(scroll.keyboardShouldPersistTaps, 'handled');
    const dismissCount = h.keyboardDismissed(); scroll.onScrollBeginDrag(); assert.equal(h.keyboardDismissed(), dismissCount + 1);
  } finally { h.dispose(); }
});
test('legado com A LUZ e sem perfil editorial não exibe nem gera pautas automaticamente', async () => {
  const h = harness({ missingEditorial: true, component: true });
  try { await h.pump(); assert.deepEqual(h.calls.map(call => call.action), ['context']); assert.equal(h.state().context.editorial.ready, false); assert.deepEqual(h.state().context.suggestions, []); assert.equal(h.control('Sobre o que você ensina?'), undefined); await openIdeas(h); assert.ok(h.control('Sobre o que você ensina?')); assert.equal(h.control('Criar roteiro: Pauta 1'), undefined); h.state().choose(ideas[0]); await h.pump(); assert.equal(h.state().selected, null); assert.equal(h.calls.some(call => call.action === 'suggest'), false); } finally { h.dispose(); }
});
test('parse legado não considera publicações, bio ou categoria transitória como perfil confirmado', () => {
  const legacy = contextFixture(); delete legacy.editorial;
  const parsed = contract.parseStudioIdeasContext(legacy);
  assert.equal(parsed.editorial.ready, false); assert.equal(parsed.editorial.categoryId, null); assert.deepEqual(parsed.suggestions, []);
  assert.equal(contract.parseStudioIdeasContext({ ...legacy, editorial: { ...readyEditorial, teachingFocus: 'curto' } }).editorial.ready, false);
  assert.throws(() => contract.validateStudioIdeasEditorial(uuid(200), 'Ensino tecnologia para creators.', categories));
  assert.throws(() => contract.validateStudioIdeasEditorial(uuid(20), 'curto', categories));
  assert.throws(() => contract.validateStudioIdeasEditorial(uuid(20), 'a'.repeat(281), categories));
});
test('save com erro conserva área e foco digitados para retry e reabertura', async () => {
  const h = harness({ empty: true, component: true });
  try {
    await h.pump(); await openIdeas(h);
    h.control('Área principal: Criação').onPress(); h.control('Sobre o que você ensina?').onChangeText('Ensino criação de conteúdo para pessoas que estão começando.'); await h.pump();
    h.failSave(); h.control('Salvar contexto e gerar sugestões').onPress(); await h.pump();
    assert.equal(h.state().editorialCategory, uuid(21)); assert.match(h.control('Sobre o que você ensina?').value, /criação de conteúdo/); assert.equal(h.state().reconciling, true); assert.equal(h.calls.some(call => call.action === 'suggest'), false);
    h.modal().onRequestClose(); await h.pump(); assert.equal(h.control('Sobre o que você ensina?'), undefined); await openIdeas(h);
    assert.match(h.control('Sobre o que você ensina?').value, /criação de conteúdo/); assert.equal(h.state().editorialCategory, uuid(21));
    h.control('Salvar contexto e gerar sugestões').onPress(); await h.pump();
    assert.equal(h.calls.filter(call => call.action === 'save_editorial').length, 2); assert.equal(h.calls.filter(call => call.action === 'suggest').length, 1);
  } finally { h.dispose(); }
});
test('save válido invalida roteiro e pautas antigas só depois de resposta confirmada', async () => {
  const h = harness();
  try {
    await h.pump(); h.state().choose(ideas[0]); await h.pump(); await h.state().generateScript(); await h.pump(); h.state().edit('script', 'Meu texto antes de mudar o contexto'); await h.pump();
    h.state().showCategories(); h.state().chooseCategory(uuid(21)); h.state().editTeachingFocus('Ensino criação de projetos criativos com exercícios práticos.'); await h.pump();
    assert.equal(h.state().draft.script, 'Meu texto antes de mudar o contexto');
    const release = h.deferSave(); void h.state().saveEditorial(); await h.pump(); assert.equal(h.state().canUseDraft(), false); assert.equal(h.state().draft.script, 'Meu texto antes de mudar o contexto');
    release(); await h.pump(); assert.equal(h.state().selected, null); assert.equal(h.state().draft, null); assert.equal(h.state().context.editorial.categoryId, uuid(21)); assert.equal(h.state().context.source.type, 'profile'); assert.match(h.state().context.contextKey, /context-new/);
    h.state().choose(ideas[0]); await h.pump(); assert.equal(h.state().draft, null);
  } finally { h.dispose(); }
});
for (const interruption of ['close', 'focus', 'role', 'background', 'owner']) test(`save interrompido por ${interruption} não aplica resposta tardia e reconcilia servidor antes de reutilizar cache`, async () => {
  const h = harness();
  try {
    await h.pump(); h.state().showCategories(); h.state().chooseCategory(uuid(21)); h.state().editTeachingFocus('Ensino criação de projetos criativos com exercícios práticos.'); await h.pump();
    const release = h.deferSave(); void h.state().saveEditorial(); await h.pump();
    if (interruption === 'close') h.state().close(); else if (interruption === 'focus') h.update({ active: false }); else if (interruption === 'role') h.update({ disabled: true }); else if (interruption === 'owner') h.update({ owner: uuid(91), active: false }); else h.appState('background');
    await h.pump(); release(); await h.pump(); assert.equal(h.calls.filter(call => call.action === 'suggest').length, 0); assert.equal(h.state().selected, null);
    if (interruption === 'owner') return;
    assert.equal(h.state().reconciling, true); assert.equal(h.state().canUseDraft(), false);
    if (interruption === 'focus') h.update({ active: true }); else if (interruption === 'role') h.update({ disabled: false }); else if (interruption === 'background') h.appState('active');
    await h.pump(); h.state().open(); await h.pump();
    assert.ok(h.calls.filter(call => call.action === 'context').length >= 2); assert.equal(h.state().context.editorial.categoryId, uuid(21)); assert.equal(h.state().reconciling, false); assert.equal(h.state().context.source.type, 'profile');
  } finally { h.dispose(); }
});
for (const code of ['editorial_required', 'editorial_context_changed', 'suggestion_not_found']) test(`erro ${code} exige contexto novo em vez de repetir roteiro antigo`, async () => {
  const h = harness();
  try { await h.pump(); h.state().choose(ideas[0]); await h.pump(); h.failScript(1, code); await h.state().generateScript(); await h.pump(); assert.equal(h.state().reconciling, true); h.state().retry(); await h.pump(); assert.deepEqual(h.calls.map(call => call.action), ['context', 'script', 'context']); } finally { h.dispose(); }
});
test('serviço não envia write se sessão muda enquanto resolve token; congela Authorization da conta correta', async () => {
  const module = { exports: {} }, calls = [];
  let current = true, owner = uuid(90), release;
  const wait = new Promise(resolve => { release = resolve; });
  const client = { auth: { getSession: async () => { await wait; return { data: { session: { user: { id: owner }, access_token: 'fixture-token-a' } }, error: null }; } }, functions: { invoke: async (_name, options) => { calls.push(options); return { data: contextFixture(), error: null }; } } };
  const dependencies = { 'expo-crypto': { randomUUID: () => uuid(999) }, '@/lib/supabase': { supabase: client }, './studioIdeasContract': contract };
  new Function('require', 'module', 'exports', transpile('./studioIdeas.ts'))(name => dependencies[name], module, module.exports);
  const first = module.exports.requestStudioIdeas({ action: 'save_editorial', categoryId: uuid(20), teachingFocus: 'Ensino tecnologia para creators.' }, undefined, uuid(90), () => current);
  owner = uuid(91); current = false; release();
  await assert.rejects(first, error => error.code === 'interrupted'); assert.equal(calls.length, 0);
  current = true; owner = uuid(90); await module.exports.requestStudioIdeas({ action: 'context' }, undefined, uuid(90), () => current);
  assert.equal(calls[0].headers.Authorization, 'Bearer fixture-token-a'); assert.equal('ownerId' in calls[0].body, false);
  owner = uuid(91); await assert.rejects(module.exports.requestStudioIdeas({ action: 'save_editorial', categoryId: uuid(20), teachingFocus: 'Ensino tecnologia para creators.' }, undefined, uuid(90)), error => error.code === 'unauthorized'); assert.equal(calls.length, 1);
});
test('montagem iOS inativa retoma contexto ao ficar active, sem spinner eterno ou geração sem perfil', async () => {
  const h = harness({ initialAppState: 'inactive', missingEditorial: true, component: true });
  try {
    await h.pump(); assert.equal(h.calls.length, 0); assert.equal(h.state().loading, true);
    h.appState('active'); await h.pump();
    assert.deepEqual(h.calls.map(call => call.action), ['context']); assert.equal(h.state().loading, false); assert.ok(h.control('Abrir Classy para criar')); assert.equal(h.control('Sobre o que você ensina?'), undefined); await openIdeas(h); assert.ok(h.control('Sobre o que você ensina?'));
  } finally { h.dispose(); }
});
test('retorno do background sempre relê perfil externo e preserva foco ainda não salvo', async () => {
  const h = harness();
  try {
    await h.pump(); h.state().showCategories(); h.state().editTeachingFocus('Texto que ainda quero revisar antes de salvar.'); await h.pump();
    h.appState('background'); await h.pump(); h.appState('active'); await h.pump();
    assert.equal(h.calls.filter(call => call.action === 'context').length, 2); assert.equal(h.state().loading, false); assert.equal(h.state().teachingFocus, 'Texto que ainda quero revisar antes de salvar.'); assert.equal(h.calls.some(call => call.action === 'suggest'), false);
  } finally { h.dispose(); }
});
test('foco e abertura/resize do teclado revelam o campo editorial pelo offset real após layout', async () => {
  const h = harness({ component: true, missingEditorial: true });
  try {
    await h.pump(); await openIdeas(h);
    h.layoutField('Sobre o que você ensina?', 450); h.control('Sobre o que você ensina?').onFocus(); await h.pump();
    assert.equal(h.scrollRequests.at(-1).y, 438);
    h.keyboard('keyboardWillShow', { height: 336, screenY: 508 }); await h.pump(); assert.equal(h.scrollRequests.at(-1).y, 438);
    h.layoutField('Sobre o que você ensina?', 456); h.control('Conteúdo das sugestões da Classy').onLayout(); await h.pump();
    assert.equal(h.scrollRequests.at(-1).y, 444); assert.equal(h.sheetHeight(), 844 - 50 - 336 - 16);
    const calls = h.scrollRequests.length; h.control('Sobre o que você ensina?').onBlur(); h.keyboard('keyboardWillChangeFrame', { height: 356, screenY: 488 }); await h.pump(); assert.equal(h.scrollRequests.length, calls);
  } finally { h.dispose(); }
});
test('a mesma rolagem por foco revela título e roteiro sem responder no container', async () => {
  const h = harness({ component: true });
  try {
    await h.pump(); await openIdeas(h); h.control('Criar roteiro: Pauta 1').onPress(); await h.pump(); h.control('Gerar roteiro com a Classy').onPress(); await h.pump();
    h.layoutField('Título do roteiro da Classy', 110); h.control('Título do roteiro da Classy').onFocus(); await h.pump(); assert.equal(h.scrollRequests.at(-1).y, 98);
    h.control('Título do roteiro da Classy').onBlur(); h.layoutField('Roteiro da Classy', 230); h.control('Roteiro da Classy').onFocus(); await h.pump(); assert.equal(h.scrollRequests.at(-1).y, 218); assert.equal(h.hasContentTouchWrapper(), false);
  } finally { h.dispose(); }
});

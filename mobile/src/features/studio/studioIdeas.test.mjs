import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as contract from './studioIdeasContract.ts';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ideas = [1, 2, 3].map(n => ({ id: uuid(n), title: `Pauta ${n}`, summary: `Como explicar o assunto ${n}`, objective: 'Ensinar na prática', audience: 'Iniciantes', tags: ['teste'], kind: 'aula', durationMinutes: 4 }));
const recentSource = { type: 'recent', label: 'Seus últimos conteúdos', contentIds: [uuid(10)], categoryId: null };
const categories = [{ id: uuid(20), name: 'Tecnologia', slug: 'tecnologia' }, { id: uuid(21), name: 'Criação', slug: 'criacao' }];
const contextFixture = (suggestions = ideas, source = recentSource) => ({ categories, source, recentContents: source.type === 'recent' ? [{ id: uuid(10), title: 'Vídeo anterior', description: '', tags: [], categoryId: uuid(20), categoryName: 'Tecnologia' }] : [], suggestions, cached: !!suggestions.length });
const scriptFixture = request => ({ draft: { kind: request.kind, title: 'Minha pauta', description: 'Descrição', objective: 'Ensinar', audience: 'Iniciantes', script: 'Um roteiro completo para gravar.', tags: ['aula'] }, suggestionId: request.suggestionId, durationMinutes: request.durationMinutes, cached: false });
const transpile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness({ empty = false, noCache = false, component = false, useScript = async () => true } = {}) {
  const slots = [], listeners = new Map(), keyboardListeners = new Map(), calls = [], aborts = [], busyChanges = [];
  let owner = uuid(90), active = true, disabled = false, cursor = 0, dirty = true, effects = [], current, tree, sequence = 100, failures = 0, failureCode, contextFailure = false, suggestFailure = false, suggestFailureCode, deferredScript, dismissed = 0, keyboardDismissed = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useRef: value => { const i = cursor++; return slots[i] ||= { current: value }; },
    useState: initial => { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }]; },
    useEffect: (callback, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) effects.push({ i, callback, deps }); },
  };
  const appState = { currentState: 'active', addEventListener: (event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); return { remove: () => listeners.get(event).delete(callback) }; } };
  const keyboard = { dismiss: () => { keyboardDismissed++; }, addListener: (event, listener) => { if (!keyboardListeners.has(event)) keyboardListeners.set(event, new Set()); keyboardListeners.get(event).add(listener); return { remove: () => keyboardListeners.get(event).delete(listener) }; } };
  const requestStudioIdeas = async (request, signal) => {
    calls.push(request); signal?.addEventListener('abort', () => aborts.push(request));
    if (request.action === 'context') {
      if (contextFailure) { contextFailure = false; throw new Error('Contexto indisponível'); }
      const source = request.categoryId ? { type: 'category', label: 'Categoria: Tecnologia', contentIds: [], categoryId: request.categoryId } : empty ? { type: 'empty', label: 'Escolha uma categoria', contentIds: [], categoryId: null } : recentSource;
      return contextFixture(noCache || source.type === 'empty' ? [] : ideas, source);
    }
    if (request.action === 'suggest') {
      if (suggestFailure) { suggestFailure = false; throw Object.assign(new Error('Sugestões indisponíveis'), { code: suggestFailureCode }); }
      return { suggestions: ideas, source: request.categoryId ? { type: 'category', label: 'Categoria: Tecnologia', contentIds: [], categoryId: request.categoryId } : recentSource, cached: false };
    }
    if (deferredScript) await deferredScript;
    if (failures > 0) { failures--; throw Object.assign(new Error('Roteiro indisponível'), { code: failureCode }); }
    return contract.parseStudioIdeasScript(scriptFixture(request), request);
  };
  const api = { ...contract, requestStudioIdeas, newStudioIdeasRequestId: () => uuid(sequence++) };
  const hookModule = { exports: {} };
  new Function('require', 'module', 'exports', transpile('./useStudioIdeas.ts'))(name => ({ react: hooks, 'react-native': { AppState: appState, Keyboard: keyboard }, './studioIdeas': api }[name]), hookModule, hookModule.exports);
  const jsx = (type, props) => ({ type, props });
  const rn = { AppState: appState, Keyboard: keyboard, Platform: { OS: 'ios' }, StyleSheet: { create: value => value, absoluteFill: {} }, useWindowDimensions: () => ({ width: 390, height: 844 }), ...Object.fromEntries('ActivityIndicator KeyboardAvoidingView Pressable ScrollView Text TextInput TouchableWithoutFeedback View'.split(' ').map(name => [name, name])) };
  const deps = { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': rn, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 50, bottom: 34, left: 0, right: 0 }) }, 'lucide-react-native': Object.fromEntries('ArrowLeft ArrowRight Check ChevronRight FileText Film Lightbulb Mic Minus Plus RefreshCw Sparkles Video'.split(' ').map(name => [name, name])), '@/components/ClassyAvatar': { ClassyAvatar: 'Avatar' }, '@/components/SheetModal': { SheetCloseButton: 'SheetCloseButton', SheetModal: 'SheetModal', sheetStyles: {} }, '@/features/auth/authContext': { useAuth: () => ({ user: owner ? { id: owner } : null }) }, '@/theme/colors': { colors: {} }, './useStudioIdeas': { useStudioIdeas: (...args) => { current = hookModule.exports.useStudioIdeas(...args); return current; } }, './studioIdeas': api };
  const componentModule = { exports: {} };
  if (component) new Function('require', 'module', 'exports', transpile('./StudioIdeasCard.tsx'))(name => { assert.ok(name in deps, name); return deps[name]; }, componentModule, componentModule.exports);
  const render = () => {
    cursor = 0; dirty = false; effects = [];
    if (component) tree = componentModule.exports.StudioIdeasCard({ active, disabled, onUseScript: useScript, onSheetDismiss: () => dismissed++, onBusyChange: value => busyChanges.push(value) });
    else current = hookModule.exports.useStudioIdeas(owner, active, disabled);
    for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }; }
  };
  const pump = async () => { for (let i = 0; i < 30; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty) return; } throw new Error('Ideas did not settle'); };
  const visit = (node, predicate) => { if (Array.isArray(node)) { for (const child of node) { const found = visit(child, predicate); if (found) return found; } } else if (node && typeof node === 'object') { if (predicate(node)) return node; return visit(node.props?.children, predicate); } };
  return { pump, calls, aborts, busyChanges, state: () => current, control: label => visit(tree, node => node.props?.accessibilityLabel === label)?.props, modal: () => visit(tree, node => node.type === 'SheetModal')?.props,
    update: values => { if ('owner' in values) owner = values.owner; if ('active' in values) active = values.active; if ('disabled' in values) disabled = values.disabled; dirty = true; },
    appState: state => { appState.currentState = state; for (const listener of listeners.get('change') || []) listener(state); },
    keyboard: (event, endCoordinates) => { for (const listener of keyboardListeners.get(event) || []) listener({ endCoordinates }); },
    sheetHeight: () => visit(tree, node => node.type === 'View' && Array.isArray(node.props?.style) && node.props.style.some(style => style?.maxHeight))?.props.style.find(style => style?.maxHeight)?.maxHeight,
    hasContentTouchWrapper: () => !!visit(tree, node => node.type === 'TouchableWithoutFeedback'),
    failScript: (count, code) => { failures = count; failureCode = code; }, failSuggestions: code => { suggestFailure = true; suggestFailureCode = code; }, failContext: () => { contextFailure = true; },
    deferScript: () => { let release; deferredScript = new Promise(resolve => { release = resolve; }); return release; },
    dismissed: () => dismissed, keyboardDismissed: () => keyboardDismissed,
    dispose: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
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
test('contexto e três sugestões existentes não chamam geração nem bloqueiam ações fora do sheet', async () => {
  const h = harness({ component: true }); try { await h.pump(); assert.deepEqual(h.calls.map(call => call.action), ['context']); assert.equal(h.state().context.suggestions.length, 3); assert.deepEqual(h.busyChanges, [false]); assert.ok(h.control('Criar roteiro: Pauta 1')); } finally { h.dispose(); }
});
test('histórico inicia sugestões uma vez e reabrir/foco usa cache sem custo novo', async () => {
  const h = harness({ noCache: true }); try { await h.pump(); assert.deepEqual(h.calls.map(call => call.action), ['context', 'suggest']); h.state().open(); await h.pump(); h.state().close(); h.update({ active: false }); await h.pump(); h.update({ active: true }); await h.pump(); h.state().open(); await h.pump(); assert.equal(h.calls.filter(call => call.action === 'suggest').length, 1); } finally { h.dispose(); }
});
test('falha automática não gera em cada foco e retry conserva idempotência', async () => {
  const h = harness({ noCache: true }); try { h.failSuggestions(); await h.pump(); const request = h.calls.find(call => call.action === 'suggest'); assert.equal(h.state().error, 'Sugestões indisponíveis'); h.update({ active: false }); await h.pump(); h.update({ active: true }); await h.pump(); assert.equal(h.calls.filter(call => call.action === 'suggest').length, 1); h.state().retry(); await h.pump(); assert.equal(h.calls.filter(call => call.action === 'suggest')[1].requestId, request.requestId); } finally { h.dispose(); }
});
test('creator sem histórico escolhe categoria oficial antes de qualquer geração', async () => {
  const h = harness({ empty: true, noCache: true }); try { await h.pump(); assert.deepEqual(h.calls.map(call => call.action), ['context']); h.state().open(); await h.pump(); assert.equal(h.state().categoriesVisible, true); h.state().chooseCategory(uuid(200)); await h.pump(); assert.equal(h.calls.length, 1); h.state().chooseCategory(uuid(20)); await h.pump(); assert.deepEqual(h.calls.map(call => call.action), ['context', 'context', 'suggest']); assert.equal(h.calls.at(-1).categoryId, uuid(20)); } finally { h.dispose(); }
});
test('geração limita Short, bloqueia clique duplo e retry recupera mesmo pedido', async () => {
  const h = harness(); try { await h.pump(); h.state().choose(ideas[0]); await h.pump(); h.state().setKind('short'); await h.pump(); h.state().setMinutes(10); await h.pump(); assert.equal(h.state().minutes, 3); h.failScript(1); const generate = h.state().generateScript; generate(); generate(); await h.pump(); assert.equal(h.calls.filter(call => call.action === 'script').length, 1); assert.equal(h.state().error, 'Roteiro indisponível'); h.state().retry(); await h.pump(); const requests = h.calls.filter(call => call.action === 'script'); assert.equal(requests[0].requestId, requests[1].requestId); assert.equal(h.state().draft.durationMinutes, 3); } finally { h.dispose(); }
});
for (const code of ['request_failed', 'generation_failed', 'ai_invalid_response', 'generation_cancelled', 'ai_unavailable']) test(`retry explícito de roteiro renova UUID após falha terminal ${code}`, async () => {
  const h = harness(); try { await h.pump(); h.state().choose(ideas[0]); await h.pump(); h.failScript(1, code); await h.state().generateScript(); await h.pump(); h.state().retry(); await h.pump(); const requests = h.calls.filter(call => call.action === 'script'); assert.equal(requests.length, 2); assert.notEqual(requests[0].requestId, requests[1].requestId); assert.equal(h.state().draft.title, 'Minha pauta'); } finally { h.dispose(); }
});
test('falha terminal de sugestões renova UUID, mantendo contexto da categoria', async () => {
  const h = harness({ empty: true, noCache: true }); try { await h.pump(); h.failSuggestions('generation_failed'); h.state().chooseCategory(uuid(20)); await h.pump(); h.state().retry(); await h.pump(); const requests = h.calls.filter(call => call.action === 'suggest'); assert.notEqual(requests[0].requestId, requests[1].requestId); assert.equal(requests[1].categoryId, uuid(20)); } finally { h.dispose(); }
});
test('edições permanecem após fechar e visitar outra pauta sem regenerar', async () => {
  const h = harness(); try { await h.pump(); h.state().choose(ideas[0]); await h.pump(); const oldGenerate = h.state().generateScript; await oldGenerate(); await h.pump(); const edit = h.state().edit; edit('title', 'Meu título'); edit('script', 'Meu texto revisado.'); await h.pump(); await oldGenerate(); assert.equal(h.state().draft.title, 'Meu título'); h.state().close(); await h.pump(); h.state().choose(ideas[1]); await h.pump(); assert.equal(h.state().draft, null); h.state().choose(ideas[0]); await h.pump(); assert.equal(h.state().draft.script, 'Meu texto revisado.'); await h.state().generateScript(); assert.equal(h.calls.filter(call => call.action === 'script').length, 1); } finally { h.dispose(); }
});
for (const interruption of ['close', 'focus', 'background', 'owner']) test(`retorno tardio após ${interruption} não troca pauta nem preenche texto`, async () => {
  const h = harness(); try { await h.pump(); h.state().choose(ideas[0]); await h.pump(); const release = h.deferScript(); void h.state().generateScript(); await h.pump(); if (interruption === 'close') h.state().close(); else if (interruption === 'focus') h.update({ active: false }); else if (interruption === 'owner') h.update({ owner: uuid(91) }); else h.appState('background'); await h.pump(); release(); await h.pump(); assert.equal(h.state().draft, null); assert.ok(h.aborts.some(call => call.action === 'script')); if (interruption === 'owner') assert.equal(h.state().selected, null); } finally { h.dispose(); }
});
test('handoff com falha mantém texto editado e sheet; sucesso aguarda dismiss nativo', async () => {
  let failures = 1, accepted = [];
  const h = harness({ component: true, useScript: async draft => { accepted.push(draft); if (failures--) throw new Error('Não foi possível salvar'); return true; } });
  try { await h.pump(); h.control('Criar roteiro: Pauta 1').onPress(); await h.pump(); h.control('Gerar roteiro com a Classy').onPress(); await h.pump(); h.control('Roteiro da Classy').onChangeText('Roteiro editado e pronto.'); await h.pump(); h.control('Gravar com este roteiro').onPress(); await h.pump(); assert.equal(h.modal().visible, true); assert.equal(h.control('Roteiro da Classy').value, 'Roteiro editado e pronto.'); assert.equal(h.dismissed(), 0); h.control('Gravar com este roteiro').onPress(); await h.pump(); assert.equal(h.modal().visible, false); assert.equal(h.dismissed(), 0); h.modal().onDismiss(); h.modal().onDismiss(); assert.equal(h.dismissed(), 1); assert.equal(accepted.length, 2); assert.equal(accepted[1].script, 'Roteiro editado e pronto.'); } finally { h.dispose(); }
});
test('mensagens públicas traduzem limites e falhas sem copiar texto sensível do serviço', () => {
  assert.match(contract.studioIdeasFriendlyError('generation_limit', 3600), /limite/);
  assert.match(contract.studioIdeasFriendlyError('context_required'), /categoria/);
  assert.match(contract.studioIdeasFriendlyError('unexpected secret'), /Seu texto permanece/);
});
test('cliente lê código HTTP estruturado, conserva erro de transporte e não mostra diagnóstico bruto', async () => {
  let mode = 'terminal', options;
  const module = { exports: {} };
  const dependencies = { 'expo-crypto': { randomUUID: () => uuid(999) }, '@/lib/supabase': { supabase: { functions: { invoke: async (_name, input) => {
    options = input;
    if (mode === 'transport') throw new Error('Internal transport diagnostic');
    if (mode === 'invalid') return { data: { source: { type: 'wrong' } }, error: null };
    return { data: null, error: { context: new Response(JSON.stringify({ error: 'Internal provider diagnostic', code: 'request_failed' }), { status: 409 }) } };
  } } } }, './studioIdeasContract': contract };
  new Function('require', 'module', 'exports', transpile('./studioIdeas.ts'))(name => dependencies[name], module, module.exports);
  await assert.rejects(module.exports.requestStudioIdeas({ action: 'context' }), error => error.code === 'request_failed' && contract.studioIdeasRetryNeedsNewId(error) && !error.message.includes('Internal'));
  assert.equal(options.timeout, 90000);
  mode = 'transport';
  await assert.rejects(module.exports.requestStudioIdeas({ action: 'context' }), error => error.code === 'transport' && !contract.studioIdeasRetryNeedsNewId(error) && !error.message.includes('Internal'));
  mode = 'invalid';
  await assert.rejects(module.exports.requestStudioIdeas({ action: 'context' }), error => error.code === 'invalid_response' && !error.message.includes('inválida'));
});
test('sheet desconta teclado da altura para manter cabeçalho abaixo da safe area', async () => {
  const h = harness({ component: true });
  try {
    await h.pump(); h.control('Criar roteiro: Pauta 1').onPress(); await h.pump();
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
    await h.pump(); h.control('Criar roteiro: Pauta 1').onPress(); await h.pump();
    assert.equal(h.hasContentTouchWrapper(), false);
    const scroll = h.control('Conteúdo das sugestões da Classy');
    assert.equal(scroll.style.flexShrink, 1); assert.equal(scroll.keyboardShouldPersistTaps, 'handled');
    const dismissCount = h.keyboardDismissed(); scroll.onScrollBeginDrag(); assert.equal(h.keyboardDismissed(), dismissCount + 1);
  } finally { h.dispose(); }
});

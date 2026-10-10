import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const fixture = (patch = {}) => model.readLiveRecord({ id: 'live', creator_id: 'owner', title: 'Aula ao vivo', status: 'ended', mux_live_stream_id: 'mux', recording_ready_at: '2026-10-10T12:00:00Z', created_at: '2026-10-10T12:00:00Z', ...patch });

function harness(route, initialLives = []) {
  const source = ts.transpileModule(readFileSync(new URL(`../../../app/studio/live/${route}.tsx`, import.meta.url), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  let owner = 'owner', focused = true, canCreate = true, lives = initialLives, dirty = true, cursor = 0, effects = [], tree, removal;
  const slots = [], alerts = [], calls = [], pushes = [], replaces = [], dispatches = [], creations = [], pickers = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ||= { value: typeof value === 'function' ? value() : value }; return [slots[i].value, next => { const result = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(result, slots[i].value)) { slots[i].value = result; dirty = true; } }]; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) effects.push({ i, callback, deps }); },
  };
  const jsx = (type, props) => ({ type, props });
  const guardedNavigation = (list, target) => {
    if (removal?.prevent) { removal.callback({ data: { action: { type: 'GO_BACK' } } }); return; }
    list.push(target);
  };
  const dependencies = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'view', Text: 'text', TextInput: 'input', Pressable: 'button', ScrollView: 'scroll', ActivityIndicator: 'spinner', RefreshControl: 'refresh', KeyboardAvoidingView: 'keyboard', Platform: { OS: 'ios' }, Alert: { alert: (...args) => alerts.push(args) }, Keyboard: { dismiss() {} }, StyleSheet: { create: value => value, absoluteFillObject: {} } },
    'expo-router': { useRouter: () => ({ push: target => pushes.push(target), replace: target => guardedNavigation(replaces, target) }) },
    '@react-navigation/native': { useIsFocused: () => focused, useNavigation: () => ({ dispatch: action => guardedNavigation(dispatches, action) }), usePreventRemove: (prevent, callback) => { removal = { prevent, callback }; } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 54, bottom: 34, left: 0, right: 0 }) },
    'expo-image-picker': { launchImageLibraryAsync: options => { const wait = deferred(); pickers.push({ ...wait, options }); return wait.promise; } },
    'lucide-react-native': Object.fromEntries('ArrowUpRight ImagePlus Radio Plus RefreshCw Send Trash2 Play'.split(' ').map(name => [name, name])),
    '@/components/AppScreen': { AppScreen: 'screen' }, '@/components/NavigationHeader': { NavigationHeader: 'header' }, '@/components/LoadingImage': { LoadingImage: 'image' },
    '@/features/auth/authContext': { useAuth: () => ({ user: owner ? { id: owner } : null }) },
    '@/features/live/model': model,
    '@/features/live/LiveWorkspaceUI': { LiveWorkspaceAccess: 'access', LiveWorkspaceCard: 'card', LiveWorkspaceLoading: 'skeletons', liveWorkspaceStyles: {} },
    '@/features/studio/StudioUI': { StudioButton: 'button', StudioField: 'input' }, '@/theme/colors': { colors: {} }, '@/theme/controls': { controls: {} },
    '@/features/live/useLives': { useStudioLives: () => ({ lives, loading: false, error: null, accessLoading: false, canCreate,
      refresh: async () => {}, create: (input, scope) => { const wait = deferred(); creations.push({ ...wait, input, scope }); return wait.promise; },
      publishReplay: (id, scope) => { const wait = deferred(); calls.push({ ...wait, id, scope, action: 'publish' }); return wait.promise; },
      discard: (id, scope) => { const wait = deferred(); calls.push({ ...wait, id, scope, action: 'discard' }); return wait.promise; },
    }) },
  };
  const module = { exports: {} }; new Function('require', 'module', 'exports', source)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  const render = () => { cursor = 0; effects = []; dirty = false; tree = module.exports.default(); for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }; } };
  const pump = async () => { for (let i = 0; i < 30; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty) return; } throw new Error('Live route did not settle'); };
  const find = predicate => { const walk = node => { if (Array.isArray(node)) { for (const child of node) { const found = walk(child); if (found) return found; } } else if (node && typeof node === 'object') { if (predicate(node)) return node; return walk(node.props?.children); } }; return walk(tree); };
  const prop = label => { const found = find(node => node.props?.label === label || node.props?.accessibilityLabel === label); assert.ok(found, `Missing ${label}`); return found.props; };
  return { pump, find, prop, pickers, creations, calls, pushes, replaces, alerts, dispatches,
    field: (label, value) => prop(label).onChangeText(value),
    focus(value) { focused = value; dirty = true; }, owner(value) { owner = value; dirty = true; }, access(value) { canCreate = value; dirty = true; }, lives(value) { lives = value; dirty = true; },
    back() { if (removal.prevent) removal.callback({ data: { action: { type: 'GO_BACK' } } }); else dispatches.push({ type: 'GO_BACK' }); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
async function ready(h) {
  await h.pump(); h.field('Título', 'Aula ao vivo'); await h.pump();
  h.prop('Escolher capa da live').onPress(); h.pickers.at(-1).resolve({ canceled: false, assets: [{ uri: 'file:///capa.jpg' }] }); await h.pump();
}

test('preparação usa uma capa local e só cria ao confirmar, sem projeto/take ou transmissão', async () => {
  const h = harness('new'); try {
    await ready(h); assert.deepEqual(h.creations, []); assert.deepEqual(h.pushes, []);
    const options = h.pickers[0].options; assert.deepEqual(options.mediaTypes, ['images']); assert.deepEqual(options.aspect, [16, 9]);
    const button = h.prop('Abrir prévia'); button.onPress(); button.onPress(); await h.pump();
    assert.equal(h.creations.length, 1); assert.deepEqual(h.creations[0].input, { title: 'Aula ao vivo', description: '', coverUri: 'file:///capa.jpg' });
    h.creations[0].resolve(fixture({ status: 'waiting' })); await h.pump();
    assert.deepEqual(h.replaces, [{ pathname: '/studio/live/[id]', params: { id: 'live' } }]);
    assert.deepEqual(h.calls, []);
  } finally { h.dispose(); }
});
test('cancelar o picker conserva título e não aloca live', async () => {
  const h = harness('new'); try {
    await h.pump(); h.field('Título', 'Meu título'); await h.pump(); h.prop('Escolher capa da live').onPress();
    h.pickers[0].resolve({ canceled: true }); await h.pump();
    assert.equal(h.prop('Título').value, 'Meu título'); assert.equal(h.prop('Abrir prévia').disabled, true); assert.equal(h.creations.length, 0);
  } finally { h.dispose(); }
});
test('retorno da galeria após blur/refocus não troca capa nem abre outra tela', async () => {
  const h = harness('new'); try {
    await h.pump(); h.prop('Escolher capa da live').onPress(); h.focus(false); await h.pump(); h.focus(true); await h.pump();
    h.pickers[0].resolve({ canceled: false, assets: [{ uri: 'file:///stale.jpg' }] }); await h.pump();
    assert.ok(h.find(node => node.props?.accessibilityLabel === 'Escolher capa da live')); assert.equal(h.replaces.length, 0);
  } finally { h.dispose(); }
});
test('resultado de create já iniciado após perda de foco não navega nem declara rollback', async () => {
  const h = harness('new'); try {
    await ready(h); h.prop('Abrir prévia').onPress(); await h.pump(); h.focus(false); await h.pump();
    assert.equal(h.creations[0].scope.isCurrent(), false); h.creations[0].resolve(fixture()); await h.pump(); h.focus(true); await h.pump();
    assert.equal(h.replaces.length, 0); assert.equal(h.prop('Título').value, 'Aula ao vivo'); assert.equal(h.alerts.length, 0);
  } finally { h.dispose(); }
});
test('troca de owner invalida create e limpa a preparação sem usar dados antigos', async () => {
  const h = harness('new'); try {
    await ready(h); h.prop('Abrir prévia').onPress(); await h.pump(); h.owner('other'); await h.pump();
    assert.equal(h.creations[0].scope.isCurrent(), false); h.creations[0].resolve(fixture()); await h.pump();
    assert.equal(h.replaces.length, 0); assert.equal(h.prop('Título').value, ''); assert.ok(h.find(node => node.props?.accessibilityLabel === 'Escolher capa da live'));
  } finally { h.dispose(); }
});
test('falha de create conserva título e capa para retry', async () => {
  const h = harness('new'); try {
    await ready(h); h.prop('Abrir prévia').onPress(); await h.pump(); h.creations[0].reject(new Error('Rede indisponível')); await h.pump();
    assert.equal(h.prop('Título').value, 'Aula ao vivo'); assert.equal(h.prop('Abrir prévia').disabled, false); assert.equal(h.replaces.length, 0);
    assert.ok(h.find(node => node.props?.children === 'Rede indisponível'));
  } finally { h.dispose(); }
});
test('sair de preparação com dados pede confirmação; cancelar conserva, confirmar desarma guard antes de navegar', async () => {
  const h = harness('new'); try {
    await ready(h); h.back(); h.alerts[0][2].find(button => button.text === 'Continuar preparando').onPress(); await h.pump();
    assert.equal(h.prop('Título').value, 'Aula ao vivo'); assert.equal(h.dispatches.length, 0);
    h.back(); h.alerts[1][2].find(button => button.text === 'Sair').onPress(); await h.pump(); assert.deepEqual(h.dispatches, [{ type: 'GO_BACK' }]);
  } finally { h.dispose(); }
});
test('conta pendente pode gerenciar preparação existente sem habilitar criação', async () => {
  const h = harness('index', [fixture({ status: 'waiting', recording_ready_at: null })]); try {
    h.access(false); await h.pump(); h.prop('Abrir prévia').onPress();
    assert.deepEqual(h.pushes, [{ pathname: '/studio/live/[id]', params: { id: 'live' } }]); assert.equal(h.creations.length, 0);
  } finally { h.dispose(); }
});
test('replay só é enviado após confirmação e trava operação duplicada', async () => {
  const h = harness('index', [fixture()]); try {
    await h.pump(); h.prop('Enviar para revisão').onPress(); assert.equal(h.calls.length, 0);
    const confirm = h.alerts[0][2].find(button => button.text === 'Enviar para revisão').onPress;
    confirm(); confirm(); await h.pump(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].action, 'publish');
    h.calls[0].resolve({ contentId: 'content' }); await h.pump(); assert.equal(h.prop('Enviar para revisão').disabled, false);
  } finally { h.dispose(); }
});
test('confirmação de replay perde validade por foco/owner ou por atualização do alvo', async () => {
  for (const mutate of [async h => { h.focus(false); await h.pump(); h.focus(true); }, async h => h.owner('other'), async h => h.lives([fixture({ replay_content_id: 'content' })])]) {
    const h = harness('index', [fixture()]); try {
      await h.pump(); h.prop('Enviar para revisão').onPress(); const confirm = h.alerts[0][2].find(button => button.text === 'Enviar para revisão').onPress;
      await mutate(h); await h.pump(); confirm(); await h.pump(); assert.equal(h.calls.length, 0);
    } finally { h.dispose(); }
  }
});
test('cancelar descarte não apaga; gravação pronta tem entrada própria para conferência', async () => {
  const h = harness('index', [fixture()]); try {
    await h.pump(); h.prop('Descartar Aula ao vivo').onPress(); h.alerts[0][2].find(button => button.text === 'Cancelar').onPress();
    assert.equal(h.calls.length, 0); h.prop('Ver gravação de Aula ao vivo').onPress(); assert.deepEqual(h.pushes, [{ pathname: '/live/[id]', params: { id: 'live' } }]);
  } finally { h.dispose(); }
});

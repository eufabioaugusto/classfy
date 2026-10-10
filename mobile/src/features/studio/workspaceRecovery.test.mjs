import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
const source = ts.transpileModule(readFileSync(new URL('../../../app/studio/index.tsx', import.meta.url), 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
function harness(projects = []) {
  let owner = 'owner', error = projects.length ? null : 'A lista precisa de recuperação.', dirty = true, cursor = 0, effects = [], tree, recoverCalls = 0, resolveRecovery, rejectRecovery, focused = true, native = true;
  const pushes = [], creations = [];
  const actionCalls = [], feedback = [], appListeners = new Set(), deferred = new Map();
  async function action(kind, id, value, scope) {
    actionCalls.push({ kind, id, value });
    const wait = deferred.get(kind); deferred.delete(kind);
    if (wait) await wait;
    if (!scope.isCurrent()) throw new Error('Sessão mudou');
    if (kind === 'rename') projects = projects.map(project => project.id === id ? model.withStudioTakes({ ...project, editing: project.editing, title: value.trim() }) : project);
    if (kind === 'delete') projects = projects.filter(project => project.id !== id);
    if (kind === 'duplicate') { const source = projects.find(project => project.id === id); projects = [...projects, model.withStudioTakes({ ...source, editing: source.editing, id: 'copy', title: `${source.title} (cópia)` })]; }
    dirty = true;
  }
  const slots = [], alerts = [];
  const equals = (a, b) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useRef: value => { const i = cursor++; return slots[i] ||= { current: value }; },
    useState: initial => { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useMemo: (callback, deps) => { const i = cursor++; if (!slots[i] || !equals(slots[i].deps, deps)) slots[i] = { value: callback(), deps }; return slots[i].value; },
    useCallback: (callback, deps) => hooks.useMemo(() => callback, deps),
    useEffect: (callback, deps) => { const i = cursor++; if (!slots[i] || !equals(slots[i].deps, deps)) effects.push({ i, callback, deps }); },
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'spinner', Alert: { alert: (...args) => alerts.push(args) }, AppState: { currentState: 'active', addEventListener: (_, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } }, Keyboard: { dismiss() {} }, KeyboardAvoidingView: 'keyboard', Platform: { OS: 'ios' }, Pressable: 'button', ScrollView: 'scroll', Text: 'text', TextInput: 'input', View: 'view', StyleSheet: { create: value => value, absoluteFillObject: {} }, useWindowDimensions: () => ({ width: 390, height: 844 }) },
    'expo-router': { useRouter: () => ({ push: target => pushes.push(target) }) }, '@react-navigation/native': { useIsFocused: () => focused },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 54, bottom: 34, left: 0, right: 0 }) },
    'lucide-react-native': Object.fromEntries('ArrowDownWideNarrow ArrowUpRight Camera Check ChevronRight Clock3 Copy Film FolderOpen Images Mic MoreHorizontal Pencil Plus Radio Search Trash2 Video X'.split(' ').map(name => [name, name])),
    '@/components/AppScreen': { AppScreen: 'screen' }, '@/components/NavigationHeader': { NavigationHeader: 'header' }, '@/components/LoadingImage': { LoadingImage: 'image' }, '@/components/LoadingPlaceholder': { SkeletonBlock: 'skeleton', SkeletonGroup: 'skeletons' },
    '@/components/SheetModal': { SheetCloseButton: 'close', SheetModal: 'sheet', sheetStyles: {} }, '@/features/auth/authContext': { useAuth: () => ({ user: { id: owner } }) }, '@/contexts/PrimaryActionContext': { usePrimaryAction: () => ({ canPublish: true }) },
    '@/theme/colors': { colors: {} }, '@/theme/controls': { controls: {} }, '@/features/studio/StudioUI': { StudioAccess: 'access', studioStyles: {} },
    '@/features/studio/useStudioProjects': { useStudioProjects: () => ({ projects, loading: false, error, create: (...args) => creations.push(args), remove: (id, scope) => action('delete', id, undefined, scope), rename: (id, value, scope) => action('rename', id, value, scope), duplicate: (id, scope) => action('duplicate', id, undefined, scope), recover: () => { recoverCalls++; return new Promise((resolve, reject) => { resolveRecovery = resolve; rejectRecovery = reject; }); } }) },
    '@/features/studio/store': { getStudioProject: (currentOwner, id) => projects.find(project => project.ownerId === currentOwner && project.id === id) }, '@/features/studio/media': {}, '@/features/studio/model': model,
    '@/features/studio/snapFeedback': { performStudioSnapFeedback: () => feedback.push('hold') },
    '../../modules/classfy-studio-media': { isStudioMediaAvailable: () => native },
  };
  const module = { exports: {} }; new Function('require', 'module', 'exports', source)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  const render = () => { cursor = 0; effects = []; dirty = false; tree = module.exports.default(); for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }; } };
  const pump = async () => { for (let i = 0; i < 30; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty) return; } throw new Error('Workspace did not settle'); };
  const find = predicate => { const visit = node => { if (Array.isArray(node)) { for (const child of node) { const found = visit(child); if (found) return found; } } else if (node && typeof node === 'object') { if (predicate(node)) return node; return visit(node.props?.children); } }; return visit(tree); };
  return { pump, alerts, find, calls: () => recoverCalls, button: () => find(node => node.props?.accessibilityLabel === 'Recuperar rascunhos do backup').props,
    changeOwner: next => { owner = next; dirty = true; }, focus: next => { focused = next; dirty = true; }, native: next => { native = next; dirty = true; }, pushes, creations,
    actionCalls, feedback, appState: state => { for (const listener of appListeners) listener(state); }, projects: () => projects,
    defer: kind => { let resolve, reject; deferred.set(kind, new Promise((yes, no) => { resolve = yes; reject = no; })); return { resolve, reject }; },
    fail: () => rejectRecovery(new Error('Disco cheio')), complete: () => { error = null; dirty = true; resolveRecovery(); }, dispose: () => { for (const slot of slots) slot?.cleanup?.(); } };
}
test('workspace só recupera após confirmação e bloqueia dupla execução enquanto escreve', async () => {
  const h = harness(); try {
    await h.pump(); h.button().onPress(); assert.equal(h.calls(), 0);
    assert.match(h.alerts[0][1], /Edições posteriores/); assert.match(h.alerts[0][1], /preservados/);
    const confirm = h.alerts[0][2].find(item => item.text === 'Recuperar backup').onPress;
    confirm(); confirm(); await h.pump(); assert.equal(h.calls(), 1); assert.equal(h.button().disabled, true);
    h.fail(); await h.pump(); assert.equal(h.button().disabled, false); assert.equal(h.alerts.at(-1)[0], 'Arquivos preservados');
  } finally { h.dispose(); }
});
test('confirmação aberta na conta anterior não restaura a lista de outra sessão', async () => {
  const h = harness(); try {
    await h.pump(); h.button().onPress(); const confirm = h.alerts[0][2].find(item => item.text === 'Recuperar backup').onPress;
    h.changeOwner('other'); await h.pump(); confirm(); await h.pump(); assert.equal(h.calls(), 0);
  } finally { h.dispose(); }
});
test('badge do workspace usa duração da receita incluindo áudio depois do vídeo', async () => {
  const ticks = model.studioTicks;
  let editing = model.emptyStudioEditing('aula');
  editing = { ...editing, assets: [{ id: 'video', kind: 'video', uri: 'file:///video.mp4', name: 'Vídeo', durationTicks: ticks(2) }, { id: 'audio', kind: 'audio', uri: 'file:///audio.m4a', name: 'Música', durationTicks: ticks(4) }], main: [{ id: 'take', assetId: 'video', sourceStartTicks: 0, sourceEndTicks: ticks(2) }] };
  editing = model.addStudioLayerItem(editing, { id: 'music', kind: 'audio', assetId: 'audio', atTicks: 0, durationTicks: ticks(4) });
  const project = model.withStudioTakes({ id: 'project', ownerId: 'owner', kind: 'aula', title: 'Aula', description: '', objective: '', tags: [], updatedAt: '2026-10-08T10:00:00Z', state: 'draft', editing });
  const h = harness([project]); try { await h.pump(); assert.ok(h.find(node => node.type === 'text' && node.props.children === '0:04')); } finally { h.dispose(); }
});
test('Live é uma entrada própria e espera o sheet fechar sem criar um projeto de takes', async () => {
  const h = harness(); try {
    await h.pump(); h.find(node => node.props?.accessibilityLabel === 'Formato Live').props.onPress(); await h.pump();
    assert.equal(h.find(node => node.props?.accessibilityLabel === 'Gravar com a câmera'), undefined);
    h.find(node => node.props?.accessibilityLabel === 'Preparar live').props.onPress(); await h.pump();
    assert.deepEqual(h.pushes, []); assert.deepEqual(h.creations, []);
    h.find(node => node.props?.title === 'Novo projeto').props.onDismiss(); await h.pump();
    assert.deepEqual(h.pushes, ['/studio/live/new']); assert.deepEqual(h.creations, []);
  } finally { h.dispose(); }
});
test('Live não abre depois de perder foco enquanto o sheet fecha', async () => {
  const h = harness(); try {
    await h.pump(); h.find(node => node.props?.accessibilityLabel === 'Formato Live').props.onPress(); await h.pump();
    h.find(node => node.props?.accessibilityLabel === 'Preparar live').props.onPress(); await h.pump();
    h.focus(false); await h.pump(); h.find(node => node.props?.title === 'Novo projeto').props.onDismiss(); await h.pump();
    assert.deepEqual(h.pushes, []); assert.deepEqual(h.creations, []);
  } finally { h.dispose(); }
});
test('binário sem edição nativa conserva a entrada de gerenciamento de Lives', async () => {
  const h = harness(); try {
    h.native(false); await h.pump(); h.find(node => node.props?.accessibilityLabel === 'Minhas lives').props.onPress();
    assert.deepEqual(h.pushes, ['/studio/live']); assert.equal(h.find(node => node.props?.accessibilityLabel === 'Novo projeto'), undefined);
  } finally { h.dispose(); }
});

function workspaceProject(id = 'project', title = 'Minha aula') {
  return model.withStudioTakes({ version: 2, id, ownerId: 'owner', kind: 'aula', title, description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '', editing: model.emptyStudioEditing('aula'), updatedAt: '2026-10-10T10:00:00Z', state: 'draft', revision: 1, progress: 0 });
}
const control = (h, label) => h.find(node => node.props?.accessibilityLabel === label)?.props;
const menu = h => h.find(node => node.props?.title === 'Opções do projeto')?.props;
test('hold de 450 ms abre o mesmo menu dos três pontos e não navega ao soltar', async () => {
  const h = harness([workspaceProject()]); try {
    await h.pump(); const card = control(h, 'Abrir Minha aula, Rascunho');
    assert.equal(card.delayLongPress, 450); card.onPressIn(); card.onLongPress(); card.onPress(); await h.pump();
    assert.equal(menu(h).visible, true); assert.deepEqual(h.pushes, []); assert.deepEqual(h.feedback, ['hold']);
    assert.ok(control(h, 'Renomear projeto')); assert.ok(control(h, 'Duplicar projeto')); assert.ok(control(h, 'Excluir projeto'));
    menu(h).onClose(); await h.pump(); control(h, 'Opções de Minha aula').onPress(); await h.pump();
    assert.equal(menu(h).visible, true); assert.deepEqual(h.feedback, ['hold']);
    menu(h).onClose(); await h.pump(); const next = control(h, 'Abrir Minha aula, Rascunho'); next.onPressIn(); next.onPress();
    assert.deepEqual(h.pushes, [{ pathname: '/studio/[id]', params: { id: 'project' } }]);
  } finally { h.dispose(); }
});
test('renomear cancela sem escrita e salva uma única vez enquanto o botão aguarda', async () => {
  const h = harness([workspaceProject()]); try {
    await h.pump(); control(h, 'Opções de Minha aula').onPress(); await h.pump(); control(h, 'Renomear projeto').onPress(); await h.pump();
    control(h, 'Nome do projeto').onChangeText('Nome descartado'); await h.pump(); control(h, 'Cancelar renomeação').onPress(); await h.pump(); assert.deepEqual(h.actionCalls, []);
    control(h, 'Renomear projeto').onPress(); await h.pump(); control(h, 'Nome do projeto').onChangeText('Novo nome'); await h.pump();
    const pending = h.defer('rename'), save = control(h, 'Salvar nome do projeto'); save.onPress(); save.onPress(); await h.pump();
    assert.equal(h.actionCalls.length, 1); assert.equal(control(h, 'Salvar nome do projeto').disabled, true);
    pending.resolve(); await h.pump(); assert.equal(h.projects()[0].title, 'Novo nome'); assert.equal(menu(h).visible, false);
  } finally { h.dispose(); }
});
test('falha ao renomear conserva o campo e permite tentar novamente', async () => {
  const h = harness([workspaceProject()]); try {
    await h.pump(); control(h, 'Opções de Minha aula').onPress(); await h.pump(); control(h, 'Renomear projeto').onPress(); await h.pump();
    control(h, 'Nome do projeto').onChangeText('Novo nome'); await h.pump(); const pending = h.defer('rename'); control(h, 'Salvar nome do projeto').onPress(); await h.pump(); pending.reject(new Error('Disco cheio')); await h.pump();
    assert.equal(control(h, 'Nome do projeto').value, 'Novo nome'); assert.equal(h.projects()[0].title, 'Minha aula');
    assert.ok(h.find(node => node.type === 'text' && node.props.children === 'Disco cheio')); assert.equal(control(h, 'Salvar nome do projeto').disabled, false);
  } finally { h.dispose(); }
});
for (const change of ['owner', 'focus-cycle', 'background']) test(`callback de hold/confirmação anterior é ignorado após ${change}`, async () => {
  const h = harness([workspaceProject()]); try {
    await h.pump(); const card = control(h, 'Abrir Minha aula, Rascunho'); control(h, 'Opções de Minha aula').onPress(); await h.pump(); control(h, 'Excluir projeto').onPress(); await h.pump();
    const confirm = h.alerts.at(-1)[2].find(button => button.text === 'Excluir projeto').onPress;
    if (change === 'owner') h.changeOwner('other'); else if (change === 'focus-cycle') { h.focus(false); await h.pump(); h.focus(true); } else h.appState('background');
    await h.pump(); card.onLongPress(); card.onPress(); confirm(); await h.pump();
    assert.deepEqual(h.actionCalls, []); assert.deepEqual(h.feedback, []); assert.deepEqual(h.pushes, []); assert.equal(menu(h).visible, false);
  } finally { h.dispose(); }
});
test('duplicar reserva a ação antes do primeiro await e não faz navegação tardia depois de perder foco', async () => {
  const h = harness([workspaceProject()]); try {
    await h.pump(); control(h, 'Opções de Minha aula').onPress(); await h.pump(); const pending = h.defer('duplicate'), copy = control(h, 'Duplicar projeto'); copy.onPress(); copy.onPress(); await h.pump();
    assert.equal(h.actionCalls.length, 1); assert.equal(control(h, 'Novo projeto').disabled, true);
    h.focus(false); await h.pump(); pending.resolve(); await h.pump(); assert.deepEqual(h.pushes, []); assert.deepEqual(h.alerts, []);
    h.focus(true); await h.pump(); assert.equal(control(h, 'Novo projeto').disabled, false);
  } finally { h.dispose(); }
});
test('excluir exige confirmação e bloqueia duplicação enquanto a remoção está pendente', async () => {
  const h = harness([workspaceProject()]); try {
    await h.pump(); control(h, 'Opções de Minha aula').onPress(); await h.pump(); const staleCopy = control(h, 'Duplicar projeto'); control(h, 'Excluir projeto').onPress(); await h.pump();
    assert.deepEqual(h.actionCalls, []); const pending = h.defer('delete'), confirm = h.alerts.at(-1)[2].find(button => button.text === 'Excluir projeto').onPress;
    confirm(); confirm(); staleCopy.onPress(); await h.pump(); assert.equal(h.actionCalls.length, 1); assert.equal(h.actionCalls[0].kind, 'delete');
    pending.resolve(); await h.pump(); assert.equal(h.projects().length, 0);
  } finally { h.dispose(); }
});

test('cards novos continuam interativos após duplicar e retornar do AppState inativo sem menu aberto', async () => {
  const h = harness([workspaceProject()]); try {
    await h.pump(); control(h, 'Opções de Minha aula').onPress(); await h.pump(); control(h, 'Duplicar projeto').onPress(); await h.pump();
    assert.equal(h.projects().length, 2); assert.equal(menu(h).visible, false); assert.equal(control(h, 'Novo projeto').disabled, false);
    const previous = control(h, 'Opções de Minha aula (cópia)');
    h.appState('inactive'); await h.pump(); h.appState('active'); await h.pump();
    previous.onPress(); await h.pump(); assert.equal(menu(h).visible, false, 'callback anterior não atravessa a troca de AppState');
    control(h, 'Opções de Minha aula (cópia)').onPress(); await h.pump(); assert.equal(menu(h).visible, true, 'botão atual reabre o menu');
    menu(h).onClose(); await h.pump(); const card = control(h, 'Abrir Minha aula (cópia), Rascunho');
    card.onPressIn(); card.onLongPress(); card.onPress(); await h.pump(); assert.equal(menu(h).visible, true); assert.deepEqual(h.pushes, []);
  } finally { h.dispose(); }
});

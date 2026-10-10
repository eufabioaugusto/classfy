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
    'react-native': { ActivityIndicator: 'spinner', Alert: { alert: (...args) => alerts.push(args) }, Keyboard: { dismiss() {} }, Platform: { OS: 'ios' }, Pressable: 'button', ScrollView: 'scroll', Text: 'text', TextInput: 'input', View: 'view', StyleSheet: { create: value => value, absoluteFillObject: {} }, useWindowDimensions: () => ({ width: 390, height: 844 }) },
    'expo-router': { useRouter: () => ({ push: target => pushes.push(target) }) }, '@react-navigation/native': { useIsFocused: () => focused },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 54, bottom: 34, left: 0, right: 0 }) },
    'lucide-react-native': Object.fromEntries('ArrowDownWideNarrow ArrowUpRight Camera Check ChevronRight Clock3 Film FolderOpen Images Mic MoreHorizontal Plus Radio Search Trash2 Video X'.split(' ').map(name => [name, name])),
    '@/components/AppScreen': { AppScreen: 'screen' }, '@/components/NavigationHeader': { NavigationHeader: 'header' }, '@/components/LoadingImage': { LoadingImage: 'image' }, '@/components/LoadingPlaceholder': { SkeletonBlock: 'skeleton', SkeletonGroup: 'skeletons' },
    '@/components/SheetModal': { SheetCloseButton: 'close', SheetModal: 'sheet', sheetStyles: {} }, '@/features/auth/authContext': { useAuth: () => ({ user: { id: owner } }) }, '@/contexts/PrimaryActionContext': { usePrimaryAction: () => ({ canPublish: true }) },
    '@/theme/colors': { colors: {} }, '@/theme/controls': { controls: {} }, '@/features/studio/StudioUI': { StudioAccess: 'access', studioStyles: {} },
    '@/features/studio/useStudioProjects': { useStudioProjects: () => ({ projects, loading: false, error, create: (...args) => creations.push(args), remove() {}, recover: () => { recoverCalls++; return new Promise((resolve, reject) => { resolveRecovery = resolve; rejectRecovery = reject; }); } }) },
    '@/features/studio/store': {}, '@/features/studio/media': {}, '@/features/studio/model': model,
    '../../modules/classfy-studio-media': { isStudioMediaAvailable: () => native },
  };
  const module = { exports: {} }; new Function('require', 'module', 'exports', source)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  const render = () => { cursor = 0; effects = []; dirty = false; tree = module.exports.default(); for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }; } };
  const pump = async () => { for (let i = 0; i < 30; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty) return; } throw new Error('Workspace did not settle'); };
  const find = predicate => { const visit = node => { if (Array.isArray(node)) { for (const child of node) { const found = visit(child); if (found) return found; } } else if (node && typeof node === 'object') { if (predicate(node)) return node; return visit(node.props?.children); } }; return visit(tree); };
  return { pump, alerts, find, calls: () => recoverCalls, button: () => find(node => node.props?.accessibilityLabel === 'Recuperar rascunhos do backup').props,
    changeOwner: next => { owner = next; dirty = true; }, focus: next => { focused = next; dirty = true; }, native: next => { native = next; dirty = true; }, pushes, creations,
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

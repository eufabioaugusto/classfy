import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
import * as timeline from './timeline.ts';
import * as timelineLayout from './timelineLayout.ts';
import * as history from './editingHistory.ts';

function compile(source, dependencies) {
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}
const interaction = compile(readFileSync(new URL('./editorInteraction.ts', import.meta.url), 'utf8'), { './timeline': timeline });
const take = id => ({ id, uri: `file:///${id}.mp4`, name: id, duration: 10, start: 2, end: 8 });
const source = readFileSync(new URL('../../../app/studio/[id].tsx', import.meta.url), 'utf8') + '\nexport { ProjectEditor };';

function harness(takes = [take('a'), take('b')]) {
  let project = { id: 'project', ownerId: 'owner', kind: 'aula', version: 1, revision: 1, state: 'draft', takes,
    title: '', objective: '', audience: '', script: '' };
  const slots = [];
  const alerts = [];
  let cursor = 0;
  let effects = [];
  let dirty = true;
  let tree;
  let nativePlayback;
  let nativeActive;
  let nativeTakeId = takes[0]?.id;
  let navigationHandler;
  let save;
  let ids = 0;
  const equals = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; },
    useState: initial => {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useCallback: (callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || !equals(slots[index].dependencies, dependencies)) slots[index] = { value: callback, dependencies };
      return slots[index].value;
    },
    useEffect: (callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || !equals(slots[index].dependencies, dependencies)) effects.push({ index, callback, dependencies });
    },
  };
  const preview = { seeks: [], pauses: 0, pause() { this.pauses += 1; }, previewSourceFrame() {}, togglePlayback() {},
    seek(position, frame) {
      this.seeks.push({ position, frame });
      if (frame.takeId !== nativeTakeId) nativeActive?.(frame.takeId);
      nativeTakeId = frame.takeId;
      nativePlayback?.({ position, sourcePosition: frame.seconds, takeId: frame.takeId, playing: false, loading: false });
    } };
  const jsx = (type, props) => {
    if (type === 'preview') { props.ref.current = preview; nativePlayback = props.onPlaybackState; nativeActive = props.onActiveTakeChange; }
    return { type, props };
  };
  const native = { ActivityIndicator: 'spinner', Alert: { alert: (...args) => alerts.push(args) }, KeyboardAvoidingView: 'keyboard',
    Platform: { OS: 'ios' }, Pressable: 'button', ScrollView: 'scroll', Text: 'text', View: 'view',
    StyleSheet: { create: styles => styles, absoluteFillObject: {} }, useWindowDimensions: () => ({ width: 390, height: 844 }) };
  const toolIcons = Object.fromEntries('ArrowDown ArrowUp Check ChevronRight Copy FileText Film Maximize2 Mic Minimize2 Pause Pencil Play Scissors Redo2 Split Trash2 Undo2 Upload Video X'.split(' ').map(name => [name, name]));
  const editor = compile(source, {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { useLocalSearchParams: () => ({}), useRouter: () => ({ canGoBack: () => true, back() {}, push() {}, replace() {} }) },
    '@react-navigation/native': { useIsFocused: () => true, useNavigation: () => ({ setOptions() {}, dispatch() {} }), usePreventRemove: (_, callback) => { navigationHandler = callback; } },
    'expo-status-bar': { StatusBar: 'status' }, 'expo-crypto': { randomUUID: () => `new-${++ids}` },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 54, bottom: 34, left: 0, right: 0 }) },
    'lucide-react-native': toolIcons,
    '@/components/AppScreen': { AppScreen: 'screen' }, '@/components/NavigationHeader': { NavigationHeader: 'header' },
    '@/components/SheetModal': { SheetCloseButton: 'close', SheetModal: 'sheet', sheetStyles: {} },
    '@/features/auth/authContext': { useAuth: () => ({ user: { id: 'owner' } }) }, '@/theme/colors': { colors: {} },
    '@/features/studio/useStudioProjects': { useStudioProject: () => ({ project }) },
    '@/features/studio/useStudioOrientation': { useStudioOrientation: () => ({ orientationReady: true }) },
    '@/features/studio/media': {},
    '@/features/studio/store': { discardTransientStudioProject: async () => undefined, getStudioProject: () => project,
      isTransientStudioProject: () => false,
      mutateStudioProject: async (_, __, change) => {
        const patch = change(project);
        project = { ...project, ...patch, revision: project.revision + 1 }; dirty = true;
        // Store notification reaches React before the caller's await resumes.
        await new Promise((resolve, reject) => { save = { resolve, reject }; });
        return project;
      } },
    '@/features/studio/timeline': timeline, '@/features/studio/model': model,
    '@/features/studio/StudioPreview': { StudioPreview: 'preview' }, '@/features/studio/StudioTimeline': { StudioTimeline: 'timeline' },
    '@/features/studio/editingHistory': history, '@/features/studio/editorInteraction': interaction,
    '@/features/studio/timelineLayout': timelineLayout,
    '@/features/studio/StudioUI': { StudioAccess: 'access', StudioButton: 'studio-button', StudioField: 'field', StudioLoading: 'loading', StudioSaveStatus: 'save-status', studioStyles: {},
      useStudioFields: () => ({ fields: project, setField() {}, flush: async () => project, saving: false, saveError: null }) },
  }).ProjectEditor;
  const render = () => {
    dirty = false; cursor = 0; effects = [];
    tree = editor({ project, update: async () => project });
    for (const effect of effects) {
      slots[effect.index]?.cleanup?.();
      slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() };
    }
  };
  const pump = async () => {
    for (let pass = 0; pass < 30; pass += 1) {
      if (dirty) render();
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty) return;
    }
    throw new Error('Editor render did not settle');
  };
  const find = predicate => {
    const visit = node => {
      if (Array.isArray(node)) { for (const child of node) { const found = visit(child); if (found) return found; } return; }
      if (!node || typeof node !== 'object') return;
      if (predicate(node)) return node;
      return visit(node.props?.children);
    };
    const found = visit(tree);
    assert.ok(found, 'editor element expected');
    return found;
  };
  const timelineProps = () => find(node => node.type === 'timeline').props;
  const previewProps = () => find(node => node.type === 'preview').props;
  return { preview, alerts, pump, timelineProps, previewProps,
    publish: (state, updateActive = true) => {
      if (updateActive && state.takeId !== nativeTakeId) nativeActive?.(state.takeId);
      nativeTakeId = state.takeId; nativePlayback(state);
    },
    tool: label => find(node => node.props?.label === label).props,
    finishSave: () => { assert.ok(save); save.resolve(); },
    back: () => navigationHandler({ data: { action: { type: 'GO_BACK' } } }),
    project: () => project,
    dispose: () => { for (const slot of slots) slot?.cleanup?.(); } };
}

test('selecionar outro clipe muda ferramentas sem buscar outro tempo ou trocar o take em reprodução', async () => {
  const view = harness();
  try {
    await view.pump();
    view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: true, loading: false }); await view.pump();
    view.timelineProps().onSelect(view.project().takes[1]); await view.pump();
    assert.equal(view.timelineProps().activeTakeId, 'b');
    assert.equal(view.previewProps().activeTakeId, 'a');
    assert.equal(view.timelineProps().position, 3);
    assert.equal(view.preview.seeks.length, 0);
    assert.equal(view.tool('Dividir').disabled, true);
  } finally { view.dispose(); }
});

test('split retém cursor quando novos takes chegam antes do save resolver e restaura o ID direito', async () => {
  const view = harness();
  try {
    await view.pump();
    view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelect(view.project().takes[0]); await view.pump();
    view.tool('Dividir').onPress(); await view.pump();
    assert.equal(view.project().takes[0].id, 'new-1');
    view.publish({ position: 0, sourcePosition: 2, takeId: 'new-1', playing: false, loading: true }, false); await view.pump();
    assert.equal(view.timelineProps().position, 3, 'fallback native event cannot move the saved cursor');
    view.finishSave(); await view.pump();
    assert.equal(view.timelineProps().position, 3);
    assert.deepEqual(view.preview.seeks.at(-1), { position: 3, frame: { takeId: 'new-2', uri: 'file:///a.mp4', seconds: 5 } });
    assert.equal(view.timelineProps().activeTakeId, 'new-2');
    assert.equal(view.previewProps().activeTakeId, 'new-2');
  } finally { view.dispose(); }
});

test('excluir o clipe em reprodução ignora fallback zero e limita a âncora ao fim restante', async () => {
  const view = harness();
  try {
    await view.pump();
    view.publish({ position: 9, sourcePosition: 5, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelect(view.project().takes[1]); await view.pump();
    view.tool('Excluir').onPress();
    view.alerts.at(-1)[2].find(option => option.text === 'Remover').onPress(); await view.pump();
    view.publish({ position: 0, sourcePosition: 2, takeId: 'a', playing: false, loading: true }, false); await view.pump();
    assert.equal(view.timelineProps().position, 9);
    view.finishSave(); await view.pump();
    assert.equal(view.timelineProps().position, 6);
    assert.deepEqual(view.preview.seeks.at(-1), { position: 6, frame: { takeId: 'a', uri: 'file:///a.mp4', seconds: 8 } });
  } finally { view.dispose(); }
});

test('excluir o último take termina em zero mesmo se clear nativo chegou antes da confirmação do save', async () => {
  const view = harness([take('a')]);
  try {
    await view.pump();
    view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelect(view.project().takes[0]); await view.pump();
    view.tool('Excluir').onPress();
    view.alerts.at(-1)[2].find(option => option.text === 'Remover').onPress(); await view.pump();
    view.publish({ position: 0, sourcePosition: 0, playing: false, loading: false }, false); await view.pump();
    assert.equal(view.timelineProps().position, 3);
    view.finishSave(); await view.pump();
    assert.equal(view.timelineProps().position, 0);
    assert.equal(view.timelineProps().takes.length, 0);
    assert.equal(view.previewProps().activeTakeId, undefined);
    assert.equal(view.preview.seeks.length, 0, 'an empty montage has no source to seek');
  } finally { view.dispose(); }
});

test('voltar durante corte cancela a prévia e sinaliza o cancelamento ao gesto interno da timeline', async () => {
  const view = harness();
  try {
    await view.pump();
    view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelect(view.project().takes[1]); await view.pump();
    view.timelineProps().onTrimChange({ takeId: 'b', start: 3, end: 8, previewSourceSeconds: 3 }); await view.pump();
    assert.equal(view.timelineProps().cancelEpoch, 0);
    view.back(); await view.pump();
    assert.equal(view.timelineProps().cancelEpoch, 1);
    assert.deepEqual(view.preview.seeks.at(-1), { position: 3, frame: { takeId: 'a', uri: 'file:///a.mp4', seconds: 5 } });
    assert.equal(view.timelineProps().position, 3);
    assert.equal(view.project().revision, 1, 'cancel must not save the provisional cut');
  } finally { view.dispose(); }
});

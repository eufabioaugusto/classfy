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

function harness(takes = [take('a'), take('b')], options = {}) {
  let project = { id: 'project', ownerId: 'owner', kind: 'aula', version: 1, revision: 1, state: 'draft', takes,
    title: '', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '', createdAt: 'date', updatedAt: 'date', progress: 0 };
  if (options.initialEditing) project = model.withStudioTakes({ ...project, version: 2, editing: options.initialEditing });
  const slots = [];
  const alerts = [];
  const navigationEvents = [];
  let completedWrites = 0;
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
  let mutationFailure;
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
    useMemo: (callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || !equals(slots[index].dependencies, dependencies)) slots[index] = { value: callback(), dependencies };
      return slots[index].value;
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
    Platform: { OS: 'ios' }, Pressable: 'button', ScrollView: 'scroll', FlatList: 'flatlist', Text: 'text', View: 'view',
    StyleSheet: { create: styles => styles, absoluteFillObject: {} }, useWindowDimensions: () => ({ width: 390, height: 844 }) };
  const toolIcons = Object.fromEntries('ArrowDown ArrowUp Check ChevronRight Copy FileText Film Maximize2 Mic Minimize2 Pause Pencil Play Scissors Redo2 Split Trash2 Undo2 Upload Video X'.split(' ').map(name => [name, name]));
  const navigate = (type, destination) => navigationEvents.push({ type, destination, completedWrites, revision: project.revision });
  const editor = compile(source, {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { useLocalSearchParams: () => ({}), useRouter: () => ({ canGoBack: () => true, back: () => navigate('back'), push: destination => navigate('push', destination), replace: destination => navigate('replace', destination) }) },
    '@react-navigation/native': { useIsFocused: () => true, useNavigation: () => ({ setOptions() {}, dispatch: action => navigate('dispatch', action) }), usePreventRemove: (_, callback) => { navigationHandler = callback; } },
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
        if (mutationFailure) { const error = mutationFailure; mutationFailure = undefined; throw error; }
        const editing = patch.editing ?? (project.editing && patch.takes ? model.reconcileStudioTakes(project, patch.takes) : project.editing);
        project = editing ? model.withStudioTakes({ ...project, ...patch, editing, revision: project.revision + 1 }) : { ...project, ...patch, revision: project.revision + 1 }; dirty = true;
        // Store notification reaches React before the caller's await resumes.
        await new Promise((resolve, reject) => { save = { resolve, reject }; });
        completedWrites += 1;
        return project;
      } },
    '@/features/studio/timeline': timeline, '@/features/studio/model': model,
    '@/features/studio/StudioCompositionPreview': { StudioCompositionPreview: 'preview' },
    '@/features/studio/StudioLayerPanel': { StudioLayerPanel: 'layerPanel' },
    '@/features/studio/StudioTreatmentPanel': { StudioTreatmentPanel: 'treatmentPanel' },
    '@/features/studio/captions': {},
    '../../modules/classfy-studio-media': { isStudioCompositionAvailable: () => !!options.advanced },
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
  return { preview, alerts, navigationEvents, pump, timelineProps, previewProps,
    layerProps: () => find(node => node.type === 'layerPanel').props,
    treatmentProps: () => find(node => node.type === 'treatmentPanel').props,
    button: label => find(node => node.props?.accessibilityLabel === label).props,
    hasLayerPanel: () => { try { find(node => node.type === 'layerPanel'); return true; } catch { return false; } },
    hasTreatmentPanel: () => { try { find(node => node.type === 'treatmentPanel'); return true; } catch { return false; } },
    failNextMutation: message => { mutationFailure = new Error(message); },
    externalEditing: editing => { project = model.withStudioTakes({ ...project, editing, revision: project.revision + 1 }); dirty = true; },
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

// A separate hook context represents the actual child panel. The test drives
// its real TextInput callback, rather than directly manufacturing a draft.
function renderLayerPanel(initialProps) {
  const slots = []; let cursor = 0, tree, props = initialProps;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; },
    useState: initial => { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }]; },
  };
  const Panel = compile(readFileSync(new URL('./StudioLayerPanel.tsx', import.meta.url), 'utf8'), {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { Pressable: 'button', ScrollView: 'scroll', Text: 'text', TextInput: 'input', View: 'view', StyleSheet: { create: value => value } },
    'lucide-react-native': Object.fromEntries('Check ChevronDown Minus Plus Trash2'.split(' ').map(name => [name, name])), '@/theme/colors': { colors: {} }, './model': model,
  }).StudioLayerPanel;
  const render = () => { cursor = 0; tree = Panel(props); };
  const input = () => { const visit = node => { if (Array.isArray(node)) { for (const child of node) { const found = visit(child); if (found) return found; } } else if (node && typeof node === 'object') { if (node.type === 'input') return node.props; return visit(node.props?.children); } }; const found = visit(tree); assert.ok(found, 'real layer text input expected'); return found; };
  render();
  return { input, text: value => { input().onChangeText(value); render(); }, updateProps: next => { props = next; render(); } };
}
function editingWithCaptions() {
  const takes = [take('a'), take('b')];
  let editing = model.withStudioStandardOutput(model.reconcileStudioTakes({ kind: 'aula' }, takes));
  editing = model.addStudioLayerItem(editing, { ...model.createStudioTextItem({ id: 'caption', kind: 'caption', content: 'Legenda inicial', durationTicks: model.studioTicks(2) }), anchor: { clipId: 'b', sourceStartTicks: model.studioTicks(3), sourceEndTicks: model.studioTicks(5) } });
  return model.addStudioLayerItem(editing, model.createStudioTextItem({ id: 'other-text', content: 'Outro título', clipId: 'a' }));
}
function appendMediaAndUpdateOtherTitle(project) {
  const editing = model.patchStudioLayerItem(project.editing, 'other-text', { text: { content: 'Título atual, atualizado por outra operação' } });
  const latest = model.withStudioTakes({ ...project, editing });
  return model.reconcileStudioTakes(latest, [...latest.takes, take('c')]);
}
test('texto provisório e arraste de legenda salvam juntos, preservam cursor e desfazem como uma edição', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump();
    view.publish({ position: 9, sourcePosition: 5, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelectLayer('caption'); await view.pump();
    const panel = renderLayerPanel(view.layerProps()); panel.text('Texto preenchido antes de arrastar'); await view.pump();
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Legenda inicial', 'typing previews without writing the project');
    assert.equal(view.timelineProps().position, 9); assert.equal(view.preview.seeks.length, 0);
    // A different current item changed after the panel's snapshot was created.
    // Drag must merge only its own item, never restore a whole stale recipe.
    view.externalEditing(model.patchStudioLayerItem(view.project().editing, 'other-text', { text: { content: 'Outro título atual' } })); await view.pump();
    const moving = view.timelineProps().onMoveLayer('caption', 0.5); await view.pump();
    view.publish({ position: 0, sourcePosition: 2, takeId: 'a', playing: false, loading: true }, false); await view.pump();
    assert.equal(view.timelineProps().position, 9, 'publishing before save resolves cannot reset the cursor');
    view.finishSave(); await moving; await view.pump();
    const saved = view.project().editing.layers.flatMap(layer => layer.items).find(item => item.id === 'caption');
    assert.equal(saved.text.content, 'Texto preenchido antes de arrastar');
    assert.equal(saved.anchor.sourceStartTicks, model.studioTicks(3.5)); assert.equal(saved.anchor.sourceEndTicks, model.studioTicks(5.5));
    assert.equal(view.project().editing.layers.flatMap(layer => layer.items).find(item => item.id === 'other-text').text.content, 'Outro título atual');
    assert.equal(view.timelineProps().position, 9); assert.equal(view.hasLayerPanel(), false);
    view.timelineProps().onSelectLayer('caption'); await view.pump();
    assert.equal(renderLayerPanel(view.layerProps()).input().value, 'Texto preenchido antes de arrastar');
    const undo = view.button('Desfazer edição'); assert.equal(undo.disabled, false); undo.onPress(); await view.pump(); view.finishSave(); await view.pump();
    const restored = view.project().editing.layers.flatMap(layer => layer.items).find(item => item.id === 'caption');
    assert.equal(restored.text.content, 'Legenda inicial'); assert.equal(restored.anchor.sourceStartTicks, model.studioTicks(3));
    assert.equal(view.timelineProps().position, 9); assert.equal(view.hasLayerPanel(), false);
  } finally { view.dispose(); }
});
test('falha ao salvar arraste não perde texto provisório nem rejeita promessa sem tratamento', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.publish({ position: 9, sourcePosition: 5, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelectLayer('caption'); await view.pump();
    const panel = renderLayerPanel(view.layerProps()); panel.text('Texto para tentar novamente'); await view.pump();
    view.failNextMutation('Disco cheio');
    await assert.doesNotReject(view.timelineProps().onMoveLayer('caption', 0.5)); await view.pump();
    assert.equal(view.hasLayerPanel(), true); assert.equal(view.timelineProps().position, 9);
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Legenda inicial'); assert.equal(panel.input().value, 'Texto para tentar novamente');
    assert.ok(view.alerts.some(alert => alert[1].includes('Disco cheio')));
    const retry = view.timelineProps().onMoveLayer('caption', 0.5); await view.pump(); view.finishSave(); await retry; await view.pump();
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Texto para tentar novamente');
  } finally { view.dispose(); }
});

test('Revisar salva o texto visível sem exigir o ✓ e só navega depois da persistência', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.publish({ position: 9, sourcePosition: 5, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelectLayer('caption'); await view.pump();
    const panel = renderLayerPanel(view.layerProps()); panel.text('Texto que precisa chegar à revisão'); await view.pump();
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Legenda inicial');
    assert.equal(view.previewProps().project.editing.layers[0].items[0].text.content, 'Texto que precisa chegar à revisão');
    view.button('Revisar publicação').onPress(); await view.pump();
    assert.deepEqual(view.navigationEvents, [], 'a store notification is not permission to leave before its promise resolves');
    assert.equal(view.button('Revisar publicação').disabled, true);
    assert.equal(view.timelineProps().position, 9);
    view.finishSave(); await view.pump();
    assert.deepEqual(view.navigationEvents, [{ type: 'push', destination: { pathname: '/studio/review', params: { id: 'project' } }, completedWrites: 1, revision: 2 }]);
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Texto que precisa chegar à revisão');
    assert.equal(view.hasLayerPanel(), false);
    assert.equal(view.timelineProps().position, 9);
  } finally { view.dispose(); }
});

test('erro de disco ao abrir Revisar mantém texto e prévia para tentar novamente sem navegar', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.timelineProps().onSelectLayer('caption'); await view.pump();
    const panel = renderLayerPanel(view.layerProps()); panel.text('Não perder este rascunho'); await view.pump();
    view.failNextMutation('Disco cheio'); view.button('Revisar publicação').onPress(); await view.pump();
    assert.deepEqual(view.navigationEvents, []);
    assert.equal(view.project().revision, 1); assert.equal(view.project().editing.layers[0].items[0].text.content, 'Legenda inicial');
    assert.equal(view.hasLayerPanel(), true); assert.equal(panel.input().value, 'Não perder este rascunho');
    assert.equal(view.previewProps().project.editing.layers[0].items[0].text.content, 'Não perder este rascunho');
    assert.ok(view.alerts.some(alert => alert[1].includes('Disco cheio')));
    assert.equal(view.button('Revisar publicação').disabled, false);
    view.button('Revisar publicação').onPress(); await view.pump(); assert.deepEqual(view.navigationEvents, []);
    view.finishSave(); await view.pump();
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Não perder este rascunho');
    assert.equal(view.navigationEvents.length, 1); assert.equal(view.navigationEvents[0].completedWrites, 1);
    assert.equal(view.hasLayerPanel(), false);
  } finally { view.dispose(); }
});

test('Revisar mescla só o texto pendente e preserva camada, original e take recém-adicionados', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.timelineProps().onSelectLayer('caption'); await view.pump();
    const panel = renderLayerPanel(view.layerProps()); panel.text('Legenda visível a confirmar'); await view.pump();
    // A queued operation can publish before React updates the panel's props.
    // Navigation must merge its target into the store's latest document.
    view.externalEditing(appendMediaAndUpdateOtherTitle(view.project()));
    view.button('Revisar publicação').onPress(); await view.pump();
    assert.deepEqual(view.navigationEvents, []);
    view.finishSave(); await view.pump();
    const saved = view.project().editing;
    assert.equal(saved.layers.flatMap(layer => layer.items).find(item => item.id === 'caption').text.content, 'Legenda visível a confirmar');
    assert.equal(saved.layers.flatMap(layer => layer.items).find(item => item.id === 'other-text').text.content, 'Título atual, atualizado por outra operação');
    assert.ok(saved.assets.some(asset => asset.uri === 'file:///c.mp4'), 'navigation cannot drop the latest original asset');
    assert.ok(saved.main.some(clip => clip.id === 'c'), 'navigation cannot replace the latest main sequence with the stale draft');
    assert.equal(view.navigationEvents[0].completedWrites, 1);
  } finally { view.dispose(); }
});

test('voltar pela navegação nativa salva texto pendente antes de redisparar a ação', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.timelineProps().onSelectLayer('caption'); await view.pump();
    const panel = renderLayerPanel(view.layerProps()); panel.text('Texto salvo antes de sair'); await view.pump();
    view.back(); await view.pump(); assert.deepEqual(view.navigationEvents, []);
    view.back(); await view.pump(); assert.deepEqual(view.navigationEvents, [], 'repeated native removal cannot escape the pending write');
    view.finishSave(); await view.pump();
    assert.deepEqual(view.navigationEvents, [{ type: 'dispatch', destination: { type: 'GO_BACK' }, completedWrites: 1, revision: 2 }]);
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Texto salvo antes de sair');
  } finally { view.dispose(); }
});

// Mount the real treatment controls in their own hook context, including the
// effect that publishes/removes preview and the timer used by slider updates.
function renderTreatmentPanel(initialProps) {
  const slots = []; let cursor = 0, tree, props = initialProps, effects = [], dirty = true;
  const equals = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const jsx = (type, props) => ({ type, props });
  const react = {
    useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; },
    useState: initial => {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { const next = typeof value === 'function' ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }];
    },
    useEffect: (callback, dependencies) => { const index = cursor++; if (!slots[index] || !equals(slots[index].dependencies, dependencies)) effects.push({ index, callback, dependencies }); },
  };
  const Panel = compile(readFileSync(new URL('./StudioTreatmentPanel.tsx', import.meta.url), 'utf8'), {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { ActivityIndicator: 'spinner', Pressable: 'button', ScrollView: 'scroll', Text: 'text', View: 'view', StyleSheet: { create: value => value } },
    'lucide-react-native': Object.fromEntries('Check ChevronDown Eye Minus Plus'.split(' ').map(name => [name, name])), '@/theme/colors': { colors: {} }, './model': model,
  }).StudioTreatmentPanel;
  const render = () => {
    for (let pass = 0; pass < 8; pass += 1) {
      dirty = false; cursor = 0; effects = []; tree = Panel(props);
      for (const effect of effects) { slots[effect.index]?.cleanup?.(); slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() }; }
      if (!dirty) return;
    }
    throw new Error('Treatment panel render did not settle');
  };
  const find = predicate => {
    const visit = node => { if (Array.isArray(node)) { for (const child of node) { const found = visit(child); if (found) return found; } } else if (node && typeof node === 'object') { if (predicate(node)) return node; return visit(node.props?.children); } };
    const found = visit(tree); assert.ok(found, 'real treatment control expected'); return found.props;
  };
  render();
  return {
    preset: label => { find(node => node.type === 'button' && node.props.children?.type === 'text' && node.props.children.props.children === label).onPress(); render(); },
    control: label => find(node => node.props?.accessibilityLabel === label),
    updateProps: next => { props = next; render(); },
    dispose: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('Revisar também salva o preset de tratamento visível antes de navegar', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true }); let panel;
  try {
    await view.pump(); view.tool('Imagem').onPress(); await view.pump();
    panel = renderTreatmentPanel(view.treatmentProps()); panel.preset('Studio'); await view.pump();
    assert.equal(view.project().editing.main[0].grade?.preset || 'natural', 'natural');
    assert.equal(view.previewProps().project.editing.main[0].grade.preset, 'studio');
    view.publish({ position: 9, sourcePosition: 5, takeId: 'b', playing: false, loading: false }); await view.pump();
    assert.equal(view.treatmentProps().targetId, 'a', 'scrubbing cannot retarget the open treatment to a different clip');
    view.button('Revisar publicação').onPress(); await view.pump(); assert.deepEqual(view.navigationEvents, []);
    view.finishSave(); await view.pump();
    assert.equal(view.project().editing.main[0].grade.preset, 'studio');
    assert.equal(view.project().editing.main[1].grade?.preset || 'natural', 'natural');
    assert.equal(view.timelineProps().position, 9);
    assert.equal(view.navigationEvents[0].destination.pathname, '/studio/review');
    assert.equal(view.navigationEvents[0].completedWrites, 1); assert.equal(view.hasTreatmentPanel(), false);
  } finally { panel?.dispose(); view.dispose(); }
});

test('Revisar mescla o tratamento do alvo sem substituir camadas e takes atuais', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true }); let panel;
  try {
    await view.pump(); view.tool('Imagem').onPress(); await view.pump();
    panel = renderTreatmentPanel(view.treatmentProps()); panel.preset('Studio'); await view.pump();
    view.externalEditing(appendMediaAndUpdateOtherTitle(view.project()));
    view.button('Revisar publicação').onPress(); await view.pump(); assert.deepEqual(view.navigationEvents, []);
    view.finishSave(); await view.pump();
    const saved = view.project().editing;
    assert.equal(saved.main.find(clip => clip.id === 'a').grade.preset, 'studio');
    assert.equal(saved.layers.flatMap(layer => layer.items).find(item => item.id === 'other-text').text.content, 'Título atual, atualizado por outra operação');
    assert.ok(saved.assets.some(asset => asset.uri === 'file:///c.mp4')); assert.ok(saved.main.some(clip => clip.id === 'c'));
    assert.equal(saved.main.find(clip => clip.id === 'b').grade?.preset || 'natural', 'natural');
    assert.equal(view.navigationEvents[0].completedWrites, 1);
  } finally { panel?.dispose(); view.dispose(); }
});

test('falha ao salvar o tratamento para Revisar preserva o preset provisório e impede a saída', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true }); let panel;
  try {
    await view.pump(); view.tool('Imagem').onPress(); await view.pump();
    panel = renderTreatmentPanel(view.treatmentProps()); panel.preset('Cinema'); await view.pump();
    view.failNextMutation('Não há espaço para salvar'); view.button('Revisar publicação').onPress(); await view.pump();
    assert.deepEqual(view.navigationEvents, []); assert.equal(view.hasTreatmentPanel(), true);
    assert.equal(view.project().editing.main[0].grade?.preset || 'natural', 'natural');
    assert.equal(view.previewProps().project.editing.main[0].grade.preset, 'cinematic');
    assert.ok(view.alerts.some(alert => alert[1].includes('Não há espaço')));
    view.button('Revisar publicação').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.equal(view.project().editing.main[0].grade.preset, 'cinematic');
    assert.equal(view.navigationEvents.length, 1); assert.equal(view.navigationEvents[0].completedWrites, 1);
  } finally { panel?.dispose(); view.dispose(); }
});

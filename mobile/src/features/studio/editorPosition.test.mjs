import { filterCatalogHarness } from './studioLibraryTestSupport.mjs';
const { studioFilterPresets, studioSelectedFilter } = filterCatalogHarness();
import { libraryHarness } from './studioLibraryTestSupport.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
import * as timeline from './timeline.ts';
import * as timelineLayout from './timelineLayout.ts';
import * as history from './editingHistory.ts';
import * as captions from './captions.ts';

function compile(source, dependencies, globals = {}) {
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}
const interaction = compile(readFileSync(new URL('./editorInteraction.ts', import.meta.url), 'utf8'), { './timeline': timeline });
const canvasEditing = compile(readFileSync(new URL('./canvasEditing.ts', import.meta.url), 'utf8'), { './model': model });
const canvasTransformChannel = compile(readFileSync(new URL('./canvasTransformChannel.ts', import.meta.url), 'utf8'), {});
const layerTimeline = compile(readFileSync(new URL('./layerTimelineInteraction.ts', import.meta.url), 'utf8'), { './model': model });
const layerActions = compile(readFileSync(new URL('./layerActions.ts', import.meta.url), 'utf8'), { './model': model, './layerTimelineInteraction': layerTimeline });
const take = id => ({ id, uri: `file:///${id}.mp4`, name: id, duration: 10, start: 2, end: 8 });
const source = readFileSync(new URL('../../../app/studio/[id].tsx', import.meta.url), 'utf8') + '\nexport { ProjectEditor };';
const outputCapabilities = { version: 2, available: true, colorSpace: 'rec709', minimumDimension: 64,
  maximumDimension: 3840, maximumShortDimension: 2160, maximumPixels: 3840 * 2160, arbitraryEvenDimensions: true, supportsHEVC: true,
  resolutions: [{ id: 'hd', width: 1920, height: 1080, codec: 'h264' }, { id: '2k', width: 2560, height: 1440, codec: 'h264' }, { id: '4k', width: 3840, height: 2160, codec: 'h264' }],
  frameRates: [{ numerator: 24, denominator: 1 }, { numerator: 25, denominator: 1 }, { numerator: 30, denominator: 1 }, { numerator: 50, denominator: 1 }, { numerator: 60, denominator: 1 }, { numerator: 24000, denominator: 1001 }, { numerator: 30000, denominator: 1001 }, { numerator: 60000, denominator: 1001 }] };
const oldOutputCapabilities = { ...outputCapabilities, version: 1, minimumDimension: 1080, maximumDimension: 1920,
  maximumShortDimension: 1080, maximumPixels: 1920 * 1080, arbitraryEvenDimensions: false,
  supportsHEVC: false, resolutions: [outputCapabilities.resolutions[0]], frameRates: [{ numerator: 30, denominator: 1 }] };
const take4k = id => ({ ...take(id), width: 3840, height: 2160, frameRate: 60 });

function harness(takes = [take('a'), take('b')], options = {}) {
  let project = { id: 'project', ownerId: 'owner', kind: 'aula', version: 1, revision: 1, state: 'draft', takes,
    title: '', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '', createdAt: 'date', updatedAt: 'date', progress: 0 };
  if (options.initialEditing) project = model.withStudioTakes({ ...project, version: 2, editing: options.initialEditing });
  const slots = [];
  const alerts = [];
  const navigationEvents = [];
  let focused = true;
  let owner = 'owner';
  let completedWrites = 0;
  let attemptedWrites = 0;
  const keyboardListeners = new Map();
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
  const preview = { seeks: [], pauses: 0, toggles: 0, pause() { this.pauses += 1; }, previewSourceFrame() {}, togglePlayback() { this.toggles += 1; },
    seek(position, frame) {
      if (!frame) {
        const location = timeline.locateStudioTime(project.takes, position);
        if (!location) return;
        frame = { takeId: location.takeId, uri: location.take.uri, seconds: location.sourceSeconds };
      }
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
    Keyboard: { addListener: (name, callback) => { const values = keyboardListeners.get(name) || new Set(); values.add(callback); keyboardListeners.set(name, values); return { remove: () => values.delete(callback) }; },
      dismiss: () => { for (const callback of keyboardListeners.get('keyboardDidHide') || []) callback(); } },
    Platform: { OS: 'ios' }, Pressable: 'button', ScrollView: 'scroll', FlatList: 'flatlist', Text: 'text', View: 'view',
    StyleSheet: { create: styles => styles, absoluteFillObject: {} }, useWindowDimensions: () => ({ width: 390, height: 844 }) };
  const toolIcons = Object.fromEntries('ArrowDown ArrowUp Blend Check ChevronDown ChevronUp ChevronLeft ChevronRight Copy FileText Film Maximize2 Mic Minimize2 Pause Pencil Play Scissors Redo2 Split Trash2 Undo2 Upload Video X ImagePlus Layers Music Captions SlidersHorizontal Type'.split(' ').map(name => [name, name]));
  const navigate = (type, destination) => navigationEvents.push({ type, destination, completedWrites, revision: project.revision });
  const editor = compile(source, {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'react-native-reanimated': { useSharedValue: initial => hooks.useRef({ value: initial }).current },
    'expo-router': { useLocalSearchParams: () => ({}), useRouter: () => ({ canGoBack: () => true, back: () => navigate('back'), push: destination => navigate('push', destination), replace: destination => navigate('replace', destination) }) },
    '@react-navigation/native': { useIsFocused: () => focused, useNavigation: () => ({ setOptions() {}, dispatch: action => navigate('dispatch', action) }), usePreventRemove: (_, callback) => { navigationHandler = callback; } },
    'expo-status-bar': { StatusBar: 'status' }, 'expo-crypto': { randomUUID: () => `new-${++ids}` },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 54, bottom: 34, left: 0, right: 0 }) },
    'lucide-react-native': toolIcons,
    '@/components/AppScreen': { AppScreen: 'screen' }, '@/components/NavigationHeader': { NavigationHeader: 'header' },
    '@/components/SheetModal': { SheetCloseButton: 'close', SheetModal: 'sheet', sheetStyles: {} },
    '@/features/auth/authContext': { useAuth: () => ({ user: { id: owner } }) }, '@/theme/colors': { colors: {} },
    '@/features/studio/useStudioProjects': { useStudioProject: () => ({ project }) },
    '@/features/studio/useStudioOrientation': { useStudioOrientation: () => ({ orientationReady: true }) },
    '@/features/studio/media': { importStudioLayer: options.importLayer, importStudioMedia: options.importMedia || (async () => []), importStudioCaptionFile: options.importCaptions },
    '@/features/studio/store': { discardTransientStudioProject: async () => undefined, getStudioProject: () => project,
      isTransientStudioProject: () => false,
      mutateStudioProject: async (_, __, change) => {
        attemptedWrites += 1;
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
    '@/features/studio/StudioCanvasEditor': { StudioCanvasEditor: 'canvas-editor' },
    '@/features/studio/canvasEditing': canvasEditing,
    '@/features/studio/canvasTransformChannel': canvasTransformChannel,
    '@/features/studio/layerTimelineInteraction': layerTimeline,
    '@/features/studio/layerActions': layerActions,
    '@/features/studio/StudioVoiceoverPanel': { StudioVoiceoverPanel: 'voiceoverPanel' },
    '@/features/studio/StudioClipPanel': { StudioClipPanel: 'clipPanel' },
    '@/features/studio/StudioLayerPanel': { StudioLayerPanel: 'layerPanel' },
    '@/features/studio/StudioTreatmentPanel': { StudioTreatmentPanel: 'treatmentPanel' },
    '@/features/studio/captions': captions,
    '../../modules/classfy-studio-media': { isStudioCompositionAvailable: () => !!options.advanced,
      isStudioEditorToolsAvailable: () => !!options.editorTools, isStudioFilterPreviewAvailable: () => false,
      getMediaInfoAsync: options.mediaInfo || (async () => ({ hasAudio: true })),
      getStudioExportCapabilitiesAsync: options.outputCapabilities || (async () => outputCapabilities),
      getStudioTranscriptionCapabilitiesAsync: options.capabilities,
      installStudioTranscriptionModelAsync: options.installModel,
      transcribeStudioAsync: options.transcribe,
      cancelStudioTranscriptionAsync: options.cancelTranscription || (async () => undefined) },
    '@/features/studio/StudioPreview': { StudioPreview: 'preview' }, '@/features/studio/StudioTimeline': { StudioTimeline: 'timeline' },
    '@/features/studio/editingHistory': history, '@/features/studio/editorInteraction': interaction,
    '@/features/studio/timelineLayout': timelineLayout,
    '@/features/studio/StudioUI': { StudioAccess: 'access', StudioButton: 'studio-button', StudioField: 'field', StudioLoading: 'loading', StudioSaveStatus: 'save-status', studioStyles: {},
      useStudioFields: () => ({ fields: project, setField() {}, flush: async () => { await options.flush?.(); return project; }, saving: false, saveError: null }) },
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
    focus: value => { focused = value; dirty = true; },
    owner: value => { owner = value; dirty = true; },
    canvasProps: () => find(node => node.type === 'canvas-editor').props,
    keyboard: visible => { for (const callback of keyboardListeners.get(visible ? 'keyboardDidShow' : 'keyboardDidHide') || []) callback(); },
    keyboardProps: () => find(node => node.type === 'keyboard').props,
    hasTimeline: () => { try { find(node => node.type === 'timeline'); return true; } catch { return false; } },
    writes: () => ({ attempted: attemptedWrites, completed: completedWrites }),
    layerProps: () => find(node => node.type === 'layerPanel').props,
    voiceoverProps: () => find(node => node.type === 'voiceoverPanel').props,
    clipProps: () => find(node => node.type === 'clipPanel').props,
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
  const slots = []; let cursor = 0, tree, props = initialProps, effects = [], dirty = true, focused = 0, frameId = 0;
  const frames = new Map();
  const equals = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const jsx = (type, props) => {
    if (type === 'input' && props.ref) props.ref.current = { focus: () => { focused += 1; } };
    return { type, props };
  };
  const react = {
    useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; },
    useState: initial => { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, value => { const next = typeof value === 'function' ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useEffect: (callback, dependencies) => { const index = cursor++; if (!slots[index] || !equals(slots[index].dependencies, dependencies)) effects.push({ index, callback, dependencies }); },
  };
  const Panel = compile(readFileSync(new URL('./StudioLayerPanel.tsx', import.meta.url), 'utf8'), {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { ActivityIndicator: 'spinner', Pressable: 'button', ScrollView: 'scroll', Text: 'text', TextInput: 'input', View: 'view', StyleSheet: { create: value => value } },
    'lucide-react-native': Object.fromEntries('AlignCenter AlignLeft AlignRight ArrowLeft Bold Check Copy Italic Pencil Scissors SlidersHorizontal Trash2 Type Volume2 Blend Bookmark Search Sparkles Gauge FlipHorizontal2'.split(' ').map(name => [name, name])), '@/theme/colors': { colors: {} }, '../../../modules/classfy-studio-media': { getStudioEnhancementCapabilitiesAsync: async () => ({available:false}) }, './autoEnhance': {}, './sceneTreatments': {}, './textLibrary': libraryHarness(), './filterCatalog': { studioFilterPresets, studioSelectedFilter }, './filterPreviews': { prepareStudioFilterPreviews: () => () => {} }, '@/components/LoadingImage': { LoadingImage: 'image' }, './model': model, './StudioControlSlider': { StudioControlSlider: 'slider' },
  }, { requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame: id => frames.delete(id) }).StudioLayerPanel;
  const render = () => {
    for (let pass = 0; pass < 8; pass += 1) {
      dirty = false; cursor = 0; effects = []; tree = Panel(props);
      for (const effect of effects) { slots[effect.index]?.cleanup?.(); slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() }; }
      if (!dirty) return;
    }
    throw new Error('Layer panel render did not settle');
  };
  const findControl = label => { const visit = node => { if (Array.isArray(node)) { for (const child of node) { const result = visit(child); if (result) return result; } } else if (node && typeof node === 'object') { if (node.props?.accessibilityLabel === label) return node.props; return visit(node.props?.children); } }; return visit(tree); };
  const input = () => { const visit = node => { if (Array.isArray(node)) { for (const child of node) { const found = visit(child); if (found) return found; } } else if (node && typeof node === 'object') { if (node.type === 'input') return node.props; return visit(node.props?.children); } }; let found = visit(tree); if (!found && findControl('Editar texto')) { findControl('Editar texto').onPress(); render(); found = visit(tree); } assert.ok(found, 'real layer text input expected'); return found; };
  render();
  return { input, control: label => { const control = findControl(label); assert.ok(control, `Control ${label} expected`); return { ...control, onPress: () => { control.onPress(); render(); } }; }, text: value => { input().onChangeText(value); render(); findControl('Voltar às ferramentas da camada')?.onPress(); render(); }, textValue: () => { const wasEditing = !!findControl('Voltar às ferramentas da camada'); const value = input().value; if (!wasEditing) { findControl('Voltar às ferramentas da camada')?.onPress(); render(); } return value; }, updateProps: next => { props = next; render(); },
    focusCount: () => focused, flushFrames: () => { for (const callback of frames.values()) callback(); frames.clear(); },
    dispose: () => { for (const slot of slots) slot?.cleanup?.(); } };
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
test('hold move tempo e faixa em uma edição e um undo restaura ambos sem mover cursor', async () => {
  const initial = editingWithCaptions();
  const view = harness(undefined, { initialEditing: initial, advanced: true });
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelectLayer('caption'); await view.pump();
    const timeline = view.timelineProps(); timeline.onLayerInteractionStart();
    const saving = timeline.onMoveLayer('caption', 0.5, 2); await view.pump();
    view.finishSave(); await saving; timeline.onLayerInteractionEnd(); await view.pump();
    assert.equal(view.project().editing.layers[1].items[0].id, 'caption');
    assert.equal(view.project().editing.layers[1].items[0].anchor.sourceStartTicks, model.studioTicks(3.5));
    assert.equal(view.timelineProps().position, 8); assert.deepEqual(view.writes(), { attempted: 1, completed: 1 });
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(view.project().editing.layers, initial.layers); assert.equal(view.timelineProps().position, 8);
  } finally { view.dispose(); }
});

test('hold mantém cursor antes de qualquer preview de duração e libera os controles ao cancelar', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelectLayer('caption'); await view.pump();
    const timeline = view.timelineProps(); timeline.onLayerInteractionStart();
    view.publish({ position: 0, sourcePosition: 2, takeId: 'a', playing: false, loading: true }, false); await view.pump();
    assert.equal(view.timelineProps().position, 8); assert.equal(view.button('Revisar publicação').disabled, true);
    timeline.onLayerInteractionEnd(); await view.pump();
    assert.equal(view.button('Revisar publicação').disabled, false); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
  } finally { view.dispose(); }
});

test('falha ao mover faixa mantém tempo e ordem recuperáveis no Confirmar sem sobrescrever outros itens', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelectLayer('caption'); await view.pump();
    const timeline = view.timelineProps(); timeline.onLayerInteractionStart();
    view.failNextMutation('Disco cheio');
    await assert.rejects(timeline.onMoveLayer('caption', 0.5, 2), /ainda não foi salva/);
    timeline.onLayerInteractionEnd(); await view.pump();
    assert.equal(view.project().editing.layers[0].items[0].id, 'caption');
    assert.equal(view.previewProps().project.editing.layers[1].items[0].id, 'caption');
    const latest = model.patchStudioLayerItem(view.project().editing, 'other-text', { text: { content: 'Outro item atualizado durante a tentativa' } });
    view.externalEditing(latest); await view.pump();
    const saving = view.layerProps().onApply(view.layerProps().editing); await view.pump();
    view.finishSave(); await saving; await view.pump();
    assert.equal(view.project().editing.layers[1].items[0].id, 'caption');
    assert.equal(view.project().editing.layers[1].items[0].anchor.sourceStartTicks, model.studioTicks(3.5));
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Outro item atualizado durante a tentativa');
    assert.equal(view.timelineProps().position, 8); assert.equal(view.hasLayerPanel(), false);
    assert.deepEqual(view.writes(), { attempted: 2, completed: 1 });
  } finally { view.dispose(); }
});
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
    assert.equal(view.timelineProps().position, 9); assert.equal(view.hasLayerPanel(), true, 'direct manipulation keeps the selected element editable');
    assert.equal(renderLayerPanel(view.layerProps()).textValue(), 'Texto preenchido antes de arrastar');
    const undo = view.button('Desfazer edição'); assert.equal(undo.disabled, false); undo.onPress(); await view.pump(); view.finishSave(); await view.pump();
    const restored = view.project().editing.layers.flatMap(layer => layer.items).find(item => item.id === 'caption');
    assert.equal(restored.text.content, 'Legenda inicial'); assert.equal(restored.anchor.sourceStartTicks, model.studioTicks(3));
    assert.equal(view.timelineProps().position, 9); assert.equal(view.hasLayerPanel(), false);
  } finally { view.dispose(); }
});
test('falha ao salvar arraste preserva texto provisório e informa o erro ao gesto que pediu a escrita', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.publish({ position: 9, sourcePosition: 5, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelectLayer('caption'); await view.pump();
    const panel = renderLayerPanel(view.layerProps()); panel.text('Texto para tentar novamente'); await view.pump();
    view.failNextMutation('Disco cheio');
    await assert.rejects(view.timelineProps().onMoveLayer('caption', 0.5), /ainda não foi salva/); await view.pump();
    assert.equal(view.hasLayerPanel(), true); assert.equal(view.timelineProps().position, 9);
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Legenda inicial'); assert.equal(panel.textValue(), 'Texto para tentar novamente');
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
    assert.equal(view.hasLayerPanel(), true); assert.equal(panel.textValue(), 'Não perder este rascunho');
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
    'lucide-react-native': Object.fromEntries('ArrowLeft Check Eye Sparkles Sun Contrast Droplets Thermometer Ban'.split(' ').map(name => [name, name])), '@/theme/colors': { colors: {} }, '../../../modules/classfy-studio-media': { getStudioEnhancementCapabilitiesAsync: async () => ({available:false}) }, './autoEnhance': {}, './sceneTreatments': {}, './textLibrary': libraryHarness(), './filterCatalog': { studioFilterPresets, studioSelectedFilter }, './filterPreviews': { prepareStudioFilterPreviews: () => () => {} }, '@/components/LoadingImage': { LoadingImage: 'image' }, './model': model, './StudioControlSlider': { StudioControlSlider: 'slider' },
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
    preset: label => { find(node => node.props?.accessibilityLabel === `Filtro ${label}`).onPress(); render(); },
    control: label => find(node => node.props?.accessibilityLabel === label),
    updateProps: next => { props = next; render(); },
    dispose: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('abrir ajustes da camada pausa a reprodução e mantém o alvo com a timeline recolhida', async () => {
  const editing = model.addStudioLayerItem(editingWithCaptions(), {
    id: 'overlay', kind: 'image', assetId: 'photo', atTicks: 0, durationTicks: model.studioTicks(6),
    rect: { x: .1, y: .1, width: .3, height: .3 },
  });
  editing.assets.push({ id: 'photo', uri: 'file:///photo.jpg', kind: 'image', width: 100, height: 100 });
  const view = harness(undefined, { initialEditing: editing, advanced: true }); let panel;
  try {
    await view.pump(); view.canvasProps().onSelectLayer('overlay'); await view.pump();
    view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: true, loading: false }); await view.pump();
    const pauses = view.preview.pauses;
    await view.layerProps().onTreatment(); await view.pump();
    assert.equal(view.preview.pauses, pauses + 1);
    assert.equal(view.hasTimeline(), false); assert.equal(view.previewProps().paused, true);
    assert.equal(view.treatmentProps().targetId, 'overlay');
    panel = renderTreatmentPanel(view.treatmentProps()); panel.control('Filtros').onPress(); panel.updateProps(view.treatmentProps());
    panel.preset('Cinema'); await view.pump();
    assert.equal(view.previewProps().project.editing.layers.flatMap(lane => lane.items).find(item => item.id === 'overlay').grade.preset, 'cinematic');
    assert.equal(view.project().editing.layers.flatMap(lane => lane.items).find(item => item.id === 'overlay').grade, undefined);
    view.treatmentProps().onClose(); await view.pump();
    assert.equal(view.hasTimeline(), true); assert.equal(view.timelineProps().position, 3);
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
  } finally { panel?.dispose(); view.dispose(); }
});

test('Revisar também salva o preset de tratamento visível antes de navegar', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true }); let panel;
  try {
    await view.pump(); view.tool('Filtros').onPress(); await view.pump();
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
    await view.pump(); view.tool('Filtros').onPress(); await view.pump();
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
    await view.pump(); view.tool('Filtros').onPress(); await view.pump();
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

test('texto digitado e transform do canvas salvam juntos sem perder cursor e formam uma única edição no histórico', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.canvasProps().onSelectLayer('caption'); await view.pump();
    assert.equal(view.preview.seeks.length, 0, 'canvas selection cannot seek');
    const original = structuredClone(view.project().editing.layers[0].items[0]);
    const panel = renderLayerPanel(view.layerProps()); panel.text('Texto digitado, depois redimensionado'); await view.pump();
    const canvas = view.canvasProps(), transform = { rect: { x: 0.2, y: 0.35, width: 0.5, height: 0.3 }, textFontSize: 0.07 };
    canvas.onInteractionStart(); canvas.onPreviewRect('caption', transform); await view.pump();
    view.publish({ position: 0, sourcePosition: 2, takeId: 'a', playing: false, loading: true }, false); await view.pump();
    assert.equal(view.timelineProps().position, 8);
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
    assert.equal(view.layerProps().item.text.content, 'Texto digitado, depois redimensionado');
    assert.deepEqual(view.layerProps().item.rect, transform.rect);
    const saving = canvas.onCommitRect('caption', transform); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 1, completed: 0 });
    view.finishSave(); await saving; canvas.onPreviewRect('caption', undefined); canvas.onInteractionEnd(); await view.pump();
    const saved = view.project().editing.layers[0].items[0];
    assert.equal(saved.text.content, 'Texto digitado, depois redimensionado'); assert.equal(saved.text.fontSize, 0.07); assert.deepEqual(saved.rect, transform.rect);
    assert.equal(view.hasLayerPanel(), true); assert.equal(renderLayerPanel(view.layerProps()).textValue(), saved.text.content);
    assert.equal(view.timelineProps().position, 8); assert.deepEqual(view.writes(), { attempted: 1, completed: 1 });
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(view.project().editing.layers[0].items[0], original, 'one undo restores text, font and frame together');
    assert.equal(view.button('Desfazer edição').disabled, true); assert.equal(view.button('Refazer edição').disabled, false);
  } finally { view.dispose(); }
});

test('redimensionar vídeo principal preserva originais, cortes, perfil e fonte em reprodução', async () => {
  const editing = editingWithCaptions();
  editing.assets[0] = { ...editing.assets[0], width: 3840, height: 2160, frameRate: 60, sourceKind: 'standard', sourceStage: 'standard', colorSpace: 'rec709', thumbnailUri: 'file:///original-cover.jpg' };
  const portable = value => JSON.parse(JSON.stringify(value));
  const view = harness(undefined, { initialEditing: editing, advanced: true });
  try {
    await view.pump(); view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump();
    const originals = portable(view.project().editing.assets), source = portable(view.project().takes[0]);
    view.canvasProps().onSelectMainClip('a'); await view.pump();
    assert.equal(view.canvasProps().selectedMainClipId, 'a'); assert.equal(view.preview.seeks.length, 0);
    const canvas = view.canvasProps(), transform = { rect: { x: -0.25, y: 0.1, width: 1.4, height: 1.4 } };
    canvas.onInteractionStart(); canvas.onPreviewRect('a', transform); await view.pump();
    const saving = canvas.onCommitRect('a', transform); await view.pump(); view.finishSave(); await saving;
    canvas.onPreviewRect('a', undefined); canvas.onInteractionEnd(); await view.pump();
    assert.deepEqual(view.project().editing.main[0].rect, transform.rect); assert.equal(view.project().editing.main[1].rect, undefined);
    assert.deepEqual(portable(view.project().editing.assets), originals); assert.deepEqual(portable(view.project().takes[0]), source);
    assert.equal(view.project().editing.output.profile, 'standard'); assert.equal(view.timelineProps().position, 3);
    assert.deepEqual(view.writes(), { attempted: 1, completed: 1 });
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.equal(view.project().editing.main[0].rect, undefined); assert.deepEqual(portable(view.project().editing.assets), originals);
  } finally { view.dispose(); }
});

test('erro de disco em main mantém draft e alvo ao Concluir ou abrir tratamento, e o retry salva antes de sair da seleção', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.canvasProps().onSelectMainClip('a'); await view.pump();
    const canvas = view.canvasProps(), transform = { rect: { x: 0.2, y: 0.15, width: 0.65, height: 0.65 } };
    canvas.onInteractionStart(); canvas.onPreviewRect('a', transform); await view.pump();
    view.failNextMutation('Disco cheio'); await assert.rejects(canvas.onCommitRect('a', transform), /Disco cheio/);
    canvas.onPreviewRect('a', undefined); canvas.onInteractionEnd(); await view.pump();
    assert.equal(view.canvasProps().selectedMainClipId, 'a'); assert.deepEqual(view.previewProps().project.editing.main[0].rect, transform.rect);
    assert.equal(view.project().editing.main[0].rect, undefined); assert.equal(view.button('Desfazer edição').disabled, true);
    view.failNextMutation('Ainda sem espaço'); view.tool('Voltar').onPress(); await view.pump();
    assert.equal(view.canvasProps().selectedMainClipId, 'a'); assert.deepEqual(view.previewProps().project.editing.main[0].rect, transform.rect);
    view.failNextMutation('Ainda sem espaço'); view.tool('Filtros').onPress(); await view.pump();
    assert.equal(view.hasTreatmentPanel(), false); assert.equal(view.canvasProps().selectedMainClipId, 'a');
    assert.deepEqual(view.previewProps().project.editing.main[0].rect, transform.rect); assert.deepEqual(view.writes(), { attempted: 3, completed: 0 });
    view.tool('Voltar').onPress(); await view.pump(); assert.equal(view.tool('Voltar').disabled, true);
    view.finishSave(); await view.pump();
    assert.deepEqual(view.project().editing.main[0].rect, transform.rect); assert.equal(view.canvasProps().selectedMainClipId, undefined);
    assert.deepEqual(view.writes(), { attempted: 4, completed: 1 }); assert.deepEqual(view.navigationEvents, []);
  } finally { view.dispose(); }
});

for (const gesture of ['canvas', 'layer']) test(`gesto ${gesture} bloqueia Divide, duplicate e navegação mesmo antes de renderizar o estado de ocupado`, async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump();
    view.canvasProps().onSelectMainClip('a'); await view.pump();
    // These closures model an already queued touch. The ref guard must work
    // even when React has not rendered disabled=true yet.
    const divide = view.tool('Dividir'), duplicate = view.tool('Duplicar'), review = view.button('Revisar publicação');
    const callbacks = gesture === 'canvas' ? view.canvasProps() : view.timelineProps();
    if (gesture === 'canvas') callbacks.onInteractionStart(); else callbacks.onLayerInteractionStart();
    divide.onPress(); duplicate.onPress(); review.onPress(); view.back(); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.deepEqual(view.navigationEvents, []);
    assert.equal(view.project().takes.length, 2); assert.equal(view.tool('Dividir').disabled, true); assert.equal(view.tool('Duplicar').disabled, true);
    assert.equal(view.button('Revisar publicação').disabled, true);
    if (gesture === 'canvas') callbacks.onInteractionEnd(); else callbacks.onLayerInteractionEnd();
    await view.pump(); assert.equal(view.button('Revisar publicação').disabled, false);
    view.button('Revisar publicação').onPress(); await view.pump(); assert.equal(view.navigationEvents.length, 1);
  } finally { view.dispose(); }
});

test('borda temporal salva texto visível e source anchor juntos sem mover cursor nem gerar múltiplas escritas', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.canvasProps().onSelectLayer('caption'); await view.pump();
    const original = structuredClone(view.project().editing.layers[0].items[0]);
    const panel = renderLayerPanel(view.layerProps()); panel.text('Legenda digitada antes de definir a duração'); await view.pump();
    const timeline = view.timelineProps(); timeline.onLayerInteractionStart();
    timeline.onLayerTrimPreview('caption', { startSeconds: 7, endSeconds: 9.2 });
    timeline.onLayerTrimPreview('caption', { startSeconds: 7, endSeconds: 9.5 }); await view.pump();
    view.publish({ position: 0, sourcePosition: 2, takeId: 'a', playing: false, loading: true }, false); await view.pump();
    assert.equal(view.timelineProps().position, 8); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
    const saving = timeline.onLayerTrimCommit('caption', { startSeconds: 7, endSeconds: 9.5 }); await view.pump();
    view.finishSave(); await saving; timeline.onLayerInteractionEnd(); await view.pump();
    const saved = view.project().editing.layers[0].items[0];
    assert.equal(saved.text.content, 'Legenda digitada antes de definir a duração');
    assert.equal(saved.anchor.sourceStartTicks, model.studioTicks(3)); assert.equal(saved.anchor.sourceEndTicks, model.studioTicks(5.5));
    assert.equal(saved.durationTicks, model.studioTicks(2.5)); assert.equal(view.timelineProps().position, 8);
    assert.deepEqual(view.writes(), { attempted: 1, completed: 1 }); assert.equal(view.hasLayerPanel(), true);
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(view.project().editing.layers[0].items[0], original);
    assert.equal(view.button('Desfazer edição').disabled, true);
  } finally { view.dispose(); }
});

test('cancelar canvas restaura apenas o transform e preserva texto que já estava sendo digitado', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.canvasProps().onSelectLayer('caption'); await view.pump();
    const panel = renderLayerPanel(view.layerProps()); panel.text('Texto anterior ao gesto cancelado'); await view.pump();
    const originalRect = structuredClone(view.layerProps().item.rect);
    const canvas = view.canvasProps(); canvas.onInteractionStart();
    canvas.onPreviewRect('caption', { rect: { x: 0.4, y: 0.4, width: 0.3, height: 0.3 }, textFontSize: 0.08 }); await view.pump();
    canvas.onPreviewRect('caption', undefined); canvas.onInteractionEnd(); await view.pump();
    assert.deepEqual(view.layerProps().item.rect, originalRect); assert.equal(view.layerProps().item.text.content, 'Texto anterior ao gesto cancelado');
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.equal(view.canvasProps().disabled, false);
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Legenda inicial');
  } finally { view.dispose(); }
});

test('double tap solicita foco do TextInput real sem seek, salva ou limpa texto; teclado mantém edição disponível', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true }); let panel;
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.canvasProps().onSelectLayer('caption'); await view.pump();
    panel = renderLayerPanel(view.layerProps()); panel.text('Conteúdo mantido no double tap'); await view.pump();
    view.canvasProps().onEditText('caption'); await view.pump(); panel.updateProps(view.layerProps()); panel.flushFrames();
    assert.equal(panel.focusCount(), 1); assert.equal(panel.textValue(), 'Conteúdo mantido no double tap');
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.equal(view.preview.seeks.length, 0);
    view.keyboard(true); await view.pump(); assert.equal(view.hasTimeline(), false); assert.equal(view.keyboardProps().enabled, true);
    assert.equal(view.layerProps().item.text.content, 'Conteúdo mantido no double tap'); assert.equal(view.canvasProps().selectedLayerId, 'caption');
    view.keyboard(false); await view.pump(); assert.equal(view.hasTimeline(), false, 'text options still occupy the timeline area'); panel.control('Voltar às ferramentas da camada').onPress(); await view.pump(); assert.equal(view.hasTimeline(), true); assert.equal(view.timelineProps().position, 8);
  } finally { panel?.dispose(); view.dispose(); }
});

test('double tap foca somente seu texto uma vez; seleção e reabertura não herdam o teclado', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true }); let panel;
  try {
    await view.pump(); view.canvasProps().onEditText('caption'); await view.pump();
    const requested = view.layerProps();
    assert.equal(requested.editTextRequest.id, 'caption');
    panel = renderLayerPanel(requested); panel.flushFrames(); await view.pump();
    assert.equal(panel.focusCount(), 1); assert.equal(view.layerProps().editTextRequest, undefined);
    // A render while editing must not focus twice, and a late completion from
    // the first request cannot consume a newer double tap.
    panel.updateProps(requested); panel.flushFrames(); assert.equal(panel.focusCount(), 1);
    view.canvasProps().onEditText('caption'); await view.pump();
    const next = view.layerProps(); assert.ok(next.editTextRequest.sequence > requested.editTextRequest.sequence);
    requested.onTextEditConsumed(requested.editTextRequest); await view.pump();
    assert.deepEqual(view.layerProps().editTextRequest, next.editTextRequest);
    panel.updateProps(view.layerProps()); panel.flushFrames(); await view.pump(); assert.equal(panel.focusCount(), 2);
    panel.dispose(); panel = undefined;
    view.canvasProps().onSelectLayer('other-text'); await view.pump();
    assert.equal(view.layerProps().editTextRequest, undefined);
    panel = renderLayerPanel(view.layerProps()); panel.flushFrames(); assert.equal(panel.focusCount(), 0);
    panel.dispose(); panel = undefined;
    view.layerProps().onClose(); await view.pump(); view.canvasProps().onSelectLayer('caption'); await view.pump();
    panel = renderLayerPanel(view.layerProps()); panel.flushFrames(); assert.equal(panel.focusCount(), 0);
    assert.equal(view.preview.seeks.length, 0); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
  } finally { panel?.dispose(); view.dispose(); }
});

test('pedido de edição de outro texto não pode abrir o teclado', () => {
  const editing = editingWithCaptions(), item = editing.layers.flatMap(layer => layer.items).find(item => item.id === 'other-text');
  const panel = renderLayerPanel({ editing, item, editTextRequest: { id: 'caption', sequence: 1 } });
  try { panel.flushFrames(); assert.equal(panel.focusCount(), 0); } finally { panel.dispose(); }
});

for (const selected of [false, true]) test(`tap entregue depois do double tap mantém o pedido de teclado, seleção inicial=${selected}`, async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true }); let panel;
  try {
    await view.pump();
    if (selected) { view.canvasProps().onSelectLayer('caption'); await view.pump(); }
    const canvas = view.canvasProps();
    canvas.onEditText('caption'); canvas.onSelectLayer('caption'); await view.pump();
    assert.equal(view.layerProps().editTextRequest.id, 'caption');
    panel = renderLayerPanel(view.layerProps()); panel.flushFrames(); await view.pump();
    assert.equal(panel.focusCount(), 1); assert.equal(view.layerProps().editTextRequest, undefined);
    assert.equal(view.preview.seeks.length, 0); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
  } finally { panel?.dispose(); view.dispose(); }
});


test('sair do editor cancela foco pendente sem perder seleção ou texto visível; voltar não abre teclado', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true }); let panel;
  try {
    await view.pump(); view.canvasProps().onSelectLayer('caption'); await view.pump();
    panel = renderLayerPanel(view.layerProps()); panel.text('Texto ainda em edição'); await view.pump();
    view.canvasProps().onEditText('caption'); await view.pump(); panel.updateProps(view.layerProps());
    view.focus(false); await view.pump(); panel.updateProps(view.layerProps()); panel.flushFrames();
    assert.equal(panel.focusCount(), 0); assert.equal(view.layerProps().disabled, true);
    assert.equal(view.layerProps().editTextRequest, undefined); assert.equal(view.layerProps().item.text.content, 'Texto ainda em edição');
    assert.equal(view.canvasProps().selectedLayerId, 'caption');
    view.focus(true); await view.pump(); panel.updateProps(view.layerProps()); panel.flushFrames();
    assert.equal(panel.focusCount(), 0); assert.equal(view.layerProps().disabled, false);
    assert.equal(panel.textValue(), 'Texto ainda em edição'); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
  } finally { panel?.dispose(); view.dispose(); }
});

for (const outcome of ['cancel', 'error']) test(`importação ${outcome}: segundo toque não libera a sessão que ainda possui o seletor`, async () => {
  let settle, calls = 0;
  const pending = new Promise((resolve, reject) => { settle = outcome === 'cancel' ? () => resolve(null) : () => reject(new Error('Imagem indisponível')); });
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true,
    importLayer: () => { calls += 1; return pending; } });
  try {
    await view.pump(); view.tool('Sobrepor').onPress(); await view.pump();
    const insert = view.tool('Imagem').onPress;
    // Both callbacks were queued before React rendered the disabled state.
    insert(); insert(); await view.pump();
    assert.equal(calls, 1);
    assert.equal(view.tool('Sobrepor').disabled, true);
    assert.equal(view.canvasProps().disabled, true);
    assert.equal(view.timelineProps().busy, true);
    const selection = view.canvasProps().selectedLayerId;
    view.canvasProps().onSelectLayer('caption'); await view.pump();
    assert.equal(view.canvasProps().selectedLayerId, selection);
    view.back(); await view.pump();
    assert.equal(view.navigationEvents.length, 0);
    settle(); await view.pump();
    assert.equal(view.tool('Sobrepor').disabled, false);
    assert.equal(view.canvasProps().disabled, false);
    assert.equal(view.timelineProps().busy, false);
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
    if (outcome === 'error') assert.equal(view.alerts.at(-1)[1], 'Imagem indisponível');
  } finally { view.dispose(); }
});

test('duplicar camada salva o texto provisório e a nova faixa juntos, preserva cursor e permite undo', async () => {
  const initial = editingWithCaptions(), view = harness(undefined, { initialEditing: initial, advanced: true }); let panel;
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelectLayer('caption'); await view.pump();
    panel = renderLayerPanel(view.layerProps()); panel.text('Texto com estilo, salvo na cópia'); await view.pump();
    const operation = view.layerProps().onDuplicate(); await view.pump();
    assert.equal(view.timelineProps().position, 8); view.finishSave(); await operation; await view.pump();
    const copy = view.project().editing.layers.flatMap(layer => layer.items).find(item => item.id === 'new-1');
    assert.equal(copy.text.content, 'Texto com estilo, salvo na cópia');
    assert.equal(view.timelineProps().selectedLayerId, 'new-1');
    assert.deepEqual(copy.anchor, initial.layers[0].items[0].anchor); assert.equal(view.timelineProps().position, 8);
    assert.deepEqual(view.writes(), { attempted: 1, completed: 1 });
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(view.project().editing.layers, initial.layers); assert.equal(view.timelineProps().position, 8);
  } finally { panel?.dispose(); view.dispose(); }
});

test('dividir camada no cursor mantém os dois intervalos e texto com um save e uma etapa de undo', async () => {
  const initial = editingWithCaptions(), view = harness(undefined, { initialEditing: initial, advanced: true }); let panel;
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.canvasProps().onSelectLayer('caption'); await view.pump(); assert.equal(view.layerProps().canSplit, true);
    panel = renderLayerPanel(view.layerProps()); panel.text('Texto preservado nos dois lados'); await view.pump();
    const operation = view.layerProps().onSplit(); await view.pump(); view.finishSave(); await operation; await view.pump();
    const clips = model.compileStudioRecipe(view.project()).clips.filter(clip => clip.id === 'caption' || clip.id === 'new-1');
    assert.deepEqual(clips.map(clip => [clip.startTicks, clip.durationTicks, clip.text.content]), [[model.studioTicks(7), model.studioTicks(1), 'Texto preservado nos dois lados'], [model.studioTicks(8), model.studioTicks(1), 'Texto preservado nos dois lados']]);
    assert.equal(view.timelineProps().position, 8); assert.equal(view.timelineProps().selectedLayerId, 'new-1'); assert.equal(view.layerProps().canSplit, false);
    assert.deepEqual(view.writes(), { attempted: 1, completed: 1 });
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(view.project().editing.layers, initial.layers); assert.equal(view.timelineProps().position, 8);
  } finally { panel?.dispose(); view.dispose(); }
});

test('ações de camada enfileiradas durante gesto não duplicam nem dividem', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.canvasProps().onSelectLayer('caption'); await view.pump();
    const panel = view.layerProps(); view.timelineProps().onLayerInteractionStart();
    await panel.onDuplicate(); await panel.onSplit(); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.equal(view.timelineProps().position, 8);
    view.timelineProps().onLayerInteractionEnd(); await view.pump(); assert.equal(view.layerProps().disabled, false);
  } finally { view.dispose(); }
});

test('ocultar faixa salva texto provisório e visibilidade juntos sem deslocar cursor; undo restaura ambos', async () => {
  const initial = editingWithCaptions(), view = harness(undefined, { initialEditing: initial, advanced: true });
  let panel;
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.canvasProps().onSelectLayer('caption'); await view.pump(); panel = renderLayerPanel(view.layerProps());
    panel.text('Texto preservado ao ocultar'); await view.pump();
    const saving = view.timelineProps().onToggleLaneVisibility(1); await view.pump();
    assert.equal(view.project().editing.layers[0].hidden, true);
    view.publish({ position: 0, sourcePosition: 2, takeId: 'a', playing: false, loading: true }, false); await view.pump();
    assert.equal(view.timelineProps().position, 8);
    view.finishSave(); await saving; await view.pump();
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Texto preservado ao ocultar');
    assert.equal(view.canvasProps().selectedLayerId, 'caption');
    assert.deepEqual(view.writes(), { attempted: 1, completed: 1 });
    assert.equal(view.preview.seeks.length, 0, 'hide does not invalidate the native frame with a redundant seek');
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(JSON.parse(JSON.stringify(view.project().editing)), JSON.parse(JSON.stringify(initial))); assert.equal(view.timelineProps().position, 8);
    view.button('Refazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.equal(view.project().editing.layers[0].hidden, true);
  } finally { panel?.dispose(); view.dispose(); }
});

test('silenciar principal não destrói volumes e ignora novo toque enquanto a escrita está pendente', async () => {
  const initial = editingWithCaptions(); initial.main[0].gain = 0.35;
  const view = harness(undefined, { initialEditing: initial, advanced: true });
  try {
    await view.pump(); view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump();
    const saving = view.timelineProps().onToggleMainMute(); await view.pump();
    await view.timelineProps().onToggleMainMute(); assert.equal(view.writes().attempted, 1);
    view.finishSave(); await saving; await view.pump();
    assert.equal(view.project().editing.mainMuted, true); assert.equal(view.project().editing.main[0].gain, 0.35);
    assert.equal(model.compileStudioRecipe(view.project()).clips.find(clip => clip.id === 'a').gain, 0);
    const restore = view.timelineProps().onToggleMainMute(); await view.pump(); view.finishSave(); await restore; await view.pump();
    assert.equal(view.project().editing.mainMuted, undefined); assert.equal(view.project().editing.main[0].gain, 0.35);
    assert.equal(view.timelineProps().position, 3);
    assert.equal(view.preview.seeks.length, 0, 'mute/unmute must retain the native frame and cursor');
  } finally { view.dispose(); }
});

test('controle de faixa falho preserva seleção e permite retry sem histórico fantasma', async () => {
  const initial = editingWithCaptions(), view = harness(undefined, { initialEditing: initial, advanced: true });
  try {
    await view.pump(); view.canvasProps().onSelectLayer('caption'); await view.pump();
    view.failNextMutation('Disco cheio');
    await assert.rejects(view.timelineProps().onToggleLaneVisibility(1), /Disco cheio/); await view.pump();
    assert.deepEqual(view.project().editing, initial); assert.equal(view.canvasProps().selectedLayerId, 'caption');
    assert.equal(view.button('Desfazer edição').disabled, true);
    assert.equal(view.alerts.filter(alert => alert[1].includes('Disco cheio')).length, 1);
    const retry = view.timelineProps().onToggleLaneVisibility(1); await view.pump(); view.finishSave(); await retry; await view.pump();
    assert.equal(view.project().editing.layers[0].hidden, true);
  } finally { view.dispose(); }
});

for (const gesture of ['canvas', 'layer']) test(`controle de faixa não disputa propriedade com gesto ${gesture}`, async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump();
    if (gesture === 'canvas') view.canvasProps().onInteractionStart(); else view.timelineProps().onLayerInteractionStart();
    await view.timelineProps().onToggleLaneVisibility(1); await view.timelineProps().onToggleLaneMute(1); await view.timelineProps().onToggleMainMute();
    assert.equal(view.writes().attempted, 0);
    if (gesture === 'canvas') view.canvasProps().onInteractionEnd(); else view.timelineProps().onLayerInteractionEnd();
    await view.pump();
    assert.equal(view.previewProps().canvasTransformChannel, view.canvasProps().canvasTransformChannel, 'native preview and gesture share one transient channel');
  } finally { view.dispose(); }
});

test('mais abre escolhas sem iniciar gravação, importar ou deslocar cursor; fechar preserva a montagem', async () => {
  let imports = 0;
  const view = harness(undefined, { advanced: true, importMedia: async () => { imports++; return []; } });
  try {
    await view.pump(); view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump();
    view.timelineProps().onAppend(); await view.pump();
    assert.equal(view.tool('Gravar').disabled, false); assert.equal(view.tool('Arquivo da galeria').disabled, false);
    assert.equal(imports, 0); assert.equal(view.navigationEvents.length, 0); assert.equal(view.preview.seeks.length, 0);
    view.button('Fechar painel do editor').onPress(); await view.pump();
    assert.equal(view.timelineProps().position, 3); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
  } finally { view.dispose(); }
});

for (const choice of ['Gravar', 'Arquivo da galeria']) test(`mais: ${choice} confirma o texto pendente antes de sair para outra tela`, async () => {
  const initial = editingWithCaptions(); let importedProject;
  const view = harness(undefined, { initialEditing: initial, advanced: true, importMedia: async project => { importedProject = project; return []; } });
  let panel;
  try {
    await view.pump(); view.canvasProps().onSelectLayer('caption'); await view.pump();
    panel = renderLayerPanel(view.layerProps()); panel.text('Texto salvo antes de adicionar'); await view.pump();
    view.timelineProps().onAppend(); await view.pump(); view.tool(choice).onPress(); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 1, completed: 0 });
    assert.equal(importedProject, undefined); assert.equal(view.navigationEvents.length, 0);
    view.finishSave(); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 1, completed: 1 });
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Texto salvo antes de adicionar');
    if (choice === 'Gravar') {
      assert.equal(view.navigationEvents.length, 1); assert.equal(view.navigationEvents[0].destination.pathname, '/studio/capture');
      assert.equal(view.navigationEvents[0].completedWrites, 1);
    } else {
      assert.equal(importedProject.editing.layers[0].items[0].text.content, 'Texto salvo antes de adicionar');
      assert.equal(view.navigationEvents.length, 0); assert.equal(view.timelineProps().busy, false);
    }
  } finally { panel?.dispose(); view.dispose(); }
});

test('mais: toques enfileirados abrem somente um seletor da galeria; cancelamento libera os controles', async () => {
  let finishPicker, imports = 0;
  const pending = new Promise(resolve => { finishPicker = () => resolve([]); });
  const view = harness(undefined, { advanced: true, importMedia: () => { imports++; return pending; } });
  try {
    await view.pump(); view.timelineProps().onAppend(); await view.pump();
    const select = view.tool('Arquivo da galeria').onPress; select(); select(); await view.pump();
    assert.equal(imports, 1); assert.equal(view.timelineProps().busy, true);
    finishPicker(); await view.pump();
    assert.equal(view.timelineProps().busy, false); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
    assert.equal(view.navigationEvents.length, 0); assert.equal(view.alerts.length, 0);
  } finally { view.dispose(); }
});

for (const choice of ['Gravar', 'Arquivo da galeria']) test(`mais: ${choice} não abre outra tela se o editor perde foco durante o flush`, async () => {
  let finishFlush, imports = 0;
  const pending = new Promise(resolve => { finishFlush = resolve; });
  const view = harness(undefined, { advanced: true, flush: () => pending, importMedia: async () => { imports++; return []; } });
  try {
    await view.pump(); view.timelineProps().onAppend(); await view.pump(); view.tool(choice).onPress(); await view.pump();
    assert.equal(view.timelineProps().busy, true);
    view.focus(false); await view.pump(); finishFlush(); await view.pump();
    assert.equal(imports, 0); assert.equal(view.navigationEvents.length, 0); assert.equal(view.alerts.length, 0);
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
    view.focus(true); await view.pump(); assert.equal(view.timelineProps().busy, false);
  } finally { view.dispose(); }
});

for (const choice of ['Gravar', 'Arquivo da galeria']) test(`mais: ${choice} salva o draft mas não abre outra tela após perder foco`, async () => {
  let imports = 0;
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true, importMedia: async () => { imports++; return []; } });
  let panel;
  try {
    await view.pump(); view.canvasProps().onSelectLayer('caption'); await view.pump();
    panel = renderLayerPanel(view.layerProps()); panel.text('Texto preservado antes de perder foco'); await view.pump();
    view.timelineProps().onAppend(); await view.pump(); view.tool(choice).onPress(); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 1, completed: 0 });
    view.focus(false); await view.pump(); view.finishSave(); await view.pump();
    assert.equal(imports, 0); assert.equal(view.navigationEvents.length, 0);
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Texto preservado antes de perder foco');
    assert.deepEqual(view.writes(), { attempted: 1, completed: 1 });
  } finally { panel?.dispose(); view.dispose(); }
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function externalAction(view, label) {
  if (['Gravar', 'Arquivo da galeria'].includes(label)) view.timelineProps().onAppend();
  else if (['Imagem', 'Vídeo sobreposto'].includes(label)) view.tool('Sobrepor').onPress();
  else if (['Importar SRT/VTT', 'Gerar legendas', 'Legenda manual'].includes(label)) view.tool('Legendas').onPress();
  await view.pump();
  if (label === 'Gerar legendas') return view.button(label).onPress;
  if (label === 'Revisar publicação' || label === 'Voltar aos projetos') return view.button(label).onPress;
  return view.tool(label).onPress;
}
function editingWithImage() {
  const value = editingWithCaptions();
  value.assets.push({ id: 'image-source', kind: 'image', uri: 'file:///original.png', name: 'Imagem original', durationTicks: 0 });
  return model.addStudioLayerItem(value, { id: 'image', kind: 'image', assetId: 'image-source', atTicks: 0, durationTicks: model.studioTicks(3), rect: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 } });
}

for (const surface of ['canvas', 'preview']) for (const selected of ['main', 'other-text', 'image']) {
  test(`vazio em ${surface} desmarca ${selected}, preservando conteúdo/tempo e sem Play/seek`, async () => {
    const initial = editingWithImage(), view = harness(undefined, { initialEditing: initial, advanced: true });
    try {
      await view.pump(); view.publish({ position: 2, sourcePosition: 4, takeId: 'a', playing: false, loading: false }); await view.pump();
      if (selected === 'main') view.canvasProps().onSelectMainClip('a'); else view.canvasProps().onSelectLayer(selected);
      await view.pump(); const pauses = view.preview.pauses;
      (surface === 'canvas' ? view.canvasProps() : view.previewProps()).onCanvasPress(); await view.pump();
      assert.equal(view.canvasProps().selectedLayerId, undefined); assert.equal(view.canvasProps().selectedMainClipId, undefined);
      assert.equal(view.timelineProps().position, 2); assert.equal(view.preview.toggles, 0); assert.equal(view.preview.seeks.length, 0); assert.equal(view.preview.pauses, pauses);
      assert.deepEqual(view.project().editing, initial); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
      (surface === 'canvas' ? view.canvasProps() : view.previewProps()).onCanvasPress(); await view.pump();
      assert.equal(view.preview.toggles, 1, 'only a subsequent empty press without selection controls playback');
    } finally { view.dispose(); }
  });
}

for (const surface of ['canvas', 'preview']) test(`vazio em ${surface} salva draft uma vez antes de desmarcar, sem seek, com undo`, async () => {
  const initial = editingWithCaptions(), view = harness(undefined, { initialEditing: initial, advanced: true }); let panel;
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.canvasProps().onSelectLayer('caption'); await view.pump(); panel = renderLayerPanel(view.layerProps()); panel.text('Confirmado pelo vazio'); await view.pump();
    const press = (surface === 'canvas' ? view.canvasProps() : view.previewProps()).onCanvasPress;
    press(); press(); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 1, completed: 0 }); assert.equal(view.canvasProps().selectedLayerId, 'caption');
    view.finishSave(); await view.pump();
    assert.equal(view.canvasProps().selectedLayerId, undefined); assert.equal(view.preview.toggles, 0); assert.equal(view.preview.seeks.length, 0);
    assert.equal(view.timelineProps().position, 8); assert.equal(view.project().editing.layers[0].items[0].text.content, 'Confirmado pelo vazio');
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(view.project().editing.layers, initial.layers); assert.equal(view.timelineProps().position, 8);
  } finally { panel?.dispose(); view.dispose(); }
});

test('vazio com erro conserva draft/seleção; retry salva sem trocar Play ou cursor', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true }); let panel;
  try {
    await view.pump(); view.canvasProps().onSelectLayer('caption'); await view.pump(); panel = renderLayerPanel(view.layerProps()); panel.text('Texto recuperável'); await view.pump();
    view.failNextMutation('Disco cheio'); view.canvasProps().onCanvasPress(); await view.pump();
    assert.equal(view.canvasProps().selectedLayerId, 'caption'); assert.equal(view.layerProps().item.text.content, 'Texto recuperável');
    assert.equal(view.preview.toggles, 0); assert.equal(view.preview.seeks.length, 0); assert.equal(view.timelineProps().busy, false);
    view.previewProps().onCanvasPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.equal(view.canvasProps().selectedLayerId, undefined); assert.equal(view.project().editing.layers[0].items[0].text.content, 'Texto recuperável');
    assert.equal(view.preview.seeks.length, 0); assert.equal(view.preview.toggles, 0);
  } finally { panel?.dispose(); view.dispose(); }
});

test('vazio em tela inteira continua transporte mesmo com seleção preservada', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true });
  try {
    await view.pump(); view.canvasProps().onSelectMainClip('a'); await view.pump();
    view.button('Prévia em tela inteira').onPress(); await view.pump(); view.previewProps().onCanvasPress(); await view.pump();
    assert.equal(view.preview.toggles, 1); assert.equal(view.preview.seeks.length, 0); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
    view.button('Voltar às ferramentas do editor').onPress(); await view.pump(); assert.equal(view.canvasProps().selectedMainClipId, 'a');
  } finally { view.dispose(); }
});

for (const label of ['Imagem', 'Vídeo sobreposto', 'Áudio', 'Importar SRT/VTT', 'Gerar legendas', 'Gravar', 'Arquivo da galeria', 'Revisar publicação', 'Voltar aos projetos']) {
  test(`${label}: reserva antes do flush e blur/refocus invalida a entrada antiga`, async () => {
    const wait = deferred(); let calls = 0;
    const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true, flush: () => wait.promise,
      importLayer: async () => { calls++; return null; }, importCaptions: async () => { calls++; return null; }, importMedia: async () => { calls++; return []; },
      capabilities: async () => { calls++; return { available: true }; } });
    try {
      await view.pump(); const start = await externalAction(view, label); start(); start(); await view.pump();
      assert.equal(view.timelineProps().busy, true); assert.equal(calls, 0); assert.equal(view.navigationEvents.length, 0);
      view.focus(false); await view.pump(); view.focus(true); await view.pump();
      wait.resolve(); await view.pump();
      assert.equal(calls, 0); assert.equal(view.navigationEvents.length, 0); assert.equal(view.alerts.length, 0);
      assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.equal(view.timelineProps().busy, false);
    } finally { view.dispose(); }
  });
}

for (const label of ['Imagem', 'Importar SRT/VTT']) test(`${label}: owner ou alvo removido durante flush não abre seletor`, async () => {
  for (const change of ['owner', 'owner-returned', 'target']) {
    const wait = deferred(); let calls = 0;
    const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true, flush: () => wait.promise,
      importLayer: async () => { calls++; return null; }, importCaptions: async () => { calls++; return null; } });
    try {
      await view.pump(); const start = await externalAction(view, label); start(); await view.pump();
      if (change === 'owner' || change === 'owner-returned') { view.owner('another-owner'); await view.pump(); if (change === 'owner-returned') view.owner('owner'); }
      else view.externalEditing(model.reconcileStudioTakes(view.project(), [view.project().takes[1]]));
      await view.pump(); wait.resolve(); await view.pump();
      assert.equal(calls, 0); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.equal(view.alerts.length, 0);
    } finally { view.dispose(); }
  }
});

test('SRT conserva take/URI alvo no picker, ignora seleção concorrente e mantém reserva durante save', async () => {
  const wait = deferred(); let calls = 0, imported;
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true,
    importCaptions: (project, duration) => { calls++; imported = { project, duration }; return wait.promise; } });
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    const start = await externalAction(view, 'Importar SRT/VTT'); start(); start(); await view.pump();
    assert.equal(calls, 1); assert.equal(imported.duration, 10); assert.equal(imported.project.id, 'project');
    view.timelineProps().onSelect(view.project().takes[0]); await view.pump();
    wait.resolve([{ start: 3, end: 4, text: 'Texto ancorado ao take B' }]); await view.pump();
    const importedCue = view.project().editing.layers.flatMap(lane => lane.items).find(item => item.text?.content === 'Texto ancorado ao take B');
    assert.equal(importedCue.anchor.clipId, 'b'); assert.equal(importedCue.anchor.sourceStartTicks, model.studioTicks(3));
    assert.equal(view.timelineProps().busy, true); assert.equal(view.preview.seeks.length, 0);
    view.finishSave(); await view.pump(); assert.equal(view.timelineProps().busy, false); assert.equal(view.timelineProps().position, 8);
    assert.deepEqual(view.writes(), { attempted: 1, completed: 1 });
  } finally { view.dispose(); }
});

for (const interrupted of ['blur-refocus', 'target-removed', 'uri-replaced']) test(`SRT após ${interrupted} não aplica legendas ao alvo antigo ou substituto`, async () => {
  const wait = deferred(); const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true, importCaptions: () => wait.promise });
  try {
    await view.pump(); (await externalAction(view, 'Importar SRT/VTT'))(); await view.pump();
    if (interrupted === 'blur-refocus') { view.focus(false); await view.pump(); view.focus(true); }
    else if (interrupted === 'target-removed') view.externalEditing(model.reconcileStudioTakes(view.project(), [view.project().takes[1]]));
    else view.externalEditing({ ...view.project().editing, assets: view.project().editing.assets.map(asset => ({ ...asset, uri: `${asset.uri}.replacement` })) });
    await view.pump(); wait.resolve([{ start: 3, end: 4, text: 'Não aplicar' }]); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.equal(view.alerts.length, 0); assert.equal(view.timelineProps().busy, false);
    assert.ok(!view.project().editing.layers.some(lane => lane.items.some(item => item.text?.content === 'Não aplicar')));
  } finally { view.dispose(); }
});

test('transcrição local cancela no blur e resultado tardio não grava após refocus', async () => {
  const wait = deferred(), cancelled = []; let jobs = 0;
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true,
    capabilities: async () => ({ available: true, requiresModelDownload: false }), transcribe: () => { jobs++; return wait.promise; }, cancelTranscription: async id => { cancelled.push(id); } });
  try {
    await view.pump(); (await externalAction(view, 'Gerar legendas'))(); await view.pump(); assert.equal(jobs, 1);
    view.focus(false); await view.pump(); view.focus(true); await view.pump(); assert.deepEqual(cancelled, ['new-1']);
    wait.resolve({ segments: [{ text: 'Resultado antigo', startSeconds: 0, endSeconds: 1, words: [] }] }); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.equal(view.alerts.length, 0); assert.equal(view.timelineProps().busy, false);
  } finally { view.dispose(); }
});

for (const label of ['Imagem', 'Importar SRT/VTT', 'Gerar legendas']) test(`${label}: diálogo de perfil também pertence à reserva e não continua após blur/refocus`, async () => {
  let calls = 0;
  const view = harness([take4k('a')], { advanced: true, outputCapabilities: async () => oldOutputCapabilities, importLayer: async () => { calls++; return null; }, importCaptions: async () => { calls++; return null; },
    capabilities: async () => { calls++; return { available: false }; } });
  try {
    await view.pump(); const start = await externalAction(view, label); start(); start(); await view.pump();
    const profiles = view.alerts.filter(alert => alert[0] === 'Atualização do editor necessária'); assert.equal(profiles.length, 1);
    assert.equal(view.timelineProps().busy, true); assert.equal(calls, 0);
    view.focus(false); await view.pump(); view.focus(true); await view.pump();
    profiles[0][2].find(option => option.text === 'Escolher HD · 30 FPS').onPress(); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.equal(calls, 0); assert.equal(view.timelineProps().busy, false);
    assert.equal(model.studioEditing(view.project()).output.profile, 'legacy-source');
  } finally { view.dispose(); }
});

test('texto novo usa posição congelada, seleção sem teclado implícito e uma etapa de undo', async () => {
  const initial = editingWithCaptions(), view = harness(undefined, { initialEditing: initial, advanced: true });
  try {
    await view.pump(); view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump();
    const start = await externalAction(view, 'Texto'); start(); start(); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 1, completed: 0 }); assert.equal(view.timelineProps().busy, true);
    view.publish({ position: 0, sourcePosition: 2, takeId: 'a', playing: false, loading: true }); await view.pump();
    view.finishSave(); await view.pump();
    assert.equal(view.layerProps().item.text.content, 'Seu título'); assert.equal(view.layerProps().editTextRequest, undefined);
    assert.deepEqual(view.layerProps().item.anchor, { clipId: 'a', offsetTicks: model.studioTicks(3) });
    assert.equal(view.timelineProps().position, 3); assert.equal(view.preview.seeks.length, 0);
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(view.project().editing.layers, initial.layers); assert.equal(view.timelineProps().position, 3);
  } finally { view.dispose(); }
});

test('cancelar galeria depois do draft salvo conserva sua seleção, cursor e undo', async () => {
  const initial = editingWithCaptions(), wait = deferred(); let calls = 0, panel;
  const view = harness(undefined, { initialEditing: initial, advanced: true, importMedia: () => { calls++; return wait.promise; } });
  try {
    await view.pump(); view.publish({ position: 8, sourcePosition: 4, takeId: 'b', playing: false, loading: false }); await view.pump();
    view.canvasProps().onSelectLayer('caption'); await view.pump(); panel = renderLayerPanel(view.layerProps()); panel.text('Salvo mesmo cancelando o seletor'); await view.pump();
    (await externalAction(view, 'Arquivo da galeria'))(); await view.pump(); assert.equal(calls, 0);
    view.finishSave(); await view.pump(); assert.equal(calls, 1); assert.equal(view.timelineProps().busy, true);
    wait.resolve([]); await view.pump();
    assert.equal(view.canvasProps().selectedLayerId, 'caption'); assert.equal(view.layerProps().item.text.content, 'Salvo mesmo cancelando o seletor');
    assert.equal(view.timelineProps().position, 8); assert.equal(view.preview.seeks.length, 0); assert.equal(view.preview.toggles, 0);
    assert.equal(view.timelineProps().busy, false); assert.equal(view.navigationEvents.length, 0); assert.deepEqual(view.writes(), { attempted: 1, completed: 1 });
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(view.project().editing.layers, initial.layers); assert.equal(view.timelineProps().position, 8);
  } finally { panel?.dispose(); view.dispose(); }
});

test('fechar seleção antes do flush invalida a entrada reservada sem gravar draft cancelado', async () => {
  const wait = deferred(); let calls = 0, panel;
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true, flush: () => wait.promise, importMedia: async () => { calls++; return []; } });
  try {
    await view.pump(); view.canvasProps().onSelectLayer('caption'); await view.pump(); panel = renderLayerPanel(view.layerProps()); panel.text('Draft explicitamente cancelado'); await view.pump();
    const cancelSelection = view.layerProps().onClose;
    (await externalAction(view, 'Arquivo da galeria'))(); await view.pump(); assert.equal(view.timelineProps().busy, true);
    // A native close callback accepted before the disabled render may arrive
    // while metadata is awaiting disk. Its old operation cannot continue.
    cancelSelection(); await view.pump(); wait.resolve(); await view.pump();
    assert.equal(calls, 0); assert.equal(view.canvasProps().selectedLayerId, undefined); assert.equal(view.project().editing.layers[0].items[0].text.content, 'Legenda inicial');
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.equal(view.alerts.length, 0); assert.equal(view.timelineProps().busy, false);
  } finally { panel?.dispose(); view.dispose(); }
});

test('importação de imagem já durável termina após blur, preserva fonte e não seleciona resultado tardio', async () => {
  const wait = deferred(); let importedItem, calls = 0;
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true,
    importLayer: async (project, kind, item) => {
      calls++; importedItem = item; await wait.promise;
      const editing = { ...project.editing, assets: [...project.editing.assets, { id: 'durable-image', kind, uri: 'file:///durable-original.png', name: 'Imagem importada', durationTicks: 0 }] };
      view.externalEditing(model.addStudioLayerItem(editing, { ...item, assetId: 'durable-image' }, `layer:item:${item.id}`));
      return view.project();
    } });
  try {
    await view.pump(); view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump();
    const start = await externalAction(view, 'Imagem'); start(); await view.pump(); assert.equal(calls, 1);
    view.focus(false); await view.pump(); view.focus(true); await view.pump(); start(); await view.pump();
    assert.equal(calls, 1, 'the old copy owns its reservation until it settles');
    wait.resolve(); await view.pump();
    assert.equal(view.project().editing.assets.find(asset => asset.id === 'durable-image').uri, 'file:///durable-original.png');
    assert.ok(view.project().editing.layers.some(lane => lane.items.some(item => item.id === importedItem.id)));
    assert.equal(view.canvasProps().selectedLayerId, undefined); assert.equal(view.timelineProps().position, 3);
    assert.equal(view.preview.seeks.length, 0); assert.equal(view.timelineProps().busy, false); assert.equal(view.alerts.length, 0);
  } finally { view.dispose(); }
});

test('vazio com save já iniciado conserva texto e seleção após blur/refocus sem comando tardio', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true }); let panel;
  try {
    await view.pump(); view.canvasProps().onSelectLayer('caption'); await view.pump(); panel = renderLayerPanel(view.layerProps()); panel.text('Escrita aceita antes do blur'); await view.pump();
    view.canvasProps().onCanvasPress(); await view.pump(); assert.deepEqual(view.writes(), { attempted: 1, completed: 0 });
    view.focus(false); await view.pump(); view.focus(true); await view.pump(); view.finishSave(); await view.pump();
    assert.equal(view.canvasProps().selectedLayerId, 'caption'); assert.equal(view.layerProps().item.text.content, 'Escrita aceita antes do blur');
    assert.deepEqual(view.writes(), { attempted: 1, completed: 1 }); assert.equal(view.preview.seeks.length, 0); assert.equal(view.preview.toggles, 0);
    view.previewProps().onCanvasPress(); await view.pump(); assert.equal(view.canvasProps().selectedLayerId, undefined);
    assert.deepEqual(view.writes(), { attempted: 1, completed: 1 });
  } finally { panel?.dispose(); view.dispose(); }
});

test('tratamento iniciado pelo perfil não abre painel após retorno do foco', async () => {
  const view = harness([take4k('a')], { advanced: true, outputCapabilities: async () => oldOutputCapabilities });
  try {
    await view.pump(); const start = view.tool('Filtros').onPress; start(); start(); await view.pump();
    const profile = view.alerts.find(alert => alert[0] === 'Atualização do editor necessária'); assert.ok(profile); assert.equal(view.timelineProps().busy, true);
    view.focus(false); await view.pump(); view.focus(true); await view.pump(); profile[2].find(option => option.text === 'Escolher HD · 30 FPS').onPress(); await view.pump();
    assert.equal(view.hasTreatmentPanel(), false); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.equal(view.timelineProps().busy, false);
  } finally { view.dispose(); }
});

function outputMontage(fourK = false) {
  return model.withStudioStandardOutput(model.reconcileStudioTakes({ kind: 'aula' },
    [{ ...take('a'), width: fourK ? 3840 : 1920, height: fourK ? 2160 : 1080, frameRate: fourK ? 60 : 30, colorSpace: 'rec709' }]));
}
const portable = value => JSON.parse(JSON.stringify(value));
async function openOutput(view) {
  view.button(`Qualidade de saída: ${model.studioOutputLabel(view.project().editing)}`).onPress(); await view.pump();
}
function conversion(view) { return view.alerts.filter(alert => alert[0] === 'Converter a qualidade?').at(-1); }

test('qualidade: ampliar HD para 4K exige confirmação, salva uma vez e undo preserva fonte e cursor', async () => {
  const initial = outputMontage(), originals = portable(initial.assets);
  const view = harness(undefined, { initialEditing: initial, advanced: true });
  try {
    await view.pump(); view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump(); await openOutput(view);
    view.button('Exportar em 4K').onPress(); await view.pump();
    assert.match(conversion(view)[1], /não cria novos detalhes/); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
    conversion(view)[2].find(option => option.text === 'Cancelar').onPress(); await view.pump();
    assert.deepEqual(portable(view.project().editing), portable(initial));
    view.button('Exportar em 4K').onPress(); await view.pump(); conversion(view)[2].find(option => option.text === 'Usar esta qualidade').onPress(); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 1, completed: 0 }); view.finishSave(); await view.pump();
    assert.equal(model.studioEffectiveOutput(view.project().editing).width, 3840); assert.equal(view.timelineProps().position, 3);
    assert.deepEqual(portable(view.project().editing.assets), originals);
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(portable(view.project().editing), portable(initial)); assert.equal(view.timelineProps().position, 3);
  } finally { view.dispose(); }
});

test('qualidade: binário antigo não oferece 4K, mas permite conversão HD30 explícita sem alterar original', async () => {
  const initial = outputMontage(true), originals = portable(initial.assets);
  const view = harness(undefined, { initialEditing: initial, advanced: true, outputCapabilities: async () => oldOutputCapabilities });
  try {
    await view.pump(); await openOutput(view); assert.equal(view.button('Exportar em 4K').disabled, true);
    view.tool('Usar HD · 30 FPS').onPress(); await view.pump();
    assert.match(conversion(view)[1], /reduz a resolução/); assert.match(conversion(view)[1], /quadros podem ser repetidos ou descartados/);
    conversion(view)[2].find(option => option.text === 'Usar esta qualidade').onPress(); await view.pump(); view.finishSave(); await view.pump();
    const output = model.studioEffectiveOutput(view.project().editing);
    assert.equal(output.width, 1920); assert.equal(output.frameRateNumerator, 30); assert.deepEqual(portable(view.project().editing.assets), originals);
  } finally { view.dispose(); }
});

test('qualidade: confirmação pendente não apaga camada salva enquanto o alerta está aberto', async () => {
  const initial = outputMontage(), view = harness(undefined, { initialEditing: initial, advanced: true });
  try {
    await view.pump(); await openOutput(view); view.button('Exportar em 4K').onPress(); await view.pump();
    view.externalEditing(model.addStudioLayerItem(initial, model.createStudioTextItem({ id: 'new-durable-text', content: 'Preservar esta escrita' }))); await view.pump();
    conversion(view)[2].find(option => option.text === 'Usar esta qualidade').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.equal(view.project().editing.layers[0].items[0].text.content, 'Preservar esta escrita');
    assert.equal(model.studioEffectiveOutput(view.project().editing).width, 3840);
  } finally { view.dispose(); }
});

test('qualidade: blur/refocus invalida confirmação antiga e não grava nem muda a seleção', async () => {
  const initial = outputMontage(), view = harness(undefined, { initialEditing: initial, advanced: true });
  try {
    await view.pump(); await openOutput(view); view.button('Exportar em 4K').onPress(); await view.pump();
    view.focus(false); await view.pump(); view.focus(true); await view.pump();
    conversion(view)[2].find(option => option.text === 'Usar esta qualidade').onPress(); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.deepEqual(portable(view.project().editing), portable(initial));
    assert.equal(view.timelineProps().busy, false);
  } finally { view.dispose(); }
});

test('erro ao confirmar draft antes da galeria mostra uma causa única e conserva seleção para retry', async () => {
  let calls = 0, panel;
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true, importMedia: async () => { calls++; return []; } });
  try {
    await view.pump(); view.canvasProps().onSelectLayer('caption'); await view.pump(); panel = renderLayerPanel(view.layerProps()); panel.text('Texto para tentar novamente'); await view.pump();
    view.failNextMutation('Não há espaço para salvar'); (await externalAction(view, 'Arquivo da galeria'))(); await view.pump();
    assert.equal(view.alerts.filter(alert => alert[1] === 'Não há espaço para salvar').length, 1);
    assert.equal(calls, 0); assert.equal(view.canvasProps().selectedLayerId, 'caption'); assert.equal(view.layerProps().item.text.content, 'Texto para tentar novamente');
    assert.equal(view.timelineProps().busy, false); assert.equal(view.preview.seeks.length, 0);
    (await externalAction(view, 'Arquivo da galeria'))(); await view.pump(); view.finishSave(); await view.pump();
    assert.equal(calls, 1); assert.equal(view.project().editing.layers[0].items[0].text.content, 'Texto para tentar novamente');
    assert.equal(view.canvasProps().selectedLayerId, 'caption');
  } finally { panel?.dispose(); view.dispose(); }
});

test('tap/double tap aceitos antes do blur não deixam pedido de teclado ou seleção herdados no retorno', async () => {
  const view = harness(undefined, { initialEditing: editingWithCaptions(), advanced: true }); let panel;
  try {
    await view.pump(); view.canvasProps().onSelectLayer('caption'); await view.pump();
    const canvas = view.canvasProps(); view.focus(false); await view.pump();
    canvas.onEditText('caption'); canvas.onSelectLayer('other-text'); canvas.onSelectMainClip('b'); await view.pump();
    assert.equal(view.canvasProps().selectedLayerId, 'caption'); assert.equal(view.layerProps().editTextRequest, undefined);
    view.focus(true); await view.pump(); panel = renderLayerPanel(view.layerProps()); panel.flushFrames();
    assert.equal(panel.focusCount(), 0); assert.equal(view.canvasProps().selectedLayerId, 'caption');
    assert.equal(view.preview.seeks.length, 0); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
  } finally { panel?.dispose(); view.dispose(); }
});

test('velocidade confirmada preserva frame do cursor e undo restaura âncoras dos textos', async () => {
  const initial = editingWithCaptions(), view = harness(undefined, { initialEditing: initial, advanced: true, editorTools: true });
  try {
    await view.pump(); view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump();
    view.timelineProps().onSelect(view.project().takes[0]); await view.pump(); view.tool('Velocidade').onPress(); await view.pump();
    const draft = model.setStudioClipPlaybackRate(initial, 'a', 2); void view.clipProps().onApply(draft); await view.pump(); view.finishSave(); await view.pump();
    assert.equal(view.project().editing.main[0].playbackRate, 2); assert.equal(view.timelineProps().position, 1.5);
    assert.equal(view.preview.seeks.at(-1).frame.seconds, 5);
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(portable(view.project().editing), portable(initial)); assert.equal(view.timelineProps().position, 3);
  } finally { view.dispose(); }
});

for (const editorTools of [false, true]) test(`narração ${editorTools ? 'atual acompanha prévia' : 'legada preserva microfone sem Play'}, mantém cursor e invalida sessão após blur/refocus`, async () => {
  const view = harness(undefined, { initialEditing: outputMontage(), advanced: true, editorTools });
  try {
    await view.pump(); view.publish({ position: 3, sourcePosition: 5, takeId: 'a', playing: false, loading: false }); await view.pump();
    view.tool('Voz').onPress(); await view.pump(); const panel = view.voiceoverProps();
    assert.equal(panel.positionSeconds, 3); assert.equal(panel.canCommit(), true); assert.equal(view.hasTimeline(), false);
    assert.equal(view.button('Revisar publicação').disabled, true); view.back(); await view.pump(); assert.equal(view.navigationEvents.length, 0);
    panel.onRecordingChange(true, 3); await view.pump(); assert.equal(view.preview.toggles, editorTools ? 1 : 0); assert.equal(view.previewProps().paused, !editorTools);
    panel.onRecordingChange(false, 3); await view.pump(); assert.equal(view.previewProps().paused, true);
    view.focus(false); await view.pump(); view.focus(true); await view.pump(); assert.equal(panel.canCommit(), false);
    panel.onClose(); await view.pump(); assert.equal(view.hasTimeline(), true); assert.deepEqual(view.writes(), { attempted: 0, completed: 0 });
  } finally { view.dispose(); }
});

for (const audio of [true, false]) test(`extrair áudio ${audio ? 'confirma metadado legado sem mudar original e permite undo' : 'recusa vídeo sem faixa real'}`, async () => {
  const initial = outputMontage(), view = harness(undefined, { initialEditing: initial, advanced: true, editorTools: true, mediaInfo: async () => ({ hasAudio: audio }) });
  try {
    await view.pump(); view.timelineProps().onSelect(view.project().takes[0]); await view.pump(); view.tool('Extrair áudio').onPress(); await view.pump();
    if (!audio) { assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.match(view.alerts.at(-1)[1], /não tem uma faixa de áudio/); return; }
    view.finishSave(); await view.pump(); const actual = view.project().editing;
    assert.deepEqual(portable(actual.assets[0]), portable(initial.assets[0])); assert.equal(actual.main[0].gain, 0);
    const item = actual.layers.flatMap(lane => lane.items)[0]; assert.equal(item.kind, 'audio'); assert.notEqual(item.assetId, initial.assets[0].id);
    assert.equal(view.layerProps().item.id, item.id); view.layerProps().onClose(); await view.pump();
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.equal(view.project().editing.layers.length, 0); assert.equal(view.project().editing.main[0].gain, initial.main[0].gain);
  } finally { view.dispose(); }
});

test('metadado de extração que volta depois de blur não cria áudio ou altera seleção', async () => {
  let complete; const pending = new Promise(resolve => { complete = resolve; });
  const view = harness(undefined, { initialEditing: outputMontage(), advanced: true, editorTools: true, mediaInfo: () => pending });
  try {
    await view.pump(); view.timelineProps().onSelect(view.project().takes[0]); await view.pump(); view.tool('Extrair áudio').onPress(); await view.pump();
    view.focus(false); await view.pump(); view.focus(true); await view.pump(); complete({ hasAudio: true }); await view.pump();
    assert.deepEqual(view.writes(), { attempted: 0, completed: 0 }); assert.equal(view.project().editing.layers.length, 0);
  } finally { view.dispose(); }
});

for (const retry of [false, true]) test(`volume de um clip preserva atualização externa do irmão${retry ? ' após falha e retry' : ''}`, async () => {
  const initial = editingWithCaptions(), view = harness(undefined, { initialEditing: initial, advanced: true, editorTools: true });
  try {
    await view.pump(); view.timelineProps().onSelect(view.project().takes[0]); await view.pump();
    view.tool('Volume').onPress(); await view.pump();
    const draft = model.patchStudioClipProperties(initial, 'a', { gain: 0.5 });
    view.clipProps().onPreview(draft); await view.pump();
    if (retry) {
      view.failNextMutation('Disco indisponível');
      await assert.rejects(view.clipProps().onApply(draft), /Disco indisponível/); await view.pump();
    }
    view.externalEditing(model.patchStudioClipProperties(view.project().editing, 'b', { gain: 0.8, flipHorizontal: true })); await view.pump();
    const saving = view.clipProps().onApply(draft); await view.pump(); view.finishSave(); await saving; await view.pump();
    assert.equal(view.project().editing.main[0].gain, 0.5);
    assert.equal(view.project().editing.main[1].gain, 0.8, 'no apply-all command was accepted');
    assert.equal(view.project().editing.main[1].flipHorizontal, true);
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.equal(view.project().editing.main[0].gain, initial.main[0].gain);
    assert.equal(view.project().editing.main[1].gain, 0.8, 'undo restores the accepted edit, preserving its latest baseline');
  } finally { view.dispose(); }
});

test('volume aplicado a todos os clips altera só o mix solicitado e preserva mudanças externas de imagem', async () => {
  const initial = editingWithCaptions(), view = harness(undefined, { initialEditing: initial, advanced: true, editorTools: true });
  try {
    await view.pump(); view.timelineProps().onSelect(view.project().takes[0]); await view.pump(); view.tool('Volume').onPress(); await view.pump();
    let draft = initial;
    for (const clip of initial.main) draft = model.patchStudioClipProperties(draft, clip.id, { gain: 0.5, fadeInTicks: model.studioTicks(0.2), fadeOutTicks: 0 });
    view.externalEditing(model.patchStudioClipProperties(view.project().editing, 'b', { gain: 0.8, flipHorizontal: true })); await view.pump();
    const saving = view.clipProps().onApply(draft); await view.pump(); view.finishSave(); await saving; await view.pump();
    assert.deepEqual(view.project().editing.main.map(clip => clip.gain), [0.5, 0.5]);
    assert.equal(view.project().editing.main[1].flipHorizontal, true);
    assert.equal(view.project().editing.main[1].fadeInTicks, model.studioTicks(0.2));
  } finally { view.dispose(); }
});

for (const bulk of [false, true]) test(`texto ${bulk ? 'aplicado à faixa preserva conteúdo externo do irmão' : 'individual preserva estilo externo do irmão'}`, async () => {
  let initial = editingWithCaptions();
  const lane = initial.layers.find(layer => layer.items.some(item => item.id === 'caption'));
  const caption = lane.items.find(item => item.id === 'caption');
  initial = model.addStudioLayerItem(initial, { ...caption, id: 'sibling', text: { ...caption.text, content: 'Outro trecho' } }, lane.id);
  const view = harness(undefined, { initialEditing: initial, advanced: true, editorTools: true });
  try {
    await view.pump(); view.timelineProps().onSelectLayer('caption'); await view.pump();
    let draft = model.patchStudioLayerItem(initial, 'caption', { text: { content: 'Somente este trecho', ...(bulk ? { visualEffect: 'neon' } : {}) } });
    if (bulk) draft = model.patchStudioLayerItem(draft, 'sibling', { text: { visualEffect: 'neon' } });
    view.layerProps().onPreview(draft); await view.pump();
    view.externalEditing(model.patchStudioLayerItem(view.project().editing, 'sibling', { text: { color: '#F43F5E', content: 'Trecho atualizado externamente' } })); await view.pump();
    const saving = view.layerProps().onApply(draft); await view.pump(); view.finishSave(); await saving; await view.pump();
    const sibling = view.project().editing.layers.flatMap(layer => layer.items).find(item => item.id === 'sibling');
    assert.equal(sibling.text.content, 'Trecho atualizado externamente');
    assert.equal(sibling.text.color, bulk ? '#FFFFFF' : '#F43F5E');
    assert.equal(sibling.text.visualEffect, bulk ? 'neon' : undefined);
  } finally { view.dispose(); }
});

test('velocidade da camada resolve host e faixa atuais, preserva fonte inteira e undo mantém atualização externa', async () => {
  let initial = editingWithCaptions();
  initial = { ...initial, assets: [...initial.assets, { id: 'pip-source', kind: 'video', uri: 'file:///pip.mp4', name: 'PiP', durationTicks: model.studioTicks(4) }] };
  initial = model.addStudioLayerItem(initial, { id: 'pip', kind: 'video', assetId: 'pip-source', atTicks: 0, durationTicks: model.studioTicks(4),
    sourceStartTicks: 0, sourceEndTicks: model.studioTicks(4), anchor: { clipId: 'a', sourceStartTicks: model.studioTicks(3), sourceEndTicks: model.studioTicks(7) } });
  const view = harness(undefined, { initialEditing: initial, advanced: true, editorTools: true });
  try {
    await view.pump(); view.timelineProps().onSelectLayer('pip'); await view.pump(); view.layerProps().onClipTool('speed'); await view.pump();
    const draft = model.setStudioClipPlaybackRate(initial, 'pip', 2); view.clipProps().onPreview(draft); await view.pump();
    let latest = model.setStudioClipPlaybackRate(view.project().editing, 'a', 2);
    latest = model.patchStudioClipProperties(latest, 'pip', { gain: 0.7, flipHorizontal: true });
    latest = model.moveStudioLayerItemToLane(latest, 'pip', 1); view.externalEditing(latest); await view.pump();
    const expected = model.setStudioClipPlaybackRate(latest, 'pip', 2);
    const saving = view.clipProps().onApply(draft); await view.pump(); view.finishSave(); await saving; await view.pump();
    assert.deepEqual(portable(view.project().editing), portable(expected));
    const clip = model.compileStudioRecipe(view.project()).clips.find(value => value.id === 'pip');
    assert.equal(clip.durationTicks, model.studioTicks(2)); assert.equal(clip.sourceEndTicks, model.studioTicks(4));
    assert.equal(clip.zIndex, 1); assert.equal(clip.gain, 0.7); assert.equal(clip.flipHorizontal, true);
    view.button('Desfazer edição').onPress(); await view.pump(); view.finishSave(); await view.pump();
    assert.deepEqual(portable(view.project().editing), portable(latest));
  } finally { view.dispose(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createJourneyRuntime } from './editorJourneyHarness.mjs';
import * as model from './model.ts';

function load(file, dependencies, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unconfigured capture boundary: ${file} -> ${name}`);
    return dependencies[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}

// Real route, native-camera wrapper, control hook, stop operation, take strip,
// project hook, model, media journal and store. Only React/RN/OS/AV/FS/Storage
// boundaries are controlled; this does not exercise UIKit recognizers or optics.
async function harness(options = {}) {
  const runtime = createJourneyRuntime({ owner: 'owner' });
  let project = await runtime.store.createStudioProject('owner', 'aula', { transient: true });
  if (options.seed) {
    const uri = runtime.fixture('seed.mov', { duration: 2 });
    const take = await runtime.media.persistStudioTake(project, { uri, name: 'Take inicial' });
    project = await runtime.store.updateStudioProject('owner', project.id, { takes: [take] });
  }
  let id = project.id, owner = 'owner', focused = true, now = 0, timerId = 0;
  let currentContext, dirty = true, effects = [], tree, nativeRecord, zoomRequest;
  const contexts = new Map(), timers = new Map(), appListeners = new Set(), orientationListeners = new Set();
  const navigation = [], calls = [], alerts = [], scrolls = [];
  const appState = { currentState: 'active', addEventListener: (_, callback) => {
    appListeners.add(callback); return { remove: () => appListeners.delete(callback) };
  } };
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const slot = () => {
    const index = currentContext.cursor++;
    return { context: currentContext, index };
  };
  const hooks = {
    useRef(value) { const { context, index } = slot(); return context.slots[index] ||= { current: value }; },
    useState(initial) {
      const { context, index } = slot();
      if (!context.slots[index]) context.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [context.slots[index].value, next => {
        const previous = context.slots[index].value;
        const value = typeof next === 'function' ? next(previous) : next;
        if (!Object.is(previous, value)) { context.slots[index].value = value; dirty = true; }
      }];
    },
    useMemo(callback, dependencies) {
      const { context, index } = slot();
      if (!context.slots[index] || !equal(context.slots[index].dependencies, dependencies)) context.slots[index] = { value: callback(), dependencies };
      return context.slots[index].value;
    },
    useCallback(callback, dependencies) { return hooks.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) {
      const { context, index } = slot();
      if (!context.slots[index] || !equal(context.slots[index].dependencies, dependencies)) effects.push({ context, index, callback, dependencies });
    },
    useImperativeHandle(ref, callback, dependencies) {
      hooks.useEffect(() => { ref.current = callback(); return () => { ref.current = null; }; }, dependencies);
    },
    useSyncExternalStore(subscribe, snapshot) {
      hooks.useEffect(() => subscribe(() => { dirty = true; }), [subscribe]);
      return snapshot();
    },
    forwardRef: callback => props => callback(props, props.ref),
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const schedule = (callback, delay, interval) => { const token = ++timerId; timers.set(token, { callback, at: now + delay, interval }); return token; };
  const globals = {
    setTimeout: (callback, delay = 0) => schedule(callback, delay), clearTimeout: token => timers.delete(token),
    setInterval: (callback, delay) => schedule(callback, delay, delay), clearInterval: token => timers.delete(token),
    Date: class extends Date { static now() { return now; } },
  };
  const nativeHost = { tag: 73 };
  const native = {
    ActivityIndicator: 'spinner', Alert: { alert: (...args) => alerts.push(args) }, AppState: appState,
    KeyboardAvoidingView: 'keyboard', Linking: { openSettings: async () => {} }, Platform: { OS: 'ios' },
    Pressable: 'button', ScrollView: 'scroll', Text: 'text', View: 'view',
    StyleSheet: { create: styles => styles, absoluteFillObject: {}, absoluteFill: {} },
    findNodeHandle: view => view?.tag ?? null,
    useWindowDimensions: () => ({ width: 844, height: 390 }),
  };
  let state = {
    deviceId: 'qa-camera', position: 'front', qualities: [
      { quality: '720p', width: 1280, height: 720, fps: [24, 30] },
      { quality: '1080p', width: 1920, height: 1080, fps: [24, 30, 60] },
      { quality: '2160p', width: 3840, height: 2160, fps: [24, 30] },
    ], quality: '1080p', fps: 30, width: 1920, height: 1080, minZoom: 1, maxZoom: 4, zoom: 1,
    minExposure: -2, maxExposure: 2, exposure: 0, aperture: 1.8,
    supportsFocus: true, supportsFocusLock: true, supportsExposure: true, supportsExposureLock: true,
    supportsTorch: false, focusLocked: false, exposureLocked: false, torchEnabled: false, isRecording: false,
    generation: 1, revision: 1, orientation: 'landscapeLeft', previewProcessed: false,
  };
  const capturedUri = runtime.fixture('captured.mov', { duration: 3.2 });
  const snapshot = () => ({ ...state, qualities: state.qualities.map(value => ({ ...value, fps: [...value.fps] })) });
  const capabilities = async () => { calls.push({ kind: 'capabilities' }); return snapshot(); };
  const configure = async (_, request) => {
    calls.push({ kind: 'configure', request });
    const quality = state.qualities.find(value => value.quality === request.quality);
    assert.ok(quality);
    const changed = state.position !== (request.position ?? state.position) || state.quality !== request.quality || state.fps !== request.fps;
    state = { ...state, ...request, width: quality.width, height: quality.height,
      maxZoom: request.quality === '2160p' ? 8 : 4, zoom: 1,
      supportsTorch: (request.position ?? state.position) === 'back' && options.torch !== false,
      generation: state.generation + (changed ? 1 : 0) };
    return snapshot();
  };
  const zoom = async (_, factor) => {
    calls.push({ kind: 'zoom', factor });
    return await new Promise((resolve, reject) => { zoomRequest = { factor, resolve, reject, state: snapshot() }; });
  };
  const start = async (_, operationId) => {
    calls.push({ kind: 'record', operationId }); state.isRecording = true;
    return await new Promise((resolve, reject) => { nativeRecord = { operationId, resolve, reject }; });
  };
  const stop = async (_, operationId) => {
    calls.push({ kind: 'stop', operationId }); state.isRecording = false;
    if (nativeRecord?.operationId === operationId) {
      nativeRecord.resolve({ uri: capturedUri, duration: 3.2, operationId, frameRate: 30, sourceKind: 'standard', sourceStage: 'standard' });
      nativeRecord = undefined;
    }
    return snapshot();
  };
  const bridge = {
    isStudioNativeCameraAvailable: () => options.native !== false,
    isStudioNativeCameraEffectsAvailable: () => false,
    isStudioCameraControlsAvailable: () => options.controls !== false,
    getStudioNativeCameraCapabilitiesAsync: capabilities, getStudioCameraCapabilitiesAsync: capabilities,
    configureStudioNativeCameraAsync: configure,
    configureStudioCameraAsync: (_, request) => configure(_, { ...request, position: state.position === 'front' ? 'back' : 'front' }),
    setStudioNativeCameraZoomAsync: zoom, setStudioCameraZoomAsync: zoom,
    startStudioNativeCameraRecordingAsync: start, stopStudioNativeCameraRecordingAsync: stop,
    setStudioNativeCameraExposureAsync: capabilities, setStudioCameraExposureAsync: capabilities,
    setStudioNativeCameraFocusAsync: capabilities, setStudioCameraFocusAsync: capabilities,
    setStudioNativeCameraTorchAsync: async (_, enabled) => { calls.push({ kind: 'torch', enabled }); state.torchEnabled = enabled; return snapshot(); },
    getStudioExportCapabilitiesAsync: async () => ({ available: false }),
  };
  const orientation = {
    Orientation: { LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 }, getOrientationAsync: async () => 3,
    addOrientationChangeListener: callback => { orientationListeners.add(callback); return callback; },
    removeOrientationChangeListener: callback => orientationListeners.delete(callback),
  };
  const iconNames = 'Camera Check ChevronRight FileText Mic Minus Palette Pause Play Plus SlidersHorizontal Square SwitchCamera Timer X Zap ZapOff Video';
  const icons = Object.fromEntries(iconNames.split(' ').map(name => [name, name]));
  const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'fragment' };
  const theme = { colors: { text: '#fff', accent: '#f06', borderSubtle: '#333' } };
  const cameraModule = load('./StudioNativeCamera.tsx', {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'react-native': native,
    'expo-crypto': { randomUUID: () => `qa-record-${calls.filter(value => value.kind === 'record').length + 1}` },
    'expo-modules-core': { requireNativeViewManager: () => 'native-camera-view' },
    '../../../modules/classfy-studio-media': bridge, './model': model,
  });
  const controls = load('./StudioCaptureCamera.ts', {
    react: hooks, 'react-native': native, 'expo-screen-orientation': orientation,
    '../../../modules/classfy-studio-media': bridge, './StudioNativeCamera': cameraModule,
  }, globals);
  const takes = load('./StudioCaptureTakes.tsx', {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'react-native': native, 'lucide-react-native': icons,
    '@/components/LoadingImage': { LoadingImage: 'image' }, '@/theme/colors': theme, './model': model,
  });
  const auth = { useAuth: () => ({ user: { id: owner } }) };
  const projectHook = load('./useStudioProjects.ts', {
    react: hooks, '@/features/auth/authContext': auth, './store': runtime.store,
    './workspaceActions': { duplicateStudioProject: undefined, renameStudioProject: undefined },
  });
  const videoStop = load('./StudioCaptureRecording.ts', {}, globals);
  const navigate = (kind, destination) => navigation.push({ kind, destination, project: runtime.store.getStudioProject(owner, id) });
  const screen = load('../../../app/studio/capture.tsx', {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'react-native': native,
    'expo-av': { Audio: { setAudioModeAsync: async () => {}, Recording: class {} } },
    'expo-camera': { CameraView: 'expo-camera-view', useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })], useMicrophonePermissions: () => [{ granted: true }, async () => ({ granted: true })] },
    'expo-device': { isDevice: true }, 'expo-screen-orientation': orientation,
    'expo-linear-gradient': { LinearGradient: 'gradient' }, 'expo-status-bar': { StatusBar: 'status' },
    'expo-router': { useLocalSearchParams: () => ({ id, from: 'projects' }), useNavigation: () => ({ dispatch: action => navigate('dispatch', action) }),
      useRouter: () => ({ canGoBack: () => true, back: () => navigate('back'), replace: destination => navigate('replace', destination) }) },
    '@react-navigation/native': { useIsFocused: () => focused, usePreventRemove: () => {} },
    'lucide-react-native': icons, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 21, left: 47, right: 0 }) },
    '@/components/SheetModal': { SheetCloseButton: 'sheet-close', SheetModal: props => props.visible ? props.children : null, sheetStyles: {} },
    '@/contexts/PrimaryActionContext': { usePrimaryAction: () => ({ canPublish: true, roleLoading: false }) },
    '@/features/auth/authContext': auth, '@/features/studio/media': runtime.media, '@/features/studio/model': model,
    '../../modules/classfy-studio-media': bridge, '@/features/studio/store': runtime.store,
    '@/features/studio/useStudioProjects': projectHook,
    '@/features/studio/useStudioOrientation': { useStudioOrientation: () => ({ orientationReady: true }) },
    '@/features/studio/StudioCaptureCamera': controls,
    '@/features/studio/StudioCaptureZoom': { StudioCaptureFrame: 'camera-frame', StudioCaptureZoom: 'zoom-control' },
    '@/features/studio/StudioCaptureTakes': takes,
    '@/features/studio/StudioCaptureScriptPanel': { StudioCaptureScriptPanel: 'script-panel' },
    '@/features/studio/StudioCaptureRecording': videoStop, '@/features/studio/StudioNativeCamera': cameraModule,
    '@/theme/colors': theme, '@/theme/controls': { controls: {} },
  }, globals).default;

  function runComponent(component, props, path) {
    let context = contexts.get(path);
    if (!context) { context = { slots: [], cursor: 0, seen: true }; contexts.set(path, context); }
    context.cursor = 0; context.seen = true;
    const previous = currentContext; currentContext = context;
    try { return component(props); } finally { currentContext = previous; }
  }
  function materialize(node, path) {
    if (Array.isArray(node)) return node.map((child, index) => materialize(child, `${path}/${child?.key ?? index}`));
    if (!node || typeof node !== 'object' || !node.type) return node;
    if (typeof node.type === 'function') return { ...node, rendered: materialize(runComponent(node.type, node.props, path), `${path}/rendered`) };
    if (node.props.ref) {
      if (node.type === 'native-camera-view') node.props.ref.current = nativeHost;
      else if (node.type === 'scroll') node.props.ref.current = { scrollTo: value => scrolls.push(value), scrollToEnd: value => scrolls.push(value) };
      else if (node.type === 'expo-camera-view') node.props.ref.current = { ...nativeHost, recordAsync: () => start(73, 'expo-record'), stopRecording: () => { void stop(73, 'expo-record'); } };
    }
    return { ...node, props: { ...node.props, children: materialize(node.props.children, `${path}/children`) } };
  }
  function render() {
    dirty = false; effects = [];
    for (const context of contexts.values()) context.seen = false;
    tree = materialize(runComponent(screen, {}, 'screen'), 'tree');
    for (const [path, context] of contexts) if (!context.seen) {
      for (const value of context.slots) value?.cleanup?.();
      contexts.delete(path);
    }
    for (const effect of effects) {
      effect.context.slots[effect.index]?.cleanup?.();
      effect.context.slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() };
    }
  }
  async function pump() {
    let clean = 0;
    for (let pass = 0; pass < 40; pass++) {
      if (dirty) { render(); clean = 0; }
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty && ++clean >= 2) return;
    }
    throw Error('Capture React runtime did not settle');
  }
  function nodes(predicate = () => true) {
    const found = [];
    const visit = node => {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node || typeof node !== 'object') return;
      if (predicate(node)) found.push(node);
      if (typeof node.type === 'function') visit(node.rendered); else visit(node.props?.children);
    };
    visit(tree); return found;
  }
  const find = predicate => { const result = nodes(predicate)[0]; assert.ok(result, 'Expected capture element'); return result; };
  async function advance(milliseconds) {
    const end = now + milliseconds;
    for (let pass = 0; pass < 500; pass++) {
      const due = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) { now = end; await pump(); return; }
      now = due[1].at;
      if (due[1].interval) due[1].at += due[1].interval; else timers.delete(due[0]);
      due[1].callback(); await pump();
    }
    throw Error('Capture timer loop did not settle');
  }
  async function ready() {
    await pump();
    const host = find(node => node.type === (options.native === false ? 'expo-camera-view' : 'native-camera-view'));
    if (options.native === false) host.props.onCameraReady(); else host.props.onReady({ nativeEvent: snapshot() });
    await pump();
  }
  const current = () => runtime.store.getStudioProject('owner', id);
  return {
    runtime, calls, alerts, navigation, pump, ready, advance, nodes, find, current,
    button: label => {
      const button = nodes(node => node.type === 'button' && node.props.accessibilityLabel === label)[0];
      assert.ok(button, `Expected ${label}; present buttons: ${nodes(node => node.type === 'button').map(node => node.props.accessibilityLabel).join(', ')}`);
      return button.props;
    },
    zoom: () => find(node => node.type === 'zoom-control' && (node.props.controlName ?? 'zoom') === 'zoom').props,
    takeStrip: () => find(node => node.type === takes.StudioCaptureTakes).props,
    focus(value) { focused = value; dirty = true; },
    owner(value) { owner = value; runtime.setOwner(value); dirty = true; },
    project(value) { id = value; dirty = true; },
    background(value) { appState.currentState = value; for (const callback of appListeners) callback(value); dirty = true; },
    async confirmZoom(patch = {}) { assert.ok(zoomRequest); state = { ...state, ...patch }; const request = zoomRequest; zoomRequest = undefined; request.resolve(snapshot()); await pump(); },
    async rejectZoom() { assert.ok(zoomRequest); const request = zoomRequest; zoomRequest = undefined; request.reject(Error('A câmera interrompeu o zoom.')); await pump(); },
    async dispose() { for (const context of contexts.values()) for (const value of context.slots) value?.cleanup?.(); contexts.clear(); timers.clear(); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test('REC → STOP salva original/journal antes de restaurar miniatura e Avançar; REC mostra somente parar', async () => {
  const h = await harness();
  try {
    await h.ready();
    assert.equal(h.nodes(node => /galeria|Importar vídeos/i.test(node.props?.accessibilityLabel ?? '')).length, 0);
    h.button('Começar gravação').onPress(); await h.advance(3000);
    assert.equal(h.calls.filter(value => value.kind === 'record').length, 1);
    assert.deepEqual(h.nodes(node => node.type === 'button' && node.props.accessibilityRole === 'button').map(node => node.props.accessibilityLabel), ['Encerrar e salvar take']);
    const blocked = h.runtime.deferWrite();
    h.button('Encerrar e salvar take').onPress(); await h.pump(); await blocked.entered;
    assert.equal(h.button('Começar gravação').disabled, true);
    assert.equal(h.current().takes.length, 0);
    blocked.resolve(); await h.pump();
    assert.equal(h.current().takes.length, 1);
    assert.equal(h.current().pendingTakes.length, 0);
    assert.equal(h.takeStrip().takes[0].id, h.current().takes[0].id);
    assert.equal(h.nodes(node => node.type === 'image' && node.props.source.uri === h.current().takes[0].thumbnailUri).length, 1);
    assert.equal(h.button('Avançar para editar 1 take').disabled, false);
    assert.equal(h.button('Começar gravação').disabled, false);
    h.button('Avançar para editar 1 take').onPress(); await h.pump();
    assert.equal(h.navigation.length, 1);
    assert.equal(h.navigation[0].project.takes.length, 1);
    assert.equal(h.runtime.disk.has(h.current().takes[0].uri), true);
  } finally { await h.dispose(); }
});

test('flash fica ausente na frontal/sem torch e confirma estado real na traseira', async () => {
  const h = await harness();
  try {
    await h.ready();
    assert.equal(h.nodes(node => /Ligar luz|Desligar luz/.test(node.props?.accessibilityLabel ?? '')).length, 0);
    h.button('Alternar câmera').onPress(); await h.ready();
    h.button('Ligar luz').onPress(); await h.pump();
    assert.equal(h.calls.filter(value => value.kind === 'torch').at(-1).enabled, true);
    assert.equal(h.button('Desligar luz').disabled, false);
  } finally { await h.dispose(); }
  const unsupported = await harness({ torch: false });
  try {
    await unsupported.ready(); unsupported.button('Alternar câmera').onPress(); await unsupported.ready();
    assert.equal(unsupported.nodes(node => /Ligar luz|Desligar luz/.test(node.props?.accessibilityLabel ?? '')).length, 0);
  } finally { await unsupported.dispose(); }
});

test('zoom da rota mostra confirmação, conserva valor após erro e respeita limite confirmado', async () => {
  const h = await harness();
  try {
    await h.ready(); assert.equal(h.zoom().label, '1.0×');
    assert.equal(h.zoom().confirmedValue, 0); assert.equal(h.zoom().pending, false);
    const initialConfirmation = h.zoom().confirmation;
    assert.equal(Number.isSafeInteger(initialConfirmation), true);
    h.zoom().onChange(1); await h.pump();
    assert.equal(h.zoom().label, '1.0×', 'A requested target must not become the hardware label');
    assert.equal(h.zoom().value, 1);
    assert.equal(h.zoom().confirmedValue, 0, 'The dial must receive actual hardware position separately from its pending target');
    assert.equal(h.zoom().pending, true); assert.equal(h.zoom().confirmation, initialConfirmation);
    await h.advance(30); assert.equal(h.calls.filter(value => value.kind === 'zoom').at(-1).factor, 4);
    await h.confirmZoom({ zoom: 2.1, maxZoom: 2.1 });
    assert.equal(h.zoom().label, '2.1×'); assert.equal(h.zoom().value, 1);
    assert.equal(h.zoom().confirmedValue, 1); assert.equal(h.zoom().pending, false);
    const firstConfirmation = h.zoom().confirmation;
    assert.ok(firstConfirmation > initialConfirmation);

    h.zoom().onChange(1); await h.pump();
    assert.equal(h.zoom().confirmedValue, 1); assert.equal(h.zoom().pending, true);
    await h.advance(30); await h.confirmZoom({ zoom: 2.1, maxZoom: 2.1 });
    assert.equal(h.zoom().confirmedValue, 1); assert.equal(h.zoom().pending, false);
    const repeatedConfirmation = h.zoom().confirmation;
    assert.ok(repeatedConfirmation > firstConfirmation, 'A repeated factor still needs an ACK receipt to reconcile the dial');

    h.zoom().onChange(0); await h.pump();
    assert.equal(h.zoom().confirmedValue, 1); assert.equal(h.zoom().pending, true);
    await h.advance(30); await h.rejectZoom();
    assert.equal(h.zoom().label, '2.1×');
    assert.equal(h.zoom().confirmedValue, 1); assert.equal(h.zoom().pending, false);
    assert.ok(h.zoom().confirmation > repeatedConfirmation, 'Rejected targets must release pending state and reconcile to confirmed hardware');
    assert.equal(h.calls.filter(value => value.kind === 'zoom').at(-1).factor, 1);
  } finally { await h.dispose(); }
});

test('REC aguarda ACK do último zoom; troca de contexto durante esse await não grava', async () => {
  const h = await harness();
  try {
    await h.ready();
    h.zoom().onChange(.5);
    h.button('Começar gravação').onPress(); await h.advance(3000);
    assert.equal(h.calls.filter(value => value.kind === 'zoom').length, 1);
    assert.equal(h.calls.filter(value => value.kind === 'record').length, 0, 'REC cannot run while its final hardware target is pending');
    await h.confirmZoom({ zoom: 2 });
    assert.equal(h.calls.filter(value => value.kind === 'record').length, 1);
    h.button('Encerrar e salvar take').onPress(); await h.pump();
    assert.equal(h.current().takes.length, 1);
  } finally { await h.dispose(); }

  const interrupted = await harness();
  try {
    await interrupted.ready(); interrupted.zoom().onChange(.5);
    interrupted.button('Começar gravação').onPress(); await interrupted.advance(3000);
    assert.equal(interrupted.calls.filter(value => value.kind === 'record').length, 0);
    interrupted.focus(false); await interrupted.pump();
    await interrupted.confirmZoom({ zoom: 2 });
    assert.equal(interrupted.calls.filter(value => value.kind === 'record').length, 0, 'Late prepare must not record after focus cancellation');
    assert.equal(interrupted.current().takes.length, 0);
  } finally { await interrupted.dispose(); }
});

test('callbacks antigos de Avançar/REC não atravessam save, foco, conta nem troca de projeto', async () => {
  const h = await harness({ seed: true });
  try {
    await h.ready();
    const oldContinue = h.button('Avançar para editar 1 take').onPress;
    const oldRecord = h.button('Começar gravação').onPress;
    h.focus(false); await h.pump(); oldContinue(); oldRecord(); await h.pump();
    assert.equal(h.navigation.length, 0); assert.equal(h.calls.filter(value => value.kind === 'record').length, 0);
    h.focus(true); await h.ready();
    const another = await h.runtime.store.createStudioProject('owner', 'aula', { transient: true });
    h.project(another.id); await h.ready(); oldContinue(); oldRecord(); await h.advance(3000);
    assert.equal(h.navigation.length, 0); assert.equal(h.calls.filter(value => value.kind === 'record').length, 0, 'Old REC must not save into a different project');
    h.owner('another-owner'); await h.pump(); oldContinue(); oldRecord(); await h.pump();
    assert.equal(h.navigation.length, 0); assert.equal(h.calls.filter(value => value.kind === 'record').length, 0);
  } finally { await h.dispose(); }
});

test('Avançar capturado antes do REC aguarda save; callback REC antigo não cria uma segunda operação', async () => {
  const h = await harness({ seed: true });
  try {
    await h.ready();
    const continueBeforeREC = h.button('Avançar para editar 1 take').onPress;
    const recordBeforeREC = h.button('Começar gravação').onPress;
    recordBeforeREC(); await h.advance(3000);
    const blocked = h.runtime.deferWrite();
    h.button('Encerrar e salvar take').onPress(); await h.pump(); await blocked.entered;
    continueBeforeREC(); recordBeforeREC(); await h.pump();
    assert.equal(h.navigation.length, 0); assert.equal(h.calls.filter(value => value.kind === 'record').length, 1);
    assert.equal(h.takeStrip().disabled, true); assert.equal(h.takeStrip().takes.length, 1);
    blocked.resolve(); await h.pump();
    assert.equal(h.takeStrip().takes.length, 2); assert.equal(h.takeStrip().disabled, false);
    h.button('Avançar para editar 2 takes').onPress(); await h.pump();
    assert.equal(h.navigation.length, 1); assert.equal(h.navigation[0].project.takes.length, 2);
  } finally { await h.dispose(); }
});

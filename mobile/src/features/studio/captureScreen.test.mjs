import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createJourneyRuntime } from './editorJourneyHarness.mjs';
import * as model from './model.ts';
import * as timeline from './timeline.ts';
import * as speechTracking from './StudioTeleprompterTracking.ts';
import * as prompterLayout from './StudioTeleprompterLayout.ts';
import { mergeStudioCameraProSettings } from './cameraProSettings.ts';
import * as monitorModel from './cameraMonitorModel.ts';
import * as monitorKeepAwake from './cameraMonitorKeepAwake.ts';

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
  let project = await runtime.store.createStudioProject('owner', options.projectKind || 'aula', { transient: true });
  if (options.seed) {
    const uri = runtime.fixture('seed.mov', { duration: 2 });
    const take = await runtime.media.persistStudioTake(project, { uri, name: 'Take inicial' });
    project = await runtime.store.updateStudioProject('owner', project.id, { takes: [take] });
  }
  let id = project.id, owner = 'owner', focused = true, now = 0, timerId = 0, premium = options.premium;
  let currentContext, dirty = true, effects = [], tree, nativeRecord, zoomRequest, removal;
  let windowDimensions = options.projectKind === 'short' || options.projectKind === 'podcast'
    ? { width: 393, height: 852 } : { width: 844, height: 390 };
  const contexts = new Map(), timers = new Map(), appListeners = new Set(), orientationListeners = new Set();
  const navigation = [], calls = [], alerts = [], scrolls = [], exits = [], screenOptions = [];
  const keyboardListeners = new Map();
  let keyboardVisible = false;
  const keyboard = visible => {
    keyboardVisible = visible;
    for (const callback of keyboardListeners.get(visible ? 'keyboardWillShow' : 'keyboardWillHide') || []) callback();
    dirty = true;
  };
  const prepareForExit = () => {
    const request = { owner, id, focused, foreground: appState.currentState };
    exits.push(request);
    if (!options.deferExit) return Promise.resolve(true);
    return new Promise((resolve, reject) => Object.assign(request, { resolve, reject }));
  };
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
    memo: callback => callback,
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
    KeyboardAvoidingView: 'keyboard', Linking: { openSettings: async () => {} }, Platform: { OS: options.platform || 'ios' },
    Keyboard: { dismiss: () => keyboard(false), isVisible: () => keyboardVisible,
      addListener: (name, callback) => { const values = keyboardListeners.get(name) || new Set(); values.add(callback); keyboardListeners.set(name, values); return { remove: () => values.delete(callback) }; } },
    Pressable: 'button', ScrollView: 'scroll', Text: 'text', TextInput: 'input', TouchableWithoutFeedback: 'touch-dismiss', View: 'view',
    StyleSheet: { create: styles => styles, absoluteFillObject: {}, absoluteFill: {} },
    findNodeHandle: view => view?.tag ?? null,
    useWindowDimensions: () => windowDimensions,
  };
  let state = {
    deviceId: 'qa-camera', position: 'front', qualities: [
      { quality: '720p', width: 1280, height: 720, fps: [24, 30] },
      { quality: '1080p', width: 1920, height: 1080, fps: [24, 30, 60] },
      ...(options.twoK ? [{ quality: '1440p', width: 2560, height: 1440, fps: [24, 30] }] : []),
      { quality: '2160p', width: 3840, height: 2160, fps: [24, 30] },
    ], quality: '1080p', fps: 30, width: 1920, height: 1080, minZoom: 1, maxZoom: 4, zoom: 1,
    minExposure: -2, maxExposure: 2, exposure: 0, aperture: 1.8,
    supportsFocus: true, supportsFocusLock: true, supportsExposure: true, supportsExposureLock: true,
    supportsTorch: false, focusLocked: false, exposureLocked: false, torchEnabled: false, isRecording: false,
    generation: 1, revision: 1, orientation: 'landscapeLeft', previewProcessed: false,
  };
  const capturedUri = runtime.fixture('captured.mov', { duration: 3.2, ...(options.downsampleFailure ? { width:3840, height:2160 } : {}) });
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
      if (options.downsampleFailure) {
        find(node => node.type === 'native-camera-view').props.onRecordingState({ nativeEvent: {
          operationId, phase:'finished', generation:state.generation, revision:state.revision, recoveryUri:capturedUri,
          error:'Não foi possível finalizar o take em 2K. O original 4K continua disponível.',
        } });
        nativeRecord.reject(Error('Não foi possível finalizar o take em 2K. O original 4K continua disponível.'));
      } else nativeRecord.resolve({ uri: capturedUri, duration: 3.2, operationId, frameRate: 30, sourceKind: 'standard', sourceStage: 'standard' });
      nativeRecord = undefined;
    }
    return snapshot();
  };
  const bridge = {
    isStudioNativeCameraAvailable: () => options.native !== false,
    isStudioNativeCameraEffectsAvailable: () => false,
    isStudioNativeCameraAudioMonitorAvailable: () => options.audioMonitor === true,
    isStudioRemoteCameraAvailable: () => options.monitor !== false,
    isStudioNativeCameraSpeechAvailable: () => options.speech === true,
    requestStudioCaptureSpeechPermissionAsync: async () => {
      calls.push({ kind: 'speech-permission' }); return { granted: options.speechDenied !== true, canAskAgain: true };
    },
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
  const iconNames = 'Camera Check ChevronRight Eye FileText Mic Minus Monitor Palette Pause Play Plus SlidersHorizontal Square SwitchCamera Timer X Zap ZapOff Video';
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
    '../../../modules/classfy-studio-media': bridge, './StudioNativeCamera': cameraModule, './cameraProSettings': { mergeStudioCameraProSettings },
  }, globals);
  const audioMonitor = load('./StudioCaptureAudio.ts', { react: hooks }, globals);
  const teleprompter = load('./StudioTeleprompter.tsx', {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'react-native': native, 'lucide-react-native': icons,
    './StudioTeleprompterLayout': prompterLayout,
  }, globals);
  const teleprompterSpeech = load('./useStudioTeleprompterSpeech.ts', {
    react: hooks, 'react-native': native, '../../../modules/classfy-studio-media': bridge,
    './StudioTeleprompterTracking': speechTracking,
  }, globals);
  const takes = load('./StudioCaptureTakes.tsx', {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'react-native': native, 'lucide-react-native': icons,
    '@/components/LoadingImage': { LoadingImage: 'image' }, '@/theme/colors': theme, './model': model,
  });
  const auth = { useAuth: () => ({ user: { id: owner }, profile: { plan: premium ? 'premium' : 'free', entitlement_source: 'admin',
    plan_expires_at: '2099-01-01T00:00:00Z' } }) };
  const monitorPublisher = load('./cameraMonitorPublisher.ts', { './cameraMonitorModel': monitorModel }, globals);
  const monitorHook = load('./useStudioCameraMonitor.ts', { react: hooks, 'expo-crypto': { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    'expo-keep-awake': { activateKeepAwakeAsync: async tag => { calls.push({ kind: 'monitor-keep-awake', tag }); },
      deactivateKeepAwake: async tag => { calls.push({ kind: 'monitor-release-screen', tag }); } },
    './cameraMonitorKeepAwake': monitorKeepAwake,
    './remoteCameraRuntime': { remoteCameraDeviceId: async () => '22222222-2222-4222-8222-222222222222' },
    './cameraMonitorPublisher': monitorPublisher, './StudioNativeCamera': cameraModule,
    './cameraMonitorApi': { requestStudioCameraMonitor: async (requestOwner, action, body, scope) => {
      calls.push({ kind: 'monitor-api', action, body: structuredClone(body), owner: requestOwner });
      await options.monitorRequest?.(action, body);
      assert.equal(scope.isCurrent(), true);
      return { monitor: { id: body.sessionId, ownerId: requestOwner, deviceId: body.deviceId || body.clientId, status: action === 'monitor-close' ? 'closed' : 'active' },
        serverAt: new Date(now).toISOString(), ...(action === 'monitor-connect' ? { connection: { url: 'wss://test.invalid', token: 'test-only', identity: 'device' } } : {}) };
    } },
    './cameraMonitorTransport': { createStudioMonitorPreviewTransport: notify => ({ connect: async tag => {
      calls.push({ kind: 'monitor-preview', tag }); notify({ connected: true, reconnecting: false, viewerPresent: false });
    }, disconnect: async () => { calls.push({ kind: 'monitor-preview-stop' }); } }) },
  }, globals);
  const monitorPanel = load('./StudioCameraMonitorPanel.tsx', { 'react/jsx-runtime': jsxRuntime, 'react-native': native, 'lucide-react-native': icons,
    '@/components/PlanCrown': { PlanCrown: 'plan-crown' }, './cameraMonitorModel': monitorModel, '@/theme/colors': theme,
    './StudioUI': { StudioButton: props => jsx('button', { ...props, accessibilityLabel: props.label }) },
  });
  const captureSheet = load('./StudioCaptureSheet.tsx', {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'react-native': native, '@/theme/colors': theme,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 21, left: 47, right: 0 }) },
    '@/components/SheetModal': { SheetCloseButton: 'sheet-close', SheetModal: props => props.visible ? props.children : null, sheetStyles: {} },
  });
  const scriptPanel = load('./StudioCaptureScriptPanel.tsx', {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'react-native': native, 'lucide-react-native': icons,
    '@/features/auth/authContext': auth, '@/theme/colors': theme, './store': runtime.store,
    './StudioUI': { StudioField: props => jsx('input', { ...props, accessibilityLabel: props.label }),
      StudioButton: props => jsx('button', { ...props, accessibilityLabel: props.label, disabled: props.disabled || props.loading }), studioStyles: {} },
  });
  const projectHook = load('./useStudioProjects.ts', {
    react: hooks, '@/features/auth/authContext': auth, './store': runtime.store,
    './workspaceActions': { duplicateStudioProject: undefined, renameStudioProject: undefined },
  });
  const videoStop = load('./StudioCaptureRecording.ts', {}, globals);
  const navigate = (kind, destination) => navigation.push({ kind, destination, project: runtime.store.getStudioProject(owner, id) });
  const guardedNavigate = (kind, destination, action) => {
    if (removal?.enabled) removal.callback({ data: { action } });
    else navigate(kind, destination);
  };
  const nativeNavigation = {
    dispatch: action => guardedNavigate('dispatch', action, action), setOptions: value => screenOptions.push(value),
  };
  const screen = load('../../../app/studio/capture.tsx', {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'react-native': native,
    'expo-av': { Audio: { setAudioModeAsync: async () => {}, Recording: class {} } },
    'expo-camera': { CameraView: 'expo-camera-view', useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })], useMicrophonePermissions: () => [{ granted: true }, async () => ({ granted: true })] },
    'expo-device': { isDevice: true }, 'expo-screen-orientation': orientation,
    'expo-linear-gradient': { LinearGradient: 'gradient' }, 'expo-status-bar': { StatusBar: 'status' },
    'expo-router': { useLocalSearchParams: () => ({ id, from: options.from === null ? undefined : options.from || 'projects' }), useNavigation: () => nativeNavigation,
      useRouter: () => ({ canGoBack: () => options.canGoBack !== false,
        push: destination => guardedNavigate('push', destination, { type: 'PUSH', payload: destination }),
        back: () => guardedNavigate('back', undefined, { type: 'GO_BACK' }),
        replace: destination => guardedNavigate('replace', destination, { type: 'REPLACE', payload: destination }),
      }) },
    '@react-navigation/native': { useIsFocused: () => focused, usePreventRemove: (enabled, callback) => { removal = { enabled, callback }; } },
    'lucide-react-native': icons, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 21, left: 47, right: 0 }) },
    '@/features/studio/StudioCaptureSheet': captureSheet,
    '@/contexts/PrimaryActionContext': { usePrimaryAction: () => ({ canPublish: true, roleLoading: false }) },
    '@/features/auth/authContext': auth, '@/features/studio/media': runtime.media, '@/features/studio/model': model,
    '../../modules/classfy-studio-media': bridge, '@/features/studio/store': runtime.store,
    '@/features/studio/useStudioProjects': projectHook,
    '@/features/studio/useStudioOrientation': { useStudioOrientation: () => ({ orientationReady: true, prepareForExit }) },
    '@/features/studio/StudioCaptureCamera': controls,
    '@/features/studio/StudioCaptureZoom': { StudioCaptureFrame: 'camera-frame', StudioCaptureZoom: 'zoom-control' },
    '@/features/studio/StudioCaptureTakes': takes,
    '@/features/studio/StudioCaptureAudio': audioMonitor,
    '@/features/studio/StudioCaptureAudioMonitor': { StudioCaptureAudioMonitor: 'audio-monitor' },
    '@/features/studio/StudioCaptureProControls': { StudioCaptureProControls: 'pro-controls' },
    '@/features/studio/StudioCaptureScriptPanel': scriptPanel,
    '@/features/studio/StudioCameraMonitorPanel': monitorPanel,
    '@/features/studio/useStudioCameraMonitor': monitorHook,
    '@/features/studio/cameraMonitorModel': monitorModel,
    '@/components/PlanCrown': { PlanCrown: 'plan-crown' },
    '@/features/studio/StudioTeleprompter': teleprompter,
    '@/features/studio/StudioTeleprompterLayout': prompterLayout,
    '@/features/studio/useStudioTeleprompterSpeech': teleprompterSpeech,
    '@/features/studio/StudioCaptureRecording': videoStop, '@/features/studio/StudioNativeCamera': cameraModule,
    '@/features/studio/timeline': timeline,
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
    runtime, calls, alerts, navigation, exits, screenOptions, scrolls, pump, ready, advance, nodes, find, current, keyboard,
    keyboardVisible: () => keyboardVisible,
    button: label => {
      const button = nodes(node => node.type === 'button' && node.props.accessibilityLabel === label)[0];
      assert.ok(button, `Expected ${label}; present buttons: ${nodes(node => node.type === 'button').map(node => node.props.accessibilityLabel).join(', ')}`);
      return button.props;
    },
    zoom: () => find(node => node.type === 'zoom-control' && (node.props.controlName ?? 'zoom') === 'zoom').props,
    takeStrip: () => find(node => node.type === takes.StudioCaptureTakes).props,
    audioMonitor: () => find(node => node.type === 'audio-monitor').props,
    focus(value) { focused = value; dirty = true; },
    owner(value) { owner = value; runtime.setOwner(value); dirty = true; },
    project(value) { id = value; dirty = true; },
    dimensions(value) { windowDimensions = value; dirty = true; },
    nativeTag(value) { nativeHost.tag = value; },
    premium(value) { premium = value; dirty = true; },
    async recordingEvent(patch = {}) {
      assert.ok(nativeRecord);
      find(node => node.type === 'native-camera-view').props.onRecordingState({ nativeEvent: {
        operationId: nativeRecord.operationId, phase: 'recording', generation: state.generation, revision: state.revision,
        startedAtEpochMs: now, ...patch,
      } }); await pump();
    },
    async confirmExit(result = true) { assert.equal(typeof exits.at(-1)?.resolve, 'function'); exits.at(-1).resolve(result); await pump(); },
    async rejectExit() { assert.equal(typeof exits.at(-1)?.reject, 'function'); exits.at(-1).reject(Error('A orientação não foi confirmada.')); await pump(); },
    requestRemoval(action = { type: 'GO_BACK' }) {
      assert.ok(removal, 'The real route must register its removal policy');
      guardedNavigate('dispatch', action, action);
    },
    background(value) { appState.currentState = value; for (const callback of appListeners) callback(value); dirty = true; },
    async audioEvent(patch = {}) {
      const host = find(node => node.type === 'native-camera-view');
      host.props.onAudioMonitor?.({ nativeEvent: { version: 1, generation: state.generation, revision: state.revision,
        sequence: 1, timestampMs: now, active: true, input: { id: 'qa-mic', name: 'Microfone confirmado', type: 'MicrophoneBuiltIn' },
        channels: [{ averageDb: -24, peakDb: -8 }], sampleRate: 48000, channelCount: 1, ageMs: 0, ...patch } });
      await pump();
    },
    async speechEvent(transcript, patch = {}) {
      const host = find(node => node.type === 'native-camera-view');
      host.props.onSpeech?.({ nativeEvent: { sessionId: host.props.speechSessionId, generation: state.generation,
        sequence: calls.filter(value => value.kind === 'speech-event').length + 1, segmentId: 1, type: 'result', transcript, isFinal: false, ...patch } });
      calls.push({ kind: 'speech-event' }); await pump();
    },
    async confirmZoom(patch = {}) { assert.ok(zoomRequest); state = { ...state, ...patch }; const request = zoomRequest; zoomRequest = undefined; request.resolve(snapshot()); await pump(); },
    async rejectZoom() { assert.ok(zoomRequest); const request = zoomRequest; zoomRequest = undefined; request.reject(Error('A câmera interrompeu o zoom.')); await pump(); },
    async dispose() { for (const context of contexts.values()) for (const value of context.slots) value?.cleanup?.(); contexts.clear(); timers.clear(); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test('monitor Premium parte da captura normal, REC confirmado e encerrar prévia não interrompe o original', async () => {
  for (const projectKind of ['aula', 'short']) {
    const h = await harness({ premium: true, projectKind });
    try {
      await h.ready();
      const nativeView = h.find(node => node.type === 'native-camera-view').props.ref;
      const configureCount = h.calls.filter(value => value.kind === 'configure').length;
      h.button('Ver no computador').onPress(); await h.pump();
      const panelNodes = h.nodes();
      const toggleIndex = panelNodes.findIndex(node => node.props?.accessibilityLabel === 'Visualizar no computador');
      const addressIndex = panelNodes.findIndex(node => String(node.props?.accessibilityLabel || '').startsWith('Endereço do monitor:'));
      assert.ok(toggleIndex > -1 && addressIndex > toggleIndex, 'The main action precedes connection instructions in both orientations');
      assert.equal(h.calls.filter(value => value.kind === 'monitor-api').length, 0, 'Opening the sheet never starts sharing');
      assert.equal(h.calls.filter(value => value.kind === 'monitor-keep-awake').length, 0);
      h.button('Visualizar no computador').onPress(); await h.pump();
      assert.equal(h.calls.filter(value => value.kind === 'monitor-keep-awake').length, 1);
      assert.equal(h.find(node => node.type === 'native-camera-view').props.ref, nativeView);
      assert.equal(h.calls.filter(value => value.kind === 'configure').length, configureCount);
      assert.equal(h.calls.filter(value => value.kind === 'record').length, 0);
      assert.equal(h.calls.find(value => value.kind === 'monitor-preview').tag, 73);
      h.find(node => node.type === 'sheet-close').props.onPress(); await h.pump();
      h.button('Começar gravação').onPress(); await h.advance(3000);
      assert.equal(h.calls.filter(value => value.kind === 'record').length, 1);
      assert.equal(h.calls.filter(value => value.kind === 'monitor-api' && value.action === 'monitor-heartbeat').at(-1).body.state.recording, false);
      await h.recordingEvent();
      assert.equal(h.calls.filter(value => value.kind === 'monitor-api' && value.action === 'monitor-heartbeat').at(-1).body.state.recording, true);
      h.button('Ver no computador').onPress(); await h.pump();
      assert.equal(h.button('Visualizar no computador').accessibilityState.checked, true);
      h.button('Visualizar no computador').onPress(); await h.pump();
      assert.equal(h.calls.filter(value => value.kind === 'stop').length, 0, 'Stopping the monitor cannot stop REC');
      assert.equal(h.calls.filter(value => value.kind === 'monitor-preview-stop').length, 1);
      assert.equal(h.calls.filter(value => value.kind === 'monitor-release-screen').length, 1);
      h.find(node => node.type === 'sheet-close').props.onPress(); await h.pump();
      h.button('Encerrar e salvar take').onPress(); await h.pump();
      assert.equal(h.current().takes.length, 1);
      assert.equal(h.current().pendingTakes.length, 0);
    } finally { await h.dispose(); }
  }
});

test('conta Free vê oferta e câmera antiga vê atualização sem publicar pista nem iniciar take', async () => {
  for (const options of [{ premium: false }, { premium: true, monitor: false }]) {
    const h = await harness(options);
    try {
      await h.ready(); h.button('Ver no computador').onPress(); await h.pump();
      assert.equal(h.calls.filter(value => value.kind.startsWith('monitor-')).length, 0);
      assert.equal(h.calls.filter(value => value.kind === 'record').length, 0);
      if (!options.premium) assert.ok(h.button('Conhecer o Premium'));
      else assert.equal(h.nodes(node => node.type === 'button' && node.props.accessibilityLabel === 'Visualizar no computador').length, 0);
    } finally { await h.dispose(); }
  }
});

test('monitor reatacha câmera traseira sem reabrir sessão; sair da captura fecha somente a prévia', async () => {
  const h = await harness({ premium: true });
  try {
    await h.ready(); h.button('Ver no computador').onPress(); await h.pump();
    h.button('Visualizar no computador').onPress(); await h.pump();
    h.find(node => node.type === 'sheet-close').props.onPress(); await h.pump();
    h.button('Alternar câmera').onPress(); h.nativeTag(99); await h.ready();
    assert.deepEqual(h.calls.filter(value => value.kind === 'monitor-preview').map(value => value.tag), [73, 99]);
    assert.equal(h.calls.filter(value => value.kind === 'monitor-api' && value.action === 'monitor-create').length, 1);
    const previousStops = h.calls.filter(value => value.kind === 'monitor-preview-stop').length;
    h.focus(false); await h.pump();
    assert.ok(h.calls.filter(value => value.kind === 'monitor-preview-stop').length > previousStops);
    const screenTag = h.calls.find(value => value.kind === 'monitor-keep-awake').tag;
    assert.equal(h.calls.find(value => value.kind === 'monitor-release-screen').tag, screenTag);
    assert.equal(h.calls.filter(value => value.kind === 'stop').length, 0);
  } finally { await h.dispose(); }
});

test('monitor é iOS-only e plano revogado durante REC não permite oferta sair da captura', async () => {
  const android = await harness({ platform: 'android', native: false, premium: true });
  try { await android.pump(); assert.equal(android.nodes(node => node.props?.accessibilityLabel === 'Ver no computador').length, 0); }
  finally { await android.dispose(); }
  const h = await harness({ premium: true });
  try {
    await h.ready(); h.button('Ver no computador').onPress(); await h.pump();
    h.button('Visualizar no computador').onPress(); await h.pump();
    h.find(node => node.type === 'sheet-close').props.onPress(); await h.pump();
    h.button('Começar gravação').onPress(); await h.advance(3000); await h.recordingEvent();
    h.button('Ver no computador').onPress(); await h.pump(); h.premium(false); await h.pump();
    const offer = h.button('Conhecer o Premium'); assert.equal(offer.disabled, true);
    offer.onPress(); await h.pump(); assert.equal(h.navigation.length, 0);
    assert.equal(h.calls.filter(value => value.kind === 'stop').length, 0);
    h.find(node => node.type === 'sheet-close').props.onPress(); await h.pump();
    h.button('Encerrar e salvar take').onPress(); await h.pump(); assert.equal(h.current().takes.length, 1);
  } finally { await h.dispose(); }
});

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

test('teleprompter de voz ensaia, acompanha palavras, espera no silêncio e pausa sem parar REC em Aula e Short', async () => {
  for (const projectKind of ['aula', 'short']) {
    const h = await harness({ projectKind, speech: true });
    try {
      const script = 'A espiritualidade começa com uma conexão interior. A meditação ajuda a encontrar a paz.';
      await h.runtime.store.updateStudioProject('owner', h.current().id, { script });
      await h.ready();
      const scroll = () => h.find(node => node.type === 'scroll' && node.props.onScrollBeginDrag).props;
      const props = () => h.find(node => node.type?.name === 'StudioTeleprompter').props;
      const ref = scroll().ref;
      const block = () => h.find(node => node.type === 'text' && node.props.onTextLayout).props;
      const position = h.find(node => node.type === 'view' && node.props.testID === 'studio-teleprompter').props.style[1];
      if (projectKind === 'short') {
        assert.equal(position.left + position.width / 2, 393 / 2, 'Portrait reading is centered on the camera axis despite unequal safe insets');
        assert.equal(position.top, 90, 'The monitor no longer pushes the script down');
      }
      scroll().onLayout({ nativeEvent: { layout: { height: 100 } } });
      scroll().onContentSizeChange(300, 400);
      h.find(node => node.type === 'view' && node.props.onLayout && node.props.children?.props?.onTextLayout).props.onLayout({ nativeEvent: { layout: { y: 0 } } });
      block().onTextLayout({ nativeEvent: { lines: [
        { text: 'A espiritualidade começa com uma', y: 0, height: 32 },
        { text: 'conexão interior. A meditação ajuda', y: 32, height: 32 },
        { text: 'a encontrar a paz.', y: 64, height: 32 },
      ] } });
      assert.equal(props().mode, 'voice'); assert.equal(props().playing, false);
      await h.advance(1000); assert.equal(props().readWordCount, 0);
      h.button('Ensaiar roteiro com minha voz').onPress(); await h.pump();
      assert.equal(h.calls.filter(value => value.kind === 'speech-permission').length, 1);
      assert.equal(h.find(node => node.type === 'native-camera-view').props.speechEnabled, true);
      await h.speechEvent('A espiritualidade começa com uma');
      assert.equal(props().readWordCount, 5);
      const red = h.find(node => node.type === 'text' && node.props.style?.color === '#FB5672');
      assert.equal(red.props.children, 'A espiritualidade começa com uma');
      const offset = h.scrolls.at(-1).y;
      await h.advance(2000); assert.equal(props().readWordCount, 5); assert.equal(h.scrolls.at(-1).y, offset, 'Silence does not advance the voice reader');
      h.button('Começar gravação').onPress(); await h.advance(3000);
      assert.equal(scroll().ref, ref); assert.equal(props().readWordCount, 0, 'A fresh take clears the rehearsal highlighting');
      assert.equal(h.calls.filter(value => value.kind === 'speech-permission').length, 1, 'REC never opens a permission dialog');
      assert.deepEqual(h.nodes(node => node.type === 'button' && node.props.accessibilityRole === 'button').map(node => node.props.accessibilityLabel), ['Pausar leitura do roteiro', 'Encerrar e salvar take']);
      await h.speechEvent('A espiritualidade começa com uma conexão interior');
      assert.equal(props().readWordCount, 7);
      h.button('Pausar leitura do roteiro').onPress(); await h.pump();
      await h.speechEvent('A meditação ajuda a encontrar a paz', { segmentId: 2 });
      assert.equal(props().readWordCount, 7, 'Paused speech events cannot mark words');
      assert.equal(h.calls.filter(value => value.kind === 'stop').length, 0);
      h.button('Ensaiar roteiro com minha voz').onPress(); await h.pump();
      await h.speechEvent('A meditação ajuda a encontrar a paz', { segmentId: 2 });
      assert.equal(props().readWordCount, 14);
      h.button('Encerrar e salvar take').onPress(); await h.pump();
      assert.equal(h.current().takes.length, 1); assert.equal(props().playing, false);
      assert.equal(h.button('Abrir teleprompter').disabled, false);
    } finally { await h.dispose(); }
  }
});

test('build antigo e autorização negada não usam avanço por tempo; velocidade fixa exige escolha explícita', async () => {
  for (const options of [{ speech: false }, { speech: true, speechDenied: true }]) {
    const h = await harness(options);
    try {
      await h.runtime.store.updateStudioProject('owner', h.current().id, { script: 'Um roteiro sobre a nossa conexão interior.' });
      await h.ready();
      const props = () => h.find(node => node.type?.name === 'StudioTeleprompter').props;
      if (options.speech) { h.button('Ensaiar roteiro com minha voz').onPress(); await h.pump(); }
      else assert.equal(h.button('Ensaiar roteiro com minha voz').disabled, true);
      h.button('Começar gravação').onPress(); await h.advance(4000);
      assert.equal(props().readWordCount, 0); assert.equal(props().playing, false);
      assert.equal(h.calls.filter(value => value.kind === 'speech-permission').length, options.speech ? 1 : 0);
      h.button('Encerrar e salvar take').onPress(); await h.pump();
      h.button('Abrir teleprompter').onPress(); await h.pump();
      h.button('Usar velocidade fixa').onPress(); await h.pump();
      h.find(node => node.type === 'sheet-close').props.onPress(); await h.pump();
      assert.equal(props().mode, 'automatic'); assert.equal(props().playing, false);
      const scroll = h.find(node => node.type === 'scroll' && node.props.onScrollBeginDrag).props;
      scroll.onLayout({ nativeEvent: { layout: { height: 100 } } }); scroll.onContentSizeChange(300, 600);
      h.button('Ativar leitura em velocidade fixa').onPress(); await h.pump(); await h.advance(1000);
      assert.ok(h.scrolls.at(-1).y > 20 && h.scrolls.at(-1).y < 40);
      assert.equal(props().readWordCount, 0, 'Timer mode does not pretend words were spoken');
    } finally { await h.dispose(); }
  }
});

test('eventos de layout do roteiro anterior não movem a nova leitura; arrastar pausa a voz sem parar a câmera', async () => {
  const h = await harness({ speech: true, projectKind: 'short' });
  try {
    await h.runtime.store.updateStudioProject('owner', h.current().id, { script: 'Uma conexão interior aparece durante a meditação.' });
    await h.ready(); h.button('Ensaiar roteiro com minha voz').onPress(); await h.pump();
    const oldText = h.find(node => node.type === 'text' && node.props.onTextLayout).props;
    const oldBlock = h.find(node => node.type === 'view' && node.props.onLayout && node.props.children?.props?.onTextLayout).props;
    await h.runtime.store.updateStudioProject('owner', h.current().id, { script: 'A gratidão transforma nossa conexão interior todos os dias.' });
    await h.pump();
    const scroll = () => h.find(node => node.type === 'scroll' && node.props.onScrollBeginDrag).props;
    scroll().onLayout({ nativeEvent: { layout: { height: 100 } } }); scroll().onContentSizeChange(300, 800);
    oldBlock.onLayout({ nativeEvent: { layout: { y: 600 } } });
    oldText.onTextLayout({ nativeEvent: { lines: [{ text: 'Uma conexão interior aparece durante a meditação.', y: 0, height: 32 }] } });
    await h.speechEvent('A gratidão transforma nossa');
    assert.equal(h.scrolls.at(-1).y, 0, 'Old block-key0 events cannot supply measurements for a new script');
    const block = h.find(node => node.type === 'view' && node.props.onLayout && node.props.children?.props?.onTextLayout).props;
    block.onLayout({ nativeEvent: { layout: { y: 0 } } });
    const text = h.find(node => node.type === 'text' && node.props.onTextLayout).props;
    text.onTextLayout({ nativeEvent: { lines: [{ text: 'A gratidão transforma nossa', y: 0, height: 32 }, { text: 'conexão interior todos os dias.', y: 32, height: 32 }] } });
    assert.equal(h.scrolls.at(-1).y, 32);
    scroll().onScrollBeginDrag(); await h.pump();
    assert.equal(h.find(node => node.type === 'native-camera-view').props.speechEnabled, false);
    assert.equal(h.calls.filter(value => value.kind === 'stop').length, 0);
  } finally { await h.dispose(); }
});

test('roteiro ocultado pelo usuário continua oculto durante REC', async () => {
  const h = await harness();
  try {
    await h.runtime.store.updateStudioProject('owner', h.current().id, { script: 'Meu roteiro' });
    await h.ready(); h.button('Abrir teleprompter').onPress(); await h.pump();
    const show = h.find(node => node.type === 'button' && node.props.accessibilityRole === 'switch'
      && node.props.children?.[0]?.props?.children === 'Mostrar roteiro');
    show.props.onPress(); await h.pump();
    h.find(node => node.type === 'sheet-close').props.onPress(); await h.pump();
    h.button('Começar gravação').onPress(); await h.advance(3000);
    assert.equal(h.nodes(node => node.type === 'scroll' && node.props.onScrollBeginDrag).length, 0);
    assert.deepEqual(h.nodes(node => node.type === 'button' && node.props.accessibilityRole === 'button').map(node => node.props.accessibilityLabel), ['Encerrar e salvar take']);
    h.button('Encerrar e salvar take').onPress(); await h.pump();
  } finally { await h.dispose(); }
});

test('teclado do roteiro recolhe sem perder draft; aplicar salva, X e fundo fecham sem alterar o roteiro salvo', async () => {
  for (const projectKind of ['aula', 'short']) {
    const h = await harness({ projectKind });
    try {
      await h.ready(); h.button('Abrir teleprompter').onPress(); await h.pump();
      const input = () => h.find(node => node.type === 'input' && node.props.accessibilityLabel === 'Seu guia de gravação').props;
      input().onChangeText('Roteiro que estou escrevendo'); h.keyboard(true); await h.pump();
      h.button('Concluir digitação do roteiro').onPress(); await h.pump();
      assert.equal(h.keyboardVisible(), false); assert.equal(input().value, 'Roteiro que estou escrevendo');
      h.keyboard(true); await h.pump();
      h.button('Recolher teclado do roteiro').onPress(); await h.pump();
      assert.equal(h.keyboardVisible(), false); assert.equal(input().value, 'Roteiro que estou escrevendo', 'First background tap must preserve the open draft');
      h.keyboard(true); await h.pump();
      h.find(node => node.type === 'touch-dismiss').props.onPress(); await h.pump();
      assert.equal(h.keyboardVisible(), false); assert.equal(input().value, 'Roteiro que estou escrevendo');
      h.button('Usar este roteiro').onPress(); await h.pump();
      assert.equal(h.current().script, 'Roteiro que estou escrevendo');
      assert.equal(h.nodes(node => node.type === 'input').length, 0);
      h.button('Abrir teleprompter').onPress(); await h.pump();
      input().onChangeText('Rascunho que não apliquei'); h.keyboard(true); await h.pump();
      h.find(node => node.type === 'sheet-close').props.onPress(); await h.pump();
      assert.equal(h.keyboardVisible(), false); assert.equal(h.current().script, 'Roteiro que estou escrevendo');
      h.button('Abrir teleprompter').onPress(); await h.pump();
      assert.equal(input().value, 'Roteiro que estou escrevendo');
      h.button('Fechar ajustes de captura').onPress(); await h.pump();
      assert.equal(h.nodes(node => node.type === 'input').length, 0);
    } finally { await h.dispose(); }
  }
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

for (const metadataFailure of [false, true]) test(`falha da finalização 2K conserva original 4K e journal${metadataFailure ? ' para retry' : ' até salvar'}`, async () => {
  const h = await harness({ twoK:true, downsampleFailure:true });
  try {
    await h.ready(); h.button('Qualidade 1080p. Toque para alternar, segure para os ajustes').onPress(); await h.pump();
    assert.equal(h.button('Qualidade 2K. Toque para alternar, segure para os ajustes').disabled, false);
    h.button('Começar gravação').onPress(); await h.advance(3000);
    if (metadataFailure) h.runtime.failMetadata();
    h.button('Encerrar e salvar take').onPress(); await h.pump();
    if (metadataFailure) {
      assert.equal(h.current().takes.length, 0);
      assert.equal(h.current().pendingTakes.length, 1);
      assert.ok(h.runtime.disk.has(h.current().pendingTakes[0].uri), 'Copied original remains journaled before inspection succeeds');
      assert.equal(h.button('Começar gravação').disabled, true, 'A failed save cannot be replaced by a new REC');
      const retry = h.find(node => node.type === 'button' && node.props.children?.[0]?.props?.children === 'Salvar este take');
      assert.ok(retry); retry.props.onPress(); await h.pump();
    } else {
      assert.ok(h.nodes(node => node.type === 'text' && node.props.children === 'Não foi possível finalizar em 2K. O original 4K foi salvo no projeto.').length);
    }
    assert.equal(h.current().takes.length, 1); assert.equal(h.current().pendingTakes?.length ?? 0, 0);
    const take = h.current().takes[0];
    assert.equal(take.width, 3840); assert.equal(take.height, 2160); assert.equal(take.frameRate, 30);
    assert.ok(h.runtime.disk.has(take.uri)); assert.ok(h.runtime.disk.has('file:///fixtures/captured.mov'));
    assert.equal(h.button('Começar gravação').disabled, false);
  } finally { await h.dispose(); }
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

test('remover take por ID reconcilia duração/vínculos sem apagar originais nem capa manual', async () => {
  const h = await harness({ seed: true });
  try {
    const first = h.current().takes[0];
    const source = h.runtime.fixture('second.mov', { duration: 4 });
    const second = await h.runtime.media.persistStudioTake(h.current(), { uri: source, name: 'Outro take' });
    await h.runtime.store.updateStudioProject('owner', h.current().id, { takes: [...h.current().takes, second] });
    let editing = model.studioEditing(h.current());
    editing = model.setStudioClipPlaybackRate(editing, second.id, 2);
    editing = model.addStudioLayerItem(editing, model.createStudioTextItem({ id: 'first-title', content: 'Sai com o primeiro', clipId: first.id, durationTicks: model.studioTicks(1) }), 'first-title-lane');
    editing = model.addStudioLayerItem(editing, model.createStudioTextItem({ id: 'second-title', content: 'Permanece no segundo', clipId: second.id, durationTicks: model.studioTicks(1) }), 'second-title-lane');
    editing = model.addStudioLayerItem(editing, model.createStudioTextItem({ id: 'absolute-title', content: 'Tempo absoluto', atTicks: model.studioTicks(1), durationTicks: model.studioTicks(1) }), 'absolute-lane');
    const manualCover = h.runtime.fixture('manual-cover.jpg', { duration: 0, hasVideo: false, hasAudio: false });
    await h.runtime.store.updateStudioProject('owner', h.current().id, { editing, coverUri: manualCover, exportedUri: 'file:///previous-export.mp4', exportedSignature: model.timelineSignature(h.current()) });
    const beforeAssets = structuredClone(h.current().editing.assets);
    await h.ready();
    assert.equal(model.studioSeconds(model.compileStudioRecipe(h.current()).durationTicks), 4);
    h.button('Excluir take 1').onPress(); await h.pump();

    assert.deepEqual(h.current().takes.map(value => value.id), [second.id]);
    assert.equal(h.current().takes[0].playbackRate, 2); assert.equal(h.current().takes[0].end, 4);
    assert.deepEqual(h.current().editing.assets, beforeAssets);
    assert.equal(h.current().coverUri, manualCover);
    assert.equal(h.current().exportedUri, undefined);
    assert.equal(h.current().exportedSignature, undefined);
    const recipe = model.compileStudioRecipe(h.current());
    assert.equal(model.studioSeconds(recipe.durationTicks), 2);
    assert.equal(recipe.clips.some(value => value.id === 'first-title'), false);
    assert.equal(recipe.clips.find(value => value.id === 'second-title').startTicks, 0);
    assert.equal(recipe.clips.find(value => value.id === 'absolute-title').startTicks, model.studioTicks(1));
    assert.deepEqual(h.takeStrip().takes.map(value => value.id), [second.id]);
    assert.equal(h.runtime.disk.has(first.uri), true); assert.equal(h.runtime.disk.has(first.thumbnailUri), true);
    assert.deepEqual(model.validateStudioEditing(h.current().editing, 'aula'), []);
  } finally { await h.dispose(); }
});

test('remoção aguarda disco, bloqueia REC/Avançar e falha preserva take para retry; último take some da barra', async () => {
  const h = await harness({ seed: true });
  try {
    const automaticCover = h.current().takes[0].thumbnailUri;
    await h.runtime.store.updateStudioProject('owner', h.current().id, { coverUri: automaticCover });
    await h.ready();
    const original = h.current().takes[0], originalId = original.id;
    const staleRecord = h.button('Começar gravação').onPress;
    const staleContinue = h.button('Avançar para editar 1 take').onPress;
    const remove = h.takeStrip().onRemove;
    const blocked = h.runtime.deferWrite();
    remove(originalId); await h.pump(); await blocked.entered;
    assert.deepEqual(h.current().takes.map(value => value.id), [originalId]);
    assert.equal(h.button('Começar gravação').disabled, true); assert.equal(h.takeStrip().disabled, true);
    staleRecord(); staleContinue(); remove(originalId); await h.pump();
    assert.equal(h.calls.filter(value => value.kind === 'record').length, 0); assert.equal(h.navigation.length, 0);
    blocked.reject(Error('Armazenamento indisponível')); await h.pump();
    assert.deepEqual(h.current().takes.map(value => value.id), [originalId]);
    assert.equal(h.current().coverUri, automaticCover);
    assert.equal(h.takeStrip().disabled, false); assert.equal(h.button('Começar gravação').disabled, false);
    assert.ok(h.nodes(node => node.type === 'text' && node.props.children === 'Armazenamento indisponível').length);
    assert.equal(h.runtime.disk.has(original.uri), true);

    h.takeStrip().onRemove(originalId); await h.pump();
    assert.equal(h.current().takes.length, 0);
    assert.equal(h.current().coverUri, undefined);
    assert.equal(h.nodes(node => node.props?.accessibilityLabel === 'Takes gravados').length, 0);
    assert.equal(h.nodes(node => /Avançar para editar/.test(node.props?.accessibilityLabel ?? '')).length, 0);
    assert.equal(h.button('Começar gravação').disabled, false);
    assert.equal(h.runtime.store.studioSnapshot('owner').projects.some(value => value.id === h.current().id), true);
    assert.equal(h.runtime.disk.has(original.uri), true); assert.equal(h.runtime.disk.has(original.thumbnailUri), true);
  } finally { await h.dispose(); }
});

test('remoção capturada antes de foco/conta/projeto mudar não escreve outro rascunho', async () => {
  const h = await harness({ seed: true });
  try {
    await h.ready();
    const firstProject = h.current(), remove = h.takeStrip().onRemove;
    const firstId = firstProject.takes[0].id;
    const writes = h.runtime.writes.length;
    h.focus(false); await h.pump(); remove(firstId); await h.pump();
    assert.equal(h.runtime.writes.length, writes);
    assert.deepEqual(h.current().takes.map(value => value.id), [firstId]);
    h.focus(true); await h.ready();
    const other = await h.runtime.store.createStudioProject('owner', 'aula', { transient: true });
    h.project(other.id); await h.ready();
    const beforeProjectChange = h.runtime.writes.length;
    remove(firstId); await h.pump();
    assert.equal(h.runtime.writes.length, beforeProjectChange);
    assert.equal(h.current().takes.length, 0);
    assert.equal(h.runtime.store.getStudioProject('owner', firstProject.id).takes.length, 1);
    h.owner('another-owner'); await h.pump(); remove(firstId); await h.pump();
    assert.equal(h.runtime.writes.length, beforeProjectChange);
    assert.equal(h.runtime.store.getStudioProject('owner', firstProject.id).takes.length, 1);
  } finally { await h.dispose(); }
});

test('remoção reservada revalida foco quando alcança a fila do store, antes da escrita', async () => {
  const h = await harness({ seed: true });
  try {
    await h.ready();
    const project = h.current(), takeId = project.takes[0].id;
    const blocked = h.runtime.deferWrite();
    const priorSave = h.runtime.store.updateStudioProject('owner', project.id, { title: 'Metadados antes da remoção' });
    await blocked.entered;
    const writes = h.runtime.writes.length;
    h.button('Excluir take 1').onPress(); await h.pump();
    assert.equal(h.button('Começar gravação').disabled, true);
    h.focus(false); await h.pump();
    blocked.resolve(); await priorSave; await h.pump();
    assert.equal(h.current().title, 'Metadados antes da remoção');
    assert.deepEqual(h.current().takes.map(value => value.id), [takeId]);
    assert.equal(h.runtime.writes.length, writes + 1, 'Only the already-started metadata write is durable; queued stale removal must not write');
    h.focus(true); await h.ready();
    assert.equal(h.button('Começar gravação').disabled, false); assert.equal(h.takeStrip().disabled, false);
  } finally { await h.dispose(); }
});

test('monitor de microfone usa evento nativo na prévia e no REC sem adicionar controles nem fingir leitura legacy', async () => {
  const h = await harness({ audioMonitor: true });
  try {
    await h.ready();
    assert.equal(h.audioMonitor().status, 'waiting'); assert.deepEqual(h.audioMonitor().channels, []);
    await h.audioEvent();
    assert.equal(h.audioMonitor().status, 'live'); assert.equal(h.audioMonitor().input.name, 'Microfone confirmado');
    h.button('Começar gravação').onPress(); await h.advance(3000);
    await h.audioEvent({ sequence: 2, channels: [{ averageDb: -18, peakDb: -6 }] });
    assert.equal(h.audioMonitor().status, 'live'); assert.deepEqual(h.audioMonitor().channels, [{ averageDb: -18, peakDb: -6 }]);
    assert.deepEqual(h.nodes(node => node.type === 'button' && node.props.accessibilityRole === 'button').map(node => node.props.accessibilityLabel), ['Encerrar e salvar take']);
    await h.audioEvent({ sequence: 3, reason: 'inputLost', input: null, channels: [], channelCount: 0, sampleRate: null, ageMs: null });
    assert.deepEqual(h.audioMonitor().channels, []); assert.match(h.audioMonitor().message, /desconectado/i);
    assert.equal(h.calls.filter(value => value.kind === 'record').length, 1, 'Monitoring does not start or restart REC');
    h.button('Encerrar e salvar take').onPress(); await h.pump();
    assert.equal(h.current().takes.length, 1);
  } finally { await h.dispose(); }

  const legacy = await harness();
  try {
    await legacy.ready();
    assert.equal(legacy.audioMonitor().status, 'unavailable'); assert.deepEqual(legacy.audioMonitor().channels, []);
    const host = legacy.find(node => node.type === 'native-camera-view');
    assert.equal(host.props.onAudioMonitor, undefined);
  } finally { await legacy.dispose(); }
});

test('Avançar reserva uma única saída, desmonta a câmera e conserva takes até confirmar retrato', async () => {
  const h = await harness({ seed: true, deferExit: true });
  try {
    await h.ready();
    const project = h.current(), beforeTakes = structuredClone(project.takes), writes = h.runtime.writes.length;
    const continueBeforeRender = h.button('Avançar para editar 1 take').onPress;
    const recordBeforeRender = h.button('Começar gravação').onPress;
    const removeBeforeRender = h.button('Excluir take 1').onPress;
    continueBeforeRender(); continueBeforeRender(); removeBeforeRender(); recordBeforeRender();
    await h.pump();
    assert.equal(h.exits.length, 1, 'Double taps must share one pending orientation/navigation handoff');
    assert.deepEqual(h.navigation, []);
    assert.equal(h.nodes(node => node.type === 'native-camera-view').length, 0, 'Rotation must not resize a live outgoing camera');
    assert.equal(h.nodes(node => node.type === 'button').length, 0, 'No outgoing controls may launch REC, deletion or another navigation');
    assert.equal(h.calls.filter(value => value.kind === 'record').length, 0);
    assert.deepEqual(h.current().takes, beforeTakes); assert.equal(h.runtime.writes.length, writes);

    // Geometry can update independently from the async confirmation. Neither
    // a new portrait layout nor a stale button is sufficient to leave.
    h.dimensions({ width: 393, height: 852 }); await h.pump();
    continueBeforeRender(); await h.pump(); assert.deepEqual(h.navigation, []);
    await h.confirmExit();
    assert.equal(h.navigation.length, 1);
    assert.deepEqual(h.navigation[0].destination, { pathname: '/studio/[id]', params: { id: project.id } });
    assert.deepEqual(h.navigation[0].project.takes, beforeTakes);
    continueBeforeRender(); await h.pump(); assert.equal(h.navigation.length, 1);
    assert.equal(h.runtime.disk.has(beforeTakes[0].uri), true);
  } finally { await h.dispose(); }
});

test('REC capturado antes de Avançar não inicia contagem na reserva, mesmo antes do primeiro render', async () => {
  const h = await harness({ seed: true, deferExit: true });
  try {
    await h.ready();
    const oldRecord = h.button('Começar gravação').onPress;
    h.button('Avançar para editar 1 take').onPress(); oldRecord(); await h.pump();
    assert.equal(h.exits.length, 1); assert.deepEqual(h.navigation, []);
    await h.confirmExit(false); await h.ready();
    assert.equal(h.button('Começar gravação').disabled, false, 'A failed handoff must return idle, not expose a secretly started countdown');
    assert.equal(h.nodes(node => node.props?.accessibilityLabel === 'Cancelar contagem').length, 0);
    await h.advance(4000); assert.equal(h.calls.filter(value => value.kind === 'record').length, 0);
    assert.equal(h.current().takes.length, 1);
  } finally { await h.dispose(); }
});

for (const failure of ['false', 'reject']) test(`falha de orientação (${failure}) não navega nem perde take e permite tentar Avançar outra vez`, async () => {
  const h = await harness({ seed: true, deferExit: true });
  try {
    await h.ready();
    const before = structuredClone(h.current().takes), writes = h.runtime.writes.length;
    h.button('Avançar para editar 1 take').onPress(); await h.pump();
    if (failure === 'false') await h.confirmExit(false); else await h.rejectExit();
    assert.deepEqual(h.navigation, []); assert.deepEqual(h.current().takes, before);
    assert.equal(h.runtime.writes.length, writes);
    await h.ready();
    assert.equal(h.button('Avançar para editar 1 take').disabled, false);
    assert.equal(h.button('Começar gravação').disabled, false);
    h.button('Avançar para editar 1 take').onPress(); await h.pump();
    assert.equal(h.exits.length, 2); assert.deepEqual(h.navigation, []);
    await h.confirmExit(); assert.equal(h.navigation.length, 1);
    assert.deepEqual(h.navigation[0].project.takes, before);
  } finally { await h.dispose(); }
});

for (const interruption of ['blur-refocus', 'background-foreground', 'owner-return', 'project-change']) test(`saída aguardando orientação ignora confirmação antiga após ${interruption}`, async () => {
  const h = await harness({ seed: true, deferExit: true });
  try {
    await h.ready(); const original = h.current(), before = structuredClone(original.takes);
    h.button('Avançar para editar 1 take').onPress(); await h.pump();
    if (interruption === 'blur-refocus') { h.focus(false); await h.pump(); h.focus(true); await h.pump(); }
    if (interruption === 'background-foreground') { h.background('background'); await h.pump(); h.background('active'); await h.pump(); }
    if (interruption === 'owner-return') { h.owner('other'); await h.pump(); h.owner('owner'); await h.pump(); }
    if (interruption === 'project-change') {
      const another = await h.runtime.store.createStudioProject('owner', 'aula', { transient: true });
      h.project(another.id); await h.pump();
    }
    await h.confirmExit();
    assert.deepEqual(h.navigation, [], 'Returning to the same owner/focus must not revive an obsolete handoff');
    assert.deepEqual(h.runtime.store.getStudioProject('owner', original.id).takes, before);
    assert.equal(h.calls.filter(value => value.kind === 'record').length, 0);
    if (interruption !== 'project-change') {
      await h.ready(); h.button('Avançar para editar 1 take').onPress(); await h.pump();
      assert.equal(h.exits.length, 2); await h.confirmExit(); assert.equal(h.navigation.length, 1);
    }
  } finally { await h.dispose(); }
});

for (const entry of [{ from: 'projects', canGoBack: true, kind: 'replace' }, { from: null, canGoBack: true, kind: 'back' }, { from: null, canGoBack: false, kind: 'replace' }]) test(`Avançar confirma retrato antes do ${entry.kind} vindo de ${entry.from || 'editor'} (back=${entry.canGoBack})`, async () => {
  const h = await harness({ seed: true, deferExit: true, ...entry });
  try {
    await h.ready(); const id = h.current().id;
    h.button('Avançar para editar 1 take').onPress(); await h.pump(); assert.deepEqual(h.navigation, []);
    await h.confirmExit(); assert.equal(h.navigation.length, 1); assert.equal(h.navigation[0].kind, entry.kind);
    if (entry.kind === 'replace') assert.deepEqual(h.navigation[0].destination, { pathname: '/studio/[id]', params: { id } });
    assert.equal(h.navigation[0].project.id, id); assert.equal(h.navigation[0].project.takes.length, 1);
  } finally { await h.dispose(); }
});

for (const canGoBack of [true, false]) test(`Fechar câmera aguarda orientação e mantém o projeto salvo (back=${canGoBack})`, async () => {
  const h = await harness({ seed: true, deferExit: true, canGoBack });
  try {
    await h.ready(); const before = structuredClone(h.current().takes);
    const close = h.button('Fechar captura').onPress;
    close(); close(); await h.pump();
    assert.equal(h.exits.length, 1); assert.deepEqual(h.navigation, []);
    assert.equal(h.nodes(node => node.type === 'native-camera-view').length, 0);
    await h.confirmExit(); assert.equal(h.navigation.length, 1);
    assert.equal(h.navigation[0].kind, canGoBack ? 'back' : 'replace');
    if (!canGoBack) assert.equal(h.navigation[0].destination, '/studio');
    assert.deepEqual(h.current().takes, before);
  } finally { await h.dispose(); }
});

test('remoção nativa da captura idle também espera orientação e redispara somente a ação original', async () => {
  const h = await harness({ seed: true, deferExit: true });
  try {
    await h.ready(); const before = structuredClone(h.current().takes);
    const action = { type: 'GO_BACK', source: 'camera-screen', target: 'studio-stack' };
    h.requestRemoval(action); h.requestRemoval(action); await h.pump();
    assert.equal(h.exits.length, 1); assert.deepEqual(h.navigation, []);
    await h.confirmExit();
    assert.equal(h.navigation.length, 1); assert.equal(h.navigation[0].kind, 'dispatch');
    assert.deepEqual(h.navigation[0].destination, action); assert.deepEqual(h.current().takes, before);
  } finally { await h.dispose(); }
});

test('Salvar e sair durante REC persiste original antes de aguardar retrato e liberar a remoção nativa', async () => {
  const h = await harness({ seed: true, deferExit: true });
  try {
    await h.ready(); h.button('Começar gravação').onPress(); await h.advance(3000);
    const action = { type: 'GO_BACK', source: 'camera-recording', target: 'studio-stack' };
    h.requestRemoval(action); await h.pump();
    const dialog = h.alerts.find(value => value[0] === 'Encerrar este take?');
    assert.ok(dialog); assert.deepEqual(h.navigation, []); assert.equal(h.exits.length, 0);
    const blocked = h.runtime.deferWrite();
    dialog[2].find(value => value.text === 'Salvar e sair').onPress(); await h.pump(); await blocked.entered;
    assert.equal(h.exits.length, 0, 'A pending native orientation cannot authorize losing an unsaved original');
    blocked.resolve(); await h.pump();
    assert.equal(h.current().takes.length, 2); assert.equal(h.current().pendingTakes.length, 0);
    assert.equal(h.exits.length, 1); assert.deepEqual(h.navigation, []);
    await h.confirmExit(); assert.equal(h.navigation.length, 1); assert.deepEqual(h.navigation[0].destination, action);
    assert.equal(h.navigation[0].project.takes.length, 2);
    for (const take of h.current().takes) assert.equal(h.runtime.disk.has(take.uri), true);
  } finally { await h.dispose(); }
});

test('X durante contagem cancela REC pelo guard antes de preparar retrato e preserva o take anterior', async () => {
  const h = await harness({ seed: true, deferExit: true });
  try {
    await h.ready(); const before = structuredClone(h.current().takes);
    h.button('Começar gravação').onPress(); await h.advance(1000);
    assert.equal(h.button('Cancelar contagem').disabled, false);
    h.button('Fechar captura').onPress(); await h.pump();
    assert.deepEqual(h.navigation, []); assert.equal(h.exits.length, 1);
    await h.advance(4000); assert.equal(h.calls.filter(value => value.kind === 'record').length, 0);
    assert.deepEqual(h.current().takes, before); await h.confirmExit();
    assert.equal(h.navigation.length, 1); assert.equal(h.navigation[0].kind, 'dispatch');
    assert.deepEqual(h.navigation[0].destination, { type: 'GO_BACK' });
  } finally { await h.dispose(); }
});

test('X durante recuperação mostra Salvar/Ficar; salvar conserva o arquivo antes da orientação e da saída', async () => {
  const h = await harness({ seed: true, deferExit: true });
  try {
    await h.ready(); const previous = structuredClone(h.current().takes);
    h.button('Começar gravação').onPress(); await h.advance(3000);
    h.runtime.failMetadata(); h.button('Encerrar e salvar take').onPress(); await h.pump();
    assert.equal(h.current().takes.length, 1); assert.equal(h.button('Avançar para editar 1 take').disabled, true);
    h.button('Fechar captura').onPress(); await h.pump();
    const dialog = h.alerts.find(value => value[0] === 'Este take ainda não foi salvo');
    assert.ok(dialog, 'X must reach the native removal guard, not silently ignore recovery');
    assert.deepEqual(h.navigation, []); assert.equal(h.exits.length, 0);
    assert.deepEqual(dialog[2].map(value => value.text), ['Ficar aqui', 'Salvar e sair', 'Sair sem salvar']);
    const blocked = h.runtime.deferWrite();
    dialog[2].find(value => value.text === 'Salvar e sair').onPress(); await h.pump(); await blocked.entered;
    assert.deepEqual(h.navigation, []); assert.equal(h.exits.length, 0);
    blocked.resolve(); await h.pump();
    assert.equal(h.current().takes.length, 2); assert.equal(h.exits.length, 1);
    assert.deepEqual(h.navigation, []); await h.confirmExit();
    assert.equal(h.navigation.length, 1); assert.deepEqual(h.navigation[0].destination, { type: 'GO_BACK' });
    assert.deepEqual(h.current().takes[0], previous[0]);
    for (const take of h.current().takes) assert.equal(h.runtime.disk.has(take.uri), true);
  } finally { await h.dispose(); }
});

test('gate de outra conta permite Voltar com orientação confirmada, sem mudar o projeto da conta original', async () => {
  const h = await harness({ seed: true, deferExit: true });
  try {
    await h.ready(); const original = h.current(), before = structuredClone(original.takes);
    h.owner('other'); await h.pump();
    const back = h.find(node => node.type === 'button' && Array.isArray(node.props.children)
      && node.props.children.some(child => child?.type === 'text' && child.props.children === 'Voltar'));
    back.props.onPress(); await h.pump();
    assert.deepEqual(h.navigation, []); assert.equal(h.exits.length, 1);
    await h.confirmExit(); assert.equal(h.navigation.length, 1);
    assert.deepEqual(h.runtime.store.getStudioProject('owner', original.id).takes, before);
  } finally { await h.dispose(); }
});

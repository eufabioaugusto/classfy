import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createBroadcastController } from './broadcastController.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); };
const compile = (source, dependencies, globals) => {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    if (!Object.hasOwn(dependencies, name)) throw Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
};

// Runs the real route/NativeHost and controller, including their hook effects.
// Native camera, SDK, navigation and backend are seams; no hardware/network is used.
function harness(options = {}) {
  let authOwner = 'owner', focused = true, loading = false, fetchError = null;
  let live = { id: 'live', creator_id: 'owner', title: 'Aula ao vivo', status: 'waiting', mux_live_stream_id: 'mux', livekit_egress_id: null,
    chat_enabled: true, followers_notified_at: null, viewer_count: 0, started_at: null };
  const calls = [], alerts = [], events = [], timers = new Map(), effects = [];
  const slots = []; let cursor = 0, dirty = true, tree, removed = false, controller, navigationGuard;
  let snapshot = { phase: 'idle', connectionState: 'disconnected', facing: 'front', cameraEnabled: true, microphoneEnabled: true,
    videoTrack: null, streamURL: null, capture: null, error: null };
  const mediaSubscribers = new Set();
  let transportEpoch = 0;
  const publish = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of mediaSubscribers) listener(snapshot); };
  const transport = {
    getSnapshot: () => snapshot,
    subscribe(listener) { mediaSubscribers.add(listener); return () => mediaSubscribers.delete(listener); },
    async prepare() { calls.push('prepare'); const epoch = transportEpoch; await options.prepare?.();
      if (epoch === transportEpoch) publish({ phase: 'preview', videoTrack: {}, streamURL: 'private-preview', capture: { width: 1280, height: 720, frameRate: 30 } }); },
    async connectAndPublish() { calls.push('connect'); const epoch = transportEpoch; await options.connect?.();
      if (epoch === transportEpoch) publish({ phase: 'publishing', connectionState: 'connected' }); },
    async disconnect() { calls.push('disconnect'); ++transportEpoch; publish({ phase: 'idle', connectionState: 'disconnected', videoTrack: null, streamURL: null, capture: null }); await options.disconnect?.(); },
    async dispose() { calls.push('dispose'); ++transportEpoch; publish({ phase: 'disposed', connectionState: 'disconnected', videoTrack: null, streamURL: null, capture: null }); },
    async flipCamera() { calls.push('flip'); await options.flip?.(); }, async setCameraEnabled() { calls.push('camera-toggle'); }, async setMicrophoneEnabled() { calls.push('mic-toggle'); },
  };
  const sameDeps = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useMemo(callback, dependencies) { const index = cursor++; if (!slots[index] || !sameDeps(slots[index].dependencies, dependencies)) slots[index] = { value: callback(), dependencies };
      return slots[index].value; },
    useCallback(callback, dependencies) { return hooks.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) { const index = cursor++; if (!slots[index] || !sameDeps(slots[index].dependencies, dependencies)) effects.push({ index, callback, dependencies }); },
  };
  const appListeners = new Set();
  const AppState = { currentState: 'active', addEventListener(name, callback) { assert.equal(name, 'change'); appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } };
  const navigation = { dispatch: action => events.push({ type: 'dispatch', action }) };
  const router = { back: () => events.push({ type: 'back' }), replace: route => events.push({ type: 'replace', route }) };
  const reload = async () => { calls.push('reload'); await options.reload?.(); };
  const backend = {
    async getLive() { calls.push('get'); return { ...live }; },
    async connectHost() { calls.push('host-token'); return { url: 'wss://example.invalid', token: 'mock-token' }; },
    async startBridge() { calls.push('bridge'); await options.bridge?.(); },
    async syncLive() { calls.push('sync'); return { status: live.status }; },
    async endLive(_owner, _id, scope) { calls.push('end'); await options.end?.(); if (!scope.isCurrent()) throw Error('obsolete'); },
    async notifyLiveFollowers() { calls.push('notify'); return { notifiedCount: 1 }; }, async setLiveChat() { calls.push('chat-toggle'); },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const native = { AppState, Alert: { alert: (...args) => alerts.push(args) }, ActivityIndicator: 'spinner', FlatList: 'list', KeyboardAvoidingView: 'keyboard',
    Linking: { openURL: async () => calls.push('browser') }, Modal: 'modal', Platform: { OS: 'ios' }, Pressable: 'pressable', Share: { share: async () => calls.push('share') },
    StyleSheet: { create: value => value, absoluteFill: {}, absoluteFillObject: {} }, Text: 'text', TextInput: 'input', View: 'view' };
  const screen = compile(readFileSync(new URL('../../../app/studio/live/[id].tsx', import.meta.url), 'utf8') + '\nexport { NativeHost };', {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { Stack: { Screen: 'stack-screen' }, useLocalSearchParams: () => ({ id: 'live' }), useRouter: () => router },
    '@react-navigation/native': { useIsFocused: () => focused, useNavigation: () => navigation,
      usePreventRemove: (enabled, callback) => { navigationGuard = { enabled, callback }; } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 54, bottom: 34 }) },
    'expo-keep-awake': { activateKeepAwakeAsync: async () => calls.push('awake-on'), deactivateKeepAwake: async () => calls.push('awake-off') },
    'expo-camera': { Camera: { requestCameraPermissionsAsync: async () => { calls.push('camera-permission'); return options.cameraPermission ? options.cameraPermission() : { granted: true }; },
      requestMicrophonePermissionsAsync: async () => { calls.push('mic-permission'); return options.micPermission ? options.micPermission() : { granted: true }; } } },
    'lucide-react-native': Object.fromEntries('ArrowLeft Bell Camera CameraOff MessageCircle Mic MicOff Radio RefreshCw Send Share2 Users X'.split(' ').map(name => [name, name])),
    '@/components/AppScreen': { AppScreen: 'screen' }, '@/components/NavigationHeader': { NavigationHeader: 'header' },
    '@/features/auth/authContext': { useAuth: () => ({ user: { id: authOwner } }) },
    '@/features/watch/miniPlayerContext': { useMiniPlayer: () => ({ closeMiniPlayer: () => calls.push('close-player') }) },
    '@/features/studio/StudioUI': { StudioButton: 'studio-button', StudioLoading: 'loading' }, '@/theme/colors': { colors: {} },
    '@/features/live/broadcastController': { createBroadcastController: args => { calls.push('create-controller'); return controller = createBroadcastController({ ...args, countdownSeconds: 0 }); } },
    '@/features/live/backend': backend,
    '@/features/live/useLives': { useLive: () => ({ live, loading, error: fetchError, reload }), useLiveChat: () => ({ messages: [], loading: false }) },
    '@/features/live/transport': { createNativeLiveTransport: () => { calls.push('create-transport'); return transport; }, getNativeLiveAvailability: () => ({ available: options.available !== false, reason: 'Atualize o aplicativo.' }) },
    '@/features/live/NativeLivePreview': { NativeLivePreview: 'native-preview' },
  }, { setInterval: callback => { const id = Symbol('timer'); timers.set(id, callback); return id; }, clearInterval: id => timers.delete(id) });
  const render = () => {
    if (removed) throw Error('unmounted');
    do { dirty = false; cursor = 0; tree = screen.NativeHost({ owner: 'owner', live, reload, refreshError: fetchError });
      for (const effect of effects.splice(0)) { slots[effect.index]?.cleanup?.(); slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() }; }
    } while (dirty);
    return tree;
  };
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]).flatMap(nodes)];
  const button = label => nodes(render()).find(node => node.props?.label === label && typeof node.props?.onPress === 'function');
  render();
  return { calls, alerts, events, transport, get controller() { return controller; }, get tree() { return render(); }, get guard() { render(); return navigationGuard; },
    render, button, async press(label) { const item = button(label); assert.ok(item, `Missing action: ${label}`); assert.notEqual(item.props.disabled, true); await item.props.onPress(); await tick(); render(); },
    appState(value) { AppState.currentState = value; for (const listener of appListeners) listener(value); render(); },
    focus(value) { focused = value; render(); }, owner(value) { authOwner = value; render(); },
    live(patch) { live = { ...live, ...patch }; render(); }, async flush() { await tick(); render(); },
    unmount() { removed = true; for (const slot of slots) slot?.cleanup?.(); },
    wrapper() { return screen.default(); },
    fetched(patch) { if ('loading' in patch) loading = patch.loading; if ('error' in patch) fetchError = patch.error; if (patch.live) live = patch.live; },
  };
}

test('host real pede permissões só após toque e prepara prévia privada sem abrir sinal', async () => {
  const h = harness(); assert.equal(h.calls.includes('camera-permission'), false); assert.equal(h.calls.includes('prepare'), false);
  await h.press('Ativar câmera e microfone');
  assert.ok(h.calls.indexOf('camera-permission') < h.calls.indexOf('mic-permission'));
  assert.ok(h.calls.indexOf('mic-permission') < h.calls.indexOf('prepare'));
  assert.equal(h.controller.getSnapshot().phase, 'preview'); assert.equal(h.calls.includes('connect'), false); assert.equal(h.calls.includes('bridge'), false);
  assert.equal(h.guard.enabled, false); h.unmount(); assert.ok(h.calls.includes('dispose'));
});

test('negação de câmera não pede microfone nem mantém captura', async () => {
  const h = harness({ cameraPermission: async () => ({ granted: false }) });
  await h.press('Ativar câmera e microfone');
  assert.equal(h.calls.includes('mic-permission'), false); assert.equal(h.calls.includes('prepare'), false);
  assert.ok(h.button('Ativar câmera e microfone')); h.unmount();
});

test('troca de conta antes da permissão tardia não pede mic nem abre câmera da conta antiga', async () => {
  const permission = deferred(), h = harness({ cameraPermission: () => permission.promise });
  const press = h.press('Ativar câmera e microfone'); await tick(); h.owner('another'); permission.resolve({ granted: true }); await press; await h.flush();
  assert.equal(h.calls.includes('mic-permission'), false); assert.equal(h.calls.includes('prepare'), false);
  h.unmount();
});

test('microfone concedido em segundo plano não abre captura; retorno exige novo toque', async () => {
  const permission = deferred(), h = harness({ micPermission: () => permission.promise });
  const press = h.press('Ativar câmera e microfone'); await tick(); h.appState('background'); permission.resolve({ granted: true }); await press; await h.flush();
  assert.equal(h.calls.includes('prepare'), false); h.appState('active'); await h.flush();
  assert.equal(h.calls.includes('prepare'), false); assert.ok(h.button('Ativar câmera e microfone')); h.unmount();
});

test('permissão tardia enquanto host perde foco libera loading ao retornar sem abrir captura', async () => {
  const permission = deferred(), h = harness({ cameraPermission: () => permission.promise });
  const press = h.press('Ativar câmera e microfone'); await tick(); h.focus(false);
  permission.resolve({ granted: true }); await press; await h.flush(); h.focus(true); await h.flush();
  assert.equal(h.calls.includes('mic-permission'), false); assert.equal(h.calls.includes('prepare'), false);
  const button = h.button('Ativar câmera e microfone'); assert.ok(button, 'O host voltou com permissionBusy preso');
  assert.notEqual(button.props.loading, true); h.unmount();
});

test('controle de câmera pendente enquanto host perde foco libera controles ao retornar', async () => {
  const flip = deferred(), h = harness({ flip: () => flip.promise });
  await h.press('Ativar câmera e microfone'); const press = h.press('Trocar câmera'); await tick();
  h.focus(false); flip.resolve(); await press; await h.flush(); h.focus(true); await h.flush();
  await h.press('Ativar câmera e microfone');
  const button = h.button('Trocar câmera'); assert.ok(button); assert.notEqual(button.props.disabled, true, 'O host voltou com actionBusy preso');
  h.unmount();
});

test('retorno ao foco lê snapshot atual do controlador e oferece nova prévia após liberar tracks', async () => {
  const h = harness(); await h.press('Ativar câmera e microfone');
  h.focus(false); await h.flush(); assert.equal(h.transport.getSnapshot().videoTrack, null);
  h.focus(true); await h.flush();
  assert.equal(h.controller.getSnapshot().phase, 'idle'); assert.ok(h.button('Ativar câmera e microfone'), 'UI manteve preview sem câmera após perder foco');
  await h.press('Ativar câmera e microfone'); assert.equal(h.calls.filter(call => call === 'prepare').length, 2);
  assert.ok(h.button('Iniciar transmissão')); assert.equal(h.calls.includes('connect'), false); h.unmount();
});

test('refetch e realtime preservam host/transport de prévia e não iniciam publicação', async () => {
  const h = harness(); await h.press('Ativar câmera e microfone');
  const before = h.wrapper(), controller = h.controller;
  h.live({ title: 'Título atualizado', viewer_count: 12 }); h.fetched({ error: 'Falha temporária ao atualizar' }); h.render();
  const after = h.wrapper();
  assert.equal(before.type, after.type); assert.equal(before.key, after.key); assert.equal(h.controller, controller);
  assert.equal(h.calls.filter(call => call === 'create-transport').length, 1);
  assert.equal(h.calls.filter(call => call === 'prepare').length, 1); assert.equal(h.calls.includes('connect'), false);
  h.unmount();
});

test('background de host publicado solta captura e foreground nunca retoma automaticamente', async () => {
  const h = harness(); await h.press('Ativar câmera e microfone'); await h.press('Iniciar transmissão'); h.live({ status: 'live' });
  assert.equal(h.controller.getSnapshot().localPublishing, true); h.appState('background'); await h.flush();
  assert.equal(h.transport.getSnapshot().videoTrack, null); assert.equal(h.controller.getSnapshot().localPublishing, false);
  assert.equal(h.calls.includes('end'), false); const connects = h.calls.filter(call => call === 'connect').length;
  h.appState('active'); await h.flush(); assert.equal(h.calls.filter(call => call === 'connect').length, connects);
  assert.equal(h.guard.enabled, true); h.unmount();
});

test('sair enquanto live ativa espera confirmação durável de end antes de despachar navegação', async () => {
  const ending = deferred(), h = harness({ end: () => ending.promise });
  await h.press('Ativar câmera e microfone'); await h.press('Iniciar transmissão'); h.live({ status: 'live' });
  const action = { type: 'GO_BACK' }; assert.equal(h.guard.enabled, true); h.guard.callback({ data: { action } });
  const alert = h.alerts.at(-1); assert.equal(alert[0], 'A live pode continuar no ar');
  alert[2].find(button => button.text === 'Encerrar e sair').onPress(); await h.flush();
  assert.equal(h.calls.includes('end'), true); assert.deepEqual(h.events, []); assert.equal(h.controller.getSnapshot().phase, 'ending');
  ending.resolve(); await h.flush();
  assert.equal(h.controller.getSnapshot().phase, 'ended'); assert.deepEqual(h.events, [{ type: 'dispatch', action }]);
  assert.equal(h.transport.getSnapshot().videoTrack, null); h.unmount();
});

test('unmount durante connect pendente invalida publicação/ponte e limpa listeners', async () => {
  const connecting = deferred(), h = harness({ connect: () => connecting.promise });
  await h.press('Ativar câmera e microfone'); const press = h.button('Iniciar transmissão').props.onPress(); await tick();
  h.unmount(); connecting.resolve(); await tick(); await press;
  assert.equal(h.calls.includes('dispose'), true); assert.equal(h.calls.includes('bridge'), false);
  assert.equal(h.transport.getSnapshot().videoTrack, null); assert.equal(h.controller.getSnapshot().localPublishing, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { LiveBackendError, readLiveRecord } from './model.ts';
import { replaceStudioPreviewSource } from '../studio/videoSourceReady.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const fixture = (patch = {}) => readLiveRecord({ id: 'live', creator_id: 'creator', title: 'Aula ao vivo', status: 'live', chat_enabled: true, visibility: 'free', mux_live_stream_id: 'mux', thumbnail_url: 'https://example.test/cover.jpg', created_at: '2026-10-10T12:00:00Z', ...patch });

function harness(initialLive = fixture(), options = {}) {
  const source = ts.transpileModule(readFileSync(new URL('../../../app/live/[id].tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let owner = options.owner === undefined ? 'student' : options.owner, focused = true, live = initialLive, dirty = true, cursor = 0, effects = [], tree, appListener;
  const slots = [], calls = [], sends = [], pushes = [], timers = [], listeners = new Map(), replacements = [], presence = [], browserUrls = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ||= { value: typeof value === 'function' ? value() : value }; return [slots[i].value, next => { const result = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(result, slots[i].value)) { slots[i].value = result; dirty = true; } }]; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) effects.push({ i, callback, deps }); },
    useCallback(callback, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: callback, deps }; return slots[i].value; },
  };
  const emit = (name, value) => { if (name === 'playToEnd') player.playing = false; for (const listener of [...(listeners.get(name) || [])]) listener(value); };
  const player = {
    status: 'idle', playing: false, currentTime: 0, duration: 80, muted: false, playCalls: 0, pauseCalls: 0,
    addListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); return { remove: () => listeners.get(name).delete(listener) }; },
    play() { player.playCalls++; player.playing = true; emit('playingChange', { isPlaying: true }); },
    pause() { player.pauseCalls++; player.playing = false; emit('playingChange', { isPlaying: false }); },
    async replaceAsync(value) {
      const pending = deferred(); const replacement = { value, ...pending, apply() { emit('sourceChange', { source: value }); }, complete() { player.status = 'readyToPlay'; replacement.apply(); emit('sourceLoad', { videoSource: value }); emit('statusChange', { status: 'readyToPlay' }); pending.resolve(); } };
      replacements.push(replacement); player.status = 'loading'; emit('statusChange', { status: 'loading' });
      if (!options.manualNative) replacement.complete();
      return pending.promise;
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const closeMiniPlayer = () => {}, reload = async () => {};
  const dependencies = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'view', Text: 'text', TextInput: 'input', Pressable: 'button', FlatList: 'list', ActivityIndicator: 'spinner', KeyboardAvoidingView: 'keyboard', Platform: { OS: 'ios' }, Share: { share: async () => {} }, Linking: { openURL: async url => { browserUrls.push(url); } }, AppState: { currentState: 'active', addEventListener: (_name, listener) => { appListener = listener; return { remove() {} }; } }, StyleSheet: { create: value => value, absoluteFillObject: {} } },
    'expo-router': { useRouter: () => ({ push: target => pushes.push(target) }), useLocalSearchParams: () => ({ id: options.id || 'live' }) },
    '@react-navigation/native': { useIsFocused: () => focused }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 54, bottom: 34 }) },
    'expo-video': { useVideoPlayer: () => player, VideoView: 'video' },
    'lucide-react-native': Object.fromEntries('Maximize Pause Play Radio RefreshCw Send Share2 Volume2 VolumeX'.split(' ').map(name => [name, name])),
    '@/components/AppScreen': { AppScreen: 'screen' }, '@/components/NavigationHeader': { NavigationHeader: 'header' }, '@/components/LoadingImage': { LoadingImage: 'image' }, '@/components/LoadingPlaceholder': { SkeletonBlock: 'skeleton', SkeletonGroup: 'skeletons' },
    '@/features/auth/authContext': { useAuth: () => ({ user: owner ? { id: owner } : null, loading: false }) },
    '@/features/watch/miniPlayerContext': { useMiniPlayer: () => ({ closeMiniPlayer }) },
    '@/features/studio/StudioUI': { StudioButton: 'button' }, '@/theme/colors': { colors: {} }, '@/theme/controls': { controls: {} },
    '@/features/studio/videoSourceReady': { replaceStudioPreviewSource },
    '@/features/live/model': { LiveBackendError },
    '@/features/live/useLives': { useLive: () => ({ live: owner ? live : null, loading: false, error: null, reload }), useLiveViewerPresence: (account, id, active) => { presence.push({ account, id, active }); return { joined: active, error: null }; }, useLiveChat: () => ({ messages: [], loading: false, error: null, sending: false, send(text, scope) { const wait = deferred(); sends.push({ text, scope, ...wait }); return wait.promise; } }) },
    '@/features/live/backend': { getLivePlayback(account, id, scope) { const wait = deferred(); calls.push({ account, id, scope, ...wait }); if (!options.manualNetwork) wait.resolve({ type: live?.status === 'live' ? 'hls' : 'mp4', url: `https://example.test/media-${calls.length}`, expiresAt: '2100-01-01T00:00:00Z' }); return wait.promise; } },
  };
  const module = { exports: {} }; new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', source)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports, (callback, delay) => { const timer = { callback, delay, active: true }; timers.push(timer); return timer; }, timer => { timer.active = false; });
  const render = () => { cursor = 0; effects = []; dirty = false; tree = module.exports.default(); for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }; }
    if (!options.manualLayout) {
      find(node => node.type === 'view' && node.props?.onLayout)?.props.onLayout({ nativeEvent: { layout: { width: 400, height: 225 } } });
      find(node => node.type === 'video')?.props.onLayout({ nativeEvent: { layout: { width: 400, height: 225 } } });
    }
  };
  const pump = async () => { for (let i = 0; i < 40; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty) return; } throw new Error('Viewer did not settle'); };
  const find = predicate => { const walk = node => { if (Array.isArray(node)) { for (const child of node) { const found = walk(child); if (found) return found; } } else if (node && typeof node === 'object') { if (predicate(node)) return node; return walk(node.props?.children); } }; return walk(tree); };
  const prop = label => { const result = find(node => node.props?.accessibilityLabel === label || node.props?.label === label); assert.ok(result, `Missing ${label}`); return result.props; };
  return { pump, prop, find, calls, sends, pushes, timers, replacements, player, emit, presence, browserUrls,
    focus(value) { focused = value; dirty = true; }, owner(value) { owner = value; dirty = true; }, live(value) { live = value; dirty = true; }, app(value) { appListener(value); },
    viewport(width, height) { find(node => node.type === 'view' && node.props?.onLayout)?.props.onLayout({ nativeEvent: { layout: { width, height } } }); },
    viewLayout(width, height) { find(node => node.type === 'video')?.props.onLayout({ nativeEvent: { layout: { width, height } } }); },
    frame() { const video = find(node => node.type === 'video'); assert.ok(video); video.props.onFirstFrameRender(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('live waits for the real source handshake before autoplay; replay remains paused', async () => {
  const h = harness(fixture(), { manualNative: true }); try {
    await h.pump(); assert.equal(h.calls.length, 1); assert.equal(h.player.playCalls, 0);
    h.replacements[0].complete(); await h.pump(); assert.equal(h.player.playCalls, 1); assert.equal(h.find(node => node.type === 'video').props.nativeControls, false);
  } finally { h.dispose(); }
  const replay = harness(fixture({ status: 'ended', replay_published_at: '2026-10-10T13:00:00Z' })); try {
    await replay.pump(); assert.equal(replay.player.playCalls, 0); assert.equal(replay.find(node => node.type === 'video').props.nativeControls, false); assert.equal(replay.replacements[0].value.contentType, 'progressive'); assert.ok(replay.prop('Reproduzir gravação'));
  } finally { replay.dispose(); }
});
test('waiting and unauthenticated screens never fetch playback; login preserves the live id', async () => {
  const waiting = harness(fixture({ status: 'waiting' })); try { await waiting.pump(); assert.equal(waiting.calls.length, 0); assert.equal(waiting.player.playCalls, 0); } finally { waiting.dispose(); }
  const visitor = harness(fixture(), { owner: null }); try { await visitor.pump(); visitor.prop('Entrar').onPress(); assert.equal(visitor.calls.length, 0); assert.deepEqual(visitor.pushes, [{ pathname: '/auth/sign-in', params: { liveId: 'live' } }]); } finally { visitor.dispose(); }
});
test('polling metadata changes do not replace the stream or reset the playback cursor', async () => {
  const h = harness(); try { await h.pump(); h.player.currentTime = 31.25; h.frame(); await h.pump(); h.live(fixture({ title: 'Título atualizado', viewer_count: 3 })); await h.pump(); assert.equal(h.calls.length, 1); assert.equal(h.replacements.length, 1); assert.equal(h.player.currentTime, 31.25); assert.equal(h.player.playCalls, 1); } finally { h.dispose(); }
});
test('late signed URL after blur or account change cannot replace or play a source', async () => {
  for (const mutate of [h => h.focus(false), h => h.owner('other'), h => h.app('background')]) {
    const h = harness(fixture(), { manualNetwork: true }); try {
      await h.pump(); mutate(h); await h.pump(); assert.equal(h.calls[0].scope.isCurrent(), false);
      h.calls[0].resolve({ type: 'hls', url: 'https://example.test/stale' }); await h.pump(); assert.equal(h.replacements.length, 0); assert.equal(h.player.playCalls, 0);
    } finally { h.dispose(); }
  }
});
test('replay refresh preserves the exact position and native playback intent', async () => {
  const h = harness(fixture({ status: 'ended', replay_published_at: '2026-10-10T13:00:00Z' })); try {
    await h.pump(); h.player.currentTime = 37.5; h.player.play(); await h.pump();
    h.emit('statusChange', { status: 'error' }); await h.pump(); h.prop('Tentar carregar vídeo novamente').onPress(); await h.pump();
    assert.equal(h.calls.length, 2); assert.equal(h.player.currentTime, 37.5); assert.equal(h.player.playing, true);
  } finally { h.dispose(); }
});
test('ended live drains already-visible HLS without replacing it, then switches to a paused replay', async () => {
  const h = harness(); try {
    await h.pump(); h.frame(); await h.pump(); h.live(fixture({ status: 'ended', replay_published_at: '2026-10-10T13:00:00Z' })); await h.pump();
    assert.equal(h.calls.length, 1); assert.ok(h.timers.some(timer => timer.active && timer.delay === 18000));
    h.emit('playToEnd', {}); await h.pump(); assert.equal(h.calls.length, 2); assert.equal(h.player.playing, false); assert.equal(h.find(node => node.type === 'video').props.nativeControls, false); assert.ok(h.prop('Reproduzir gravação'));
  } finally { h.dispose(); }
});
test('background pauses playback and prevents stale loading callbacks from restoring it', async () => {
  const h = harness(); try {
    await h.pump(); assert.equal(h.player.playing, true); h.app('background'); await h.pump(); assert.equal(h.player.playing, false);
    h.emit('statusChange', { status: 'readyToPlay' }); h.emit('playingChange', { isPlaying: true }); await h.pump(); assert.equal(h.calls.length, 1);
  } finally { h.dispose(); }
});
test('chat send reserves one operation and discards late UI effects after blur', async () => {
  const h = harness(); try {
    await h.pump(); h.prop('Mensagem no chat da live').onChangeText('Minha pergunta'); await h.pump();
    const send = h.prop('Enviar mensagem').onPress; send(); send(); await h.pump(); assert.equal(h.sends.length, 1);
    h.focus(false); await h.pump(); h.focus(true); await h.pump(); assert.equal(h.sends[0].scope.isCurrent(), false);
    h.sends[0].resolve({ id: 'message' }); await h.pump(); assert.equal(h.prop('Mensagem no chat da live').value, 'Minha pergunta');
    h.live(fixture({ chat_enabled: false })); await h.pump(); h.prop('Enviar mensagem').onPress(); assert.equal(h.sends.length, 1);
  } finally { h.dispose(); }
});

test('presence begins only after a student has playing pixels, and ends on pause/background; owner replay never joins', async () => {
  const h = harness(); try {
    await h.pump(); assert.equal(h.presence.at(-1).active, false); h.frame(); await h.pump(); assert.equal(h.presence.at(-1).active, true);
    h.prop('Pausar vídeo').onPress(); await h.pump(); assert.equal(h.presence.at(-1).active, false);
    h.prop('Reproduzir vídeo').onPress(); await h.pump(); assert.equal(h.presence.at(-1).active, true);
    h.app('background'); await h.pump(); assert.equal(h.presence.at(-1).active, false);
  } finally { h.dispose(); }
  const owner = harness(fixture(), { owner: 'creator' }); try { await owner.pump(); owner.frame(); await owner.pump(); assert.equal(owner.presence.some(value => value.active), false); } finally { owner.dispose(); }
});

test('unsupported paid access displays the sanitized backend reason without a futile retry or player replacement', async () => {
  const h = harness(fixture({ visibility: 'pro' }), { manualNetwork: true }); try {
    await h.pump(); const detail = 'Este formato de live ainda não está disponível no aplicativo.';
    h.calls[0].reject(new LiveBackendError(detail, 403, 'live_access_unsupported')); await h.pump();
    assert.ok(h.find(node => node.props?.children === detail)); assert.equal(h.find(node => node.props?.accessibilityLabel === 'Tentar carregar vídeo novamente'), undefined);
    assert.equal(h.replacements.length, 0); assert.equal(h.player.playCalls, 0);
  } finally { h.dispose(); }
});

test('paused replay mounts an already-measured native view before loading its source and keeps the same view across renewals', async () => {
  const h = harness(fixture({ status: 'ended', replay_published_at: '2026-10-10T13:00:00Z' }), { manualLayout: true }); try {
    await h.pump(); assert.equal(h.calls.length, 0); assert.equal(h.find(node => node.type === 'video'), undefined);
    h.viewport(400, 225); await h.pump(); const initial = h.find(node => node.type === 'video'); assert.ok(initial); assert.equal(h.calls.length, 0);
    h.viewLayout(0, 0); await h.pump(); assert.equal(h.calls.length, 0);
    h.viewLayout(400, 225); await h.pump(); assert.equal(h.calls.length, 1); assert.equal(h.player.playCalls, 0); const nativeKey = h.find(node => node.type === 'video').key;
    h.frame(); await h.pump(); h.player.currentTime = 14.5; h.viewport(800, 450); await h.pump(); h.viewLayout(800, 450); await h.pump(); assert.equal(h.calls.length, 1); assert.equal(h.player.currentTime, 14.5); assert.equal(h.find(node => node.type === 'video').key, nativeKey);
    h.emit('statusChange', { status: 'error' }); await h.pump(); h.prop('Tentar carregar vídeo novamente').onPress(); await h.pump(); assert.equal(h.calls.length, 2); assert.equal(h.find(node => node.type === 'video').key, nativeKey); assert.equal(h.player.playCalls, 0);
  } finally { h.dispose(); }
});
test('first-frame receipt before load completion is preserved, while frames before source application or after blur stay covered', async () => {
  const h = harness(fixture(), { manualNative: true }); try {
    await h.pump(); h.frame(); await h.pump(); assert.ok(h.find(node => node.type === 'image'));
    h.replacements[0].apply(); h.frame(); await h.pump(); assert.ok(h.find(node => node.type === 'image')); assert.equal(h.player.playCalls, 0);
    h.replacements[0].complete(); await h.pump(); assert.equal(h.find(node => node.type === 'image'), undefined); assert.equal(h.presence.at(-1).active, true);
    h.focus(false); await h.pump(); const oldFrame = h.find(node => node.type === 'video').props.onFirstFrameRender; h.owner('other'); await h.pump(); oldFrame(); await h.pump(); assert.ok(h.find(node => node.type === 'image')); assert.equal(h.presence.at(-1).active, false);
  } finally { h.dispose(); }
});

test('replay poster requires real playing time after its source frame; pause/seek/URL renewal keep native controls afterward', async () => {
  const h = harness(fixture({ status: 'ended', replay_published_at: '2026-10-10T13:00:00Z' })); try {
    await h.pump(); assert.ok(h.find(node => node.type === 'image')); assert.equal(h.player.playCalls, 0);
    h.prop('Reproduzir gravação').onPress(); await h.pump(); h.emit('timeUpdate', { currentTime: 0.4 }); await h.pump(); assert.ok(h.find(node => node.type === 'image'));
    h.frame(); await h.pump(); assert.ok(h.find(node => node.type === 'image')); h.emit('timeUpdate', { currentTime: 0 }); await h.pump(); assert.ok(h.find(node => node.type === 'image'));
    h.emit('timeUpdate', { currentTime: 0.5 }); await h.pump(); assert.equal(h.find(node => node.type === 'image'), undefined); assert.equal(h.find(node => node.type === 'video').props.nativeControls, true);
    h.prop('Pausar vídeo').onPress(); await h.pump(); h.player.currentTime = 0; h.emit('timeUpdate', { currentTime: 0 }); await h.pump(); assert.equal(h.find(node => node.type === 'image'), undefined);
    h.emit('statusChange', { status: 'error' }); await h.pump(); h.prop('Tentar carregar vídeo novamente').onPress(); await h.pump(); h.frame(); await h.pump(); assert.equal(h.player.playing, false); assert.equal(h.find(node => node.type === 'video').props.nativeControls, true); assert.equal(h.find(node => node.type === 'image'), undefined);
  } finally { h.dispose(); }
});
test('an old replay time event cannot unlock the poster after account change, blur or a restarted live', async () => {
  const h = harness(fixture({ status: 'ended', replay_published_at: '2026-10-10T13:00:00Z' })); try {
    await h.pump(); h.frame(); h.player.play(); h.emit('timeUpdate', { currentTime: 0.4 }); await h.pump(); assert.equal(h.find(node => node.type === 'image'), undefined);
    h.live(fixture({ status: 'waiting' })); await h.pump(); h.emit('timeUpdate', { currentTime: 2 }); await h.pump();
    h.live(fixture({ status: 'ended', replay_published_at: '2026-10-10T13:00:00Z' })); await h.pump(); h.frame(); h.emit('timeUpdate', { currentTime: 2 }); await h.pump(); assert.ok(h.find(node => node.type === 'image')); assert.equal(h.find(node => node.type === 'video').props.nativeControls, false);
    h.focus(false); await h.pump(); h.emit('timeUpdate', { currentTime: 2 }); await h.pump(); assert.ok(h.find(node => node.type === 'image'));
    h.owner('other'); h.focus(true); await h.pump(); h.emit('timeUpdate', { currentTime: 2 }); await h.pump(); assert.ok(h.find(node => node.type === 'image')); assert.equal(h.find(node => node.type === 'video').props.nativeControls, false);
  } finally { h.dispose(); }
});

test('background during the ended HLS tail pauses and restores truthful Play controls without replaying or replacing it', async () => {
  const h = harness(); try {
    await h.pump(); h.frame(); await h.pump(); h.live(fixture({ status: 'ended' })); await h.pump(); assert.equal(h.player.playing, true);
    h.app('background'); await h.pump(); assert.equal(h.player.playing, false); h.app('active'); await h.pump();
    assert.ok(h.prop('Reproduzir live')); assert.ok(h.prop('Reproduzir vídeo')); assert.equal(h.calls.length, 1); assert.equal(h.player.playCalls, 1);
  } finally { h.dispose(); }
});

test('unsupported paid access opens only the explicit Classfy web route, never a native player or presence', async () => {
  const id = 'live/aula?x=1';
  const h = harness(fixture({ visibility: 'pro' }), { manualNetwork: true, id }); try {
    await h.pump(); h.calls[0].reject(new LiveBackendError('Este formato ainda usa o acesso da web.', 403, 'live_access_unsupported')); await h.pump();
    const open = h.prop('Abrir live no navegador').onPress;
    assert.deepEqual(h.browserUrls, []); assert.equal(h.find(node => node.props?.accessibilityLabel === 'Tentar carregar vídeo novamente'), undefined);
    open(); await h.pump(); assert.deepEqual(h.browserUrls, [`https://classfy.com.br/live/${encodeURIComponent(id)}`]); assert.equal(h.replacements.length, 0); assert.equal(h.player.playCalls, 0); assert.equal(h.presence.some(item => item.active), false);
    h.focus(false); await h.pump(); open(); await h.pump(); assert.equal(h.browserUrls.length, 1);
    h.owner('other'); await h.pump(); open(); await h.pump(); assert.equal(h.browserUrls.length, 1);
  } finally { h.dispose(); }
});
test('ordinary 401/403/404 errors do not receive a browser fallback or retry', async () => {
  for (const status of [401, 403, 404]) {
    const h = harness(fixture(), { manualNetwork: true }); try {
      await h.pump(); h.calls[0].reject(new LiveBackendError('Acesso indisponível.', status, 'access_denied')); await h.pump();
      assert.equal(h.find(node => node.props?.label === 'Abrir live no navegador'), undefined); assert.equal(h.find(node => node.props?.accessibilityLabel === 'Tentar carregar vídeo novamente'), undefined); assert.equal(h.browserUrls.length, 0); assert.equal(h.replacements.length, 0);
    } finally { h.dispose(); }
  }
});

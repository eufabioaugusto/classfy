import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('./MiniPlayerProvider.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const media = (fileUrl = 'https://media/one.m3u8', lessonId = 'one') => ({ id: 'course', lessonId, title: lessonId, fileUrl });

function harness() {
  const slots = [], listeners = new Map(), replacements = [], calls = [];
  let cursor = 0, effects = [], dirty = true, tree, owner = 'owner-a', creations = 0, trackers = 0;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(initial) {
      const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }];
    },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) effects.push({ i, callback, deps }); },
    useMemo(factory, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { deps, value: factory() }; return slots[i].value; },
  };
  hooks.useCallback = (callback, deps) => hooks.useMemo(() => callback, deps);
  const player = {
    status: 'idle', duration: 120, currentTime: 0, playbackRate: 1, playing: false,
    pause() { calls.push(['pause']); player.playing = false; },
    play() { calls.push(['play']); player.playing = true; },
    replaceAsync(source) {
      calls.push(['replace', source]);
      let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      replacements.push({ source, resolve, reject }); return promise;
    },
    addListener(name, callback) {
      const bucket = listeners.get(name) || new Set(); bucket.add(callback); listeners.set(name, bucket);
      return { remove: () => bucket.delete(callback) };
    },
  };
  class PlaybackProgress {
    constructor() { trackers++; this.watched = 0; }
    discontinuity() {}
    sample() { return this.watched; }
  }
  const deps = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-video': { useVideoPlayer(source, setup) { const ref = hooks.useRef(null); if (!ref.current) { creations++; setup(player); ref.current = player; } return ref.current; } },
    '@/features/auth/authContext': { useAuth: () => ({ user: owner ? { id: owner } : null }) },
    '@/lib/supabase': { supabase: { rpc: async () => { throw Error('Unexpected progress RPC'); } } },
    './miniPlayerContext': { MiniPlayerContext: { Provider: 'Provider' } },
    '@/features/rewards/events': { notifyConfirmedRewards() { throw Error('Unexpected reward'); } },
    './playbackProgress': { PlaybackProgress, createSessionId: () => `session-${trackers}` },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, `Unexpected dependency ${name}`); return deps[name]; }, module, module.exports);
  const render = () => {
    cursor = 0; dirty = false; effects = []; tree = module.exports.MiniPlayerProvider({ children: 'child' });
    for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }; }
  };
  const pump = async () => {
    for (let i = 0; i < 12; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty) return; }
    throw Error('Provider did not settle');
  };
  const emit = (name, payload, nativeStatus) => {
    if (nativeStatus !== undefined) player.status = nativeStatus;
    for (const callback of listeners.get(name) || []) callback(payload);
  };
  const ready = async (source = media(), index = replacements.length) => {
    const result = tree.props.value.attach(source); await pump();
    player.status = 'readyToPlay'; emit('sourceChange', { source: { uri: source.fileUrl } }); replacements[index].resolve(); await result; await pump();
  };
  return {
    pump, player, calls, replacements, emit, ready,
    value: () => tree.props.value,
    creations: () => creations, trackers: () => trackers,
    owner(value) { owner = value; dirty = true; },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('readiness needs the current source proof, a settled replacement and native ready status, including audio', async () => {
  const h = harness(); try {
    await h.pump(); assert.equal(h.value().sourceReady, false);
    const audio = media('https://media/audio.m4a'); const attached = h.value().attach(audio); await h.pump();
    h.emit('statusChange', { status: 'readyToPlay' }, 'readyToPlay'); await h.pump(); assert.equal(h.value().sourceReady, false);
    h.emit('sourceLoad', { videoSource: 'https://media/previous.m4a' }); await h.pump(); assert.equal(h.value().sourceReady, false);
    h.emit('sourceChange', { source: { uri: audio.fileUrl } }); await h.pump(); assert.equal(h.value().sourceReady, false);
    h.replacements[0].resolve(); await attached; await h.pump();
    assert.equal(h.value().sourceReady, true); assert.equal(h.value().status, 'readyToPlay'); assert.equal(h.value().error, null);
    assert.equal(h.creations(), 1); assert.equal(h.value().player, h.player);
  } finally { h.dispose(); }
});

test('sourceLoad also resolves ready-before-metadata ordering without a first-frame event', async () => {
  const h = harness(); try {
    await h.pump(); const attached = h.value().attach(media()); await h.pump();
    h.player.status = 'readyToPlay'; h.replacements[0].resolve(); await attached; await h.pump(); assert.equal(h.value().sourceReady, false);
    h.emit('sourceLoad', { videoSource: { uri: media().fileUrl }, duration: 120, availableVideoTracks: [] }); await h.pump();
    assert.equal(h.value().sourceReady, true);
  } finally { h.dispose(); }
});

test('native URL records are compared after URL normalization without losing signed query parameters', async () => {
  const h = harness(); try {
    await h.pump(); const source = media('HTTPS://MEDIA.EXAMPLE:443/a video.m3u8?token=test%2Fvalue'); const attached = h.value().attach(source); await h.pump();
    h.player.status = 'readyToPlay'; h.replacements[0].resolve(); await attached;
    h.emit('sourceLoad', { videoSource: { uri: 'https://media.example/a%20video.m3u8?token=other' } }); await h.pump(); assert.equal(h.value().sourceReady, false);
    h.emit('sourceChange', { source: { uri: 'https://media.example/a%20video.m3u8?token=test%2Fvalue' } }); await h.pump(); assert.equal(h.value().sourceReady, true);
  } finally { h.dispose(); }
});

test('a native error before source metadata remains scoped until the matching source proves it is current', async () => {
  const h = harness(); try {
    await h.pump(); const attached = h.value().attach(media()); await h.pump(); h.replacements[0].resolve(); await attached;
    h.emit('statusChange', { status: 'error', error: { message: 'current item failed' } }, 'error'); await h.pump(); assert.equal(h.value().error, null);
    h.emit('sourceLoad', { videoSource: media().fileUrl, availableVideoTracks: [] }); await h.pump();
    assert.equal(h.value().sourceReady, false); assert.equal(h.value().status, 'error'); assert.match(h.value().error, /reproduzir/);
  } finally { h.dispose(); }
});

test('new lesson ignores previous-source ready/error events while replacement is pending and after it becomes ready', async () => {
  const h = harness(); try {
    await h.pump(); await h.ready(); const next = media('https://media/two.m3u8', 'two');
    const attached = h.value().attach(next); await h.pump();
    for (const status of ['readyToPlay', 'error']) { h.emit('statusChange', { status, error: status === 'error' ? { message: 'old' } : undefined }, status); h.emit('sourceLoad', { videoSource: media().fileUrl }); await h.pump(); assert.equal(h.value().sourceReady, false); assert.equal(h.value().error, null); assert.equal(h.value().status, 'loading'); }
    h.player.status = 'loading'; h.replacements[1].resolve(); await attached; h.emit('sourceChange', { source: next.fileUrl }); await h.pump(); assert.equal(h.value().sourceReady, false);
    h.emit('statusChange', { status: 'readyToPlay' }, 'readyToPlay'); await h.pump(); assert.equal(h.value().sourceReady, true);
    h.emit('statusChange', { status: 'error', error: { message: 'delayed old payload' } }); h.emit('sourceLoad', { videoSource: media().fileUrl }); await h.pump();
    assert.equal(h.value().sourceReady, true); assert.equal(h.value().error, null); assert.equal(h.value().content.lessonId, 'two'); assert.equal(h.creations(), 1);
  } finally { h.dispose(); }
});

test('same session/source keeps readiness and position; refreshed URL replaces only the source and resumes that session', async () => {
  const h = harness(); try {
    await h.pump(); await h.ready(); h.emit('timeUpdate', { currentTime: 23.5 }); h.player.currentTime = 23.5; h.player.playing = true; await h.pump();
    await h.value().attach({ ...media(), title: 'Título atualizado' }); await h.pump();
    assert.equal(h.value().sourceReady, true); assert.equal(h.value().position, 23.5); assert.equal(h.replacements.length, 1); assert.equal(h.trackers(), 1);
    const refreshed = media('https://media/one-refreshed.m3u8'); const attached = h.value().attach(refreshed); await h.pump(); assert.equal(h.value().sourceReady, false);
    h.player.status = 'readyToPlay'; h.emit('sourceLoad', { videoSource: refreshed.fileUrl }); h.replacements[1].resolve(); await attached; await h.pump();
    assert.equal(h.value().sourceReady, true); assert.equal(h.player.currentTime, 23.5); assert.equal(h.player.playing, true); assert.equal(h.trackers(), 1); assert.equal(h.creations(), 1);
  } finally { h.dispose(); }
});

test('superseded deferred replacements cannot make the next lesson ready', async () => {
  const h = harness(); try {
    await h.pump(); const old = h.value().attach(media()); await h.pump(); const next = media('https://media/two.m3u8', 'two'); const active = h.value().attach(next); await h.pump();
    h.player.status = 'readyToPlay'; h.emit('sourceChange', { source: media().fileUrl }); h.replacements[0].resolve(); await old; await h.pump();
    assert.equal(h.replacements.length, 2); assert.equal(h.value().sourceReady, false); assert.equal(h.value().content.lessonId, 'two');
    h.emit('sourceLoad', { videoSource: media().fileUrl }); h.replacements[1].resolve(); await active; await h.pump(); assert.equal(h.value().sourceReady, false);
    h.emit('sourceChange', { source: next.fileUrl }); await h.pump(); assert.equal(h.value().sourceReady, true);
  } finally { h.dispose(); }
});

test('current-source native error stays visible and explicit close plus attach retries on the same player', async () => {
  const h = harness(); try {
    await h.pump(); await h.ready(); h.emit('statusChange', { status: 'error', error: { message: 'network' } }, 'error'); await h.pump();
    assert.equal(h.value().sourceReady, false); assert.equal(h.value().status, 'error'); assert.match(h.value().error, /reproduzir/);
    h.value().closeMiniPlayer(); const retried = h.value().attach(media()); await h.pump(); assert.equal(h.value().sourceReady, false); assert.equal(h.value().error, null);
    assert.equal(h.replacements[1].source, null); h.replacements[1].resolve(); await h.pump(); assert.equal(h.replacements[2].source, media().fileUrl);
    h.player.status = 'readyToPlay'; h.emit('sourceChange', { source: media().fileUrl }); h.replacements[2].resolve(); await retried; await h.pump();
    assert.equal(h.value().sourceReady, true); assert.equal(h.value().error, null); assert.equal(h.creations(), 1);
  } finally { h.dispose(); }
});

test('rejected current replacement reports a retryable error, but a rejected stale replacement does not', async () => {
  const h = harness(); try {
    await h.pump(); const old = h.value().attach(media()); await h.pump(); const next = h.value().attach(media('https://media/two.m3u8', 'two')); await h.pump();
    h.replacements[0].reject(Error('old failure')); await old; await h.pump(); assert.equal(h.value().error, null);
    h.replacements[1].reject(Error('current failure')); await next; await h.pump();
    assert.equal(h.value().sourceReady, false); assert.equal(h.value().status, 'error'); assert.match(h.value().error, /Tente novamente/);
  } finally { h.dispose(); }
});

test('owner change closes the session and rejects all late source/status completion', async () => {
  const h = harness(); try {
    await h.pump(); const attached = h.value().attach(media()); await h.pump(); h.owner('owner-b'); await h.pump();
    h.player.status = 'readyToPlay'; h.emit('sourceChange', { source: media().fileUrl }); h.emit('sourceLoad', { videoSource: media().fileUrl }); h.emit('statusChange', { status: 'readyToPlay' }); h.replacements[0].resolve(); await attached; await h.pump();
    assert.equal(h.value().sourceReady, false); assert.equal(h.value().content, null); assert.equal(h.value().visible, false); assert.equal(h.value().status, 'idle'); assert.equal(h.value().error, null); assert.equal(h.replacements[1].source, null); assert.equal(h.creations(), 1);
  } finally { h.dispose(); }
});

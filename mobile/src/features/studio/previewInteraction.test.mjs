import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
import * as timeline from './timeline.ts';
import * as sourceReady from './videoSourceReady.ts';

function compile(file, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}
const interaction = compile('./editorInteraction.ts', { './timeline': timeline });
const take = (id, start = 2, end = 8) => ({ id, uri: `file:///${id}.mp4`, name: id, duration: 10, start, end });

// Execute the actual component's hooks and native event handlers. Replacement
// completion is independent of rendering and seeks, as on the iOS main queue.
function harness(takes) {
  const slots = [];
  let cursor = 0;
  let dirty = true;
  let effects = [];
  let props;
  const published = [];
  const selected = [];
  const ref = { current: null };
  const equals = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    forwardRef: callback => callback,
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
    useImperativeHandle: (target, create, dependencies) => { target.current = hooks.useCallback(create, dependencies)(); },
  };
  const listeners = new Map();
  const emit = (name, event) => { for (const listener of [...(listeners.get(name) || [])]) listener(event); };
  let nativeTime = 0;
  const player = {
    status: 'idle', playing: false, uri: null, requests: [], writes: [], pauses: 0, plays: 0,
    get currentTime() { return nativeTime; },
    set currentTime(seconds) { this.writes.push({ uri: this.uri, seconds }); },
    addListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
      return { remove: () => listeners.get(name).delete(listener) };
    },
    pause() { this.pauses += 1; if (this.playing) { this.playing = false; emit('playingChange', { isPlaying: false }); } },
    play() { this.plays += 1; this.playing = true; emit('playingChange', { isPlaying: true }); },
    replaceAsync(uri) {
      this.status = 'loading';
      return new Promise(resolve => this.requests.push({ uri, complete: () => {
        this.uri = uri; nativeTime = 0;
        this.status = uri ? 'readyToPlay' : 'idle';
        emit('sourceChange', { source: uri });
        if (uri) emit('sourceLoad', { videoSource: uri });
        emit('statusChange', { status: this.status });
        resolve();
      } }));
    },
    tick(seconds) { nativeTime = seconds; emit('timeUpdate', { currentTime: seconds }); },
    end() { emit('playToEnd', {}); },
  };
  const component = compile('./StudioPreview.tsx', {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { ActivityIndicator: 'spinner', Pressable: 'button', Text: 'text', View: 'view',
      StyleSheet: { create: styles => styles, absoluteFillObject: {} },
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-router': { useFocusEffect: callback => hooks.useEffect(callback, [callback]) },
    'expo-video': { VideoView: 'video', useVideoPlayer: (_, initialize) => {
      const initialized = hooks.useRef(false);
      if (!initialized.current) { initialized.current = true; initialize(player); }
      return player;
    } },
    'lucide-react-native': { Mic: 'mic', RotateCcw: 'retry', Video: 'video-icon' },
    '@/theme/colors': { colors: {} }, './model': model, './timeline': timeline,
    './editorInteraction': interaction, './videoSourceReady': sourceReady,
  }).StudioPreview;
  props = { takes, kind: 'aula', activeTakeId: takes[0]?.id,
    onPlaybackState: state => published.push(state),
    onActiveTakeChange: id => { selected.push(id); props = { ...props, activeTakeId: id }; dirty = true; } };
  const render = () => {
    dirty = false; cursor = 0; effects = [];
    component(props, ref);
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
    throw new Error('Preview render did not settle');
  };
  const load = async () => {
    await pump();
    assert.ok(player.requests.length, 'native source replacement expected');
    player.requests.shift().complete();
    await pump();
  };
  const dispose = async () => {
    for (const slot of slots) slot?.cleanup?.();
    for (const request of player.requests.splice(0)) request.complete();
    await new Promise(resolve => setImmediate(resolve));
  };
  return { ref, player, published, selected, pump, load, dispose, update: next => { props = { ...props, ...next }; dirty = true; } };
}

test('frames da borda não mudam playhead nem avançam e movimentos seguintes não reconfiguram o player', async () => {
  const view = harness([take('a'), take('b')]);
  try {
    await view.load();
    view.ref.current.seek(4); view.player.tick(6);
    const position = view.published.at(-1).position;
    const count = view.published.length;
    view.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 1 });
    await view.pump();
    view.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 8.5 });
    await view.load();
    assert.deepEqual(view.player.writes.at(-1), { uri: 'file:///b.mp4', seconds: 8.5 });
    const pauses = view.player.pauses;
    view.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 8.8 });
    await view.pump();
    view.player.tick(9); view.player.end(); view.ref.current.togglePlayback();
    assert.equal(view.player.pauses, pauses);
    assert.equal(view.player.requests.length, 0);
    assert.equal(view.player.plays, 0);
    assert.equal(view.published.length, count);
    assert.equal(view.published.at(-1).position, position);
    assert.deepEqual(view.selected, []);
  } finally { await view.dispose(); }
});

test('cancelar enquanto outra fonte carrega espera a fila e restaura só o frame ancorado', async () => {
  const view = harness([take('a'), take('b')]);
  try {
    await view.load();
    view.ref.current.seek(4); view.player.tick(6);
    view.player.writes.length = 0;
    view.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 9 });
    await view.pump();
    assert.equal(view.player.requests[0].uri, 'file:///b.mp4');
    view.ref.current.seek(4, { takeId: 'a', uri: 'file:///a.mp4', seconds: 6 });
    await view.pump();
    assert.equal(view.player.requests.length, 1, 'replacement must stay serialized');
    await view.load();
    assert.equal(view.player.requests[0].uri, 'file:///a.mp4');
    await view.load();
    assert.deepEqual(view.player.writes, [{ uri: 'file:///a.mp4', seconds: 6 }]);
    assert.equal(view.published.at(-1).position, 4);
    assert.equal(view.published.at(-1).takeId, 'a');
    assert.equal(view.published.at(-1).loading, false);
  } finally { await view.dispose(); }
});

test('um gesto cancelado antes de renderizar não deixa loading preso nem perde o ponto', async () => {
  const view = harness([take('a')]);
  try {
    await view.load();
    view.ref.current.seek(4); view.player.tick(6);
    view.ref.current.previewSourceFrame({ takeId: 'a', uri: 'file:///a.mp4', seconds: 7 });
    view.ref.current.seek(4, { takeId: 'a', uri: 'file:///a.mp4', seconds: 6 });
    await view.pump();
    assert.equal(view.player.requests.length, 0);
    assert.equal(view.player.writes.at(-1).seconds, 6);
    assert.equal(view.published.at(-1).loading, false);
    view.player.tick(6); view.ref.current.togglePlayback();
    assert.equal(view.player.playing, true);
  } finally { await view.dispose(); }
});

test('restaurar fim exato respeita a identidade da fonte em vez de saltar para o próximo clipe', async () => {
  const view = harness([take('a', 2, 5), take('b', 6, 10)]);
  try {
    await view.load();
    view.ref.current.seek(3, { takeId: 'a', uri: 'file:///a.mp4', seconds: 5 });
    await view.pump();
    assert.equal(view.player.writes.at(-1).seconds, 5);
    assert.equal(view.published.at(-1).takeId, 'a');
    assert.equal(view.published.at(-1).position, 3);
    view.ref.current.togglePlayback();
    await view.load();
    assert.equal(view.player.writes.at(-1).uri, 'file:///b.mp4');
    assert.equal(view.player.writes.at(-1).seconds, 6);
    assert.equal(view.player.playing, true, 'existing replay/advance remains available');
  } finally { await view.dispose(); }
});

test('commit de corte mantém a montagem salva durante a prévia e restaura o frame no novo intervalo', async () => {
  const original = [take('a'), take('b')];
  const view = harness(original);
  try {
    await view.load();
    view.ref.current.seek(9);
    await view.load();
    view.player.tick(5);
    const anchor = interaction.captureStudioPlaybackAnchor(original, view.published.at(-1));
    view.ref.current.previewSourceFrame({ takeId: 'a', uri: 'file:///a.mp4', seconds: 4 });
    await view.load();
    const count = view.published.length;
    const saved = [take('a', 4, 8), take('b')];
    view.update({ takes: saved, paused: true }); await view.pump();
    assert.equal(view.published.length, count, 'draft source must not publish resized montage time');
    const restored = interaction.restoreStudioPlaybackAnchor(saved, anchor);
    view.ref.current.seek(restored.position, restored.source);
    await view.load();
    assert.equal(view.player.writes.at(-1).seconds, 5);
    assert.equal(view.published.at(-1).position, 7);
    assert.equal(view.published.at(-1).takeId, 'b');
  } finally { await view.dispose(); }
});

test('mute do áudio principal atua no player real sem seek ou reload e acompanha podcast/novo original', async () => {
  const view = harness([take('a'), take('b')]);
  try {
    await view.load(); view.player.tick(5);
    const requests = view.player.requests.length, writes = view.player.writes.length;
    view.update({ kind: 'podcast', muted: true }); await view.pump();
    assert.equal(view.player.muted, true); assert.equal(view.player.requests.length, requests);
    assert.equal(view.player.writes.length, writes);
    view.ref.current.togglePlayback(); await view.pump(); assert.equal(view.player.muted, true);
    view.ref.current.pause(); view.ref.current.seek(9); await view.load();
    assert.equal(view.player.muted, true, 'source replacement cannot silently reactivate the original audio');
    const after = view.player.writes.length;
    view.update({ muted: false }); await view.pump();
    assert.equal(view.player.muted, false); assert.equal(view.player.writes.length, after);
  } finally { await view.dispose(); }
});

test('mute/unmute durante Play e rerender dos mesmos takes preservam player, fonte, quadro e cursor', async () => {
  const takes = [take('a'), take('b')], view = harness(takes);
  try {
    await view.load(); view.player.tick(2); view.ref.current.togglePlayback(); await view.pump(); view.player.tick(5);
    const writes = view.player.writes.length, pauses = view.player.pauses, plays = view.player.plays, uri = view.player.uri;
    for (const muted of [true, false, true, false]) {
      view.update({ muted, takes: takes.map(value => ({ ...value })) }); await view.pump();
      assert.equal(view.player.muted, muted); assert.equal(view.player.uri, uri); assert.equal(view.player.currentTime, 5);
      assert.equal(view.player.playing, true); assert.equal(view.player.requests.length, 0);
      assert.equal(view.player.writes.length, writes); assert.equal(view.player.pauses, pauses); assert.equal(view.player.plays, plays);
      assert.equal(view.published.at(-1).position, 3); assert.equal(view.published.at(-1).loading, false);
    }
  } finally { await view.dispose(); }
});

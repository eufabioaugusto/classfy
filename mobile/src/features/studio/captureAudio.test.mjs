import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';

function production(file, dependencies, globals) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unconfigured audio-monitor boundary: ${file} -> ${name}`);
    return dependencies[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}

// The production hook, normalization and NativeCamera event handlers execute
// together. React, native view/module, clock and timer are controlled boundaries;
// no recorder, capture session, microphone or network is started by this test.
function harness(initial = {}) {
  const contexts = new Map(), timers = new Map(), commands = [];
  let currentContext, effects = [], dirty = true, now = 1000, timerId = 0, monitor, nativeProps;
  let options = { active: true, available: true, scopeKey: 'owner:project-a:front', generation: 1, ...initial };
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  function slot() { const context = currentContext, index = context.cursor++; return { context, index }; }
  const react = {
    useRef(value) { const { context, index } = slot(); return context.slots[index] ||= { current: value }; },
    useState(initialValue) {
      const { context, index } = slot();
      if (!context.slots[index]) context.slots[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      return [context.slots[index].value, next => {
        const before = context.slots[index].value, after = typeof next === 'function' ? next(before) : next;
        if (!Object.is(before, after)) { context.slots[index].value = after; dirty = true; }
      }];
    },
    useMemo(callback, deps) {
      const { context, index } = slot();
      if (!context.slots[index] || !same(context.slots[index].deps, deps)) context.slots[index] = { value: callback(), deps };
      return context.slots[index].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const { context, index } = slot();
      if (!context.slots[index] || !same(context.slots[index].deps, deps)) effects.push({ context, index, callback, deps });
    },
    useImperativeHandle(ref, callback, deps) {
      react.useEffect(() => { ref.current = callback(); return () => { ref.current = null; }; }, deps);
    },
    forwardRef: callback => callback,
  };
  react.useLayoutEffect = react.useEffect;
  const schedule = (callback, delay = 0, interval) => { const id = ++timerId; timers.set(id, { callback, at: now + delay, interval }); return id; };
  const globals = { Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => schedule(callback, delay), clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => schedule(callback, delay, delay), clearInterval: id => timers.delete(id) };
  const bridge = {
    isStudioNativeCameraAvailable: () => true,
    isStudioNativeCameraEffectsAvailable: () => false,
    isStudioNativeCameraAudioMonitorAvailable: () => options.available,
    startStudioNativeCameraRecordingAsync: async (...args) => { commands.push({ kind: 'record', args }); throw Error('Audio-monitor tests cannot start REC'); },
    stopStudioNativeCameraRecordingAsync: async (...args) => { commands.push({ kind: 'stop', args }); },
    setStudioNativeCameraEffectAsync: async (...args) => { commands.push({ kind: 'effect', args }); throw Error('Audio-monitor tests cannot change camera effects'); },
  };
  const shared = { react, '../../../modules/classfy-studio-media': bridge };
  const hook = production('./StudioCaptureAudio.ts', shared, globals);
  const wrapper = production('./StudioNativeCamera.tsx', { ...shared, './model': model,
    'expo-crypto': { randomUUID: () => 'monitor-does-not-record' },
    'expo-modules-core': { requireNativeViewManager: () => 'native-camera' },
    'react-native': { findNodeHandle: () => 73, Platform: { OS: 'ios' } },
    'react/jsx-runtime': { jsx: (_type, props) => { nativeProps = props; props.ref.current = {}; return props; } },
  }, globals);
  const ref = { current: null };
  function component(key, callback) {
    let context = contexts.get(key);
    if (!context) { context = { cursor: 0, slots: [] }; contexts.set(key, context); }
    context.cursor = 0; currentContext = context;
    try { return callback(); } finally { currentContext = undefined; }
  }
  function commitEffects() {
    const pending = effects; effects = [];
    for (const effect of pending) {
      effect.context.slots[effect.index]?.cleanup?.();
      effect.context.slots[effect.index] = { deps: effect.deps, cleanup: effect.callback() };
    }
  }
  function render(applyEffects = true) {
    dirty = false; effects = [];
    monitor = component('hook', () => hook.useStudioCaptureAudioMonitor(options));
    component('wrapper', () => wrapper.StudioNativeCamera({ active: options.active,
      ...(options.available ? { onAudioMonitor: monitor.onAudioMonitor } : {}) }, ref));
    if (applyEffects) commitEffects();
  }
  function settle() { for (let step = 0; dirty && step < 30; step++) render(); assert.equal(dirty, false, 'Audio monitor render must settle'); }
  function advance(milliseconds) {
    const end = now + milliseconds;
    for (let step = 0; step < 500; step++) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) { now = end; settle(); return; }
      now = due[1].at;
      if (due[1].interval) due[1].at += due[1].interval; else timers.delete(due[0]);
      due[1].callback(); settle();
    }
    throw Error('Audio monitor timer loop did not settle');
  }
  const payload = patch => ({ version: 1, generation: 1, revision: 1, sequence: 1, timestampMs: now, active: true,
    input: { id: 'qa-built-in-mic', name: 'Microfone do iPhone', type: 'MicrophoneBuiltIn' },
    channels: [{ averageDb: -24, peakDb: -8 }], sampleRate: 48000, channelCount: 1, ageMs: 0, ...patch });
  settle(); if (options.nativeReady !== false) nativeProps.onState({ nativeEvent: { generation: options.generation, revision: 1 } });
  return { payload, commands, settle, advance, value: () => monitor, native: () => nativeProps,
    event(patch = {}) { nativeProps.onAudioMonitor?.({ nativeEvent: payload(patch) }); settle(); },
    raw(value) { monitor.onAudioMonitor(value); settle(); },
    update(patch) { options = { ...options, ...patch }; dirty = true; settle(); },
    updateBeforeEffects(patch) {
      options = { ...options, ...patch }; dirty = true; render(false);
      const frame = { input: monitor.input, channels: monitor.channels, status: monitor.status };
      commitEffects(); settle(); return frame;
    },
    state(value) { nativeProps.onState({ nativeEvent: value }); settle(); },
    unmount() { for (const context of contexts.values()) for (const slot of context.slots) slot?.cleanup?.(); },
  };
}

test('evento real do wrapper entrega microfone/mono e dBFS de silêncio sem gravar nem inventar stereo', () => {
  const h = harness();
  try {
    assert.equal(h.value().input, null); assert.deepEqual(h.value().channels, []);
    assert.equal(h.value().status, 'waiting');
    h.event();
    assert.equal(h.value().input.name, 'Microfone do iPhone');
    assert.deepEqual(h.value().channels, [{ averageDb: -24, peakDb: -8 }]);
    assert.equal(h.value().status, 'live');
    h.event({ sequence: 2, channels: [{ averageDb: -120, peakDb: -120 }] });
    assert.deepEqual(h.value().channels, [{ averageDb: -120, peakDb: -120 }]);
    assert.equal(h.value().status, 'live');
    assert.deepEqual(h.commands, []);
  } finally { h.unmount(); }
});

test('generation e sequence obsoletos não substituem a medição atual', () => {
  const h = harness();
  try {
    h.event({ sequence: 4, revision: 3 });
    const current = structuredClone(h.value().channels);
    h.event({ sequence: 3, channels: [{ averageDb: -1, peakDb: 0 }] });
    h.event({ sequence: 4, channels: [{ averageDb: -2, peakDb: 0 }] });
    h.event({ generation: 0, sequence: 99, channels: [{ averageDb: -3, peakDb: 0 }] });
    h.event({ sequence: 5, revision: 2, channels: [{ averageDb: -4, peakDb: 0 }] });
    assert.deepEqual(h.value().channels, current);
    h.update({ generation: 2 }); h.state({ generation: 2, revision: 1 });
    h.event({ generation: 1, sequence: 100 });
    assert.deepEqual(h.value().channels, []);
    assert.equal(h.value().status, 'waiting');
    h.event({ generation: 2, sequence: 1, input: { id: 'qa-usb', name: 'Microfone USB', type: 'USBAudio' } });
    assert.equal(h.value().input.name, 'Microfone USB');
    h.event({ generation: 1, sequence: 101 });
    assert.equal(h.value().input.name, 'Microfone USB');
  } finally { h.unmount(); }
});

test('inputLost/routeChanged limpam barras antigas e só nova leitura da rota confirmada as restaura', () => {
  const h = harness();
  try {
    h.event();
    h.event({ sequence: 2, reason: 'inputLost', input: null, channels: [], sampleRate: null, channelCount: 0, ageMs: null });
    assert.equal(h.value().input, null); assert.deepEqual(h.value().channels, []);
    assert.match(h.value().message, /desconectado/i);
    const usb = { id: 'qa-usb', name: 'Microfone USB', type: 'USBAudio' };
    h.event({ sequence: 3, reason: 'routeChanged', input: usb, channels: [], sampleRate: null, channelCount: 1, ageMs: null });
    assert.equal(h.value().input.name, usb.name); assert.deepEqual(h.value().channels, []);
    h.event({ sequence: 4, input: usb, channels: [{ averageDb: -36, peakDb: -12 }] });
    assert.deepEqual(h.value().channels, [{ averageDb: -36, peakDb: -12 }]);
    assert.equal(h.value().status, 'live');
    assert.match(h.value().message, /desconectado/i, 'A quick route recovery must not erase the disconnect notice immediately');
    for (let second = 1; second <= 8; second++) {
      h.advance(1000); h.event({ sequence: 4 + second, input: usb });
      if (second < 8) assert.match(h.value().message, /desconectado/i);
    }
    assert.equal(h.value().status, 'live'); assert.equal(h.value().message, undefined);
  } finally { h.unmount(); }
});

test('idade nativa e ausência de chegada expiram o nível sem confundir silêncio válido com fonte perdida', () => {
  const h = harness();
  try {
    h.event({ channels: [{ averageDb: -120, peakDb: -120 }] });
    h.advance(1000); assert.equal(h.value().channels.length, 1);
    h.advance(1000); assert.deepEqual(h.value().channels, []);
    assert.equal(h.value().status, 'interrupted');
    h.event({ sequence: 2, ageMs: 1501 }); assert.deepEqual(h.value().channels, []);
    h.event({ sequence: 3, ageMs: 0 }); assert.equal(h.value().channels.length, 1);
    h.event({ sequence: 4, ageMs: null, channels: [], sampleRate: null }); assert.deepEqual(h.value().channels, []);
  } finally { h.unmount(); }
});

test('payload inválido não cria leitura; versão desconhecida e valores não finitos são rejeitados', () => {
  const h = harness();
  try {
    for (const value of [null, {}, h.payload({ version: 2 }), h.payload({ sequence: NaN }), h.payload({ timestampMs: NaN }),
      h.payload({ channels: [{ averageDb: NaN, peakDb: -1 }] }), h.payload({ channels: [{ averageDb: -2, peakDb: Infinity }] }),
      h.payload({ channelCount: 2 }), h.payload({ active: false }), h.payload({ ageMs: null }),
      h.payload({ sampleRate: 0 }), h.payload({ channels: [{ averageDb: -1, peakDb: -2 }] }), h.payload({ input: { id: '', name: 'Unknown', type: 'USBAudio' } })]) {
      h.raw(value); assert.deepEqual(h.value().channels, []);
    }
    h.event({ sequence: 9, channels: [{ averageDb: NaN, peakDb: -1 }] }); assert.deepEqual(h.value().channels, []);
    h.event({ sequence: 10 }); assert.equal(h.value().channels.length, 1);
  } finally { h.unmount(); }
});

test('scope/foco/legacy e desmontagem rejeitam medição tardia sem iniciar outro capturador', () => {
  const h = harness();
  try {
    h.event();
    const oldCallback = h.value().onAudioMonitor;
    h.update({ scopeKey: 'other-owner:project-b:front' });
    oldCallback(h.payload({ sequence: 2 })); h.settle();
    assert.deepEqual(h.value().channels, []);
    h.event({ sequence: 3 }); assert.equal(h.value().channels.length, 1);
    h.update({ active: false }); h.event({ sequence: 4 });
    assert.deepEqual(h.value().channels, []);
    h.update({ active: true, available: false }); h.event({ sequence: 5 });
    assert.deepEqual(h.value().channels, []); assert.deepEqual(h.commands, []);
    assert.equal(h.value().status, 'unavailable'); assert.equal(h.native().onAudioMonitor, undefined);
    h.update({ available: true });
    const oldNative = h.native(); h.unmount();
    oldNative.onAudioMonitor({ nativeEvent: h.payload({ sequence: 6 }) });
    assert.deepEqual(h.value().channels, []);
  } finally { h.unmount(); }
});

test('wrapper exige geração confirmada e rejeita eventos que ficaram atrasados na fila JS', () => {
  const h = harness({ nativeReady: false });
  try {
    h.event(); assert.deepEqual(h.value().channels, []);
    h.state({ generation: 1, revision: 1 });
    h.event({ generation: 2 }); assert.deepEqual(h.value().channels, []);
    h.event(); assert.equal(h.value().status, 'live');
    const old = h.payload({ sequence: 2 });
    h.advance(2000);
    h.raw(old); assert.deepEqual(h.value().channels, []);
    h.raw(h.payload({ sequence: 3, timestampMs: 5000 })); assert.deepEqual(h.value().channels, []);
    h.event({ sequence: 4 }); assert.equal(h.value().status, 'live');
    // Native timestampMs is the PCM sample instant (unixMs minus ageMs),
    // so JS must not subtract ageMs a second time.
    h.event({ sequence: 5, timestampMs: 1400, ageMs: 1000, channels: [{ averageDb: -4, peakDb: 0 }] });
    assert.equal(h.value().status, 'live'); // Retains the last current sample: stale sequence5 was rejected.
    assert.deepEqual(h.value().channels, [{ averageDb: -24, peakDb: -8 }]);
    h.event({ sequence: 6, timestampMs: 2000, ageMs: 1000, channels: [{ averageDb: -30, peakDb: -10 }] });
    assert.deepEqual(h.value().channels, [{ averageDb: -30, peakDb: -10 }]);
  } finally { h.unmount(); }
});

test('blur/refocus no mesmo scope invalida callback anterior e não expõe níveis por um frame antes do efeito', () => {
  const h = harness();
  try {
    h.event();
    const old = h.value().onAudioMonitor;
    const hiddenFrame = h.updateBeforeEffects({ active: false });
    assert.equal(hiddenFrame.input, null); assert.deepEqual(hiddenFrame.channels, []);
    const restoredFrame = h.updateBeforeEffects({ active: true });
    assert.equal(restoredFrame.input, null); assert.deepEqual(restoredFrame.channels, []);
    old(h.payload({ sequence: 2 })); h.settle();
    assert.deepEqual(h.value().channels, []);
    h.event({ sequence: 3 }); assert.equal(h.value().status, 'live');
    const oldCurrent = h.value().onAudioMonitor;
    const newScopeFrame = h.updateBeforeEffects({ scopeKey: 'owner:project-b:front' });
    assert.equal(newScopeFrame.input, null); assert.deepEqual(newScopeFrame.channels, []);
    oldCurrent(h.payload({ sequence: 4 })); h.settle(); assert.deepEqual(h.value().channels, []);
  } finally { h.unmount(); }
});

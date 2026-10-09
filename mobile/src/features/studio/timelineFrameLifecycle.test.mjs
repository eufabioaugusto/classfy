import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformFileSync } from '@babel/core';
import ts from 'typescript';
import * as model from './model.ts';
import * as layout from './timelineLayout.ts';
import * as motionHelpers from './timelineMotion.ts';
import * as snapHelpers from './timelineSnap.ts';
import * as playbackHelpers from './timelinePlayback.ts';

const require = createRequire(import.meta.url);
const reanimatedSource = join(dirname(require.resolve('react-native-reanimated/package.json')), 'src');
const compiledModules = new Map();
function installedModule(path, dependencies, environment, requestFrame) {
  if (!compiledModules.has(path)) compiledModules.set(path, ts.transpileModule(readFileSync(join(reanimatedSource, path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'global', 'requestAnimationFrame', compiledModules.get(path))(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected installed Reanimated dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports, environment, requestFrame);
  return module.exports;
}

// The hook and both registries are the installed production implementations.
// Only scheduling and React's effect/ref lifecycle are controlled. In
// particular, registration, teardown and the first null delta are not mocked.
function frameLifecycle() {
  const environment = {}, pendingFrames = [], observed = new WeakSet();
  const stats = { registrations: 0, unregistrations: 0, frames: [] };
  let timestamp = 1064, dispatchUI;
  const observeRegistry = () => {
    const registry = environment._frameCallbackRegistry;
    if (!registry || observed.has(registry)) return;
    observed.add(registry);
    const register = registry.registerFrameCallback;
    registry.registerFrameCallback = (callback, id) => {
      stats.registrations++;
      register.call(registry, frame => { stats.frames.push(frame); callback(frame); }, id);
    };
    const unregister = registry.unregisterFrameCallback;
    registry.unregisterFrameCallback = id => { stats.unregistrations++; unregister.call(registry, id); };
  };
  return { stats, environment,
    hook(hooks, reanimated, onUI) {
      dispatchUI = onUI;
      const worklets = { runOnUI: callback => (...args) => reanimated.runOnUI(() => {
        callback(...args); observeRegistry();
      })() };
      const requestFrame = callback => pendingFrames.push(callback);
      const registryUI = installedModule('frameCallback/FrameCallbackRegistryUI.ts', {
        'react-native-worklets': worklets,
      }, environment, requestFrame);
      const registryJS = installedModule('frameCallback/FrameCallbackRegistryJS.ts', {
        'react-native-worklets': worklets, './FrameCallbackRegistryUI': registryUI,
      }, environment, requestFrame);
      return installedModule('hook/useFrameCallback.ts', {
        react: hooks, '../frameCallback/FrameCallbackRegistryJS': registryJS,
      }, environment, requestFrame).useFrameCallback;
    },
    frame(elapsed) {
      timestamp += elapsed;
      // Old loops remain queued after unregister; the real registry rejects
      // their callId, exactly as it does on a subsequent native display frame.
      for (const callback of pendingFrames.splice(0)) dispatchUI(callback)(timestamp);
    },
  };
}

function createFrameLifecycleHook(hooks, reanimated, onUI, lifecycle) {
  assert.ok(lifecycle, 'The production timeline must use the real frame lifecycle');
  return lifecycle.hook(hooks, reanimated, onUI);
}

// Reuse the real component/gesture/React harness without editing its owner’s
// file or executing its tests. Replace just its lightweight frame hook. Its
// derived value must also keep native identity, so deps[total] is meaningful.
function loadTimelineHarness(helpers = playbackHelpers) {
  const file = new URL('./timelineInteraction.test.mjs', import.meta.url);
  const contents = readFileSync(file, 'utf8');
  const firstTest = contents.indexOf('\ntest(');
  assert.ok(firstTest > 0, 'Timeline harness boundary expected');
  let prefix = contents.slice(0, firstTest)
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(file.href));
  const injection = `
    reanimated.useFrameCallback = createFrameLifecycleHook(hooks, reanimated, onUI, options.frameLifecycle);
    reanimated.useDerivedValue = callback => {
      const ref = hooks.useRef(null);
      if (!ref.current) ref.current = { callback, shared: { get value() { return ref.current.callback(); } } };
      ref.current.callback = callback;
      return ref.current.shared;
    };
    const dependencies = {`;
  assert.equal(prefix.split('const dependencies = {').length, 2, 'Harness injection has exactly one dependency map');
  prefix = prefix.replace('const dependencies = {', injection);
  return new Function('assert', 'readFileSync', 'createRequire', 'dirname', 'fileURLToPath', 'transformFileSync', 'ts',
    'model', 'layout', 'motionHelpers', 'snapHelpers', 'playbackHelpers', 'createFrameLifecycleHook',
    `${prefix}\nreturn harness;`)(assert, readFileSync, createRequire, dirname, fileURLToPath, transformFileSync, ts,
    model, layout, motionHelpers, snapHelpers, helpers, createFrameLifecycleHook);
}
const timelineHarness = loadTimelineHarness();

function displayFrame(view, lifecycle, elapsed) {
  view.frame(elapsed); lifecycle.frame(elapsed); view.reactions();
  const position = view.playerPosition(), scrolls = view.scrolls.splice(0);
  view.flushJS(); view.flushUI();
  if (scrolls.length) {
    view.scroll().onScroll({ contentOffset: { x: scrolls.at(-1).x } });
    view.flushJS(); view.flushUI();
  }
  return { position, scrolls };
}

function warmPlayback(view, lifecycle, elapsed) {
  // Activate the native registry while paused. Play must then consume every
  // elapsed interval, including its first display frame.
  displayFrame(view, lifecycle, elapsed);
  view.update({ position: 1, playing: true, loading: false }); view.flushUI(); view.reactions();
  view.scrolls.length = 0;
  return 1;
}

function assertFrameMovement(previous, result, elapsed, previousX, allowStall = false) {
  const seconds = elapsed / 1000, delta = result.position - previous;
  assert.ok(delta >= (allowStall ? 0 : seconds * .85) - 1e-7, `display moved backward or lost time: ${previous} → ${result.position}`);
  assert.ok(delta <= seconds * 1.15 + 1e-7, `display jumped between frames: ${previous} → ${result.position}`);
  let x = previousX;
  for (const scroll of result.scrolls) {
    assert.ok(scroll.x >= x - 1e-7, `rendered scroll moved backward: ${x} → ${scroll.x}`);
    assert.ok(scroll.x - previousX <= seconds * 60 * 1.15 + 1e-7, 'scroll pixels cannot jump ahead of the display clock');
    x = scroll.x;
  }
  if (!allowStall) assert.ok(result.scrolls.length, 'every playback frame must move the actual displayed strip');
  assert.ok(Math.abs(x - result.position * 60) < .01, 'the displayed strip follows the measured position');
  return x;
}

function exerciseDelayedPlayback(fps, harness = timelineHarness) {
  const lifecycle = frameLifecycle();
  const view = harness({ nativeSharedValues: true, nativeWorklets: true, frameLifecycle: lifecycle });
  const elapsed = 1000 / fps, delayFrames = Math.round(.3 * fps), sampleFrames = fps / 15;
  let previous = 1, lastX = 60, previousSample = 1, received = 0;
  try {
    warmPlayback(view, lifecycle, elapsed);
    for (let index = 0; index < fps * 2; index++) {
      if (index >= delayFrames + sampleFrames && (index - delayFrames) % sampleFrames === 0) {
        const sample = 1 + (index - delayFrames) / fps;
        assert.ok(sample > previousSample, 'delayed native samples still advance monotonically at15Hz');
        previousSample = sample; received++;
        view.update({ position: sample }); view.flushUI();
      }
      const result = displayFrame(view, lifecycle, elapsed);
      lastX = assertFrameMovement(previous, result, elapsed, lastX, true);
      previous = result.position;
    }
    assert.ok(received >= 20, 'continuous delayed samples are exercised after the initial watchdog stall');
    assert.ok(previous > 2, 'the watchdog recovers and playback really advances');
    assert.equal(lifecycle.stats.registrations, 1);
    assert.deepEqual(view.seeks, []);
    return previous;
  } finally { view.dispose(); view.flushUI(); }
}

function controlledReact() {
  const slots = [], jobs = [];
  let cursor = 0, effects = [];
  const hooks = {
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((item, at) => !Object.is(item, slots[index].dependencies[at]))) effects.push({ index, callback, dependencies });
    },
  };
  const flushUI = () => { while (jobs.length) jobs.shift()(); };
  return { hooks, flushUI,
    reanimated: { runOnUI: callback => (...args) => jobs.push(() => callback(...args)) },
    render(callback) {
      cursor = 0; effects = []; callback();
      for (const effect of effects) {
        slots[effect.index]?.cleanup?.();
        slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() };
      }
      flushUI();
    },
    dispose() { for (const slot of slots) slot?.cleanup?.(); flushUI(); },
  };
}

for (const fps of [60, 120]) {
  test(`registries instalados reproduzem o frame null por rerender inline e preservam callback estável em ${fps}Hz`, () => {
    for (const stable of [false, true]) {
      const react = controlledReact(), lifecycle = frameLifecycle();
      const useFrameCallback = lifecycle.hook(react.hooks, react.reanimated, callback => callback);
      const onFrame = () => {};
      try {
        for (let frame = 0; frame < fps; frame++) {
          if (frame % (fps / 15) === 0) react.render(() => useFrameCallback(stable ? onFrame : value => onFrame(value)));
          lifecycle.frame(1000 / fps);
        }
        assert.equal(lifecycle.stats.registrations, stable ? 1 : 15);
        assert.equal(lifecycle.stats.frames.length, fps);
        assert.equal(lifecycle.stats.frames.filter(frame => frame.timeSincePreviousFrame === null).length, stable ? 1 : 15);
        const elapsed = lifecycle.stats.frames.reduce((sum, frame) => sum + (frame.timeSincePreviousFrame || 0), 0);
        const expected = stable ? 1000 - 1000 / fps : 1000 - 15 * 1000 / fps;
        assert.ok(Math.abs(elapsed - expected) < .001);
      } finally { react.dispose(); }
      assert.equal(lifecycle.environment._frameCallbackRegistry.activeFrameCallbacks.size, 0);
    }
  });
  test(`StudioTimeline Babel mantém um único registro com samples15Hz e feedback de scroll64ms em ${fps}Hz`, () => {
    const lifecycle = frameLifecycle();
    const view = timelineHarness({ nativeSharedValues: true, nativeWorklets: true, frameLifecycle: lifecycle });
    try {
      const elapsed = 1000 / fps;
      let previous = warmPlayback(view, lifecycle, elapsed), lastX = 60;
      for (let index = 0; index < fps; index++) {
        if (index && index % (fps / 15) === 0) { view.update({ position: 1 + index / fps }); view.flushUI(); }
        const result = displayFrame(view, lifecycle, elapsed);
        lastX = assertFrameMovement(previous, result, elapsed, lastX);
        previous = result.position;
      }
      assert.ok(Math.abs(previous - 2) <= .02, 'one uninterrupted second must lose at most20ms');
      assert.equal(lifecycle.stats.frames.length, fps + 1, 'the real registry runs on the paused warm frame and every playback frame');
      assert.equal(lifecycle.stats.registrations, 1, 'position and scroll feedback renders cannot recreate the production frame callback');
      assert.equal(lifecycle.stats.frames.filter(frame => frame.timeSincePreviousFrame === null).length, 1, 'only initial activation may omit elapsed time');
      assert.equal(lifecycle.stats.unregistrations, 0, 'no teardown is allowed while the same timeline remains mounted');
      assert.deepEqual(view.seeks, [], 'playback rendering cannot seek the player');
    } finally { view.dispose(); view.flushUI(); }
    assert.equal(lifecycle.stats.unregistrations, 1);
    assert.equal(lifecycle.environment._frameCallbackRegistry.activeFrameCallbacks.size, 0);
  });
  test(`amostras nativas atrasadas300ms não recuam nem saltam o scroll após watchdog em ${fps}Hz`, () => {
    exerciseDelayedPlayback(fps);
  });
  test(`Timeline real em${fps}Hz acompanha mídia lenta sem avançar segundos além do decoder`, () => {
    const channel = { value: { active: true, sequence: 1, position: .5, playing: false, loading: false } };
    const lifecycle = frameLifecycle();
    const view = timelineHarness({ nativeSharedValues: true, nativeWorklets: true, frameLifecycle: lifecycle, playbackChannel: channel, position: .5 });
    try {
      displayFrame(view, lifecycle, 1000 / fps);
      channel.value = { ...channel.value, sequence: 2, playing: true }; view.reactions();
      let previous = .5;
      for (let frame = 1; frame <= fps * 10; frame++) {
        if (frame % (fps / 15) === 0) {
          const native = .5 + frame / fps * .5;
          channel.value = { ...channel.value, sequence: channel.value.sequence + 1, position: native };
          view.update({ position: native, playing: true }); view.flushUI(); view.reactions();
        }
        const result = displayFrame(view, lifecycle, 1000 / fps);
        assert.ok(result.position >= previous - 1e-8);
        assert.ok(result.position <= channel.value.position + .12 + 1e-8, '15Hz progressive media cannot keep an unrelated wall clock alive');
        previous = result.position;
      }
      assert.equal(channel.value.position, 5.5);
      assert.ok(Math.abs(previous - 5.5) <= .12 + 1e-8);
      assert.equal(lifecycle.stats.registrations, 1);
      assert.equal(lifecycle.stats.frames.length, fps * 10 + 1);
      const elapsed = lifecycle.stats.frames.reduce((sum, frame) => sum + (frame.timeSincePreviousFrame || 0), 0);
      assert.ok(Math.abs(elapsed - 10000) < .001, 'installed registry deltas total ten elapsed seconds');
      channel.value = { ...channel.value, sequence: channel.value.sequence + 1, playing: false }; view.reactions();
      assert.ok(Math.abs(previous - view.playerPosition()) <= .12 + 1e-8, 'pause cannot expose several seconds of artificial lead');
      assert.deepEqual(view.seeks, []);
    } finally { view.dispose(); view.flushUI(); }
  });
}

test('TimelineLayer Babel preserva seu registro ao acompanhar os renders reais do parent', () => {
  const editing = { ...model.emptyStudioEditing('aula'),
    assets: [{ id: 'main', kind: 'video', uri: 'file:///main.mov', name: 'Main', durationTicks: model.studioTicks(20) }],
    main: [{ id: 'a', assetId: 'main', sourceStartTicks: model.studioTicks(2), sourceEndTicks: model.studioTicks(8) },
      { id: 'b', assetId: 'main', sourceStartTicks: model.studioTicks(10), sourceEndTicks: model.studioTicks(16) }],
    layers: [{ id: 'text', kind: 'text', items: [model.createStudioTextItem({ id: 'title', atTicks: model.studioTicks(1), durationTicks: model.studioTicks(2) })] }] };
  const layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.filter(clip => clip.zIndex > 0);
  const lifecycle = frameLifecycle(), fps = 60;
  const view = timelineHarness({ nativeSharedValues: true, nativeWorklets: true, frameLifecycle: lifecycle,
    editing, layers, takes: model.deriveStudioTakes(editing), selectedLayerId: 'title', onMoveLayer: async () => {} });
  try {
    view.childLayer('title'); view.flushUI(); warmPlayback(view, lifecycle, 1000 / fps);
    for (let index = 0; index < fps; index++) {
      if (index && index % 4 === 0) { view.update({ position: 1 + index / fps }); view.flushUI(); }
      displayFrame(view, lifecycle, 1000 / fps);
      view.childLayer('title'); view.flushUI();
    }
    assert.equal(lifecycle.stats.registrations, 2, 'parent and mounted layer each register exactly once');
    assert.equal(lifecycle.stats.frames.filter(frame => frame.timeSincePreviousFrame === null).length, 2);
    assert.equal(lifecycle.stats.unregistrations, 0);
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); view.flushUI(); }
  assert.equal(lifecycle.stats.unregistrations, 2);
  assert.equal(lifecycle.environment._frameCallbackRegistry.activeFrameCallbacks.size, 0);
});

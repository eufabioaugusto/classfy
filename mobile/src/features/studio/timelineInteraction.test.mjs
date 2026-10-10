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
const layerModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(new URL('./layerTimelineInteraction.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(name => { assert.equal(name, './model'); return model; }, layerModule, layerModule.exports);

const source = readFileSync(new URL('./StudioTimeline.tsx', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
let nativeCompiled;
const compileNative = () => nativeCompiled ||= transformFileSync(fileURLToPath(new URL('./StudioTimeline.tsx', import.meta.url)), {
  presets: [require.resolve('babel-preset-expo', { paths: [dirname(require.resolve('expo/package.json'))] })],
  plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  caller: { name: 'metro', supportsStaticESM: true, isDev: true, platform: 'ios' },
}).code;
const take = id => ({ id, uri: `file:///${id}.mp4`, name: id, duration: 10, start: 2, end: 8, thumbnailUri: `file:///${id}.jpg` });
const equalDependencies = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const resolveStyle = style => Object.assign({}, ...[].concat(style || []).flat(Infinity).filter(Boolean).map(value => value.__style ? value.__style() : value));
const layerVisibleWidth = tree => {
  const parent = resolveStyle(tree.props.style), body = resolveStyle(tree.props.children[0].props.children.props.style);
  return parent.width - body.left - body.right;
};
const layerVisibleLeft = tree => resolveStyle(tree.props.style).left + resolveStyle(tree.props.children[0].props.children.props.style).left;

// UI worklets and JS callbacks have independent queues. This executes the
// component's real handlers while allowing either side of a gesture race to
// arrive later, without asserting on source text or copying its decisions.
function harness(options = {}) {
  const nativeSharedValues = !!options.nativeSharedValues;
  let uiRuntime = false;
  const onUI = callback => {
    const wrapped = (...args) => {
      const previous = uiRuntime; uiRuntime = true;
      try { return callback(...args); } finally { uiRuntime = previous; }
    };
    if (callback.__workletHash !== undefined) wrapped.__workletHash = callback.__workletHash;
    return wrapped;
  };
  const contexts = new Map();
  let current;
  let now = 1000;
  let props;
  let commitResolver;
  const jsQueue = [];
  const uiQueue = [];
  const seeks = [];
  const selections = [];
  const previews = [];
  const commits = [];
  const cancellations = [];
  const scrolls = [];
  const feedbacks = [];
  const filmstripRequests = [];
  const appStateListeners = new Set();
  const context = key => {
    if (!contexts.has(key)) contexts.set(key, { slots: [], cursor: 0, effects: [], dirty: true, reactions: [], frames: [] });
    return contexts.get(key);
  };
  const hooks = {
    useRef: value => { const index = current.cursor++; return current.slots[index] ||= { current: value }; },
    useState: initial => {
      const scope = current; const index = scope.cursor++;
      if (!scope.slots[index]) scope.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [scope.slots[index].value, next => {
        const value = typeof next === 'function' ? next(scope.slots[index].value) : next;
        if (!Object.is(value, scope.slots[index].value)) { scope.slots[index].value = value; scope.dirty = true; }
      }];
    },
    useMemo: (create, dependencies) => {
      const index = current.cursor++;
      if (!current.slots[index] || !equalDependencies(current.slots[index].dependencies, dependencies)) current.slots[index] = { value: create(), dependencies };
      return current.slots[index].value;
    },
    useCallback: (callback, dependencies) => hooks.useMemo(() => callback, dependencies),
    useEffect: (callback, dependencies) => {
      const index = current.cursor++;
      if (!current.slots[index] || !equalDependencies(current.slots[index].dependencies, dependencies)) current.effects.push({ index, callback, dependencies });
    },
  };
  const gesture = kind => {
    const handlers = {};
    const chain = new Proxy({ kind, handlers }, { get: (target, name) => {
      if (name in target) return target[name];
      return (...values) => { const value = values[0]; if (String(name).startsWith('on')) handlers[name] = onUI(value); else target[name] = values.length > 1 ? values : value; return chain; };
    } });
    return chain;
  };
  const dynamic = callback => ({ get value() { return callback(); } });
  const reanimated = {
    __esModule: true,
    default: { View: 'animated-view', ScrollView: 'animated-scroll', createAnimatedComponent: type => `animated-${type}` },
    useSharedValue: initial => {
      const ref = hooks.useRef(null);
      if (!ref.current) {
        let value = initial;
        ref.current = { get value() { return value; }, set value(next) {
          // Reanimated native setters on JS schedule a UI microtask; an
          // immediate JS read still sees the previous UI value.
          if (nativeSharedValues && !uiRuntime) uiQueue.push({ callback: () => { value = next; }, args: [] });
          else value = next;
        } };
      }
      return ref.current;
    },
    useDerivedValue: callback => { const ref = hooks.useRef(callback); ref.current = callback; return dynamic(() => ref.current()); },
    useAnimatedRef: () => hooks.useRef(null),
    useAnimatedStyle: callback => { const ref = hooks.useRef(callback); ref.current = onUI(callback); return { __style: () => ref.current() }; },
    useAnimatedProps: callback => { const ref = hooks.useRef(callback); ref.current = onUI(callback); return { __props: () => ref.current() }; },
    useAnimatedReaction: (prepare, react) => {
      const ref = hooks.useRef({ prepare, react, previous: undefined, signature: undefined });
      ref.current.prepare = onUI(prepare); ref.current.react = onUI(react); current.reactions.push(ref.current);
    },
    useAnimatedScrollHandler: handlers => { const ref = hooks.useRef(handlers); ref.current = Object.fromEntries(Object.entries(handlers).map(([name, callback]) => [name, onUI(callback)])); return ref.current; },
    useFrameCallback: callback => { const ref = hooks.useRef(callback); ref.current = onUI(callback); current.frames.push(ref); },
    runOnJS: callback => (...args) => jsQueue.push({ callback, args }),
    runOnUI: callback => (...args) => uiQueue.push({ callback, args }),
    scrollTo: (_, x, y, animated) => scrolls.push({ x, y, animated }),
    measure: () => ({ pageX: 0 }),
  };
  const dependencies = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react/jsx-dev-runtime': { jsxDEV: (type, props) => ({ type, props }) },
    'react-native': { AppState: { addEventListener: (_event, callback) => { appStateListeners.add(callback); return { remove: () => appStateListeners.delete(callback) }; } }, Pressable: 'pressable', Text: 'text', View: 'view', StyleSheet: { create: styles => styles } },
    'expo-image': { Image: 'image' }, 'react-native-reanimated': reanimated,
    'react-native-gesture-handler': { GestureDetector: 'gesture-detector', Gesture: { Native: () => gesture('native'), Pinch: () => gesture('pinch'), Pan: () => gesture('pan'), Tap: () => gesture('tap'), Race: (...gestures) => ({ kind: 'race', gestures }) } },
    'lucide-react-native': { ChevronDown: 'chevron-down', ChevronLeft: 'chevron-left', ChevronRight: 'chevron-right', ChevronUp: 'chevron-up', Eye: 'eye', EyeOff: 'eye-off', Film: 'film', Mic: 'mic', Minus: 'minus', Plus: 'plus', Volume2: 'volume', VolumeX: 'volume-off' },
    '@/theme/colors': { colors: {} }, './model': model, './timelineLayout': layout, './timelineMotion': motionHelpers,
    './useStudioFilmstrip': { useStudioFilmstrip: (take, samples) => { filmstripRequests.push({ take, samples }); return {}; } }, './layerTimelineInteraction': layerModule.exports, './timelineSnap': snapHelpers, './timelinePlayback': playbackHelpers,
    './snapFeedback': { performStudioSnapFeedback: () => feedbacks.push(now) },
  };
  const compiled = options.nativeWorklets ? compileNative() : ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'Date', '__DEV__', compiled)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith('@babel/runtime/helpers/')) return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports, { now: () => now }, false);
  props = { takes: [take('a'), take('b')], activeTakeId: 'a', position: 1, cancelEpoch: 0,
    onSeek: seconds => seeks.push(seconds), onSelect: value => selections.push(value.id),
    onTrimChange: range => previews.push(range), onTrimCancel: () => cancellations.push(true),
    onTrimCommit: range => { commits.push(range); return new Promise(resolve => { commitResolver = resolve; }); }, ...options };

  const render = (key, component, componentProps) => {
    const scope = context(key); const previous = current; current = scope;
    scope.cursor = 0; scope.effects = []; scope.reactions = []; scope.frames = []; scope.dirty = false;
    scope.tree = component(componentProps);
    for (const effect of scope.effects) {
      scope.slots[effect.index]?.cleanup?.();
      scope.slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() };
    }
    current = previous;
    return scope.tree;
  };
  const renderParent = () => render('timeline', module.exports.StudioTimeline, props);
  const all = (tree, predicate) => {
    const result = [];
    const visit = node => {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node || typeof node !== 'object') return;
      if (predicate(node)) result.push(node);
      visit(node.props?.children);
    };
    visit(tree); return result;
  };
  const nodes = name => all(context('timeline').tree, node => typeof node.type === 'function' && node.type.name === name);
  const control = label => all(context('timeline').tree, node => node.props?.accessibilityLabel === label)[0]?.props;
  const railNode = id => all(context('timeline').tree, node => node.props?.testID === id)[0];
  const railGeometry = () => ({ fixed: resolveStyle(railNode('studio-lane-controls')?.props.style),
    content: resolveStyle(railNode('studio-lane-controls-content')?.props.style),
    main: resolveStyle(railNode('studio-main-control')?.props.style) });
  const laneView = () => all(context('timeline').tree, node => node.props?.accessibilityLabel === 'Faixas da montagem')[0];
  const laneScroll = () => laneView()?.props.onScroll;
  const laneScrollProps = () => laneView()?.props.animatedProps.__props();
  const laneAxis = () => all(context('timeline').tree, node => node.type === 'gesture-detector' && node.props.gesture.kind === 'pan')[0]?.props.gesture;
  const laneWindow = () => ({ start: m().laneStart.value, height: laneView()?.props.style.height, contentHeight: laneView()?.props.children.props.style.height });
  const scroll = () => all(context('timeline').tree, node => node.type === 'animated-scroll')[0].props.onScroll;
  const scrollProps = () => all(context('timeline').tree, node => node.type === 'animated-scroll')[0].props.animatedProps.__props();
  const pinch = () => context('timeline').tree.props.gesture.handlers;
  const m = () => (nodes('TrimHandle')[0] || nodes('TimelineClip')[0]).props.motion;
  const childHandle = edge => {
    const node = nodes('TrimHandle').find(item => item.props.edge === edge);
    assert.ok(node, 'selected trim handle expected');
    return render(`handle-${edge}`, node.type, node.props);
  };
  const pan = edge => childHandle(edge).props.gesture.handlers;
  const childClip = id => {
    const node = nodes('TimelineClip').find(item => item.props.segment.take.id === id);
    return render(`clip-${id}`, node.type, node.props);
  };
  const clipImages = id => {
    const clip = childClip(id);
    const frames = all(clip, node => typeof node.type === 'function' && node.type.name === 'ClipFrames')[0];
    return all(render(`frames-${id}`, frames.type, frames.props), node => node.type === 'image');
  };
  const childLayer = id => {
    const node = nodes('TimelineLayer').find(item => item.props.item.id === id);
    assert.ok(node, 'selected layer remains mounted');
    return render(`layer-${id}`, node.type, node.props);
  };
  const snapGuide = () => {
    const node = nodes('TimelineSnapGuide')[0];
    return render('snap-guide', node.type, node.props).props.style.at(-1).__style();
  };
  const reactions = () => {
    for (const scope of contexts.values()) for (const reaction of scope.reactions) {
      const next = reaction.prepare(); const signature = JSON.stringify(next);
      if (signature !== reaction.signature) { const previous = reaction.previous; reaction.previous = next; reaction.signature = signature; reaction.react(next, previous); }
    }
  };
  const animate = (animateWithoutTime = false) => {
    if (!animateWithoutTime) now += 64;
    reactions();
  };
  const frame = (elapsed = 16) => {
    now += elapsed;
    for (const scope of contexts.values()) for (const callback of scope.frames) callback.current({ timestamp: now, timeSincePreviousFrame: elapsed });
    // A UI frame updates shared values before its reactions run. Do not add
    // animate()'s legacy64ms step, which would manufacture playback drift.
    reactions();
  };
  const flushJS = () => {
    while (jsQueue.length) { const job = jsQueue.shift(); job.callback(...job.args); }
    if (context('timeline').dirty) renderParent();
  };
  const flushUI = () => { while (uiQueue.length) { const job = uiQueue.shift(); onUI(job.callback)(...job.args); } };
  const stepJS = () => { assert.ok(jsQueue.length); const job = jsQueue.shift(); job.callback(...job.args); };
  const pump = async () => {
    flushJS(); flushUI(); flushJS(); flushUI();
    await new Promise(resolve => setImmediate(resolve));
    if (context('timeline').dirty) renderParent();
  };
  renderParent();
  flushUI();
  all(context('timeline').tree, node => node.type === 'animated-view' && node.props?.onLayout)[0].props.onLayout({ nativeEvent: { layout: { width: 300 } } });
  renderParent(); flushUI();
  scroll().onScroll({ contentOffset: { x: 60 } }); flushJS(); animate(); flushJS(); scrolls.length = 0;
  return { scroll, scrollProps, pinch, m, pan, childHandle, childClip, clipImages, childLayer, snapGuide, nodes, control, railNode, railGeometry, laneScroll, laneScrollProps, laneAxis, laneWindow, seeks, selections, previews, commits, cancellations, scrolls, feedbacks, filmstripRequests, jsQueue, uiQueue,
    animate, reactions, frame, flushJS, flushUI, stepJS, pump,
    timelineHeight: () => resolveStyle(context('timeline').tree.props.children.props.style).height,
    playerPosition: () => context('timeline').reactions.find(reaction => reaction.prepare()?.viewport !== undefined).prepare().position,
    update: next => { props = { ...props, ...next }; renderParent(); },
    appState: state => { for (const callback of appStateListeners) callback(state); if (context('timeline').dirty) renderParent(); },
    completeCommit: () => { assert.ok(commitResolver); commitResolver(); },
    dispose: () => { for (const scope of contexts.values()) for (const slot of scope.slots) slot?.cleanup?.(); } };
}

test('timeline termina no trilho principal sem linha ou altura adicional de zoom', () => {
  const view = harness(layerFixture());
  try {
    const track = view.nodes('TimelineClip')[0].props;
    assert.equal(view.timelineHeight(), track.top + track.height);
    assert.equal(view.control('Diminuir zoom da timeline'), undefined);
    assert.equal(view.control('Aumentar zoom da timeline'), undefined);
    assert.deepEqual(view.control('Posição da montagem').accessibilityActions.map(action => action.name), ['increment', 'decrement', 'zoomIn', 'zoomOut']);
  } finally { view.dispose(); }
});

for (const withLayers of [false, true]) test(`zoom acessível respeita limites e conserva cursor${withLayers ? ' com camadas' : ''}`, async () => {
  const view = harness({ ...(withLayers ? twelveLayerFixture() : {}), nativeSharedValues: true, nativeWorklets: true });
  const zoom = async actionName => {
    view.control('Posição da montagem').onAccessibilityAction({ nativeEvent: { actionName } });
    await view.pump(); view.animate(); await view.pump();
  };
  try {
    const cursor = view.playerPosition(), verticalOffset = view.m().laneStart.value;
    await zoom('zoomIn');
    assert.equal(view.m().scale.value, layout.defaultStudioTimelineScale * 1.5);
    assert.equal(view.m().offset.value, cursor * view.m().scale.value);
    assert.match(view.control('Posição da montagem').accessibilityValue.text, /Zoom 150%/);
    for (let i = 0; i < 20; i++) await zoom('zoomOut');
    assert.equal(view.m().scale.value, layout.minimumStudioTimelineScale);
    assert.equal(view.m().offset.value, cursor * layout.minimumStudioTimelineScale);
    for (let i = 0; i < 20; i++) await zoom('zoomIn');
    assert.equal(view.m().scale.value, layout.maximumStudioTimelineScale);
    assert.equal(view.m().offset.value, cursor * layout.maximumStudioTimelineScale);
    assert.equal(view.playerPosition(), cursor); assert.equal(view.m().laneStart.value, verticalOffset);
    assert.deepEqual(view.seeks, []); assert.deepEqual(view.selections, []); assert.deepEqual(view.commits, []);
    await zoom('unknown'); assert.deepEqual(view.seeks, [], 'an unrecognized accessibility action must not seek backward');
    await zoom('increment'); assert.deepEqual(view.seeks, [cursor + 1], 'the adjustable cursor retains its standard seek action');
  } finally { view.dispose(); }
});

test('zoom acessível atrasado não altera escala durante pinça, busy ou background', async () => {
  const view = harness({ ...twelveLayerFixture(), nativeSharedValues: true, nativeWorklets: true });
  try {
    const pending = view.control('Posição da montagem').onAccessibilityAction;
    const initial = view.m().scale.value;
    view.update({ busy: true }); pending({ nativeEvent: { actionName: 'zoomIn' } }); await view.pump();
    assert.equal(view.m().scale.value, initial);
    view.update({ busy: false }); await view.pump();
    view.pinch().onStart(); pending({ nativeEvent: { actionName: 'zoomIn' } }); await view.pump();
    assert.equal(view.m().scale.value, initial);
    view.pinch().onUpdate({ scale: 2 }); view.pinch().onFinalize({}, true); await view.pump();
    assert.equal(view.m().scale.value, initial * 2); assert.equal(view.playerPosition(), 1);
    view.appState('inactive'); await view.pump(); pending({ nativeEvent: { actionName: 'zoomOut' } }); await view.pump();
    assert.equal(view.m().scale.value, initial * 2);
    view.appState('active'); await view.pump(); view.dispose();
    pending({ nativeEvent: { actionName: 'zoomOut' } }); view.flushUI();
    assert.equal(view.m().scale.value, initial * 2);
  } finally { view.dispose(); }
});

test('rolagem termina mesmo com velocidade residual quando o destino nativo é a posição atual', () => {
  const view = harness();
  try {
    view.scroll().onBeginDrag();
    view.scroll().onEndDrag({ contentOffset: { x: 120 }, targetContentOffset: { x: 120 }, velocity: { x: 0.18 } });
    view.flushJS(); view.flushUI();
    assert.equal(view.m().phase.value, 0);
    assert.equal(view.playerPosition(), 2);
    assert.deepEqual(view.seeks, [2]);
  } finally { view.dispose(); }
});

test('destino diferente continua em momentum e libera no evento final', () => {
  const view = harness();
  try {
    view.scroll().onBeginDrag();
    view.scroll().onEndDrag({ contentOffset: { x: 120 }, targetContentOffset: { x: 180 }, velocity: { x: 0.18 } });
    view.flushJS(); view.flushUI();
    assert.equal(view.m().phase.value, 1);
    view.scroll().onMomentumBegin(); assert.equal(view.m().phase.value, 2);
    view.scroll().onMomentumEnd({ contentOffset: { x: 180 } }); view.flushJS(); view.flushUI();
    assert.equal(view.m().phase.value, 0);
    assert.equal(view.playerPosition(), 3);
    assert.equal(view.seeks.at(-1), 3);
  } finally { view.dispose(); }
});

test('finishScrub antigo na fila JS não interrompe um corte que já começou no UI', () => {
  const view = harness();
  try {
    view.scroll().onBeginDrag();
    view.scroll().onEndDrag({ contentOffset: { x: 120 }, velocity: { x: 0 } });
    view.pan('start').onStart({ absoluteX: 150 });
    view.flushJS(); view.flushUI();
    assert.equal(view.m().phase.value, 3);
    assert.equal(view.playerPosition(), 1);
    assert.deepEqual(view.seeks, []);
    assert.equal(view.previews.length, 1);
  } finally { view.dispose(); }
});

test('finishScrub de outro epoch não libera uma rolagem mais recente que também está na phase6', () => {
  const view = harness();
  try {
    view.scroll().onBeginDrag(); view.scroll().onEndDrag({ contentOffset: { x: 120 }, velocity: { x: 0 } });
    view.scroll().onBeginDrag(); view.scroll().onEndDrag({ contentOffset: { x: 180 }, velocity: { x: 0 } });
    view.stepJS(); view.stepJS(); // first start + obsolete finish
    view.flushUI();
    assert.equal(view.m().phase.value, 6);
    assert.equal(view.playerPosition(), 1);
    assert.deepEqual(view.seeks, []);
    view.flushJS(); view.flushUI();
    assert.equal(view.m().phase.value, 0);
    assert.equal(view.playerPosition(), 3);
    assert.deepEqual(view.seeks, [3]);
  } finally { view.dispose(); }
});

test('release já agendado no UI checa phase e epoch novamente antes de encerrar um corte novo', () => {
  const view = harness();
  try {
    view.scroll().onBeginDrag(); view.scroll().onEndDrag({ contentOffset: { x: 120 }, velocity: { x: 0 } });
    view.flushJS(); assert.equal(view.uiQueue.length, 1);
    view.pan('start').onStart({ absoluteX: 150 });
    view.flushUI(); view.flushJS();
    assert.equal(view.m().phase.value, 3);
    assert.equal(view.playerPosition(), 1);
    assert.equal(view.previews.length, 1);
  } finally { view.dispose(); }
});

test('selecionar o clipe toca apenas onSelect sem seek ou scroll programático', () => {
  const view = harness();
  try {
    view.childClip('b').props.onPress(); view.flushJS(); view.flushUI();
    assert.deepEqual(view.selections, ['b']);
    assert.deepEqual(view.seeks, []);
    assert.deepEqual(view.scrolls, []);
    assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('cancelEpoch cancela gesto real e update/end atrasados não salvam nem reabrem o corte', () => {
  const view = harness();
  try {
    const pan = view.pan('start');
    pan.onStart({ absoluteX: 150 }); view.flushJS();
    pan.onUpdate({ absoluteX: 210, translationX: 60 }); view.animate(); view.flushJS();
    const count = view.previews.length;
    view.update({ cancelEpoch: 1 });
    assert.equal(view.m().phase.value, 0);
    assert.equal(view.m().trimIndex.value, -1);
    assert.equal(view.cancellations.length, 1);
    pan.onUpdate({ absoluteX: 240, translationX: 90 }); pan.onEnd(); pan.onFinalize({}, true);
    view.animate(); view.flushJS(); view.flushUI();
    assert.equal(view.previews.length, count);
    assert.equal(view.commits.length, 0);
    assert.equal(view.m().phase.value, 0);
  } finally { view.dispose(); }
});

test('corte move uma camada por clipe no UI e update salvo não aplica o delta duas vezes', async () => {
  const view = harness();
  try {
    const pan = view.pan('end');
    pan.onStart({ absoluteX: 250 }); view.flushJS();
    const first = view.childClip('a'); const second = view.childClip('b');
    pan.onUpdate({ absoluteX: 70, translationX: -180 });
    const firstStyle = first.props.style.at(-1).__style();
    const secondStyle = second.props.style.at(-1).__style();
    assert.equal(firstStyle.width, 180);
    assert.equal(firstStyle.left + firstStyle.width, secondStyle.left);
    assert.equal(view.nodes('TimelineClip').length, 2, 'one original layer per clip');
    view.animate(); view.flushJS();
    const frames = view.childClip('b').props.children[0];
    assert.equal(frames.props.canvasX, 180, 'thumbnail sampling follows the UI reflow');
    pan.onEnd(); view.flushJS();
    assert.equal(view.commits.length, 1);
    view.update({ takes: [{ ...take('a'), end: 5 }, take('b')] });
    const savedFirst = view.childClip('a').props.style.at(-1).__style();
    const savedSecond = view.childClip('b').props.style.at(-1).__style();
    assert.equal(savedFirst.width, 180);
    assert.equal(savedFirst.left + savedFirst.width, savedSecond.left);
    assert.equal(view.m().trimIndex.value, -1);
    view.completeCommit(); await view.pump();
    assert.equal(view.m().phase.value, 0);
    assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

function layerFixture() {
  const editing = { ...model.emptyStudioEditing('aula'),
    assets: [{ id: 'main', kind: 'video', uri: 'file:///main.mov', name: 'Main', durationTicks: model.studioTicks(20) }],
    main: [{ id: 'a', assetId: 'main', sourceStartTicks: model.studioTicks(2), sourceEndTicks: model.studioTicks(8) },
      { id: 'b', assetId: 'main', sourceStartTicks: model.studioTicks(10), sourceEndTicks: model.studioTicks(16) }],
    layers: [{ id: 'text', kind: 'text', items: [model.createStudioTextItem({ id: 'title', atTicks: model.studioTicks(1), durationTicks: model.studioTicks(2) })] }] };
  const layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.filter(clip => clip.zIndex > 0);
  return { editing, layers };
}
function manyLayerFixture() {
  const { editing: base } = layerFixture();
  const editing = { ...base, assets: [...base.assets,
    { id: 'poster-asset', kind: 'image', uri: 'file:///poster.jpg', name: 'Poster', durationTicks: 0, width: 640, height: 480 },
    { id: 'voice-asset', kind: 'audio', uri: 'file:///voice.m4a', name: 'Voice', durationTicks: model.studioTicks(10) }],
  layers: [...base.layers,
    { id: 'images', kind: 'image', items: [{ id: 'poster', kind: 'image', assetId: 'poster-asset', atTicks: model.studioTicks(1), durationTicks: model.studioTicks(3) }] },
    { id: 'captions', kind: 'caption', items: [model.createStudioTextItem({ id: 'caption', content: 'Legenda', kind: 'caption', atTicks: model.studioTicks(1), durationTicks: model.studioTicks(3) })] },
    { id: 'audio', kind: 'audio', items: [{ id: 'voice', kind: 'audio', assetId: 'voice-asset', atTicks: model.studioTicks(1), durationTicks: model.studioTicks(3), sourceStartTicks: 0, sourceEndTicks: model.studioTicks(3) }] }] };
  const layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.filter(clip => clip.zIndex > 0);
  return { editing, layers };
}

for (const mode of ['move', 'end']) test(`seek periódico antigo não move cursor quando ${mode === 'move' ? 'hold de camada' : 'alça da camada'} começa no UI`, () => {
  const fixture = layerFixture();
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async () => {}, onLayerTrimCommit: async () => {} });
  try {
    view.scroll().onBeginDrag(); view.scroll().onScroll({ contentOffset: { x: 180 } });
    const tree = view.childLayer('title');
    const pan = mode === 'move' ? tree.props.children[0].props.gesture.gestures[0].handlers : tree.props.children[1][1].props.gesture.handlers;
    pan.onStart({ absoluteX: 150 });
    assert.equal(view.m().phase.value, mode === 'move' ? 7 : 8);
    view.flushJS(); view.flushUI();
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('seek periódico de outro epoch não chega nem após cancelar a camada e voltar ao idle', () => {
  const fixture = layerFixture();
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async () => {} });
  try {
    view.scroll().onBeginDrag(); view.scroll().onScroll({ contentOffset: { x: 180 } });
    const delayed = view.jsQueue.splice(0);
    const pan = view.childLayer('title').props.children[0].props.gesture.gestures[0].handlers;
    pan.onStart({ absoluteX: 150 }); view.flushJS();
    pan.onFinalize({}, false); view.flushJS();
    assert.equal(view.m().phase.value, 0);
    for (const job of delayed) job.callback(...job.args);
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('seek periódico obsoleto é descartado sem bloquear a rolagem mais recente', () => {
  const view = harness();
  try {
    view.scroll().onBeginDrag(); view.scroll().onScroll({ contentOffset: { x: 180 } });
    view.animate();
    view.scroll().onBeginDrag(); view.scroll().onScroll({ contentOffset: { x: 240 } });
    view.flushJS();
    assert.deepEqual(view.seeks, [4]);
  } finally { view.dispose(); }
});

test('rolagem vertical contínua alcança áudio4 sem seek e mantém offset fracionário na seleção', async () => {
  const fixture = manyLayerFixture(), selections = [];
  const view = harness({ ...fixture, activeTakeId: undefined, onSelectLayer: id => selections.push(id), onLayerTrimCommit: async () => {} });
  try {
    assert.deepEqual(view.laneWindow(), { start: 0, height: 132, contentHeight: 176 });
    assert.equal(view.control('Faixas anteriores'), undefined); assert.equal(view.control('Próximas faixas'), undefined);
    const epoch = view.m().epoch.value, x = view.m().offset.value;
    view.laneAxis().handlers.onStart(); view.laneScroll().onBeginDrag();
    view.laneScroll().onScroll({ contentOffset: { y: 37.5, x: 2 } });
    view.laneScroll().onEndDrag(); await view.pump();
    assert.equal(view.m().laneStart.value * 44, 37.5);
    assert.equal(view.m().epoch.value, epoch); assert.equal(view.m().offset.value, x);
    const audio = view.childLayer('voice'); audio.props.children[0].props.children.props.onPress();
    assert.deepEqual(selections, ['voice']);
    view.update({ selectedLayerId: 'voice' }); await view.pump();
    assert.equal(view.childLayer('voice').props.children[1].length, 2);
    assert.equal(view.m().laneStart.value, 1, 'external selection reveals the full audio row');
    view.update({ selectedLayerId: undefined }); await view.pump();
    assert.equal(view.m().laneStart.value, 1, 'closing selection keeps the viewport');
    view.laneScroll().onScroll({ contentOffset: { y: 19.25 } }); await view.pump();
    view.update({ selectedLayerId: 'caption' }); await view.pump();
    assert.equal(view.m().laneStart.value * 44, 19.25, 'already visible selection preserves the fractional offset');
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('seleção externa revela sua faixa sem trocar ordem temporal nem reposicionar main ou régua', async () => {
  const fixture = manyLayerFixture();
  const view = harness({ ...fixture, selectedLayerId: 'caption' });
  try {
    const top = view.nodes('TimelineLayer').find(node => node.props.item.id === 'caption').props.top;
    const mainTop = view.nodes('TimelineClip')[0].props.top;
    view.update({ layers: [...fixture.layers].reverse() }); await view.pump();
    assert.equal(view.nodes('TimelineLayer').find(node => node.props.item.id === 'caption').props.top, top);
    view.update({ selectedLayerId: 'voice' }); await view.pump();
    assert.equal(view.m().laneStart.value, 1); assert.ok(view.childLayer('voice'));
    view.update({ selectedLayerId: 'title' }); await view.pump();
    assert.equal(view.m().laneStart.value, 0); assert.equal(view.nodes('TimelineClip')[0].props.top, mainTop);
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

for (const mode of ['move', 'end']) test(`scroll vertical antigo não desloca a camada sob ${mode === 'move' ? 'hold' : 'alça'} ativo`, async () => {
  const fixture = manyLayerFixture();
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async () => {}, onLayerTrimCommit: async () => {} });
  try {
    const tree = view.childLayer('title');
    const pan = mode === 'move' ? tree.props.children[0].props.gesture.gestures[0].handlers : tree.props.children[1][1].props.gesture.handlers;
    pan.onStart({ absoluteX: 180, absoluteY: 50 }); view.flushJS();
    view.laneScroll().onScroll({ contentOffset: { y: 44 } }); await view.pump();
    assert.equal(view.m().laneStart.value, 0); assert.ok(view.childLayer('title'));
    pan.onFinalize({}, false); view.flushJS();
    view.update({ busy: true }); await view.pump();
    assert.equal(view.laneScrollProps().scrollEnabled, false);
    view.laneScroll().onScroll({ contentOffset: { y: 44 } }); await view.pump();
    assert.equal(view.m().laneStart.value, 0); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

function twelveLayerFixture() {
  const { editing: initial } = manyLayerFixture();
  const editing = { ...initial, layers: [...initial.layers, ...Array.from({ length: 9 }, (_, i) => i + 5).map(index => ({
    id: `text-${index}`, kind: 'text', items: [model.createStudioTextItem({ id: `title-${index}`, atTicks: model.studioTicks(1), durationTicks: model.studioTicks(3) })],
  }))] };
  const layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.filter(clip => clip.zIndex > 0);
  return { editing, layers };
}

test('13faixas têm scroll e momentum contínuos com overscan limitado sem paginação nem seek', async () => {
  const fixture = twelveLayerFixture(), interaction = [];
  const view = harness({ ...fixture, onLayerInteractionStart: () => interaction.push('start') });
  try {
    assert.deepEqual(view.laneWindow(), { start: 0, height: 132, contentHeight: 572 });
    const epoch = view.m().epoch.value, x = view.m().offset.value, mainTop = view.nodes('TimelineClip')[0].props.top;
    const reached = new Set(view.nodes('TimelineLayer').map(node => node.props.item.zIndex));
    for (const y of [63.5, 151.75, 245.25, 374.5, 440]) {
      view.laneScroll().onBeginDrag(); view.laneScroll().onScroll({ contentOffset: { y } }); view.laneScroll().onEndDrag();
      view.laneScroll().onMomentumBegin(); await view.pump();
      assert.equal(view.m().laneStart.value * 44, y);
      for (const node of view.nodes('TimelineLayer')) reached.add(node.props.item.zIndex);
      assert.ok(view.nodes('TimelineLayer').length <= 9, 'three rows + one viewport overscan in both directions');
      assert.equal(view.nodes('TimelineClip')[0].props.top, mainTop); assert.equal(view.m().offset.value, x);
      view.laneScroll().onMomentumEnd();
    }
    assert.deepEqual([...reached].sort((a, b) => a - b), Array.from({ length: 13 }, (_, i) => i + 1));
    view.update({ position: 2 }); await view.pump();
    assert.equal(view.m().laneStart.value * 44, 440); assert.equal(view.m().epoch.value, epoch);
    assert.deepEqual(view.seeks, []); assert.deepEqual(interaction, []);
  } finally { view.dispose(); }
});

test('grafo de eixo vertical espera o hold e bloqueia scrub com pequeno desvio horizontal', async () => {
  const fixture = twelveLayerFixture(), scrub = [];
  const view = harness({ ...fixture, nativeWorklets: true, selectedLayerId: 'title', onMoveLayer: async () => {}, onLayerTrimCommit: async () => {}, onScrubStart: () => scrub.push(true) });
  try {
    const node = view.nodes('TimelineLayer').find(item => item.props.item.id === 'title');
    const gate = view.laneAxis();
    assert.deepEqual(gate.activeOffsetY, [-8, 8]); assert.deepEqual(gate.failOffsetX, [-12, 12]); assert.equal(gate.maxPointers, 1);
    assert.equal(gate.blocksExternalGesture, node.props.nativeGesture);
    assert.equal(gate.simultaneousWithExternalGesture, node.props.laneNativeGesture);
    assert.equal(node.props.laneNativeGesture.simultaneousWithExternalGesture, node.props.nativeGesture);
    const layer = view.childLayer('title'), heldPan = layer.props.children[0].props.gesture.gestures[0];
    assert.deepEqual(heldPan.blocksExternalGesture, [node.props.nativeGesture, node.props.laneNativeGesture, gate]);
    assert.ok(heldPan.handlers.onStart.__workletHash, 'actual Expo Babel generated UI callback');
    gate.handlers.onStart(); view.laneScroll().onBeginDrag();
    view.scroll().onBeginDrag(); // native qualifier keeps this from claiming the media even if delivered
    view.laneScroll().onScroll({ contentOffset: { x: 4, y: 151.75 } }); view.scroll().onScroll({ contentOffset: { x: 64 } });
    await view.pump(); assert.equal(view.m().phase.value, 0); assert.equal(view.m().offset.value, 60);
    assert.deepEqual(view.seeks, []); assert.deepEqual(scrub, []);
    gate.handlers.onFinalize({}, true); view.laneScroll().onEndDrag();
    // A horizontal move fails the qualifier; the existing scrub remains real.
    gate.handlers.onFinalize({}, false); view.scroll().onBeginDrag();
    view.scroll().onScroll({ contentOffset: { x: 120 } }); view.scroll().onEndDrag({ contentOffset: { x: 120 }, velocity: { x: 0 } });
    await view.pump(); assert.equal(view.playerPosition(), 2); assert.deepEqual(view.seeks, [2, 2]); assert.ok(scrub.length);
  } finally { view.dispose(); }
});

for (const fps of [60, 120]) test(`scroll vertical e momentum preservam relógio horizontal${fps}Hz enquanto a filaJS está atrasada`, async () => {
  const fixture = twelveLayerFixture(), channel = { value: { active: true, sequence: 1, position: 1, playing: true, loading: false } };
  const view = harness({ ...fixture, nativeWorklets: true, nativeSharedValues: true, playbackChannel: channel });
  try {
    view.reactions(); const epoch = view.m().epoch.value, mainTop = view.nodes('TimelineClip')[0].props.top;
    view.laneAxis().handlers.onStart(); view.laneScroll().onBeginDrag();
    let previousX = view.m().offset.value;
    for (let i = 1; i <= fps; i++) {
      if (i % (fps / 15) === 0) { channel.value = { ...channel.value, sequence: channel.value.sequence + 1, position: 1 + i / fps }; view.reactions(); }
      const y = Math.min(440, i * 440 / fps);
      view.laneScroll().onScroll({ contentOffset: { x: 3, y } }); view.frame(1000 / fps);
      assert.ok(view.m().offset.value >= previousX); previousX = view.m().offset.value;
      assert.equal(view.m().phase.value, 0); assert.equal(view.m().epoch.value, epoch);
      assert.equal(view.nodes('TimelineClip')[0].props.top, mainTop);
    }
    assert.ok(view.playerPosition() > 1.8); assert.equal(view.m().laneStart.value * 44, 440);
    view.laneScroll().onEndDrag(); view.laneScroll().onMomentumBegin(); view.laneScroll().onMomentumEnd();
    await view.pump(); assert.deepEqual(view.seeks, []); assert.equal(view.m().laneScrolling.value, false);
    assert.ok(view.nodes('TimelineLayer').some(node => node.props.item.zIndex === 13));
  } finally { view.dispose(); }
});

test('publicação vertical agrupa pixels por linha e prepara viewport com três linhas de margem', async () => {
  const fixture = twelveLayerFixture(), view = harness(fixture);
  try {
    for (const y of [1, 4.25, 17, 40, 43.9]) view.laneScroll().onScroll({ contentOffset: { y } });
    assert.equal(view.jsQueue.length, 0, 'fractional pixels do not enqueue React renders');
    view.laneScroll().onScroll({ contentOffset: { y: 44.25 } }); assert.equal(view.jsQueue.length, 1);
    view.laneScroll().onScroll({ contentOffset: { y: 170 } }); assert.equal(view.jsQueue.length, 2);
    await view.pump();
    assert.ok(view.nodes('TimelineLayer').some(node => node.props.item.zIndex === 9), 'one full viewport prepared below the visible rows');
    assert.equal(view.nodes('TimelineLayer').some(node => node.props.item.zIndex === 13), false, 'not decoding/mounting the whole composition');
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('hold vai da faixa1 à13 com autoscroll contínuo e salva diagonal uma vez sem remontar', async () => {
  const fixture = twelveLayerFixture(), moves = [], lifecycle = []; let resolve;
  const view = harness({ ...fixture, nativeWorklets: true, selectedLayerId: 'title', onMoveLayer: (id, delta, target) => { moves.push({ id, delta, target }); return new Promise(done => { resolve = done; }); },
    onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
  try {
    const tree = view.childLayer('title'), gesture = tree.props.children[0].props.gesture, pan = gesture.gestures[0].handlers;
    pan.onStart({ absoluteX: 180, absoluteY: 50 }); view.flushJS();
    pan.onUpdate({ absoluteX: 180, absoluteY: 157, translationX: 0, translationY: 100 });
    for (let i = 0; i < 160; i++) { view.frame(16); if (i % 8 === 0) { view.flushJS(); assert.equal(view.childLayer('title').props.children[0].props.gesture, gesture); } }
    assert.equal(view.m().laneStart.value, 10); assert.equal(view.scrollProps().scrollEnabled, true); assert.equal(view.laneScrollProps().scrollEnabled, true);
    pan.onEnd({ absoluteX: 240, absoluteY: 157, translationX: 60, translationY: 100 }, true); view.flushJS();
    assert.deepEqual(moves, [{ id: 'title', delta: 1, target: 13 }]); assert.deepEqual(lifecycle, ['start']);
    view.update({ selectedLayerId: undefined }); await view.pump();
    assert.ok(view.nodes('TimelineLayer').some(node => node.props.item.id === 'title'), 'pending save owns the offscreen source even after external deselection');
    assert.equal(view.m().phase.value, 5);
    const editing = model.moveStudioLayerItemToLane(fixture.editing, 'title', 13);
    view.update({ editing, layers: model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.filter(item => item.zIndex > 0) }); view.childLayer('title');
    resolve(); await view.pump();
    assert.equal(view.m().phase.value, 0); assert.equal(view.m().laneStart.value, 10); assert.deepEqual(lifecycle, ['start', 'end']);
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('crescer de1para13faixas usa viewport atual no release e não pula seleção já visível', async () => {
  const initial = layerFixture(), expanded = twelveLayerFixture(), moves = [];
  const view = harness({ ...initial, selectedLayerId: 'title', onMoveLayer: async (id, delta, target) => moves.push({ id, delta, target }) });
  try {
    view.childLayer('title'); // release callback originally mounted with one row
    view.update(expanded); await view.pump();
    const action = view.childLayer('title').props.children[0].props.children.props.onAccessibilityAction;
    action({ nativeEvent: { actionName: 'moveDown' } }); view.flushJS(); view.flushUI(); view.flushJS();
    const editing = model.moveStudioLayerItemToLane(expanded.editing, 'title', 2);
    view.update({ editing, layers: model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.filter(item => item.zIndex > 0) }); view.childLayer('title'); await view.pump();
    assert.equal(view.m().laneStart.value, 0, 'row2 was already fully visible in the three-row viewport');
    assert.deepEqual(moves, [{ id: 'title', delta: 0, target: 2 }]); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('background encerra scroll vertical e rejeita momentum antigo sem tocar cursor', async () => {
  const fixture = twelveLayerFixture(), view = harness({ ...fixture, nativeWorklets: true, nativeSharedValues: true });
  try {
    view.laneAxis().handlers.onStart(); view.laneScroll().onBeginDrag(); view.laneScroll().onScroll({ contentOffset: { y: 170.5 } });
    view.laneScroll().onMomentumBegin(); assert.equal(view.m().laneScrolling.value, true);
    view.appState('inactive'); view.flushUI();
    assert.equal(view.m().laneScrolling.value, false);
    view.laneScroll().onMomentumBegin(); view.laneScroll().onScroll({ contentOffset: { y: 440 } }); await view.pump();
    assert.equal(view.m().laneScrolling.value, false); assert.equal(view.m().laneStart.value * 44, 170.5);
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
    view.appState('active'); view.flushUI(); view.laneScroll().onScroll({ contentOffset: { y: 200.5 } }); await view.pump();
    assert.equal(view.m().laneStart.value * 44, 200.5);
  } finally { view.dispose(); }
});

test('background interrompe inércia das faixas adicionadas depois da montagem sem capturar count antigo', async () => {
  const fixture = twelveLayerFixture(), view = harness({ nativeSharedValues: true });
  try {
    view.update(fixture); await view.pump();
    view.laneScroll().onScroll({ contentOffset: { y: 200.5 } }); view.laneScroll().onMomentumBegin();
    view.scrolls.length = 0; view.appState('inactive'); view.flushUI();
    assert.ok(view.scrolls.some(scroll => scroll.x === 0 && scroll.y === 200.5), 'stop the current native vertical inertia, even if initial timeline had no lanes');
    assert.equal(view.m().laneScrolling.value, false); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('pinça preserva offset vertical e cancela momentum sem reconstruir axis gate', async () => {
  const fixture = twelveLayerFixture(), view = harness({ ...fixture, nativeWorklets: true });
  try {
    const gate = view.laneAxis();
    view.laneScroll().onScroll({ contentOffset: { y: 170.5 } }); await view.pump(); view.laneScroll().onMomentumBegin();
    view.pinch().onStart(); view.flushJS();
    assert.equal(view.m().phase.value, 4); assert.equal(view.m().laneScrolling.value, false);
    view.laneScroll().onScroll({ contentOffset: { y: 260 } }); assert.equal(view.m().laneStart.value * 44, 170.5);
    view.pinch().onUpdate({ scale: 1.5 }); view.pinch().onFinalize({}, true); await view.pump();
    assert.equal(view.m().laneStart.value * 44, 170.5); assert.equal(view.laneAxis(), gate);
    assert.deepEqual(view.seeks, [1]); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('cancelar hold após autoscroll restaura faixa fonte e não envia edição vertical tardia', async () => {
  const fixture = twelveLayerFixture(), moves = [], lifecycle = [];
  const view = harness({ ...fixture, nativeWorklets: true, selectedLayerId: 'title', onMoveLayer: async (...args) => moves.push(args), onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
  try {
    const tree = view.childLayer('title'), pan = tree.props.children[0].props.gesture.gestures[0].handlers;
    pan.onStart({ absoluteX: 180, absoluteY: 50 }); view.flushJS();
    pan.onUpdate({ absoluteX: 180, absoluteY: 157, translationX: 0, translationY: 100 });
    for (let i = 0; i < 64; i++) view.frame(16);
    assert.ok(view.m().laneStart.value > 3);
    pan.onEnd({ absoluteX: 180, absoluteY: 157, translationX: 0, translationY: 100 }, false); pan.onFinalize({}, false); await view.pump();
    assert.equal(view.m().laneStart.value, 0); assert.equal(view.m().phase.value, 0); assert.equal(view.m().laneScrolling.value, false);
    assert.deepEqual(lifecycle, ['start', 'end']); assert.deepEqual(moves, []);
    pan.onEnd({}, true); await view.pump(); assert.deepEqual(moves, []);
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('alça da camada desenha duração no UI, confirma uma vez e não desloca cursor nem faixa principal', async () => {
  const fixture = layerFixture(), previews = [], commits = []; let resolve;
  const view = harness({ ...fixture, selectedLayerId: 'title', onLayerTrimPreview: (id, range) => previews.push({ id, range }),
    onLayerTrimCommit: (id, range) => { commits.push({ id, range }); return new Promise(done => { resolve = done; }); } });
  try {
    const tree = view.childLayer('title'); const edge = tree.props.children[1][1]; const pan = edge.props.gesture.handlers;
    assert.ok(resolveStyle(edge.props.children.props.style).width >= 44, 'touch surface is at least44pt');
    pan.onStart({ absoluteX: 180 }); view.flushJS();
    pan.onUpdate({ absoluteX: 240, translationX: 60 });
    assert.equal(layerVisibleWidth(tree), 180, 'live width, no second ghost clip');
    assert.equal(view.childClip('a').props.style.at(-1).__style().width, 360);
    view.animate(); view.flushJS();
    pan.onEnd(); view.flushJS(); pan.onEnd(); view.flushJS();
    assert.deepEqual(commits, [{ id: 'title', range: { startSeconds: 1, endSeconds: 4 } }]);
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
    const saved = layerModule.exports.applyStudioLayerTimelineRange(fixture.editing, 'title', commits[0].range);
    const layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: saved }).clips.filter(clip => clip.zIndex > 0);
    view.update({ editing: saved, layers }); const updated = view.childLayer('title');
    assert.equal(layerVisibleWidth(updated), 180, 'saved props do not apply trim twice');
    resolve(); await view.pump();
    assert.equal(view.m().phase.value, 0); assert.equal(layerVisibleWidth(updated), 180);
    assert.equal(previews.at(-1).range, undefined);
  } finally { view.dispose(); }
});

test('corpo tem hold220ms, doubletap edita; mover só confirma delta e nunca chama seek', async () => {
  const fixture = layerFixture(), moves = [], edits = [], selections = [], lifecycle = [];
  const view = harness({ ...fixture, selectedLayerId: 'title', onSelectLayer: id => selections.push(id), onEditLayer: id => edits.push(id), onMoveLayer: async (_id, delta) => moves.push(delta),
    onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end'), onScrubStart: () => assert.fail('layer gestures do not begin a main scrub') });
  try {
    const tree = view.childLayer('title'), body = tree.props.children[0];
    const [pan, double] = body.props.gesture.gestures;
    assert.equal(pan.activateAfterLongPress, 220);
    body.props.children.props.onPress(); double.handlers.onEnd({}, true); view.flushJS();
    assert.deepEqual(selections, ['title']); assert.deepEqual(edits, ['title']);
    assert.deepEqual(lifecycle, [], 'selection and editing are not drag operations');
    pan.handlers.onStart({ absoluteX: 180 }); view.flushJS();
    pan.handlers.onUpdate({ absoluteX: 240, translationX: 60 });
    assert.equal(layerVisibleLeft(tree), 270);
    assert.equal(layerVisibleWidth(tree), 120);
    pan.handlers.onEnd(); view.flushJS(); await view.pump();
    assert.deepEqual(moves, [1]); assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
    assert.deepEqual(lifecycle, ['start', 'end']);
  } finally { view.dispose(); }
});

test('trocar seleção ou cancelar epoch invalida alça antiga sem commit e limpa preview', () => {
  const fixture = layerFixture(), previews = [], commits = [], lifecycle = [];
  const view = harness({ ...fixture, selectedLayerId: 'title', onLayerTrimPreview: (_id, range) => previews.push(range), onLayerTrimCommit: (_id, range) => commits.push(range),
    onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
  try {
    const tree = view.childLayer('title'), pan = tree.props.children[1][0].props.gesture.handlers;
    pan.onStart({ absoluteX: 180 }); view.flushJS();
    view.update({ selectedLayerId: undefined, cancelEpoch: 1 }); view.childLayer('title');
    assert.equal(view.m().phase.value, 0); assert.equal(previews.at(-1), undefined);
    pan.onUpdate({ absoluteX: 210, translationX: 30 }); pan.onEnd(); view.animate(); view.flushJS();
    assert.equal(commits.length, 0); assert.equal(previews.at(-1), undefined);
    assert.deepEqual(lifecycle, ['start', 'end']);
  } finally { view.dispose(); }
});

test('lifecycle da camada mantém bloqueio até salvar, sobrevive ao rerender e encerra uma vez no unmount', async () => {
  const fixture = layerFixture(), lifecycle = []; let resolve;
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: () => new Promise(done => { resolve = done; }),
    onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
  const tree = view.childLayer('title'), pan = tree.props.children[0].props.gesture.gestures[0].handlers;
  pan.onStart({ absoluteX: 180 }); view.flushJS(); pan.onUpdate({ absoluteX: 240, translationX: 60 }); pan.onEnd(); view.flushJS();
  assert.deepEqual(lifecycle, ['start'], 'saving retains the operation lock');
  view.update({ ...fixture, onMoveLayer: () => assert.fail('do not replay commit with replacement props') }); view.childLayer('title');
  assert.deepEqual(lifecycle, ['start']);
  view.dispose(); assert.deepEqual(lifecycle, ['start', 'end']);
  resolve(); await view.pump(); assert.deepEqual(lifecycle, ['start', 'end'], 'late save never ends a second operation');
});

test('begin atrasado de uma camada já bloqueada não anuncia lifecycle nem salva', () => {
  const fixture = layerFixture(), lifecycle = [], moves = [];
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async (_id, delta) => moves.push(delta),
    onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
  try {
    const tree = view.childLayer('title'), pan = tree.props.children[0].props.gesture.gestures[0].handlers;
    pan.onStart({ absoluteX: 180 });
    view.update({ busy: true }); view.childLayer('title'); view.flushJS();
    pan.onUpdate({ absoluteX: 240, translationX: 60 }); pan.onEnd(); view.flushJS();
    assert.deepEqual(lifecycle, []); assert.deepEqual(moves, []); assert.equal(view.m().phase.value, 0);
  } finally { view.dispose(); }
});

test('grafo nativo bloqueia o ScrollView com os pans sem desligar o ancestor durante hold/alça', () => {
  const fixture = layerFixture();
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async () => {}, onLayerTrimCommit: async () => {} });
  try {
    const node = view.nodes('TimelineLayer')[0], tree = view.childLayer('title');
    const body = tree.props.children[0].props.gesture.gestures[0];
    assert.deepEqual(body.blocksExternalGesture, [node.props.nativeGesture, node.props.laneNativeGesture, node.props.laneAxisGesture]);
    assert.equal(body.activateAfterLongPress, 220);
    for (const edge of tree.props.children[1]) assert.deepEqual(edge.props.gesture.blocksExternalGesture, [node.props.nativeGesture, node.props.laneNativeGesture, node.props.laneAxisGesture]);
    body.handlers.onStart({ absoluteX: 180, absoluteY: 100 }); view.flushJS();
    assert.equal(view.scrollProps().scrollEnabled, true, 'RNGH wait relation owns the touch; do not toggle UIScrollView mid-recognition');
    body.handlers.onFinalize({}, false); view.flushJS();
    tree.props.children[1][1].props.gesture.handlers.onStart({ absoluteX: 240, absoluteY: 100 }); view.flushJS();
    assert.equal(view.scrollProps().scrollEnabled, true);
  } finally { view.dispose(); }
});

test('hold diagonal muda tempo e faixa no UI e confirma uma única operação sem deslocar cursor', async () => {
  const fixture = manyLayerFixture(), moves = [], lifecycle = []; let resolve;
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: (id, delta, target) => { moves.push({ id, delta, target }); return new Promise(done => { resolve = done; }); },
    onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
  try {
    const tree = view.childLayer('title'), pan = tree.props.children[0].props.gesture.gestures[0].handlers;
    const top = tree.props.style.at(-1).__style().top;
    pan.onStart({ absoluteX: 180, absoluteY: 105 }); view.flushJS();
    pan.onUpdate({ absoluteX: 240, absoluteY: 133, translationX: 60, translationY: 44 });
    assert.equal(tree.props.style.at(-1).__style().top, top + 44);
    assert.equal(layerVisibleLeft(tree), 270);
    pan.onEnd(); pan.onEnd(); view.flushJS();
    assert.deepEqual(moves, [{ id: 'title', delta: 1, target: 2 }]);
    assert.deepEqual(lifecycle, ['start']);
    const reordered = model.moveStudioLayerItemToLane(fixture.editing, 'title', 2);
    const saved = layerModule.exports.applyStudioLayerTimelineRange(reordered, 'title', { startSeconds: 2, endSeconds: 4 }, 'move');
    view.update({ editing: saved, layers: model.compileStudioRecipe({ kind: 'aula', takes: [], editing: saved }).clips.filter(clip => clip.zIndex > 0) });
    const updated = view.childLayer('title'); resolve(); await view.pump();
    assert.equal(updated.props.style.at(-1).__style().top, top + 44);
    assert.equal(layerVisibleLeft(updated), 270);
    assert.deepEqual(lifecycle, ['start', 'end']); assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('hold vertical puro e ação acessível persistem a ordem mesmo com delta temporal zero', async () => {
  const fixture = manyLayerFixture(), moves = [];
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async (id, delta, target) => moves.push({ id, delta, target }) });
  try {
    const tree = view.childLayer('title'), pan = tree.props.children[0].props.gesture.gestures[0].handlers;
    pan.onStart({ absoluteX: 180, absoluteY: 105 }); view.flushJS();
    pan.onUpdate({ absoluteX: 180, absoluteY: 133, translationX: 0, translationY: 44 }); pan.onEnd(); view.flushJS(); await view.pump();
    assert.deepEqual(moves, [{ id: 'title', delta: 0, target: 2 }]);
    const body = view.childLayer('title').props.children[0].props.children.props;
    assert.ok(body.accessibilityActions.some(action => action.name === 'moveDown'));
    body.onAccessibilityAction({ nativeEvent: { actionName: 'moveDown' } }); await view.pump();
    assert.equal(moves.length, 2); assert.deepEqual(moves[1], moves[0]); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('hold revela áudio4 por borda vertical sem desmontar o reconhecedor da camada segurada', async () => {
  const fixture = manyLayerFixture(), moves = [];
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async (id, delta, target) => moves.push({ id, delta, target }) });
  try {
    const tree = view.childLayer('title'), gesture = tree.props.children[0].props.gesture, pan = gesture.gestures[0].handlers;
    pan.onStart({ absoluteX: 180, absoluteY: 100 }); view.flushJS();
    pan.onUpdate({ absoluteX: 180, absoluteY: 157, translationX: 0, translationY: 88 });
    for (let i = 0; i < 16; i++) view.frame(16); view.flushJS();
    assert.equal(view.m().laneStart.value, 1);
    assert.ok(view.nodes('TimelineLayer').some(node => node.props.item.id === 'title'), 'selected source remains mounted outside its old page');
    const updated = view.childLayer('title');
    assert.equal(updated.props.children[0].props.gesture, gesture, 'paging never reconstructs the active recognizer');
    pan.onEnd(); view.flushJS(); await view.pump();
    assert.deepEqual(moves, [{ id: 'title', delta: 0, target: 4 }]); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('item agrupado pode sair para Nova faixa sem puxar irmãos nem trocar sua duração', async () => {
  const fixture = layerFixture(), moves = [];
  fixture.editing.layers[0].items.push(model.createStudioTextItem({ id: 'sibling', atTicks: model.studioTicks(5), durationTicks: model.studioTicks(2) }));
  fixture.layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: fixture.editing }).clips.filter(clip => clip.zIndex > 0);
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async (id, delta, target) => moves.push({ id, delta, target }) });
  try {
    assert.equal(view.nodes('TimelineLaneTarget').length, 1);
    const tree = view.childLayer('title'), pan = tree.props.children[0].props.gesture.gestures[0].handlers;
    pan.onStart({ absoluteX: 180, absoluteY: 100 }); view.flushJS();
    pan.onUpdate({ absoluteX: 420, absoluteY: 128, translationX: 240, translationY: 44 });
    assert.equal(layerVisibleWidth(tree), 120);
    pan.onEnd(); view.flushJS(); await view.pump();
    assert.deepEqual(moves, [{ id: 'title', delta: 4, target: 2 }]);
    assert.equal(fixture.editing.layers[0].items[1].atTicks, model.studioTicks(5));
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('background antes do begin JS ou após begin cancela pan e libera lifecycle; eventos antigos não salvam', () => {
  for (const started of [false, true]) {
    const fixture = layerFixture(), moves = [], lifecycle = [];
    const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async (_id, delta) => moves.push(delta),
      onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
    try {
      const tree = view.childLayer('title'), pan = tree.props.children[0].props.gesture.gestures[0].handlers;
      pan.onStart({ absoluteX: 180, absoluteY: 100 }); if (started) view.flushJS();
      view.appState('inactive'); view.childLayer('title'); view.flushJS();
      pan.onUpdate({ absoluteX: 240, absoluteY: 100, translationX: 60, translationY: 0 }); pan.onEnd(); pan.onFinalize({}, false); view.flushJS();
      assert.equal(view.m().phase.value, 0); assert.deepEqual(moves, []);
      assert.deepEqual(lifecycle, started ? ['start', 'end'] : []);
      assert.equal(view.scrollProps().scrollEnabled, true);
    } finally { view.dispose(); }
  }
});

test('onStart recusado no UI não transforma onEnd em commit nem destrava operação alheia', () => {
  const fixture = layerFixture(), moves = [], lifecycle = [];
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async (_id, delta) => moves.push(delta),
    onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
  try {
    const pan = view.childLayer('title').props.children[0].props.gesture.gestures[0].handlers;
    view.m().phase.value = 3; // another main trim owns the touch/phase
    pan.onStart({ absoluteX: 180, absoluteY: 100 }); pan.onEnd(); pan.onFinalize({}, false); view.flushJS();
    assert.equal(view.m().phase.value, 3); assert.deepEqual(lifecycle, []); assert.deepEqual(moves, []);
  } finally { view.dispose(); }
});

test('background durante persistência mantém ownership até terminar e não reaplica o movimento', async () => {
  const fixture = layerFixture(), moves = [], lifecycle = []; let resolve;
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: (_id, delta) => { moves.push(delta); return new Promise(done => { resolve = done; }); },
    onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
  try {
    const pan = view.childLayer('title').props.children[0].props.gesture.gestures[0].handlers;
    pan.onStart({ absoluteX: 180, absoluteY: 100 }); view.flushJS();
    pan.onUpdate({ absoluteX: 240, absoluteY: 100, translationX: 60, translationY: 0 }); pan.onEnd(); view.flushJS();
    view.update({ busy: true }); view.childLayer('title');
    view.appState('background'); view.childLayer('title'); view.flushJS();
    assert.deepEqual(lifecycle, ['start'], 'an already started durable write keeps ownership until settlement');
    pan.onStart({ absoluteX: 180, absoluteY: 100 }); pan.onUpdate({ absoluteX: 300, absoluteY: 100, translationX: 120, translationY: 0 }); pan.onEnd(); view.flushJS();
    assert.deepEqual(moves, [1], 'background cannot start a second operation on the same camera-free view');
    resolve(); await view.pump();
    assert.deepEqual(lifecycle, ['start', 'end']); assert.equal(view.m().phase.value, 0);
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('END(false) antes de FINALIZE(false) cancela corpo e alças da camada sem persistir', async () => {
  for (const mode of ['move', 'start', 'end']) {
    const fixture = layerFixture(), saves = [], previews = [], lifecycle = [];
    const view = harness({ ...fixture, selectedLayerId: 'title',
      onMoveLayer: async (...args) => saves.push(args), onLayerTrimCommit: async (...args) => saves.push(args),
      onLayerTrimPreview: (_id, range) => previews.push(range),
      onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
    try {
      const tree = view.childLayer('title'), initial = tree.props.style.at(-1).__style();
      const pan = mode === 'move' ? tree.props.children[0].props.gesture.gestures[0].handlers
        : tree.props.children[1][mode === 'start' ? 0 : 1].props.gesture.handlers;
      pan.onStart({ absoluteX: 180, absoluteY: 100 }); view.flushJS();
      pan.onUpdate({ absoluteX: 240, absoluteY: 128, translationX: 60, translationY: 44 }); view.animate(); view.flushJS();
      assert.notDeepEqual(tree.props.style.at(-1).__style(), initial, `${mode} changes the provisional geometry`);
      // RNGH calls END(false) before FINALIZE(false) after an ACTIVE cancel.
      pan.onEnd({}, false); pan.onFinalize({}, false); await view.pump();
      assert.deepEqual(saves, []); assert.deepEqual(lifecycle, ['start', 'end']);
      assert.deepEqual(tree.props.style.at(-1).__style(), initial);
      assert.equal(previews.at(-1), undefined); assert.equal(view.m().phase.value, 0);
      assert.equal(view.scrollProps().scrollEnabled, true); assert.deepEqual(view.seeks, []);
    } finally { view.dispose(); }
  }
});

test('cancelar camada antes do begin JS não abre lifecycle nem grava um draft tardio', async () => {
  const fixture = layerFixture(), saves = [], lifecycle = [], previews = [];
  const view = harness({ ...fixture, selectedLayerId: 'title',
    onLayerTrimCommit: async (...args) => saves.push(args), onLayerTrimPreview: (_id, range) => previews.push(range),
    onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
  try {
    const tree = view.childLayer('title'), pan = tree.props.children[1][1].props.gesture.handlers;
    pan.onStart({ absoluteX: 180, absoluteY: 100 });
    pan.onUpdate({ absoluteX: 240, absoluteY: 100, translationX: 60, translationY: 0 });
    pan.onEnd({}, false); pan.onFinalize({}, false); await view.pump();
    assert.deepEqual(saves, []); assert.deepEqual(lifecycle, []);
    assert.equal(previews.every(range => range === undefined), true);
    assert.equal(view.m().phase.value, 0); assert.equal(view.scrollProps().scrollEnabled, true);
  } finally { view.dispose(); }
});

test('cancelamento nativo do corte principal restaura geometria sem salvar nem mover cursor', () => {
  const view = harness();
  try {
    const pan = view.pan('end'), clip = view.childClip('a'), initial = clip.props.style.at(-1).__style();
    pan.onStart({ absoluteX: 250 }); view.flushJS();
    pan.onUpdate({ absoluteX: 70, translationX: -180 }); view.animate(); view.flushJS();
    assert.notDeepEqual(clip.props.style.at(-1).__style(), initial);
    pan.onEnd({}, false); pan.onFinalize({}, false); view.flushJS(); view.flushUI();
    assert.deepEqual(view.commits, []); assert.equal(view.cancellations.length, 1);
    assert.deepEqual(clip.props.style.at(-1).__style(), initial);
    assert.equal(view.m().phase.value, 0); assert.equal(view.m().trimIndex.value, -1);
    assert.equal(view.control('Posição da montagem').accessibilityState.disabled, false);
    assert.equal(view.nodes('TrimHandle')[0].props.disabled, false);
    assert.equal(view.playerPosition(), 1); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('corte válido que termina no UI antes de begin JS persiste exatamente uma vez', async () => {
  const view = harness();
  try {
    const pan = view.pan('end');
    pan.onStart({ absoluteX: 250 }); pan.onUpdate({ absoluteX: 70, translationX: -180 });
    pan.onEnd({}, true); pan.onFinalize({}, true);
    assert.equal(view.m().phase.value, 5); view.flushJS();
    assert.equal(view.commits.length, 1); assert.equal(view.commits[0].end, 5);
    view.completeCommit(); await view.pump();
    assert.equal(view.m().phase.value, 0); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('background durante pinça libera controles mesmo com begin JS atrasado e finalize falso', () => {
  for (const started of [false, true]) {
    const view = harness();
    try {
      const pinch = view.pinch();
      pinch.onStart(); if (started) view.flushJS();
      pinch.onUpdate({ scale: 1.5 });
      view.appState('inactive'); view.flushJS(); pinch.onFinalize({}, false); view.flushJS();
      assert.equal(view.m().phase.value, 0);
      assert.equal(view.control('Posição da montagem').accessibilityState.disabled, false);
      assert.equal(view.nodes('TrimHandle')[0].props.disabled, false);
      assert.equal(view.scrollProps().scrollEnabled, true); assert.deepEqual(view.seeks, []);
      // A new pinch is usable after returning to the foreground.
      view.appState('active'); const next = view.pinch(); next.onStart(); view.flushJS();
      assert.equal(view.m().phase.value, 4); assert.equal(view.control('Posição da montagem').accessibilityState.disabled, true);
      next.onFinalize({}, true); view.flushJS();
      assert.equal(view.control('Posição da montagem').accessibilityState.disabled, false);
    } finally { view.dispose(); }
  }
});

test('begin principal entregue depois do background não reabre draft nem trava controles', () => {
  const view = harness();
  try {
    const pan = view.pan('start');
    pan.onStart({ absoluteX: 150 }); pan.onUpdate({ absoluteX: 210, translationX: 60 });
    view.appState('inactive'); view.flushJS();
    pan.onEnd({}, false); pan.onFinalize({}, false); view.animate(); view.flushJS();
    assert.deepEqual(view.previews, []); assert.deepEqual(view.commits, []); assert.deepEqual(view.cancellations, []);
    assert.equal(view.m().phase.value, 0); assert.equal(view.nodes('TrimHandle')[0].props.disabled, false);
    assert.equal(view.control('Posição da montagem').accessibilityState.disabled, false); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('ajuste acessível confirma com setters JS assíncronos e continua utilizável após salvar', async () => {
  const fixture = layerFixture(), commits = [], lifecycle = []; let resolve;
  const view = harness({ ...fixture, nativeSharedValues: true, selectedLayerId: 'title',
    onLayerTrimCommit: (_id, range) => { commits.push(range); return new Promise(done => { resolve = done; }); },
    onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
  try {
    const action = view.childLayer('title').props.children[1][1].props.children.props.onAccessibilityAction;
    view.flushUI(); action({ nativeEvent: { actionName: 'increment' } }); await view.pump();
    assert.equal(commits.length, 1, 'the native UI transaction must precede the JS begin/commit');
    assert.ok(Math.abs(commits[0].endSeconds - 3.1) < 1e-8); assert.deepEqual(lifecycle, ['start']);
    resolve(); await view.pump(); view.flushUI();
    assert.equal(view.m().phase.value, 0); assert.deepEqual(lifecycle, ['start', 'end']);
    action({ nativeEvent: { actionName: 'decrement' } }); await view.pump();
    assert.equal(commits.length, 2); resolve(); await view.pump(); view.flushUI();
    assert.equal(view.m().phase.value, 0); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('mover faixa pela acessibilidade passa epoch confirmado mesmo com shared setters assíncronos', async () => {
  const fixture = manyLayerFixture(), moves = [], lifecycle = [];
  const view = harness({ ...fixture, nativeSharedValues: true, selectedLayerId: 'title',
    onMoveLayer: async (id, delta, target) => moves.push({ id, delta, target }),
    onLayerInteractionStart: () => lifecycle.push('start'), onLayerInteractionEnd: () => lifecycle.push('end') });
  try {
    const action = view.childLayer('title').props.children[0].props.children.props.onAccessibilityAction;
    view.flushUI(); action({ nativeEvent: { actionName: 'moveDown' } }); await view.pump(); view.flushUI();
    assert.deepEqual(moves, [{ id: 'title', delta: 0, target: 2 }]);
    assert.deepEqual(lifecycle, ['start', 'end']); assert.equal(view.m().phase.value, 0);
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('liberar movimento acessível revela destino fora da janela sem publicar getter antigo', async () => {
  const fixture = manyLayerFixture(); let resolve;
  const view = harness({ ...fixture, nativeSharedValues: true, selectedLayerId: 'caption',
    onMoveLayer: () => new Promise(done => { resolve = done; }) });
  try {
    assert.equal(view.m().laneStart.value, 0);
    const action = view.childLayer('caption').props.children[0].props.children.props.onAccessibilityAction;
    view.flushUI(); action({ nativeEvent: { actionName: 'moveDown' } }); await view.pump();
    assert.equal(view.m().phase.value, 5);
    const editing = model.moveStudioLayerItemToLane(fixture.editing, 'caption', 4);
    const layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.filter(clip => clip.zIndex > 0);
    view.update({ editing, layers }); view.flushJS(); view.childLayer('caption'); view.flushUI();
    resolve(); await view.pump(); view.flushUI(); view.flushJS();
    assert.equal(view.m().phase.value, 0);
    assert.equal(view.m().laneStart.value, 1, 'the selected lane must remain in the native window');
    assert.ok(view.nodes('TimelineLayer').some(node => node.props.item.id === 'voice'), 'React receives the computed viewport, not its stale SharedValue getter');
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('visual ampliado conserva ordem das faixas acima do main, alças grandes e controles sem legendas', () => {
  const fixture = manyLayerFixture();
  const view = harness({ ...fixture, selectedLayerId: 'title', onLayerTrimCommit: async () => {} });
  try {
    const rows = view.nodes('TimelineLayer').filter(node => node.props.item.zIndex <= 3);
    const main = view.nodes('TimelineClip')[0];
    assert.ok(rows.every(node => node.props.top + 44 <= main.props.top));
    assert.deepEqual(rows.map(node => node.props.item.zIndex), [1, 2, 3]);
    const layer = view.childLayer('title');
    assert.equal(layer.props.style[0].height, 44);
    assert.ok(layer.props.children[1].every(node => resolveStyle(node.props.children.props.style).width >= 44));
    assert.equal(main.props.height, 72); assert.equal(view.childClip('a').props.children.length, 2, 'filmstrip and shade only; no permanent number/duration labels');
    assert.equal(view.control('Próximas faixas'), undefined); assert.ok(view.laneScroll()); assert.ok(view.control('Posição da montagem').accessibilityActions.some(action => action.name === 'zoomIn'));
  } finally { view.dispose(); }
});

test('alças ampliadas centralizam toque na borda real e acompanham corte sem deslocar o cursor', async () => {
  const view = harness({ nativeSharedValues: true });
  try {
    const verifyBorders = () => {
      const clip = view.childClip('a').props.style.at(-1).__style();
      for (const edge of ['start', 'end']) {
        const handle = view.childHandle(edge).props.children;
        const touch = resolveStyle(handle.props.style), visual = resolveStyle(handle.props.children.props.style);
        const left = handle.props.style.at(-1).__style().left;
        assert.equal(left + touch.width / 2 + visual.transform[0].translateX, clip.left + (edge === 'end' ? clip.width : 0), 'the visible handle remains centered on the original edge');
        assert.ok(touch.width >= 44);
        assert.ok(visual.width < touch.width, 'visible handle does not consume the entire finger target');
      }
    };
    verifyBorders();
    const pan = view.pan('start');
    pan.onStart({ absoluteX: 150 }); view.flushJS(); view.flushUI();
    pan.onUpdate({ absoluteX: 174, translationX: 24 }); view.flushUI(); verifyBorders();
    pan.onEnd({ translationX: 24 }, true); await view.pump();
    assert.equal(view.commits.length, 1); assert.equal(view.commits[0].start, 2.4);
    assert.equal(view.playerPosition(), 1); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('toque44pt das alças da camada cabe no pai e fica centrado em ambas as bordas', () => {
  const fixture = layerFixture(), view = harness({ ...fixture, selectedLayerId: 'title', onLayerTrimCommit: async () => {} });
  try {
    const layer = view.childLayer('title');
    const parent = layer.props.style.at(-1).__style();
    const body = layer.props.children[0].props.children.props.style[1];
    for (const [index, detector] of layer.props.children[1].entries()) {
      const touch = resolveStyle(detector.props.children.props.style);
      const start = index === 0 ? touch.left : parent.width - touch.right - touch.width;
      const edge = index === 0 ? body.left : parent.width - body.right;
      assert.equal(start + touch.width / 2, edge);
      assert.ok(start >= 0 && start + touch.width <= parent.width, 'RN can reach the whole hit area inside its parent bounds');
      assert.ok(touch.width >= 44);
    }
    assert.equal(view.playerPosition(), 1); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

for (const width of [6, 8, 36]) {
  for (const edge of ['start', 'end']) {
    test(`main${width}pt distingue o centro da alça ${edge} e salva o corte real com Babel`, async () => {
      const short = { ...take('a'), end: 2 + width / 60 }, saves = [];
      const view = harness({ nativeSharedValues: true, nativeWorklets: true, takes: [short], position: 0,
        onTrimCommit: async range => saves.push(range) });
      try {
        const clip = resolveStyle(view.childClip('a').props.style);
        const targets = ['start', 'end'].map(name => {
          const handle = view.childHandle(name).props.children;
          const touch = resolveStyle(handle.props.style), visual = resolveStyle(handle.props.children.props.style);
          const expected = clip.left + (name === 'end' ? clip.width : 0);
          assert.equal(touch.width, 44);
          assert.ok(Math.abs(touch.left + touch.width / 2 + visual.transform[0].translateX - expected) < 1e-9);
          assert.ok(visual.width <= clip.width && visual.overflow === 'hidden', 'the yellow handle and chevron cannot cover the neighboring edge');
          assert.equal(handle.props.children.props.pointerEvents, 'none');
          return { name, left: touch.left, right: touch.left + touch.width };
        });
        assert.ok(targets[0].right <= targets[1].left + 1e-9, 'start and end targets do not overlap');
        const center = clip.left + (edge === 'end' ? clip.width : 0);
        assert.deepEqual(targets.filter(target => center >= target.left && center < target.right).map(target => target.name), [edge], 'native hit-testing can only choose the intended handle');
        const absoluteX = center - view.m().offset.value, translationX = edge === 'start' ? -12 : 12;
        const pan = view.pan(edge);
        pan.onStart({ absoluteX }); view.flushJS(); view.flushUI();
        pan.onUpdate({ absoluteX: absoluteX + translationX, translationX }); view.reactions(); view.flushJS(); view.flushUI();
        pan.onEnd({ absoluteX: absoluteX + translationX, translationX }, true); await view.pump();
        assert.equal(saves.length, 1); assert.equal(saves[0].takeId, 'a');
        assert.equal(saves[0][edge], edge === 'start' ? 1.8 : Math.round((short.end + .2) * 120000) / 120000);
        assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 0);
      } finally { view.dispose(); }
    });
  }
  test(`camada${width}pt mantém body no tempo real e oferece centros distintos para ambos os trims`, async () => {
    for (const edge of ['start', 'end']) {
      const fixture = layerFixture(), saves = [];
      fixture.editing.layers[0].items[0].durationTicks = model.studioTicks(width / 60);
      fixture.layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: fixture.editing }).clips.filter(clip => clip.zIndex > 0);
      const view = harness({ ...fixture, nativeSharedValues: true, nativeWorklets: true, selectedLayerId: 'title',
        onLayerTrimCommit: async (id, range) => saves.push({ id, range }) });
      try {
        const layer = view.childLayer('title'), parent = resolveStyle(layer.props.style), body = resolveStyle(layer.props.children[0].props.children.props.style);
        const visibleWidth = parent.width - body.left - body.right;
        assert.ok(Math.abs(parent.left + body.left - 210) < 1e-9, 'the larger transparent wrapper does not move the layer from its original1s');
        assert.ok(Math.abs(visibleWidth - Math.max(8, width)) < 1e-9);
        const targets = layer.props.children[1].map((detector, index) => {
          const handle = detector.props.children, touch = resolveStyle(handle.props.style), visual = resolveStyle(handle.props.children.props.style);
          const left = index === 0 ? touch.left : parent.width - touch.right - touch.width;
          const center = index === 0 ? body.left : parent.width - body.right;
          assert.equal(touch.width, 44); assert.ok(left >= 0 && left + touch.width <= parent.width);
          assert.ok(Math.abs(left + touch.width / 2 + visual.transform[0].translateX - center) < 1e-9);
          assert.ok(visual.width <= visibleWidth && visual.overflow === 'hidden');
          assert.equal(handle.props.children.props.pointerEvents, 'none');
          return { name: index === 0 ? 'start' : 'end', left, right: left + touch.width, pan: detector.props.gesture.handlers };
        });
        assert.ok(targets[0].right <= targets[1].left + 1e-9);
        const center = edge === 'start' ? body.left : parent.width - body.right;
        assert.deepEqual(targets.filter(target => center >= target.left && center < target.right).map(target => target.name), [edge]);
        const absoluteX = parent.left + center - view.m().offset.value, translationX = edge === 'start' ? -12 : 12;
        const pan = targets.find(target => target.name === edge).pan;
        pan.onStart({ absoluteX, absoluteY: 45 }); view.flushJS(); view.flushUI();
        pan.onUpdate({ absoluteX: absoluteX + translationX, absoluteY: 45, translationX, translationY: 0 }); view.reactions(); view.flushJS(); view.flushUI();
        pan.onEnd({ absoluteX: absoluteX + translationX, absoluteY: 45, translationX, translationY: 0 }, true); await view.pump();
        assert.equal(saves.length, 1); assert.equal(saves[0].id, 'title');
        assert.ok(Math.abs(saves[0].range[edge === 'start' ? 'startSeconds' : 'endSeconds'] - (edge === 'start' ? .8 : 1 + width / 60 + .2)) < 1e-5);
        assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
      } finally { view.dispose(); }
    }
  });
}

test('snap da alça confirma borda de outra camada, mostra guia no UI e não muda cursor', async () => {
  const fixture = manyLayerFixture(), commits = [];
  const view = harness({ ...fixture, selectedLayerId: 'title', onLayerTrimCommit: async (_id, range) => commits.push(range) });
  try {
    const pan = view.childLayer('title').props.children[1][1].props.gesture.handlers;
    pan.onStart({ absoluteX: 240, absoluteY: 45 }); view.flushJS();
    pan.onUpdate({ absoluteX: 295, absoluteY: 45, translationX: 55, translationY: 0 });
    assert.equal(view.m().snap.value.seconds, 4); assert.equal(view.snapGuide().opacity, 1);
    assert.equal(view.snapGuide().left, 390);
    // END contains the last finger displacement even without another UPDATE.
    pan.onEnd({ absoluteX: 297, absoluteY: 45, translationX: 57, translationY: 0 }, true); view.flushJS(); await view.pump();
    assert.deepEqual(commits, [{ startSeconds: 1, endSeconds: 4 }]);
    assert.equal(view.snapGuide().opacity, 0); assert.equal(view.m().snap.value, null);
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('feedback acompanha aquisição física do snap sem repetir em updates ou keys coincidentes', () => {
  const view = harness({ ...manyLayerFixture(), nativeWorklets: true, selectedLayerId: 'title', onLayerTrimCommit: async () => {} });
  try {
    const pan = view.childLayer('title').props.children[1][1].props.gesture.handlers;
    pan.onStart({ absoluteX: 240, absoluteY: 45 }); view.flushJS();
    const update = translationX => { pan.onUpdate({ absoluteX: 240 + translationX, absoluteY: 45, translationX, translationY: 0 }); view.reactions(); view.flushJS(); };
    update(55); assert.equal(view.feedbacks.length, 1);
    update(57); update(60); assert.equal(view.feedbacks.length, 1, 'resting at the same target does not buzz on each display frame');
    view.m().snap.value = { ...view.m().snap.value, key: 'another-layer:same-edge' }; view.reactions(); view.flushJS();
    assert.equal(view.feedbacks.length, 1, 'coincident source keys are the same physical alignment');
    update(177); assert.equal(view.feedbacks.length, 2, 'a different physical edge can give new feedback');
    pan.onEnd({}, false); pan.onFinalize({}, false); view.reactions(); view.flushJS();
    assert.equal(view.feedbacks.length, 2, 'cancel and release do not produce feedback');
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

for (const invalidation of ['cancel', 'background', 'unmount', 'new-gesture', 'new-target']) {
  test(`feedback atrasado de snap não pertence mais ao gesto após ${invalidation}`, () => {
    const view = harness({ ...manyLayerFixture(), nativeSharedValues: true, nativeWorklets: true, selectedLayerId: 'title', onLayerTrimCommit: async () => {} });
    try {
      const pan = view.childLayer('title').props.children[1][1].props.gesture.handlers;
      pan.onStart({ absoluteX: 240, absoluteY: 45 }); view.flushJS(); view.flushUI();
      pan.onUpdate({ absoluteX: 295, absoluteY: 45, translationX: 55, translationY: 0 }); view.reactions();
      assert.equal(view.feedbacks.length, 0, 'JS is still blocked while the yellow guide is already visible');
      if (invalidation === 'background') { view.appState('background'); view.flushUI(); }
      else if (invalidation === 'unmount') view.dispose();
      else if (invalidation === 'new-target') {
        pan.onUpdate({ absoluteX: 417, absoluteY: 45, translationX: 177, translationY: 0 }); view.reactions();
      } else {
        pan.onEnd({}, false); pan.onFinalize({}, false);
        if (invalidation === 'new-gesture') pan.onStart({ absoluteX: 240, absoluteY: 45 });
        view.reactions();
      }
      view.flushJS(); view.flushUI();
      assert.equal(view.feedbacks.length, invalidation === 'new-target' ? 1 : 0, 'only a current live target may produce feedback');
      assert.deepEqual(view.seeks, []);
    } finally { view.dispose(); }
  });
}

test('snap principal só produz feedback enquanto sua operação de corte está ativa', () => {
  const view = harness({ nativeSharedValues: true, nativeWorklets: true });
  try {
    const pan = view.pan('start');
    pan.onStart({ absoluteX: 150 }); view.flushJS(); view.flushUI();
    pan.onUpdate({ absoluteX: 205, translationX: 55 }); view.reactions(); view.flushJS(); view.flushUI();
    assert.equal(view.m().snap.value.seconds, 1); assert.equal(view.feedbacks.length, 1);
    pan.onUpdate({ absoluteX: 207, translationX: 57 }); view.reactions(); view.flushJS();
    assert.equal(view.feedbacks.length, 1);
    pan.onEnd({}, false); pan.onFinalize({}, false); view.reactions(); view.flushJS(); view.flushUI();
    assert.equal(view.feedbacks.length, 1); assert.deepEqual(view.commits, []); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('snap de move preserva duração e END usa deslocamento final uma vez', async () => {
  const fixture = layerFixture(), moves = [];
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async (_id, delta) => moves.push(delta) });
  try {
    const tree = view.childLayer('title'), pan = tree.props.children[0].props.gesture.gestures[0].handlers;
    pan.onStart({ absoluteX: 180, absoluteY: 45 }); view.flushJS();
    pan.onEnd({ absoluteX: 357, absoluteY: 45, translationX: 177, translationY: 0 }, true); await view.pump();
    assert.deepEqual(moves, [3], 'end of the 2s layer aligns to the main boundary at6s');
    assert.equal(layerVisibleWidth(tree), 120, 'unchanged duration/source speed');
    assert.equal(view.m().snap.value, null); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('snap de início usa cursor absoluto e cancel limpa a guia sem salvar', async () => {
  const fixture = layerFixture(), commits = [];
  fixture.editing.layers[0].items[0].atTicks = model.studioTicks(2);
  fixture.layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: fixture.editing }).clips.filter(clip => clip.zIndex > 0);
  const view = harness({ ...fixture, selectedLayerId: 'title', onLayerTrimCommit: async (_id, range) => commits.push(range) });
  try {
    const pan = view.childLayer('title').props.children[1][0].props.gesture.handlers;
    pan.onStart({ absoluteX: 210, absoluteY: 45 }); view.flushJS();
    pan.onUpdate({ absoluteX: 155, absoluteY: 45, translationX: -55, translationY: 0 });
    assert.equal(view.m().snap.value.key, 'cursor'); assert.equal(view.snapGuide().opacity, 1);
    pan.onEnd({}, false); pan.onFinalize({}, false); await view.pump();
    assert.deepEqual(commits, []); assert.equal(view.snapGuide().opacity, 0); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('novo gesto não herda histerese de um snap cancelado', async () => {
  const fixture = manyLayerFixture(), commits = [];
  const view = harness({ ...fixture, selectedLayerId: 'title', onLayerTrimCommit: async (_id, range) => commits.push(range) });
  try {
    const pan = view.childLayer('title').props.children[1][1].props.gesture.handlers;
    pan.onStart({ absoluteX: 240, absoluteY: 45 }); view.flushJS();
    pan.onUpdate({ absoluteX: 295, absoluteY: 45, translationX: 55, translationY: 0 });
    assert.equal(view.m().snap.value.seconds, 4);
    pan.onEnd({}, false); pan.onFinalize({}, false); await view.pump();
    pan.onStart({ absoluteX: 240, absoluteY: 45 }); view.flushJS();
    pan.onUpdate({ absoluteX: 309.6, absoluteY: 45, translationX: 69.6, translationY: 0 });
    assert.equal(view.m().snap.value, null, '9.6px away is outside acquisition, despite being inside the former release radius');
    pan.onEnd({}, true); await view.pump();
    assert.equal(commits.length, 1); assert.equal(commits[0].endSeconds, 4.16);
    assert.equal(view.snapGuide().opacity, 0); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('alvo fora do áudio original não vence bounds do trim', async () => {
  const fixture = manyLayerFixture(), commits = [];
  fixture.editing.assets.find(asset => asset.id === 'voice-asset').durationTicks = model.studioTicks(3.9);
  fixture.editing.layers.find(layer => layer.id === 'images').items[0].durationTicks = model.studioTicks(4);
  fixture.layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: fixture.editing }).clips.filter(clip => clip.zIndex > 0);
  const view = harness({ ...fixture, selectedLayerId: 'voice', onLayerTrimCommit: async (_id, range) => commits.push(range) });
  try {
    const pan = view.childLayer('voice').props.children[1][1].props.gesture.handlers;
    pan.onStart({ absoluteX: 240, absoluteY: 90 }); view.flushJS();
    pan.onUpdate({ absoluteX: 300, absoluteY: 90, translationX: 60, translationY: 0 });
    assert.equal(view.m().snap.value, null, 'nearby5s exceeds the original by0.1s');
    pan.onEnd({}, true); await view.pump();
    assert.deepEqual(commits, [{ startSeconds: 1, endSeconds: 4.9 }]);
    const saved = layerModule.exports.applyStudioLayerTimelineRange(fixture.editing, 'voice', commits[0]);
    assert.equal(saved.layers.find(layer => layer.id === 'audio').items[0].sourceEndTicks, model.studioTicks(3.9));
  } finally { view.dispose(); }
});

test('snap principal converte tempo absoluto para origem e solta sem seek extra', async () => {
  const fixture = manyLayerFixture(), view = harness(fixture);
  try {
    const pan = view.pan('end');
    pan.onStart({ absoluteX: 250 }); view.flushJS();
    pan.onUpdate({ absoluteX: 135, translationX: -115 });
    assert.equal(view.m().snap.value.seconds, 4); assert.equal(view.m().end.value, 6);
    assert.equal(view.snapGuide().opacity, 1);
    pan.onEnd({ absoluteX: 133, translationX: -117 }, true); view.flushJS();
    assert.equal(view.commits.length, 1); assert.equal(view.commits[0].end, 6);
    assert.equal(view.snapGuide().opacity, 0); view.completeCommit(); await view.pump();
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('previewOnly mantém scrub real numa faixa de60pt sem régua, camadas, alças ou controles', async () => {
  const fixture = manyLayerFixture(), view = harness({ ...fixture, previewOnly: true, locked: true });
  try {
    assert.equal(view.nodes('TimelineLayer').length, 0); assert.equal(view.nodes('TrimHandle').length, 0);
    assert.equal(view.nodes('TimelineTick').length, 0); assert.equal(view.nodes('TimelineClip')[0].props.height, 60);
    assert.equal(view.nodes('TimelineClip')[0].props.top, 0); assert.equal(view.control('Aumentar zoom da timeline'), undefined);
    view.scroll().onBeginDrag(); view.scroll().onEndDrag({ contentOffset: { x: 120 }, velocity: { x: 0 } });
    await view.pump(); assert.deepEqual(view.seeks, [2]); assert.equal(view.m().phase.value, 0);
    assert.equal(view.playerPosition(), 2);
  } finally { view.dispose(); }
});

test('faixa de imagem usa pixels existentes limitados à janela, texto usa purple e append fica fixo', () => {
  const fixture = manyLayerFixture(), view = harness({ ...fixture, onAppend: () => {} });
  try {
    const text = view.childLayer('title').props.children[0].props.children.props;
    assert.equal(text.style[1].backgroundColor, '#803DFF');
    const image = view.childLayer('poster').props.children[0].props.children.props;
    const strip = image.children.props;
    assert.ok(strip.children.length <= 9, 'one viewport plus overscan, independent of media duration');
    assert.ok(strip.children.every(node => node.props.source.uri === 'file:///poster.jpg'));
    assert.equal(image.accessibilityLabel, 'Selecionar camada Imagem');
    const append = view.nodes('AppendButton')[0]; assert.ok(append);
    assert.ok(view.nodes('TimelineClip')[0].props.top > view.nodes('TimelineLayer')[0].props.top);
  } finally { view.dispose(); }
});

test('autoscroll com Babel real captura helper snap inicializado e libera guia no fim', async () => {
  const fixture = manyLayerFixture(), moves = [];
  const view = harness({ ...fixture, nativeWorklets: true, selectedLayerId: 'title', onMoveLayer: async (id, delta, target) => moves.push({ id, delta, target }) });
  try {
    const tree = view.childLayer('title'), pan = tree.props.children[0].props.gesture.gestures[0].handlers;
    pan.onStart({ absoluteX: 180, absoluteY: 48 }); view.flushJS();
    pan.onUpdate({ absoluteX: 180, absoluteY: 157, translationX: 0, translationY: 88 });
    for (let i = 0; i < 16; i++) view.frame(16); view.flushJS();
    assert.equal(view.m().laneStart.value, 1);
    pan.onEnd({}, true); await view.pump();
    assert.deepEqual(moves, [{ id: 'title', delta: 0, target: 4 }]);
    assert.equal(view.m().snap.value, null); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('snap do main seguinte usa posição atual depois de cortar o take anterior', () => {
  const fixture = manyLayerFixture(), view = harness({ ...fixture, activeTakeId: 'b' });
  try {
    view.pan('end'); // register the recognizer before the preceding duration changes
    view.update({ takes: [{ ...take('a'), end: 5 }, take('b')] });
    const pan = view.pan('end'); pan.onStart({ absoluteX: 250 }); view.flushJS();
    pan.onUpdate({ absoluteX: -50, translationX: -300 });
    assert.equal(view.m().mainTimelineStart.value, 3);
    assert.equal(view.m().snap.value.seconds, 4, 'the absolute boundary is current, not the former position of the main clip');
    assert.equal(view.m().end.value, 3);
    pan.onEnd({}, false); pan.onFinalize({}, false); view.flushJS();
    assert.equal(view.snapGuide().opacity, 0); assert.deepEqual(view.commits, []); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

// Native playback sends sparse samples; between them the UI frame clock must
// move the real scroll view, without asking the player to seek every frame.
const playbackFrame = (view, elapsed = 1000 / 60) => {
  const before = view.scrolls.length;
  view.frame(elapsed); view.flushJS(); view.flushUI();
  const next = view.scrolls.slice(before);
  if (next.length) {
    // Feed back the native scroll position, as UIScrollView does after scrollTo.
    view.scroll().onScroll({ contentOffset: { x: next.at(-1).x } });
    view.flushJS(); view.flushUI();
  }
  return next;
};
const settlePlaybackSample = view => {
  view.flushUI(); view.flushJS(); view.flushUI(); view.reactions();
  if (view.scrolls.length) { view.scroll().onScroll({ contentOffset: { x: view.scrolls.at(-1).x } }); view.flushJS(); view.flushUI(); }
  view.scrolls.length = 0;
};
const beginPlayback = (view, position = 1, scale = 60) => {
  view.update({ position, playing: true, loading: false }); view.flushUI();
  view.scroll().onScroll({ contentOffset: { x: position * scale } }); view.flushJS(); view.flushUI();
  settlePlaybackSample(view);
};
for (const fps of [60, 120]) for (const nativeSharedValues of [false, true]) {
  test(`playback15Hz move scrollTo em cada frame${fps}Hz sem seeks, sharedValuesNative=${nativeSharedValues}`, () => {
    const view = harness({ nativeSharedValues, nativeWorklets: fps === 120 && nativeSharedValues });
    try {
      beginPlayback(view);
      let previous = view.playerPosition(), lastX = 60;
      for (let index = 0; index < fps / 2; index++) {
        if (index && index % (fps / 15) === 0) { view.update({ position: 1 + index / fps }); view.flushUI(); }
        const moves = playbackFrame(view, 1000 / fps);
        assert.equal(moves.length, 1, `one scroll in frame${index}`);
        assert.ok(view.playerPosition() > previous, `frame${index} advances the reaction's actual position`);
        assert.ok(moves[0].x > lastX, `frame${index} scrolls forward`);
        assert.equal(moves[0].animated, false, 'frame clock drives pixels directly');
        previous = view.playerPosition(); lastX = moves[0].x;
      }
      assert.ok(Math.abs(view.playerPosition() - 1.5) < .005, 'the half-second playback time has no manufactured animate64ms drift');
      assert.deepEqual(view.seeks, []);
    } finally { view.dispose(); }
  });
}
test('pausa e carregamento imobilizam o relógio; retomar não inclui o tempo parado', () => {
  const view = harness();
  try {
    beginPlayback(view); playbackFrame(view);
    view.update({ position: 1.1, playing: false }); view.flushUI(); settlePlaybackSample(view);
    const paused = view.playerPosition();
    playbackFrame(view, 100); playbackFrame(view, 100);
    assert.equal(view.playerPosition(), paused); assert.deepEqual(view.scrolls, []);
    view.update({ position: 1.1, playing: true, loading: true }); view.flushUI(); settlePlaybackSample(view);
    const loading = view.playerPosition();
    playbackFrame(view, 100); playbackFrame(view, 100);
    assert.equal(view.playerPosition(), loading); assert.deepEqual(view.scrolls, []);
    view.update({ position: 1.1, loading: false }); view.flushUI(); view.reactions(); playbackFrame(view);
    assert.ok(view.playerPosition() > 1.1 && view.playerPosition() < 1.14, 'resume advances a fresh frame, not the paused or loading interval');
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});
test('scrub prevalece sobre relógio e sample antigo; só confirmação nova libera reprodução', async () => {
  const view = harness({ nativeSharedValues: true });
  try {
    beginPlayback(view); playbackFrame(view);
    view.scroll().onBeginDrag(); view.flushJS(); view.flushUI();
    view.update({ position: 1.2, playing: true }); view.flushUI(); view.scrolls.length = 0;
    playbackFrame(view, 100); assert.deepEqual(view.scrolls, [], 'clock cannot reposition an active finger gesture');
    view.scroll().onEndDrag({ contentOffset: { x: 180 }, targetContentOffset: { x: 180 }, velocity: { x: 0 } }); await view.pump();
    assert.equal(view.playerPosition(), 3); assert.deepEqual(view.seeks, [3]); settlePlaybackSample(view);
    view.update({ position: 1.3 }); view.flushUI(); view.reactions(); view.scrolls.length = 0;
    playbackFrame(view, 100); assert.equal(view.playerPosition(), 3, 'obsolete sample cannot rewind the completed scrub'); assert.deepEqual(view.scrolls, []);
    view.update({ position: 3, playing: false }); view.flushUI(); view.reactions(); view.update({ playing: true }); view.flushUI();
    playbackFrame(view); assert.ok(view.playerPosition() > 3 && view.playerPosition() < 3.04);
    assert.deepEqual(view.seeks, [3], 'resuming never manufactures another seek');
  } finally { view.dispose(); }
});
test('background congela timeline sem salto ao reativar antes de sample novo', () => {
  const view = harness({ nativeSharedValues: true });
  try {
    beginPlayback(view); playbackFrame(view); const before = view.playerPosition();
    view.appState('inactive'); view.flushUI(); view.scrolls.length = 0;
    playbackFrame(view, 300); playbackFrame(view, 300); assert.equal(view.playerPosition(), before); assert.deepEqual(view.scrolls, []);
    view.appState('background'); view.flushUI(); playbackFrame(view, 300); assert.equal(view.playerPosition(), before);
    view.appState('active'); view.flushUI(); playbackFrame(view, 300); assert.equal(view.playerPosition(), before, 'foreground does not extrapolate the suspended interval');
    view.update({ position: 1.1, playing: true, loading: false }); view.flushUI(); view.reactions(); playbackFrame(view);
    assert.ok(view.playerPosition() > 1.1 && view.playerPosition() < 1.14); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});
test('zoom mínimo ainda move pixels em cada frame e o relógio respeita o fim da montagem', () => {
  const view = harness({ pixelsPerSecond: 12 });
  try {
    beginPlayback(view, 1, 12);
    let lastX = 12;
    for (let index = 0; index < 8; index++) {
      if (index && index % 4 === 0) view.update({ position: 1 + index / 60 });
      const moves = playbackFrame(view); assert.equal(moves.length, 1, `subpixel movement survives frame${index}`); assert.ok(moves[0].x > lastX); lastX = moves[0].x;
    }
    // A deliberate seek establishes an exact paused anchor before Play.
    view.update({ position: 11.99, playing: false }); settlePlaybackSample(view);
    view.update({ playing: true }); view.flushUI(); playbackFrame(view, 100);
    assert.equal(view.playerPosition(), 11.99, 'prediction cannot draw the end before the media reaches it');
    view.update({ position: 12, playing: false }); settlePlaybackSample(view);
    assert.equal(view.playerPosition(), 12);
    assert.equal(view.m().offset.value, 144, 'the native scroll reaches the exact final endpoint even at low zoom');
    view.scrolls.length = 0; playbackFrame(view, 100); assert.equal(view.playerPosition(), 12); assert.deepEqual(view.scrolls, []); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('ocupado bloqueia extrapolação e scroll; liberar começa do novo sample sem buscar o player', () => {
  const view = harness({ nativeSharedValues: true });
  try {
    beginPlayback(view); playbackFrame(view); view.update({ position: 1.2, busy: true }); view.flushUI(); view.reactions();
    const blocked = view.playerPosition(); view.scrolls.length = 0; playbackFrame(view, 100); playbackFrame(view, 100);
    assert.equal(view.playerPosition(), blocked); assert.deepEqual(view.scrolls, []);
    view.update({ position: 1.2, busy: false }); view.flushUI(); settlePlaybackSample(view); playbackFrame(view);
    assert.ok(view.playerPosition() > 1.2 && view.playerPosition() < 1.24); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});
test('samples ausentes e um frame suspenso param o avanço em vez de inventar mídia em reprodução', () => {
  const view = harness();
  try {
    beginPlayback(view);
    for (let index = 0; index < 20; index++) playbackFrame(view);
    const stalled = view.playerPosition(); assert.ok(stalled >= 1.119 && stalled <= 1.121, 'clock has at most120ms of unconfirmed prediction');
    view.scrolls.length = 0; playbackFrame(view); playbackFrame(view); assert.equal(view.playerPosition(), stalled); assert.deepEqual(view.scrolls, []);
    view.update({ position: 1.5 }); view.flushUI(); settlePlaybackSample(view); const beforeGap = view.playerPosition(); playbackFrame(view, 200);
    assert.equal(view.playerPosition(), beforeGap, 'long dropped frame must not advance by its whole gap');
    view.update({ position: 1.6 }); view.flushUI(); settlePlaybackSample(view); playbackFrame(view);
    assert.ok(view.playerPosition() > beforeGap && view.playerPosition() <= beforeGap + 1.15 / 60 + .001, 'a fresh sample resumes smoothly without teleporting to its timestamp');
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});
test('eventos nativos15Hz com mídia congelada não renovam o watchdog; o retorno retoma sem salto', () => {
  const channel = { value: { active: true, sequence: 1, position: 1, playing: true, loading: false } };
  const view = harness({ nativeSharedValues: true, nativeWorklets: true, playbackChannel: channel });
  try {
    view.reactions();
    let previous = view.playerPosition();
    for (let frame = 0; frame < 60; frame++) {
      if (frame % 4 === 0) channel.value = { ...channel.value, sequence: channel.value.sequence + 1 };
      view.reactions(); view.frame(1000 / 60); view.reactions();
      assert.ok(view.playerPosition() >= previous, 'duplicate samples cannot rewind the strip');
      assert.ok(view.playerPosition() <= 1.121, 'buffering cannot keep the visual clock alive forever');
      previous = view.playerPosition();
    }
    assert.ok(Math.abs(previous - 1.12) < .001);
    channel.value = { ...channel.value, sequence: channel.value.sequence + 1, position: 1.3 };
    view.reactions();
    assert.equal(view.playerPosition(), previous, 'recovery changes speed, not the displayed position');
    view.frame(1000 / 60); view.reactions();
    assert.ok(view.playerPosition() > previous && view.playerPosition() <= previous + 1.15 / 60 + .001);
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});
test('sample atrasado após watchdog retoma a mesma reprodução sem voltar o cursor', () => {
  const view = harness({ nativeSharedValues: true, nativeWorklets: true });
  try {
    beginPlayback(view, 0);
    for (let frame = 0; frame < 20; frame++) playbackFrame(view);
    const stalled = view.playerPosition();
    assert.ok(Math.abs(stalled - .12) < .001);
    view.update({ position: 1 / 15 }); view.flushUI(); settlePlaybackSample(view);
    assert.equal(view.playerPosition(), stalled, 'a still-progressive native sample cannot become a backward seek');
    const moves = playbackFrame(view);
    assert.equal(moves.length, 1);
    assert.ok(view.playerPosition() > stalled && view.playerPosition() < stalled + 1.15 / 60 + .001);
    const resumed = view.playerPosition();
    view.update({ position: .01 }); view.flushUI(); settlePlaybackSample(view);
    assert.equal(view.playerPosition(), resumed, 'out-of-order samples from the same playback run are ignored');
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});
test('drift de mais de250ms durante Play nunca causa os recuos periódicos da gravação', () => {
  const view = harness({ nativeSharedValues: true, nativeWorklets: true });
  try {
    beginPlayback(view, 0);
    let previous = 0;
    for (let frame = 0; frame < 180; frame++) {
      if (frame && frame % 4 === 0) {
        view.update({ position: Math.max(0, frame / 60 - .35) });
        view.flushUI(); view.reactions();
        assert.ok(view.playerPosition() >= previous, 'delivery of a late progressing sample cannot rewind');
      }
      playbackFrame(view);
      const position = view.playerPosition();
      assert.ok(position >= previous, `display frame${frame} cannot rewind`);
      assert.ok(position - previous <= 1.15 / 60 + .001, `display frame${frame} cannot jump to a new sample`);
      previous = position;
    }
    assert.ok(previous > 2.6 && previous < 3.01);
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});
test('canal nativo mantém a timeline fluida mesmo com React e fila JS sem atualizar por2s', () => {
  const channel = { value: { active: true, sequence: 1, position: 1, playing: true, loading: false } };
  const view = harness({ nativeSharedValues: true, nativeWorklets: true, playbackChannel: channel });
  try {
    view.reactions();
    let previous = view.playerPosition();
    for (let frame = 0; frame < 120; frame++) {
      if (frame && frame % 4 === 0) {
        channel.value = { ...channel.value, sequence: channel.value.sequence + 1, position: 1 + frame / 60 };
        view.reactions();
      }
      view.frame(1000 / 60); // No JS pump: native samples and motion stay on UI.
      const position = view.playerPosition();
      assert.ok(position > previous && position - previous <= 1.15 / 60 + .001);
      previous = position;
    }
    assert.ok(Math.abs(previous - 3) < .02);
    view.update({ position: 1.1, playing: false, loading: true }); view.flushUI(); view.reactions();
    assert.equal(view.playerPosition(), previous, 'an obsolete React copy cannot reset or pause the native display channel');
    view.frame(1000 / 60);
    assert.ok(view.playerPosition() > previous);
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});
test('canal nativo respeita pausa, loading e o destino protegido de um scrub', async () => {
  const channel = { value: { active: true, sequence: 1, position: 1, playing: true, loading: false } };
  const view = harness({ nativeSharedValues: true, nativeWorklets: true, playbackChannel: channel });
  const emit = patch => { channel.value = { ...channel.value, ...patch, sequence: channel.value.sequence + 1 }; view.reactions(); };
  try {
    view.reactions(); view.frame(1000 / 60);
    emit({ position: 1.1, playing: false }); const paused = view.playerPosition();
    view.frame(1000 / 60); assert.equal(view.playerPosition(), paused);
    emit({ playing: true, loading: true }); view.frame(1000 / 60); assert.equal(view.playerPosition(), paused);
    emit({ loading: false }); view.frame(1000 / 60); assert.ok(view.playerPosition() > paused);
    view.scroll().onBeginDrag(); view.flushJS(); view.flushUI();
    view.scroll().onEndDrag({ contentOffset: { x: 180 }, velocity: { x: 0 } }); await view.pump();
    assert.equal(view.playerPosition(), 3);
    emit({ position: 1.2, playing: true }); view.frame(1000 / 60); assert.equal(view.playerPosition(), 3);
    emit({ position: 3, playing: false }); emit({ position: 3.1, playing: true }); view.frame(1000 / 60);
    assert.ok(view.playerPosition() > 3.1 && view.playerPosition() < 3.14);
    assert.deepEqual(view.seeks, [3]);
    emit({ active: false }); const detached = view.playerPosition(); view.frame(1000 / 60);
    assert.equal(view.playerPosition(), detached, 'detaching the native view cannot leave its clock running');
  } finally { view.dispose(); }
});
test('pinça preserva sua âncora no fim e ignora playback antigo até confirmar o seek', async () => {
  const view = harness({ nativeSharedValues: true });
  try {
    beginPlayback(view); playbackFrame(view); const anchor = view.playerPosition();
    view.pinch().onStart(); view.flushJS(); view.flushUI(); view.pinch().onUpdate({ scale: 2 }); view.flushJS(); view.flushUI();
    view.update({ position: 1.5, playing: true }); view.flushUI(); view.scrolls.length = 0;
    playbackFrame(view, 100); assert.deepEqual(view.scrolls, [], 'samples cannot move a pinch-controlled strip');
    view.pinch().onFinalize(); await view.pump(); settlePlaybackSample(view);
    assert.equal(view.playerPosition(), anchor); assert.ok(Math.abs(view.seeks.at(-1) - anchor) < .002);
    const count = view.seeks.length; view.update({ position: 1.7 }); view.flushUI(); view.reactions(); view.scrolls.length = 0;
    playbackFrame(view); assert.equal(view.playerPosition(), anchor); assert.deepEqual(view.scrolls, []);
    view.update({ position: anchor, playing: false }); view.flushUI(); settlePlaybackSample(view); view.update({ playing: true }); view.flushUI(); playbackFrame(view);
    assert.ok(view.playerPosition() > anchor && view.playerPosition() < anchor + .04); assert.equal(view.seeks.length, count);
  } finally { view.dispose(); }
});

for (const release of ['drag', 'momentum']) {
  const expectedSeeks = release === 'momentum' ? [2, 3] : [3];
  const releaseScrub = view => {
    if (release === 'momentum') {
      view.scroll().onEndDrag({ contentOffset: { x: 120 }, targetContentOffset: { x: 180 }, velocity: { x: .3 } });
      view.scroll().onMomentumBegin();
      view.scroll().onMomentumEnd({ contentOffset: { x: 180 } });
    } else {
      view.scroll().onEndDrag({ contentOffset: { x: 180 }, targetContentOffset: { x: 180 }, velocity: { x: 0 } });
    }
  };
  test(`ACK do seek antes do releaseUI de ${release} permite Playing posterior sem congelar o relógio`, () => {
    let view;
    const seeks = [];
    view = harness({ nativeSharedValues: true, nativeWorklets: true, onSeek: seconds => {
      assert.equal(view.m().phase.value, 6, 'seek acknowledgement can arrive before the release transaction');
      seeks.push(seconds);
      // The native acknowledgement causes a React sample while phase6 is
      // still active; its UI worklet is queued before finishScrub's release.
      view.update({ position: seconds, playing: false, loading: false });
    } });
    try {
      view.scroll().onBeginDrag(); view.flushJS(); view.flushUI();
      releaseScrub(view); view.flushJS(); view.flushUI();
      assert.equal(view.m().phase.value, 0);
      assert.equal(view.playerPosition(), 3);
      assert.deepEqual(seeks, expectedSeeks);
      settlePlaybackSample(view);
      // Batched JS delivery can first report Playing more than50ms later.
      // An already confirmed seek must not require its exact time again.
      view.update({ position: 3.1, playing: true }); view.flushUI();
      playbackFrame(view);
      assert.ok(view.playerPosition() > 3.1 && view.playerPosition() < 3.14);
      const previous = view.playerPosition();
      view.update({ position: 3.2 }); view.flushUI(); playbackFrame(view);
      assert.ok(view.playerPosition() > previous && view.playerPosition() < 3.24, 'ordinary samples continue the smooth display clock');
      assert.deepEqual(seeks, expectedSeeks, 'display frames never manufacture another seek');
    } finally { view.dispose(); }
  });
  test(`ACK após releaseUI de ${release} bloqueia sample antigo até confirmar o seek e então retoma`, () => {
    const view = harness({ nativeSharedValues: true, nativeWorklets: true });
    try {
      view.scroll().onBeginDrag(); view.flushJS(); view.flushUI();
      releaseScrub(view); view.flushJS(); view.flushUI();
      assert.equal(view.m().phase.value, 0); assert.equal(view.playerPosition(), 3);
      assert.deepEqual(view.seeks, expectedSeeks); settlePlaybackSample(view);
      view.update({ position: 1.3, playing: true }); view.flushUI(); view.reactions();
      view.scrolls.length = 0; playbackFrame(view);
      assert.equal(view.playerPosition(), 3, 'an obsolete playing sample cannot rewind or start the clock');
      assert.deepEqual(view.scrolls, []);
      view.update({ position: 3, playing: false }); view.flushUI(); settlePlaybackSample(view);
      view.update({ position: 3.1, playing: true }); view.flushUI(); playbackFrame(view);
      assert.ok(view.playerPosition() > 3.1 && view.playerPosition() < 3.14);
      assert.deepEqual(view.seeks, expectedSeeks);
    } finally { view.dispose(); }
  });
}

for (const fps of [60, 120]) {
  test(`janela prepara a faixa adiante sem depender do feedback de scroll em ${fps}Hz`, () => {
    const longTake = { ...take('a'), duration: 3600, start: 0, end: 3600 };
    const channel = { value: { active: true, sequence: 1, position: 50, playing: true, loading: false } };
    const view = harness({ nativeSharedValues: true, nativeWorklets: true, takes: [longTake], position: 50, playbackChannel: channel });
    try {
      view.reactions(); view.flushJS(); view.flushUI();
      for (let frame = 0; frame < fps * 3; frame++) {
        if (frame && frame % (fps / 15) === 0) {
          channel.value = { ...channel.value, sequence: channel.value.sequence + 1, position: 50 + frame / fps };
          view.reactions();
        }
        view.frame(1000 / fps);
        // UIKit does not emit a scroll event in this scenario. React only
        // prepares thumbnails; it has no role in animating the displayed strip.
        if (frame % Math.ceil(fps / 16) === 0) view.flushJS();
        const images = view.clipImages('a');
        const left = Math.min(...images.map(image => image.props.style.left));
        const right = Math.max(...images.map(image => image.props.style.left + image.props.style.width));
        const x = view.playerPosition() * 60;
        assert.ok(left <= x - 150, 'the full visible portion has mounted cover cells');
        assert.ok(right >= x + 150 + 48, 'the next cells already exist before they enter the viewport');
        assert.ok(images.length <= 17, 'an hour-long take keeps a bounded number of mounted thumbnails');
        assert.ok(images.every(image => image.props.source.uri === longTake.thumbnailUri), 'covers are available before native JPEG extraction finishes');
        assert.ok(Math.abs(view.m().offset.value - x) < .01, 'UI geometry uses the current display position without UIKit feedback');
      }
      assert.deepEqual(view.seeks, [], 'preparation is not a media seek');
    } finally { view.dispose(); }
  });
}

test('seek distante prepara régua, camadas e miniaturas, ignorando scroll antigo da reprodução', () => {
  const longTake = { ...take('a'), duration: 3600, start: 0, end: 3600 };
  const item = { id: 'future', kind: 'text', zIndex: 1, startTicks: 1001 * 120000, durationTicks: 2 * 120000 };
  const view = harness({ nativeSharedValues: true, nativeWorklets: true, takes: [longTake], layers: [item] });
  try {
    assert.equal(view.nodes('TimelineLayer').length, 0);
    view.update({ position: 1000 }); view.flushUI(); view.reactions(); view.flushJS();
    assert.equal(view.m().offset.value, 60000);
    assert.equal(view.nodes('TimelineLayer').length, 1, 'the upcoming overlay is prepared along with the main track');
    const images = view.clipImages('a');
    assert.ok(images[0].props.style.left <= 60000 - 150);
    assert.ok(images.at(-1).props.style.left + 48 >= 60000 + 150);
    const ticks = view.nodes('TimelineTick').map(node => node.props.tick.seconds);
    assert.ok(ticks.some(seconds => seconds >= 1000 && seconds <= 1002));
    view.scroll().onScroll({ contentOffset: { x: 60 } }); view.flushJS();
    assert.equal(view.m().offset.value, 60000, 'an obsolete programmatic scroll event cannot rewind the authoritative offset');
    view.scroll().onBeginDrag(); view.scroll().onScroll({ contentOffset: { x: 300 } });
    assert.equal(view.m().offset.value, 300, 'a new physical scrub takes ownership of the native offset');
  } finally { view.dispose(); }
});

// Exercise both production components with one channel. Loading the existing
// controlled adapter harness in memory preserves real useEvent/Fabric handling
// without modifying that harness or substituting the adapter's decisions.
let compositionHarness;
function studioCompositionHarness() {
  if (compositionHarness) return compositionHarness;
  const location = new URL('./compositionPreview.test.mjs', import.meta.url);
  const prefix = readFileSync(location, 'utf8').split("test('")[0]
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(location.href));
  compositionHarness = new Function('assert', 'readFileSync', 'createRequire', 'dirname', 'join', 'fileURLToPath', 'transformFileSync', 'ts', 'model', `${prefix}\nreturn harness;`)(
    assert, readFileSync, createRequire, dirname, join, fileURLToPath, transformFileSync, ts, model);
  return compositionHarness;
}

function railFixture() {
  const base = manyLayerFixture();
  const editing = { ...base.editing, assets: [...base.editing.assets,
    { id: 'overlay-asset', kind: 'video', uri: 'file:///overlay.mp4', name: 'Overlay', durationTicks: model.studioTicks(10), width: 320, height: 180 }],
  layers: [...base.editing.layers, { id: 'video-lane', kind: 'video', items: [{ id: 'overlay-video', kind: 'video', assetId: 'overlay-asset', atTicks: model.studioTicks(1), durationTicks: model.studioTicks(3), sourceStartTicks: 0, sourceEndTicks: model.studioTicks(3) }] }] };
  return { editing, layers: model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.filter(item => item.zIndex > 0) };
}

test('controles de faixa mostram apenas visibilidade e áudio aplicáveis ao tipo real', () => {
  const view = harness({ ...railFixture(), onToggleLaneVisibility: () => {}, onToggleLaneMute: () => {}, onToggleMainMute: () => {} });
  try {
    for (const zIndex of [1, 2, 3, 5]) assert.ok(view.control(`Ocultar faixa ${zIndex}`));
    assert.equal(view.control('Ocultar faixa 4'), undefined, 'audio has no picture to hide');
    for (const zIndex of [4, 5]) assert.ok(view.control(`Silenciar áudio da faixa ${zIndex}`));
    for (const zIndex of [1, 2, 3]) assert.equal(view.control(`Silenciar áudio da faixa ${zIndex}`), undefined);
    assert.ok(view.control('Silenciar áudio principal')); assert.equal(view.control('Ocultar faixa 0'), undefined);
    const button = view.control('Ocultar faixa 5');
    assert.equal(resolveStyle(button.style({ pressed: false })).width, 44);
    assert.equal(resolveStyle(button.style({ pressed: false })).height, 44);
    assert.equal(button.children.props.size, 18);
    assert.equal(view.railNode('studio-lane-controls').props.pointerEvents, 'box-none');
    assert.equal(view.railNode('studio-lane-controls').props.children[0].props.pointerEvents, 'none');
  } finally { view.dispose(); }
});

test('rail fica em x0 e acompanha scrollY fracionário no UI sem esperar React ou deslocar main', async () => {
  const view = harness({ ...railFixture(), nativeWorklets: true, nativeSharedValues: true,
    onToggleLaneVisibility: () => {}, onToggleLaneMute: () => {}, onToggleMainMute: () => {} });
  try {
    const mainTop = view.nodes('TimelineClip')[0].props.top, epoch = view.m().epoch.value;
    view.update({ position: 4 }); view.flushUI(); view.reactions(); view.flushJS();
    const x = view.m().offset.value;
    view.laneAxis().handlers.onStart(); view.laneScroll().onBeginDrag();
    view.laneScroll().onScroll({ contentOffset: { y: 70.5 } });
    const geometry = view.railGeometry();
    assert.equal(geometry.fixed.left, 0); assert.equal(geometry.fixed.top, 26);
    assert.equal(geometry.fixed.width, 88); assert.equal(geometry.fixed.height, 132);
    assert.deepEqual(geometry.content.transform, [{ translateY: -70.5 }]);
    assert.equal(geometry.main.left, 0); assert.equal(geometry.main.top, mainTop); assert.equal(geometry.main.height, 72);
    assert.equal(view.nodes('TimelineClip')[0].props.top, mainTop);
    assert.equal(view.m().offset.value, x); assert.equal(view.playerPosition(), 4); assert.equal(view.m().epoch.value, epoch);
    view.laneScroll().onEndDrag(); view.laneAxis().handlers.onFinalize(); await view.pump();
    assert.deepEqual(view.seeks, []); assert.deepEqual(view.selections, []);
    assert.equal(view.laneScrollProps().scrollEnabled, true); assert.equal(view.scrollProps().scrollEnabled, true);
  } finally { view.dispose(); }
});

test('ocultar grupo preserva ambos textos selecionáveis, tempo e faixa, e mostrar restaura valores', async () => {
  const fixture = railFixture();
  fixture.editing.layers[0] = { ...fixture.editing.layers[0], items: [
    model.createStudioTextItem({ id: 'title', content: 'Texto1', atTicks: model.studioTicks(1), durationTicks: model.studioTicks(1) }),
    { ...model.createStudioTextItem({ id: 'title2', content: 'Texto2', atTicks: model.studioTicks(2.2), durationTicks: model.studioTicks(1) }), opacity: .6 },
  ] };
  fixture.layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: fixture.editing }).clips.filter(item => item.zIndex > 0);
  const toggles = [], selections = [], scrubs = [];
  let view;
  view = harness({ ...fixture, selectedLayerId: 'title', onSelectLayer: id => selections.push(id), onScrubStart: () => scrubs.push(true),
    onToggleLaneVisibility: zIndex => {
      toggles.push(zIndex);
      const lane = fixture.editing.layers[zIndex - 1];
      fixture.editing = model.setStudioLayerHidden(fixture.editing, lane.id, !lane.hidden);
      fixture.layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: fixture.editing }).clips.filter(item => item.zIndex > 0);
      view.update(fixture);
    } });
  try {
    const mainTop = view.nodes('TimelineClip')[0].props.top, axis = view.laneAxis(), before = view.playerPosition();
    view.control('Ocultar faixa 1').onPress(); await view.pump();
    assert.deepEqual(toggles, [1]); assert.ok(view.control('Mostrar faixa 1'));
    const hidden = view.nodes('TimelineLayer').filter(node => node.props.item.zIndex === 1);
    assert.equal(hidden.length, 2); assert.ok(hidden.every(node => node.props.item.opacity === 0));
    const body = view.childLayer('title').props.children[0].props.children.props;
    assert.equal(body.disabled, false); assert.equal(resolveStyle(body.style).opacity, .35);
    assert.equal(body.accessibilityState.selected, true);
    body.onPress(); assert.deepEqual(selections, ['title']);
    assert.equal(view.nodes('TimelineClip')[0].props.top, mainTop); assert.equal(view.laneAxis(), axis);
    assert.equal(view.playerPosition(), before); assert.deepEqual(view.seeks, []); assert.deepEqual(scrubs, []);
    view.control('Mostrar faixa 1').onPress(); await view.pump();
    assert.deepEqual(toggles, [1, 1]);
    assert.deepEqual(view.nodes('TimelineLayer').filter(node => node.props.item.zIndex === 1).map(node => node.props.item.opacity), [1, .6]);
    assert.equal(resolveStyle(view.childLayer('title').props.children[0].props.children.props.style).opacity, 1);
  } finally { view.dispose(); }
});

test('silenciar vídeo, faixa de áudio e principal são ações independentes sem selecionar nem seek', async () => {
  const fixture = railFixture(), actions = [];
  let view;
  const refresh = () => { fixture.layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: fixture.editing }).clips.filter(item => item.zIndex > 0); view.update(fixture); };
  view = harness({ ...fixture, onToggleLaneVisibility: () => {},
    onToggleLaneMute: zIndex => { actions.push(['lane', zIndex]); const lane = fixture.editing.layers[zIndex - 1]; fixture.editing = model.setStudioLayerMuted(fixture.editing, lane.id, !lane.muted); refresh(); },
    onToggleMainMute: () => { actions.push(['main']); fixture.editing = model.setStudioMainMuted(fixture.editing, !fixture.editing.mainMuted); refresh(); } });
  try {
    view.control('Silenciar áudio da faixa 5').onPress(); await view.pump();
    assert.ok(view.control('Ativar áudio da faixa 5')); assert.ok(view.control('Ocultar faixa 5'));
    const video = view.nodes('TimelineLayer').find(node => node.props.item.id === 'overlay-video').props.item;
    assert.equal(video.gain, 0); assert.equal(video.opacity, 1);
    view.control('Silenciar áudio da faixa 4').onPress(); await view.pump();
    assert.ok(view.control('Ativar áudio da faixa 4')); assert.equal(view.control('Mostrar faixa 4'), undefined);
    view.control('Silenciar áudio principal').onPress(); await view.pump();
    assert.ok(view.control('Ativar áudio principal')); assert.equal(fixture.editing.mainMuted, true);
    assert.deepEqual(actions, [['lane', 5], ['lane', 4], ['main']]);
    assert.equal(view.playerPosition(), 1); assert.deepEqual(view.seeks, []); assert.deepEqual(view.selections, []);
  } finally { view.dispose(); }
});

test('ações em voo bloqueiam toque duplicado e voltam após erro sem interferir nos gestos', async () => {
  let finish;
  const calls = [];
  const view = harness({ ...railFixture(), onToggleLaneVisibility: zIndex => { calls.push(zIndex); return new Promise((_resolve, reject) => { finish = reject; }); }, onToggleMainMute: () => calls.push('main') });
  try {
    const press = view.control('Ocultar faixa 1').onPress;
    press(); press(); view.control('Silenciar áudio principal').onPress(); await view.pump();
    assert.deepEqual(calls, [1]); assert.equal(view.control('Ocultar faixa 1').disabled, true);
    assert.equal(view.laneScrollProps().scrollEnabled, true); assert.equal(view.scrollProps().scrollEnabled, true);
    finish(new Error('Falha de salvamento')); await view.pump();
    assert.equal(view.control('Ocultar faixa 1').disabled, false);
    view.control('Silenciar áudio principal').onPress(); await view.pump(); assert.deepEqual(calls, [1, 'main']);
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

for (const blockedBy of ['busy', 'locked', 'pinch', 'hold', 'scrollY', 'background', 'unmount']) test(`controle atrasado não altera faixa durante ${blockedBy}`, async () => {
  const calls = [];
  const fixture = railFixture();
  const view = harness({ ...fixture, nativeSharedValues: true, nativeWorklets: true, selectedLayerId: 'title', onMoveLayer: async () => {}, onToggleLaneVisibility: zIndex => calls.push(zIndex) });
  try {
    const stalePress = view.control('Ocultar faixa 1').onPress;
    if (blockedBy === 'busy' || blockedBy === 'locked') { view.update({ [blockedBy]: true }); await view.pump(); assert.equal(view.control('Ocultar faixa 1').disabled, true); }
    else if (blockedBy === 'pinch') view.pinch().onStart();
    else if (blockedBy === 'hold') view.childLayer('title').props.children[0].props.gesture.gestures[0].handlers.onStart({ absoluteX: 180, absoluteY: 50 });
    else if (blockedBy === 'scrollY') view.laneScroll().onBeginDrag();
    else if (blockedBy === 'background') { view.appState('inactive'); view.flushUI(); }
    else view.dispose();
    stalePress(); await view.pump(); assert.deepEqual(calls, []); assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('controle antigo de zIndex não afeta outra faixa depois de reorder', async () => {
  const calls = [], fixture = railFixture();
  const view = harness({ ...fixture, onToggleLaneVisibility: zIndex => calls.push(zIndex) });
  try {
    const stalePress = view.control('Ocultar faixa 1').onPress;
    fixture.editing = { ...fixture.editing, layers: [fixture.editing.layers[1], fixture.editing.layers[0], ...fixture.editing.layers.slice(2)] };
    fixture.layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: fixture.editing }).clips.filter(item => item.zIndex > 0);
    view.update(fixture); await view.pump(); stalePress(); await view.pump();
    assert.deepEqual(calls, []);
    view.control('Ocultar faixa 2').onPress(); await view.pump(); assert.deepEqual(calls, [2]);
  } finally { view.dispose(); }
});

test('callers existentes e previewOnly não ganham controles inativos', () => {
  for (const options of [{}, { previewOnly: true, onToggleLaneVisibility: () => {}, onToggleLaneMute: () => {}, onToggleMainMute: () => {} }]) {
    const view = harness({ ...railFixture(), ...options });
    try { assert.equal(view.railNode('studio-lane-controls'), undefined); assert.equal(view.railNode('studio-main-control'), undefined); }
    finally { view.dispose(); }
  }
});

for (const release of ['drag', 'momentum']) {
  test(`adapter real e Timeline preservam o seek de ${release} quando o token atual ainda publica a posição anterior`, async () => {
    const preview = studioCompositionHarness()({ playbackChannel: true, nativeRuntime: true });
    await preview.pump();
    preview.emit({ positionSeconds: 1, playing: false }); await preview.pump();
    let view;
    view = harness({ nativeSharedValues: true, nativeWorklets: true, playbackChannel: preview.channel,
      onScrubStart: () => { preview.ref.current.pause(); preview.flushUI(); view.reactions(); },
      onSeek: seconds => {
        preview.ref.current.seek(seconds);
        // The adapter's optimistic channel update precedes finishScrub's UI
        // release, exactly as independent native/JS queues permit on device.
        preview.flushUI(); view.reactions();
      },
    });
    try {
      view.reactions(); view.scroll().onBeginDrag(); view.flushJS(); view.flushUI();
      if (release === 'momentum') {
        view.scroll().onEndDrag({ contentOffset: { x: 120 }, targetContentOffset: { x: 180 }, velocity: { x: .3 } });
        view.scroll().onMomentumBegin(); view.scroll().onMomentumEnd({ contentOffset: { x: 180 } });
      } else view.scroll().onEndDrag({ contentOffset: { x: 180 }, targetContentOffset: { x: 180 }, velocity: { x: 0 } });
      await view.pump(); view.reactions();
      const command = preview.calls.at(-1);
      assert.equal(command.kind, 'seek'); assert.equal(command.args[1], 3);
      assert.equal(view.m().phase.value, 0); assert.equal(view.playerPosition(), 3);
      const token = command.args.at(-1);
      // StudioCompositionView.claim assigns commandToken before await seekPlayer.
      // A periodic callback can therefore have the new token and old currentTime.
      preview.emit({ positionSeconds: 1.2, playing: false, token }); view.reactions();
      assert.equal(view.playerPosition(), 3, 'an optimistic target is not permission for a pending native seek to rewind');
      assert.equal(preview.channel.value.position, 3, 'the adapter cannot publish an old getter under the new seek token');
      view.frame(1000 / 60); assert.equal(view.playerPosition(), 3);
      command.resolve(preview.state({ positionSeconds: 3, playing: false, token }));
      await preview.pump(); view.reactions();
      assert.equal(view.playerPosition(), 3);
      preview.ref.current.togglePlayback(); await preview.pump();
      preview.emit({ positionSeconds: 3.1, playing: true, token }); view.reactions();
      view.frame(1000 / 60);
      assert.ok(view.playerPosition() > 3.1 && view.playerPosition() < 3.14, 'the confirmed seek can resume normal display frames');
      assert.equal(preview.calls.length, release === 'momentum' ? 2 : 1, 'visual frames never issue extra native seeks');
    } finally { view.dispose(); preview.dispose(); preview.flushUI(); }
  });
}


for (const rate of [.25, 2, 4]) test(`callback nativo/Babel corta principal${rate}x em tempo da timeline, sem mover cursor`, async () => {
  const first = { ...take('a'), playbackRate: rate }, second = take('b'), saves = [];
  const view = harness({ nativeSharedValues: true, nativeWorklets: true, takes: [first, second],
    onTrimCommit: async range => saves.push(range) });
  try {
    const handle = view.pan('start');
    handle.onStart({ absoluteX: 150 }); view.flushJS(); view.flushUI();
    handle.onUpdate({ absoluteX: 180, translationX: 30 }); view.reactions(); view.flushJS(); view.flushUI();
    const width = resolveStyle(view.childClip('a').props.style).width;
    assert.ok(Math.abs(width - (6 / rate - .5) * 60) < 1e-6);
    assert.equal(view.m().playbackRate.value, rate); assert.equal(view.m().leading.value, .5);
    assert.equal(view.previews.at(-1).start, 2 + .5 * rate);
    handle.onEnd({ absoluteX: 180, translationX: 30 }, true); await view.pump(); view.flushUI();
    assert.equal(saves.length, 1); assert.equal(saves[0].start, 2 + .5 * rate);
    assert.equal(view.m().phase.value, 0); assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('filmstrip usa taxa da fonte nas amostras e largura da montagem, inclusive após corte', () => {
  const view = harness({ takes: [{ ...take('a'), playbackRate: 2 }, take('b')] });
  try {
    view.clipImages('a');
    const frames = view.filmstripRequests.at(-1);
    assert.equal(frames.take.playbackRate, 2); assert.equal(frames.samples[0].seconds, 2.8);
    assert.equal(resolveStyle(view.childClip('a').props.style).width, 180);
  } finally { view.dispose(); }
});

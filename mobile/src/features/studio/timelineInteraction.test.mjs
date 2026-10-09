import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformFileSync } from '@babel/core';
import ts from 'typescript';
import * as model from './model.ts';
import * as layout from './timelineLayout.ts';
import * as motionHelpers from './timelineMotion.ts';
import * as snapHelpers from './timelineSnap.ts';
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

// UI worklets and JS callbacks have independent queues. This executes the
// component's real handlers while allowing either side of a gesture race to
// arrive later, without asserting on source text or copying its decisions.
function harness(options = {}) {
  const nativeSharedValues = !!options.nativeSharedValues;
  let uiRuntime = false;
  const onUI = callback => (...args) => {
    const previous = uiRuntime; uiRuntime = true;
    try { return callback(...args); } finally { uiRuntime = previous; }
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
      return value => { if (String(name).startsWith('on')) handlers[name] = onUI(value); else target[name] = value; return chain; };
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
    'lucide-react-native': { ChevronDown: 'chevron-down', ChevronUp: 'chevron-up', Film: 'film', Mic: 'mic', Minus: 'minus', Plus: 'plus' },
    '@/theme/colors': { colors: {} }, './model': model, './timelineLayout': layout, './timelineMotion': motionHelpers,
    './useStudioFilmstrip': { useStudioFilmstrip: () => ({}) }, './layerTimelineInteraction': layerModule.exports, './timelineSnap': snapHelpers,
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
  const laneStatus = () => all(context('timeline').tree, node => node.props?.accessibilityLiveRegion === 'polite')[0]?.props.accessibilityValue?.text;
  const scroll = () => all(context('timeline').tree, node => node.type === 'animated-scroll')[0].props.onScroll;
  const scrollProps = () => all(context('timeline').tree, node => node.type === 'animated-scroll')[0].props.animatedProps.__props();
  const pinch = () => context('timeline').tree.props.gesture.handlers;
  const m = () => (nodes('TrimHandle')[0] || nodes('TimelineClip')[0]).props.motion;
  const pan = edge => {
    const node = nodes('TrimHandle').find(item => item.props.edge === edge);
    assert.ok(node, 'selected trim handle expected');
    return render(`handle-${edge}`, node.type, node.props).props.gesture.handlers;
  };
  const childClip = id => {
    const node = nodes('TimelineClip').find(item => item.props.segment.take.id === id);
    return render(`clip-${id}`, node.type, node.props);
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
  const animate = () => {
    now += 64;
    for (const scope of contexts.values()) for (const reaction of scope.reactions) {
      const next = reaction.prepare(); const signature = JSON.stringify(next);
      if (signature !== reaction.signature) { const previous = reaction.previous; reaction.previous = next; reaction.signature = signature; reaction.react(next, previous); }
    }
  };
  const frame = (elapsed = 16) => {
    now += elapsed;
    for (const scope of contexts.values()) for (const callback of scope.frames) callback.current({ timeSincePreviousFrame: elapsed });
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
  if (nativeSharedValues) flushUI();
  all(context('timeline').tree, node => node.type === 'animated-view' && node.props?.onLayout)[0].props.onLayout({ nativeEvent: { layout: { width: 300 } } });
  renderParent(); if (nativeSharedValues) flushUI();
  scroll().onScroll({ contentOffset: { x: 60 } }); flushJS(); animate(); flushJS(); scrolls.length = 0;
  return { scroll, scrollProps, pinch, m, pan, childClip, childLayer, snapGuide, nodes, control, laneStatus, seeks, selections, previews, commits, cancellations, scrolls, jsQueue, uiQueue,
    animate, frame, flushJS, flushUI, stepJS, pump,
    playerPosition: () => context('timeline').reactions[0].prepare().position,
    update: next => { props = { ...props, ...next }; renderParent(); },
    appState: state => { for (const callback of appStateListeners) callback(state); if (context('timeline').dirty) renderParent(); },
    completeCommit: () => { assert.ok(commitResolver); commitResolver(); },
    dispose: () => { for (const scope of contexts.values()) for (const slot of scope.slots) slot?.cleanup?.(); } };
}

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

test('paginar faixas alcança áudio4 sem seek e conserva janela ao selecionar e fechar', async () => {
  const fixture = manyLayerFixture(), selections = [];
  const view = harness({ ...fixture, activeTakeId: undefined, onSelectLayer: id => selections.push(id), onLayerTrimCommit: async () => {} });
  try {
    assert.equal(view.laneStatus(), 'Faixas 1–3 de 4');
    assert.equal(view.control('Faixas anteriores').disabled, true);
    assert.equal(view.control('Próximas faixas').disabled, false);
    view.control('Próximas faixas').onPress(); await view.pump();
    assert.equal(view.laneStatus(), 'Faixas 2–4 de 4');
    assert.equal(view.control('Próximas faixas').disabled, true);
    const audio = view.childLayer('voice');
    audio.props.children[0].props.children.props.onPress();
    assert.deepEqual(selections, ['voice']);
    view.update({ selectedLayerId: 'voice' }); await view.pump();
    assert.equal(view.childLayer('voice').props.children[1].length, 2, 'audio is selectable and its trim handles are reachable');
    assert.equal(view.laneStatus(), 'Faixas 2–4 de 4');
    view.update({ selectedLayerId: undefined }); await view.pump();
    assert.equal(view.laneStatus(), 'Faixas 2–4 de 4', 'closing the selection does not hide the audio lane');
    assert.ok(view.childLayer('voice'));
    view.control('Faixas anteriores').onPress(); await view.pump();
    assert.equal(view.laneStatus(), 'Faixas 1–3 de 4');
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

test('seleção visível não pula de linha; seleção externa revela faixa e ordem temporal não reordena rows', async () => {
  const fixture = manyLayerFixture();
  const view = harness({ ...fixture, selectedLayerId: 'caption' });
  try {
    assert.equal(view.laneStatus(), 'Faixas 1–3 de 4', 'selecting the third visible lane must not move all rows');
    const top = view.nodes('TimelineLayer').find(node => node.props.item.id === 'caption').props.top;
    view.update({ layers: [...fixture.layers].reverse() }); await view.pump();
    assert.equal(view.nodes('TimelineLayer').find(node => node.props.item.id === 'caption').props.top, top);
    view.update({ selectedLayerId: 'voice' }); await view.pump();
    assert.equal(view.laneStatus(), 'Faixas 2–4 de 4'); assert.ok(view.childLayer('voice'));
    view.update({ selectedLayerId: 'title' }); await view.pump();
    assert.equal(view.laneStatus(), 'Faixas 1–3 de 4'); assert.ok(view.childLayer('title'));
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
  } finally { view.dispose(); }
});

for (const mode of ['move', 'end']) test(`paginação não troca a camada sob ${mode === 'move' ? 'hold' : 'alça'} ativo e respeita busy`, async () => {
  const fixture = manyLayerFixture();
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async () => {}, onLayerTrimCommit: async () => {} });
  try {
    const tree = view.childLayer('title');
    const pan = mode === 'move' ? tree.props.children[0].props.gesture.gestures[0].handlers : tree.props.children[1][1].props.gesture.handlers;
    pan.onStart({ absoluteX: 180 }); view.flushJS();
    view.control('Próximas faixas').onPress(); await view.pump();
    assert.equal(view.laneStatus(), 'Faixas 1–3 de 4'); assert.ok(view.childLayer('title'));
    pan.onFinalize({}, false); view.flushJS();
    view.update({ busy: true }); assert.equal(view.control('Próximas faixas').disabled, true);
    view.control('Próximas faixas').onPress(); await view.pump();
    assert.equal(view.laneStatus(), 'Faixas 1–3 de 4');
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('todas as sete faixas são alcançáveis; janela final permanece estável durante playback', async () => {
  const { editing: initial } = manyLayerFixture();
  const editing = { ...initial, layers: [...initial.layers, ...[5, 6, 7].map(index => ({
    id: `text-${index}`, kind: 'text', items: [model.createStudioTextItem({ id: `title-${index}`, atTicks: model.studioTicks(1), durationTicks: model.studioTicks(3) })],
  }))] };
  const layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.filter(clip => clip.zIndex > 0);
  const view = harness({ editing, layers });
  try {
    const reached = new Set(view.nodes('TimelineLayer').map(node => node.props.item.zIndex));
    view.control('Próximas faixas').onPress(); await view.pump();
    assert.equal(view.laneStatus(), 'Faixas 4–6 de 7');
    for (const node of view.nodes('TimelineLayer')) reached.add(node.props.item.zIndex);
    view.control('Próximas faixas').onPress(); await view.pump();
    assert.equal(view.laneStatus(), 'Faixas 5–7 de 7');
    for (const node of view.nodes('TimelineLayer')) reached.add(node.props.item.zIndex);
    assert.deepEqual([...reached].sort(), [1, 2, 3, 4, 5, 6, 7]);
    view.update({ position: 2 }); await view.pump();
    assert.equal(view.laneStatus(), 'Faixas 5–7 de 7');
    assert.equal(view.control('Próximas faixas').disabled, true);
    assert.deepEqual(view.seeks, []);
  } finally { view.dispose(); }
});

test('alça da camada desenha duração no UI, confirma uma vez e não desloca cursor nem faixa principal', async () => {
  const fixture = layerFixture(), previews = [], commits = []; let resolve;
  const view = harness({ ...fixture, selectedLayerId: 'title', onLayerTrimPreview: (id, range) => previews.push({ id, range }),
    onLayerTrimCommit: (id, range) => { commits.push({ id, range }); return new Promise(done => { resolve = done; }); } });
  try {
    const tree = view.childLayer('title'); const edge = tree.props.children[1][1]; const pan = edge.props.gesture.handlers;
    assert.ok(edge.props.children.props.style.width >= 32, 'touch surface is at least32pt');
    pan.onStart({ absoluteX: 180 }); view.flushJS();
    pan.onUpdate({ absoluteX: 240, translationX: 60 });
    assert.equal(tree.props.style.at(-1).__style().width - 56, 180, 'live width, no second ghost clip');
    assert.equal(view.childClip('a').props.style.at(-1).__style().width, 360);
    view.animate(); view.flushJS();
    pan.onEnd(); view.flushJS(); pan.onEnd(); view.flushJS();
    assert.deepEqual(commits, [{ id: 'title', range: { startSeconds: 1, endSeconds: 4 } }]);
    assert.deepEqual(view.seeks, []); assert.equal(view.playerPosition(), 1);
    const saved = layerModule.exports.applyStudioLayerTimelineRange(fixture.editing, 'title', commits[0].range);
    const layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: saved }).clips.filter(clip => clip.zIndex > 0);
    view.update({ editing: saved, layers }); const updated = view.childLayer('title');
    assert.equal(updated.props.style.at(-1).__style().width - 56, 180, 'saved props do not apply trim twice');
    resolve(); await view.pump();
    assert.equal(view.m().phase.value, 0); assert.equal(updated.props.style.at(-1).__style().width - 56, 180);
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
    assert.equal(tree.props.style.at(-1).__style().left + 28, 270);
    assert.equal(tree.props.style.at(-1).__style().width - 56, 120);
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
    assert.equal(body.blocksExternalGesture, node.props.nativeGesture);
    assert.equal(body.activateAfterLongPress, 220);
    for (const edge of tree.props.children[1]) assert.equal(edge.props.gesture.blocksExternalGesture, node.props.nativeGesture);
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
    assert.equal(tree.props.style.at(-1).__style().left + 28, 270);
    pan.onEnd(); pan.onEnd(); view.flushJS();
    assert.deepEqual(moves, [{ id: 'title', delta: 1, target: 2 }]);
    assert.deepEqual(lifecycle, ['start']);
    const reordered = model.moveStudioLayerItemToLane(fixture.editing, 'title', 2);
    const saved = layerModule.exports.applyStudioLayerTimelineRange(reordered, 'title', { startSeconds: 2, endSeconds: 4 }, 'move');
    view.update({ editing: saved, layers: model.compileStudioRecipe({ kind: 'aula', takes: [], editing: saved }).clips.filter(clip => clip.zIndex > 0) });
    const updated = view.childLayer('title'); resolve(); await view.pump();
    assert.equal(updated.props.style.at(-1).__style().top, top + 44);
    assert.equal(updated.props.style.at(-1).__style().left + 28, 270);
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
    view.frame(300); view.flushJS();
    assert.equal(view.laneStatus(), 'Faixas 2–4 de 4');
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
    assert.equal(tree.props.style.at(-1).__style().width - 56, 120);
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
    assert.equal(view.control('Aumentar zoom da timeline').disabled, false);
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
      assert.equal(view.control('Aumentar zoom da timeline').disabled, false);
      assert.equal(view.nodes('TrimHandle')[0].props.disabled, false);
      assert.equal(view.scrollProps().scrollEnabled, true); assert.deepEqual(view.seeks, []);
      // A new pinch is usable after returning to the foreground.
      view.appState('active'); const next = view.pinch(); next.onStart(); view.flushJS();
      assert.equal(view.m().phase.value, 4); assert.equal(view.control('Aumentar zoom da timeline').disabled, true);
      next.onFinalize({}, true); view.flushJS();
      assert.equal(view.control('Aumentar zoom da timeline').disabled, false);
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
    assert.equal(view.control('Aumentar zoom da timeline').disabled, false); assert.deepEqual(view.seeks, []);
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
    assert.equal(view.laneStatus(), 'Faixas 1–3 de 4');
    const action = view.childLayer('caption').props.children[0].props.children.props.onAccessibilityAction;
    view.flushUI(); action({ nativeEvent: { actionName: 'moveDown' } }); await view.pump();
    assert.equal(view.m().phase.value, 5);
    const editing = model.moveStudioLayerItemToLane(fixture.editing, 'caption', 4);
    const layers = model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.filter(clip => clip.zIndex > 0);
    view.update({ editing, layers }); view.flushJS(); view.childLayer('caption'); view.flushUI();
    resolve(); await view.pump(); view.flushUI(); view.flushJS();
    assert.equal(view.m().phase.value, 0);
    assert.equal(view.m().laneStart.value, 1, 'the selected lane must remain in the native window');
    assert.equal(view.laneStatus(), 'Faixas 2–4 de 4', 'React receives the computed window, not its stale SharedValue getter');
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
    assert.ok(layer.props.children[1].every(node => node.props.children.props.style.width >= 32));
    assert.equal(main.props.height, 72); assert.equal(view.childClip('a').props.children.length, 2, 'filmstrip and shade only; no permanent number/duration labels');
    assert.ok(view.control('Próximas faixas')); assert.ok(view.control('Aumentar zoom da timeline'));
  } finally { view.dispose(); }
});

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

test('snap de move preserva duração e END usa deslocamento final uma vez', async () => {
  const fixture = layerFixture(), moves = [];
  const view = harness({ ...fixture, selectedLayerId: 'title', onMoveLayer: async (_id, delta) => moves.push(delta) });
  try {
    const tree = view.childLayer('title'), pan = tree.props.children[0].props.gesture.gestures[0].handlers;
    pan.onStart({ absoluteX: 180, absoluteY: 45 }); view.flushJS();
    pan.onEnd({ absoluteX: 357, absoluteY: 45, translationX: 177, translationY: 0 }, true); await view.pump();
    assert.deepEqual(moves, [3], 'end of the 2s layer aligns to the main boundary at6s');
    assert.equal(tree.props.style.at(-1).__style().width - 56, 120, 'unchanged duration/source speed');
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
    view.frame(300); view.flushJS();
    assert.equal(view.laneStatus(), 'Faixas 2–4 de 4');
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

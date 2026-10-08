import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
import * as layout from './timelineLayout.ts';
import * as motionHelpers from './timelineMotion.ts';

const source = readFileSync(new URL('./StudioTimeline.tsx', import.meta.url), 'utf8');
const take = id => ({ id, uri: `file:///${id}.mp4`, name: id, duration: 10, start: 2, end: 8, thumbnailUri: `file:///${id}.jpg` });
const equalDependencies = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

// UI worklets and JS callbacks have independent queues. This executes the
// component's real handlers while allowing either side of a gesture race to
// arrive later, without asserting on source text or copying its decisions.
function harness(options = {}) {
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
      return value => { if (String(name).startsWith('on')) handlers[name] = value; else target[name] = value; return chain; };
    } });
    return chain;
  };
  const dynamic = callback => ({ get value() { return callback(); } });
  const reanimated = {
    __esModule: true,
    default: { View: 'animated-view', ScrollView: 'animated-scroll', createAnimatedComponent: type => `animated-${type}` },
    useSharedValue: value => hooks.useRef({ value }).current,
    useDerivedValue: callback => { const ref = hooks.useRef(callback); ref.current = callback; return dynamic(() => ref.current()); },
    useAnimatedRef: () => hooks.useRef(null),
    useAnimatedStyle: callback => { const ref = hooks.useRef(callback); ref.current = callback; return { __style: () => ref.current() }; },
    useAnimatedProps: callback => { const ref = hooks.useRef(callback); ref.current = callback; return { __props: () => ref.current() }; },
    useAnimatedReaction: (prepare, react) => {
      const ref = hooks.useRef({ prepare, react, previous: undefined, signature: undefined });
      ref.current.prepare = prepare; ref.current.react = react; current.reactions.push(ref.current);
    },
    useAnimatedScrollHandler: handlers => { const ref = hooks.useRef(handlers); ref.current = handlers; return handlers; },
    useFrameCallback: callback => { const ref = hooks.useRef(callback); ref.current = callback; current.frames.push(ref); },
    runOnJS: callback => (...args) => jsQueue.push({ callback, args }),
    runOnUI: callback => (...args) => uiQueue.push({ callback, args }),
    scrollTo: (_, x, y, animated) => scrolls.push({ x, y, animated }),
    measure: () => ({ pageX: 0 }),
  };
  const dependencies = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Pressable: 'pressable', Text: 'text', View: 'view', StyleSheet: { create: styles => styles } },
    'expo-image': { Image: 'image' }, 'react-native-reanimated': reanimated,
    'react-native-gesture-handler': { GestureDetector: 'gesture-detector', Gesture: { Native: () => gesture('native'), Pinch: () => gesture('pinch'), Pan: () => gesture('pan') } },
    'lucide-react-native': { Film: 'film', Mic: 'mic', Minus: 'minus', Plus: 'plus' },
    '@/theme/colors': { colors: {} }, './model': model, './timelineLayout': layout, './timelineMotion': motionHelpers,
    './useStudioFilmstrip': { useStudioFilmstrip: () => ({}) },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'Date', compiled)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports, { now: () => now });
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
  const scroll = () => all(context('timeline').tree, node => node.type === 'animated-scroll')[0].props.onScroll;
  const m = () => nodes('TrimHandle')[0].props.motion;
  const pan = edge => {
    const node = nodes('TrimHandle').find(item => item.props.edge === edge);
    assert.ok(node, 'selected trim handle expected');
    return render(`handle-${edge}`, node.type, node.props).props.gesture.handlers;
  };
  const childClip = id => {
    const node = nodes('TimelineClip').find(item => item.props.segment.take.id === id);
    return render(`clip-${id}`, node.type, node.props);
  };
  const animate = () => {
    now += 64;
    for (const scope of contexts.values()) for (const reaction of scope.reactions) {
      const next = reaction.prepare(); const signature = JSON.stringify(next);
      if (signature !== reaction.signature) { const previous = reaction.previous; reaction.previous = next; reaction.signature = signature; reaction.react(next, previous); }
    }
  };
  const flushJS = () => {
    while (jsQueue.length) { const job = jsQueue.shift(); job.callback(...job.args); }
    if (context('timeline').dirty) renderParent();
  };
  const flushUI = () => { while (uiQueue.length) { const job = uiQueue.shift(); job.callback(...job.args); } };
  const stepJS = () => { assert.ok(jsQueue.length); const job = jsQueue.shift(); job.callback(...job.args); };
  const pump = async () => {
    flushJS(); flushUI();
    await new Promise(resolve => setImmediate(resolve));
    if (context('timeline').dirty) renderParent();
  };
  renderParent();
  all(context('timeline').tree, node => node.type === 'animated-view' && node.props?.onLayout)[0].props.onLayout({ nativeEvent: { layout: { width: 300 } } });
  renderParent();
  scroll().onScroll({ contentOffset: { x: 60 } }); flushJS(); animate(); flushJS(); scrolls.length = 0;
  return { scroll, m, pan, childClip, nodes, seeks, selections, previews, commits, cancellations, scrolls, jsQueue, uiQueue,
    animate, flushJS, flushUI, stepJS, pump,
    playerPosition: () => context('timeline').reactions[0].prepare().position,
    update: next => { props = { ...props, ...next }; renderParent(); },
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

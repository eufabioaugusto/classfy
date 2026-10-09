import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import babel from '@babel/core';
import * as geometry from './canvasGeometry.ts';
import { initialStudioCanvasTransformChannel } from './canvasTransformChannel.ts';
import { emptyStudioEditing, addStudioLayerItem, createStudioTextItem, compileStudioRecipe, patchStudioLayerItem, studioTicks } from './model.ts';

const source = readFileSync(new URL('./StudioCanvasEditor.tsx', import.meta.url), 'utf8');
const workletSource = babel.transformSync(source, { filename: fileURLToPath(new URL('./StudioCanvasEditor.tsx', import.meta.url)), configFile: false, babelrc: false,
  plugins: [['@babel/plugin-transform-typescript', { isTSX: true }], 'react-native-worklets/plugin'] }).code;
const equal = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function harness(options = {}) {
  let editing = emptyStudioEditing('aula');
  editing.assets.push({ id: 'source', kind: 'video', uri: 'file:///original.mov', name: 'Original', durationTicks: studioTicks(4) });
  editing.main.push({ id: 'main', assetId: 'source', sourceStartTicks: 0, sourceEndTicks: studioTicks(4), ...(options.mainRect ? { rect: options.mainRect } : {}) });
  let item = { ...createStudioTextItem({ id: 'title', content: 'Texto real', durationTicks: studioTicks(2) }),
    rect: options.rect ?? { x: 0.3, y: 0.3, width: 0.4, height: 0.2 }, rotationDegrees: options.rotation ?? 0 };
  if (options.kind === 'image' || options.kind === 'video') {
    editing.assets.push({ id: 'layer-source', kind: options.kind, uri: `file:///layer.${options.kind === 'image' ? 'jpg' : 'mov'}`, name: 'Original da camada',
      durationTicks: options.kind === 'image' ? 0 : studioTicks(2) });
    item = { ...item, kind: options.kind, assetId: 'layer-source', text: undefined,
      ...(options.kind === 'video' ? { sourceStartTicks: 0, sourceEndTicks: studioTicks(2) } : {}) };
  }
  editing = addStudioLayerItem(editing, item);
  const contexts = new Map(), queue = [], uiQueue = [], selections = [], previews = [], commits = [], events = [], edits = [], playback = [], feedback = [], appStateListeners = new Set();
  let current, now = 1000, resolveCommit;
  let runtime = 'js';
  const onUI = callback => (...args) => { const before = runtime; runtime = 'ui'; try { return callback(...args); } finally { runtime = before; } };
  const shared = initial => {
    let value = initial;
    return { get value() { return value; }, set value(next) { if (options.asyncShared && runtime === 'js') uiQueue.push(() => { value = next; }); else value = next; } };
  };
  const transformChannel = options.interactive ? shared({ ...initialStudioCanvasTransformChannel(), available: options.ready !== false }) : undefined;
  const scope = id => { if (!contexts.has(id)) contexts.set(id, { slots: [], cursor: 0, effects: [] }); return contexts.get(id); };
  const hooks = {
    useRef: initial => { const index = current.cursor++; return current.slots[index] ||= { current: initial }; },
    useState: initial => {
      const context = current, index = context.cursor++;
      if (!context.slots[index]) context.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [context.slots[index].value, next => { context.slots[index].value = typeof next === 'function' ? next(context.slots[index].value) : next; }];
    },
    useMemo: (create, dependencies) => {
      const index = current.cursor++;
      if (!current.slots[index] || !equal(current.slots[index].dependencies, dependencies)) current.slots[index] = { value: create(), dependencies };
      return current.slots[index].value;
    },
    useEffect: (callback, dependencies) => {
      const index = current.cursor++;
      if (!current.slots[index] || !equal(current.slots[index].dependencies, dependencies)) current.effects.push({ index, callback, dependencies });
    },
  };
  const gesture = kind => {
    const handlers = {}, configuration = {};
    const chain = new Proxy({ kind, handlers, configuration }, { get: (target, property) => {
      if (property in target) return target[property];
      return (...args) => { if (String(property).startsWith('on')) handlers[property] = options.asyncShared ? Object.assign(onUI(args[0]), args[0]) : args[0]; else configuration[property] = args[0]; return chain; };
    } });
    return chain;
  };
  const dependencies = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'view', Text: 'text', StyleSheet: { create: value => value, absoluteFill: {}, absoluteFillObject: {} },
      AppState: { currentState: 'active', addEventListener: (_, callback) => { appStateListeners.add(callback); return { remove: () => appStateListeners.delete(callback) }; } } },
    'react-native-reanimated': { __esModule: true, default: { View: 'animated-view' }, useSharedValue: value => hooks.useRef(shared(value)).current,
      useAnimatedStyle: callback => { const ref = hooks.useRef(callback); ref.current = callback; return { getStyle: () => ref.current() }; },
      runOnJS: callback => (...args) => queue.push(() => callback(...args)),
      runOnUI: callback => (...args) => { if (options.asyncShared) uiQueue.push(() => onUI(callback)(...args)); else return onUI(callback)(...args); } },
    'react-native-gesture-handler': { GestureDetector: 'detector', Gesture: {
      Pan: () => gesture('pan'), Pinch: () => gesture('pinch'), Tap: () => gesture('tap'),
      Race: (...items) => ({ kind: 'race', items }), Simultaneous: (...items) => ({ kind: 'simultaneous', items }), Exclusive: (...items) => ({ kind: 'exclusive', items }),
    } },
    './canvasGeometry': geometry,
    './snapFeedback': { performStudioSnapFeedback: () => feedback.push(now) },
    '../../../modules/classfy-studio-media': { isStudioInteractiveCompositionAvailable: () => options.native !== false },
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(options.worklets ? workletSource : source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', 'Date', '__DEV__', compiled)(name => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports, { now: () => now }, false);
  let props = { editing, recipe: compileStudioRecipe({ kind: 'aula', takes: [], editing }), positionSeconds: 1, selectedLayerId: 'title', canvasTransformChannel: transformChannel,
    onSelectLayer: id => selections.push(id), onPreviewRect: (id, transform) => previews.push({ id, transform }),
    onCommitRect: (id, transform) => { commits.push({ id, transform }); if (options.deferred) return new Promise(resolve => { resolveCommit = resolve; }); if (options.fail) return Promise.reject(new Error('Disco indisponível')); },
    onInteractionStart: () => events.push('start'), onInteractionEnd: () => events.push('end'),
    onEditText: id => edits.push(id), onCanvasPress: () => playback.push(true), ...options.props };
  const render = (id, component, componentProps) => {
    const context = scope(id), previous = current; current = context; context.cursor = 0; context.effects = [];
    context.tree = component(componentProps);
    for (const effect of context.effects) { context.slots[effect.index]?.cleanup?.(); context.slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() }; }
    current = previous; return context.tree;
  };
  const findAll = (node, predicate) => {
    const matches = [];
    const visit = item => { if (Array.isArray(item)) { item.forEach(visit); return; } if (!item || typeof item !== 'object') return; if (predicate(item)) matches.push(item); visit(item.props?.children); };
    visit(node); return matches;
  };
  const draw = () => {
    const parent = render('root', module.exports.StudioCanvasEditor, props);
    const nodes = findAll(parent, node => typeof node.type === 'function' && node.type.name === 'CanvasLayer');
    const active = new Set(nodes.map(node => node.props.clip.id));
    const guide = findAll(parent, node => typeof node.type === 'function' && node.type.name === 'CanvasCenterGuides')[0];
    if (guide) active.add('guides');
    for (const [id, context] of contexts) if (id !== 'root' && !active.has(id)) { for (const slot of context.slots) slot?.cleanup?.(); contexts.delete(id); }
    for (const node of nodes) render(node.props.clip.id, node.type, node.props);
    if (guide) render('guides', guide.type, guide.props);
    return parent;
  };
  const flatten = value => Array.isArray(value.items) ? value.items.flatMap(flatten) : [value];
  const bodyDetector = (id = 'title') => findAll(scope(id).tree, node => node.type === 'detector')[0];
  const canvasDetector = () => findAll(scope('root').tree, node => node.type === 'detector')[0];
  const body = (id = 'title') => [...flatten(bodyDetector(id).props.gesture), ...flatten(canvasDetector().props.gesture).filter(gesture => gesture.configuration?.enabled !== false)];
  const getGesture = (kind, id = 'title', double = false) => body(id).find(value => value.kind === kind && (kind !== 'tap' || (value.configuration.numberOfTaps === 2) === double));
  const flush = () => { while (queue.length) queue.shift()(); };
  const flushUI = () => { while (uiQueue.length) uiQueue.shift()(); };
  const pump = async () => { flushUI(); flush(); await new Promise(resolve => setImmediate(resolve)); flushUI(); flush(); draw(); flushUI(); flush(); draw(); flushUI(); flush(); };
  draw(); scope('root').tree.props.onLayout({ nativeEvent: { layout: { width: 320, height: 300 } } }); draw(); flushUI(); flush(); draw(); flushUI(); flush();
  return { selections, previews, commits, events, edits, playback, feedback, queue, uiQueue, getGesture, body, flush, flushUI, pump, transformChannel,
    accessibility: (action, id = 'title') => bodyDetector(id).props.children.props.onAccessibilityAction({ nativeEvent: { actionName: action } }),
    canvasDetector, backgroundTap: () => findAll(scope('root').tree, node => node.type === 'detector')[1].props.gesture,
    update: next => { props = { ...props, ...next }; draw(); draw(); },
    layout: (width, height) => { scope('root').tree.props.onLayout({ nativeEvent: { layout: { width, height } } }); draw(); },
    echo: transform => { const next = patchStudioLayerItem(props.editing, 'title', { rect: transform.rect, ...(transform.textFontSize ? { text: { fontSize: transform.textFontSize } } : {}) }); props = { ...props, editing: next, recipe: compileStudioRecipe({ kind: 'aula', takes: [], editing: next }) }; draw(); },
    setNow: value => { now = value; },
    handle: (index, id = 'title') => findAll(scope(id).tree, node => typeof node.type === 'function' && node.type.name === 'CanvasCornerHandle')[index].props.gesture,
    frame: id => bodyDetector(id).props.children.props.style.find(value => value?.getStyle)?.getStyle(),
    guides: () => findAll(scope('guides').tree, node => node.type === 'animated-view').map(node => Object.assign({}, ...node.props.style.map(value => value.getStyle ? value.getStyle() : value))),
    tree: id => scope(id || 'title').tree,
    cornerView: (index, id = 'title') => {
      const node = findAll(scope(id).tree, item => typeof item.type === 'function' && item.type.name === 'CanvasCornerHandle')[index];
      // A separate hook scope models the always-mounted sibling native target.
      return render(`handle-${id}-${index}`, node.type, node.props);
    },
    changeAppState: state => { for (const callback of appStateListeners) callback(state); },
    visibleIds: () => [...contexts.keys()].filter(id => id !== 'root' && id !== 'guides'),
    editing: () => props.editing,
    recipe: () => props.recipe,
    resolve: () => { assert.ok(resolveCommit); resolveCommit(); },
    dispose: () => { for (const context of contexts.values()) for (const slot of context.slots) slot?.cleanup?.(); },
  };
}

// Exercise touch qualification before invoking the actual component callbacks.
// RNGH 2.28's iOS recognizer fails a pending long-press pan after >10pt of
// movement, and resets translation when an ordinary distance pan activates.
// Calling onStart directly would conceal that failure in the selected main.
function nativeBodyDrag(view, id, moves, cancel = false) {
  const pan = view.getGesture('pan', id);
  let failed = false, activated = false, origin = { x: 0, y: 0 };
  pan.handlers.onTouchesDown({}, { fail: () => { failed = true; } });
  for (const move of moves) {
    view.setNow(1000 + move.elapsed);
    if (failed) break;
    if (!activated) {
      const hold = pan.configuration.activateAfterLongPress;
      if (hold !== undefined && move.elapsed < hold && Math.hypot(move.x, move.y) > 10) { failed = true; break; }
      if (hold !== undefined ? move.elapsed < hold : Math.hypot(move.x, move.y) < (pan.configuration.minDistance ?? 0)) continue;
      activated = true; origin = move;
      pan.handlers.onStart({ translationX: 0, translationY: 0 }); view.flush();
    }
    pan.handlers.onUpdate({ translationX: move.x - origin.x, translationY: move.y - origin.y }); view.flush();
  }
  if (activated) {
    const last = moves.at(-1);
    if (cancel) pan.handlers.onTouchesCancelled({});
    else pan.handlers.onEnd({ translationX: last.x - origin.x, translationY: last.y - origin.y }, true);
  }
  pan.handlers.onFinalize({}, activated && !cancel);
  return activated;
}

test('tap seleciona sem alterar tempo, iniciar interação ou salvar; double tap abre texto', () => {
  const view = harness({ props: { selectedLayerId: undefined } });
  try {
    view.getGesture('tap').handlers.onEnd({}, true); view.flush();
    assert.deepEqual(view.selections, ['title']); assert.deepEqual(view.previews, []); assert.deepEqual(view.commits, []); assert.deepEqual(view.events, []);
    view.getGesture('tap', 'title', true).handlers.onEnd({}, true); view.flush(); assert.deepEqual(view.edits, ['title']);
    assert.deepEqual(view.selections, ['title']); // The generic edit callback owns selection and draft flushing.
  } finally { view.dispose(); }
});

test('pan ignora o eco das props, limita previews e salva somente a posição final do gesto', async () => {
  const view = harness();
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 32, translationY: 18 }); view.flush();
    view.echo({ rect: { x: 0.8, y: 0.8, width: 0.4, height: 0.2 }, textFontSize: 0.1 });
    assert.equal(view.getGesture('pan'), pan);
    view.setNow(1020); pan.handlers.onUpdate({ translationX: 64, translationY: 36 }); view.flush();
    assert.equal(view.previews.length, 1);
    pan.handlers.onEnd({ translationX: 96, translationY: 54 }); pan.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); near(view.commits[0].transform.rect.x, 0.6); near(view.commits[0].transform.rect.y, 0.6);
    assert.notEqual(view.commits[0].transform.textFontSize, 0.1);
    assert.deepEqual(view.events, ['start', 'end']); assert.equal(view.previews.at(-1).transform, undefined);
  } finally { view.dispose(); }
});

test('pan e pinch simultâneos compartilham uma transação e escala de texto sem salto ao soltar dedo', async () => {
  const view = harness();
  try {
    const pan = view.getGesture('pan'), pinch = view.getGesture('pinch');
    pan.handlers.onStart(); view.flush(); pan.handlers.onUpdate({ translationX: 10, translationY: 0 });
    pinch.handlers.onStart(); pan.handlers.onUpdate({ translationX: 20, translationY: 0 }); pinch.handlers.onUpdate({ scale: 1.5 });
    pinch.handlers.onEnd({ scale: 1.5 }); pinch.handlers.onFinalize({}, true);
    assert.equal(view.commits.length, 0);
    pan.handlers.onUpdate({ translationX: 25, translationY: 0 }); pan.handlers.onEnd({ translationX: 25, translationY: 0 }); pan.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); near(view.commits[0].transform.rect.width, 0.6);
    near(view.commits[0].transform.rect.x + 0.3, 0.5 + 15 / 320);
    assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('cancelamento do gesto restaura o frame e nunca commita', async () => {
  const view = harness();
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush(); pan.handlers.onUpdate({ translationX: 50, translationY: 0 }); view.flush();
    pan.handlers.onFinalize({}, false); await view.pump();
    assert.deepEqual(view.commits, []); assert.equal(view.previews.at(-1).transform, undefined); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('mudança externa de seleção invalida callbacks UI/JS já enfileirados', async () => {
  const view = harness();
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); pan.handlers.onUpdate({ translationX: 100, translationY: 0 });
    view.update({ selectedLayerId: undefined }); view.flush();
    pan.handlers.onEnd({ translationX: 100, translationY: 0 }); pan.handlers.onFinalize({}, true); await view.pump();
    assert.deepEqual(view.commits, []); assert.deepEqual(view.previews, []); assert.deepEqual(view.events, []);
  } finally { view.dispose(); }
});

test('bloqueio externo encerra interação uma vez e não deixa callback tardio reabrir draft', async () => {
  const view = harness();
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush(); pan.handlers.onUpdate({ translationX: 50, translationY: 0 }); view.flush();
    view.update({ disabled: true }); pan.handlers.onUpdate({ translationX: 80, translationY: 0 }); pan.handlers.onFinalize({}, true); await view.pump();
    assert.deepEqual(view.commits, []); assert.equal(view.previews.at(-1).transform, undefined); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('uma escrita pendente impede segunda transação e libera somente ao resolver', async () => {
  const view = harness({ deferred: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush(); pan.handlers.onEnd({ translationX: 40, translationY: 0 }); pan.handlers.onFinalize({}, true); view.flush();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start']);
    pan.handlers.onStart(); pan.handlers.onUpdate({ translationX: 60, translationY: 0 }); pan.handlers.onFinalize({}, true); view.flush();
    assert.equal(view.commits.length, 1); view.resolve(); await view.pump(); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('alça salva escala uniforme e fontSize final, mesmo sem último evento update', async () => {
  const view = harness();
  try {
    const handle = view.handle(3); handle.handlers.onStart(); view.flush();
    handle.handlers.onEnd({ translationX: 64, translationY: 18 }); handle.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); near(view.commits[0].transform.rect.width, 0.6);
    assert.ok(view.commits[0].transform.textFontSize > 0); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('camada fora do tempo não cria área falsa; tap no principal selecionado não muda playback', () => {
  const view = harness();
  try {
    view.update({ positionSeconds: 3 }); assert.deepEqual(view.visibleIds(), []);
    view.update({ selectedMainClipId: 'main', onSelectMainClip: id => view.selections.push(id) });
    assert.deepEqual(view.visibleIds(), ['main']);
    view.getGesture('tap', 'main').handlers.onEnd({}, true); view.flush(); assert.equal(view.playback.length, 0); assert.deepEqual(view.selections, ['main']);
    assert.equal(view.getGesture('pan', 'main').configuration.activateAfterLongPress, undefined);
  } finally { view.dispose(); }
});

test('pinça no ancestral fixo mantém o ponto do canvas enquanto o item escala', async () => {
  const view = harness();
  try {
    const pinch = view.getGesture('pinch'); pinch.handlers.onStart({ focalX: 128, focalY: 63, numberOfPointers: 2 }); view.flush();
    pinch.handlers.onUpdate({ scale: 1.2, focalX: 128, focalY: 63, numberOfPointers: 2 }); view.flush();
    pinch.handlers.onEnd({ scale: 1.5, focalX: 128, focalY: 63, numberOfPointers: 2 }); pinch.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); const { rect } = view.commits[0].transform;
    near(rect.x * 320 + 32 * 1.5, 0.3 * 320 + 32);
    near(rect.y * 180 + 9 * 1.5, 0.3 * 180 + 9);
    near(rect.width, 0.6); near(rect.height, 0.3); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('pinça do principal mantém ponto tocado, sem seleção artificial ou playback', async () => {
  const view = harness({ props: { selectedLayerId: undefined, selectedMainClipId: 'main', onSelectMainClip: () => {} } });
  try {
    const pinch = view.getGesture('pinch', 'main'); pinch.handlers.onStart({ focalX: 64, focalY: 45, numberOfPointers: 2 }); view.flush();
    pinch.handlers.onEnd({ scale: 1.5, focalX: 64, focalY: 45, numberOfPointers: 2 }); pinch.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); const { rect } = view.commits[0].transform;
    near(rect.x * 320 + 64 * 1.5, 64); near(rect.y * 180 + 45 * 1.5, 45);
    assert.deepEqual(view.playback, []); assert.deepEqual(view.selections, []); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('rotação ou resize externo cancela operação e libera próxima interação', async () => {
  const view = harness();
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush(); pan.handlers.onUpdate({ translationX: 24, translationY: 0 }); view.flush();
    const recipe = structuredClone(view.recipe());
    recipe.clips.find(clip => clip.id === 'title').rotationDegrees = 15;
    view.update({ recipe }); pan.handlers.onFinalize({}, true); await view.pump();
    assert.deepEqual(view.commits, []); assert.deepEqual(view.events, ['start', 'end']);
    const next = view.getGesture('pan'); next.handlers.onStart(); view.flush(); next.handlers.onEnd({ translationX: 12, translationY: 0 }); next.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start', 'end', 'start', 'end']);
  } finally { view.dispose(); }
});

test('falha de escrita limpa preview temporário, encerra interação e permite tentar novamente', async () => {
  const view = harness({ fail: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush(); pan.handlers.onEnd({ translationX: 40, translationY: 0 }); pan.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start', 'end']); assert.equal(view.previews.at(-1).transform, undefined);
    pan.handlers.onStart(); view.flush(); assert.deepEqual(view.events, ['start', 'end', 'start']);
  } finally { view.dispose(); }
});

test('resize do canvas cancela arraste ativo, solta ownership e ignora terminal atrasado', async () => {
  const view = harness();
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush(); pan.handlers.onUpdate({ translationX: 24, translationY: 0 }); view.flush();
    view.layout(400, 300); assert.deepEqual(view.events, ['start', 'end']);
    pan.handlers.onEnd({ translationX: 100, translationY: 0 }); pan.handlers.onFinalize({}, true); await view.pump();
    assert.deepEqual(view.commits, []);
    const next = view.getGesture('pan'); next.handlers.onStart(); view.flush(); next.handlers.onEnd({ translationX: 20, translationY: 0 }); next.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start', 'end', 'start', 'end']);
  } finally { view.dispose(); }
});

test('desaparecer do intervalo cancela sem escrita nem callback tardio reabrir a interação', async () => {
  const view = harness();
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush(); pan.handlers.onUpdate({ translationX: 24, translationY: 0 });
    view.update({ positionSeconds: 3 }); view.flush();
    pan.handlers.onEnd({ translationX: 24, translationY: 0 }); pan.handlers.onFinalize({}, true); await view.pump();
    assert.deepEqual(view.events, ['start', 'end']); assert.deepEqual(view.commits, []);
    view.update({ positionSeconds: 1 }); const next = view.getGesture('pan'); next.handlers.onStart(); view.flush(); next.handlers.onFinalize({}, false); await view.pump();
    assert.deepEqual(view.events, ['start', 'end', 'start', 'end']);
  } finally { view.dispose(); }
});

test('cancel externo durante escrita não libera ownership antes da persistência resolver', async () => {
  const view = harness({ deferred: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush(); pan.handlers.onEnd({ translationX: 40, translationY: 0 }); pan.handlers.onFinalize({}, true); view.flush();
    assert.equal(view.commits.length, 1); view.update({ disabled: true }); view.update({ disabled: false });
    const next = view.getGesture('pan'); next.handlers.onStart(); next.handlers.onEnd({ translationX: 80, translationY: 0 }); next.handlers.onFinalize({}, true); view.flush();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start']);
    view.resolve(); await view.pump(); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('sequência real do simulador com tradução zero termina sem escrita e libera um próximo gesto', async () => {
  const view = harness();
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush(); pan.handlers.onUpdate({ translationX: 0, translationY: 0 }); view.flush();
    pan.handlers.onEnd({ translationX: 0, translationY: 0 }); pan.handlers.onFinalize({}, true); await view.pump();
    assert.deepEqual(view.events, ['start', 'end']); assert.deepEqual(view.commits, []);
    pan.handlers.onStart(); view.flush(); pan.handlers.onEnd({ translationX: 20, translationY: 0 }); pan.handlers.onFinalize({}, true); await view.pump();
    assert.deepEqual(view.events, ['start', 'end', 'start', 'end']); assert.equal(view.commits.length, 1);
  } finally { view.dispose(); }
});

test('recognizers preservam identidade em seleção, preview, bloqueio e resize; pan de texto não ativa por timer', () => {
  const view = harness({ props: { selectedLayerId: undefined } });
  try {
    const pan = view.getGesture('pan'), pinch = pan.configuration.simultaneousWithExternalGesture, tap = view.getGesture('tap'), handle = view.handle(3);
    assert.equal(view.canvasDetector().props.gesture.configuration.enabled, false);
    assert.equal(pan.configuration.activateAfterLongPress, undefined);
    let failed = 0;
    pan.handlers.onTouchesDown({}, { fail: () => failed++ });
    assert.equal(failed, 1);
    tap.handlers.onEnd({}, true); view.flush(); view.update({ selectedLayerId: 'title' });
    view.echo({ rect: { x: 0.4, y: 0.2, width: 0.4, height: 0.2 }, textFontSize: 0.05 });
    view.update({ disabled: true }); view.layout(400, 300); view.update({ disabled: false });
    assert.equal(view.getGesture('pan'), pan); assert.equal(view.getGesture('pinch'), pinch);
    assert.equal(view.getGesture('tap'), tap); assert.equal(view.handle(3), handle);
    assert.equal(handle.configuration.blocksExternalGesture, pinch);
    assert.deepEqual(view.events, []); assert.deepEqual(view.commits, []);
    pan.handlers.onTouchesDown({}, { fail: () => failed++ }); assert.equal(failed, 1);
  } finally { view.dispose(); }
});

test('as quatro alças são alvos irmãos absolutos e mantêm centros físicos após seleção', () => {
  const view = harness({ props: { selectedLayerId: undefined } });
  try {
    const tree = view.tree(), body = tree.props.children[0];
    const corners = tree.props.children[1];
    assert.equal(body.type, 'detector'); assert.equal(corners.length, 4);
    assert.ok(corners.every(node => node.type.name === 'CanvasCornerHandle'));
    assert.equal(body.props.children.props.children.some(node => node?.type?.name === 'CanvasCornerHandle'), false);
    for (let index = 0; index < 4; index++) assert.equal(view.cornerView(index).props.children.props.pointerEvents, 'none');
    view.update({ selectedLayerId: 'title' });
    const expected = [[96, 54], [224, 54], [96, 90], [224, 90]];
    for (let index = 0; index < 4; index++) {
      const nativeView = view.cornerView(index).props.children;
      const style = Object.assign({}, ...nativeView.props.style.map(value => value.getStyle ? value.getStyle() : value));
      assert.equal(nativeView.props.pointerEvents, 'auto'); assert.equal(style.position, 'absolute'); assert.equal(style.zIndex, 1000);
      near(style.left + style.width / 2, expected[index][0]); near(style.top + style.height / 2, expected[index][1]);
      assert.equal(style.transform, undefined);
    }
  } finally { view.dispose(); }
});

test('fim sem finalize salva uma vez e cancelamento touch sem finalize libera sem escrita', async () => {
  const view = harness();
  try {
    const handle = view.handle(3), pan = view.getGesture('pan');
    handle.handlers.onStart(); view.flush(); handle.handlers.onEnd({ translationX: 64, translationY: 18 }, true); await view.pump();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start', 'end']);
    handle.handlers.onFinalize({}, true); await view.pump(); assert.equal(view.commits.length, 1);
    pan.handlers.onStart(); view.flush(); pan.handlers.onUpdate({ translationX: 32, translationY: 0 }); view.flush();
    pan.handlers.onTouchesCancelled({}); await view.pump();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start', 'end', 'start', 'end']);
    assert.equal(view.previews.at(-1).transform, undefined);
    pan.handlers.onFinalize({}, false); await view.pump(); assert.deepEqual(view.events, ['start', 'end', 'start', 'end']);
  } finally { view.dispose(); }
});

test('alça e corpo não participam da mesma transação, mesmo se recognizer concorrente iniciar', async () => {
  const view = harness();
  try {
    const handle = view.handle(3), pan = view.getGesture('pan'), pinch = view.getGesture('pinch');
    handle.handlers.onStart(); pan.handlers.onStart(); pinch.handlers.onStart({ focalX: 32, focalY: 9 }); view.flush();
    let failed = 0; pan.handlers.onTouchesDown({}, { fail: () => failed++ }); assert.equal(failed, 1);
    pan.handlers.onUpdate({ translationX: 100, translationY: 100 }); pinch.handlers.onUpdate({ scale: 2 });
    pan.handlers.onFinalize({}, false); pinch.handlers.onFinalize({}, false);
    handle.handlers.onEnd({ translationX: 64, translationY: 18 }, true); await view.pump();
    assert.equal(view.commits.length, 1); near(view.commits[0].transform.rect.width, 0.6); near(view.commits[0].transform.rect.x, 0.3);
    assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('background e bloqueio invalidam callbacks tardios sem timer de recuperação artificial', async () => {
  const view = harness();
  try {
    const pan = view.getGesture('pan');
    pan.handlers.onStart(); view.flush(); pan.handlers.onUpdate({ translationX: 20, translationY: 0 }); view.flush();
    view.changeAppState('inactive'); pan.handlers.onStart(); pan.handlers.onEnd({ translationX: 40, translationY: 0 }, true); await view.pump();
    assert.deepEqual(view.events, ['start', 'end']); assert.deepEqual(view.commits, []);
    view.changeAppState('active'); view.update({ disabled: true });
    pan.handlers.onStart(); pan.handlers.onUpdate({ translationX: 50, translationY: 0 }); pan.handlers.onEnd({ translationX: 50, translationY: 0 }, true); await view.pump();
    assert.deepEqual(view.events, ['start', 'end']);
    view.update({ disabled: false }); pan.handlers.onStart(); view.flush(); pan.handlers.onEnd({ translationX: 32, translationY: 0 }, true); await view.pump();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start', 'end', 'start', 'end']);
  } finally { view.dispose(); }
});

test('compilação Babel instalada marca callbacks de todos recognizers como worklets executáveis', async () => {
  const view = harness({ worklets: true });
  try {
    const gestures = [...view.body(), view.backgroundTap(), ...[0, 1, 2, 3].map(index => view.handle(index))];
    for (const gesture of gestures) for (const [name, callback] of Object.entries(gesture.handlers)) {
      assert.equal(typeof callback.__workletHash, 'number', `${gesture.kind}.${name} precisa executar no runtime UI`);
    }
    const handle = view.handle(3); handle.handlers.onStart(); view.flush(); handle.handlers.onEnd({ translationX: 64, translationY: 18 }, true); await view.pump();
    assert.equal(view.commits.length, 1); near(view.commits[0].transform.rect.width, 0.6); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('helper de snap compila como worklet real e executa entrada, histerese e saída', () => {
  const helperSource = readFileSync(new URL('./canvasGeometry.ts', import.meta.url), 'utf8');
  const transformed = babel.transformSync(helperSource, { filename: fileURLToPath(new URL('./canvasGeometry.ts', import.meta.url)), configFile: false, babelrc: false,
    plugins: ['@babel/plugin-transform-typescript', 'react-native-worklets/plugin'] }).code;
  const compiled = ts.transpileModule(transformed, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('module', 'exports', compiled)(module, module.exports);
  const snapCenter = module.exports.studioCanvasSnapCenter;
  assert.equal(typeof snapCenter.__workletHash, 'number');
  const at = pixels => ({ x: 0.3 + pixels / 320, y: 0.4, width: 0.4, height: 0.2 });
  const enter = snapCenter(at(7), 320, 180, { x: false, y: false });
  const stay = snapCenter(at(12), 320, 180, enter.snap);
  const leave = snapCenter(at(15), 320, 180, stay.snap);
  assert.equal(enter.snap.x, true); assert.equal(stay.snap.x, true); assert.equal(leave.snap.x, false);
  near(leave.rect.x, at(15).x);
});

for (const kind of ['text', 'image', 'video']) test(`snap real de ${kind} rotacionado pinta guias no UI e persiste centro uma vez sem mover cursor`, async () => {
  const view = harness({ kind, rotation: 35, asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan');
    pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 7, translationY: 12 });
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0.9, 0.9]);
    near(view.frame().left + view.frame().width / 2, 160); near(view.frame().top + view.frame().height / 2, 90);
    assert.deepEqual(view.previews, [], 'As guias e a geometria não aguardam uma renderização JS');
    view.flush();
    near(view.previews[0].transform.rect.x, 0.3); near(view.previews[0].transform.rect.y, 0.4);
    view.echo(view.previews[0].transform); view.flushUI();
    assert.equal(view.getGesture('pan'), pan, 'O eco não reconstrói o recognizer nem altera a âncora');
    pan.handlers.onEnd({ translationX: 12, translationY: 7 }, true);
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0, 0], 'A guia some antes de a escrita começar');
    await view.pump();
    assert.equal(view.commits.length, 1); near(view.commits[0].transform.rect.x, 0.3); near(view.commits[0].transform.rect.y, 0.4);
    assert.deepEqual(view.events, ['start', 'end']); assert.deepEqual(view.selections, []); assert.deepEqual(view.playback, []);
    pan.handlers.onFinalize({}, true); await view.pump(); assert.equal(view.commits.length, 1);
  } finally { view.dispose(); }
});

test('histerese do pan recebe posição bruta e permite sair e reentrar sem guia presa', async () => {
  const view = harness({ asyncShared: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    for (const [translationX, expectedX, guideX] of [[7, 0.3, 0.9], [12, 0.3, 0.9], [15, 0.3 + 15 / 320, 0], [10, 0.3 + 10 / 320, 0], [7, 0.3, 0.9]]) {
      pan.handlers.onUpdate({ translationX, translationY: 18 });
      near(view.frame().left / 320, expectedX); assert.deepEqual(view.guides().map(guide => guide.opacity), [guideX, 0.9]);
    }
    pan.handlers.onEnd({ translationX: 14, translationY: 18 }, true); await view.pump();
    assert.equal(view.commits.length, 1); near(view.commits[0].transform.rect.x, 0.3); near(view.commits[0].transform.rect.y, 0.4);
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0, 0]);
  } finally { view.dispose(); }
});

test('snap do principal ampliado centraliza sem alterar recorte, seleção ou reprodução', async () => {
  const view = harness({ mainRect: { x: -0.3, y: -0.3, width: 1.5, height: 1.5 }, asyncShared: true,
    props: { selectedLayerId: undefined, selectedMainClipId: 'main', onSelectMainClip: () => {} } });
  try {
    const pan = view.getGesture('pan', 'main'); pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 10, translationY: 6 });
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0.9, 0.9]);
    pan.handlers.onEnd({ translationX: 10, translationY: 6 }, true); await view.pump();
    assert.equal(view.commits.length, 1);
    assert.deepEqual(view.commits[0], { id: 'main', transform: { rect: { x: -0.25, y: -0.25, width: 1.5, height: 1.5 } } });
    assert.deepEqual(view.playback, []); assert.deepEqual(view.selections, []); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

for (const terminal of ['end-failed', 'touch-cancel', 'background', 'selection']) test(`guias não sobrevivem a ${terminal} nem a callback atrasado`, async () => {
  const view = harness({ asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 7, translationY: 18 }); view.flush();
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0.9, 0.9]);
    if (terminal === 'end-failed') pan.handlers.onEnd({ translationX: 7, translationY: 18 }, false);
    if (terminal === 'touch-cancel') pan.handlers.onTouchesCancelled({});
    if (terminal === 'background') view.changeAppState('background');
    if (terminal === 'selection') view.update({ selectedLayerId: undefined });
    view.flushUI(); assert.deepEqual(view.guides().map(guide => guide.opacity), [0, 0]);
    pan.handlers.onUpdate({ translationX: 7, translationY: 18 });
    pan.handlers.onEnd({ translationX: 7, translationY: 18 }, true); pan.handlers.onFinalize({}, true); await view.pump();
    assert.deepEqual(view.commits, []); assert.deepEqual(view.guides().map(guide => guide.opacity), [0, 0]);
    assert.deepEqual(view.events, ['start', 'end']); assert.equal(view.previews.at(-1).transform, undefined);
  } finally { view.dispose(); }
});

test('pinça e cantos preservam sua âncora e não aplicam magnetismo ou guias de movimento', async () => {
  const view = harness({ rect: { x: 0.3, y: 0.37, width: 0.4, height: 0.2 }, asyncShared: true });
  try {
    const pinch = view.getGesture('pinch'); pinch.handlers.onStart({ focalX: 32, focalY: 9 }); view.flush();
    pinch.handlers.onUpdate({ scale: 1.1 }); assert.deepEqual(view.guides().map(guide => guide.opacity), [0, 0]);
    pinch.handlers.onEnd({ scale: 1.1 }, true); await view.pump();
    const resized = view.commits[0].transform;
    assert.ok(Math.abs(resized.rect.y + resized.rect.height / 2 - 0.5) > 1e-7, 'A pinça perto do centro continua na âncora focal');
    const corner = view.handle(3); corner.handlers.onStart(); view.flush();
    corner.handlers.onUpdate({ translationX: 10, translationY: 3 }); assert.deepEqual(view.guides().map(guide => guide.opacity), [0, 0]);
    corner.handlers.onEnd({ translationX: 10, translationY: 3 }, true); await view.pump(); assert.equal(view.commits.length, 2);
  } finally { view.dispose(); }
});

test('pinça que entra durante pan remove guias antes de escalar, sem duplicar a escrita', async () => {
  const view = harness({ asyncShared: true });
  try {
    const pan = view.getGesture('pan'), pinch = view.getGesture('pinch');
    pan.handlers.onStart(); view.flush(); pan.handlers.onUpdate({ translationX: 7, translationY: 18 });
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0.9, 0.9]);
    pinch.handlers.onStart({ focalX: 32, focalY: 9 }); assert.deepEqual(view.guides().map(guide => guide.opacity), [0, 0]);
    pinch.handlers.onUpdate({ scale: 1.2 }); pan.handlers.onEnd({ translationX: 7, translationY: 18 }, true);
    assert.equal(view.commits.length, 0); pinch.handlers.onEnd({ scale: 1.2 }, true); await view.pump();
    assert.equal(view.commits.length, 1); near(view.commits[0].transform.rect.width, 0.48); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

for (const target of ['title', 'main']) test(`AX de ${target} reserva no UI antes de salvar, com SharedValue assíncrono no JS`, async () => {
  const view = harness({ asyncShared: true, deferred: true, worklets: true, props: target === 'main'
    ? { selectedLayerId: undefined, selectedMainClipId: 'main', onSelectMainClip: id => {} } : {} });
  try {
    const original = view.frame(target);
    view.accessibility('increment', target); view.accessibility('moveRight', target);
    assert.deepEqual(view.commits, []); assert.deepEqual(view.events, []);
    view.flush(); assert.deepEqual(view.commits, [], 'JS cannot use an epoch written but not yet applied on UI');
    view.flushUI();
    const pan = view.getGesture('pan', target); pan.handlers.onStart(); pan.handlers.onEnd({ translationX: 32, translationY: 0 }, true);
    view.flush();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start']);
    near(view.commits[0].transform.rect.width * 320, original.width * 1.1);
    if (target === 'title') assert.ok(view.commits[0].transform.textFontSize > 0);
    view.accessibility('moveRight', target); view.flushUI(); view.flush(); assert.equal(view.commits.length, 1);
    view.resolve(); await view.pump(); assert.deepEqual(view.events, ['start', 'end']);
    view.getGesture('tap', target).handlers.onEnd({}, true); view.flush();
    if (target === 'title') assert.deepEqual(view.selections, ['title']);
  } finally { view.dispose(); }
});

test('AX move respeita fila UI/JS, libera após falha de disco e permite retry sem owner preso', async () => {
  const view = harness({ asyncShared: true, fail: true });
  try {
    view.accessibility('moveDown'); view.flushUI(); view.flush(); await view.pump();
    assert.equal(view.commits.length, 1); near(view.commits[0].transform.rect.y, 0.325);
    assert.deepEqual(view.events, ['start', 'end']); assert.equal(view.previews.at(-1).transform, undefined);
    view.accessibility('moveRight'); await view.pump();
    assert.equal(view.commits.length, 2); near(view.commits[1].transform.rect.x, 0.325);
    assert.deepEqual(view.events, ['start', 'end', 'start', 'end']);
  } finally { view.dispose(); }
});

for (const reservationApplied of [false, true]) test(`cancelar AX ${reservationApplied ? 'após' : 'antes da'} reserva UI impede commit tardio e libera próximo gesto`, async () => {
  const view = harness({ asyncShared: true });
  try {
    view.accessibility('increment'); if (reservationApplied) view.flushUI();
    view.update({ disabled: true }); view.flush(); await view.pump();
    assert.deepEqual(view.events, []); assert.deepEqual(view.commits, []); assert.deepEqual(view.previews, []);
    view.update({ disabled: false }); view.flushUI(); view.flush();
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush(); pan.handlers.onEnd({ translationX: 32, translationY: 0 }, true); await view.pump();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('cancelamento JS reconhece epoch que iniciou antes do cancel chegar ao UI, sem flag órfã', async () => {
  const view = harness({ asyncShared: true });
  try {
    // The layout effect has scheduled a cancellation, but UI still has the
    // previous configuration. A native activation can arrive in this gap.
    view.layout(400, 300);
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    assert.deepEqual(view.events, ['start']);
    view.flushUI(); view.flush();
    assert.deepEqual(view.events, ['start', 'end']); assert.deepEqual(view.commits, []);
    pan.handlers.onEnd({ translationX: 80, translationY: 0 }, true); await view.pump();
    assert.deepEqual(view.commits, []); assert.deepEqual(view.events, ['start', 'end']);
    pan.handlers.onStart(); view.flush(); pan.handlers.onEnd({ translationX: 20, translationY: 0 }, true); await view.pump();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start', 'end', 'start', 'end']);
  } finally { view.dispose(); }
});

test('cancelar AX durante gravação mantém reserva até persistência resolver com setters JS assíncronos', async () => {
  const view = harness({ asyncShared: true, deferred: true });
  try {
    view.accessibility('moveRight'); view.flushUI(); view.flush(); assert.equal(view.commits.length, 1);
    view.update({ disabled: true }); view.update({ disabled: false }); view.flushUI(); view.flush();
    const pan = view.getGesture('pan'); pan.handlers.onStart(); pan.handlers.onEnd({ translationX: 80, translationY: 0 }, true); view.flush();
    view.accessibility('moveDown'); view.flushUI(); view.flush();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start']);
    view.resolve(); await view.pump(); assert.deepEqual(view.events, ['start', 'end']);
    view.accessibility('moveDown'); view.flushUI(); view.flush(); assert.equal(view.commits.length, 2);
    view.resolve(); await view.pump(); assert.deepEqual(view.events, ['start', 'end', 'start', 'end']);
  } finally { view.dispose(); }
});

for (const runtime of ['js', 'ui-worklet']) test(`arraste imediato do principal reduzido move a mídia sem resize, seek ou seleção (${runtime})`, async () => {
  const original = { x: 0, y: 0, width: 0.77, height: 0.77 };
  const view = harness({ mainRect: original, asyncShared: runtime === 'ui-worklet', worklets: runtime === 'ui-worklet',
    props: { selectedLayerId: undefined, selectedMainClipId: 'main', onSelectMainClip: id => view.selections.push(id) } });
  try {
    // The real model contains a visual overlay. This lower-left body point
    // hits the main rather than the text or any corner's native touch target.
    const canvas = geometry.studioCanvasFrame(320, 300, 'landscape');
    const hit = geometry.studioCanvasHitTest(geometry.studioVisibleCanvasLayers(view.editing(), view.recipe(), 1, true), 40, 170, canvas);
    assert.equal(hit, 'main');
    assert.equal(nativeBodyDrag(view, 'main', [{ elapsed: 40, x: 16, y: 0 }, { elapsed: 80, x: 48, y: 18 }, { elapsed: 120, x: 80, y: 54 }]), true);
    await view.pump();
    assert.equal(view.commits.length, 1); assert.equal(view.commits[0].id, 'main');
    const next = view.commits[0].transform.rect;
    near(next.x, 64 / 320); near(next.y, 54 / 180);
    near(next.width, original.width); near(next.height, original.height);
    assert.deepEqual(view.playback, []); assert.deepEqual(view.selections, []);
    assert.deepEqual(view.events, ['start', 'end']);
    assert.equal(view.previews.at(-1).transform, undefined);
  } finally { view.dispose(); }
});

test('toque que seleciona principal não começa arraste; o próximo arraste cancelado restaura a mídia', async () => {
  const original = { x: 0.1, y: 0.1, width: 0.75, height: 0.75 };
  const view = harness({ mainRect: original, asyncShared: true, worklets: true,
    props: { selectedLayerId: undefined, onSelectMainClip: id => view.selections.push(id) } });
  try {
    const pan = view.getGesture('pan', 'main'); let failed = false;
    pan.handlers.onTouchesDown({}, { fail: () => { failed = true; } });
    assert.equal(failed, true);
    view.getGesture('tap', 'main').handlers.onEnd({}, true); view.flush();
    view.update({ selectedMainClipId: 'main' }); view.flushUI();
    // The same touch which selected the clip stays failed; it cannot begin
    // moving simply because React has now rendered the selected state.
    assert.equal(view.getGesture('pan', 'main'), pan);
    assert.deepEqual(view.commits, []); assert.deepEqual(view.events, []);
    assert.equal(nativeBodyDrag(view, 'main', [{ elapsed: 30, x: 18, y: 0 }, { elapsed: 90, x: 72, y: 32 }], true), true);
    await view.pump();
    assert.deepEqual(view.commits, []); assert.deepEqual(view.events, ['start', 'end']);
    near(view.frame('main').left, original.x * 320); near(view.frame('main').top, original.y * 180);
    assert.equal(view.previews.at(-1).transform, undefined); assert.deepEqual(view.playback, []);
  } finally { view.dispose(); }
});

test('guias X/Y adquiridas juntas têm feedback único, silêncio na permanência e feedback ao reentrar', async () => {
  const view = harness({ asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 7, translationY: 18 }); view.flush();
    assert.deepEqual(view.feedback, [1000]);
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0.9, 0.9]);
    view.setNow(1040); pan.handlers.onUpdate({ translationX: 10, translationY: 20 }); view.flush();
    assert.deepEqual(view.feedback, [1000]);
    view.setNow(1080); pan.handlers.onUpdate({ translationX: 30, translationY: 45 }); view.flush();
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0, 0]);
    assert.deepEqual(view.feedback, [1000]);
    view.setNow(1120); pan.handlers.onUpdate({ translationX: 6, translationY: 18 }); view.flush();
    assert.deepEqual(view.feedback, [1000, 1120]);
    pan.handlers.onTouchesCancelled({}); await view.pump(); assert.deepEqual(view.commits, []);
  } finally { view.dispose(); }
});

test('aquisições próximas dos dois eixos são coalescidas; pinça e alças não vibram', async () => {
  const view = harness({ asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 7, translationY: 0 }); view.flush();
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0.9, 0]);
    view.setNow(1008); pan.handlers.onUpdate({ translationX: 7, translationY: 18 }); view.flush();
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0.9, 0.9]); assert.deepEqual(view.feedback, [1000]);
    pan.handlers.onTouchesCancelled({}); await view.pump();
    const pinch = view.getGesture('pinch'); pinch.handlers.onStart({ focalX: 64, focalY: 18 }); view.flush();
    pinch.handlers.onEnd({ scale: 1.1 }, true); await view.pump();
    const corner = view.handle(3); corner.handlers.onStart(); view.flush(); corner.handlers.onEnd({ translationX: 18, translationY: 7 }, true); await view.pump();
    assert.deepEqual(view.feedback, [1000]);
  } finally { view.dispose(); }
});

test('aquisição enfileirada que saiu das guias antes do JS não produz feedback obsoleto', async () => {
  const view = harness({ rect: { x: 0.28, y: 0.3, width: 0.4, height: 0.2 }, asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 7, translationY: 18 });
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0.9, 0.9]);
    view.setNow(1080); pan.handlers.onUpdate({ translationX: 30, translationY: 45 });
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0, 0]);
    view.flush(); assert.deepEqual(view.feedback, []);
    pan.handlers.onTouchesCancelled({}); await view.pump();
  } finally { view.dispose(); }
});

test('sair e reentrar antes do JS invalida aquisição antiga e entrega apenas a atual no mesmo frame', async () => {
  const view = harness({ rect: { x: 0.28, y: 0.3, width: 0.4, height: 0.2 }, asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 7, translationY: 18 });
    pan.handlers.onUpdate({ translationX: 30, translationY: 45 });
    pan.handlers.onUpdate({ translationX: 7, translationY: 18 });
    assert.deepEqual(view.guides().map(guide => guide.opacity), [0.9, 0.9]);
    // Deliver the old acquisition first. It must neither vibrate nor spend
    // the one-frame feedback budget belonging to the latest acquisition.
    assert.ok(view.queue.length >= 2); view.queue.shift()();
    assert.deepEqual(view.feedback, []);
    view.flush(); assert.deepEqual(view.feedback, [1000]);
    pan.handlers.onTouchesCancelled({}); await view.pump();
  } finally { view.dispose(); }
});

for (const terminal of ['cancel', 'end', 'deselect', 'disable', 'background', 'unmount']) test(`feedback enfileirado não dispara depois de ${terminal}`, async () => {
  const view = harness({ asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 7, translationY: 18 }); // UI owns the snap; JS is still queued.
    if (terminal === 'cancel') pan.handlers.onTouchesCancelled({});
    if (terminal === 'end') pan.handlers.onEnd({ translationX: 7, translationY: 18 }, true);
    if (terminal === 'deselect') view.update({ selectedLayerId: undefined });
    if (terminal === 'disable') view.update({ disabled: true });
    if (terminal === 'background') view.changeAppState('background');
    if (terminal === 'unmount') view.dispose();
    await view.pump(); assert.deepEqual(view.feedback, []);
  } finally { view.dispose(); }
});

test('vídeo principal publica geometria a120Hz no UI sem document drafts e persiste apenas após soltar', async () => {
  const view = harness({ interactive: true, asyncShared: true, worklets: true, deferred: true,
    props: { selectedLayerId: undefined, selectedMainClipId: 'main', onSelectMainClip() {} } });
  try {
    const original = view.editing(), pan = view.getGesture('pan', 'main');
    pan.handlers.onStart();
    for (let i = 1; i <= 120; i++) {
      view.setNow(1000 + i * 1000 / 120);
      pan.handlers.onUpdate({ translationX: -i / 2, translationY: -i / 4 });
    }
    assert.equal(view.transformChannel.value.phase, 'gesture');
    assert.equal(view.transformChannel.value.sequence, 121);
    near(view.transformChannel.value.transform.rect.x, -60 / 320);
    near(view.frame('main').left, view.transformChannel.value.transform.rect.x * 320);
    assert.deepEqual(view.previews, []); assert.deepEqual(view.commits, []);
    assert.equal(view.editing(), original, 'neither original nor overlays are mutated by UI geometry');
    assert.deepEqual(view.playback, []);
    pan.handlers.onEnd({ translationX: -60, translationY: -30 }, true);
    assert.equal(view.transformChannel.value.phase, 'committing');
    assert.equal(view.transformChannel.value.finish, null, 'a gesture end is not a durable save acknowledgement');
    view.flush(); assert.equal(view.commits.length, 1);
    assert.equal(view.transformChannel.value.phase, 'committing');
    view.resolve(); await view.pump();
    assert.equal(view.transformChannel.value.active, false); assert.equal(view.transformChannel.value.finish, 'commit');
    assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

for (const terminal of ['cancel', 'background', 'disable', 'unmount', 'fail']) test(`canal interativo restaura/cancela com ownership após ${terminal}`, async () => {
  const view = harness({ interactive: true, asyncShared: true, worklets: true, fail: terminal === 'fail' });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 32, translationY: 10 });
    const owned = view.transformChannel.value.operationId;
    if (terminal === 'cancel') pan.handlers.onTouchesCancelled({});
    if (terminal === 'background') view.changeAppState('background');
    if (terminal === 'disable') view.update({ disabled: true });
    if (terminal === 'unmount') view.dispose();
    if (terminal === 'fail') pan.handlers.onEnd({ translationX: 32, translationY: 10 }, true);
    await view.pump();
    assert.equal(view.transformChannel.value.active, false);
    assert.equal(view.transformChannel.value.finish, 'cancel');
    assert.equal(view.transformChannel.value.operationId, owned);
    assert.equal(view.commits.length, terminal === 'fail' ? 1 : 0);
  } finally { view.dispose(); }
});

test('capacidade confirmada no meio do toque só vale para o gesto seguinte, preservando recognizers', async () => {
  const view = harness({ interactive: true, ready: false, asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 32, translationY: 10 }); view.flush();
    view.transformChannel.value = { ...view.transformChannel.value, available: true }; view.flushUI();
    view.setNow(1100); pan.handlers.onUpdate({ translationX: 40, translationY: 10 }); view.flush();
    assert.equal(view.transformChannel.value.active, false); assert.equal(view.previews.length, 2);
    assert.equal(view.getGesture('pan'), pan);
    pan.handlers.onTouchesCancelled({}); await view.pump();
    pan.handlers.onStart(); view.flush(); pan.handlers.onUpdate({ translationX: 18, translationY: 10 });
    assert.equal(view.transformChannel.value.active, true);
    assert.equal(view.getGesture('pan'), pan);
    pan.handlers.onTouchesCancelled({}); await view.pump();
  } finally { view.dispose(); }
});

test('binário anterior conserva previews e não oferece canal apenas porque recebeu um SharedValue', async () => {
  const view = harness({ interactive: true, native: false, asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan'); pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 20, translationY: 10 }); view.flush();
    assert.equal(view.transformChannel.value.active, false); assert.equal(view.previews.length, 1);
    pan.handlers.onTouchesCancelled({}); await view.pump();
  } finally { view.dispose(); }
});

test('camada ocultada no instante atual não gera aviso falso de fora do tempo', () => {
  const view = harness();
  try {
    const editing = { ...view.editing(), layers: view.editing().layers.map(layer => ({ ...layer, hidden: true })) };
    view.update({ editing, recipe: compileStudioRecipe({ kind: 'aula', takes: [], editing }) });
    assert.ok(!view.visibleIds().includes('title'));
    const tree = JSON.stringify(view.tree('root'));
    assert.ok(!tree.includes('fora deste momento'));
  } finally { view.dispose(); }
});

test('pinça selecionada usa o canvas fixo inteiro, com pan simultâneo entre views e cantos exclusivos', async () => {
  const view = harness({ rect: { x: 0.45, y: 0.45, width: 0.1, height: 0.05 }, asyncShared: true, worklets: true });
  try {
    const pinch = view.getGesture('pinch'), pan = view.getGesture('pan');
    assert.equal(view.canvasDetector().props.gesture, pinch);
    const nativeFrame = view.canvasDetector().props.children;
    assert.equal(nativeFrame.props.collapsable, false);
    assert.equal(nativeFrame.props.style.at(-1).width, 320); assert.equal(nativeFrame.props.style.at(-1).height, 180);
    assert.equal(pan.configuration.simultaneousWithExternalGesture, pinch);
    assert.equal(pinch.configuration.simultaneousWithExternalGesture, pan);
    for (let index = 0; index < 4; index++) assert.equal(view.handle(index).configuration.blocksExternalGesture, pinch);
    // The second contact is outside the tiny rect but inside the canvas view
    // to which the actual native pinch recognizer is attached.
    const clip = view.recipe().clips.find(clip => clip.id === 'title');
    assert.equal(geometry.studioCanvasContains(clip, 220, 120, { x: 0, y: 0, width: 320, height: 180 }), false);
    let failed = false; pinch.handlers.onTouchesDown({ numberOfTouches: 2 }, { fail: () => { failed = true; } });
    assert.equal(failed, false);
    pinch.handlers.onStart({ focalX: 160, focalY: 85.5, numberOfPointers: 2 }); view.flush();
    pinch.handlers.onEnd({ scale: 2, focalX: 176, focalY: 94.5, numberOfPointers: 2 }, true); await view.pump();
    assert.equal(view.commits.length, 1); const transform = view.commits[0].transform;
    near(transform.rect.width, 0.2); near(transform.rect.height, 0.1);
    near(transform.rect.x, 0.45); near(transform.rect.y, 0.475);
    assert.ok(transform.textFontSize > clip.text.fontSize);
    assert.deepEqual(view.events, ['start', 'end']); assert.deepEqual(view.playback, []);
  } finally { view.dispose(); }
});

for (const target of ['text', 'image', 'video', 'main']) test(`pinça e deslocamento dos dois dedos seguem centro global no ${target} rotacionado`, async () => {
  const original = { x: 0.3, y: 0.3, width: 0.4, height: 0.2 };
  const view = harness({ rect: original, mainRect: original, kind: target, rotation: 35, asyncShared: true, worklets: true,
    props: target === 'main' ? { selectedLayerId: undefined, selectedMainClipId: 'main', onSelectMainClip() {} } : {} });
  try {
    const id = target === 'main' ? 'main' : 'title', pinch = view.getGesture('pinch', id);
    pinch.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 }); view.flush();
    pinch.handlers.onUpdate({ scale: 1.5, focalX: 192, focalY: 90, numberOfPointers: 2 }); view.flush();
    const frame = view.frame(id); near(frame.left, 0.3 * 320); near(frame.top, 0.35 * 180);
    pinch.handlers.onEnd({ scale: 1.5, focalX: 192, focalY: 90, numberOfPointers: 2 }, true);
    pinch.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); const transform = view.commits[0].transform;
    near(transform.rect.width, 0.6); near(transform.rect.height, 0.3); near(transform.rect.x, 0.3); near(transform.rect.y, 0.35);
    if (target === 'text') near(transform.textFontSize, view.recipe().clips.find(clip => clip.id === id).text.fontSize * 1.5);
    else assert.equal(transform.textFontSize, undefined);
    assert.deepEqual(view.events, ['start', 'end']); assert.deepEqual(view.playback, []); assert.deepEqual(view.selections, []);
  } finally { view.dispose(); }
});

test('pan→pinça→um dedo preserva o último centro real, rebasa arraste e salva uma vez', async () => {
  const view = harness({ asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan'), pinch = view.getGesture('pinch');
    pan.handlers.onStart(); view.flush();
    pan.handlers.onUpdate({ translationX: 16, translationY: 0 }); view.flush();
    pinch.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 });
    pan.handlers.onUpdate({ translationX: 48, translationY: 18 });
    pinch.handlers.onUpdate({ scale: 1.5, focalX: 192, focalY: 90, numberOfPointers: 2 }); view.flush();
    near(view.frame('title').left, 120); near(view.frame('title').top, 63);
    // iOS's END can already contain only the remaining finger's position.
    pinch.handlers.onEnd({ scale: 1.5, focalX: 280, focalY: 160, numberOfPointers: 1 }, true);
    pinch.handlers.onFinalize({}, true); view.flush();
    near(view.frame('title').left, 120); near(view.frame('title').top, 63); assert.equal(view.commits.length, 0);
    pan.handlers.onUpdate({ translationX: 64, translationY: 27 });
    pan.handlers.onEnd({ translationX: 64, translationY: 27 }, true); pan.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); const transform = view.commits[0].transform;
    near(transform.rect.x, 136 / 320); near(transform.rect.y, 72 / 180); near(transform.rect.width, 0.6);
    assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('pinça→pan ignora tradução duplicada do pan e aguarda o último recognizer antes de salvar', async () => {
  const view = harness({ asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan'), pinch = view.getGesture('pinch');
    pinch.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 }); view.flush();
    pan.handlers.onStart();
    pan.handlers.onUpdate({ translationX: 64, translationY: 36 });
    pinch.handlers.onUpdate({ scale: 1.2, focalX: 192, focalY: 90, numberOfPointers: 2 }); view.flush();
    const frame = view.frame('title'); near(frame.left, 115.2); near(frame.top, 68.4);
    pan.handlers.onEnd({ translationX: 64, translationY: 36 }, true); pan.handlers.onFinalize({}, true); view.flush();
    assert.equal(view.commits.length, 0); assert.deepEqual(view.events, ['start']);
    pinch.handlers.onEnd({ scale: 1.2, focalX: 192, focalY: 90, numberOfPointers: 0 }, true);
    pinch.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); near(view.commits[0].transform.rect.x * 320, frame.left);
    near(view.commits[0].transform.rect.y * 180, frame.top); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('principal sem seleção admite somente a intenção de dois dedos e mantém alvo/recognizer no eco', async () => {
  const view = harness({ asyncShared: true, worklets: true, props: { selectedLayerId: undefined, onSelectMainClip: id => view.selections.push(id) } });
  try {
    const pan = view.getGesture('pan', 'main'), pinch = view.getGesture('pinch', 'main');
    let panFailed = 0; pan.handlers.onTouchesDown({ numberOfTouches: 1 }, { fail: () => panFailed++ });
    assert.equal(panFailed, 1); assert.deepEqual(view.events, []);
    view.backgroundTap().handlers.onEnd({}, true); view.flush(); assert.deepEqual(view.playback, [true]);
    let tapFailed = 0; view.backgroundTap().handlers.onTouchesDown({ numberOfTouches: 2 }, { fail: () => tapFailed++ });
    assert.equal(tapFailed, 1);
    pinch.handlers.onStart({ focalX: 160, focalY: 90, numberOfPointers: 2 }); view.flush();
    assert.deepEqual(view.selections, ['main']); assert.deepEqual(view.events, ['start']);
    view.update({ selectedMainClipId: 'main' }); view.flushUI();
    assert.equal(view.getGesture('pinch', 'main'), pinch);
    pinch.handlers.onEnd({ scale: 0.8, focalX: 160, focalY: 90, numberOfPointers: 2 }, true); await view.pump();
    assert.equal(view.commits.length, 1); near(view.commits[0].transform.rect.width, 0.8);
    assert.deepEqual(view.events, ['start', 'end']); assert.deepEqual(view.playback, [true]);
  } finally { view.dispose(); }
});

for (const invisible of ['off-time', 'hidden']) test(`seleção ${invisible} mantém a pinça inativa e não transfere gesto ao principal`, async () => {
  const view = harness({ asyncShared: true, worklets: true, props: { onSelectMainClip: id => view.selections.push(id) } });
  try {
    const oldPinch = view.getGesture('pinch');
    if (invisible === 'off-time') view.update({ positionSeconds: 3 });
    else {
      const editing = { ...view.editing(), layers: view.editing().layers.map(layer => ({ ...layer, hidden: true })) };
      view.update({ editing, recipe: compileStudioRecipe({ kind: 'aula', takes: [], editing }) });
    }
    view.flushUI(); view.flush();
    assert.equal(view.canvasDetector().props.gesture.configuration.enabled, false);
    assert.equal(view.getGesture('pinch', 'main'), undefined);
    oldPinch.handlers.onStart({ focalX: 160, focalY: 90, numberOfPointers: 2 }); oldPinch.handlers.onEnd({ scale: 1.5 }, true);
    await view.pump(); assert.deepEqual(view.commits, []); assert.deepEqual(view.selections, []); assert.deepEqual(view.events, []);
  } finally { view.dispose(); }
});

for (const terminal of ['pinch-cancel', 'pan-cancel', 'background', 'deselect', 'disable']) test(`pan+pinça cancelados por ${terminal} não salvam, liberam controles e rejeitam eventos antigos`, async () => {
  const view = harness({ interactive: true, asyncShared: true, worklets: true });
  try {
    const pan = view.getGesture('pan'), pinch = view.getGesture('pinch');
    pan.handlers.onStart(); view.flush(); pinch.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 });
    pinch.handlers.onUpdate({ scale: 1.4, focalX: 180, focalY: 85, numberOfPointers: 2 });
    if (terminal === 'pinch-cancel') pinch.handlers.onTouchesCancelled({});
    if (terminal === 'pan-cancel') pan.handlers.onFinalize({}, false);
    if (terminal === 'background') view.changeAppState('background');
    if (terminal === 'deselect') view.update({ selectedLayerId: undefined });
    if (terminal === 'disable') view.update({ disabled: true });
    pan.handlers.onEnd({ translationX: 50, translationY: 20 }, true); pan.handlers.onFinalize({}, true);
    pinch.handlers.onEnd({ scale: 2, focalX: 250, focalY: 120, numberOfPointers: 2 }, true); pinch.handlers.onFinalize({}, true);
    await view.pump();
    assert.deepEqual(view.commits, []); assert.deepEqual(view.events, ['start', 'end']);
    assert.equal(view.transformChannel.value.active, false); assert.equal(view.transformChannel.value.finish, 'cancel');
    if (terminal === 'background') view.changeAppState('active');
    if (terminal === 'deselect') view.update({ selectedLayerId: 'title' });
    if (terminal === 'disable') view.update({ disabled: false });
    view.flushUI(); const next = view.getGesture('pinch');
    next.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 }); view.flush();
    next.handlers.onEnd({ scale: 1.1, focalX: 160, focalY: 72, numberOfPointers: 2 }, true); await view.pump();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start', 'end', 'start', 'end']);
  } finally { view.dispose(); }
});

test('pinça inteira usa o canal UI, conserva bounds e só publica receipt após persistência', async () => {
  const view = harness({ interactive: true, asyncShared: true, worklets: true, deferred: true });
  try {
    const pinch = view.getGesture('pinch'), original = view.editing();
    pinch.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 });
    for (let i = 1; i <= 120; i++) pinch.handlers.onUpdate({ scale: 1 + i / 240, focalX: 160 + i / 4, focalY: 72 + i / 8, numberOfPointers: 2 });
    const latest = view.transformChannel.value;
    assert.equal(latest.phase, 'gesture'); assert.equal(latest.sequence, 121); assert.equal(view.editing(), original);
    assert.deepEqual(view.previews, []); near(latest.transform.rect.width, 0.6); near(latest.transform.rect.x, 0.29375);
    pinch.handlers.onEnd({ scale: 1.5, focalX: 190, focalY: 87, numberOfPointers: 1 }, true);
    assert.equal(view.transformChannel.value.phase, 'committing'); assert.equal(view.transformChannel.value.finish, null);
    view.flush(); assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start']);
    view.resolve(); await view.pump(); assert.equal(view.transformChannel.value.finish, 'commit'); assert.equal(view.transformChannel.value.active, false);
    assert.deepEqual(view.events, ['start', 'end']);
    const next = view.getGesture('pinch'); next.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 }); view.flush();
    next.handlers.onUpdate({ scale: 1000, focalX: 9000, focalY: -9000, numberOfPointers: 2 });
    const bounded = view.transformChannel.value.transform;
    assert.ok(bounded.rect.width <= 3 && bounded.rect.height <= 3 && bounded.rect.x <= 3 && bounded.rect.x >= -2 && bounded.rect.y >= -2);
    assert.ok(bounded.textFontSize <= 1);
    next.handlers.onTouchesCancelled({}); await view.pump();
  } finally { view.dispose(); }
});

test('pinça em projeto legado solicita seleção/conversão explícita sem alterar mídia ou persistir geometria', async () => {
  const view = harness({ asyncShared: true, worklets: true, props: { selectedLayerId: undefined, onSelectMainClip: id => view.selections.push(id) } });
  try {
    const editing = { ...view.editing(), output: { ...view.editing().output, profile: 'legacy-source' } };
    view.update({ editing, recipe: compileStudioRecipe({ kind: 'aula', takes: [], editing }) }); view.flushUI();
    const pinch = view.getGesture('pinch', 'main');
    pinch.handlers.onStart({ focalX: 160, focalY: 90, numberOfPointers: 2 }); view.flush();
    pinch.handlers.onUpdate({ scale: 2, focalX: 190, focalY: 110, numberOfPointers: 2 });
    pinch.handlers.onEnd({ scale: 2, focalX: 190, focalY: 110, numberOfPointers: 2 }, true); await view.pump();
    assert.deepEqual(view.selections, ['main']); assert.deepEqual(view.events, []); assert.deepEqual(view.commits, []); assert.deepEqual(view.playback, []);
    near(view.frame('main').width, 320); assert.equal(view.editing().output.profile, 'legacy-source');
  } finally { view.dispose(); }
});

for (const target of ['main', 'title']) test(`bloqueio temporário da escrita mantém operationId e epoch do receipt de pinça em ${target}`, async () => {
  const view = harness({ interactive: true, asyncShared: true, worklets: true, deferred: true,
    props: target === 'main' ? { selectedLayerId: undefined, selectedMainClipId: 'main', onSelectMainClip() {} } : {} });
  try {
    const pinch = view.getGesture('pinch', target);
    pinch.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 }); view.flush();
    pinch.handlers.onEnd({ scale: 1.5, focalX: 180, focalY: 80, numberOfPointers: 2 }, true); view.flush();
    const reserved = { ...view.transformChannel.value };
    assert.equal(reserved.phase, 'committing'); assert.equal(reserved.finish, null); assert.equal(view.commits.length, 1);
    // Route startWork disables the canvas while it awaits the disk write.
    view.update({ disabled: true }); view.flushUI(); view.flush();
    view.update({ disabled: false }); view.flushUI(); view.flush();
    pinch.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 });
    pinch.handlers.onEnd({ scale: 2, focalX: 180, focalY: 80, numberOfPointers: 2 }, true); view.flush();
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start']);
    assert.equal(view.transformChannel.value.operationId, reserved.operationId);
    view.resolve(); await view.pump();
    const receipt = view.transformChannel.value;
    assert.equal(receipt.operationId, reserved.operationId); assert.equal(receipt.epoch, reserved.epoch);
    assert.equal(receipt.finish, 'commit'); assert.equal(receipt.active, false); assert.deepEqual(view.events, ['start', 'end']);
    const next = view.getGesture('pinch', target); next.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 }); view.flush();
    assert.notEqual(view.transformChannel.value.operationId, reserved.operationId);
    assert.ok(view.transformChannel.value.epoch > reserved.epoch);
    next.handlers.onTouchesCancelled({}); await view.pump(); assert.equal(view.commits.length, 1);
  } finally { view.dispose(); }
});

for (const terminal of ['background', 'unmount', 'deselect']) test(`cancel real por ${terminal} durante escrita não inventa cancel de disco nem receipt de outra operação`, async () => {
  const view = harness({ interactive: true, asyncShared: true, worklets: true, deferred: true });
  try {
    const pinch = view.getGesture('pinch');
    pinch.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 }); view.flush();
    pinch.handlers.onEnd({ scale: 1.5, focalX: 180, focalY: 80, numberOfPointers: 2 }, true); view.flush();
    const reserved = { ...view.transformChannel.value };
    if (terminal === 'background') view.changeAppState('background');
    if (terminal === 'unmount') view.dispose();
    if (terminal === 'deselect') view.update({ selectedLayerId: undefined });
    view.flushUI(); view.flush();
    pinch.handlers.onUpdate({ scale: 3, focalX: 240, focalY: 140, numberOfPointers: 2 });
    pinch.handlers.onFinalize({}, false); view.flush();
    assert.equal(view.transformChannel.value.operationId, reserved.operationId);
    assert.equal(view.transformChannel.value.finish, null); assert.equal(view.transformChannel.value.phase, 'committing');
    assert.equal(view.commits.length, 1); assert.deepEqual(view.events, ['start']);
    view.resolve(); await view.pump();
    const receipt = view.transformChannel.value;
    assert.equal(receipt.operationId, reserved.operationId); assert.equal(receipt.epoch, reserved.epoch);
    assert.equal(receipt.finish, 'commit', 'the started write really succeeded; UI cancellation cannot falsely report otherwise');
    assert.equal(receipt.active, false); assert.deepEqual(view.events, ['start', 'end']);
    assert.deepEqual(receipt.transform, reserved.transform, 'late cancelled gesture events cannot alter the committed pose');
  } finally { view.dispose(); }
});

test('falha da escrita bloqueada emite cancel do mesmo operationId e não confirmação obsoleta', async () => {
  const view = harness({ interactive: true, asyncShared: true, worklets: true });
  let rejectWrite;
  try {
    view.update({ onCommitRect: (id, transform) => {
      view.commits.push({ id, transform }); return new Promise((_, reject) => { rejectWrite = reject; });
    } }); view.flushUI();
    const pinch = view.getGesture('pinch');
    pinch.handlers.onStart({ focalX: 160, focalY: 72, numberOfPointers: 2 }); view.flush();
    pinch.handlers.onEnd({ scale: 1.5, focalX: 180, focalY: 80, numberOfPointers: 2 }, true); view.flush();
    const reserved = { ...view.transformChannel.value };
    view.update({ disabled: true }); view.flushUI(); view.flush();
    rejectWrite(new Error('Disco indisponível')); await view.pump();
    const receipt = view.transformChannel.value;
    assert.equal(receipt.operationId, reserved.operationId); assert.equal(receipt.epoch, reserved.epoch);
    assert.equal(receipt.finish, 'cancel'); assert.equal(receipt.active, false); assert.equal(view.commits.length, 1);
    assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

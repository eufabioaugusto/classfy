import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as geometry from './canvasGeometry.ts';
import { emptyStudioEditing, addStudioLayerItem, createStudioTextItem, compileStudioRecipe, patchStudioLayerItem, studioTicks } from './model.ts';

const source = readFileSync(new URL('./StudioCanvasEditor.tsx', import.meta.url), 'utf8');
const equal = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function harness(options = {}) {
  let editing = emptyStudioEditing('aula');
  editing.assets.push({ id: 'source', kind: 'video', uri: 'file:///original.mov', name: 'Original', durationTicks: studioTicks(4) });
  editing.main.push({ id: 'main', assetId: 'source', sourceStartTicks: 0, sourceEndTicks: studioTicks(4) });
  editing = addStudioLayerItem(editing, { ...createStudioTextItem({ id: 'title', content: 'Texto real', durationTicks: studioTicks(2) }), rect: { x: 0.3, y: 0.3, width: 0.4, height: 0.2 } });
  const contexts = new Map(), queue = [], selections = [], previews = [], commits = [], events = [], edits = [], playback = [];
  let current, now = 1000, resolveCommit;
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
      return (...args) => { if (String(property).startsWith('on')) handlers[property] = args[0]; else configuration[property] = args[0]; return chain; };
    } });
    return chain;
  };
  const dependencies = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'view', Text: 'text', StyleSheet: { create: value => value, absoluteFill: {}, absoluteFillObject: {} } },
    'react-native-reanimated': { __esModule: true, default: { View: 'animated-view' }, useSharedValue: value => hooks.useRef({ value }).current,
      useAnimatedStyle: callback => { const ref = hooks.useRef(callback); ref.current = callback; return { getStyle: () => ref.current() }; },
      runOnJS: callback => (...args) => queue.push(() => callback(...args)) },
    'react-native-gesture-handler': { GestureDetector: 'detector', Gesture: {
      Pan: () => gesture('pan'), Pinch: () => gesture('pinch'), Tap: () => gesture('tap'),
      Race: (...items) => ({ kind: 'race', items }), Simultaneous: (...items) => ({ kind: 'simultaneous', items }), Exclusive: (...items) => ({ kind: 'exclusive', items }),
    } },
    './canvasGeometry': geometry,
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', 'Date', compiled)(name => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports, { now: () => now });
  let props = { editing, recipe: compileStudioRecipe({ kind: 'aula', takes: [], editing }), positionSeconds: 1, selectedLayerId: 'title',
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
    for (const [id, context] of contexts) if (id !== 'root' && !active.has(id)) { for (const slot of context.slots) slot?.cleanup?.(); contexts.delete(id); }
    for (const node of nodes) render(node.props.clip.id, node.type, node.props);
    return parent;
  };
  const flatten = value => Array.isArray(value.items) ? value.items.flatMap(flatten) : [value];
  const body = (id = 'title') => flatten(scope(id).tree.props.gesture);
  const getGesture = (kind, id = 'title', double = false) => body(id).find(value => value.kind === kind && (kind !== 'tap' || (value.configuration.numberOfTaps === 2) === double));
  const flush = () => { while (queue.length) queue.shift()(); };
  const pump = async () => { flush(); await new Promise(resolve => setImmediate(resolve)); draw(); };
  draw(); scope('root').tree.props.onLayout({ nativeEvent: { layout: { width: 320, height: 300 } } }); draw();
  return { selections, previews, commits, events, edits, playback, queue, getGesture, body, flush, pump,
    update: next => { props = { ...props, ...next }; draw(); },
    layout: (width, height) => { scope('root').tree.props.onLayout({ nativeEvent: { layout: { width, height } } }); draw(); },
    echo: transform => { const next = patchStudioLayerItem(props.editing, 'title', { rect: transform.rect, ...(transform.textFontSize ? { text: { fontSize: transform.textFontSize } } : {}) }); props = { ...props, editing: next, recipe: compileStudioRecipe({ kind: 'aula', takes: [], editing: next }) }; draw(); },
    setNow: value => { now = value; },
    handle: (index, id = 'title') => findAll(scope(id).tree, node => typeof node.type === 'function' && node.type.name === 'CanvasCornerHandle')[index].props.gesture,
    frame: id => scope(id || 'title').tree.props.children.props.style.find(value => value?.getStyle)?.getStyle(),
    visibleIds: () => [...contexts.keys()].filter(id => id !== 'root'),
    recipe: () => props.recipe,
    resolve: () => { assert.ok(resolveCommit); resolveCommit(); },
    dispose: () => { for (const context of contexts.values()) for (const slot of context.slots) slot?.cleanup?.(); },
  };
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
    assert.equal(view.getGesture('pan', 'main').configuration.activateAfterLongPress, 150);
  } finally { view.dispose(); }
});

test('pinça usa focal inicial fora do centro e ignora coordenadas locais que mudam ao escalar', async () => {
  const view = harness();
  try {
    const pinch = view.getGesture('pinch'); pinch.handlers.onStart({ focalX: 32, focalY: 9 }); view.flush();
    pinch.handlers.onUpdate({ scale: 1.2, focalX: 26.6667, focalY: 7.5 }); view.flush();
    pinch.handlers.onEnd({ scale: 1.5, focalX: 21.3333, focalY: 6 }); pinch.handlers.onFinalize({}, true); await view.pump();
    assert.equal(view.commits.length, 1); const { rect } = view.commits[0].transform;
    near(rect.x * 320 + 32 * 1.5, 0.3 * 320 + 32);
    near(rect.y * 180 + 9 * 1.5, 0.3 * 180 + 9);
    near(rect.width, 0.6); near(rect.height, 0.3); assert.deepEqual(view.events, ['start', 'end']);
  } finally { view.dispose(); }
});

test('pinça do principal mantém ponto tocado, sem seleção artificial ou playback', async () => {
  const view = harness({ props: { selectedLayerId: undefined, selectedMainClipId: 'main', onSelectMainClip: () => {} } });
  try {
    const pinch = view.getGesture('pinch', 'main'); pinch.handlers.onStart({ focalX: 64, focalY: 45 }); view.flush();
    pinch.handlers.onEnd({ scale: 1.5, focalX: 42.6667, focalY: 30 }); pinch.handlers.onFinalize({}, true); await view.pump();
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

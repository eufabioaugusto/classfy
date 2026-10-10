import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformFileSync } from '@babel/core';
import ts from 'typescript';
import * as model from './model.ts';
import { initialStudioCanvasTransformChannel } from './canvasTransformChannel.ts';
const require = createRequire(import.meta.url);
const reanimatedSource = join(dirname(require.resolve('react-native-reanimated/package.json')), 'src');
const moduleSources = new Map();
function installedModule(path, dependencies) {
  if (!moduleSources.has(path)) moduleSources.set(path, ts.transpileModule(readFileSync(join(reanimatedSource, path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', moduleSources.get(path))(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected installed dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
let nativeCompiled;
const compileNative = () => nativeCompiled ||= transformFileSync(fileURLToPath(new URL('./StudioCompositionPreview.tsx', import.meta.url)), {
  presets: [require.resolve('babel-preset-expo', { paths: [dirname(require.resolve('expo/package.json'))] })],
  plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  caller: { name: 'metro', supportsStaticESM: true, isDev: true, platform: 'ios' },
}).code;

const take = id => ({ id, uri: `file:///${id}.mp4`, name: id, duration: 10, start: 2, end: 8, width: 1920, height: 1080 });
function project() {
  const editing = model.reconcileStudioTakes({ kind: 'aula', editing: model.emptyStudioEditing('aula') }, [take('a'), take('b')]);
  return model.withStudioTakes({ id: 'project', ownerId: 'owner', kind: 'aula', revision: 1, version: 1,
    state: 'draft', title: '', objective: '', audience: '', script: '', editing });
}
function graded(value) {
  return model.withStudioTakes({ ...value, revision: value.revision + 1,
    editing: { ...value.editing, main: value.editing.main.map((clip, index) => index ? clip : { ...clip, grade: model.studioGrade('studio') }) } });
}

// Execute the production wrapper and NativePreview hooks, imperative handle,
// native event handlers and promise continuations. AVPlayer's async command
// completion is stubbed independently from periodic events and React renders.
function harness({ available = true, initialProject = project(), playbackChannel, nativeRuntime = false, interactive = false, capability = { version: 1, available: true } } = {}) {
  const slots = []; let cursor = 0, dirty = true, effects = [], tree, nativeProps;
  const published = [], selected = [], calls = [];
  const uiQueue = [], jsQueue = [], registrations = new Map();
  let registrationId = 0, uiRuntime = false, nativeManager, rawNativeProps;
  const nativeStats = { wrappers: 0, registrations: [], uiWrites: 0, events: [] };
  const onUI = callback => (...args) => {
    const previous = uiRuntime; uiRuntime = true;
    try { return callback(...args); } finally { uiRuntime = previous; }
  };
  const shared = initial => {
    let value = initial;
    return { get value() { return value; }, set value(next) {
      if (nativeRuntime && !uiRuntime) uiQueue.push(() => { value = next; });
      else { value = next; nativeStats.uiWrites++; }
    } };
  };
  const channel = playbackChannel ? shared({ active: false, sequence: 0, position: 0, playing: false, loading: false }) : undefined;
  const transformChannel = interactive ? shared(initialStudioCanvasTransformChannel()) : undefined;
  let timerSequence = 0, now = 0;
  const timers = new Map();
  const setTimer = (callback, delay) => { const id = ++timerSequence; timers.set(id, { callback, at: now + delay }); return id; };
  const clearTimer = id => { timers.delete(id); };
  const ref = { current: null };
  const equals = (a, b) => !!a && !!b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const hooks = {
    forwardRef: callback => callback,
    useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; },
    useState: initial => {
      const index = cursor++;
      slots[index] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useMemo: (callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || !equals(slots[index].dependencies, dependencies)) slots[index] = { value: callback(), dependencies };
      return slots[index].value;
    },
    useEffect: (callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || !equals(slots[index].dependencies, dependencies)) effects.push({ index, callback, dependencies });
    },
    useImperativeHandle: (target, callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || !equals(slots[index].dependencies, dependencies)) {
        slots[index] = { dependencies }; target.current = callback();
      }
    },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const utils = installedModule('createAnimatedComponent/utils.ts', {});
  const workletHandlers = installedModule('WorkletEventHandler.ts', {
    './common': { SHOULD_BE_USE_WEB: false }, './core': {
      registerEventHandler: (callback, eventName, tag) => {
        if (nativeRuntime) assert.equal(typeof callback.__workletHash, 'number', `${eventName} must be a Metro worklet`);
        const id = ++registrationId; registrations.set(id, { callback, eventName, tag });
        nativeStats.registrations.push({ eventName, tag }); return id;
      }, unregisterEventHandler: id => registrations.delete(id),
    },
  });
  const useEvent = installedModule('hook/useEvent.ts', { react: hooks, '../WorkletEventHandler': workletHandlers }).useEvent;
  const EventsManager = installedModule('createAnimatedComponent/NativeEventsManager.ts', {
    '../platformFunctions/findNodeHandle': { findNodeHandle: value => typeof value === 'number' ? value : value?.tag },
    '../WorkletEventHandler': workletHandlers, './utils': utils,
  }).NativeEventsManager;
  const PropsFilter = installedModule('createAnimatedComponent/PropsFilter.tsx', {
    '../animation': { initialUpdaterRun: callback => callback() },
    '../isSharedValue': { isSharedValue: value => !!value && typeof value === 'object' && 'value' in value },
    '../WorkletEventHandler': workletHandlers,
    './InlinePropManager': { hasInlineStyles: () => false, getInlineStyle: value => value }, './utils': utils,
  }).PropsFilter;
  const reanimated = { __esModule: true,
    default: { createAnimatedComponent: () => { nativeStats.wrappers++; return 'animated-native-canvas'; } },
    useSharedValue: initial => { const ref = hooks.useRef(null); return ref.current ||= shared(initial); },
    useAnimatedProps: callback => {
      if (nativeRuntime) assert.equal(typeof callback.__workletHash, 'number', 'animatedProps must use a Metro worklet');
      const value = hooks.useRef(callback); value.current = callback;
      return { initial: { value: onUI(callback)() }, getProps: () => onUI(value.current)() };
    },
    useEvent,
    runOnJS: callback => (...args) => jsQueue.push(() => callback(...args)),
    runOnUI: callback => (...args) => {
      if (nativeRuntime) assert.equal(typeof callback.__workletHash, 'number', 'runOnUI must receive a Metro worklet');
      uiQueue.push(() => onUI(callback)(...args));
    },
  };
  const jsx = (type, props) => {
    if (typeof type === 'function') return type(props, props.ref);
    if (type === 'native-canvas') { nativeProps = props; rawNativeProps = props; props.ref.current = { tag: 73 }; }
    if (type === 'animated-native-canvas') {
      rawNativeProps = props;
      const component = { props, _componentRef: { tag: 73 }, _isFirstRender: true, getComponentViewTag: () => 73 };
      nativeProps = new PropsFilter().filterNonAnimatedProps(component); props.ref.current = { tag: 73 };
      if (nativeManager) { const previous = nativeManager.component.props; nativeManager.component.props = props; nativeManager.manager.updateEvents(previous); }
      else { nativeManager = { component, manager: new EventsManager(component) }; nativeManager.manager.attachEvents(); }
    }
    return { type, props };
  };
  const command = (kind, args) => new Promise((resolve, reject) => { calls.push({ kind, args, resolve, reject }); });
  const dependencies = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react/jsx-dev-runtime': { jsxDEV: jsx },
    'react-native-reanimated': reanimated,
    'react-native': { View: 'view', Text: 'text', findNodeHandle: value => value?.tag,
      StyleSheet: { create: styles => styles, absoluteFill: {}, absoluteFillObject: {} } },
    'expo-modules-core': { requireNativeViewManager: () => 'native-canvas' },
    '../../../modules/classfy-studio-media': { isStudioCompositionAvailable: () => available,
      isStudioInteractiveCompositionAvailable: () => interactive,
      getStudioInteractiveCompositionVersionAsync: () => Promise.resolve(capability),
      seekStudioCompositionAsync: (...args) => command('seek', args),
      previewStudioCompositionSourceAsync: (...args) => command('source', args) },
    './model': model, './StudioPreview': { StudioPreview: 'legacy-preview' },
  };
  const code = nativeRuntime ? compileNative() : ts.transpileModule(readFileSync(new URL('./StudioCompositionPreview.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith('@babel/runtime/')) return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports, setTimer, clearTimer);
  const component = module.exports.StudioCompositionPreview;
  let props = { project: initialProject, activeTakeId: 'a', playbackChannel: channel, canvasTransformChannel: transformChannel, onPlaybackState: value => published.push(value), onActiveTakeChange: id => selected.push(id) };
  function render() {
    dirty = false; cursor = 0; effects = []; nativeProps = undefined;
    tree = component(props, ref);
    for (const effect of effects) {
      slots[effect.index]?.cleanup?.();
      slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() };
    }
  }
  async function pump() {
    for (let pass = 0; pass < 20; pass++) {
      if (dirty) render();
      for (const job of uiQueue.splice(0)) job();
      for (const job of jsQueue.splice(0)) job();
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty && !uiQueue.length && !jsQueue.length) return;
    }
    throw new Error('Composition preview did not settle');
  }
  const state = overrides => ({ positionSeconds: 3, sourcePositionSeconds: 5, clipId: 'a', playing: false,
    loading: false, revision: nativeProps.revision, token: calls.at(-1)?.args.at(-1) || 0, ...overrides });
  const nodes = value => !value ? [] : Array.isArray(value) ? value.flatMap(nodes)
    : typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [value];
  const dispatch = (eventName, payload) => {
    const registered = [...registrations.values()].filter(value => value.eventName === eventName && value.tag === 73);
    if (registered.length) {
      nativeStats.events.push(eventName);
      for (const entry of registered) onUI(entry.callback)({ ...payload, eventName });
    } else nativeProps[eventName]({ nativeEvent: payload });
  };
  return { ref, calls, published, selected, pump, channel, nativeStats, transformChannel,
    rawCanvas: () => rawNativeProps,
    flushUI: () => { for (const job of uiQueue.splice(0)) job(); },
    flushJS: () => { for (const job of jsQueue.splice(0)) job(); },
    flushRender: () => { if (dirty) render(); },
    advance: milliseconds => {
      now += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    pendingTimers: () => timers.size,
    dispose: () => { for (const slot of slots) slot?.cleanup?.(); nativeManager?.manager.detachEvents(); },
    update: patch => { props = { ...props, ...patch }; dirty = true; },
    project: () => props.project, canvas: () => nativeProps, tree: () => tree,
    state, emit: overrides => dispatch('onPlaybackState', state(overrides)),
    error: (message, overrides = {}) => dispatch('onError', { revision: nativeProps.revision, token: calls.at(-1)?.args.at(-1) || 0, message, ...overrides }),
    text: () => nodes(tree).filter(value => typeof value === 'string').join(' '),
    has: type => nodes(tree).some(value => value?.type === type),
  };
}

test('erro nativo permanece visível durante periodic publish; somente comando confirmado o limpa', async () => {
  const h = harness(); await h.pump();
  h.error('Não foi possível renderizar a edição.'); await h.pump();
  assert.match(h.text(), /Não foi possível renderizar/);
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6 }); await h.pump();
  assert.match(h.text(), /Não foi possível renderizar/);
  h.ref.current.seek(4); await h.pump();
  assert.match(h.text(), /Não foi possível renderizar/, 'pending seek cannot hide a native failure');
  h.calls.at(-1).resolve(h.state({ positionSeconds: 4 })); await h.pump();
  assert.doesNotMatch(h.text(), /Não foi possível renderizar/);
});

test('prévia de projeto 4K60 usa receita HD30 compatível sem mudar saída, fontes, tempo ou tratamento', async () => {
  const base = graded(project());
  const value = { ...base, editing: { ...base.editing, output: { profile: 'standard', width: 3840, height: 2160, frameRateNumerator: 60,
    frameRateDenominator: 1, colorSpace: 'rec709', selection: { resolution: '4k', frameRate: 60 } } } };
  const canonical = model.compileStudioRecipe(value);
  const original = structuredClone(canonical);
  const h = harness({ initialProject: value, playbackChannel: true, nativeRuntime: true });
  h.update({ recipe: canonical }); await h.pump();
  const preview = JSON.parse(h.canvas().recipeJSON);
  assert.deepEqual(preview.output, { profile: 'standard', width: 1920, height: 1080,
    frameRateNumerator: 30, frameRateDenominator: 1, colorSpace: 'rec709' });
  assert.deepEqual(preview.clips, JSON.parse(JSON.stringify(canonical.clips)));
  assert.deepEqual(preview.assets, JSON.parse(JSON.stringify(canonical.assets)));
  assert.equal(preview.durationTicks, canonical.durationTicks);
  assert.deepEqual(canonical, original, 'preview never mutates the recipe used by export');
  assert.equal(value.editing.output.width, 3840);
  assert.equal(value.editing.output.frameRateNumerator, 60);
});

test('trocar somente perfil final não reinicia a prévia nem descarta um Play confirmado', async () => {
  const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ playing: true, positionSeconds: 2.4 }); await h.pump();
  const previous = { recipe: h.canvas().recipeJSON, revision: h.canvas().revision, calls: h.calls.length };
  const value = h.project();
  h.update({ project: { ...value, editing: { ...value.editing,
    output: { ...value.editing.output, width: 2560, height: 1440, frameRateNumerator: 24,
      selection: { resolution: '2k', frameRate: 24 } } } } }); await h.pump();
  assert.equal(h.canvas().recipeJSON, previous.recipe);
  assert.equal(h.canvas().revision, previous.revision);
  assert.equal(h.canvas().paused, false);
  assert.equal(h.channel.value.playing, true);
  assert.equal(h.channel.value.position, 2.4);
  assert.equal(h.calls.length, previous.calls, 'no extra seek or source command');
});

test('prévia mantém o canvas retrato/quadrado com teto HD30 inclusive de Original fracional', async () => {
  for (const [aspectRatio, width, height] of [['portrait', 1080, 1920], ['square', 1080, 1080]]) {
    const base = project();
    const value = { ...base, editing: { ...base.editing, canvas: { ...base.editing.canvas, aspectRatio },
      output: { profile: 'standard', width: aspectRatio === 'portrait' ? 2160 : 1440,
      height: aspectRatio === 'portrait' ? 3840 : 1440, frameRateNumerator: 60000,
      frameRateDenominator: 1001, colorSpace: 'rec709' } } };
    const h = harness({ initialProject: value }); await h.pump();
    assert.deepEqual(JSON.parse(h.canvas().recipeJSON).output,
      { profile: 'standard', width, height, frameRateNumerator: 30, frameRateDenominator: 1, colorSpace: 'rec709' });
  }
});

test('retry confirmado de frame limpa erro do corte sem alterar a âncora de reprodução', async () => {
  const h = harness(); await h.pump();
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6 }); await h.pump();
  const count = h.published.length;
  h.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 9 });
  h.calls.at(-1).reject(new Error('Falha temporária ao ler o quadro.')); await h.pump();
  assert.match(h.text(), /Falha temporária/);
  h.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 8.5 });
  const retry = h.calls.at(-1);
  h.emit({ clipId: 'b', sourcePositionSeconds: 8.5 }); await h.pump();
  assert.match(h.text(), /Falha temporária/, 'periodic event is not proof of frame rendering');
  retry.resolve(h.state({ clipId: 'b', sourcePositionSeconds: 8.5 })); await h.pump();
  assert.doesNotMatch(h.text(), /Falha temporária/);
  assert.equal(h.published.length, count);
  assert.equal(h.published.at(-1).position, 4);
});

test('reprodução confirmada recupera erro de áudio; periodic playing não esconde falha de composição', async () => {
  const h = harness(); await h.pump();
  h.error('Não foi possível renderizar.', { code: 'E_STUDIO_COMPOSITION' }); await h.pump();
  h.emit({ playing: true }); await h.pump();
  assert.match(h.text(), /Não foi possível renderizar/);
  h.error('Não foi possível ativar o som.', { code: 'E_STUDIO_AUDIO_SESSION' }); await h.pump();
  h.emit({ playing: false, loading: true }); await h.pump();
  assert.match(h.text(), /Não foi possível ativar o som/);
  h.ref.current.togglePlayback(); await h.pump();
  assert.match(h.text(), /Não foi possível ativar o som/, 'tentar play não confirma ativação');
  h.emit({ playing: true, loading: false }); await h.pump();
  assert.doesNotMatch(h.text(), /Não foi possível ativar o som/);
});

test('rejeição de seek da receita anterior não aparece depois de alterar o tratamento', async () => {
  const h = harness(); await h.pump();
  h.ref.current.seek(3); const old = h.calls.at(-1); const revision = h.canvas().revision;
  h.update({ project: graded(h.project()) }); await h.pump();
  assert.notEqual(h.canvas().revision, revision);
  old.reject(new Error('Preparação cancelada da receita anterior.')); await h.pump();
  assert.doesNotMatch(h.text(), /receita anterior/);
  assert.equal(h.calls.length, 1);
});

test('rejeição e evento de frame antigo respeitam tanto a revisão quanto o token', async () => {
  const h = harness(); await h.pump();
  h.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 9 });
  const old = h.calls.at(-1); const oldRevision = h.canvas().revision;
  h.update({ before: true }); await h.pump();
  old.reject(new Error('Frame da receita anterior falhou.'));
  h.error('Erro nativo anterior.', { revision: oldRevision, token: old.args.at(-1) }); await h.pump();
  assert.doesNotMatch(h.text(), /anterior/);
  h.ref.current.seek(2);
  h.error('Erro de token antigo.', { token: old.args.at(-1) }); await h.pump();
  assert.doesNotMatch(h.text(), /token antigo/);
});

test('selecionar outro take, pausar e alterar tratamento não envia seek nem muda o cursor', async () => {
  const h = harness(); await h.pump();
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6 }); await h.pump();
  h.ref.current.pause(); h.update({ activeTakeId: 'b' }); await h.pump();
  h.update({ project: graded(h.project()) }); await h.pump();
  assert.equal(h.calls.length, 0);
  assert.equal(h.published.at(-1).position, 4);
  const recipe = JSON.parse(h.canvas().recipeJSON);
  assert.equal(recipe.clips.find(clip => clip.id === 'a').grade.preset, 'studio');
});

test('pausa publica o relógio parado imediatamente e vence playing antigo até um novo Play', async () => {
  const h = harness(); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6, playing: true }); await h.pump();
  const count = h.published.length;
  h.ref.current.pause();
  assert.equal(h.published.length, count + 1, 'pause must freeze before React or a native acknowledgement');
  assert.deepEqual(h.published.at(-1), { position: 4, sourcePosition: 6, takeId: 'a', playing: false, loading: false });
  h.emit({ positionSeconds: 4.1, sourcePositionSeconds: 6.1, playing: true });
  await h.pump();
  h.emit({ positionSeconds: 4.2, sourcePositionSeconds: 6.2, playing: true }); await h.pump();
  assert.equal(h.published.length, count + 1, 'queued playing events cannot move or resume the paused clock');
  assert.equal(h.canvas().paused, true);
  assert.equal(h.calls.length, 0, 'pausing cannot seek or rebuild the player');
  h.emit({ positionSeconds: 4.15, sourcePositionSeconds: 6.15, playing: false }); await h.pump();
  assert.equal(h.published.at(-1).position, 4.15, 'the native pause acknowledgement remains authoritative');
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 4.15, sourcePositionSeconds: 6.15, playing: false, loading: true }); await h.pump();
  assert.equal(h.canvas().paused, false, 'loading must preserve the renewed Play intention');
  h.emit({ positionSeconds: 4.3, sourcePositionSeconds: 6.3, playing: true }); await h.pump();
  assert.equal(h.published.at(-1).playing, true);
  assert.equal(h.published.at(-1).position, 4.3);
});

test('toggle para pausa e EOF impedem que um evento enfileirado reative a reprodução', async () => {
  const h = harness(); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ playing: true }); await h.pump();
  h.ref.current.togglePlayback();
  assert.equal(h.published.at(-1).playing, false);
  const pausedCount = h.published.length;
  h.emit({ playing: true }); await h.pump();
  assert.equal(h.published.length, pausedCount);
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ playing: true }); await h.pump();
  h.emit({ positionSeconds: 12, clipId: 'b', playing: false }); await h.pump();
  const eofCount = h.published.length;
  h.emit({ positionSeconds: 11.9, clipId: 'b', playing: true }); await h.pump();
  assert.equal(h.published.length, eofCount, 'automatic EOF pause also owns the pause intention');
  assert.equal(h.published.at(-1).position, 12);
  assert.equal(h.canvas().paused, true);
  assert.equal(h.calls.length, 0);
});

test('Play vence paused antigo pré-confirmação; playing confirmado cancela a recusa pendente', async () => {
  const h = harness(); await h.pump();
  h.emit({ positionSeconds: 0, sourcePositionSeconds: 2 }); await h.pump();
  const count = h.published.length;
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 0, sourcePositionSeconds: 2, playing: false, loading: false }); await h.pump();
  assert.equal(h.canvas().paused, false, 'the old paused snapshot must not replace the new Play intention');
  assert.equal(h.published.length, count, 'a pre-Play snapshot is not a new playback position');
  assert.equal(h.pendingTimers(), 1, 'a native refusal without an error cannot remain pending indefinitely');
  h.emit({ positionSeconds: 0.1, sourcePositionSeconds: 2.1, playing: true }); await h.pump();
  assert.equal(h.published.at(-1).playing, true);
  assert.equal(h.canvas().paused, false);
  assert.equal(h.pendingTimers(), 0);
  h.advance(3000); await h.pump();
  assert.equal(h.canvas().paused, false, 'a cancelled refusal deadline cannot stop confirmed playback');
  assert.equal(h.calls.length, 0);
});

test('preparação conhecida mantém Play pendente sem limite de recusa e EOF confirmado pausa normalmente', async () => {
  const h = harness(); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ playing: false, loading: false }); await h.pump();
  assert.equal(h.pendingTimers(), 1);
  h.emit({ playing: false, loading: true }); await h.pump();
  assert.equal(h.pendingTimers(), 0);
  h.advance(10000); await h.pump();
  assert.equal(h.canvas().paused, false, 'an acknowledged build/replay is not a failed start');
  assert.equal(h.published.at(-1).loading, true);
  h.emit({ positionSeconds: 0, playing: true, loading: false }); await h.pump();
  h.emit({ positionSeconds: 12, clipId: 'b', playing: false, loading: false }); await h.pump();
  assert.equal(h.canvas().paused, true, 'EOF after the first playing acknowledgement is an authoritative pause');
  assert.equal(h.published.at(-1).position, 12);
  assert.equal(h.pendingTimers(), 0);
});

test('pausa explícita e onError atual vencem Play pendente; erros anteriores não cancelam a nova tentativa', async () => {
  const h = harness(); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ playing: false }); await h.pump();
  h.ref.current.pause(); await h.pump();
  assert.equal(h.canvas().paused, true);
  assert.equal(h.pendingTimers(), 0);
  h.emit({ playing: true }); await h.pump();
  assert.ok(h.published.every(value => !value.playing));
  h.ref.current.togglePlayback(); await h.pump();
  h.error('Erro de uma revisão anterior.', { revision: 'outro-projeto:0' }); await h.pump();
  assert.equal(h.canvas().paused, false);
  h.error('Não foi possível ativar o som.', { code: 'E_STUDIO_AUDIO_SESSION' }); await h.pump();
  assert.equal(h.canvas().paused, true);
  assert.equal(h.pendingTimers(), 0);
  assert.match(h.text(), /Não foi possível ativar o som/);
  h.emit({ playing: true }); await h.pump();
  assert.match(h.text(), /Não foi possível ativar o som/, 'a late playing snapshot is not permission to erase a failed start');
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ playing: true }); await h.pump();
  assert.equal(h.canvas().paused, false);
  assert.doesNotMatch(h.text(), /Não foi possível ativar o som/);
});

test('recusa nativa sem onError libera a tentativa; retry e desmontagem invalidam o limite antigo', async () => {
  const h = harness(); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ playing: false, loading: false }); await h.pump();
  h.advance(1999); await h.pump();
  assert.equal(h.canvas().paused, false);
  h.advance(1); await h.pump();
  assert.equal(h.canvas().paused, true);
  assert.match(h.text(), /A prévia não iniciou/);
  assert.equal(h.pendingTimers(), 0);
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ playing: true }); await h.pump();
  assert.equal(h.published.at(-1).playing, true);
  assert.doesNotMatch(h.text(), /A prévia não iniciou/);
  h.ref.current.pause(); h.ref.current.togglePlayback(); await h.pump();
  h.emit({ playing: false }); await h.pump();
  assert.equal(h.pendingTimers(), 1);
  h.dispose();
  assert.equal(h.pendingTimers(), 0, 'unmount releases the pending deadline');
  const count = h.published.length;
  h.advance(3000);
  assert.equal(h.published.length, count);
  assert.equal(h.calls.length, 0);
});

test('seek e inspeção congelam o relógio antes da operação nativa sem publicar frames temporários', async () => {
  const h = harness(); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6, playing: true }); await h.pump();
  h.ref.current.seek(7);
  assert.deepEqual(h.published.at(-1), { position: 4, sourcePosition: 6, takeId: 'a', playing: false, loading: false });
  const seek = h.calls.at(-1), count = h.published.length;
  h.emit({ positionSeconds: 4.1, playing: true, token: seek.args.at(-1) }); await h.pump();
  assert.equal(h.published.length, count, 'even a current-token playing event cannot defeat seek pause');
  seek.resolve(h.state({ positionSeconds: 7, sourcePositionSeconds: 3, clipId: 'b' })); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 7.1, sourcePositionSeconds: 3.1, clipId: 'b', playing: true }); await h.pump();
  h.ref.current.previewSourceFrame({ takeId: 'a', uri: 'file:///a.mp4', seconds: 1 });
  const frame = h.calls.at(-1), frozen = h.published.length;
  assert.equal(h.published.at(-1).playing, false);
  assert.equal(h.published.at(-1).position, 7.1);
  assert.equal(frame.kind, 'source');
  assert.equal(frame.args[3], 7.1, 'frame inspection keeps the playback anchor');
  h.emit({ positionSeconds: 7.2, clipId: 'a', sourcePositionSeconds: 1, playing: true });
  frame.resolve(h.state({ clipId: 'a', sourcePositionSeconds: 1 })); await h.pump();
  assert.equal(h.published.length, frozen, 'source frames never become playback samples');
  assert.equal(h.canvas().paused, true);
});

test('replay no EOF mantém intenção de reproduzir durante seek; seek posterior cancela eventos antigos', async () => {
  const h = harness(); await h.pump();
  const end = model.studioSeconds(model.compileStudioRecipe(h.project()).durationTicks);
  h.emit({ positionSeconds: end, sourcePositionSeconds: 8, clipId: 'b' }); await h.pump();
  assert.equal(h.canvas().paused, true);
  h.ref.current.togglePlayback(); await h.pump();
  assert.equal(h.canvas().paused, false);
  // AVPlayer has stopped at EOF and its asynchronous replay seek is pending.
  // This native contract must not let the periodic event undo the user's Play.
  h.emit({ positionSeconds: end, playing: false, loading: true }); await h.pump();
  assert.equal(h.canvas().paused, false);
  assert.equal(h.published.at(-1).loading, true);
  h.emit({ positionSeconds: 0, sourcePositionSeconds: 2, clipId: 'a', playing: true }); await h.pump();
  assert.equal(h.canvas().paused, false);
  assert.equal(h.published.at(-1).playing, true);
  assert.equal(h.published.at(-1).position, 0);

  h.emit({ positionSeconds: end, playing: false }); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: end, playing: false, loading: true }); await h.pump();
  h.ref.current.seek(4); const cancel = h.calls.at(-1); await h.pump();
  const count = h.published.length;
  h.emit({ positionSeconds: 0, playing: true, token: 0 }); await h.pump();
  assert.equal(h.canvas().paused, true, 'new seek cancels the pending replay intention');
  assert.equal(h.published.length, count, 'old replay cannot move the newer cursor');
  cancel.resolve(h.state({ positionSeconds: 4, sourcePositionSeconds: 6, clipId: 'a' })); await h.pump();
  assert.equal(h.published.at(-1).position, 4);
  assert.equal(h.canvas().paused, true);
});

test('antes e depois mantêm fontes e tempos da montagem e removem apenas o grade do original', async () => {
  const h = harness({ initialProject: graded(project()) }); await h.pump();
  const after = JSON.parse(h.canvas().recipeJSON); const revision = h.canvas().revision;
  h.update({ before: true }); await h.pump();
  const before = JSON.parse(h.canvas().recipeJSON);
  assert.notEqual(h.canvas().revision, revision);
  assert.deepEqual(before.assets, after.assets);
  assert.deepEqual(before.clips.map(clip => [clip.id, clip.startTicks, clip.sourceStartTicks, clip.sourceEndTicks]),
    after.clips.map(clip => [clip.id, clip.startTicks, clip.sourceStartTicks, clip.sourceEndTicks]));
  assert.equal(before.clips[0].grade.intensity, 0);
  assert.equal(h.calls.length, 0);
});

test('seek mais novo vence conclusão e periodic event antigos sem trocar a seleção manual', async () => {
  const h = harness(); await h.pump();
  h.ref.current.seek(2); const first = h.calls.at(-1);
  h.ref.current.seek(7); const second = h.calls.at(-1);
  assert.ok(second.args.at(-1) > first.args.at(-1));
  second.resolve(h.state({ positionSeconds: 7, sourcePositionSeconds: 3, clipId: 'b' })); await h.pump();
  const count = h.published.length;
  first.resolve(h.state({ positionSeconds: 2, token: first.args.at(-1) }));
  h.emit({ positionSeconds: 2, token: first.args.at(-1) }); await h.pump();
  assert.equal(h.published.length, count);
  assert.equal(h.published.at(-1).position, 7);
  assert.deepEqual(h.selected, ['b']);
});

test('trim inspeciona o original com tokens crescentes e restaura âncora sem publicar o frame temporário', async () => {
  const h = harness(); await h.pump();
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6 }); await h.pump();
  const count = h.published.length;
  h.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 1 });
  const first = h.calls.at(-1);
  assert.deepEqual(first.args.slice(0, -1), [73, 'b', 1, 4]);
  h.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 9 });
  const latest = h.calls.at(-1);
  assert.ok(latest.args.at(-1) > first.args.at(-1));
  h.emit({ clipId: 'b', sourcePositionSeconds: 9, token: latest.args.at(-1) }); await h.pump();
  assert.equal(h.published.length, count);
  assert.equal(h.published.at(-1).position, 4);
  assert.equal(h.calls.filter(call => call.kind === 'seek').length, 0);
  h.ref.current.seek(4); const restore = h.calls.at(-1);
  assert.ok(restore.args.at(-1) > latest.args.at(-1));
  h.emit({ clipId: 'b', sourcePositionSeconds: 9, token: latest.args.at(-1) });
  restore.resolve(h.state({ positionSeconds: 4, sourcePositionSeconds: 6, clipId: 'a' })); await h.pump();
  assert.equal(h.published.at(-1).position, 4);
  assert.equal(h.published.at(-1).takeId, 'a');
});

test('binário antigo bloqueia montagem com grade e só permite fallback simples sem efeitos', async () => {
  const plain = harness({ available: false }); await plain.pump();
  assert.ok(plain.has('legacy-preview'));
  const enhanced = harness({ available: false, initialProject: graded(project()) }); await enhanced.pump();
  assert.ok(!enhanced.has('legacy-preview'));
  assert.match(enhanced.text(), /Atualize o Classfy Dev/);
  enhanced.ref.current.seek(3); enhanced.ref.current.togglePlayback();
  assert.equal(enhanced.calls.length, 0);
});

test('evento Fabric alimenta canal no UI antes do JS, com nomes e tag registrados pelo Reanimated instalado', async () => {
  const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
  assert.equal(h.channel.value.active, true);
  assert.deepEqual(h.nativeStats.registrations, [{ eventName: 'onPlaybackState', tag: 73 }, { eventName: 'onError', tag: 73 }]);
  assert.ok(h.rawCanvas().onPlaybackState.workletEventHandler, 'useEvent holder must reach Animated directly');
  assert.ok(h.rawCanvas().onError.workletEventHandler);
  h.ref.current.togglePlayback(); await h.pump();
  const count = h.published.length, sequence = h.channel.value.sequence;
  h.emit({ positionSeconds: 1, playing: true });
  assert.deepEqual(h.channel.value, { active: true, sequence: sequence + 1, position: 1, playing: true, loading: false });
  assert.equal(h.published.length, count, 'React/JS is still blocked while the UI sample is already available');
  h.emit({ positionSeconds: 1.066, playing: true });
  assert.equal(h.channel.value.position, 1.066);
  assert.equal(h.channel.value.sequence, sequence + 2);
  h.flushJS();
  assert.equal(h.published.at(-1).position, 1.066);
  await h.pump();
  h.update({ activeTakeId: 'b' }); await h.pump();
  assert.equal(h.nativeStats.wrappers, 1, 'render/sample updates cannot replace the animated host');
  assert.equal(h.nativeStats.registrations.length, 2, 'unchanged native events remain registered on the original tag');
  assert.equal(h.calls.length, 0);
});

test('canal ignora pause pré-Play sem perder deadline, e pausa local vence evento UI e callback JS atrasados', async () => {
  const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  const waiting = { ...h.channel.value };
  h.emit({ positionSeconds: 0, playing: false, loading: false });
  assert.deepEqual(h.channel.value, waiting, 'old pause cannot become a visual playback sample');
  h.flushJS(); assert.equal(h.pendingTimers(), 1);
  h.emit({ positionSeconds: 1, playing: true });
  assert.equal(h.channel.value.playing, true, 'UI confirms Play before the JS acknowledgement is delivered');
  h.ref.current.pause(); h.flushUI();
  assert.equal(h.channel.value.playing, false);
  assert.equal(h.channel.value.position, 1);
  const stopped = { ...h.channel.value };
  h.emit({ positionSeconds: 1.1, playing: true });
  assert.deepEqual(h.channel.value, stopped);
  h.flushJS(); await h.pump();
  assert.equal(h.published.some(value => value.playing), false, 'the earlier accepted UI sample cannot defeat the newer JS pause intention');
  assert.equal(h.pendingTimers(), 0);
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 1, playing: false }); h.flushJS();
  h.advance(2000); h.flushUI(); await h.pump();
  assert.equal(h.channel.value.playing, false);
  assert.match(h.text(), /A prévia não iniciou/);
});

test('seek e inspeção invalidam tokens UI sem frames temporários, e revisão nova rejeita amostras anteriores', async () => {
  const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 4, playing: true }); await h.pump();
  h.ref.current.seek(7); const seek = h.calls.at(-1); h.flushUI();
  assert.equal(h.channel.value.position, 7); assert.equal(h.channel.value.playing, false);
  const pending = { ...h.channel.value };
  h.emit({ positionSeconds: 4, playing: false, token: 0 });
  h.emit({ positionSeconds: 4.1, playing: true, token: seek.args.at(-1) });
  assert.deepEqual(h.channel.value, pending);
  seek.resolve(h.state({ positionSeconds: 7, clipId: 'b' })); await h.pump();
  assert.equal(h.channel.value.position, 7);
  h.ref.current.previewSourceFrame({ takeId: 'a', uri: 'file:///a.mp4', seconds: 1 }); h.flushUI();
  const inspection = { ...h.channel.value }, oldRevision = h.canvas().revision;
  h.emit({ positionSeconds: 8, clipId: 'a', sourcePositionSeconds: 1, playing: false });
  assert.deepEqual(h.channel.value, inspection, 'source inspection is not a playback sample');
  h.ref.current.seek(7); h.calls.at(-1).resolve(h.state({ positionSeconds: 7 })); await h.pump();
  h.update({ project: graded(h.project()) }); await h.pump();
  const revised = { ...h.channel.value };
  h.emit({ positionSeconds: 2, revision: oldRevision });
  assert.deepEqual(h.channel.value, revised);
  h.emit({ positionSeconds: 7 }); await h.pump();
  assert.equal(h.channel.value.position, 7);
  assert.equal(h.channel.value.loading, false);
});

test('erro, pausa externa e EOF congelam canal antes do JS; replay com loading preserva intenção renovada', async () => {
  const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 3, playing: true }); await h.pump();
  h.error('Falha da composição.', { revision: 'outro:0' });
  assert.equal(h.channel.value.playing, true);
  h.error('Falha da composição.');
  assert.equal(h.channel.value.playing, false, 'onError freezes the native channel before React can display the error');
  const failed = { ...h.channel.value };
  h.emit({ positionSeconds: 3.1, playing: true });
  assert.deepEqual(h.channel.value, failed);
  await h.pump(); assert.match(h.text(), /Falha da composição/);
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 3.2, playing: true }); await h.pump();
  h.update({ paused: true }); await h.pump();
  const external = { ...h.channel.value };
  h.emit({ positionSeconds: 3.3, playing: true });
  assert.deepEqual(h.channel.value, external);
  h.update({ paused: false }); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 11.9, playing: true }); await h.pump();
  h.emit({ positionSeconds: 12, playing: false });
  assert.equal(h.channel.value.playing, false); assert.equal(h.channel.value.position, 12);
  h.emit({ positionSeconds: 11.95, playing: true });
  assert.equal(h.channel.value.position, 12, 'queued rate cannot restart EOF');
  await h.pump(); h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 12, playing: false, loading: true });
  assert.equal(h.channel.value.loading, true);
  await h.pump(); assert.equal(h.canvas().paused, false);
  h.emit({ positionSeconds: 0, playing: true, loading: false });
  assert.equal(h.channel.value.position, 0); assert.equal(h.channel.value.playing, true);
  await h.pump(); assert.equal(h.published.at(-1).playing, true);
});

test('canal só fica ativo no compositor montado; legado e desmontagem devolvem relógio ao fallback', async () => {
  const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
  h.ref.current.togglePlayback(); await h.pump(); h.emit({ playing: true }); await h.pump();
  assert.equal(h.channel.value.active, true);
  const delivered = h.published.length;
  h.emit({ positionSeconds: 4, playing: true });
  h.dispose(); h.flushUI();
  assert.equal(h.channel.value.active, false); assert.equal(h.channel.value.playing, false);
  const frozen = { ...h.channel.value }; h.emit({ positionSeconds: 9, playing: true }); h.flushJS();
  assert.deepEqual(h.channel.value, frozen);
  assert.equal(h.published.length, delivered, 'an accepted native event queued for JS cannot publish after unmount');
  const plain = harness({ available: false, playbackChannel: true, nativeRuntime: true }); await plain.pump();
  assert.equal(plain.channel.value.active, false);
  assert.ok(plain.has('legacy-preview')); assert.equal(plain.nativeStats.registrations.length, 0);
  const old = harness({ available: false, initialProject: graded(project()), playbackChannel: true, nativeRuntime: true }); await old.pump();
  assert.equal(old.channel.value.active, false); assert.equal(old.nativeStats.registrations.length, 0);
  const callback = harness({ nativeRuntime: true }); await callback.pump();
  callback.emit({ positionSeconds: 2 });
  assert.equal(callback.published.at(-1).position, 2, 'without a channel the existing nativeEvent callback remains synchronous');
  assert.equal(callback.nativeStats.registrations.length, 0);
});

test('troca de receita não restaura Play pendente que o UI já confirmou antes da entrega JS', async () => {
  const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 11.9, playing: true });
  assert.equal(h.channel.value.playing, true);
  // Render the recipe change before delivering the old JS acknowledgement.
  // Its JS pendingPlay ref is still true, but the native UI has confirmed Play.
  h.update({ project: graded(h.project()) }); await h.pump();
  h.emit({ positionSeconds: 12, playing: false, loading: false });
  assert.equal(h.channel.value.position, 12, 'EOF must remain authoritative after the UI acknowledgement');
  assert.equal(h.channel.value.playing, false);
  await h.pump(); assert.equal(h.canvas().paused, true);
  assert.equal(h.pendingTimers(), 0);
});

test('callbacks JS de EOF e erro anteriores não vencem uma nova intenção de reproduzir', async () => {
  const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 11.9, playing: true }); await h.pump();
  h.emit({ positionSeconds: 12, playing: false });
  h.error('Erro da intenção anterior.');
  // The UI has already stopped, but neither EOF nor error reached JS yet.
  // An explicit pause followed by Play owns the newest intent on both threads.
  h.ref.current.pause(); h.ref.current.togglePlayback(); h.flushUI();
  h.flushJS(); await h.pump();
  assert.equal(h.canvas().paused, false);
  assert.doesNotMatch(h.text(), /intenção anterior/);
  h.emit({ positionSeconds: 0, playing: false, loading: true }); await h.pump();
  h.emit({ positionSeconds: 0.1, playing: true, loading: false }); await h.pump();
  assert.equal(h.channel.value.playing, true);
  assert.equal(h.published.at(-1).playing, true);
  assert.equal(h.pendingTimers(), 0);
});

test('Promise de seek atrasada após ACK Fabric e novo Play não recua canal nem pausa a reprodução', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
    h.ref.current.seek(7); const seek = h.calls.at(-1); h.flushUI();
    h.emit({ positionSeconds: 7, sourcePositionSeconds: 3, clipId: 'b', playing: false }); await h.pump();
    h.ref.current.togglePlayback(); await h.pump();
    h.emit({ positionSeconds: 7.1, sourcePositionSeconds: 3.1, clipId: 'b', playing: true }); await h.pump();
    const sample = { ...h.channel.value }, count = h.published.length;
    // Native performSeek publishes its ACK separately before settling the
    // bridge Promise. Token/revision still match after the new Play prop.
    if (outcome === 'resolve') seek.resolve(h.state({ positionSeconds: 7, sourcePositionSeconds: 3, clipId: 'b', playing: false }));
    else seek.reject(new Error('Falha de um seek já substituído pelo Play.'));
    await h.pump();
    assert.deepEqual(h.channel.value, sample, `${outcome} cannot replace the current UI sample`);
    assert.equal(h.published.length, count);
    assert.equal(h.canvas().paused, false);
    assert.doesNotMatch(h.text(), /seek já substituído/);
    assert.equal(h.calls.length, 1, 'ignoring stale completion cannot send another native command');
  }
});

test('Promises antigas de navegação e frame não apagam nem substituem erro da intenção atual', async () => {
  for (const command of ['seek', 'source']) for (const outcome of ['resolve', 'reject']) {
    const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
    if (command === 'seek') h.ref.current.seek(7);
    else h.ref.current.previewSourceFrame({ takeId: 'a', uri: 'file:///a.mp4', seconds: 1 });
    const old = h.calls.at(-1); h.flushUI();
    if (command === 'seek') { h.emit({ positionSeconds: 7, playing: false }); await h.pump(); }
    h.ref.current.togglePlayback(); await h.pump();
    h.emit({ positionSeconds: 7.1, playing: true }); await h.pump();
    h.error('Falha atual da composição.'); await h.pump();
    const sample = { ...h.channel.value };
    if (outcome === 'resolve') old.resolve(h.state({ positionSeconds: 7, playing: false }));
    else old.reject(new Error('Erro antigo da operação de navegação.'));
    await h.pump();
    assert.match(h.text(), /Falha atual da composição/);
    assert.doesNotMatch(h.text(), /Erro antigo/);
    assert.deepEqual(h.channel.value, sample);
    assert.equal(h.canvas().paused, true);
  }
});

test('seek pendente rejeita posição anterior mesmo com token novo; alvo confirmado libera Play no UI e fallback', async () => {
  for (const playbackChannel of [true, false]) {
    const h = harness({ playbackChannel, nativeRuntime: true }); await h.pump();
    h.emit({ positionSeconds: 1.2, playing: false }); await h.pump();
    h.ref.current.seek(7); const seek = h.calls.at(-1); h.flushUI();
    const count = h.published.length, optimistic = h.channel && { ...h.channel.value };
    // claim() already assigned this token, but seekPlayer() is still awaiting
    // its exact seek. A periodic event must not masquerade as its ACK.
    h.emit({ positionSeconds: 1.2, playing: false, token: seek.args.at(-1) }); await h.pump();
    assert.equal(h.published.length, count);
    if (h.channel) assert.deepEqual(h.channel.value, optimistic);
    h.ref.current.togglePlayback(); await h.pump();
    const waiting = h.channel && { ...h.channel.value };
    h.emit({ positionSeconds: 1.3, playing: true }); await h.pump();
    assert.equal(h.published.length, count, 'Play cannot acknowledge the old position while the seek is pending');
    if (h.channel) assert.deepEqual(h.channel.value, waiting);
    h.emit({ positionSeconds: 7.02, playing: true }); await h.pump();
    assert.equal(h.published.at(-1).position, 7.02);
    if (h.channel) { assert.equal(h.channel.value.position, 7.02); assert.equal(h.channel.value.playing, true); }
    seek.resolve(h.state({ positionSeconds: 7, playing: false })); await h.pump();
    assert.equal(h.published.at(-1).position, 7.02, 'the earlier Promise cannot replace Play after the near-target ACK');
    assert.equal(h.canvas().paused, false);
  }
});

test('seek mais novo substitui alvo pendente; erro e revisão cancelam guarda sem bloquear o próximo comando', async () => {
  const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
  h.ref.current.seek(3); const old = h.calls.at(-1);
  h.ref.current.seek(7); const current = h.calls.at(-1); h.flushUI();
  const target = { ...h.channel.value };
  h.emit({ positionSeconds: 3, token: current.args.at(-1) });
  h.emit({ positionSeconds: 7, token: old.args.at(-1) });
  assert.deepEqual(h.channel.value, target);
  h.error('Seek interrompido.'); await h.pump();
  h.emit({ positionSeconds: 1.2 }); await h.pump();
  assert.equal(h.channel.value.position, 1.2, 'a failed seek releases its guard to the actual paused native position');
  h.ref.current.seek(5); h.flushUI();
  h.update({ project: graded(h.project()) }); await h.pump();
  h.emit({ positionSeconds: 2 }); await h.pump();
  assert.equal(h.channel.value.position, 2, 'a superseding recipe cannot keep a seek guard from its earlier revision');
  h.ref.current.seek(4); const latest = h.calls.at(-1); h.flushUI();
  latest.resolve(h.state({ positionSeconds: 4 })); await h.pump();
  assert.equal(h.channel.value.position, 4);
});

test('alvo de seek acompanha duração atual e limite nativo do último quadro, ignorando tempos não finitos', async () => {
  const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
  h.ref.current.seek(100); const first = h.calls.at(-1); h.flushUI();
  assert.equal(first.args[1], 12 - 1 / 30);
  h.emit({ positionSeconds: 0 });
  assert.equal(h.channel.value.position, 12 - 1 / 30);
  first.resolve(h.state({ positionSeconds: 12 - 1 / 30 })); await h.pump();
  const shortened = model.withStudioTakes({ ...h.project(), editing: { ...h.project().editing,
    main: [{ ...h.project().editing.main[0], sourceEndTicks: model.studioTicks(4) }] } });
  h.update({ project: shortened }); await h.pump();
  h.ref.current.seek(100); const last = h.calls.at(-1); h.flushUI();
  assert.equal(last.args[1], 2 - 1 / 30, 'the imperative handle must read the latest recipe duration');
  last.resolve(h.state({ positionSeconds: 2 - 1 / 30 })); await h.pump();
  const count = h.calls.length, sample = { ...h.channel.value };
  h.ref.current.seek(NaN); h.ref.current.seek(Infinity); h.flushUI();
  assert.equal(h.calls.length, count); assert.deepEqual(h.channel.value, sample);
});

test('ACK de seek confirmado no UI antes de novo Play libera guarda JS antiga mesmo com callbacks bloqueados', async () => {
  const h = harness({ playbackChannel: true, nativeRuntime: true }); await h.pump();
  h.ref.current.seek(3); const seek = h.calls.at(-1); h.flushUI();
  h.emit({ positionSeconds: 3, playing: false });
  const count = h.published.length;
  // UI cleared pendingSeek, but its JS ACK is intentionally left queued.
  h.ref.current.togglePlayback(); h.flushRender(); h.flushUI();
  assert.equal(h.canvas().paused, false);
  h.emit({ positionSeconds: 3.1, playing: true });
  assert.equal(h.channel.value.position, 3.1);
  assert.equal(h.channel.value.playing, true);
  assert.equal(h.published.length, count);
  h.flushJS(); await h.pump();
  assert.ok(h.published.at(-1), 'accepted UI playback must publish even when the seek ACK belongs to an earlier intention');
  assert.equal(h.published.at(-1).position, 3.1, 'accepted UI playback must clear the older JS seek target');
  assert.equal(h.published.at(-1).playing, true);
  assert.equal(h.pendingTimers(), 0);
  h.emit({ positionSeconds: 12, clipId: 'b', playing: false }); await h.pump();
  assert.equal(h.published.at(-1).position, 12);
  assert.equal(h.published.at(-1).playing, false);
  assert.equal(h.canvas().paused, true, 'the stale JS seek target cannot keep EOF permanently pending');
  seek.resolve(h.state({ positionSeconds: 3, playing: false })); await h.pump();
  assert.equal(h.published.at(-1).position, 12);
});

test('patch interativo usa animatedProps no UI e preserva recipe/revision, fontes e relógio sem React por frame', async () => {
  const h = harness({ interactive: true, playbackChannel: true, nativeRuntime: true }); await h.pump();
  try {
    const recipe = h.canvas().recipeJSON, revision = h.canvas().revision, clock = { ...h.channel.value }, count = h.published.length;
    assert.equal(h.transformChannel.value.available, true);
    for (let i = 1; i <= 120; i++) {
      h.transformChannel.value = { ...h.transformChannel.value, active: true, operationId: 'a:1:1', epoch: 1, clipId: 'a', phase: 'gesture', sequence: i,
        transform: { rect: { x: i / 1000, y: 0.1, width: 0.7, height: 0.7 } } };
      h.flushUI();
      const patch = JSON.parse(h.rawCanvas().animatedProps.getProps().liveVisualJSON);
      assert.equal(patch.sequence, i); assert.equal(patch.transform.rect.x, i / 1000);
      assert.equal(patch.revision, revision); assert.equal(patch.version, 1);
      assert.ok(!Object.hasOwn(patch, 'assets') && !Object.hasOwn(patch, 'clips'), 'no lesson or URI crosses the geometry channel');
    }
    assert.equal(h.canvas().recipeJSON, recipe); assert.equal(h.canvas().revision, revision);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.channel.value, clock); assert.equal(h.published.length, count);
    const clips = JSON.parse(recipe).clips;
    const next = { ...h.project(), editing: { ...h.project().editing, main: h.project().editing.main.map((clip, index) => index ? clip : { ...clip, rect: { x: 0.12, y: 0.1, width: 0.7, height: 0.7 } }) } };
    h.update({ project: next }); await h.pump();
    assert.notEqual(h.canvas().revision, revision);
    const saved = JSON.parse(h.canvas().recipeJSON).clips;
    assert.deepEqual(saved[1], clips[1]); assert.equal(saved[0].assetId, clips[0].assetId);
  } finally { h.dispose(); }
});

for (const capability of [{ version: 1, available: false }, { version: 2, available: true }]) test(`capacidade ${JSON.stringify(capability)} conserva fallback sem tratamento interativo fictício`, async () => {
  const h = harness({ interactive: true, nativeRuntime: true, capability }); await h.pump();
  try { assert.equal(h.transformChannel.value.available, false); assert.equal(h.transformChannel.value.active, false); }
  finally { h.dispose(); }
});

test('erro da superfície interativa desativa canal e desmontagem invalida operação sem alterar receita', async () => {
  const h = harness({ interactive: true, playbackChannel: true, nativeRuntime: true }); await h.pump();
  const recipe = h.canvas().recipeJSON;
  h.transformChannel.value = { ...h.transformChannel.value, active: true, operationId: 'a:1:1', clipId: 'a', phase: 'gesture', sequence: 1 }; h.flushUI();
  h.error('Falha na GPU', { code: 'E_STUDIO_INTERACTION' }); await h.pump();
  assert.equal(h.transformChannel.value.available, false); assert.equal(h.transformChannel.value.active, false);
  assert.equal(h.transformChannel.value.finish, 'cancel'); assert.equal(h.canvas().recipeJSON, recipe);
  h.dispose(); h.flushUI(); assert.equal(h.transformChannel.value.available, false);
});

test('podcast silenciado mantém fallback de áudio com mute real; binário antigo não toca vídeo tratado como se fosse simples', async () => {
  const audio = model.withStudioTakes({ ...project(), kind: 'podcast', editing: { ...model.emptyStudioEditing('podcast'), mainMuted: true,
    assets: project().editing.assets, main: project().editing.main } });
  const h = harness({ available: false, initialProject: audio }); await h.pump();
  try {
    assert.ok(h.tree().type === 'legacy-preview'); assert.equal(h.tree().props.muted, true);
  } finally { h.dispose(); }
});

test('binário sem compositor aplica mainMuted ao vídeo simples por Expo sem fabricar mix de camadas ou tratamento', async () => {
  const simple = model.withStudioTakes({ ...project(), editing: { ...project().editing, mainMuted: true } });
  const fallback = harness({ available: false, initialProject: simple }); await fallback.pump();
  try {
    assert.equal(fallback.tree().type, 'legacy-preview'); assert.equal(fallback.tree().props.muted, true);
    assert.equal(fallback.calls.length, 0);
  } finally { fallback.dispose(); }
  const treated = harness({ available: false, initialProject: graded(simple) }); await treated.pump();
  try { assert.notEqual(treated.tree().type, 'legacy-preview', 'real mute cannot erase unsupported grade'); }
  finally { treated.dispose(); }
  const layered = model.withStudioTakes({ ...simple, editing: { ...simple.editing, layers: [{ id: 'lane', kind: 'text', muted: true, hidden: true,
    items: [{ id: 'title', kind: 'text', startTicks: 0, durationTicks: 120_000, text: { content: 'Aula', fontSize: 0.05 } }] }] } });
  const unsupported = harness({ available: false, initialProject: layered }); await unsupported.pump();
  try { assert.notEqual(unsupported.tree().type, 'legacy-preview', 'layer flags and per-lane mix remain native requirements'); }
  finally { unsupported.dispose(); }
});

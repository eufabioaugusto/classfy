import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function production(file, dependencies, globals) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected orientation boundary: ${file} -> ${name}`);
    return dependencies[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}

// Execute the real hook, focus arbitration, settlement and deadlines together.
// UIKit's rotation receipt, window, React/focus, AppState and time are boundaries.
// No camera, navigation, device setting or server is changed by this harness.
function harness() {
  const contexts = new Map(), timers = new Map(), locks = [], orientationListeners = new Set(), dimensionListeners = new Set(), appListeners = new Set(), diagnostics=[];
  let now = 1000, timerId = 0, dirty = false, effects = [], currentContext;
  let orientation = 3, dimensions = { width: 844, height: 390 }, lockBehavior = async () => {}, readBehavior;
  const app = { currentState: 'active', addEventListener: (_name, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } };
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  function slot() { const context = currentContext, index = context.cursor++; return { context, index }; }
  const react = {
    useRef(value) { const { context, index } = slot(); return context.slots[index] ||= { current: value }; },
    useState(initial) {
      const { context, index } = slot();
      if (!context.slots[index]) context.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [context.slots[index].value, update => {
        assert.ok(context.mounted, 'No state update after unmount');
        context.slots[index].value = typeof update === 'function' ? update(context.slots[index].value) : update; dirty = true;
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
  };
  const globals = {
    console:{info:(_label,value)=>diagnostics.push(structuredClone(value))},
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay = 0) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const manager = production('./studioOrientationManager.ts', {}, globals);
  const settle = production('./studioOrientationSettle.ts', {}, globals);
  const hook = production('./useStudioOrientation.ts', {
    react, './studioOrientationManager': manager, './studioOrientationSettle': settle,
    'expo-router': { useFocusEffect(callback) { const focused = currentContext.focused; react.useEffect(() => focused ? callback() : undefined, [focused, callback]); } },
    'react-native': { AppState: app, Dimensions: { get: () => dimensions, addEventListener: (_name, callback) => {
      dimensionListeners.add(callback); return { remove: () => dimensionListeners.delete(callback) };
    } } },
    'expo-screen-orientation': {
      OrientationLock: { LANDSCAPE: 'landscape', PORTRAIT_UP: 'portrait' },
      Orientation: { PORTRAIT_UP: 1, PORTRAIT_DOWN: 2, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 },
      lockAsync: mode => { locks.push(mode); return lockBehavior(mode); },
      getOrientationAsync: () => readBehavior ? readBehavior() : Promise.resolve(orientation),
      addOrientationChangeListener(callback) { orientationListeners.add(callback); return { remove: () => orientationListeners.delete(callback) }; },
      removeOrientationChangeListener(subscription) { subscription.remove(); },
    },
  }, globals);
  function render() {
    dirty = false;
    for (const context of contexts.values()) {
      if (!context.mounted) continue;
      context.cursor = 0; currentContext = context;
      context.value = hook.useStudioOrientation(context.kind, context.enabled, context.presentation);
      currentContext = undefined;
    }
    const pending = effects; effects = [];
    for (const effect of pending) {
      effect.context.slots[effect.index]?.cleanup?.();
      effect.context.slots[effect.index] = { deps: effect.deps };
      effect.context.slots[effect.index].cleanup = effect.callback();
    }
  }
  async function flush() {
    for (let step = 0; step < 24; step++) { await Promise.resolve(); if (dirty) render(); }
  }
  async function advance(milliseconds) {
    const end = now + milliseconds; await flush();
    for (let step = 0; step < 1000; step++) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) { now = end; await flush(); return; }
      now = due[1].at; timers.delete(due[0]); due[1].callback(); await flush();
    }
    throw Error('Orientation timers did not settle');
  }
  function geometry(mode, { interfaceChanged = true, windowChanged = true, emit = true } = {}) {
    if (interfaceChanged) orientation = mode === 'portrait' ? 1 : 3;
    if (windowChanged) dimensions = mode === 'portrait' ? { width: 390, height: 844 } : { width: 844, height: 390 };
    if (emit) {
      if (interfaceChanged) for (const listener of orientationListeners) listener();
      if (windowChanged) for (const listener of dimensionListeners) listener();
    }
  }
  function mount(key = 'camera', options = {}) {
    const context = { kind: 'aula', enabled: true, presentation: 'capture', focused: true, mounted: true, cursor: 0, slots: [], ...options };
    contexts.set(key, context); dirty = true; render();
    return { value: () => context.value,
      async update(patch) { Object.assign(context, patch); dirty = true; render(); await flush(); },
      async unmount() {
        for (const slot of context.slots) slot?.cleanup?.();
        context.mounted = false; await flush();
      },
    };
  }
  return { mount, locks, geometry, advance, flush, manager, settle, globals, diagnostics,
    lockBehavior: value => { lockBehavior = value; }, readBehavior: value => { readBehavior = value; },
    async appState(value) { app.currentState = value; for (const listener of appListeners) listener(value); await flush(); },
    counts: () => ({ timers: timers.size, orientation: orientationListeners.size, dimensions: dimensionListeners.size, app: appListeners.size }),
  };
}

test('entrada e saída exigem interface e janela estáveis; ACK de lock/evento sozinho não libera', async () => {
  const h = harness(), camera = h.mount();
  await h.flush(); assert.equal(camera.value().orientationReady, false);
  await h.advance(120); assert.equal(camera.value().orientationReady, true);
  const pending = camera.value().prepareForExit(); let complete = false; void pending.then(() => { complete = true; });
  await h.flush(); assert.equal(h.locks.at(-1), 'portrait'); assert.equal(camera.value().orientationReady, false);
  h.geometry('portrait', { windowChanged: false }); await h.advance(240);
  assert.equal(complete, false, 'Interface rotation can precede the actual window layout');
  h.geometry('portrait'); await h.advance(60); assert.equal(complete, false);
  await h.advance(60); assert.equal(await pending, true);
  await camera.unmount(); await h.flush();
  assert.deepEqual(h.counts(), { timers: 0, orientation: 0, dimensions: 0, app: 0 });
});

test('janela portrait com interface landscape não libera, e estabilidade reinicia quando a geometria muda', async () => {
  const h = harness(), camera = h.mount(); await h.advance(120);
  const pending = camera.value().prepareForExit(); await h.flush();
  h.geometry('portrait', { interfaceChanged: false }); await h.advance(240);
  assert.equal(camera.value().orientationReady, false);
  h.geometry('portrait'); await h.advance(60);
  h.geometry('landscape'); await h.advance(60); h.geometry('portrait');
  await h.advance(60); assert.equal(camera.value().orientationReady, false);
  await h.advance(60); assert.equal(await pending, true);
  await camera.unmount();
});

test('duplo Avançar compartilha uma preparação e mantém o token em retrato até blur', async () => {
  const h = harness(), camera = h.mount(); await h.advance(120);
  const first = camera.value().prepareForExit(), second = camera.value().prepareForExit();
  assert.equal(first, second); await h.flush();
  assert.deepEqual(h.locks, ['landscape', 'portrait']);
  h.geometry('portrait'); await h.advance(120); assert.equal(await first, true);
  await h.advance(1000); assert.equal(h.locks.at(-1), 'portrait');
  await camera.update({ focused: false }); assert.equal(camera.value().orientationReady, false);
  assert.deepEqual(h.counts(), { timers: 0, orientation: 0, dimensions: 0, app: 0 });
  await camera.unmount();
});

test('Fechar funciona no projeto indisponível/permissão negada, sem token inicial ou fantasma', async () => {
  const h = harness(), camera = h.mount('camera', { enabled: false, kind: undefined });
  await h.flush(); assert.deepEqual(h.locks, []);
  const pending = camera.value().prepareForExit(); await h.flush();
  assert.deepEqual(h.locks, ['portrait']); h.geometry('portrait'); await h.advance(120);
  assert.equal(await pending, true);
  await camera.unmount(); assert.deepEqual(h.counts(), { timers: 0, orientation: 0, dimensions: 0, app: 0 });
});

test('blur/refocus e background invalidam saída antiga mesmo com resposta nativa tardia', async () => {
  const h = harness(), camera = h.mount(); await h.advance(120);
  let resolvePortrait; h.lockBehavior(mode => mode === 'portrait' ? new Promise(resolve => { resolvePortrait = resolve; }) : Promise.resolve());
  const pending = camera.value().prepareForExit(); await h.flush();
  await camera.update({ focused: false }); await camera.update({ focused: true });
  assert.equal(await pending, false); resolvePortrait(); await h.advance(120);
  assert.equal(camera.value().orientationReady, true); assert.equal(h.locks.at(-1), 'landscape');
  h.lockBehavior(async () => {});
  const backgroundExit = camera.value().prepareForExit(); await h.flush();
  await h.appState('inactive'); await h.appState('active');
  h.geometry('portrait'); await h.advance(120);
  assert.equal(await backgroundExit, false); assert.equal(camera.value().orientationReady, false);
  h.geometry('landscape'); await h.advance(120); assert.equal(camera.value().orientationReady, true);
  await camera.unmount(); assert.equal(h.counts().timers, 0);
});

test('falha de saída mantém erro claro, recupera captura e permite retry sem alterar rotação do usuário', async () => {
  const h = harness(), camera = h.mount(); await h.advance(120);
  const pending = camera.value().prepareForExit(); await h.advance(4000);
  assert.equal(await pending, false); assert.match(camera.value().orientationError, /Tente novamente/);
  assert.doesNotMatch(camera.value().orientationError, /rotação do aparelho/);
  assert.equal(h.locks.at(-1), 'landscape');
  await h.advance(120); assert.equal(camera.value().orientationReady, true);
  const retry = camera.value().prepareForExit(); await h.flush(); h.geometry('portrait'); await h.advance(120);
  assert.equal(await retry, true); assert.equal(camera.value().orientationError, null);
  await camera.unmount();
});

test('request e consulta nativa sem resposta são limitados e não seguram uma nova tela', async () => {
  const h = harness(), camera = h.mount(); await h.advance(120);
  h.lockBehavior(() => new Promise(() => {}));
  const exit = camera.value().prepareForExit(); await h.advance(1500);
  assert.equal(await exit, false); assert.match(camera.value().orientationError, /Tente novamente/);
  await camera.unmount(); h.lockBehavior(async () => {});
  h.readBehavior(() => new Promise(() => {}));
  const editor = h.mount('editor', { presentation: 'editor' });
  h.geometry('portrait'); await h.advance(5500);
  assert.equal(editor.value().orientationReady, false); assert.match(editor.value().orientationError, /Tente novamente/);
  await editor.unmount(); await h.flush(); assert.deepEqual(h.counts(), { timers: 0, orientation: 0, dimensions: 0, app: 0 });
});

test('nova apresentação e novo foco não herdam ready ou resposta da câmera anterior', async () => {
  const h = harness(), camera = h.mount(); await h.advance(120);
  await camera.update({ presentation: 'editor' });
  assert.equal(camera.value().orientationReady, false); assert.equal(h.locks.at(-1), 'portrait');
  await h.advance(240); assert.equal(camera.value().orientationReady, false);
  h.geometry('portrait'); await h.advance(120); assert.equal(camera.value().orientationReady, true);
  await camera.update({ focused: false });
  const second = h.mount('second'); await h.advance(240); assert.equal(second.value().orientationReady, false);
  h.geometry('landscape'); await h.advance(120); assert.equal(second.value().orientationReady, true);
  await camera.unmount(); assert.equal(h.locks.at(-1), 'landscape');
  await second.unmount(); await h.flush(); assert.equal(h.locks.at(-1), 'portrait');
});

test('retry explícito recupera enquadramento falho e compartilha operação até interface e janela confirmarem', async () => {
  const h=harness();h.lockBehavior(async()=>{throw Object.assign(Error('private://omitido'),{code:'ERR_ORIENTATION',name:'OrientationError'});});
  const camera=h.mount();await h.flush();assert.equal(camera.value().orientationReady,false);assert.match(camera.value().orientationError,/Tente novamente/);
  assert.deepEqual(h.diagnostics[0],{phase:'entry',requestedMask:'LANDSCAPE',outcome:'failed',before:{interfaceOrientation:3,width:844,height:390},after:{interfaceOrientation:0,width:844,height:390},failure:{name:'OrientationError',code:'ERR_ORIENTATION'}});assert.equal(JSON.stringify(h.diagnostics).includes('private'),false);
  h.lockBehavior(async()=>{});const first=camera.value().retryOrientation(),second=camera.value().retryOrientation();assert.equal(first,second);await h.flush();
  h.geometry('portrait',{interfaceChanged:false});await h.advance(240);assert.equal(camera.value().orientationReady,false);
  h.geometry('landscape');await h.advance(120);assert.equal(await first,true);assert.equal(camera.value().orientationReady,true);assert.equal(camera.value().orientationError,null);
  await camera.update({focused:false});const locks=h.locks.length;assert.equal(await camera.value().retryOrientation(),false);assert.equal(h.locks.length,locks);await camera.unmount();
});

test('retry antigo não libera câmera após blur e foco de outra apresentação',async()=>{
  const h=harness(),camera=h.mount();await h.advance(120);let release;h.lockBehavior(()=>new Promise(resolve=>{release=resolve;}));
  const retry=camera.value().retryOrientation();await h.flush();await camera.update({focused:false});assert.equal(await retry,false);
  h.lockBehavior(async()=>{});const editor=h.mount('editor',{presentation:'editor'});release();h.geometry('portrait');await h.advance(120);
  assert.equal(camera.value().orientationReady,false);assert.equal(editor.value().orientationReady,true);await camera.unmount();await editor.unmount();
});

test('late ACK após timeout reafirma o foco atual e não certifica a operação expirada', async () => {
  const h = harness(), applied = []; let release;
  const manager = h.manager.createStudioOrientationManager(mode => {
    applied.push(mode); return applied.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  }, { applyTimeoutMs: 20 });
  const camera = Symbol('camera'), editor = Symbol('editor');
  const first = manager.request(camera, 'landscape'); const rejected = assert.rejects(first, /tempo/);
  await h.advance(20); await rejected;
  await manager.request(editor, 'portrait'); release(); await h.flush();
  assert.deepEqual(applied, ['landscape', 'portrait', 'portrait']);
  assert.equal(manager.isCurrent(editor, 'portrait'), true);
  await manager.release(camera); await manager.release(editor); assert.equal(h.counts().timers, 0);
});

test('ACK atrasado da orientação que continua atual não cria ciclo de novos locks com timeout', async () => {
  const h = harness(), applied = []; let release;
  const manager = h.manager.createStudioOrientationManager(mode => {
    applied.push(mode); return new Promise(resolve => { release = resolve; });
  }, { applyTimeoutMs: 20 });
  const token = Symbol('camera');
  const first = manager.request(token, 'landscape'); const rejected = assert.rejects(first, /tempo/);
  await h.advance(20); await rejected; release(); await h.flush();
  assert.deepEqual(applied, ['landscape']); assert.equal(h.counts().timers, 0);
  // Disposal still requests the app's portrait default once, with a deadline.
  const disposal = manager.release(token); const cleanup = assert.rejects(disposal, /tempo/);
  await h.advance(20); await cleanup;
  assert.deepEqual(applied, ['landscape', 'portrait']); assert.equal(h.counts().timers, 0);
});

test('settlement rejeita dimensões inválidas e aborta sem listeners/timers restantes', async () => {
  const h = harness();
  for (const dimensions of [{ width: 0, height: 844 }, { width: Infinity, height: 844 }, { width: 390, height: 390 }]) {
    assert.equal(h.settle.studioOrientationDimensionsMatch('portrait', dimensions), false);
  }
  const controller = new AbortController(); let listeners = 0, requests = 0;
  const pending = h.settle.settleStudioOrientation('portrait', {
    request: async () => { requests++; }, read: async () => 'portrait', dimensions: () => ({ width: 390, height: 844 }),
    subscribe: () => { listeners++; return () => { listeners--; }; }, isCurrent: () => true,
  }, { signal: controller.signal });
  await h.flush(); controller.abort(); assert.equal(await pending, 'cancelled');
  await h.advance(5000); assert.equal(listeners, 0); assert.equal(requests, 1); assert.equal(h.counts().timers, 0);
});

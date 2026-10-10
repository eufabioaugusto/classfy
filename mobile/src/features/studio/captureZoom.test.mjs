import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import babel from '@babel/core';
const source = readFileSync(new URL('./StudioCaptureZoom.tsx', import.meta.url), 'utf8');
const code = babel.transformSync(source, { filename: fileURLToPath(new URL('./StudioCaptureZoom.tsx', import.meta.url)), configFile: false, babelrc: false,
  plugins: [['@babel/plugin-transform-typescript', { isTSX: true }], ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }], '@babel/plugin-transform-modules-commonjs', 'react-native-worklets/plugin'] }).code;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function harness({ component = 'zoom' } = {}) {
  const slots = [], changes = [], focused = [], queue = [], uiQueue = [], timers = new Map(); let cursor = 0, effects = [], tree, now = 1000, timerId = 0, runtime = 'js';
  let props = component === 'zoom' ? { value: .2, label: '1.0×', onChange: next => changes.push(next) } : { frame: { left: 0, top: 0, width: 300, height: 180 }, zoom: .2, onZoom: next => changes.push(next), onFocus: point => focused.push(point), canLockFocus: true };
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  const onUI = callback => (...args) => { const old = runtime; runtime = 'ui'; try { return callback(...args); } finally { runtime = old; } };
  const shared = initial => { let value = initial; return { get value() { return value; }, set value(next) { if (runtime === 'js') uiQueue.push(() => { value = next; }); else value = next; } }; };
  const hooks = {
    useRef: value => { const i = cursor++; return slots[i] ||= { current: value }; },
    useState: initial => { const i = cursor++; if (!slots[i]) slots[i] = { value: initial }; return [slots[i].value, next => { slots[i].value = next; }]; },
    useMemo: (callback, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: callback(), deps }; return slots[i].value; },
    useCallback: (callback, deps) => hooks.useMemo(() => callback, deps),
    useEffect: (callback, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) effects.push({ i, callback, deps }); },
  };
  const gesture = () => { const handlers = {}, configuration = {}; const chain = new Proxy({ handlers, configuration }, { get(target, key) { if (key in target) return target[key]; return (...args) => { if (String(key).startsWith('on')) handlers[key] = Object.assign(onUI(args[0]), { __workletHash: args[0].__workletHash }); else configuration[key] = args[0]; return chain; }; } }); return chain; };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'view', Text: 'text', StyleSheet: { create: styles => styles }, PanResponder: { create: handlers => ({ panHandlers: handlers }) } },
    'react-native-gesture-handler': { GestureDetector: 'detector', Gesture: { Pan: gesture } },
    'react-native-reanimated': { __esModule: true, default: { View: 'animated' }, useSharedValue: initial => hooks.useRef(shared(initial)).current,
      useAnimatedStyle: callback => { const ref = hooks.useRef(callback); ref.current = callback; return { read: () => ref.current() }; },
      runOnJS: callback => (...args) => queue.push(() => callback(...args)), runOnUI: callback => (...args) => uiQueue.push(() => onUI(callback)(...args)) },
    '@/theme/colors': { colors: { text: '#fff' } },
  };
  const module = { exports: {} }; new Function('require', 'module', 'exports', 'Date', 'setTimeout', 'clearTimeout', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports, { now: () => now }, callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id));
  const render = () => { cursor = 0; effects = []; tree = component === 'zoom' ? module.exports.StudioCaptureZoom(props) : module.exports.StudioCaptureFrame(props); for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }; } };
  const flushUI = () => { while (uiQueue.length) uiQueue.shift()(); }, flushJS = () => { while (queue.length) queue.shift()(); };
  const find = predicate => { const visit = node => { if (Array.isArray(node)) { for (const child of node) { const hit = visit(child); if (hit) return hit; } } else if (node && typeof node === 'object') { if (predicate(node)) return node; return visit(node.props?.children); } }; return visit(tree); };
  render(); flushUI();
  return { changes, focused, flushUI, flushJS, gesture: () => find(node => node.type === 'detector').props.gesture,
    control: () => find(node => node.props?.accessibilityRole === 'adjustable').props, frame: () => tree.props,
    dial: () => find(node => node.type === 'animated' && !node.props?.accessible),
    tickX: () => find(node => node.type === 'animated' && !node.props?.accessible).props.style[1].read().transform[0].translateX,
    update: patch => { props = { ...props, ...patch }; render(); },
    time: delta => { now += delta; }, runTimers: () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    marker: () => find(node => node.type === 'view' && node.props?.pointerEvents === 'none' && Array.isArray(node.props?.style)),
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); } };
}
test('roda usa worklets reais Babel e tem recognizer estável, sem botões +/-', () => {
  const h = harness(); const gesture = h.gesture();
  for (const name of ['onStart', 'onUpdate', 'onEnd', 'onFinalize']) assert.equal(typeof gesture.handlers[name].__workletHash, 'number', name);
  assert.equal(gesture.configuration.maxPointers, 1); assert.deepEqual(gesture.configuration.activeOffsetX, [-2, 2]); assert.deepEqual(gesture.configuration.failOffsetY, [-14, 14]);
  h.update({ value: .3, label: '1.4×' }); h.flushUI(); assert.equal(h.gesture(), gesture); assert.equal(h.control().accessibilityValue.text, '1.4×'); h.unmount();
});
test('dial move no UI mesmo com JS bloqueado e entrega último deslocamento no release', () => {
  const h = harness(), handlers = h.gesture().handlers; handlers.onStart(); handlers.onUpdate({ translationX: 36 }); near(h.tickX(), -108); assert.deepEqual(h.changes, []);
  h.time(1); handlers.onUpdate({ translationX: 72 }); near(h.tickX(), -144); handlers.onEnd({ translationX: 90 }, true); handlers.onFinalize({}, true);
  h.flushJS(); near(h.changes.at(-1), .45); assert.equal(h.changes.length, 2); h.unmount();
});
test('clamp da roda alcança somente 0..1, inclusive final sem update e nova operação', () => {
  const h = harness(), handlers = h.gesture().handlers; handlers.onStart(); handlers.onEnd({ translationX: 10000 }, true); handlers.onFinalize({}, true); h.flushJS(); assert.equal(h.changes.at(-1), 1);
  handlers.onStart(); h.time(31); handlers.onUpdate({ translationX: -10000 }); handlers.onEnd({ translationX: -10000 }, true); handlers.onFinalize({}, true); h.flushJS(); assert.equal(h.changes.at(-1), 0); h.unmount();
});
test('disabled/REC fecha dial e invalida eventos enfileirados sem recriar pan', () => {
  const h = harness(), gesture = h.gesture(); gesture.handlers.onStart(); gesture.handlers.onUpdate({ translationX: 100 });
  h.update({ disabled: true }); h.flushUI(); assert.equal(h.dial(), undefined); assert.equal(h.gesture(), gesture); h.flushJS(); assert.deepEqual(h.changes, []);
  gesture.handlers.onEnd({ translationX: 150 }, true); gesture.handlers.onFinalize({}, true); h.flushJS(); assert.deepEqual(h.changes, []);
  h.update({ disabled: false }); h.flushUI(); assert.ok(h.dial()); h.unmount();
});
test('ACK/clamp durante drag converge no ACK terminal do MESMO fator, sem depender de mudança de value', () => {
  const h = harness(); h.update({ confirmedValue: .2, pending: false, confirmation: 1 }); h.flushUI(); const handlers = h.gesture().handlers;
  handlers.onStart(); handlers.onUpdate({ translationX: 72 }); h.flushJS(); h.update({ value: .4, pending: true }); h.flushUI();
  h.update({ confirmedValue: .25, value: .25, label: '1.1×', pending: false, confirmation: 2 }); h.flushUI(); near(h.tickX(), -144);
  handlers.onEnd({ translationX: 90 }, true); handlers.onFinalize({}, true); near(h.tickX(), -162); h.flushJS(); near(h.changes.at(-1), .45);
  h.update({ pending: true }); h.flushUI(); near(h.tickX(), -162);
  h.update({ pending: false, confirmation: 3 }); h.flushUI(); near(h.tickX(), -90); assert.equal(h.control().accessibilityValue.text, '1.1×'); h.unmount();
});
test('alvo terminal fica no dial enquanto JS/último hardware request estão pendentes; erro devolve confirmação anterior', () => {
  const h = harness(); h.update({ confirmedValue: .2, pending: false, confirmation: 1 }); h.flushUI(); const handlers = h.gesture().handlers;
  handlers.onStart(); handlers.onEnd({ translationX: 90 }, true); handlers.onFinalize({}, true); near(h.tickX(), -162); assert.deepEqual(h.changes, []);
  h.flushJS(); h.update({ value: .45, pending: true }); h.flushUI(); near(h.tickX(), -162);
  h.update({ pending: false, confirmation: 2 }); h.flushUI(); near(h.tickX(), -72); h.unmount();
});
test('ACK real coerente confirma alvo terminal sem snap ao valor antigo e próxima operação parte dele', () => {
  const h = harness(); h.update({ confirmedValue: .2, pending: false, confirmation: 1 }); h.flushUI(); const handlers = h.gesture().handlers;
  handlers.onStart(); handlers.onEnd({ translationX: 90 }, true); handlers.onFinalize({}, true); h.flushJS(); h.update({ pending: true }); h.flushUI(); near(h.tickX(), -162);
  h.update({ value: .45, confirmedValue: .45, pending: false, confirmation: 2 }); h.flushUI(); near(h.tickX(), -162);
  handlers.onStart(); handlers.onEnd({ translationX: 18 }, true); handlers.onFinalize({}, true); h.flushJS(); near(h.changes.at(-1), .5); h.unmount();
});
test('controle simples guarda value recebido durante drag e reconcilia ao cancelar sem criar pedido terminal', () => {
  const h = harness(), handlers = h.gesture().handlers; handlers.onStart(); handlers.onUpdate({ translationX: 72 }); h.update({ value: .25, label: '+0.5 EV' }); h.flushUI(); near(h.tickX(), -144);
  handlers.onEnd({ translationX: 90 }, false); handlers.onFinalize({}, false); h.flushJS(); near(h.tickX(), -90); assert.equal(h.changes.length, 1); h.unmount();
});
test('cancel e desmontagem não entregam alvo terminal nem callback de captura obsoleta', () => {
  const h = harness(), handlers = h.gesture().handlers; handlers.onStart(); handlers.onEnd({ translationX: 72 }, false); handlers.onFinalize({}, false); h.flushJS(); assert.deepEqual(h.changes, []);
  handlers.onStart(); handlers.onUpdate({ translationX: 36 }); h.unmount(); h.flushJS(); assert.deepEqual(h.changes, []);
});
test('mesmo componente regula exposição/intensidade por AX, incluindo comandos encadeados sem render', () => {
  const h = harness(); h.update({ value: .5, label: '+0.0 EV', controlName: 'exposição' }); h.flushUI(); const control = h.control(); assert.equal(control.accessibilityLabel, 'exposição da câmera');
  control.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }); control.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }); h.flushUI(); h.flushJS(); near(h.changes.at(-1), .55);
  h.update({ disabled: true }); h.flushUI(); h.control().onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }); h.flushUI(); h.flushJS(); assert.equal(h.changes.length, 2); h.unmount();
});
test('REC remove marcador e encerra pinça/hold antes de qualquer zoom ou foco tardio', () => {
  const h = harness({ component: 'frame' }); const event = (x, y) => ({ nativeEvent: { touches: [{ pageX: x, pageY: y }] } });
  h.frame().onTouchStart(event(100, 80)); h.frame().onTouchEnd(); h.update({}); assert.ok(h.marker());
  h.frame().onTouchStart(event(100, 80)); h.frame().onPanResponderGrant({ nativeEvent: { touches: [{ pageX: 20, pageY: 20 }, { pageX: 60, pageY: 20 }] } });
  h.update({ disabled: true }); h.update({}); assert.equal(h.marker(), undefined); h.runTimers();
  h.frame().onPanResponderMove({ nativeEvent: { touches: [{ pageX: 20, pageY: 20 }, { pageX: 120, pageY: 20 }] } });
  assert.deepEqual(h.changes, []); assert.equal(h.focused.length, 1); h.unmount();
});

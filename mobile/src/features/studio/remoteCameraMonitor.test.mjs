import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { remoteCameraFocusPoint, remoteCameraMonitorLayout, remoteCameraQualityLabel } from './remoteCameraMonitorLayout.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness(patch = {}, options = {}) {
  const calls = [], slots = [], timers = new Map(); let cursor = 0, tree, dirty = false, effects = [], timerId = 0;
  const window = options.window || { width: 390, height: 844 }, insets = options.insets || { top: 47, left: 0, right: 0, bottom: 34 };
  let props = { children: { type: 'native-camera', props: {} }, state: { phase: 'ready', state: { width: 3840, height: 2160, fps: 30, supportsFocus: true, supportsFocusLock: true }, previewConnected: true, takeCount: 1 },
    active: true, captureScope: 'owner:session:1', elapsed: 0, canUnpair: true, audio: { status: 'live', input: { name: 'Microfone do iPhone', type: 'builtin' }, channels: [{ averageDb: -30, peakDb: -12 }] },
    onClose: () => calls.push(['close']), onStop: () => calls.push(['stop']), onUpload: () => calls.push(['upload']), onReconnect: () => calls.push(['reconnect']), onUnpair: () => calls.push(['unpair']),
    onFocus: point => { calls.push(['focus', point]); return options.focus ? options.focus(point) : Promise.resolve({}); }, onFocusError: message => calls.push(['focus-error', message]), ...patch };
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ||= { value: typeof value === 'function' ? value() : value }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(slots[i].value, value)) { slots[i].value = value; dirty = true; } }]; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) effects.push({ i, callback, deps }); },
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props: props || {} };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'spinner', Modal: 'modal', Pressable: 'pressable', ScrollView: 'scroll', Text: 'text', View: 'view', useWindowDimensions: () => window, StyleSheet: { create: value => value, absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => insets }, 'expo-status-bar': { StatusBar: 'status-bar' },
    'lucide-react-native': Object.fromEntries(['Check', 'ChevronRight', 'CloudUpload', 'Monitor', 'MoreHorizontal', 'RotateCw', 'Unplug', 'X'].map(name => [name, 'icon'])),
    './StudioCaptureAudioMonitor': { StudioCaptureAudioMonitor: 'audio-monitor' },
    './remoteCameraMonitorLayout': { remoteCameraFocusPoint, remoteCameraMonitorLayout, remoteCameraQualityLabel },
  };
  const code = ts.transpileModule(readFileSync(new URL('./StudioRemoteCameraMonitor.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(name => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected boundary ${name}`); return dependencies[name]; }, module, module.exports,
    callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id));
  function render() { cursor = 0; effects = []; dirty = false; tree = module.exports.StudioRemoteCameraMonitor(props); for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }; } }
  const pump = async () => { for (let i = 0; i < 20; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty) return; } throw Error('Monitor did not settle'); };
  function nodes(type, includeHidden = false) { const result = []; const visit = value => { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== 'object' || value.type === 'modal' && !value.props.visible && !includeHidden) return; if (value.type === type) result.push(value); visit(value.props?.children); }; visit(tree); return result; }
  function control(label) { return nodes('pressable').find(node => node.props.accessibilityLabel === label || node.props.testID === label); }
  const press = async label => { const node = control(label); assert.ok(node, `Missing ${label}`); assert.equal(!!node.props.disabled, false, `Disabled ${label}`); node.props.onPress?.(); await pump(); };
  render(); return { calls, nodes, control, pump, press, root: () => tree,
    update: async patch => { props = { ...props, ...patch }; dirty = true; await pump(); },
    state: async patch => { props = { ...props, state: { ...props.state, ...patch } }; dirty = true; await pump(); },
    focus: async (x, y, locked = false) => { const node = control('remote-camera-focus-surface'); assert.ok(node); const event = { nativeEvent: { locationX: x, locationY: y } }; node.props.onPressIn(); if (locked) node.props.onLongPress(event); node.props.onPress(event); await pump(); },
    runTimers: async () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } await pump(); },
    text: () => nodes('text').map(node => Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children)).join(' '),
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
  };
}

test('monitor deixa cena livre: ações em sheet fechado, qualidade real e áudio compacto fora do centro', async () => {
  const h = harness(); try { await h.pump(); assert.equal(h.nodes('native-camera').length, 1); assert.equal(h.nodes('modal').length, 0);
    assert.equal(h.nodes('status-bar')[0].props.hidden, true); assert.ok(h.text().includes('4K')); assert.ok(h.text().includes('30 FPS')); assert.equal(h.control('Enviar original'), undefined);
    for (const label of ['Fechar câmera', 'Opções da câmera remota']) {
      const target = h.control(label).props.style; assert.ok(target.width >= 44 && target.height >= 44, label);
    }
    const audio = h.nodes('audio-monitor')[0]; assert.equal(audio.props.compact, true);
    const corner = h.nodes('view').find(node => node.props.children?.at?.(-1) === audio);
    assert.deepEqual(corner.props.style[1], { left: 16, bottom: 44, width: 180 });
    await h.press('Opções da câmera remota'); assert.equal(h.nodes('modal').length, 1); assert.equal(h.nodes('modal')[0].props.children.props.children[1].props.accessibilityViewIsModal, true);
    for (const label of ['Enviar original', 'Reconectar prévia', 'Desvincular computador']) {
      const target = h.control(label).props.style({ pressed: false })[0]; assert.ok(target.minHeight >= 44, label);
    }
    await h.press('Enviar original'); assert.deepEqual(h.calls, [['upload']]); await h.press('Fechar opções'); assert.equal(h.nodes('modal').length, 0);
  } finally { h.unmount(); }
});

test('REC fecha opções e preserva timer, foco, microfone e parar; salvamento exibe processamento real', async () => {
  const h = harness(); try { await h.press('Opções da câmera remota'); await h.state({ phase: 'recording', recordingStartedAtMs: 1 }); await h.update({ elapsed: 18 });
    assert.equal(h.nodes('modal').length, 0); assert.equal(h.control('Opções da câmera remota'), undefined); assert.equal(h.control('Fechar câmera'), undefined); assert.equal(h.nodes('audio-monitor').length, 1);
    const stop = h.control('Encerrar e salvar take').props.style[0]; assert.ok(stop.width >= 44 && stop.height >= 44);
    assert.ok(h.text().includes('0:18')); await h.press('Encerrar e salvar take'); assert.deepEqual(h.calls, [['stop']]);
    await h.state({ phase: 'saving', processing: true, processingProgress: .37, processingStage: 'rendering' }); assert.equal(h.control('Encerrar e salvar take').props.disabled, true); assert.ok(h.text().includes('Preparando take · 37%'));
    await h.state({ processingStage: 'validating', processingProgress: .96 }); assert.ok(h.text().includes('Conferindo original · 96%'));
    await h.state({ phase: 'ready', processing: false, uploading: true, uploadTotalBytes: 1000, uploadProgressBytes: 425 }); assert.ok(h.text().includes('Enviando original · 42%')); assert.equal(h.nodes('modal').length, 0);
  } finally { h.unmount(); }
});

test('erro e envio pausado continuam visíveis compactos e detalhe abre recuperação sem reconectar sozinho', async () => {
  const h = harness({ error: 'A rede foi interrompida.', state: { phase: 'ready', state: { width: 2160, height: 3840, fps: 30 }, previewConnected: false, takeCount: 2, uploadState: 'paused', uploadPendingCount: 1 } });
  try { assert.ok(h.text().includes('A rede foi interrompida.')); assert.ok(h.text().includes('Prévia desconectada')); assert.deepEqual(h.calls, []);
    await h.press('Aviso da câmera: A rede foi interrompida.. Ver detalhes'); assert.equal(h.nodes('modal').length, 1); await h.press('Retomar envio'); assert.deepEqual(h.calls, [['upload']]);
    await h.press('Reconectar prévia'); assert.deepEqual(h.calls, [['upload'], ['reconnect']]); assert.equal(h.nodes('modal').length, 0);
    await h.press('Opções da câmera remota'); await h.press('Desvincular computador'); assert.deepEqual(h.calls.at(-1), ['unpair']); assert.equal(h.nodes('modal').length, 0);
  } finally { h.unmount(); }
});

test('toque solicita foco dentro da imagem e retículo só aparece depois de confirmação; hold trava uma vez', async () => {
  const gate = deferred(), h = harness({}, { focus: () => gate.promise }); try { await h.focus(195, 422); assert.deepEqual(h.calls, [['focus', { x: .5, y: .5, locked: false }]]); assert.equal(h.nodes('view').some(node => node.props.testID === 'remote-camera-focus-reticle'), false);
    gate.resolve({}); await h.pump(); assert.equal(h.nodes('view').filter(node => node.props.testID === 'remote-camera-focus-reticle').length, 1); await h.runTimers(); assert.equal(h.nodes('view').filter(node => node.props.testID === 'remote-camera-focus-reticle').length, 0);
    await h.focus(195, 422, true); assert.deepEqual(h.calls.at(-1), ['focus', { x: .5, y: .5, locked: true }]); assert.equal(h.calls.length, 2); assert.ok(h.text().includes('AF LOCK')); await h.runTimers(); assert.ok(h.text().includes('AF LOCK'));
  } finally { h.unmount(); }
});

test('letterbox e falta de capability ignoram foco; nova sessão/blur/tamanho/desmontagem rejeitam ACK atrasado', async () => {
  const h = harness(); try { await h.focus(100, 40); assert.deepEqual(h.calls, []); await h.state({ state: { width: 3840, height: 2160, supportsFocus: false } }); await h.focus(195, 422); assert.deepEqual(h.calls, []); } finally { h.unmount(); }
  for (const change of ['session', 'active', 'size', 'unmount']) {
    const gate = deferred(), delayed = harness({}, { focus: () => gate.promise }); await delayed.focus(195, 422);
    if (change === 'session') await delayed.update({ captureScope: 'owner:another-session:1' });
    else if (change === 'active') await delayed.update({ active: false });
    else if (change === 'size') { delayed.root().props.onLayout({ nativeEvent: { layout: { width: 844, height: 390 } } }); await delayed.pump(); }
    else delayed.unmount(); gate.resolve({}); await delayed.pump(); assert.equal(delayed.nodes('view').filter(node => node.props.testID === 'remote-camera-focus-reticle').length, 0, change); delayed.unmount();
  }
});

test('ACK de foco antigo não sobrescreve alvo mais recente e erro atual fica explícito', async () => {
  const first = deferred(), second = deferred(), h = harness({}, { focus: point => point.x === .5 ? first.promise : second.promise });
  try { await h.focus(195, 422); await h.focus(234, 422); second.resolve({}); await h.pump(); first.resolve({}); await h.pump();
    const marker = h.nodes('view').find(node => node.props.testID === 'remote-camera-focus-reticle'); assert.equal(marker.props.style[1].left, 210); assert.deepEqual(h.calls.filter(call => call[0] === 'focus-error'), []);
  } finally { h.unmount(); }
  const failed = harness({}, { focus: () => Promise.reject(Error('Foco indisponível nesta câmera.')) }); try { await failed.focus(195, 422); assert.deepEqual(failed.calls.at(-1), ['focus-error', 'Foco indisponível nesta câmera.']); assert.equal(failed.nodes('view').filter(node => node.props.testID === 'remote-camera-focus-reticle').length, 0); } finally { failed.unmount(); }
});

test('layout retrato/paisagem respeita notch, áudio, botão parar e sheet positivo; qualidade usa pixels confirmados', () => {
  const portrait = remoteCameraMonitorLayout({ width: 390, height: 844 }, { top: 47, left: 0, right: 0, bottom: 34 }, true);
  assert.equal(portrait.audioBottom, 138); assert.equal(portrait.audioWidth, 180); assert.equal(portrait.top, 55);
  const landscape = remoteCameraMonitorLayout({ width: 844, height: 390 }, { top: 0, left: 47, right: 47, bottom: 21 }, true);
  assert.equal(landscape.left, 59); assert.equal(landscape.right, 59); assert.equal(landscape.audioBottom, 31); assert.ok(landscape.sheetMaxHeight > 0);
  assert.ok(remoteCameraMonitorLayout({ width: 80, height: 90 }, { top: 50, left: 0, right: 0, bottom: 50 }, true).sheetMaxHeight > 0);
  assert.equal(remoteCameraQualityLabel(3840, 2160), '4K'); assert.equal(remoteCameraQualityLabel(2160, 3840), '4K'); assert.equal(remoteCameraQualityLabel(2560, 1440), '2K'); assert.equal(remoteCameraQualityLabel(1920, 1080), 'HD'); assert.equal(remoteCameraQualityLabel(), '—');
  assert.deepEqual(remoteCameraFocusPoint({ x: 422, y: 195 }, { width: 844, height: 390 }, { width: 2160, height: 3840 }, false), { x: .5, y: .5, locked: false });
  assert.equal(remoteCameraFocusPoint({ x: 10, y: 195 }, { width: 844, height: 390 }, { width: 2160, height: 3840 }, false), null);
});

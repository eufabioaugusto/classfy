import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { remoteCameraFocusPoint, remoteCameraModalOrientations, remoteCameraMonitorLayout, remoteCameraQualityLabel } from './remoteCameraMonitorLayout.ts';
import { remoteCameraAudioInputSelected, remoteCameraAudioInputState, remoteCameraAudioPortLabel } from './remoteCameraAudioPicker.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const builtIn = { id: 'qa-built-in', name: 'Microfone do iPhone', type: 'MicrophoneBuiltIn' };
const usb = { id: 'qa-usb', name: 'USB Audio', type: 'USBAudio' };
const audioRoute = { version: 1, available: [builtIn, usb], preferredId: null, current: builtIn, confirmed: true, selecting: false, warning: null };
const audioDevice = audioInput => ({ width: 3840, height: 2160, fps: 30, supportsFocus: true, supportsFocusLock: true, supportsAudioInputSelection: true, audioInput });
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
    'lucide-react-native': Object.fromEntries(['Check', 'ChevronRight', 'CloudUpload', 'Mic', 'Monitor', 'MoreHorizontal', 'RotateCw', 'Unplug', 'X'].map(name => [name, 'icon'])),
    './StudioCaptureAudioMonitor': { StudioCaptureAudioMonitor: 'audio-monitor' },
    './StudioCaptureStorageMonitor': { StudioCaptureStorageMonitor: 'storage-monitor' },
    './remoteCameraMonitorLayout': { remoteCameraFocusPoint, remoteCameraModalOrientations, remoteCameraMonitorLayout, remoteCameraQualityLabel },
    './remoteCameraAudioPicker': { remoteCameraAudioInputSelected, remoteCameraAudioInputState, remoteCameraAudioPortLabel },
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
    radio: label => nodes('pressable').find(node => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel.startsWith(label)),
    update: async patch => { props = { ...props, ...patch }; dirty = true; await pump(); },
    state: async patch => { props = { ...props, state: { ...props.state, ...patch } }; dirty = true; await pump(); },
    focus: async (x, y, locked = false) => { const node = control('remote-camera-focus-surface'); assert.ok(node); const event = { nativeEvent: { locationX: x, locationY: y } }; node.props.onPressIn(); if (locked) node.props.onLongPress(event); node.props.onPress(event); await pump(); },
    runTimers: async () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } await pump(); },
    text: () => nodes('text').map(node => Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children)).join(' '),
    unmount: () => { slots.forEach(slot => slot?.cleanup?.()); tree = null; dirty = false; },
  };
}

test('monitor deixa cena livre: ações em sheet fechado, qualidade real e áudio compacto fora do centro', async () => {
  const h = harness(); try { await h.pump(); assert.equal(h.nodes('native-camera').length, 1); assert.equal(h.nodes('modal').length, 0);
    assert.equal(h.nodes('status-bar')[0].props.hidden, true); assert.ok(h.text().includes('4K')); assert.ok(h.text().includes('30 FPS')); assert.equal(h.control('Enviar original'), undefined);
    for (const label of ['Fechar câmera', 'Opções da câmera remota']) {
      const target = h.control(label).props.style; assert.ok(target.width >= 44 && target.height >= 44, label);
    }
    const audio = h.nodes('audio-monitor')[0]; assert.equal(audio.props.compact, true);
    const corner = h.nodes('view').find(node => node.props.testID === 'remote-camera-audio-corner');
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

test('todos os modals suportam máscara da câmera em retrato/landscape e fechamento próprio', async () => {
  for (const window of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const h = harness({ state: { phase: 'ready', state: audioDevice(audioRoute), previewConnected: true, takeCount: 0 }, onAudioSelect: async () => audioRoute }, { window });
    try { await h.press('Opções da câmera remota'); let modal = h.nodes('modal')[0];
      assert.deepEqual(modal.props.supportedOrientations, ['portrait', 'landscape-left', 'landscape-right']); assert.equal(modal.props.presentationStyle, 'overFullScreen');
      modal.props.onRequestClose(); await h.pump(); assert.equal(h.nodes('modal').length, 0);
      await h.press('remote-camera-audio-selector'); modal = h.nodes('modal')[0]; assert.deepEqual(modal.props.supportedOrientations, remoteCameraModalOrientations);
      assert.equal(modal.props.presentationStyle, 'overFullScreen'); modal.props.onRequestClose(); await h.pump(); assert.equal(h.nodes('modal').length, 0);
    } finally { h.unmount(); }
  }
});

test('barra abre inputs reais; seleção é single-flight e o check segue apenas snapshot confirmado', async () => {
  const gate = deferred(), calls = [], h = harness({ state: { phase: 'ready', state: audioDevice(audioRoute), previewConnected: true, takeCount: 0 },
    onAudioSelect: id => { calls.push(id); return gate.promise; } });
  try { await h.press('remote-camera-audio-selector'); assert.equal(h.radio('Automático.').props.accessibilityState.selected, true); assert.equal(h.radio('USB Audio.').props.accessibilityState.selected, false);
    assert.ok(h.text().includes('Em uso: Microfone do iPhone')); const row = h.radio('USB Audio.'); assert.ok(row.props.style({ pressed: false })[0].minHeight >= 44);
    row.props.onPress(); row.props.onPress(); await h.pump(); assert.deepEqual(calls, [usb.id]); assert.equal(h.radio('USB Audio.').props.accessibilityState.busy, true);
    assert.equal(h.radio('USB Audio.').props.accessibilityState.selected, false); assert.equal(h.radio('Automático.').props.disabled, true);
    const confirmed = { ...audioRoute, preferredId: usb.id, current: usb, confirmed: true };
    gate.resolve(confirmed); await h.pump(); assert.equal(h.radio('USB Audio.').props.accessibilityState.selected, false, 'promise alone must not invent subscribed route');
    await h.state({ state: audioDevice(confirmed) }); assert.equal(h.radio('USB Audio.').props.accessibilityState.selected, true); assert.equal(h.radio('Automático.').props.accessibilityState.selected, false);
    assert.ok(h.text().includes('Em uso: USB Audio')); assert.equal(h.radio('USB Audio.').props.disabled, false);
  } finally { h.unmount(); }
});

test('lista do picker acompanha desconexão real e falha de troca não indica microfone confirmado', async () => {
  const missing = { ...audioRoute, available: [builtIn], preferredId: null, warning: 'Microfone USB desconectado.' }, h = harness({ state: { phase: 'ready', state: audioDevice(audioRoute), previewConnected: true, takeCount: 0 },
    onAudioSelect: async () => ({ ...audioRoute, preferredId: usb.id, confirmed: false, warning: 'O iPhone manteve a entrada anterior.' }) });
  try { await h.press('remote-camera-audio-selector'); h.radio('USB Audio.').props.onPress(); await h.pump(); assert.ok(h.text().includes('O iPhone manteve a entrada anterior.'));
    assert.equal(h.radio('USB Audio.').props.accessibilityState.selected, false); await h.state({ state: audioDevice(missing) }); assert.equal(h.radio('USB Audio.'), undefined); assert.ok(h.text().includes('Microfone USB desconectado.'));
    assert.equal(h.radio('Automático.').props.accessibilityState.selected, true);
  } finally { h.unmount(); }
});

test('REC/saving/processing fecham picker e bloqueiam mudança sem esconder monitor ou Parar', async () => {
  const calls = [], h = harness({ state: { phase: 'ready', state: audioDevice(audioRoute), previewConnected: true, takeCount: 0 }, onAudioSelect: async id => { calls.push(id); return audioRoute; } });
  try { for (const patch of [{ phase: 'starting' }, { phase: 'recording' }, { phase: 'saving' }, { phase: 'ready', processing: true }]) {
      await h.state({ phase: 'ready', processing: false }); await h.press('remote-camera-audio-selector'); assert.equal(h.nodes('modal').length, 1); await h.state(patch);
      assert.equal(h.nodes('modal').length, 0); assert.equal(h.control('remote-camera-audio-selector').props.disabled, true); assert.equal(h.nodes('audio-monitor').length, 1);
      if (patch.phase !== 'ready') assert.ok(h.control('Encerrar e salvar take')); assert.deepEqual(calls, []);
    }
  } finally { h.unmount(); }
});

test('troca de sessão/blur/REC e unmount rejeitam erro ou ACK tardio de input', async () => {
  for (const change of ['session', 'active', 'recording', 'processing', 'unmount']) {
    const gate = deferred(), h = harness({ state: { phase: 'ready', state: audioDevice(audioRoute), previewConnected: true, takeCount: 0 }, onAudioSelect: () => gate.promise });
    await h.press('remote-camera-audio-selector'); h.radio('USB Audio.').props.onPress(); await h.pump();
    if (change === 'session') await h.update({ captureScope: 'owner:other-session' }); else if (change === 'active') await h.update({ active: false });
    else if (change === 'recording') await h.state({ phase: 'recording' }); else if (change === 'processing') await h.state({ processing: true }); else h.unmount();
    gate.reject(Error('Erro de uma conexão antiga.')); await h.pump(); assert.equal(h.text().includes('Erro de uma conexão antiga.'), false, change); assert.equal(h.nodes('modal').length, 0, change); h.unmount();
  }
});


test('armazenamento permanece junto do mic em retrato/paisagem, atualiza durante REC e não altera foco/Parar', async () => {
  for (const window of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const h = harness({ state: { phase: 'recording', state: { ...audioDevice(audioRoute), storageAvailableBytes: 6_300_000_000, storageTotalBytes: 128_000_000_000 }, previewConnected: true, takeCount: 0 } }, { window });
    try {
      assert.equal(h.nodes('storage-monitor').length, 1);
      assert.equal(h.nodes('storage-monitor')[0].props.availableBytes, 6_300_000_000);
      assert.equal(h.nodes('storage-monitor')[0].props.totalBytes, 128_000_000_000);
      assert.equal(h.nodes('audio-monitor').length, 1); assert.ok(h.control('Encerrar e salvar take'));
      await h.state({ state: { ...audioDevice(audioRoute), storageAvailableBytes: 0, storageTotalBytes: 128_000_000_000 } });
      assert.equal(h.nodes('storage-monitor')[0].props.availableBytes, 0);
      await h.focus(window.width / 2, window.height / 2);
      assert.equal(h.calls.filter(call => call[0] === 'focus').length, 1);
      await h.press('Encerrar e salvar take'); assert.deepEqual(h.calls.at(-1), ['stop']);
      await h.update({ active: false });
      assert.equal(h.nodes('storage-monitor')[0].props.availableBytes, undefined);
      assert.equal(h.nodes('storage-monitor')[0].props.totalBytes, undefined);
    } finally { h.unmount(); }
  }
});

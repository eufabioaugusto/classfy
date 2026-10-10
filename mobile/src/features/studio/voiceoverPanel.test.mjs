import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
const code = ts.transpileModule(readFileSync(new URL('./StudioVoiceoverPanel.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const recordingCode = ts.transpileModule(readFileSync(new URL('./voiceoverRecording.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness({ realRecorder = false } = {}) {
  const slots = [], intervals = new Map(), listeners = new Set(), calls = [], saved = [], activity = [], recordingChanges = [], history = [];
  let owner = 'owner', focused = true, disabled = false, allowed = true, cursor = 0, dirty = true, effects = [], tree, timerId = 0, closeCount = 0, preparationPause, stopPause, persistencePause, startPause;
  let scope, phaseRecording = false, nativeStatusCallback, metadataFailures = 0, cancelFailure = false;
  const nativeStatus = { canRecord: false, isRecording: false, durationMillis: 0 };
  let encodedDuration = 0;
  const editing = { ...model.emptyStudioEditing('aula'), assets: [{ id: 'asset', uri: 'file:///video.mp4', kind: 'video', name: 'Vídeo', durationTicks: model.studioTicks(4) }], main: [{ id: 'clip', assetId: 'asset', sourceStartTicks: 0, sourceEndTicks: model.studioTicks(4) }] };
  const project = model.withStudioTakes({ id: 'project', ownerId: 'owner', kind: 'aula', editing, script: 'Roteiro de apoio' });
  let positionSeconds = 1;
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  const hooks = {
    useRef: value => { const i = cursor++; return slots[i] ||= { current: value }; },
    useState: initial => { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useEffect: (callback, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) effects.push({ i, callback, deps }); },
  };
  const jsx = (type, props) => ({ type, props });
  const onActivityChange = value => activity.push(value), canCommit = () => allowed;
  const onRecordingChange = (value, position) => recordingChanges.push({ value, position });
  const onBeforePersist = (latest, next) => history.push({ stage: 'before', latest, next });
  const onPersisted = saved => history.push({ stage: 'persisted', saved });
  const onPersistError = () => history.push({ stage: 'error' });
  const record = { start: async () => { calls.push('start'); if (startPause) await startPause; phaseRecording = true; }, finish: async () => { calls.push('stop'); if (stopPause) await stopPause; phaseRecording = false; return { uri: 'file:///cache/voice.m4a', duration: 1.2, name: 'Narração.m4a' }; }, cancel: async () => { calls.push('cancel'); if (stopPause) await stopPause; phaseRecording = false; if (cancelFailure) { cancelFailure = false; throw new Error('Não foi possível limpar o cache temporário.'); } } };
  class Recording {
    setProgressUpdateInterval() {}
    setOnRecordingStatusUpdate(callback) { nativeStatusCallback = callback; }
    async prepareToRecordAsync() { calls.push('native:prepare'); nativeStatus.canRecord = true; return { ...nativeStatus }; }
    async startAsync() { calls.push('native:start'); phaseRecording = true; nativeStatus.isRecording = true; return { ...nativeStatus }; }
    async stopAndUnloadAsync() { calls.push('native:stop'); phaseRecording = false; nativeStatus.canRecord = false; nativeStatus.isRecording = false; nativeStatus.durationMillis = 0; return { ...nativeStatus, isDoneRecording: true }; }
    async getStatusAsync() { return { ...nativeStatus }; }
    getURI() { return 'file:///cache/voice.m4a'; }
  }
  const recorderDependencies = {
    'expo-av': { Audio: { Recording, requestPermissionsAsync: async () => ({ granted: true }), setAudioModeAsync: async mode => { calls.push(['mode', mode]); }, RecordingOptionsPresets: { HIGH_QUALITY: {} } }, InterruptionModeIOS: {}, InterruptionModeAndroid: {} },
    'expo-file-system/legacy': { deleteAsync: async uri => { calls.push(['delete', uri]); } },
    '../../../modules/classfy-studio-media': { getMediaInfoAsync: async uri => {
      calls.push(['info', uri]); assert.equal(nativeStatus.canRecord, false);
      if (metadataFailures > 0) { metadataFailures--; throw new Error('Leitura indisponível'); }
      return { duration: encodedDuration, hasAudio: true, fileSize: 4096 };
    } },
  };
  const recorderModule = { exports: {} }; new Function('require', 'module', 'exports', recordingCode)(name => recorderDependencies[name], recorderModule, recorderModule.exports);
  const dependencies = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { ActivityIndicator: 'spinner', AppState: { currentState: 'active', addEventListener: (_, callback) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } }, Pressable: 'button', ScrollView: 'scroll', Text: 'text', View: 'view', StyleSheet: { create: styles => styles } },
    '@react-navigation/native': { useIsFocused: () => focused }, 'lucide-react-native': Object.fromEntries('ArrowLeft Check FileText Mic Square Trash2'.split(' ').map(name => [name, name])),
    '@/features/auth/authContext': { useAuth: () => ({ user: { id: owner } }) }, '@/theme/colors': { colors: {} }, './model': model,
    './voiceoverRecording': realRecorder ? recorderModule.exports : { StudioVoiceoverReadError: recorderModule.exports.StudioVoiceoverReadError, prepareStudioVoiceoverRecording: async input => { calls.push('prepare'); scope = input; if (preparationPause) await preparationPause; if (!input.isCurrent()) throw new Error('Preparação cancelada'); return record; } },
    './media': { persistStudioVoiceover: async (_project, audio, position, input) => { calls.push(['persist', audio, position]); if (persistencePause) await persistencePause; if (!input.isCurrent()) throw new Error('Persistência cancelada'); input.onBeforePersist?.(project, editing); input.onPersisted?.(project); return { project, itemId: 'voice-item' }; } },
  };
  const module = { exports: {} }; new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports, callback => { intervals.set(++timerId, callback); return timerId; }, id => intervals.delete(id));
  const render = () => { cursor = 0; effects = []; dirty = false; tree = module.exports.StudioVoiceoverPanel({ project, positionSeconds, disabled, canCommit, onActivityChange, onRecordingChange, onBeforePersist, onPersisted, onPersistError, onClose: () => { closeCount++; }, onSaved: id => saved.push(id) }); for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }; } };
  const pump = async () => { for (let i = 0; i < 40; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty) return; } throw new Error('Voiceover panel did not settle'); };
  const find = predicate => { const visit = node => { if (Array.isArray(node)) { for (const child of node) { const found = visit(child); if (found) return found; } } else if (node && typeof node === 'object') { if (predicate(node)) return node; return visit(node.props?.children); } }; return visit(tree); };
  const control = label => find(node => node.props?.accessibilityLabel === label)?.props;
  const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  return { pump, calls, saved, activity, recordingChanges, history, control, alert: () => find(node => node.props?.accessibilityRole === 'alert')?.props.children, closed: () => closeCount, recording: () => phaseRecording,
    second: async () => { for (const callback of [...intervals.values()]) callback(); await pump(); },
    status: seconds => { if (realRecorder) { encodedDuration = seconds; nativeStatus.durationMillis = seconds * 1000; nativeStatusCallback?.({ ...nativeStatus, metering: -18 }); } else scope.onStatus({ recording: phaseRecording, duration: seconds, metering: -18 }); },
    interrupt: () => { if (realRecorder) { nativeStatus.isRecording = false; nativeStatus.durationMillis = 0; nativeStatusCallback?.({ ...nativeStatus }); } else scope.onStatus({ recording: false, duration: 1.2, interrupted: true }); },
    failMetadataOnce: () => { metadataFailures++; }, failCacheCleanup: () => { cancelFailure = true; },
    update: patch => { if ('owner' in patch) owner = patch.owner; if ('focused' in patch) focused = patch.focused; if ('disabled' in patch) disabled = patch.disabled; if ('allowed' in patch) allowed = patch.allowed; if ('positionSeconds' in patch) positionSeconds = patch.positionSeconds; dirty = true; },
    appState: state => { for (const callback of listeners) callback(state); },
    pauseStart: () => { const wait = defer(); startPause = wait.promise; return wait.resolve; },
    pausePreparation: () => { const wait = defer(); preparationPause = wait.promise; return wait.resolve; }, pauseStop: () => { const wait = defer(); stopPause = wait.promise; return wait.resolve; }, pausePersistence: () => { const wait = defer(); persistencePause = wait.promise; return wait.resolve; },
    dispose: async () => { for (const slot of slots) slot?.cleanup?.(); await new Promise(resolve => setImmediate(resolve)); } };
}
test('painel só começa após três segundos, impede duplicação e salva no cursor inicial', async () => {
  const h = harness(); try {
    await h.pump(); const begin = h.control('Gravar narração'); begin.onPress(); begin.onPress(); await h.pump();
    assert.equal(h.calls.filter(call => call === 'prepare').length, 1); assert.equal(h.calls.includes('start'), false);
    await h.second(); await h.second(); assert.equal(h.calls.includes('start'), false); await h.second(); assert.equal(h.calls.filter(call => call === 'start').length, 1);
    h.status(1.2); await h.pump(); h.update({ positionSeconds: 2 }); await h.pump(); h.control('Parar narração').onPress(); await h.pump();
    assert.ok(h.control('Usar narração')); const save = h.control('Usar narração'); save.onPress(); save.onPress(); await h.pump();
    assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'persist').length, 1); assert.equal(h.calls.find(call => Array.isArray(call))[2], 1); assert.deepEqual(h.saved, ['voice-item']); assert.deepEqual(h.history.map(item => item.stage), ['before', 'persisted']);
    assert.deepEqual(h.recordingChanges.filter(item => item.value), [{ value: true, position: 1 }]); assert.equal(h.recordingChanges.at(-1).value, false);
  } finally { await h.dispose(); }
});
test('cancelar contagem libera sessão sem iniciar nem copiar áudio', async () => {
  const h = harness(); try { await h.pump(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); h.control('Cancelar contagem').onPress(); await h.pump(); await h.second(); await h.second();
    assert.equal(h.calls.includes('start'), false); assert.equal(h.calls.some(call => Array.isArray(call)), false); assert.ok(h.control('Gravar narração'));
  } finally { await h.dispose(); }
});
for (const interruption of ['owner', 'focus', 'background', 'canCommit']) test(`gravação em curso é cancelada por ${interruption} sem retorno tardio`, async () => {
  const h = harness(); try {
    await h.pump(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); await h.second(); await h.second(); assert.equal(h.recording(), true);
    if (interruption === 'owner') h.update({ owner: 'other' }); else if (interruption === 'focus') h.update({ focused: false }); else if (interruption === 'canCommit') { h.update({ allowed: false }); } else h.appState('background');
    await h.pump(); assert.equal(h.recording(), false); assert.deepEqual(h.saved, []); assert.equal(h.calls.some(call => Array.isArray(call)), false);
  } finally { await h.dispose(); }
});
test('Fechar aguarda stop/unload em vez de desmontar com microfone ativo', async () => {
  const h = harness(); try {
    await h.pump(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); await h.second(); await h.second();
    const release = h.pauseStop(); h.control('Fechar narração').onPress(); await h.pump(); assert.equal(h.closed(), 0); assert.equal(h.recording(), true);
    release(); await h.pump(); assert.equal(h.recording(), false); assert.equal(h.closed(), 1);
  } finally { await h.dispose(); }
});
test('permissão que deixa iOS inativo não é confundida com app em background', async () => {
  const h = harness(); try {
    await h.pump(); const release = h.pausePreparation(); h.control('Gravar narração').onPress(); await h.pump(); h.appState('inactive'); await h.pump(); h.appState('active'); release(); await h.pump();
    assert.ok(h.control('Cancelar contagem')); await h.second(); await h.second(); await h.second(); assert.equal(h.recording(), true);
  } finally { await h.dispose(); }
});
test('limite da montagem para gravação automaticamente sem estender a timeline', async () => {
  const h = harness(); try {
    await h.pump(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); await h.second(); await h.second(); h.status(3.1); await h.pump();
    assert.equal(h.calls.filter(call => call === 'stop').length, 1); assert.equal(h.recording(), false); assert.ok(h.control('Usar narração'));
  } finally { await h.dispose(); }
});
test('cancelamento durante cópia espera compromisso antes de apagar cache e não seleciona resultado obsoleto', async () => {
  const h = harness(); try {
    await h.pump(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); await h.second(); await h.second(); h.control('Parar narração').onPress(); await h.pump();
    const release = h.pausePersistence(); h.control('Usar narração').onPress(); await h.pump(); const before = h.calls.filter(call => call === 'cancel').length;
    h.update({ focused: false }); await h.pump(); assert.equal(h.calls.filter(call => call === 'cancel').length, before);
    release(); await h.pump(); assert.ok(h.calls.filter(call => call === 'cancel').length > before); assert.deepEqual(h.saved, []);
  } finally { await h.dispose(); }
});

test('acompanhamento da montagem começa só após start real e encerra no cancelamento', async () => {
  const h = harness(); try {
    await h.pump(); const release = h.pauseStart(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); await h.second();
    assert.equal(h.recordingChanges.some(item => item.value), false); await h.second(); assert.equal(h.recordingChanges.some(item => item.value), false);
    release(); await h.pump(); assert.deepEqual(h.recordingChanges.filter(item => item.value), [{ value: true, position: 1 }]);
    h.appState('background'); await h.pump(); assert.equal(h.recordingChanges.at(-1).value, false); assert.equal(h.recording(), false); assert.deepEqual(h.history, []);
  } finally { await h.dispose(); }
});

test('painel e recorder reais aceitam o M4A após stop iOS zerar status e persistem no cursor de entrada', async () => {
  const h = harness({ realRecorder: true }); try {
    await h.pump(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); await h.second(); await h.second();
    h.status(1.2); await h.pump(); h.update({ positionSeconds: 2 }); await h.pump(); h.control('Parar narração').onPress(); await h.pump();
    assert.ok(h.control('Usar narração')); assert.equal(h.recording(), false);
    assert.equal(h.calls.filter(call => call === 'native:stop').length, 1); assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'delete'), false);
    h.control('Usar narração').onPress(); await h.pump(); const copied = h.calls.find(call => Array.isArray(call) && call[0] === 'persist');
    assert.equal(copied[1].duration, 1.2); assert.equal(copied[2], 1); assert.deepEqual(h.saved, ['voice-item']);
    assert.ok(h.calls.findIndex(call => Array.isArray(call) && call[0] === 'delete') > h.calls.indexOf(copied), 'original temporário só é removido após persistência');
  } finally { await h.dispose(); }
});

test('interrupção real de status encerra o mic uma vez e oferece somente o trecho validado', async () => {
  const h = harness({ realRecorder: true }); try {
    await h.pump(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); await h.second(); await h.second();
    h.status(1.2); await h.pump(); h.interrupt(); await h.pump();
    assert.equal(h.recording(), false); assert.equal(h.calls.filter(call => call === 'native:stop').length, 1); assert.ok(h.control('Usar narração'));
    assert.match(h.alert(), /microfone foi interrompido.*trecho gravado/);
    assert.equal(h.recordingChanges.at(-1).value, false); assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'persist'), false);
    h.control('Usar narração').onPress(); await h.pump(); assert.equal(h.alert(), undefined); assert.deepEqual(h.saved, ['voice-item']);
  } finally { await h.dispose(); }
});

test('aviso de trecho interrompido sobrevive à recuperação e só some ao descartar', async () => {
  const h = harness({ realRecorder: true }); try {
    await h.pump(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); await h.second(); await h.second(); h.status(1.2); await h.pump();
    h.failMetadataOnce(); h.interrupt(); await h.pump(); assert.ok(h.control('Recuperar narração')); assert.match(h.alert(), /recuperar/);
    h.control('Recuperar narração').onPress(); await h.pump(); assert.ok(h.control('Usar narração')); assert.match(h.alert(), /microfone foi interrompido.*trecho gravado/);
    h.control('Descartar narração').onPress(); await h.pump(); assert.equal(h.alert(), undefined); assert.ok(h.control('Gravar narração')); assert.deepEqual(h.saved, []);
  } finally { await h.dispose(); }
});

test('leitura temporariamente indisponível recupera a mesma voz sem nova gravação ou unload', async () => {
  const h = harness({ realRecorder: true }); try {
    await h.pump(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); await h.second(); await h.second(); h.status(1.2); await h.pump();
    h.failMetadataOnce(); h.control('Parar narração').onPress(); await h.pump();
    assert.ok(h.control('Recuperar narração')); assert.equal(h.control('Gravar narração'), undefined); assert.equal(h.control('Usar narração'), undefined);
    assert.equal(h.recording(), false); assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'delete'), false);
    h.control('Recuperar narração').onPress(); await h.pump(); assert.ok(h.control('Usar narração'));
    assert.equal(h.calls.filter(call => call === 'native:start').length, 1); assert.equal(h.calls.filter(call => call === 'native:stop').length, 1);
    h.control('Usar narração').onPress(); await h.pump(); assert.deepEqual(h.saved, ['voice-item']);
  } finally { await h.dispose(); }
});

test('fechar recovery descarta apenas o cache sem persistir ou reiniciar microfone', async () => {
  const h = harness({ realRecorder: true }); try {
    await h.pump(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); await h.second(); await h.second(); h.status(1.2); await h.pump();
    h.failMetadataOnce(); h.control('Parar narração').onPress(); await h.pump(); h.control('Fechar narração').onPress(); await h.pump();
    assert.equal(h.closed(), 1); assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'delete').length, 1); assert.deepEqual(h.saved, []);
    assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'persist'), false);
  } finally { await h.dispose(); }
});

test('cache falha depois do commit: Concluir tenta só limpeza e nunca anuncia descarte da camada salva', async () => {
  const h = harness(); try {
    await h.pump(); h.control('Gravar narração').onPress(); await h.pump(); await h.second(); await h.second(); await h.second(); h.status(1.2); await h.pump();
    h.control('Parar narração').onPress(); await h.pump(); h.failCacheCleanup(); h.control('Usar narração').onPress(); await h.pump();
    assert.ok(h.control('Concluir narração')); assert.equal(h.control('Descartar narração'), undefined); assert.equal(h.control('Usar narração'), undefined);
    assert.deepEqual(h.history.map(item => item.stage), ['before', 'persisted']); assert.deepEqual(h.saved, []);
    h.control('Concluir narração').onPress(); await h.pump(); assert.deepEqual(h.saved, ['voice-item']);
    assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'persist').length, 1);
  } finally { await h.dispose(); }
});

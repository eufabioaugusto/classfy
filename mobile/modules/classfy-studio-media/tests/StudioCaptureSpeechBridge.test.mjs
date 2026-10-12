import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function production(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Speech boundary missing: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const camera = Object.fromEntries([
  'getStudioNativeCameraCapabilitiesAsync', 'configureStudioNativeCameraAsync',
  'startStudioNativeCameraRecordingAsync', 'stopStudioNativeCameraRecordingAsync',
  'setStudioNativeCameraZoomAsync', 'setStudioNativeCameraExposureAsync',
  'setStudioNativeCameraFocusAsync', 'setStudioNativeCameraTorchAsync',
].map(name => [name, () => { throw Error('This speech test cannot alter capture'); }]));
function bridge(native) {
  return production('../index.ts', { 'expo-modules-core': { requireOptionalNativeModule: () => native } });
}

test('old binary and missing permission API keep Speech unavailable without touching recorder', async () => {
  for (const native of [null, camera, { ...camera, getStudioNativeCameraSpeechVersionAsync() {} }]) {
    const api = bridge(native);
    assert.equal(api.isStudioNativeCameraSpeechAvailable(), false);
    assert.deepEqual(await api.requestStudioCaptureSpeechPermissionAsync(), { granted: false, canAskAgain: false });
  }
});
test('permission only runs on explicit bridge request and waits for native result', async () => {
  let calls = 0, resolve;
  const api = bridge({ ...camera, getStudioNativeCameraSpeechVersionAsync() {},
    requestStudioCaptureSpeechPermissionAsync: () => { calls++; return new Promise(next => { resolve = next; }); },
  });
  assert.equal(api.isStudioNativeCameraSpeechAvailable(), true);
  assert.equal(calls, 0);
  const permission = api.requestStudioCaptureSpeechPermissionAsync();
  assert.equal(calls, 1);
  resolve({ granted: true, canAskAgain: true });
  assert.deepEqual(await permission, { granted: true, canAskAgain: true });
});
test('native denial and rejection remain explicit, without manufactured authorization', async () => {
  const common = { ...camera, getStudioNativeCameraSpeechVersionAsync() {} };
  const denied = bridge({ ...common, requestStudioCaptureSpeechPermissionAsync: async () => ({ granted: false, canAskAgain: false }) });
  assert.deepEqual(await denied.requestStudioCaptureSpeechPermissionAsync(), { granted: false, canAskAgain: false });
  const failure = Error('Speech unavailable');
  const failed = bridge({ ...common, requestStudioCaptureSpeechPermissionAsync: async () => { throw failure; } });
  await assert.rejects(failed.requestStudioCaptureSpeechPermissionAsync(), error => error === failure);
});

function wrapper(initial = {}) {
  const cells = [], received = [], commands = [];
  let cursor = 0, options = { available: true, active: true, speechEnabled: true, speechSessionId: 'reader-a', ...initial };
  const react = {
    useRef(value) { const index = cursor++; return cells[index] ||= { current: value }; },
    useEffect(callback) { const index = cursor++; if (!cells[index]) cells[index] = { cleanup: callback() }; },
    useImperativeHandle(ref, callback) { cursor++; ref.current = callback(); },
    forwardRef: callback => callback,
  };
  const api = {
    isStudioNativeCameraAvailable: () => true,
    isStudioNativeCameraEffectsAvailable: () => false,
    isStudioNativeCameraSpeechAvailable: () => options.available,
    startStudioNativeCameraRecordingAsync: () => { commands.push('start'); throw Error('No REC allowed'); },
    stopStudioNativeCameraRecordingAsync: () => { commands.push('stop'); },
    setStudioNativeCameraEffectAsync: () => { commands.push('effect'); throw Error('No effects allowed'); },
  };
  const module = production('../../../src/features/studio/StudioNativeCamera.tsx', {
    react, 'expo-crypto': { randomUUID: () => 'unused-recording-id' },
    'expo-modules-core': { requireNativeViewManager: () => 'native-camera' },
    'react-native': { Platform: { OS: 'ios' }, findNodeHandle: () => 73 },
    'react/jsx-runtime': { jsx: (_type, props) => props },
    '../../../modules/classfy-studio-media': api, './model': { normalizeStudioCaptureGrade: value => value },
  });
  let props;
  function render() { cursor = 0; props = module.StudioNativeCamera({ ...options, onSpeech: value => received.push(value) }, { current: null }); }
  render();
  const payload = patch => ({ sessionId: 'reader-a', generation: 2, sequence: 1, segmentId: 1,
    type: 'result', transcript: 'Olá, creator', isFinal: false, ...patch });
  return { received, commands, payload, props: () => props,
    update(patch) { options = { ...options, ...patch }; render(); },
    event(value = payload()) { props.onSpeech?.({ nativeEvent: value }); },
    generation(value) { props.onState({ nativeEvent: { generation: value } }); },
    unmount() { cells.forEach(cell => cell?.cleanup?.()); },
  };
}
test('native view receives reader props and matching events without recorder commands', () => {
  const h = wrapper();
  assert.equal(h.props().speechLocale, 'pt-BR');
  assert.equal(h.props().speechEnabled, true);
  assert.equal(h.props().speechSessionId, 'reader-a');
  h.event(); assert.equal(h.received.length, 0, 'camera generation must be observed first');
  h.generation(2); h.event();
  assert.equal(h.received.length, 1);
  h.event(h.payload({ type: 'status', status: 'paused', code: 'awaiting_speech', sequence: 2 }));
  assert.equal(h.received.length, 2, 'natural silence remains an enabled reader');
  assert.deepEqual(h.commands, []);
});
test('old callbacks cannot enter another reader, inactive view or remounted camera', () => {
  const h = wrapper(); h.generation(2);
  const oldHandler = h.props().onSpeech;
  for (const patch of [{ sessionId: 'other' }, { generation: 1 }, { sequence: 0 }, { sequence: 1.2 },
    { segmentId: -1 }, { type: 'unknown' }]) h.event(h.payload(patch));
  assert.equal(h.received.length, 0);
  h.update({ speechSessionId: 'reader-b' }); oldHandler({ nativeEvent: h.payload() });
  assert.equal(h.received.length, 0);
  h.event(h.payload({ sessionId: 'reader-b' })); assert.equal(h.received.length, 1);
  h.update({ active: false }); h.event(h.payload({ sessionId: 'reader-b' }));
  h.update({ active: true, speechEnabled: false }); h.event(h.payload({ sessionId: 'reader-b' }));
  h.update({ speechEnabled: true }); h.generation(3); h.generation(2);
  h.event(h.payload({ sessionId: 'reader-b' })); assert.equal(h.received.length, 1);
  h.event(h.payload({ sessionId: 'reader-b', generation: 3 })); assert.equal(h.received.length, 2);
  h.unmount(); h.event(h.payload({ sessionId: 'reader-b', generation: 3 }));
  assert.equal(h.received.length, 2); assert.deepEqual(h.commands, []);
});
test('old binary receives no unsupported speech view prop or callback', () => {
  const h = wrapper({ available: false });
  for (const key of ['speechEnabled', 'speechSessionId', 'speechLocale', 'onSpeech']) assert.equal(h.props()[key], undefined);
  assert.deepEqual(h.commands, []);
});

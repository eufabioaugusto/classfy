import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function bridge(native) {
  const code = ts.transpileModule(readFileSync(new URL('../../../modules/classfy-studio-media/index.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.equal(name, 'expo-modules-core'); return { requireOptionalNativeModule: () => native };
  }, module, module.exports);
  return module.exports;
}
function nativeCamera(extra = {}) {
  return Object.fromEntries(['getStudioNativeCameraCapabilitiesAsync', 'configureStudioNativeCameraAsync',
    'startStudioNativeCameraRecordingAsync', 'stopStudioNativeCameraRecordingAsync', 'setStudioNativeCameraZoomAsync',
    'setStudioNativeCameraExposureAsync', 'setStudioNativeCameraFocusAsync', 'setStudioNativeCameraTorchAsync']
    .map(name => [name, async () => ({})]).concat(Object.entries(extra)));
}

test('binário anterior mantém captura disponível e recusa seleção sem inventar entradas ou chamada nativa', async () => {
  const api = bridge(nativeCamera());
  assert.equal(api.isStudioNativeCameraAvailable(), true); assert.equal(api.isStudioNativeAudioInputSelectionAvailable(), false);
  assert.deepEqual(await api.getStudioNativeAudioInputSelectionVersionAsync(), { version: 0, available: false });
  await assert.rejects(api.setStudioNativeAudioInputAsync(73, 'usb'), /Atualize/);
  const half = bridge(nativeCamera({ getStudioNativeAudioInputSelectionVersionAsync: async () => ({ version: 1, available: true }) }));
  assert.equal(half.isStudioNativeAudioInputSelectionAvailable(), false);
});
test('versão indisponível ou desconhecida não encaminha seletor ao hardware', async () => {
  for (const version of [{ version: 1, available: false }, { version: 2, available: true }]) {
    let calls = 0;
    const api = bridge(nativeCamera({ getStudioNativeAudioInputSelectionVersionAsync: async () => version,
      setStudioNativeAudioInputAsync: async () => { calls++; return {}; } }));
    assert.equal((await api.getStudioNativeAudioInputSelectionVersionAsync()).available, false);
    await assert.rejects(api.setStudioNativeAudioInputAsync(73, null), /Atualize/); assert.equal(calls, 0);
  }
});
test('UID exato e Automático chegam ao mesmo tag, com ACK real e erro de rota preservados', async () => {
  const calls = [], receipt = { supportsAudioInputSelection: true, audioInput: { version: 1, available: [],
    preferredId: 'USB:receiver', current: { id: 'USB:receiver', name: 'Receptor USB', type: 'USBAudio' }, confirmed: true, selecting: false, warning: null } };
  let fail = false;
  const api = bridge(nativeCamera({ getStudioNativeAudioInputSelectionVersionAsync: async () => ({ version: 1, available: true }),
    setStudioNativeAudioInputAsync: async (...args) => { calls.push(args); if (fail) throw new Error('Microfone desconectado.'); return receipt; } }));
  assert.strictEqual(await api.setStudioNativeAudioInputAsync(73, 'USB:receiver'), receipt);
  assert.strictEqual(await api.setStudioNativeAudioInputAsync(73, null), receipt);
  assert.deepEqual(calls, [[73, 'USB:receiver'], [73, null]]);
  fail = true; await assert.rejects(api.setStudioNativeAudioInputAsync(73, 'USB:receiver'), /Microfone desconectado/);
  await assert.rejects(api.setStudioNativeAudioInputAsync(73, ''), /Escolha/);
  await assert.rejects(api.setStudioNativeAudioInputAsync(73, 'x'.repeat(513)), /Escolha/);
  assert.equal(calls.length, 3);
});

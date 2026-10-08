import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// New JavaScript can run in an older development binary. Exercise the actual
// bridge against independent native capabilities, without loading React Native.
function bridge(native) {
  const code = ts.transpileModule(readFileSync(new URL('../../../modules/classfy-studio-media/index.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'expo-modules-core') return { requireOptionalNativeModule: () => native };
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

function camera() {
  return Object.fromEntries([
    'getStudioNativeCameraCapabilitiesAsync', 'configureStudioNativeCameraAsync',
    'startStudioNativeCameraRecordingAsync', 'stopStudioNativeCameraRecordingAsync',
    'setStudioNativeCameraZoomAsync', 'setStudioNativeCameraExposureAsync',
    'setStudioNativeCameraFocusAsync', 'setStudioNativeCameraTorchAsync',
  ].map(name => [name, async () => ({})]));
}
const composition = { exportRecipeAsync() {}, seekStudioCompositionAsync() {} };

test('binário anterior mantém câmera normal mas recusa tratamento sem confirmação nativa', () => {
  const module = bridge({ ...camera(), ...composition });
  assert.equal(module.isStudioNativeCameraAvailable(), true);
  assert.equal(module.isStudioNativeCameraEffectsAvailable(), false);
  assert.throws(() => module.setStudioNativeCameraEffectAsync(73, '{}'), /Atualize o Classfy Dev/);
});

test('tratamento ao vivo não é oferecido sem exportador da mesma composição', () => {
  let calls = 0;
  const module = bridge({ ...camera(), setStudioNativeCameraEffectAsync() { calls++; } });
  assert.equal(module.isStudioNativeCameraEffectsAvailable(), false);
  assert.throws(() => module.setStudioNativeCameraEffectAsync(73, '{}'), /Atualize/);
  assert.equal(calls, 0);
});

test('bridge espera o quadro confirmado sem fabricar sucesso ou modificar a receita', async () => {
  let resolve, received;
  const module = bridge({ ...camera(), ...composition,
    setStudioNativeCameraEffectAsync: (...args) => { received = args; return new Promise(value => { resolve = value; }); },
  });
  const grade = { preset: 'cinematic', intensity: 0.6, exposure: 0, contrast: 0, saturation: 0, temperature: 0 };
  const json = JSON.stringify(grade);
  let settled = false;
  const request = module.setStudioNativeCameraEffectAsync(73, json).then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(received, [73, json]);
  const ack = { effectRevision: 4, previewProcessed: true, grade, generation: 9 };
  resolve(ack);
  assert.equal(await request, ack);
});

test('falha nativa de tratamento permanece uma falha, sem retorno ao processamento fictício', async () => {
  const failure = new Error('A prévia de tratamento não está disponível neste formato.');
  const module = bridge({ ...camera(), ...composition,
    setStudioNativeCameraEffectAsync: async () => { throw failure; },
  });
  await assert.rejects(module.setStudioNativeCameraEffectAsync(73, '{}'), error => error === failure);
});

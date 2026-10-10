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
const composition = { exportRecipeAsync() {}, seekStudioCompositionAsync() {} };
const capable = { version: 2, available: true, colorSpace: 'rec709', minimumDimension: 64,
  maximumDimension: 3840, maximumShortDimension: 2160, maximumPixels: 8294400,
  arbitraryEvenDimensions: true, supportsHEVC: true,
  resolutions: [{ id: 'hd', width: 1920, height: 1080, codec: 'h264' }, { id: '2k', width: 2560, height: 1440, codec: 'h264' }, { id: '4k', width: 3840, height: 2160, codec: 'h264' }],
  frameRates: [{ numerator: 24, denominator: 1 }, { numerator: 30, denominator: 1 }, { numerator: 60, denominator: 1 }, { numerator: 60000, denominator: 1001 }] };
test('binário anterior só anuncia composição HD30, sem transformar presença de câmera4K em capacidade de export', async () => {
  const value = await bridge({ ...composition, getStudioNativeCameraCapabilitiesAsync() {} }).getStudioExportCapabilitiesAsync();
  assert.equal(value.version, 1); assert.equal(value.available, true);
  assert.equal(value.maximumDimension, 1920); assert.equal(value.maximumShortDimension, 1080);
  assert.equal(value.arbitraryEvenDimensions, false);
  assert.deepEqual(value.frameRates, [{ numerator: 30, denominator: 1 }]);
  assert.deepEqual(value.resolutions.map(item => item.id), ['hd']);
});
test('sem compositor ou confirmação válida não anuncia saída avançada', async () => {
  assert.equal((await bridge(null).getStudioExportCapabilitiesAsync()).available, false);
  for (const nativeValue of [{ ...capable, version: 3 }, { ...capable, maximumDimension: 8192 },
    { ...capable, colorSpace: 'hdr' }, { ...capable, maximumPixels: NaN }, { ...capable, frameRates: [] }]) {
    assert.equal((await bridge({ ...composition, getStudioExportCapabilitiesAsync: async () => nativeValue }).getStudioExportCapabilitiesAsync()).version, 1);
  }
  assert.equal((await bridge({ ...composition, getStudioExportCapabilitiesAsync: async () => { throw new Error('unavailable'); } }).getStudioExportCapabilitiesAsync()).version, 1);
});
test('v2 conserva dimensões reais, fracionais e HEVC; copia arrays de capability', async () => {
  const value = await bridge({ ...composition, getStudioExportCapabilitiesAsync: async () => capable }).getStudioExportCapabilitiesAsync();
  assert.deepEqual(value, capable); assert.notEqual(value.resolutions, capable.resolutions); assert.notEqual(value.frameRates, capable.frameRates);
});
test('sem HEVC60 confirmado respeita cadências até30 e recusa combinação contraditória', async () => {
  const value = await bridge({ ...composition, getStudioExportCapabilitiesAsync: async () => ({ ...capable, supportsHEVC: false, frameRates: capable.frameRates.slice(0, 2) }) }).getStudioExportCapabilitiesAsync();
  assert.deepEqual(value.frameRates, capable.frameRates.slice(0, 2));
  assert.equal((await bridge({ ...composition, getStudioExportCapabilitiesAsync: async () => ({ ...capable, supportsHEVC: false }) }).getStudioExportCapabilitiesAsync()).version, 1);
  const unavailable = await bridge({ ...composition, getStudioExportCapabilitiesAsync: async () => ({ ...capable, available: false }) }).getStudioExportCapabilitiesAsync();
  assert.equal(unavailable.version, 2); assert.equal(unavailable.available, false);
});

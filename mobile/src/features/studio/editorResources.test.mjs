import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { libraryHarness } from './studioLibraryTestSupport.mjs';

test('fontes salvas e recentes sobrevivem à reabertura e permanecem isoladas por conta', async () => {
  const storage = new Map(), a = libraryHarness(storage);
  await a.saveStudioTextLibrary('ana', { favorites: ['Georgia', 'Menlo-Regular', 'Georgia', 'arquivo-arbitrario'], recent: ['Menlo-Regular', 'System'] });
  await a.saveStudioTextLibrary('bia', { favorites: ['Verdana'], recent: [] });
  const b = libraryHarness(storage);
  assert.deepEqual(await b.loadStudioTextLibrary('ana'), { favorites: ['Georgia', 'Menlo-Regular'], recent: ['Menlo-Regular', 'System'] });
  assert.deepEqual(await b.loadStudioTextLibrary('bia'), { favorites: ['Verdana'], recent: [] });
  storage.set('classfy:studio:text-library:v1:ana', '{corrompido');
  assert.deepEqual(await b.loadStudioTextLibrary('ana'), { favorites: [], recent: [] });
});
test('salvamentos de fontes são serializados e falha não impede nova tentativa', async () => {
  const pending = [], storage = new Map();
  const h = libraryHarness(storage, { setItem: (key, value) => new Promise((resolve, reject) => pending.push({ key, value, resolve: () => { storage.set(key, value); resolve(); }, reject })) });
  const first = h.saveStudioTextLibrary('ana', { favorites: ['Georgia'], recent: [] });
  const second = h.saveStudioTextLibrary('ana', { favorites: ['Verdana'], recent: [] });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(pending.length, 1);
  pending[0].reject(new Error('Disco indisponível')); await assert.rejects(first);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(pending.length, 2);
  pending[1].resolve(); await second;
  assert.deepEqual(await h.loadStudioTextLibrary('ana'), { favorites: ['Verdana'], recent: [] });
});
function bridge(native) {
  const source = ts.transpileModule(readFileSync(new URL('../../../modules/classfy-studio-media/index.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(() => ({ requireOptionalNativeModule: () => native }), module, module.exports);
  return module.exports;
}
test('binário antigo exporta receita legada e bloqueia efeitos novos antes de entregar ao encoder', async () => {
  let calls = 0;
  const h = bridge({ exportRecipeAsync: async () => { calls++; return {}; }, seekStudioCompositionAsync() {} });
  const send = clips => h.exportRecipeAsync({ requestId: 'request', recipeJSON: JSON.stringify({ clips }), outputUri: 'file:///output.mp4' });
  await send([{ text: { content: 'Título' }, playbackRate: 1 }]); assert.equal(calls, 1);
  for (const clip of [{ playbackRate: 2 }, { flipHorizontal: true }, { flipVertical: true }, { motion: 'pulse' }, { text: { animation: 'typewriter' } }, { text: { gradientColors: ['#FFFFFF', '#FF0000'] } }, { text: { decoration: 'outline' } }, { text: { visualEffect: 'neon' } }]) await assert.rejects(send([clip]), /Instale o Classfy Dev atualizado/);
  assert.equal(calls, 1);
});
test('capacidade moderna precisa confirmar versão antes de exportar e não altera a receita', async () => {
  let version = 4, captured;
  const h = bridge({ exportRecipeAsync: async options => { captured = options; return {}; }, seekStudioCompositionAsync() {}, getStudioEditorCapabilitiesAsync: async () => ({ version, available: true }) });
  const options = { requestId: 'request', recipeJSON: JSON.stringify({ clips: [{ playbackRate: 2, text: { animation: 'fade' } }] }), outputUri: 'file:///output.mp4' };
  await assert.rejects(h.exportRecipeAsync(options)); assert.equal(captured, undefined);
  version = 1; await h.exportRecipeAsync(options); assert.deepEqual(captured, options);
});

test('binário antigo bloqueia áudio separado de vídeo e fades do principal antes do encoder', async () => {
  let calls = 0;
  const h = bridge({ exportRecipeAsync: async () => { calls++; return {}; }, seekStudioCompositionAsync() {} });
  for (const recipe of [
    { assets: [{ id: 'video', kind: 'video', hasAudio: true }], clips: [{ kind: 'audio', assetId: 'video', playbackRate: 1 }] },
    { assets: [], clips: [{ kind: 'video', zIndex: 0, opacity: 1, fadeInTicks: 12000, fadeOutTicks: 0 }] },
    { assets: [], clips: [{ kind: 'video', zIndex: 0, opacity: .5, fadeInTicks: 0, fadeOutTicks: 0 }] },
  ]) await assert.rejects(h.exportRecipeAsync({ requestId: 'request', recipeJSON: JSON.stringify(recipe), outputUri: 'file:///output.mp4' }), /Instale o Classfy Dev atualizado/);
  assert.equal(calls, 0);
});

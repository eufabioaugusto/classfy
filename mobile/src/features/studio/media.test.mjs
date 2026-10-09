import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const plain = value => JSON.parse(JSON.stringify(value));
function compile(file, dependencies) {
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => dependencies[name], Promise, Date, Error });
  return module.exports;
}
function harness(options = {}) {
  const disk = new Map(options.disk); let sequence = 0, repair = false, nativeExports = 0, sessionCheck, copyCheck;
  let sessionOwner = 'owner', pickerCanceled = false;
  const crypto = { randomUUID: () => `id-${++sequence}` };
  const fileSystem = { documentDirectory: 'file:///current/Documents/',
    makeDirectoryAsync: async () => {}, copyAsync: async ({from, to}) => { disk.set(to, { bad: from.includes('broken') }); await copyCheck?.(); },
    getInfoAsync: async uri => ({ exists: disk.has(uri), isDirectory: false, size: 100 }),
  };
  const data = new Map(options.data);
  const model = compile('./model.ts', {});
  const store = compile('./store.ts', { '@react-native-async-storage/async-storage': {
    getItem: async key => data.get(key) || null, setItem: async (key, value) => { data.set(key, value); },
  }, 'expo-file-system/legacy': fileSystem, 'expo-crypto': crypto, './model': model });
  const nativeCalls = [];
  const imageCalls = [];
  const copies = [];
  const copy = fileSystem.copyAsync;
  fileSystem.copyAsync = async options => { copies.push(options); await copy(options); };
  const native = {
    isStudioMediaAvailable: () => options.mediaAvailable !== false, isStudioCompositionAvailable: () => options.compositionAvailable !== false,
    exportRecipeAsync: async options => { nativeExports++; nativeCalls.push({ kind: 'recipe', ...options }); return { uri: options.outputUri, duration: 2, mimeType: 'video/mp4', fileSize: 100 }; },
    getMediaInfoAsync: async uri => {
      if (!repair && disk.get(uri)?.bad) throw new Error('Arquivo temporariamente ilegível');
      return options.mediaInfo?.(uri) || { duration: 2, width: 320, height: 180, hasVideo: true, hasAudio: true, fileSize: 100 };
    },
    generateThumbnailAsync: async (_uri, output) => { disk.set(output, {}); return { uri: output }; },
    cancelExportAsync: async () => {}, exportTimelineAsync: async options => {
      nativeExports++; nativeCalls.push({ kind: 'legacy', ...options }); return { uri: options.outputUri, duration: 2, mimeType: 'video/mp4', fileSize: 100 };
    },
  };
  const media = compile('./media.ts', { 'expo-file-system/legacy': fileSystem, 'expo-crypto': crypto,
    'react-native': { Alert: { alert() {} } },
    'expo-image-picker': { UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' }, launchImageLibraryAsync: async () => ({ canceled: pickerCanceled,
      assets: options.pickerAssets || [{ uri: 'file:///good.mp4', fileName: 'Bom' }, { uri: 'file:///broken.mp4', fileName: 'Pendente' }] }) },
    'expo-document-picker': { getDocumentAsync: async () => ({ canceled: pickerCanceled, assets: options.pickerAssets || [{ uri: 'file:///audio.m4a', name: 'Áudio.m4a' }] }) },
    'expo-image-manipulator': { ImageManipulator: { manipulate: uri => ({
      renderAsync: async () => {
        imageCalls.push({ operation: 'render', uri });
        if (!repair && disk.get(uri)?.bad) throw new Error('Imagem ilegível');
        return { width: options.imageWidth ?? 1200, height: options.imageHeight ?? 800,
          release: () => imageCalls.push({ operation: 'release-image', uri }) };
      }, release: () => imageCalls.push({ operation: 'release-context', uri }),
    }) } }, '@/lib/supabase': { supabase: { auth: { getSession: async () => {
      await sessionCheck?.(); return { data: { session: { user: { id: sessionOwner } } } };
    } } } }, '../../../modules/classfy-studio-media': native, './model': model, './store': store,
  });
  return { media, store, model, nativeCalls, imageCalls, copies, disk, data, repair: () => { repair = true; }, nativeExports: () => nativeExports,
    sessionCheck: fn => { sessionCheck = fn; }, copyCheck: fn => { copyCheck = fn; }, owner: id => { sessionOwner = id; }, cancelPicker: () => { pickerCanceled = true; } };
}
test('lote parcialmente ilegível preserva take pronto e journal do arquivo pendente', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  const imported = await h.media.importStudioMedia(p);
  assert.equal(imported.length, 1);
  const saved = h.store.getStudioProject('owner', p.id);
  assert.equal(saved.takes.length, 1);
  assert.equal(saved.pendingTakes.length, 1);
  assert.ok(h.disk.has(saved.takes[0].uri));
  assert.ok(h.disk.has(saved.pendingTakes[0].uri));
  h.repair();
  const recovery = await h.media.recoverPendingStudioTakes(saved);
  assert.equal(recovery.recovered, 1);
  assert.equal(h.store.getStudioProject('owner', p.id).takes.length, 2);
  assert.equal(h.store.getStudioProject('owner', p.id).pendingTakes.length, 0);
});
test('retry da captura reaproveita o mesmo arquivo journalizado antes de anexar', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  await assert.rejects(h.media.persistStudioTake(p, { uri: 'file:///broken.mp4' }), /ilegível/);
  const pending = h.store.getStudioProject('owner', p.id).pendingTakes[0];
  h.repair();
  const recovered = await h.media.persistStudioTake(p, { uri: 'file:///broken.mp4' });
  assert.equal(recovered.id, pending.id);
  assert.equal(recovered.uri, pending.uri);
  assert.equal(h.store.getStudioProject('owner', p.id).pendingTakes.length, 1);
});
test('cancelamento durante verificação de sessão impede iniciar export nativo', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  await h.store.updateStudioProject('owner', p.id, { takes: [{ id: 'take', uri: 'file:///take.mp4', name: 'take', duration: 2, start: 0, end: 2 }] });
  let release; const gate = new Promise(resolve => { release = resolve; });
  h.sessionCheck(() => gate);
  let active = true;
  const exporting = h.media.exportStudioProject(h.store.getStudioProject('owner', p.id), undefined, () => active);
  active = false; release();
  await assert.rejects(exporting, /interrompida/);
  assert.equal(h.nativeExports(), 0);
});
test('export antigo não é reutilizado pelo novo contrato de composição', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  const takes = [{ id: 'take', uri: 'file:///4k24.mp4', name: '4K 24', width: 3840, height: 2160, duration: 2, start: 0, end: 2 }];
  const oldUri = 'file:///old1080p30.mp4'; h.disk.set(oldUri, {});
  const oldSignature = JSON.stringify(['aula', takes.map(t => [t.id, t.uri, t.start, t.end])]);
  const saved = await h.store.updateStudioProject('owner', p.id, { takes });
  await h.store.updateStudioProject('owner', p.id, { exportedUri: oldUri, exportedSignature: oldSignature });
  const result = await h.media.exportStudioProject(h.store.getStudioProject('owner', p.id));
  assert.equal(h.nativeExports(), 1);
  assert.notEqual(result.uri, oldUri);
  assert.notEqual(h.store.getStudioProject('owner', saved.id).exportedSignature, oldSignature);
});
test('cancelar picker em sessão nova deixa lista e disco sem rascunho', async () => {
  const h = harness();
  const p = await h.store.createStudioProject('owner', 'short', { transient: true });
  h.cancelPicker();
  assert.equal((await h.media.importStudioMedia(p)).length, 0);
  assert.equal(h.store.studioSnapshot('owner').projects.length, 0);
  assert.equal(h.data.size, 0);
  assert.equal(await h.store.discardTransient('owner', p.id), true);
});
test('primeiro original ilegível ainda promove journal recuperável em vez de perder gravação', async () => {
  const h = harness();
  const p = await h.store.createStudioProject('owner', 'aula', { transient: true });
  await assert.rejects(h.media.persistStudioTake(p, { uri: 'file:///broken.mp4' }), /ilegível/);
  const saved = h.store.getStudioProject('owner', p.id);
  assert.equal(h.store.studioSnapshot('owner').projects.length, 1);
  assert.equal(saved.pendingTakes.length, 1);
  assert.ok(h.disk.has(saved.pendingTakes[0].uri));
  assert.equal(await h.store.discardTransient('owner', p.id), false);
  h.repair();
  assert.equal((await h.media.recoverPendingStudioTakes(saved)).recovered, 1);
  assert.equal(h.store.getStudioProject('owner', p.id).takes.length, 1);
});
test('troca de conta durante cópia não promove gravação na conta anterior ou na nova', async () => {
  const h = harness();
  const p = await h.store.createStudioProject('owner', 'aula', { transient: true });
  h.copyCheck(() => { h.owner('other'); });
  await assert.rejects(h.media.persistStudioTake(p, { uri: 'file:///good.mp4' }), /sessão mudou/);
  assert.equal(h.store.studioSnapshot('owner').projects.length, 0);
  assert.equal(h.store.studioSnapshot('other').projects.length, 0);
  assert.equal(h.data.size, 0);
  assert.ok(h.disk.size > 0); // Preserve copied originals even when owner changes.
  assert.equal(await h.store.discardTransient('owner', p.id), true);
});
test('descarte da sessão durante cópia não remove o projeto que precisa promover journal', async () => {
  const h = harness();
  const p = await h.store.createStudioProject('owner', 'aula', { transient: true });
  h.copyCheck(async () => { assert.equal(await h.store.discardTransient('owner', p.id), false); });
  const saved = await h.media.persistStudioTake(p, { uri: 'file:///good.mp4' });
  assert.equal(h.store.studioSnapshot('owner').projects.length, 1);
  assert.equal(h.store.getStudioProject('owner', p.id).pendingTakes[0].id, saved.id);
});
const baseTake = { id: 'base', uri: 'file:///base.mp4', name: 'Base', duration: 2, start: 0, end: 2, width: 320, height: 180 };
test('podcast aceita metadados audio-only nativos com dimensões e cadência zero', async () => {
  const h = harness({ mediaInfo: () => ({ duration: 2, width: 0, height: 0, frameRate: 0, hasVideo: false, hasAudio: true, fileSize: 100 }) });
  const p = await h.store.createStudioProject('owner', 'podcast');
  const takes = await h.media.importStudioMedia(p);
  assert.equal(takes.length, 1);
  const saved = h.store.getStudioProject('owner', p.id);
  assert.equal(saved.editing.assets[0].kind, 'audio');
  assert.equal(saved.editing.assets[0].width, 0);
  assert.equal(h.model.validateStudioEditing(saved.editing, 'podcast').length, 0);
  await h.media.exportStudioProject(saved);
  assert.equal(JSON.parse(h.nativeCalls.at(-1).recipeJSON).mediaType, 'audio');
});
test('journal de overlay sobrevive restart e recupera camada, não take principal ou cópia nova', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///broken-overlay.mp4', fileName: 'Overlay.mp4' }] });
  const p = await h.store.createStudioProject('owner', 'aula');
  const base = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
  const item = { id: 'pip', kind: 'video', atTicks: 0, durationTicks: h.model.studioTicks(2), anchor: { clipId: 'base', offsetTicks: 0 }, rect: { x: 0.6, y: 0.05, width: 0.35, height: 0.35 } };
  await assert.rejects(h.media.importStudioLayer(base, 'video', item), /ilegível/);
  const pending = h.store.getStudioProject('owner', p.id).pendingTakes[0];
  assert.equal(pending.layerItem.id, 'pip'); assert.equal(pending.layerId, 'layer:item:pip');
  const restarted = harness({ data: h.data, disk: h.disk }); restarted.repair(); await restarted.store.loadStudioProjects('owner');
  const result = await restarted.media.recoverPendingStudioTakes(restarted.store.getStudioProject('owner', p.id));
  assert.equal(result.recovered, 1); assert.equal(result.errors.length, 0);
  const saved = restarted.store.getStudioProject('owner', p.id);
  assert.equal(saved.takes.length, 1); assert.equal(saved.takes[0].id, 'base'); assert.equal(saved.pendingTakes.length, 0);
  const layer = saved.editing.layers[0].items[0]; assert.equal(layer.id, 'pip'); assert.equal(layer.assetId, pending.id);
  assert.equal(saved.editing.assets.find(asset => asset.id === pending.id).uri, pending.uri);
  assert.equal(restarted.disk.size, h.disk.size, 'recovery never recopies the original');
  await restarted.media.exportStudioProject(saved);
  const recipe = JSON.parse(restarted.nativeCalls.at(-1).recipeJSON);
  assert.equal(recipe.clips.filter(clip => clip.kind === 'video').length, 2);
  assert.equal(recipe.assets.find(asset => asset.id === pending.id).uri, pending.uri);
});
test('imagem importada preserva original e export envia mesma receita com texto, grade e música', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///slide.png', fileName: 'Slide.png' }] });
  const p = await h.store.createStudioProject('owner', 'short');
  const base = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
  const imported = await h.media.importStudioLayer(base, 'image', { id: 'slide', kind: 'image', atTicks: 0, durationTicks: h.model.studioTicks(1.5), anchor: { clipId: 'base', offsetTicks: 0 } });
  assert.deepEqual(h.imageCalls.map(call => call.operation), ['render', 'release-image', 'release-context']);
  let editing = h.model.patchStudioClipGrade(imported.editing, 'base', { preset: 'studio', exposure: 0.25 });
  editing = h.model.addStudioLayerItem(editing, h.model.createStudioTextItem({ id: 'title', content: 'Aprender', durationTicks: h.model.studioTicks(1), clipId: 'base' }));
  editing = { ...editing, assets: [...editing.assets, { id: 'music', kind: 'audio', uri: 'file:///music.m4a', name: 'Música', durationTicks: h.model.studioTicks(4), width: 0, height: 0, frameRate: 0 }] };
  editing = h.model.addStudioLayerItem(editing, { id: 'music-bed', kind: 'audio', assetId: 'music', atTicks: 0, durationTicks: h.model.studioTicks(4), gain: 0.25, fadeInTicks: h.model.studioTicks(0.5), fadeOutTicks: h.model.studioTicks(0.5) });
  const saved = await h.store.updateStudioProject('owner', p.id, { editing });
  const expected = h.model.compileStudioRecipe(saved);
  const result = await h.media.exportStudioProject(saved);
  const call = h.nativeCalls.at(-1);
  assert.equal(call.kind, 'recipe'); assert.deepEqual(JSON.parse(call.recipeJSON), JSON.parse(JSON.stringify(expected)));
  assert.equal(h.store.getStudioProject('owner', p.id).exportedUri, result.uri);
  const asset = expected.assets.find(asset => asset.kind === 'image'); assert.ok(h.disk.has(asset.uri)); assert.ok(asset.uri.endsWith('.png'));
  assert.equal(expected.durationTicks, h.model.studioTicks(4)); assert.equal(expected.output.width, 1080); assert.equal(expected.output.height, 1920);
});
test('imagem usa dimensões visuais do picker sem criar outra rasterização nem alterar o original', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///photo.heic', fileName: 'Foto.heic', width: 8064, height: 6048 }] });
  const p = await h.store.createStudioProject('owner', 'aula');
  const base = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
  const saved = await h.media.importStudioLayer(base, 'image', { id: 'photo', kind: 'image', atTicks: 0,
    durationTicks: h.model.studioTicks(1), anchor: { clipId: 'base', offsetTicks: 0 } });
  assert.equal(h.imageCalls.length, 0, 'dimension metadata must not decode another full-resolution image');
  assert.equal(h.copies.length, 1);
  const asset = saved.editing.assets.find(asset => asset.kind === 'image');
  assert.equal(asset.width, 8064); assert.equal(asset.height, 6048); assert.ok(asset.uri.endsWith('.heic'));
  assert.equal(h.model.validateStudioEditing(saved.editing, 'aula').length, 0);
  assert.equal(saved.pendingTakes.length, 0);
});
test('duas imagens no mesmo intervalo entram em faixas próprias sem migrar grupos existentes', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///slide.png', fileName: 'Slide.png', width: 1200, height: 800 }] });
  const p = await h.store.createStudioProject('owner', 'aula');
  let saved = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
  const item = id => ({ id, kind: 'image', atTicks: 0, durationTicks: h.model.studioTicks(1),
    anchor: { clipId: 'base', offsetTicks: 0 }, rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 } });
  saved = await h.media.importStudioLayer(saved, 'image', item('first'));
  // Simulate an existing grouped track. New imports must neither rewrite it
  // nor append a new manual element to this legacy group.
  const firstAsset = saved.editing.layers[0].items[0].assetId;
  const legacy = h.model.addStudioLayerItem({ ...saved.editing, layers: [] }, { ...item('legacy'), assetId: firstAsset }, 'layer:image');
  saved = await h.store.updateStudioProject('owner', p.id, { editing: legacy });
  saved = await h.media.importStudioLayer(saved, 'image', item('second'));
  saved = await h.media.importStudioLayer(saved, 'image', item('third'));
  assert.deepEqual(plain(saved.editing.layers.map(layer => [layer.id, layer.kind, layer.items.map(value => value.id)])), [
    ['layer:image', 'image', ['legacy']], ['layer:item:second', 'image', ['second']], ['layer:item:third', 'image', ['third']],
  ]);
  const clips = h.model.compileStudioRecipe(saved).clips.filter(clip => clip.kind === 'image');
  assert.equal(clips.length, 3);
  assert.deepEqual(plain(clips.map(clip => [clip.startTicks, clip.durationTicks, clip.zIndex])), [
    [0, h.model.studioTicks(1), 1], [0, h.model.studioTicks(1), 2], [0, h.model.studioTicks(1), 3],
  ]);
  assert.equal(h.model.validateStudioEditing(saved.editing, 'aula').length, 0);
  assert.equal(saved.pendingTakes.length, 0);
  const restarted = harness({ data: h.data, disk: h.disk }); await restarted.store.loadStudioProjects('owner');
  assert.deepEqual(plain(restarted.store.getStudioProject('owner', p.id).editing.layers), plain(saved.editing.layers));
});
test('recovery conserva dimensões do picker após interrupção e não rasteriza nem copia novamente', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///photo.heic', fileName: 'Foto.heic', width: 3024, height: 4032 }] });
  const p = await h.store.createStudioProject('owner', 'aula');
  const base = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
  h.sessionCheck(() => {
    if (h.store.getStudioProject('owner', p.id).pendingTakes?.length) throw new Error('Interrompido após o journal');
  });
  await assert.rejects(h.media.importStudioLayer(base, 'image', { id: 'photo', kind: 'image', atTicks: 0,
    durationTicks: h.model.studioTicks(1), anchor: { clipId: 'base', offsetTicks: 0 } }), /Interrompido/);
  const pending = h.store.getStudioProject('owner', p.id).pendingTakes[0];
  assert.deepEqual(plain(pending.imageSize), { width: 3024, height: 4032 });
  const restarted = harness({ data: h.data, disk: h.disk }); await restarted.store.loadStudioProjects('owner');
  const result = await restarted.media.recoverPendingStudioTakes(restarted.store.getStudioProject('owner', p.id));
  assert.deepEqual(plain(result), { recovered: 1, errors: [] });
  assert.equal(restarted.imageCalls.length, 0); assert.equal(restarted.copies.length, 0);
  const saved = restarted.store.getStudioProject('owner', p.id);
  const asset = saved.editing.assets.find(asset => asset.kind === 'image');
  assert.equal(asset.width, 3024); assert.equal(asset.height, 4032); assert.equal(asset.uri, pending.uri);
});
test('dimensões ausentes ou inválidas do picker usam fallback e liberam ambas as referências', async () => {
  for (const dimensions of [{}, { width: 0, height: 4032 }, { width: NaN, height: 4032 }, { width: 3024, height: Infinity }]) {
    const h = harness({ pickerAssets: [{ uri: 'file:///slide.png', fileName: 'Slide.png', ...dimensions }] });
    const p = await h.store.createStudioProject('owner', 'aula');
    const base = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
    const saved = await h.media.importStudioLayer(base, 'image', { id: 'slide', kind: 'image', atTicks: 0, durationTicks: h.model.studioTicks(1) });
    assert.deepEqual(h.imageCalls.map(call => call.operation), ['render', 'release-image', 'release-context']);
    const asset = saved.editing.assets.find(asset => asset.kind === 'image');
    assert.equal(asset.width, 1200); assert.equal(asset.height, 800);
  }
});
test('falha ao ler imagem libera o contexto; recovery reutiliza o original e libera as duas referências', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///broken-slide.png', fileName: 'Slide.png' }] });
  const p = await h.store.createStudioProject('owner', 'aula');
  const base = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
  await assert.rejects(h.media.importStudioLayer(base, 'image', { id: 'slide', kind: 'image', atTicks: 0,
    durationTicks: h.model.studioTicks(1), anchor: { clipId: 'base', offsetTicks: 0 } }), /Imagem ilegível/);
  assert.deepEqual(h.imageCalls.map(call => call.operation), ['render', 'release-context']);
  const pending = h.store.getStudioProject('owner', p.id).pendingTakes[0];
  assert.equal(h.copies.length, 1); assert.ok(h.disk.has(pending.uri));
  h.repair();
  const result = await h.media.recoverPendingStudioTakes(h.store.getStudioProject('owner', p.id));
  assert.deepEqual(plain(result), { recovered: 1, errors: [] });
  assert.equal(h.copies.length, 1, 'recovery must not copy or replace the original again');
  assert.deepEqual(h.imageCalls.slice(2).map(call => call.operation), ['render', 'release-image', 'release-context']);
  const saved = h.store.getStudioProject('owner', p.id);
  assert.equal(saved.editing.assets.find(asset => asset.kind === 'image').uri, pending.uri);
  assert.equal(saved.pendingTakes.length, 0);
});
test('dimensões inválidas do fallback não deixam referências retidas nem salvam overlay inválido', async () => {
  const h = harness({ imageWidth: 0, pickerAssets: [{ uri: 'file:///slide.png', fileName: 'Slide.png' }] });
  const p = await h.store.createStudioProject('owner', 'aula');
  const base = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
  await assert.rejects(h.media.importStudioLayer(base, 'image', { id: 'slide', kind: 'image', atTicks: 0,
    durationTicks: h.model.studioTicks(1) }), /dimensões/);
  assert.deepEqual(h.imageCalls.map(call => call.operation), ['render', 'release-image', 'release-context']);
  assert.equal(h.store.getStudioProject('owner', p.id).editing.layers.length, 0);
  assert.equal(h.store.getStudioProject('owner', p.id).pendingTakes.length, 1);
});
test('legado simples usa export original; efeito ou camada não podem cair no export que os perde', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  const created = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
  const legacy = await h.store.updateStudioProject('owner', p.id, { editing: { ...created.editing, output: { ...created.editing.output, profile: 'legacy-source', colorSpace: 'source' } } });
  await h.media.exportStudioProject(legacy); assert.equal(h.nativeCalls.at(-1).kind, 'legacy');
  const graded = await h.store.updateStudioProject('owner', p.id, { editing: h.model.patchStudioClipGrade(legacy.editing, 'base', { preset: 'cinematic' }) });
  const before = h.nativeExports(); await assert.rejects(h.media.exportStudioProject(graded), /perfil 1080p/);
  assert.equal(h.nativeExports(), before);
});
test('mute principal exporta receita silenciosa sem perder o ganho original e nunca cai no export legado', async () => {
  const h = harness(), p = await h.store.createStudioProject('owner', 'aula');
  const created = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
  const output = h.model.withStudioStandardOutput(created.editing);
  const standard = { ...output, main: output.main.map(clip => ({ ...clip, gain: 0.4 })) };
  const muted = await h.store.updateStudioProject('owner', p.id, { editing: h.model.setStudioMainMuted(standard, true) });
  await h.media.exportStudioProject(muted);
  const call = h.nativeCalls.at(-1); assert.equal(call.kind, 'recipe');
  assert.equal(JSON.parse(call.recipeJSON).clips[0].gain, 0);
  assert.equal(h.store.getStudioProject('owner', p.id).editing.main[0].gain, 0.4);
  const legacy = await h.store.updateStudioProject('owner', p.id, { editing: { ...muted.editing, output: { ...muted.editing.output, profile: 'legacy-source', colorSpace: 'source' } } });
  const before = h.nativeExports(); await assert.rejects(h.media.exportStudioProject(legacy), /perfil 1080p/);
  assert.equal(h.nativeExports(), before);
});
test('áudio curto ajusta fades à duração conhecida depois do picker sem perder journal', async () => {
  const h = harness({ mediaInfo: uri => uri.endsWith('.m4a') ? { duration: 0.2, width: 0, height: 0, frameRate: 0, hasVideo: false, hasAudio: true, fileSize: 100 } : undefined });
  const p = await h.store.createStudioProject('owner', 'aula');
  const base = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
  const saved = await h.media.importStudioLayer(base, 'audio', { id: 'music', kind: 'audio', atTicks: 0,
    durationTicks: h.model.studioTicks(2), gain: 0.25, fadeInTicks: h.model.studioTicks(0.5), fadeOutTicks: h.model.studioTicks(0.5) });
  const music = saved.editing.layers[0].items[0];
  assert.equal(music.durationTicks, h.model.studioTicks(0.2));
  assert.ok(music.fadeInTicks + music.fadeOutTicks <= music.durationTicks);
  assert.equal(saved.pendingTakes.length, 0);
  assert.equal(h.model.validateStudioEditing(saved.editing, 'aula').length, 0);
});

test('captura interrompida recupera preset e intensidade no clip após restart sem processar ou copiar o original novamente', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula', { transient: true });
  const grade = { ...h.model.studioGrade('cinematic'), intensity: 0.65, exposure: 0.15, contrast: -0.1, saturation: 0.05, temperature: 0.2 };
  const expected = { ...grade };
  await assert.rejects(h.media.persistStudioTake(p, { uri: 'file:///broken-recording.mp4', grade }), /ilegível/);
  grade.intensity = 0.1;
  const pending = h.store.getStudioProject('owner', p.id).pendingTakes[0];
  assert.deepEqual(plain(pending.grade), expected); assert.equal(h.copies.length, 1); assert.equal(h.nativeExports(), 0);
  const restarted = harness({ data: h.data, disk: h.disk }); restarted.repair(); await restarted.store.loadStudioProjects('owner');
  const recovery = await restarted.media.recoverPendingStudioTakes(restarted.store.getStudioProject('owner', p.id));
  assert.equal(recovery.recovered, 1); assert.equal(recovery.errors.length, 0); assert.equal(restarted.copies.length, 0);
  const saved = restarted.store.getStudioProject('owner', p.id);
  assert.equal(saved.pendingTakes.length, 0); assert.equal(saved.takes.length, 1);
  assert.deepEqual(plain(saved.takes[0].grade), expected); assert.equal(saved.takes[0].uri, pending.uri);
  assert.equal(Object.hasOwn(saved.editing.assets[0], 'grade'), false, 'color treatment must not become metadata of an immutable original');
  assert.equal(restarted.nativeExports(), 0, 'persist/recover never bakes a second video');
  await restarted.media.exportStudioProject(saved);
  assert.equal(restarted.nativeExports(), 1);
  const recipe = JSON.parse(restarted.nativeCalls[0].recipeJSON);
  assert.equal(recipe.clips.length, 1); assert.deepEqual(recipe.clips[0].grade, expected);
  assert.equal(Object.hasOwn(recipe.assets[0], 'grade'), false); assert.equal(recipe.assets[0].uri, pending.uri);
});

test('retry usa o tratamento original do journal e não o preset atual da interface', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'short');
  const initial = { ...h.model.studioGrade('studio'), intensity: 0.4 };
  await assert.rejects(h.media.persistStudioTake(p, { uri: 'file:///broken.mp4', grade: initial }), /ilegível/);
  h.repair();
  const take = await h.media.persistStudioTake(p, { uri: 'file:///broken.mp4', grade: { ...h.model.studioGrade('cinematic'), intensity: 0.9 } });
  assert.deepEqual(plain(take.grade), initial); assert.equal(h.copies.length, 1);
  const saved = await h.store.mutateStudioProject('owner', p.id, latest => ({ takes: [...latest.takes, take] }));
  assert.deepEqual(plain(saved.editing.main[0].grade), initial); assert.equal(saved.pendingTakes.length, 0);
});

test('snapshot de tratamento é copiado antes de await e captura Natural não cria edição artificial', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  const grade = { ...h.model.studioGrade('studio'), intensity: 0.6 };
  h.sessionCheck(async () => { grade.intensity = 0.1; });
  const take = await h.media.persistStudioTake(p, { uri: 'file:///recording.mp4', grade });
  assert.equal(take.grade.intensity, 0.6); assert.equal(h.store.getStudioProject('owner', p.id).pendingTakes[0].grade.intensity, 0.6);
  h.sessionCheck(undefined);
  const natural = await h.media.persistStudioTake(p, { uri: 'file:///natural.mp4', grade: { ...h.model.studioGrade(), intensity: 0.35 } });
  assert.equal(natural.grade, undefined);
  assert.equal(h.store.getStudioProject('owner', p.id).pendingTakes.find(pending => pending.id === natural.id).grade, undefined);
});

test('preset ou valor inválido rejeita a gravação antes de copiar ou gravar journal', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  for (const patch of [{ preset: 'inventado' }, { intensity: 1.01 }, { exposure: NaN }, { temperature: -1.01 }]) {
    await assert.rejects(h.media.persistStudioTake(p, { uri: 'file:///recording.mp4', grade: { ...h.model.studioGrade(), ...patch } }), /ajustes de cor/);
  }
  assert.equal(h.copies.length, 0); assert.equal(h.store.getStudioProject('owner', p.id).pendingTakes, undefined);
});

test('binário sem composição preserva a receita capturada e falha sem exportar versão sem tratamento', async () => {
  const h = harness({ compositionAvailable: false }); const p = await h.store.createStudioProject('owner', 'aula');
  const grade = { ...h.model.studioGrade('studio'), intensity: 0.55 };
  const take = await h.media.persistStudioTake(p, { uri: 'file:///recording.mp4', grade });
  const saved = await h.store.updateStudioProject('owner', p.id, { takes: [take] });
  await assert.rejects(h.media.exportStudioProject(saved), /Atualize o Classfy Dev/);
  assert.equal(h.nativeExports(), 0); assert.deepEqual(plain(h.store.getStudioProject('owner', p.id).editing.main[0].grade), grade);
  assert.ok(h.disk.has(take.uri));
});

test('captura Natural identidade mantém export original de projeto legado em binário antigo', async () => {
  const h = harness({ compositionAvailable: false }); const p = await h.store.createStudioProject('owner', 'aula');
  const legacy = await h.store.updateStudioProject('owner', p.id, { editing: { ...p.editing, output: { ...p.editing.output, profile: 'legacy-source', colorSpace: 'source' } } });
  const take = await h.media.persistStudioTake(legacy, { uri: 'file:///natural.mp4', grade: { ...h.model.studioGrade(), intensity: 0.5 } });
  const saved = await h.store.updateStudioProject('owner', p.id, { takes: [take] });
  assert.equal(saved.editing.main[0].grade, undefined);
  await h.media.exportStudioProject(saved); assert.equal(h.nativeCalls[0].kind, 'legacy');
});

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
  let sessionOwner = 'owner', pickerCanceled = false, writeCheck;
  const crypto = { randomUUID: () => `id-${++sequence}` };
  const fileSystem = { documentDirectory: 'file:///current/Documents/',
    makeDirectoryAsync: async () => {}, copyAsync: async ({from, to}) => { disk.set(to, { bad: from.includes('broken') }); await copyCheck?.(); },
    getInfoAsync: async uri => ({ exists: disk.has(uri), isDirectory: false, size: 100 }),
  };
  const data = new Map(options.data);
  const model = compile('./model.ts', {});
  const store = compile('./store.ts', { '@react-native-async-storage/async-storage': {
    getItem: async key => data.get(key) || null, setItem: async (key, value) => { await writeCheck?.(key, value); data.set(key, value); },
  }, 'expo-file-system/legacy': fileSystem, 'expo-crypto': crypto, './model': model });
  const nativeCalls = [];
  const imageCalls = [];
  const copies = [];
  const copy = fileSystem.copyAsync;
  fileSystem.copyAsync = async options => { copies.push(options); await copy(options); };
  const native = {
    isStudioMediaAvailable: () => options.mediaAvailable !== false, isStudioCompositionAvailable: () => options.compositionAvailable !== false,
    getStudioExportCapabilitiesAsync: async () => typeof options.capabilities === 'function' ? options.capabilities() : options.capabilities || { version: 2, available: true, colorSpace: 'rec709', minimumDimension: 64, maximumDimension: 3840, maximumShortDimension: 2160, maximumPixels: 8294400, arbitraryEvenDimensions: true, resolutions: [{ id: 'hd', width: 1920, height: 1080, codec: 'h264' }, { id: '2k', width: 2560, height: 1440, codec: 'hevc' }, { id: '4k', width: 3840, height: 2160, codec: 'hevc' }], frameRates: [24,25,30,50,60].map(numerator => ({ numerator, denominator: 1 })).concat([24000,30000,60000].map(numerator => ({ numerator, denominator: 1001 }))), supportsHEVC: true },
    exportRecipeAsync: async config => { nativeExports++; nativeCalls.push({ kind: 'recipe', ...config }); const recipe = JSON.parse(config.recipeJSON);
      disk.set(config.outputUri, { info: { duration: recipe.durationTicks / recipe.timebase, width: recipe.output.width, height: recipe.output.height, frameRate: recipe.output.frameRateNumerator / recipe.output.frameRateDenominator, hasVideo: recipe.mediaType === 'video', hasAudio: true, fileSize: 100, ...options.exportedInfo } });
      return { uri: config.outputUri, duration: recipe.durationTicks / recipe.timebase, mimeType: 'video/mp4', fileSize: 100 }; },
    getMediaInfoAsync: async uri => {
      if (!repair && disk.get(uri)?.bad) throw new Error('Arquivo temporariamente ilegível');
      return disk.get(uri)?.info || options.mediaInfo?.(uri) || { duration: 2, width: 320, height: 180, hasVideo: true, hasAudio: true, fileSize: 100 };
    },
    generateThumbnailAsync: async (_uri, output) => { disk.set(output, {}); return { uri: output }; },
    cancelExportAsync: async () => {}, exportTimelineAsync: async config => {
      nativeExports++; nativeCalls.push({ kind: 'legacy', ...config }); disk.set(config.outputUri, { info: { duration: config.clips.reduce((sum,clip)=>sum+clip.endSeconds-clip.startSeconds,0), width: 320, height: 180, frameRate: 30, hasVideo: config.mediaType === 'video', hasAudio: true, fileSize: 100 } }); return { uri: config.outputUri, duration: 2, mimeType: 'video/mp4', fileSize: 100 };
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
    sessionCheck: fn => { sessionCheck = fn; }, copyCheck: fn => { copyCheck = fn; }, writeCheck: fn => { writeCheck = fn; }, owner: id => { sessionOwner = id; }, cancelPicker: () => { pickerCanceled = true; } };
}
test('ID de original remoto durável impede duplicação depois append confirmado e receipt externo perdido', async () => {
  const h=harness(),project=await h.store.createStudioProject('owner','aula');
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',source={id,uri:'file:///phone-original.mov',name:'Master.mov'};
  const take=await h.media.persistStudioTake(project,source);
  await h.store.mutateStudioProject('owner',project.id,latest=>({takes:[...latest.takes,take]}));
  const retried=await h.media.persistStudioTake(h.store.getStudioProject('owner',project.id),source);
  assert.equal(retried.id,id);assert.equal(h.copies.length,1);assert.equal(h.store.getStudioProject('owner',project.id).takes.length,1);
});
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
  assert.equal(expected.durationTicks, h.model.studioTicks(4)); assert.equal(expected.output.width, 1200); assert.equal(expected.output.height, 2134);
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
  const before = h.nativeExports(); await assert.rejects(h.media.exportStudioProject(graded), /perfil de composição/);
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
  const before = h.nativeExports(); await assert.rejects(h.media.exportStudioProject(legacy), /perfil de composição/);
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

test('qualidade escolhida chega à receita nativa e metadados efetivos são certificados antes do cache', async () => {
  const h = harness(); let p = await h.store.createStudioProject('owner','aula');
  p = await h.store.updateStudioProject('owner',p.id,{ takes:[{ id:'4k',uri:'file:///4k.mp4',name:'4K 60',duration:4,start:0,end:4,width:3840,height:2160,frameRate:60 }] });
  p = await h.store.updateStudioProject('owner',p.id,{ editing:h.model.withStudioOutputSelection(p.editing,{ resolution:'2k',frameRate:24 }) });
  const result = await h.media.exportStudioProject(p);
  const recipe = JSON.parse(h.nativeCalls.at(-1).recipeJSON);
  assert.deepEqual([recipe.output.width,recipe.output.height,recipe.output.frameRateNumerator],[2560,1440,24]);
  assert.equal(result.duration,4);
  const saved = h.store.getStudioProject('owner',p.id);
  assert.equal(saved.exportedSignature,h.model.timelineSignature(saved));
  await h.media.exportStudioProject(saved);
  assert.equal(h.nativeExports(),1,'arquivo confirmado reutiliza cache sem novo encode');
});
test('cache truncado ou de outra resolução/FPS é regenerado apesar da assinatura idêntica', async () => {
  for (const patch of [{ width:1920,height:1080 },{ frameRate:30 },{ duration:1 },{ fileSize:0 }]) {
    const h = harness(); let p = await h.store.createStudioProject('owner','aula');
    p = await h.store.updateStudioProject('owner',p.id,{ takes:[{ id:'4k',uri:'file:///4k.mp4',name:'4K',duration:4,start:0,end:4,width:3840,height:2160,frameRate:60 }] });
    const stale = 'file:///stale.mp4';
    h.disk.set(stale,{ info:{ duration:4,width:3840,height:2160,frameRate:60,hasVideo:true,hasAudio:true,fileSize:100,...patch } });
    p = await h.store.updateStudioProject('owner',p.id,{ exportedUri:stale,exportedSignature:h.model.timelineSignature(p) });
    const result = await h.media.exportStudioProject(p);
    assert.notEqual(result.uri,stale); assert.equal(h.nativeExports(),1);
  }
});
test('arquivo novo degradado ou truncado não anuncia exportação nem recebe assinatura', async () => {
  for (const exportedInfo of [{ width:1920,height:1080 },{ frameRate:30 },{ duration:1 },{ fileSize:0 }]) {
    const h = harness({ exportedInfo }); let p = await h.store.createStudioProject('owner','aula');
    p = await h.store.updateStudioProject('owner',p.id,{ takes:[{ id:'4k',uri:'file:///4k.mp4',name:'4K',duration:4,start:0,end:4,width:3840,height:2160,frameRate:60 }] });
    await assert.rejects(h.media.exportStudioProject(p),/arquivo gerado não corresponde/);
    const saved = h.store.getStudioProject('owner',p.id);
    assert.equal(saved.exportedSignature,undefined); assert.equal(saved.exportedUri,undefined);
    assert.equal(saved.takes[0].uri,'file:///4k.mp4');
  }
});
test('binário antigo recusa saída4K60 antes do encode e não converte silenciosamente paraHD30', async () => {
  const old = { version:1,available:true,colorSpace:'rec709',minimumDimension:64,maximumDimension:1920,maximumShortDimension:1080,maximumPixels:2073600,arbitraryEvenDimensions:false,resolutions:[{ id:'hd',width:1920,height:1080,codec:'h264' }],frameRates:[{ numerator:30,denominator:1 }],supportsHEVC:false };
  const h = harness({ capabilities:old }); let p = await h.store.createStudioProject('owner','aula');
  p = await h.store.updateStudioProject('owner',p.id,{ takes:[{ id:'4k',uri:'file:///4k.mp4',name:'4K',duration:4,start:0,end:4,width:3840,height:2160,frameRate:60 }] });
  await assert.rejects(h.media.exportStudioProject(p),/não suporta a saída escolhida/);
  assert.equal(h.nativeExports(),0);
  assert.deepEqual(plain(h.store.getStudioProject('owner',p.id).editing.output.selection),{ resolution:'original',frameRate:'original' });
  p = await h.store.updateStudioProject('owner',p.id,{ editing:h.model.withStudioOutputSelection(p.editing,{ resolution:'hd',frameRate:30 }) });
  await h.media.exportStudioProject(p); assert.equal(h.nativeExports(),1,'conversão explícita compatível continua possível');
});
test('cancelamento na consulta de capacidades impede encode e publicação de artefato', async () => {
  let release; const gate = new Promise(resolve=>{release=resolve;});
  const h = harness({ capabilities:()=>gate }); let p = await h.store.createStudioProject('owner','aula');
  p = await h.store.updateStudioProject('owner',p.id,{ takes:[{ id:'a',uri:'file:///a.mp4',name:'A',duration:2,start:0,end:2,width:1280,height:720,frameRate:24 }] });
  let active = true;
  const run = h.media.exportStudioProject(p,undefined,()=>active);
  await new Promise(resolve=>setImmediate(resolve)); active=false; release({ available:false });
  await assert.rejects(run,/interrompida/); assert.equal(h.nativeExports(),0);
  assert.equal(h.store.getStudioProject('owner',p.id).exportedSignature,undefined);
});
test('journal recuperado prefere FPS medido no arquivo à configuração solicitada da câmera', async () => {
  const h = harness({ mediaInfo:()=>({ duration:2,width:3840,height:2160,frameRate:60000/1001,hasVideo:true,hasAudio:true,fileSize:100 }) });
  const p = await h.store.createStudioProject('owner','aula');
  const recorded = await h.media.persistStudioTake(p,{ uri:'file:///take.mp4',frameRate:60 });
  assert.equal(recorded.frameRate,60000/1001);
  const pending = h.store.getStudioProject('owner',p.id).pendingTakes[0]; assert.equal(pending.frameRate,60,'journal conserva snapshot original da captura');
  const reopened = harness({ data:[...h.data],disk:[...h.disk],mediaInfo:()=>({duration:2,width:3840,height:2160,frameRate:60000/1001,hasVideo:true,hasAudio:true,fileSize:100}) });
  await reopened.store.loadStudioProjects('owner');
  await reopened.media.recoverPendingStudioTakes(reopened.store.getStudioProject('owner',p.id));
  const saved = reopened.store.getStudioProject('owner',p.id);
  assert.equal(saved.takes[0].frameRate,60000/1001);
  assert.equal(reopened.model.compileStudioRecipe(saved).output.frameRateNumerator,60000);
  assert.equal(reopened.model.compileStudioRecipe(saved).output.frameRateDenominator,1001);
});

test('HDR importado e recuperado usa metadados reais do arquivo, sem inferir pela resolução', async () => {
  const info = { duration:2,width:3840,height:2160,frameRate:30,hasVideo:true,hasAudio:true,fileSize:100,colorSpace:'BT.2020 HLG' };
  const h = harness({ mediaInfo:()=>info }); const p = await h.store.createStudioProject('owner','aula');
  const recorded = await h.media.persistStudioTake(p,{ uri:'file:///hdr.mp4',colorSpace:'rec709' });
  assert.equal(recorded.colorSpace,'BT.2020 HLG');
  await h.media.recoverPendingStudioTakes(h.store.getStudioProject('owner',p.id));
  const saved = h.store.getStudioProject('owner',p.id);
  assert.equal(saved.editing.assets[0].colorSpace,'BT.2020 HLG');
  assert.ok(h.model.studioOutputWarnings(saved.editing).some(warning=>warning.code==='sdr-conversion'));
});

async function projectWithIndependentAudio(h, muted = false) {
  let p = await h.store.createStudioProject('owner','aula');
  p = await h.store.updateStudioProject('owner',p.id,{ takes:[{ id:'video',uri:'file:///video.mp4',name:'Vídeo',duration:4,start:0,end:4,width:3840,height:2160,frameRate:60 }] });
  const audio = { id:'voice',kind:'audio',uri:'file:///voice.m4a',name:'Voz',durationTicks:h.model.studioTicks(4) };
  const editing = { ...p.editing, assets:[...p.editing.assets,audio],layers:[{ id:'audio-track',kind:'audio',muted,items:[{ id:'voice-clip',kind:'audio',assetId:audio.id,atTicks:0,durationTicks:h.model.studioTicks(4),sourceStartTicks:0,sourceEndTicks:h.model.studioTicks(4),gain:0.7 }] }] };
  return h.store.updateStudioProject('owner',p.id,{ editing });
}
test('cache sem faixa de áudio independente audível é regenerado mesmo com resolução, FPS e duração corretos', async () => {
  const h = harness(); let p = await projectWithIndependentAudio(h);
  const stale = 'file:///silent-cache.mp4';
  h.disk.set(stale,{ info:{ duration:4,width:3840,height:2160,frameRate:60,hasVideo:true,hasAudio:false,fileSize:100 } });
  p = await h.store.updateStudioProject('owner',p.id,{ exportedUri:stale,exportedSignature:h.model.timelineSignature(p) });
  const result = await h.media.exportStudioProject(p);
  assert.notEqual(result.uri,stale); assert.equal(h.nativeExports(),1);
  assert.equal(h.disk.get(result.uri).info.hasAudio,true);
});
test('arquivo novo sem áudio independente esperado não recebe assinatura de exportação', async () => {
  const h = harness({ exportedInfo:{hasAudio:false} }); const p = await projectWithIndependentAudio(h);
  await assert.rejects(h.media.exportStudioProject(p),/arquivo gerado não corresponde/);
  const saved = h.store.getStudioProject('owner',p.id);
  assert.equal(saved.exportedSignature,undefined); assert.equal(saved.exportedUri,undefined);
  assert.equal(saved.editing.layers[0].items[0].gain,0.7);
});
test('faixa independente silenciada intencionalmente aceita saída sem áudio e preserva ganho original', async () => {
  const h = harness({ exportedInfo:{hasAudio:false} }); const p = await projectWithIndependentAudio(h,true);
  const result = await h.media.exportStudioProject(p);
  assert.equal(h.nativeExports(),1);
  const saved = h.store.getStudioProject('owner',p.id);
  assert.equal(saved.exportedUri,result.uri); assert.equal(saved.exportedSignature,h.model.timelineSignature(saved));
  assert.equal(saved.editing.layers[0].items[0].gain,0.7);
  await h.media.exportStudioProject(saved); assert.equal(h.nativeExports(),1,'cache intencionalmente silencioso permanece válido');
});

test('narração é copiada para faixa própria no cursor, cortada no fim e não altera o vídeo original', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///video.mp4', fileName: 'Vídeo.mp4' }] });
  let p = await h.store.createStudioProject('owner', 'aula'); await h.media.importStudioMedia(p); p = h.store.getStudioProject('owner', p.id);
  const originalUri = p.takes[0].uri;
  const result = await h.media.persistStudioVoiceover(p, { uri: 'file:///cache/voice.m4a', duration: 1.7 }, .5, { isCurrent: () => true });
  const saved = result.project, item = saved.editing.layers[0].items[0], asset = saved.editing.assets.find(asset => asset.id === item.assetId);
  assert.equal(item.id, result.itemId); assert.equal(item.atTicks, h.model.studioTicks(.5)); assert.equal(item.durationTicks, h.model.studioTicks(1.5));
  assert.equal(asset.kind, 'audio'); assert.equal(asset.hasAudio, true); assert.ok(asset.uri.includes(`/owner/${p.id}/`));
  assert.notEqual(asset.uri, 'file:///cache/voice.m4a'); assert.equal(saved.takes[0].uri, originalUri); assert.equal(saved.pendingTakes.length, 0);
  assert.equal(h.nativeExports(), 0); assert.equal(h.model.validateStudioEditing(saved.editing, 'aula').length, 0);
});
test('blur após copiar narração mantém journal recuperável e não devolve uma faixa fictícia', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///video.mp4', fileName: 'Vídeo.mp4' }] });
  let p = await h.store.createStudioProject('owner', 'aula'); await h.media.importStudioMedia(p); p = h.store.getStudioProject('owner', p.id);
  let current = true; h.copyCheck(async () => { current = false; });
  await assert.rejects(h.media.persistStudioVoiceover(p, { uri: 'file:///cache/voice.m4a', duration: 1 }, .2, { isCurrent: () => current }), /cancelada/);
  const interrupted = h.store.getStudioProject('owner', p.id); assert.equal(interrupted.editing.layers.length, 0); assert.equal(interrupted.pendingTakes.length, 1);
  assert.equal(interrupted.pendingTakes[0].kind, 'audio'); assert.ok(h.disk.has(interrupted.pendingTakes[0].uri));
  h.copyCheck(undefined); const recovered = await h.media.recoverPendingStudioTakes(interrupted);
  assert.equal(recovered.recovered, 1); assert.equal(h.store.getStudioProject('owner', p.id).editing.layers.length, 1);
});
test('retry da narração reutiliza original e journal em vez de criar cópias e faixas duplicadas', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///video.mp4', fileName: 'Vídeo.mp4' }] });
  let p = await h.store.createStudioProject('owner', 'aula'); await h.media.importStudioMedia(p); p = h.store.getStudioProject('owner', p.id);
  const source = { uri: 'file:///broken-voice.m4a', duration: 1 };
  await assert.rejects(h.media.persistStudioVoiceover(p, source, .2, { isCurrent: () => true }), /ilegível/);
  const pendingId = h.store.getStudioProject('owner', p.id).pendingTakes[0].id, copies = h.copies.length;
  h.repair(); const result = await h.media.persistStudioVoiceover(p, source, .2, { isCurrent: () => true });
  assert.equal(h.copies.length, copies); assert.equal(result.project.editing.layers.length, 1); assert.equal(result.project.editing.layers[0].items[0].assetId, pendingId);
});
test('narração fora da montagem ou callback cancelado não copia arquivo', async () => {
  const h = harness(), p = await h.store.createStudioProject('owner', 'aula');
  await assert.rejects(h.media.persistStudioVoiceover(p, { uri: 'file:///cache/voice.m4a', duration: 1 }, 0, { isCurrent: () => true }), /antes do fim/);
  await assert.rejects(h.media.persistStudioVoiceover(p, { uri: 'file:///cache/voice.m4a', duration: 1 }, 0, { isCurrent: () => false }), /cancelada/);
  assert.equal(h.copies.length, 0);
});
test('metadata real propaga vídeo sem áudio; projetos legados mantêm capacidade desconhecida', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///silent.mp4', fileName: 'Sem som.mp4' }], mediaInfo: () => ({ duration: 2, width: 320, height: 180, hasVideo: true, hasAudio: false }) });
  const p = await h.store.createStudioProject('owner', 'aula'); const takes = await h.media.importStudioMedia(p);
  assert.equal(takes[0].hasAudio, false); assert.equal(h.store.getStudioProject('owner', p.id).editing.assets[0].hasAudio, false);
  const unknown = h.model.migrateStudioProject({ version: 1, kind: 'aula', takes: [{ id: 'old', uri: 'file:///old.mp4', name: 'Antigo', duration: 2, start: 0, end: 2 }] });
  assert.equal(unknown.editing.assets[0].hasAudio, undefined);
});

test('narração inicia histórico na mutação mais recente e confirma só depois de persistir a faixa', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///video.mp4', fileName: 'Vídeo.mp4' }] });
  let p = await h.store.createStudioProject('owner', 'aula'); await h.media.importStudioMedia(p); p = h.store.getStudioProject('owner', p.id);
  const originalAssets = plain(p.editing.assets), order = [];
  h.copyCheck(async () => { h.copyCheck(undefined); await h.store.updateStudioProject('owner', p.id, { title: 'Nome mais recente' }); });
  const result = await h.media.persistStudioVoiceover(p, { uri: 'file:///cache/voice.m4a', duration: 1 }, .2, { isCurrent: () => true,
    onBeforePersist: (latest, next) => { order.push('before'); assert.equal(latest.title, 'Nome mais recente'); assert.equal(latest.editing.layers.length, 0); assert.equal(next.layers.length, 1); assert.deepEqual(plain(next.assets.slice(0, originalAssets.length)), originalAssets); assert.equal(h.store.getStudioProject('owner', p.id).editing.layers.length, 0); },
    onPersisted: saved => { order.push('persisted'); assert.equal(h.store.getStudioProject('owner', p.id), saved); assert.equal(saved.pendingTakes.length, 0); },
    onPersistError: () => order.push('error') });
  assert.deepEqual(order, ['before', 'persisted']); assert.equal(result.project.title, 'Nome mais recente');
});
test('falha na escrita aborta histórico e mantém journal para um retry sem cópia duplicada', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///video.mp4', fileName: 'Vídeo.mp4' }] });
  let p = await h.store.createStudioProject('owner', 'aula'); await h.media.importStudioMedia(p); p = h.store.getStudioProject('owner', p.id);
  const order = [], source = { uri: 'file:///cache/voice.m4a', duration: 1 };
  await assert.rejects(h.media.persistStudioVoiceover(p, source, .2, { isCurrent: () => true,
    onBeforePersist: () => { order.push('before'); h.writeCheck(() => { throw new Error('Disco cheio'); }); },
    onPersisted: () => order.push('persisted'), onPersistError: () => order.push('error') }), /Disco cheio/);
  assert.deepEqual(order, ['before', 'error']); const pending = h.store.getStudioProject('owner', p.id); assert.equal(pending.editing.layers.length, 0); assert.equal(pending.pendingTakes.length, 1);
  const copied = h.copies.length; h.writeCheck(undefined);
  await h.media.persistStudioVoiceover(p, source, .2, { isCurrent: () => true, onBeforePersist: () => order.push('retry-before'), onPersisted: () => order.push('retry-persisted') });
  assert.equal(h.copies.length, copied); assert.equal(h.store.getStudioProject('owner', p.id).editing.layers.length, 1); assert.deepEqual(order, ['before', 'error', 'retry-before', 'retry-persisted']);
});
test('blur durante escrita já iniciada confirma compromisso durável e não simula rollback do áudio', async () => {
  const h = harness({ pickerAssets: [{ uri: 'file:///video.mp4', fileName: 'Vídeo.mp4' }] });
  let p = await h.store.createStudioProject('owner', 'aula'); await h.media.importStudioMedia(p); p = h.store.getStudioProject('owner', p.id);
  let current = true; const order = [];
  const saved = await h.media.persistStudioVoiceover(p, { uri: 'file:///cache/voice.m4a', duration: 1 }, .2, { isCurrent: () => current,
    onBeforePersist: () => { order.push('before'); h.writeCheck(() => { current = false; h.writeCheck(undefined); }); },
    onPersisted: () => order.push('persisted'), onPersistError: () => order.push('error') });
  assert.deepEqual(order, ['before', 'persisted']); assert.equal(saved.project.editing.layers.length, 1); assert.equal(saved.project.pendingTakes.length, 0);
});

test('melhoria ou retoque ativo em profile legado bloqueia export antigo mesmo após restauração',async()=>{
 for(const field of ['enhancement','portrait']){
 const h=harness(),p=await h.store.createStudioProject('owner','aula'),created=await h.store.updateStudioProject('owner',p.id,{takes:[baseTake]});
 const legacy={...created.editing,output:{...created.editing.output,profile:'legacy-source',colorSpace:'source'}};
 const value=field==='portrait'?{version:1,strength:.4}:{version:1,strength:.8,exposure:.2,contrast:0,saturation:0,temperature:0,tint:0,shadows:0,highlights:0,analyzedFrames:1};
 const editing=field==='portrait'?h.model.patchStudioClipPortrait(legacy,'base',value):h.model.patchStudioClipEnhancement(legacy,'base',value);
 const saved=await h.store.updateStudioProject('owner',p.id,{editing});await assert.rejects(h.media.exportStudioProject(saved),/perfil de composição/);assert.equal(h.nativeExports(),0);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
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
  const native = {
    isStudioMediaAvailable: () => true, isStudioCompositionAvailable: () => true,
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
    'expo-image-manipulator': { ImageManipulator: { manipulate: uri => ({ renderAsync: async () => { if (!repair && disk.get(uri)?.bad) throw new Error('Imagem ilegível'); return { width: 1200, height: 800 }; } }) } }, '@/lib/supabase': { supabase: { auth: { getSession: async () => {
      await sessionCheck?.(); return { data: { session: { user: { id: sessionOwner } } } };
    } } } }, '../../../modules/classfy-studio-media': native, './model': model, './store': store,
  });
  return { media, store, model, nativeCalls, disk, data, repair: () => { repair = true; }, nativeExports: () => nativeExports,
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
  assert.equal(pending.layerItem.id, 'pip'); assert.equal(pending.layerId, 'layer:video');
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
test('legado simples usa export original; efeito ou camada não podem cair no export que os perde', async () => {
  const h = harness(); const p = await h.store.createStudioProject('owner', 'aula');
  const created = await h.store.updateStudioProject('owner', p.id, { takes: [baseTake] });
  const legacy = await h.store.updateStudioProject('owner', p.id, { editing: { ...created.editing, output: { ...created.editing.output, profile: 'legacy-source', colorSpace: 'source' } } });
  await h.media.exportStudioProject(legacy); assert.equal(h.nativeCalls.at(-1).kind, 'legacy');
  const graded = await h.store.updateStudioProject('owner', p.id, { editing: h.model.patchStudioClipGrade(legacy.editing, 'base', { preset: 'cinematic' }) });
  const before = h.nativeExports(); await assert.rejects(h.media.exportStudioProject(graded), /perfil 1080p/);
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

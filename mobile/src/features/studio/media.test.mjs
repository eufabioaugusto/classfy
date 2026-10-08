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
function harness() {
  const disk = new Map(); let sequence = 0, repair = false, nativeExports = 0, sessionCheck, copyCheck;
  let sessionOwner = 'owner', pickerCanceled = false;
  const crypto = { randomUUID: () => `id-${++sequence}` };
  const fileSystem = { documentDirectory: 'file:///current/Documents/',
    makeDirectoryAsync: async () => {}, copyAsync: async ({from, to}) => { disk.set(to, { bad: from.includes('broken') }); await copyCheck?.(); },
    getInfoAsync: async uri => ({ exists: disk.has(uri), isDirectory: false, size: 100 }),
  };
  const data = new Map();
  const model = compile('./model.ts', {});
  const store = compile('./store.ts', { '@react-native-async-storage/async-storage': {
    getItem: async key => data.get(key) || null, setItem: async (key, value) => { data.set(key, value); },
  }, 'expo-file-system/legacy': fileSystem, 'expo-crypto': crypto, './model': model });
  const native = {
    isStudioMediaAvailable: () => true,
    getMediaInfoAsync: async uri => {
      if (!repair && disk.get(uri)?.bad) throw new Error('Arquivo temporariamente ilegível');
      return { duration: 2, width: 320, height: 180, hasVideo: true, hasAudio: true, fileSize: 100 };
    },
    generateThumbnailAsync: async (_uri, output) => { disk.set(output, {}); return { uri: output }; },
    cancelExportAsync: async () => {}, exportTimelineAsync: async options => {
      nativeExports++; return { uri: options.outputUri, duration: 2, mimeType: 'video/mp4', fileSize: 100 };
    },
  };
  const media = compile('./media.ts', { 'expo-file-system/legacy': fileSystem, 'expo-crypto': crypto,
    'react-native': { Alert: { alert() {} } },
    'expo-image-picker': { UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' }, launchImageLibraryAsync: async () => ({ canceled: pickerCanceled,
      assets: [{ uri: 'file:///good.mp4', fileName: 'Bom' }, { uri: 'file:///broken.mp4', fileName: 'Pendente' }] }) },
    'expo-document-picker': {}, 'expo-image-manipulator': {}, '@/lib/supabase': { supabase: { auth: { getSession: async () => {
      await sessionCheck?.(); return { data: { session: { user: { id: sessionOwner } } } };
    } } } }, '../../../modules/classfy-studio-media': native, './model': model, './store': store,
  });
  return { media, store, disk, data, repair: () => { repair = true; }, nativeExports: () => nativeExports,
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
test('export antigo fixo em 1080p/30 não é reutilizado pelo pipeline que preserva 4K e FPS', async () => {
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

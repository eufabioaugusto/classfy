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
  const disk = new Map(); let sequence = 0, repair = false, nativeExports = 0, sessionCheck;
  const crypto = { randomUUID: () => `id-${++sequence}` };
  const fileSystem = { documentDirectory: 'file:///current/Documents/',
    makeDirectoryAsync: async () => {}, copyAsync: async ({from, to}) => { disk.set(to, { bad: from.includes('broken') }); },
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
    'expo-image-picker': { UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' }, launchImageLibraryAsync: async () => ({ canceled: false,
      assets: [{ uri: 'file:///good.mp4', fileName: 'Bom' }, { uri: 'file:///broken.mp4', fileName: 'Pendente' }] }) },
    'expo-document-picker': {}, 'expo-image-manipulator': {}, '@/lib/supabase': { supabase: { auth: { getSession: async () => {
      await sessionCheck?.(); return { data: { session: { user: { id: 'owner' } } } };
    } } } }, '../../../modules/classfy-studio-media': native, './model': model, './store': store,
  });
  return { media, store, disk, repair: () => { repair = true; }, nativeExports: () => nativeExports, sessionCheck: fn => { sessionCheck = fn; } };
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

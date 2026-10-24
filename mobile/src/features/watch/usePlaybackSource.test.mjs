import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('./usePlaybackSource.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const friendlyError = 'Não foi possível carregar o vídeo. Abra o conteúdo novamente.';
const response = url => ({ data: { source: { url } }, error: null });
function harness(initial = {}) {
  let owner = 'owner-a', mediaAssetId = 'asset-a', legacyUrl, enabled = true, cursor = 0, dirty = true, effects = [], current, disposed = false, writes = 0;
  const slots = [], calls = [], requests = [];
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initialValue) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      return [slots[index].value, value => { writes++; slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; dirty = true; }];
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) effects.push({ index, callback, deps });
    },
  };
  const dependencies = {
    react: hooks,
    '@/features/auth/authContext': { useAuth: () => ({ user: owner ? { id: owner } : null }) },
    '@/lib/supabase': { supabase: { functions: { invoke: (name, options) => {
      calls.push({ name, options });
      return new Promise((resolve, reject) => requests.push({ resolve, reject }));
    } } } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  const update = values => {
    if ('owner' in values) owner = values.owner;
    if ('mediaAssetId' in values) mediaAssetId = values.mediaAssetId;
    if ('legacyUrl' in values) legacyUrl = values.legacyUrl;
    if ('enabled' in values) enabled = values.enabled;
    dirty = true;
  };
  update(initial);
  const pump = async () => {
    for (let round = 0; round < 20; round++) {
      if (!disposed && dirty) {
        cursor = 0; dirty = false; effects = [];
        current = module.exports.usePlaybackSource(mediaAssetId, legacyUrl, enabled);
        for (const effect of effects) { slots[effect.index]?.cleanup?.(); slots[effect.index] = { deps: effect.deps, cleanup: effect.callback() }; }
      }
      await new Promise(resolve => setImmediate(resolve));
      if (disposed || !dirty) return;
    }
    throw new Error('Playback source did not settle');
  };
  return { pump, update, calls, state: () => current, writes: () => writes,
    resolve: (index, value) => requests[index].resolve(value), reject: index => requests[index].reject(Error('Internal transport diagnostic')),
    dispose: () => { if (!disposed) { disposed = true; for (const slot of slots) slot?.cleanup?.(); } },
  };
}

test('request rejeitado encerra carregamento e mostra erro público sem diagnóstico bruto', async () => {
  const h = harness();
  try {
    await h.pump(); assert.deepEqual(h.state(), { url: '', error: '', loading: true });
    h.reject(0); await h.pump(); assert.deepEqual(h.state(), { url: '', error: friendlyError, loading: false });
    assert.equal(h.calls.length, 1);
  } finally { h.dispose(); }
});
test('fonte resolvida preserva URL e contrato de uma chamada, sem playback paralelo', async () => {
  const h = harness();
  try {
    await h.pump(); assert.deepEqual(h.calls, [{ name: 'video-playback', options: { body: { mediaAssetId: 'asset-a' } } }]);
    h.resolve(0, response('https://private.example/asset-a.m3u8')); await h.pump();
    assert.deepEqual(h.state(), { url: 'https://private.example/asset-a.m3u8', error: '', loading: false }); assert.equal(h.calls.length, 1);
  } finally { h.dispose(); }
});
for (const result of [{ data: null, error: Error('Internal service diagnostic') }, response('')]) test(`resposta sem fonte utilizável conserva erro público: ${result.error ? 'serviço' : 'URL vazia'}`, async () => {
  const h = harness();
  try { await h.pump(); h.resolve(0, result); await h.pump(); assert.deepEqual(h.state(), { url: '', error: friendlyError, loading: false }); }
  finally { h.dispose(); }
});
for (const change of ['owner', 'source']) for (const outcome of ['resolve', 'reject']) test(`retorno tardio ${outcome} após troca de ${change} não altera a nova fonte`, async () => {
  const h = harness();
  try {
    await h.pump(); h.update(change === 'owner' ? { owner: 'owner-b' } : { mediaAssetId: 'asset-b' }); await h.pump();
    assert.deepEqual(h.state(), { url: '', error: '', loading: true }); assert.equal(h.calls.length, 2);
    h.resolve(1, response('https://private.example/current.m3u8')); await h.pump(); const writes = h.writes();
    if (outcome === 'resolve') h.resolve(0, response('https://private.example/stale.m3u8')); else h.reject(0);
    await h.pump(); assert.deepEqual(h.state(), { url: 'https://private.example/current.m3u8', error: '', loading: false }); assert.equal(h.writes(), writes);
  } finally { h.dispose(); }
});
for (const change of ['unmount', 'logout', 'disabled']) test(`rejeição tardia após ${change} não publica erro de outra sessão`, async () => {
  const h = harness();
  try {
    await h.pump();
    if (change === 'unmount') h.dispose(); else { h.update(change === 'logout' ? { owner: undefined } : { enabled: false }); await h.pump(); }
    const writes = h.writes(); h.reject(0); await h.pump(); assert.equal(h.writes(), writes);
    if (change !== 'unmount') assert.deepEqual(h.state(), { url: '', error: '', loading: false });
  } finally { h.dispose(); }
});
test('fonte legada válida não chama o serviço e marcador media não vira URL reproduzível', async () => {
  const h = harness({ mediaAssetId: undefined, legacyUrl: 'https://private.example/legacy.mp4' });
  try {
    await h.pump(); assert.deepEqual(h.state(), { url: 'https://private.example/legacy.mp4', error: '', loading: false }); assert.equal(h.calls.length, 0);
    h.update({ legacyUrl: 'media:unresolved' }); await h.pump(); assert.deepEqual(h.state(), { url: '', error: 'Fonte de vídeo indisponível.', loading: false }); assert.equal(h.calls.length, 0);
  } finally { h.dispose(); }
});

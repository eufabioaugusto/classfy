import test from 'node:test';
import assert from 'node:assert/strict';
import { retainStudioMonitorScreen } from './cameraMonitorKeepAwake.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('monitor ativo mantém a tela e libera somente seu tag de proprietário/projeto', async () => {
  const calls = [];
  const release = retainStudioMonitorScreen({ ownerId: 'owner', projectId: 'project',
    activate: async tag => { calls.push(['activate', tag]); }, deactivate: async tag => { calls.push(['deactivate', tag]); } });
  await tick(); assert.equal(calls.length, 1); assert.match(calls[0][1], /^studio-camera-monitor:owner:project:\d+$/);
  release(); await tick(); assert.deepEqual(calls[1], ['deactivate', calls[0][1]]);
});

test('ativação tardia após cleanup se desativa sem soltar o monitor mais novo da mesma conta', async () => {
  const pending = deferred(), calls = [];
  const deps = { ownerId: 'owner', projectId: 'project', deactivate: async tag => { calls.push(['deactivate', tag]); } };
  const first = retainStudioMonitorScreen({ ...deps, activate: async tag => { calls.push(['activate', tag]); await pending.promise; } });
  const oldTag = calls[0][1]; first();
  const second = retainStudioMonitorScreen({ ...deps, activate: async tag => { calls.push(['activate', tag]); } });
  const newTag = calls.find(call => call[0] === 'activate' && call[1] !== oldTag)[1];
  assert.notEqual(oldTag, newTag); await tick(); pending.resolve(); await tick();
  assert.equal(calls.filter(call => call[0] === 'deactivate' && call[1] === oldTag).length, 2);
  assert.equal(calls.filter(call => call[0] === 'deactivate' && call[1] === newTag).length, 0);
  second(); await tick(); assert.deepEqual(calls.at(-1), ['deactivate', newTag]);
});

test('erro de plataforma ao ativar/desativar não vaza rejeição nem interfere na captura', async () => {
  let released = 0;
  const release = retainStudioMonitorScreen({ ownerId: 'owner', projectId: 'project', activate: async () => { throw Error('unavailable'); },
    deactivate: async tag => { assert.equal(typeof tag, 'string'); released++; throw Error('inactive'); } });
  await tick(); release(); await tick(); assert.equal(released, 1);
});

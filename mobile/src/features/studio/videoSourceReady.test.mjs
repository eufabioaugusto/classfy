import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceStudioPreviewSource, StudioPreviewSourceCancelledError } from './videoSourceReady.ts';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mockPlayer(replace = async () => {}) {
  const listeners = new Map();
  const player = {
    status: 'loading',
    replaceAsync(uri) { assert.equal(player.listenerCount(), 3); return replace(uri); },
    addListener(event, callback) {
      const callbacks = listeners.get(event) || new Set();
      callbacks.add(callback); listeners.set(event, callbacks);
      return { remove() { callbacks.delete(callback); } };
    },
    emit(event, payload) {
      if (event === 'statusChange') player.status = payload.status;
      for (const callback of [...(listeners.get(event) || [])]) callback(payload);
    },
    listenerCount() { return [...listeners.values()].reduce((count, callbacks) => count + callbacks.size, 0); },
  };
  return player;
}
const turn = () => new Promise(resolve => setImmediate(resolve));
function source(player, uri) {
  player.emit('sourceChange', { source: uri === null ? null : { uri } });
}
function metadata(player, uri) {
  player.emit('sourceLoad', { videoSource: uri === null ? null : { uri } });
}

test('resolução de replaceAsync antes do main queue não libera seek/play da nova fonte', async () => {
  const player = mockPlayer();
  const replacement = replaceStudioPreviewSource(player, 'file:///next.mp4', () => true);
  let ready = false; replacement.promise.then(() => { ready = true; });
  await replacement.settled;
  assert.equal(ready, false);
  source(player, 'file:///next.mp4');
  metadata(player, 'file:///next.mp4');
  await turn(); assert.equal(ready, false);
  player.emit('statusChange', { status: 'readyToPlay' });
  await replacement.promise;
  assert.equal(ready, true);
  assert.equal(player.listenerCount(), 0);
});
test('listeners precedem replace e callbacks síncronos ainda aguardam a promessa nativa', async () => {
  const native = deferred();
  const player = mockPlayer(uri => {
    source(player, uri);
    player.emit('statusChange', { status: 'readyToPlay' });
    metadata(player, uri);
    return native.promise;
  });
  const replacement = replaceStudioPreviewSource(player, 'file:///next.mp4', () => true);
  let ready = false; replacement.promise.then(() => { ready = true; });
  await turn(); assert.equal(ready, false);
  native.resolve(); await replacement.promise;
  assert.equal(ready, true);
  assert.equal(player.listenerCount(), 0);
});
test('metadados não substituem buffering pronto e fonte anterior não satisfaz handshake', async () => {
  const player = mockPlayer();
  player.status = 'readyToPlay';
  const replacement = replaceStudioPreviewSource(player, 'file:///next.mp4', () => true);
  let ready = false; replacement.promise.then(() => { ready = true; });
  metadata(player, 'file:///next.mp4'); // Metadata without confirmed item is ignored.
  source(player, 'file:///previous.mp4'); metadata(player, 'file:///previous.mp4');
  player.emit('statusChange', { status: 'readyToPlay' });
  await turn(); assert.equal(ready, false);
  source(player, 'file:///next.mp4');
  player.emit('statusChange', { status: 'loading' });
  metadata(player, 'file:///next.mp4');
  await turn(); assert.equal(ready, false);
  player.emit('statusChange', { status: 'readyToPlay' });
  await replacement.promise;
});
test('cancel limpa listeners imediatamente mas settled preserva fila da chamada nativa', async () => {
  const native = deferred(); const player = mockPlayer(() => native.promise);
  const replacement = replaceStudioPreviewSource(player, 'file:///next.mp4', () => true);
  const rejected = assert.rejects(replacement.promise, StudioPreviewSourceCancelledError);
  let settled = false; replacement.settled.then(() => { settled = true; });
  replacement.cancel(); replacement.cancel();
  assert.equal(player.listenerCount(), 0);
  await rejected; await turn(); assert.equal(settled, false);
  native.resolve(); await replacement.settled; assert.equal(settled, true);
});
test('geração obsoleta rejeita antes de iniciar replace ou ao receber novo evento', async () => {
  let calls = 0; const player = mockPlayer(async () => { calls++; });
  const obsolete = replaceStudioPreviewSource(player, 'file:///old.mp4', () => false);
  await assert.rejects(obsolete.promise, StudioPreviewSourceCancelledError);
  await obsolete.settled; assert.equal(calls, 0); assert.equal(player.listenerCount(), 0);
  let current = true;
  const replacement = replaceStudioPreviewSource(player, 'file:///next.mp4', () => current);
  const rejected = assert.rejects(replacement.promise, StudioPreviewSourceCancelledError);
  current = false; source(player, 'file:///next.mp4');
  await rejected; assert.equal(player.listenerCount(), 0);
});
test('erro nativo e status de erro durante carregamento rejeitam e limpam o handshake', async () => {
  const rejectedPlayer = mockPlayer(async () => { throw new Error('native failure'); });
  const rejected = replaceStudioPreviewSource(rejectedPlayer, 'file:///broken.mp4', () => true);
  await assert.rejects(rejected.promise, /carregar/);
  await rejected.settled; assert.equal(rejectedPlayer.listenerCount(), 0);
  const player = mockPlayer();
  const replacement = replaceStudioPreviewSource(player, 'file:///broken.mp4', () => true);
  const failure = assert.rejects(replacement.promise, /carregar/);
  source(player, 'file:///broken.mp4'); player.emit('statusChange', { status: 'error' });
  await failure; assert.equal(player.listenerCount(), 0);
});
test('erro exposto pelo getter ao chegar metadata também é rejeitado', async () => {
  const player = mockPlayer();
  const replacement = replaceStudioPreviewSource(player, 'file:///broken.mp4', () => true);
  const failure = assert.rejects(replacement.promise, /carregar/);
  source(player, 'file:///broken.mp4'); player.status = 'error'; metadata(player, 'file:///broken.mp4');
  await failure; assert.equal(player.listenerCount(), 0);
});
test('timeout remove listeners e não deixa a chamada nativa sem observador de rejeição', async () => {
  const native = deferred(); const player = mockPlayer(() => native.promise);
  const replacement = replaceStudioPreviewSource(player, 'file:///slow.mp4', () => true, 5);
  await assert.rejects(replacement.promise, /demorou/);
  assert.equal(player.listenerCount(), 0);
  native.reject(new Error('late native failure')); await replacement.settled;
});
test('clear de fonte espera aplicação de null, mas player já vazio não depende de evento redundante', async () => {
  const player = mockPlayer(); player.status = 'readyToPlay';
  const replacement = replaceStudioPreviewSource(player, null, () => true);
  let cleared = false; replacement.promise.then(() => { cleared = true; });
  await replacement.settled; await turn(); assert.equal(cleared, false);
  source(player, null); await replacement.promise;
  assert.equal(player.listenerCount(), 0);
  const empty = mockPlayer(); empty.status = 'idle';
  await replaceStudioPreviewSource(empty, null, () => true).promise;
  assert.equal(empty.listenerCount(), 0);
});
test('native shared object liberado durante clear rejeita sem callback órfão', async () => {
  const native = deferred(); const player = mockPlayer(() => native.promise);
  let released = false;
  Object.defineProperty(player, 'status', { get() { if (released) throw new Error('released'); return 'idle'; } });
  const replacement = replaceStudioPreviewSource(player, null, () => true);
  const failure = assert.rejects(replacement.promise, /preparar/);
  released = true; native.resolve();
  await failure; await replacement.settled;
  assert.equal(player.listenerCount(), 0);
});

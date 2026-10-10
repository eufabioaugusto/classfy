import test from 'node:test';
import assert from 'node:assert/strict';
import { createBroadcastController } from './broadcastController.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(overrides = {}) {
  const calls = [];
  let row = { id: 'live', creator_id: 'owner', status: 'waiting', mux_live_stream_id: 'mux', livekit_egress_id: null };
  const transport = {
    async prepare() { calls.push('prepare'); }, async connectAndPublish() { calls.push('publish-tracks'); },
    async disconnect() { calls.push('disconnect'); }, async dispose() { calls.push('dispose'); }, ...overrides.transport,
  };
  const backend = {
    async getLive() { calls.push('get'); return { ...row }; }, async connectHost() { calls.push('connect-token'); return { url: 'wss://example.invalid', token: 'ephemeral' }; },
    async startBridge(owner, id, restart) { calls.push(restart ? 'restart-bridge' : 'start-bridge'); },
    async syncLive() { calls.push('sync'); return { status: row.status }; }, async endLive() { calls.push('end-server'); }, ...overrides.backend,
  };
  const controller = createBroadcastController({ owner: 'owner', liveId: 'live', transport, backend, countdownSeconds: 0, ...overrides.controller });
  controller.updateLive(row);
  return { controller, calls, setRow: value => { row = { ...row, ...value }; controller.updateLive(row); } };
}
test('camera preview is private and start publishes both tracks before starting server bridge', async () => {
  const { controller, calls, setRow } = fixture();
  assert.equal(await controller.prepare(), true);
  assert.deepEqual(calls, ['prepare']); assert.equal(controller.mustConfirmLeave(), false);
  assert.equal(await controller.start(), true);
  assert.deepEqual(calls, ['prepare', 'get', 'connect-token', 'publish-tracks', 'start-bridge']);
  assert.equal(controller.getSnapshot().phase, 'awaiting-signal'); assert.equal(controller.mustConfirmLeave(), true);
  setRow({ status: 'live' }); assert.equal(controller.getSnapshot().phase, 'live');
});
test('double tap start cannot duplicate publishing or bridge', async () => {
  const gate = deferred(); const { controller, calls } = fixture({ transport: { async connectAndPublish() { calls.push('publish-tracks'); await gate.promise; } } });
  await controller.prepare(); const first = controller.start(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await controller.start(), false); gate.resolve(); await first;
  assert.equal(calls.filter(call => call === 'start-bridge').length, 1);
});
test('lost start response keeps an explicit possible live and a working end action', async () => {
  const { controller, calls } = fixture({ backend: { async startBridge() { throw new Error('lost response'); } } });
  await controller.prepare(); assert.equal(await controller.start(), false);
  assert.equal(controller.getSnapshot().phase, 'interrupted'); assert.equal(controller.getSnapshot().mayBeOnAir, true);
  assert.equal(controller.mustConfirmLeave(), true); assert.equal(await controller.end(), true);
  assert.equal(controller.getSnapshot().phase, 'ended'); assert.equal(controller.mustConfirmLeave(), false);
  assert.ok(calls.indexOf('end-server') < calls.lastIndexOf('disconnect'));
});
test('failed end leaves RTC publishing and public status intact for retry', async () => {
  const { controller, calls, setRow } = fixture({ backend: { async endLive() { throw new Error('offline'); } } });
  await controller.prepare(); await controller.start(); setRow({ status: 'live' });
  const disconnects = calls.filter(call => call === 'disconnect').length;
  assert.equal(await controller.end(), false); assert.equal(controller.getSnapshot().phase, 'live');
  assert.equal(controller.getSnapshot().localPublishing, true); assert.equal(controller.mustConfirmLeave(), true);
  assert.equal(calls.filter(call => call === 'disconnect').length, disconnects);
});
test('terminal server event prevents a pending host token from publishing late', async () => {
  const gate = deferred(); const { controller, calls, setRow } = fixture({ backend: { async connectHost() { return gate.promise; } } });
  await controller.prepare(); const start = controller.start(); await new Promise(resolve => setImmediate(resolve));
  setRow({ status: 'ended' }); gate.resolve({ url: 'wss://example.invalid', token: 'late' });
  assert.equal(await start, false); assert.equal(calls.includes('publish-tracks'), false); assert.equal(controller.getSnapshot().phase, 'ended');
});
test('owner/route epoch change discards late connection before RTC publication', async () => {
  let current = true; const gate = deferred(); const { controller, calls } = fixture({ backend: { async connectHost() { return gate.promise; } }, controller: { isCurrent: () => current } });
  await controller.prepare(); const start = controller.start(); await new Promise(resolve => setImmediate(resolve));
  current = false; gate.resolve({ url: 'wss://example.invalid', token: 'late' });
  assert.equal(await start, false); assert.equal(calls.includes('publish-tracks'), false);
  await controller.dispose(); assert.equal(calls.at(-1), 'dispose');
});
test('background releases capture without ending server; returning requires explicit resume', async () => {
  const { controller, calls, setRow } = fixture(); await controller.prepare(); await controller.start(); setRow({ status: 'live' });
  await controller.setForeground(false); assert.equal(controller.getSnapshot().phase, 'interrupted');
  assert.equal(calls.includes('end-server'), false); assert.equal(controller.getSnapshot().localPublishing, false);
  const publications = calls.filter(call => call === 'publish-tracks').length;
  await controller.setForeground(true); assert.equal(calls.filter(call => call === 'publish-tracks').length, publications);
  await controller.prepare(); await controller.start(); assert.equal(controller.getSnapshot().phase, 'live');
  assert.equal(calls.filter(call => call === 'start-bridge').length, 1);
});
test('background during countdown cannot fetch host token or begin broadcasting', async () => {
  const gate = deferred(); const { controller, calls } = fixture({ controller: { countdownSeconds: 3, wait: () => gate.promise } });
  await controller.prepare(); const start = controller.start(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.getSnapshot().countdown, 3); await controller.setForeground(false); gate.resolve();
  assert.equal(await start, false); assert.equal(calls.includes('connect-token'), false); assert.equal(controller.getSnapshot().countdown, 0);
});
test('prepared live with prior egress uses recovery rather than duplicate start', async () => {
  const { controller, calls, setRow } = fixture(); setRow({ livekit_egress_id: 'prior' }); await controller.prepare(); await controller.start();
  assert.equal(calls.includes('restart-bridge'), true); assert.equal(calls.includes('start-bridge'), false);
});
test('reconnecting never loses the confirmed public live and recovery uses server status', async () => {
  const { controller, setRow } = fixture(); await controller.prepare(); await controller.start();
  controller.connectionChanged('reconnecting'); assert.equal(controller.getSnapshot().phase, 'reconnecting');
  controller.connectionChanged('connected'); assert.equal(controller.getSnapshot().phase, 'awaiting-signal');
  setRow({ status: 'live' }); controller.connectionChanged('reconnecting'); controller.connectionChanged('connected');
  assert.equal(controller.getSnapshot().phase, 'live'); assert.equal(controller.getSnapshot().mayBeOnAir, true);
});
test('foreign and legacy lives cannot start a native publisher', async () => {
  for (const patch of [{ creator_id: 'another' }, { mux_live_stream_id: null }]) {
    const { controller, calls } = fixture({ backend: { async getLive() { return { id: 'live', creator_id: 'owner', status: 'waiting', livekit_egress_id: null, mux_live_stream_id: 'mux', ...patch }; } } });
    await controller.prepare(); assert.equal(await controller.start(), false); assert.equal(calls.includes('publish-tracks'), false);
  }
});
test('camera interruption releases tracks and requires explicit capture before resuming', async () => {
  const { controller, calls, setRow } = fixture(); await controller.prepare(); await controller.start(); setRow({ status: 'live' });
  controller.captureInterrupted(); assert.equal(controller.getSnapshot().phase, 'interrupted');
  assert.equal(await controller.start(), false); assert.ok(calls.includes('disconnect'));
  assert.equal(controller.mustConfirmLeave(), true);
});
test('signal confirmed while tracks connect does not dispatch an obsolete start bridge', async () => {
  const gate = deferred(); const { controller, calls, setRow } = fixture({ transport: { async connectAndPublish() { await gate.promise; } } });
  await controller.prepare(); const start = controller.start(); await new Promise(resolve => setImmediate(resolve));
  setRow({ status: 'live' }); gate.resolve(); await start;
  assert.equal(controller.getSnapshot().phase, 'live'); assert.equal(calls.includes('start-bridge'), false);
});
test('capture ending while server bridge awaits invalidates publication and stops tracks', async () => {
  const gate = deferred(); const { controller, calls } = fixture({ backend: { startBridge: () => gate.promise } });
  await controller.prepare(); const start = controller.start(); await new Promise(resolve => setImmediate(resolve));
  controller.captureInterrupted(); assert.equal(controller.getSnapshot().phase, 'interrupted');
  gate.resolve(); assert.equal(await start, false); assert.equal(controller.getSnapshot().localPublishing, false);
  assert.equal(controller.getSnapshot().mayBeOnAir, true); assert.ok(calls.includes('disconnect'));
});
test('terminal update during failed start cleanup cannot resurrect interrupted live', async () => {
  const gate = deferred(); const { controller, setRow } = fixture({ backend: { startBridge: async () => { throw new Error('offline'); } }, transport: { disconnect: () => gate.promise } });
  await controller.prepare(); const start = controller.start(); await new Promise(resolve => setImmediate(resolve));
  setRow({ status: 'ended' }); gate.resolve(); await start;
  assert.equal(controller.getSnapshot().phase, 'ended'); assert.equal(controller.getSnapshot().mayBeOnAir, false);
});
test('losing route focus still releases capture even after callback scope became stale', async () => {
  let focused = true; const { controller, calls } = fixture({ controller: { isCurrent: () => focused } });
  await controller.prepare(); await controller.start(); focused = false;
  await controller.setForeground(false); assert.ok(calls.includes('disconnect')); assert.equal(controller.getSnapshot().localPublishing, false);
  focused = true; await controller.setForeground(true); assert.equal(controller.getSnapshot().phase, 'interrupted');
});

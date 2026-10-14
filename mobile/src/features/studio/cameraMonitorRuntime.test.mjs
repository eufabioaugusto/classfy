import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './cameraMonitorModel.ts';

const device = '11111111-1111-4111-8111-111111111111';
const uuid = index => `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`;
const state = { recording: false, elapsedSeconds: 0, width: 3840, height: 2160, fps: 30, cameraFacing: 'back' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function compile(file, deps, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    assert.ok(Object.hasOwn(deps, name), `Unexpected monitor dependency: ${name}`); return deps[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}
function publisherHarness(options = {}) {
  const calls = [], transports = [], timers = new Map(); let timerId = 0, now = 0, current = true, sequence = 0;
  const schedule = (callback, delay, interval) => { const id = ++timerId; timers.set(id, { callback, at: now + delay, interval }); return id; };
  const runtime = compile('./cameraMonitorPublisher.ts', { './cameraMonitorModel': model }, {
    setInterval: (callback, delay) => schedule(callback, delay, delay), clearInterval: id => timers.delete(id),
    setTimeout: (callback, delay) => schedule(callback, delay), clearTimeout: id => timers.delete(id),
  });
  const request = async (action, body) => {
    calls.push({ action, body: structuredClone(body) });
    await options.request?.(action, body);
    const monitor = { id: body.sessionId, ownerId: 'owner', deviceId: device, kind: 'aula', title: 'Cena', status: options.closed?.() ? 'closed' : 'active',
      state: body.state || null, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 90_000).toISOString(), deviceSeenAt: new Date(now).toISOString(), closedAt: null };
    return { monitor, serverAt: new Date(now).toISOString(), ...(action === 'monitor-connect' ? { connection: { url: 'wss://test.invalid', token: 'test-only', identity: `studio-monitor-device-${body.sessionId}-${device}` } } : {}) };
  };
  const publisher = runtime.createStudioCameraMonitorPublisher({ owner: 'owner', kind: 'aula', title: options.title || 'Cena', current: () => current,
    deviceId: async () => device, uuid: () => uuid(++sequence), request,
    transport: notify => {
      const transport = { async connect(tag, sessionId, connection) { calls.push({ action: 'preview', tag, sessionId, connection }); await options.connect?.(tag); notify({ connected: true, reconnecting: false, viewerPresent: false }); },
        async disconnect() { calls.push({ action: 'disconnect-preview' }); await options.disconnect?.(); }, notify };
      transports.push(transport); return transport;
    } });
  async function settle() { for (let i = 0; i < 8; i++) await tick(); }
  return { publisher, calls, transports, timers, settle, invalidate: () => { current = false; },
    async advance(milliseconds) {
      const end = now + milliseconds;
      for (let count = 0; count < 100; count++) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) { now = end; await settle(); return; }
        now = due[1].at; if (due[1].interval) due[1].at += due[1].interval; else timers.delete(due[0]);
        due[1].callback(); await settle();
      }
      throw Error('Monitor timer loop');
    } };
}

test('Premium é exclusivo, expira, e estado só aceita a whitelist de monitor', () => {
  assert.equal(model.hasStudioMonitorPremium({ plan: 'pro' }), false);
  const premium = { plan: 'premium', entitlement_source: 'apple', subscription_status: 'active', plan_expires_at: new Date(100).toISOString() };
  assert.equal(model.hasStudioMonitorPremium(premium, 99), true);
  assert.equal(model.hasStudioMonitorPremium(premium, 100), false);
  assert.equal(model.hasStudioMonitorPremium({ ...premium, plan_expires_at: null }, 99), false);
  assert.equal(model.hasStudioMonitorPremium({ ...premium, entitlement_source: 'other' }, 99), false);
  assert.equal(model.hasStudioMonitorPremium({ ...premium, subscription_status: 'unpaid' }, 99), false);
  assert.equal(model.hasStudioMonitorPremium({ ...premium, entitlement_source: 'admin', subscription_status: 'unpaid' }, 99), true);
  assert.equal(model.hasStudioMonitorPremium({ ...premium, subscription_status: 'past_due' }, 99), false);
  assert.equal(model.hasStudioMonitorPremium({ ...premium, subscription_status: 'past_due', subscription_grace_until: new Date(200).toISOString() }, 150), true);
  assert.equal(model.hasStudioMonitorPremium({ ...premium, subscription_status: 'past_due', subscription_grace_until: new Date(90).toISOString() }, 99), false);
  assert.equal(model.hasStudioMonitorPremium({ ...premium, entitlement_source: 'admin', subscription_status: 'past_due', subscription_grace_until: new Date(200).toISOString() }, 150), false);
  assert.equal(model.hasStudioMonitorPremium({ ...premium, plan_expires_at: 'invalid' }), false);
  assert.equal(model.validStudioMonitorState(state), true);
  for (const patch of [{ recording: 1 }, { elapsedSeconds: -1 }, { width: 8000 }, { fps: NaN }, { cameraFacing: 'external' }, { start: true }]) assert.equal(model.validStudioMonitorState({ ...state, ...patch }), false);
  assert.deepEqual(model.studioMonitorCaptureState({ ...state, elapsedSeconds: 20 }), state);
});

test('nenhuma prévia antes da ação; ativação cria sessão e publica somente tag existente', async t => {
  const h = publisherHarness({ title: 'A'.repeat(180) }); t.after(() => h.publisher.dispose());
  assert.equal(h.calls.length, 0);
  await h.publisher.enable(77, state); await h.settle();
  assert.deepEqual(h.calls.find(call => call.action === 'monitor-create').body, { sessionId: uuid(1), deviceId: device, kind: 'aula', title: 'A'.repeat(150) });
  assert.equal(h.calls.find(call => call.action === 'preview').tag, 77);
  assert.equal(h.publisher.getSnapshot().phase, 'connected');
  assert.equal(h.publisher.getSnapshot().viewerPresent, false);
  h.transports[0].notify({ connected: true, reconnecting: false, viewerPresent: true });
  assert.equal(h.publisher.getSnapshot().viewerPresent, true);
});

test('elapsed não inunda rede: heartbeat a cada dez segundos; REC envia confirmação imediatamente', async t => {
  const h = publisherHarness(); t.after(() => h.publisher.dispose());
  await h.publisher.enable(77, state); await h.settle(); h.calls.length = 0;
  for (let index = 1; index <= 40; index++) h.publisher.updateState({ ...state, elapsedSeconds: index / 4 });
  await h.advance(9_999); assert.equal(h.calls.length, 0);
  await h.advance(1); assert.equal(h.calls.filter(call => call.action === 'monitor-heartbeat').length, 1);
  h.publisher.updateState({ ...state, recording: true, elapsedSeconds: 0 }); await h.settle();
  assert.equal(h.calls.at(-1).body.state.recording, true);
  h.publisher.updateState({ ...state, recording: false }); await h.settle();
  assert.equal(h.calls.at(-1).body.state.recording, false);
});

test('metadados são coalescidos e heartbeats preservam a ordem quando REC muda durante request', async t => {
  const gate = deferred(); let block = false;
  const h = publisherHarness({ request: action => action === 'monitor-heartbeat' && block ? gate.promise : undefined }); t.after(() => h.publisher.dispose());
  await h.publisher.enable(77, state); await h.settle(); h.calls.length = 0;
  h.publisher.updateState({ ...state, fps: 60 }); h.publisher.updateState({ ...state, fps: 24 });
  await h.advance(149); assert.equal(h.calls.length, 0); await h.advance(1);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.state.fps, 24);
  block = true; h.publisher.updateState({ ...state, recording: true }); await h.settle();
  h.publisher.updateState({ ...state, recording: false }); await h.settle();
  assert.equal(h.calls.at(-1).body.state.recording, true);
  block = false; gate.resolve(); await h.settle(); assert.equal(h.calls.at(-1).body.state.recording, false);
});

test('trocar native tag durante conexão libera o antigo antes de reatar na mesma sessão', async t => {
  const gate = deferred();
  const h = publisherHarness({ connect: tag => tag === 77 ? gate.promise : undefined }); t.after(() => h.publisher.dispose());
  const starting = h.publisher.enable(77, state); await h.settle();
  h.publisher.setSource(null); h.publisher.setSource(99); gate.resolve(); await starting; await h.settle();
  const preview = h.calls.filter(call => call.action === 'preview');
  assert.deepEqual(preview.map(call => call.tag), [77, 99]);
  assert.equal(new Set(preview.map(call => call.sessionId)).size, 1);
  const old = h.calls.findIndex(call => call.action === 'preview');
  const next = h.calls.findIndex(call => call.action === 'preview' && call.tag === 99);
  assert.ok(h.calls.slice(old + 1, next).some(call => call.action === 'disconnect-preview'));
});

test('desativação durante criação fecha resposta tardia e não publica; nova ativação mantém sua sessão', async t => {
  const gate = deferred();
  const h = publisherHarness({ request: (action, body) => action === 'monitor-create' && body.sessionId === uuid(1) ? gate.promise : undefined }); t.after(() => h.publisher.dispose());
  const starting = h.publisher.enable(77, state); await h.settle();
  const closing = h.publisher.disable(); const next = h.publisher.enable(99, state);
  gate.resolve(); await Promise.all([starting, closing, next]); await h.settle();
  assert.deepEqual(h.calls.filter(call => call.action === 'preview').map(call => call.sessionId), [uuid(2)]);
  assert.ok(h.calls.some(call => call.action === 'monitor-close' && call.body.sessionId === uuid(1)));
  assert.equal(h.publisher.getSnapshot().monitor.id, uuid(2));
  assert.equal(h.publisher.getSnapshot().phase, 'connected');
});

test('falha/expiração e saída liberam somente monitor e cancelam heartbeats', async () => {
  let closed = false;
  const h = publisherHarness({ closed: () => closed });
  await h.publisher.enable(77, state); await h.settle(); closed = true;
  await h.advance(10_000);
  assert.equal(h.publisher.getSnapshot().enabled, false);
  assert.equal(h.publisher.getSnapshot().phase, 'error');
  assert.ok(h.calls.some(call => call.action === 'disconnect-preview'));
  assert.equal(h.timers.size, 0);
  assert.ok(h.calls.every(call => !['start', 'stop', 'configure', 'upload'].includes(call.action)));
  await h.publisher.dispose();
});

test('reativar durante cleanup de falha não perde o ID novo nem bloqueia sua publicação/heartbeat', async t => {
  const closing = deferred(); let failOld = false;
  const h = publisherHarness({ request: (action, body) => {
    if (action === 'monitor-heartbeat' && failOld && body.sessionId === uuid(1)) throw Error('Conexão encerrada');
    if (action === 'monitor-close' && body.sessionId === uuid(1)) return closing.promise;
  } }); t.after(() => h.publisher.dispose());
  await h.publisher.enable(77, state); await h.settle(); failOld = true;
  await h.advance(10_000); assert.equal(h.publisher.getSnapshot().phase, 'error');
  const restarting = h.publisher.enable(99, state); closing.resolve(); await restarting; await h.settle();
  assert.equal(h.publisher.getSnapshot().monitor.id, uuid(2));
  assert.equal(h.publisher.getSnapshot().phase, 'connected');
  assert.equal(h.calls.filter(call => call.action === 'preview').at(-1).sessionId, uuid(2));
  assert.equal(h.calls.filter(call => call.action === 'monitor-heartbeat').at(-1).body.sessionId, uuid(2));
});

test('scope perde proprietário enquanto connect aguarda: resposta não entra na nova conta', async () => {
  const gate = deferred();
  const h = publisherHarness({ request: action => action === 'monitor-connect' ? gate.promise : undefined });
  const starting = h.publisher.enable(77, state); await h.settle(); h.invalidate();
  const cleanup = h.publisher.dispose(); gate.resolve(); await Promise.all([starting, cleanup]);
  assert.equal(h.calls.filter(call => call.action === 'preview').length, 0);
  assert.equal(h.publisher.getSnapshot().phase, 'off');
  assert.equal(h.timers.size, 0);
});

function transportHarness(fixture = {}) {
  const calls = [], rooms = []; let leaseOwner = true;
  const client = {
    LogLevel: { silent: 'silent' }, setLogLevel() {}, Track: { Source: { Camera: 'camera' } },
    RoomEvent: { ConnectionStateChanged: 'state', ParticipantConnected: 'participant', ParticipantDisconnected: 'left' },
    LocalVideoTrack: class { constructor(media, _constraints, provided) { calls.push({ kind: 'video-track', media, provided }); } },
    Room: class { state = 'disconnected'; remoteParticipants = new Map(); listeners = new Map();
      localParticipant = { publishTrack: async (_track, options) => { calls.push({ kind: 'publish', options }); await fixture.publish?.(); } };
      constructor(options) { rooms.push(this); calls.push({ kind: 'room', options }); }
      on(event, listener) { this.listeners.set(event, listener); } off(event) { this.listeners.delete(event); }
      async connect(url, token, options) { calls.push({ kind: 'connect', url, token, options }); await fixture.connect?.(); this.state = 'connected'; }
      async disconnect() { calls.push({ kind: 'disconnect' }); this.state = 'disconnected'; }
    },
  };
  const runtime = compile('./cameraMonitorTransport.ts', {
    'react-native': { NativeModules: { WebRTCModule: { audioDeviceModuleSetAutomaticAudioSessionConfiguration: value => calls.push({ kind: 'audio-policy', value }) } } },
    '@/features/live/request': { withLiveDeadline: run => run() },
    '../../../modules/classfy-studio-media': {
      startStudioRemoteCameraPreviewAsync: async tag => { calls.push({ kind: 'native-preview', tag }); await fixture.nativePreview?.(); return { streamId: 'same-camera' }; },
      stopStudioRemoteCameraPreviewAsync: async tag => { calls.push({ kind: 'stop-preview', tag }); },
    },
    '@/features/live/transport': { reserveNativeCaptureForStudioCamera: () => ({ current: () => leaseOwner, release: () => { calls.push({ kind: 'release-lease' }); leaseOwner = false; } }) },
    'livekit-client': client,
    '@livekit/react-native-webrtc': { MediaStream: class { constructor(value) { calls.push({ kind: 'stream', value }); } getVideoTracks() { return [{ id: 'native-video' }]; } release() { calls.push({ kind: 'release-stream' }); } } },
    '@livekit/react-native': { registerGlobals: options => calls.push({ kind: 'register', options }), setupIOSAudioManagement: () => calls.push({ kind: 'restore-audio' }) },
  });
  const states = [], transport = runtime.createStudioMonitorPreviewTransport(value => states.push(value));
  return { calls, rooms, transport, states };
}
test('transporte publica pista fornecida da mesma view, nunca mídia/microfone/controle; encerrar não muda áudio', async () => {
  const h = transportHarness();
  await h.transport.connect(73, uuid(1), { url: 'wss://test.invalid', token: 'test-only', identity: 'device' });
  assert.equal(h.calls.find(call => call.kind === 'native-preview').tag, 73);
  assert.equal(h.calls.find(call => call.kind === 'video-track').provided, true);
  assert.deepEqual(h.calls.find(call => call.kind === 'register').options, { autoConfigureAudioSession: false });
  assert.deepEqual(h.calls.find(call => call.kind === 'connect').options, { autoSubscribe: false });
  const published = h.calls.find(call => call.kind === 'publish').options;
  assert.equal(published.source, 'camera'); assert.equal(published.simulcast, false); assert.equal(published.videoCodec, 'h264');
  assert.equal(h.states.at(-1).connected, true); assert.equal(h.states.at(-1).viewerPresent, false);
  h.rooms[0].remoteParticipants.set('viewer', { identity: `studio-monitor-viewer-${uuid(1)}-viewer` });
  h.rooms[0].listeners.get('participant')(); assert.equal(h.states.at(-1).viewerPresent, true);
  const cutoff = h.calls.length; await h.transport.disconnect();
  assert.deepEqual(h.calls.slice(cutoff).map(call => call.kind), ['disconnect', 'stop-preview', 'release-stream', 'release-lease']);
  assert.equal(h.calls.filter(call => call.kind === 'restore-audio').length, 0);
});

test('encerrar enquanto a branch nativa aguarda cancela publicação e libera somente o tag antigo', async () => {
  const gate = deferred(), h = transportHarness({ nativePreview: () => gate.promise });
  const connecting = h.transport.connect(73, uuid(1), { url: 'wss://test.invalid', token: 'test-only', identity: 'device' });
  const rejected = assert.rejects(connecting, /encerrado/);
  const closing = h.transport.disconnect(); gate.resolve(); await Promise.all([rejected, closing]);
  assert.equal(h.calls.filter(call => call.kind === 'publish').length, 0);
  assert.deepEqual(h.calls.filter(call => call.kind === 'stop-preview').map(call => call.tag), [73]);
});

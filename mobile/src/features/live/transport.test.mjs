import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function compile(file, dependencies, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
function clock() {
  let now = 0, next = 0; const timers = new Map(); const calls = [];
  return {
    calls,
    setTimeout(callback, delay) { const id = ++next; const timer = { callback, delay, at: now + delay, cleared: false }; timers.set(id, timer); calls.push(timer); return id; },
    clearTimeout(id) { const timer = timers.get(id); if (timer) timer.cleared = true; timers.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    get pending() { return timers.size; },
  };
}

function harness({ missing = false, partial = false, platform = 'ios', acquire, startAudio, connect, publishTrack, restart, sdkThrows = false, timers } = {}) {
  const calls = { requires: [], registrations: 0, logLevels: [], captures: [], starts: 0, stops: 0, rooms: [], tracks: [], publishes: [] };
  const TrackEvent = { Restarted: 'restarted', Ended: 'ended' };
  const RoomEvent = { ConnectionStateChanged: 'connectionStateChanged' };
  const ConnectionState = { Disconnected: 'disconnected', Connecting: 'connecting', Connected: 'connected', Reconnecting: 'reconnecting', SignalReconnecting: 'signalReconnecting' };
  class LocalTrack extends EventEmitter {
    constructor(kind) {
      super(); this.kind = kind; this.isMuted = false; this.stops = 0; this.restarts = [];
      this.settings = { width: 1280, height: 720, frameRate: 29.97 }; this.streamVersion = 1;
      this.mediaStream = { toURL: () => `private-${kind}-${this.streamVersion}` }; calls.tracks.push(this);
    }
    getSourceTrackSettings() { return this.settings; }
    stop() { this.stops += 1; }
    async mute() { this.isMuted = true; return this; }
    async unmute() { this.isMuted = false; return this; }
    async restartTrack(options) {
      this.restarts.push(options); await restart?.(this, options);
      this.streamVersion += 1; this.emit(TrackEvent.Restarted, this);
    }
  }
  class Room extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.closes = 0; calls.rooms.push(this);
      this.localParticipant = { publishTrack: async track => { calls.publishes.push(track); await publishTrack?.(this, track); } };
    }
    async connect(url, token, options) {
      this.connection = { url, token, options }; this.emit(RoomEvent.ConnectionStateChanged, ConnectionState.Connecting);
      await connect?.(this); this.emit(RoomEvent.ConnectionStateChanged, ConnectionState.Connected);
    }
    async disconnect(stopTracks) { this.closes += 1; this.stopTracks = stopTracks; this.emit(RoomEvent.ConnectionStateChanged, ConnectionState.Disconnected); }
  }
  const client = { Room, RoomEvent, ConnectionState, TrackEvent, Track: { Kind: { Video: 'video', Audio: 'audio' } },
    LogLevel: { silent: 5 }, AudioPresets: { speech: { maxBitrate: 20000 } },
    createLocalTracks: async options => {
      calls.captures.push(options);
      return acquire ? acquire(options, LocalTrack) : [new LocalTrack('video'), new LocalTrack('audio')];
    } };
  const native = { setLogLevel: level => calls.logLevels.push(level), registerGlobals: () => { calls.registrations += 1; },
    AudioSession: { startAudioSession: async () => { calls.starts += 1; await startAudio?.(); }, stopAudioSession: async () => { calls.stops += 1; } } };
  const webrtc = { RTCView: 'native-rtc-video' };
  const functions = Object.fromEntries(['getUserMedia', 'peerConnectionInit', 'mediaStreamTrackSetEnabled', 'audioDeviceModuleSetAutomaticAudioSessionConfiguration'].map(name => [name, () => {}]));
  if (partial) delete functions.audioDeviceModuleSetAutomaticAudioSessionConfiguration;
  const rn = { Platform: { OS: platform }, NativeModules: missing ? {} : { WebRTCModule: functions,
    LivekitReactNativeModule: { configureAudio() {}, startAudioSession() {}, stopAudioSession() {} } } };
  const requireSDK = name => {
    calls.requires.push(name); if (sdkThrows) throw new Error('incompatible binary');
    return name === 'livekit-client' ? client : name === '@livekit/react-native' ? native : webrtc;
  };
  const dependencies = { 'react-native': rn };
  for (const name of ['livekit-client', '@livekit/react-native', '@livekit/react-native-webrtc']) Object.defineProperty(dependencies, name, { get: () => requireSDK(name) });
  const api = compile('./transport.ts', dependencies, timers ? { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } : {});
  const preview = compile('./NativeLivePreview.tsx', {
    react: { useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'view', StyleSheet: { create: styles => styles, absoluteFillObject: { position: 'absolute' } } },
    './transport': api,
  });
  return { api, calls, client, preview, create: api.createNativeLiveTransport };
}
const connection = { url: 'wss://live.classfy.test', token: 'test-token-never-log', operationId: 'test-owner-op' };

test('cancelamento síncrono do snapshot connecting não abre conexão após fechar a Room inicial', async () => {
  for (const mode of ['disconnect', 'dispose']) {
    const h = harness(); const transport = h.create();
    await transport.prepare();
    let closing;
    const unsubscribe = transport.subscribe(snapshot => {
      if (snapshot.phase === 'connecting' && !closing) closing = transport[mode]();
    });
    await assert.rejects(transport.connectAndPublish(connection), { name: 'AbortError' });
    await closing; unsubscribe();
    assert.equal(h.calls.rooms.length, 1);
    assert.equal(h.calls.rooms[0].connection, undefined);
    assert.equal(h.calls.rooms[0].closes, 1);
    assert.equal(h.calls.publishes.length, 0);
    assert.ok(h.calls.tracks.every(track => track.stops > 0));
    assert.equal(h.calls.stops, 1);
    if (mode === 'disconnect') {
      await transport.prepare(); await transport.connectAndPublish(connection);
      assert.equal(h.calls.rooms.length, 2); assert.equal(h.calls.publishes.length, 2);
      await transport.dispose();
    } else await assert.rejects(transport.prepare(), { name: 'AbortError' });
  }
});

test('entry e prévia no Dev antigo não avaliam WebRTC/LiveKit nem pedem permissões', () => {
  const h = harness({ missing: true }); const transport = h.create();
  const startup = readFileSync(new URL('../../../index.js', import.meta.url), 'utf8');
  const ordered = [];
  new Function('require', startup)(name => {
    ordered.push(name);
    if (name === './src/features/live/transport') return h.api;
    assert.equal(name, 'expo-router/entry'); return {};
  });
  assert.deepEqual(ordered, ['./src/features/live/transport', 'expo-router/entry']);
  assert.equal(h.api.getNativeLiveAvailability().available, false);
  assert.match(h.api.getNativeLiveAvailability().reason, /Atualize/);
  assert.equal(h.preview.NativeLivePreview({ transport }).props.children, null);
  assert.deepEqual(h.calls.requires, []); assert.equal(h.calls.captures.length, 0); assert.equal(h.calls.rooms.length, 0);
});

test('binário parcial/áudio antigo e Web recebem motivo claro antes de qualquer import nativo', () => {
  for (const options of [{ partial: true }, { platform: 'web' }]) {
    const h = harness(options);
    assert.equal(h.api.initializeNativeLiveSDK().available, false); assert.ok(h.api.getNativeLiveAvailability().reason);
    assert.equal(h.api.getNativeLiveRTCView(), null); assert.deepEqual(h.calls.requires, []);
  }
});

test('falha ao carregar SDK fica indisponível e não reavalia módulo com erro no render', () => {
  const h = harness({ sdkThrows: true });
  assert.equal(h.api.initializeNativeLiveSDK().available, false);
  assert.equal(h.api.initializeNativeLiveSDK().available, false);
  assert.equal(h.api.getNativeLiveRTCView(), null); assert.equal(h.calls.requires.length, 1);
});

test('prepare tem câmera/mic privados reais, metadata efetiva e renderer sem conectar/publicar', async () => {
  const h = harness(); const transport = h.create(); const states = [];
  transport.subscribe(value => states.push(value));
  assert.equal(h.calls.starts, 0); assert.equal(h.calls.captures.length, 0);
  await transport.prepare({ facing: 'front', quality: '1080p' });
  assert.equal(h.calls.registrations, 1); assert.deepEqual(h.calls.logLevels, [5]);
  assert.equal(h.calls.starts, 1); assert.equal(h.calls.captures.length, 1);
  assert.equal(h.calls.rooms.length, 0); assert.equal(h.calls.publishes.length, 0);
  assert.equal(h.calls.captures[0].video.resolution.width, 1920);
  assert.deepEqual(transport.getSnapshot().capture, { width: 1280, height: 720, frameRate: 29.97 });
  assert.deepEqual(states.map(value => value.phase), ['preparing', 'preview']);
  const element = h.preview.NativeLivePreview({ transport });
  assert.equal(element.props.children.type, 'native-rtc-video');
  assert.equal(element.props.children.props.streamURL, 'private-video-1');
  assert.equal(element.props.children.props.mirror, true); assert.equal(element.props.children.props.objectFit, 'contain');
  assert.equal(h.calls.rooms.length, 0); await transport.dispose();
});

test('iniciar exige prepare, publica ambos tracks explicitamente e nunca põe credenciais no snapshot', async () => {
  const h = harness(); const transport = h.create();
  await assert.rejects(transport.connectAndPublish(connection), /Prepare/); assert.equal(h.calls.rooms.length, 0);
  await transport.prepare({ quality: '720p' }); await transport.connectAndPublish(connection);
  assert.equal(transport.getSnapshot().phase, 'publishing'); assert.equal(transport.getSnapshot().connectionState, 'connected');
  assert.deepEqual(h.calls.publishes.map(track => track.kind), ['video', 'audio']);
  assert.equal(h.calls.rooms[0].connection.options.autoSubscribe, false);
  assert.equal(h.calls.rooms[0].options.publishDefaults.videoEncoding.maxBitrate, 1_700_000);
  assert.equal(h.calls.rooms[0].options.publishDefaults.videoCodec, 'h264');
  assert.equal(JSON.stringify(transport.getSnapshot()).includes(connection.token), false);
  h.calls.rooms[0].emit(h.client.RoomEvent.ConnectionStateChanged, h.client.ConnectionState.Reconnecting);
  assert.equal(transport.getSnapshot().connectionState, 'reconnecting');
  h.calls.rooms[0].emit(h.client.RoomEvent.ConnectionStateChanged, h.client.ConnectionState.Connected);
  assert.equal(transport.getSnapshot().phase, 'publishing'); await transport.dispose();
});

test('flip e mute operam track nativo e atualizam preview sem outra Room', async () => {
  const h = harness(); const transport = h.create(); await transport.prepare();
  await transport.flipCamera(); assert.equal(transport.getSnapshot().facing, 'back');
  assert.equal(h.calls.tracks[0].restarts[0].facingMode, 'environment');
  assert.equal(transport.getSnapshot().streamURL, 'private-video-2');
  assert.equal(h.preview.NativeLivePreview({ transport }).props.children.props.mirror, false);
  await transport.setCameraEnabled(false); await transport.setMicrophoneEnabled(false);
  assert.equal(h.calls.tracks[0].isMuted, true); assert.equal(h.calls.tracks[1].isMuted, true);
  assert.equal(h.preview.NativeLivePreview({ transport }).props.children, null);
  await transport.setCameraEnabled(true); await transport.setMicrophoneEnabled(true);
  assert.equal(h.calls.tracks[0].isMuted, false); assert.equal(h.calls.tracks[1].isMuted, false);
  assert.equal(h.calls.rooms.length, 0); await transport.dispose();
});

test('permissão parcial rejeita e solta o único track e AudioSession, sem câmera privada órfã', async () => {
  const h = harness({ acquire: async (_options, Track) => [new Track('video')] });
  const transport = h.create(); await assert.rejects(transport.prepare(), /Permita/);
  assert.equal(h.calls.tracks[0].stops, 1); assert.equal(h.calls.stops, 1);
  assert.equal(transport.getSnapshot().videoTrack, null); assert.equal(transport.getSnapshot().phase, 'error');
  assert.equal(h.calls.rooms.length, 0);
  const other = h.create(); await assert.rejects(other.prepare(), /Permita/); assert.equal(h.calls.starts, 2);
  await transport.dispose(); await other.dispose();
});

test('dispose durante permissão/captura impede preview e encerra tracks recebidos depois', async () => {
  const permission = deferred(); const h = harness({ acquire: async (_options, Track) => { await permission.promise; return [new Track('video'), new Track('audio')]; } });
  const transport = h.create(); const preparing = transport.prepare(); await tick();
  const rejected = assert.rejects(preparing, error => error.name === 'AbortError');
  const closing = transport.dispose(); permission.resolve(); await rejected; await closing;
  assert.equal(h.calls.rooms.length, 0); assert.equal(h.calls.publishes.length, 0); assert.equal(h.calls.stops, 1);
  assert.ok(h.calls.tracks.every(track => track.stops > 0)); assert.equal(transport.getSnapshot().phase, 'disposed');
  await assert.rejects(transport.prepare(), error => error.name === 'AbortError');
  assert.equal(h.calls.captures.length, 1);
});

test('dispose durante início do áudio espera startup antigo, libera lease e não afeta novo owner', async () => {
  const audioStart = deferred(); let once = true;
  const h = harness({ startAudio: () => { if (once) { once = false; return audioStart.promise; } } });
  const first = h.create(); const second = h.create();
  const preparing = first.prepare(); await tick();
  const rejected = assert.rejects(preparing, error => error.name === 'AbortError'); const closing = first.dispose();
  await assert.rejects(second.prepare(), /outra prévia/);
  audioStart.resolve(); await rejected; await closing;
  assert.equal(h.calls.captures.length, 0); assert.equal(h.calls.stops, 1);
  await second.prepare(); assert.equal(second.getSnapshot().phase, 'preview');
  await first.dispose(); assert.equal(second.getSnapshot().phase, 'preview'); assert.equal(h.calls.stops, 1);
  await second.dispose(); assert.equal(h.calls.stops, 2);
});

test('dispose cancela conexão pendente antes da resposta e não publica depois', async () => {
  const join = deferred(); const h = harness({ connect: () => join.promise }); const transport = h.create();
  await transport.prepare(); const connecting = transport.connectAndPublish(connection); await tick();
  const rejected = assert.rejects(connecting, error => error.name === 'AbortError'); const closing = transport.dispose();
  assert.equal(h.calls.rooms[0].closes, 1); assert.ok(h.calls.tracks.every(track => track.stops > 0));
  join.resolve(); await rejected; await closing;
  assert.equal(h.calls.publishes.length, 0); assert.equal(h.calls.rooms[0].closes, 1); assert.equal(transport.getSnapshot().phase, 'disposed');
});

test('dispose entre os dois publishes impede o segundo, remove eventos velhos e solta todos recursos', async () => {
  const firstPublish = deferred(); const h = harness({ publishTrack: (_room, track) => track.kind === 'video' ? firstPublish.promise : undefined });
  const transport = h.create(); await transport.prepare(); const connecting = transport.connectAndPublish(connection); await tick();
  assert.equal(h.calls.publishes.length, 1);
  const rejected = assert.rejects(connecting, error => error.name === 'AbortError'); const closing = transport.dispose();
  firstPublish.resolve(); await rejected; await closing;
  h.calls.rooms[0].emit(h.client.RoomEvent.ConnectionStateChanged, h.client.ConnectionState.Connected);
  assert.equal(h.calls.publishes.length, 1); assert.equal(transport.getSnapshot().phase, 'disposed'); assert.equal(h.calls.stops, 1);
});

test('prazo total encerra connect pendente, libera recursos e resposta tardia não afeta nova transmissão', async () => {
  const timers = clock(); const oldJoin = deferred(); let first = true;
  const h = harness({ timers, connect: () => { if (first) { first = false; return oldJoin.promise; } } });
  const transport = h.create(); await transport.prepare(); const oldTracks = [...h.calls.tracks];
  const connecting = transport.connectAndPublish(connection); await tick();
  const rejected = assert.rejects(connecting, /demorou demais/);
  assert.equal(timers.calls[0].delay, 45_000);
  timers.advance(44_999); await tick();
  assert.equal(transport.getSnapshot().phase, 'connecting'); assert.equal(h.calls.rooms[0].closes, 0);
  timers.advance(1); await rejected;
  assert.equal(transport.getSnapshot().phase, 'idle'); assert.equal(transport.getSnapshot().videoTrack, null);
  assert.equal(h.calls.rooms[0].closes, 1); assert.ok(oldTracks.every(track => track.stops > 0));
  assert.equal(h.calls.publishes.length, 0); assert.equal(timers.pending, 0);
  // The original Room.connect is still unresolved. The enqueued cleanup must
  // nevertheless finish and allow this owner (or another one) to prepare again.
  await transport.prepare(); await transport.connectAndPublish(connection);
  const newTracks = h.calls.tracks.slice(2); const newRoom = h.calls.rooms[1];
  assert.equal(h.calls.stops, 1); assert.equal(h.calls.starts, 2);
  assert.equal(transport.getSnapshot().phase, 'publishing'); assert.equal(timers.pending, 0);
  const afterRetry = transport.getSnapshot();
  oldJoin.resolve(); await tick();
  h.calls.rooms[0].emit(h.client.RoomEvent.ConnectionStateChanged, h.client.ConnectionState.Disconnected);
  assert.equal(transport.getSnapshot(), afterRetry);
  assert.deepEqual(h.calls.publishes, newTracks); assert.equal(newRoom.closes, 0);
  assert.ok(newTracks.every(track => track.stops === 0));
  // Even an already queued callback from a cleared timer owns only its old op.
  timers.calls[0].callback(); timers.advance(45_000); await tick();
  assert.equal(transport.getSnapshot(), afterRetry); assert.equal(newRoom.closes, 0);
  await transport.dispose();
});

test('o mesmo prazo inclui publicação pendente e impede segundo track após conclusão tardia', async () => {
  const timers = clock(); const firstPublication = deferred();
  const h = harness({ timers, publishTrack: (_room, track) => track.kind === 'video' ? firstPublication.promise : undefined });
  const transport = h.create(); await transport.prepare();
  const connecting = transport.connectAndPublish(connection); await tick();
  assert.equal(h.calls.publishes.length, 1); assert.equal(h.calls.rooms[0].connection.options.autoSubscribe, false);
  const rejected = assert.rejects(connecting, /demorou demais/);
  timers.advance(45_000); await rejected;
  // No SDK resolution is required to release the command/AudioSession lease.
  await transport.disconnect();
  assert.equal(h.calls.stops, 1); assert.equal(transport.getSnapshot().phase, 'idle');
  assert.equal(h.calls.rooms[0].closes, 1); assert.ok(h.calls.tracks.every(track => track.stops > 0));
  const cancelled = transport.getSnapshot();
  firstPublication.resolve(); await tick();
  assert.equal(h.calls.publishes.length, 1); assert.equal(transport.getSnapshot(), cancelled);
  assert.equal(timers.pending, 0); await transport.dispose();
});

test('disconnect/dispose liberam connect pendente imediatamente e removem prazo sem esperar SDK', async () => {
  for (const mode of ['disconnect', 'dispose']) {
    const timers = clock(); const join = deferred(); const h = harness({ timers, connect: () => join.promise });
    const transport = h.create(); await transport.prepare();
    const connecting = transport.connectAndPublish(connection); await tick();
    const rejected = assert.rejects(connecting, { name: 'AbortError' });
    await transport[mode](); await rejected;
    assert.equal(h.calls.stops, 1); assert.equal(timers.pending, 0);
    assert.equal(h.calls.rooms[0].closes, 1); assert.equal(h.calls.publishes.length, 0);
    const cancelled = transport.getSnapshot(); timers.calls[0].callback(); join.resolve(); await tick();
    assert.equal(transport.getSnapshot(), cancelled); assert.equal(h.calls.publishes.length, 0);
    await transport.dispose();
  }
});

test('conexão e publicações usam um único prazo sem renovar após negociação', async () => {
  const timers = clock(); const join = deferred(); const publication = deferred();
  const h = harness({ timers, connect: () => join.promise, publishTrack: () => publication.promise });
  const transport = h.create(); await transport.prepare();
  const connecting = transport.connectAndPublish(connection); await tick();
  timers.advance(40_000); join.resolve(); await tick();
  assert.equal(h.calls.publishes.length, 1); assert.equal(timers.calls.length, 1);
  const rejected = assert.rejects(connecting, /demorou demais/);
  timers.advance(5_000); await rejected; await transport.disconnect();
  assert.equal(h.calls.stops, 1); assert.equal(h.calls.rooms[0].closes, 1);
  publication.resolve(); await tick(); assert.equal(h.calls.publishes.length, 1);
  await transport.dispose();
});

test('timeout no transporte real libera controlador sem criar ponte ou perder estado público já existente', async () => {
  const { createBroadcastController } = compile('./broadcastController.ts', {});
  for (const status of ['waiting', 'live']) {
    const timers = clock(); const joining = deferred(); const h = harness({ timers, connect: () => joining.promise });
    const transport = h.create(); let bridges = 0;
    const row = { id: 'deadline-live', creator_id: 'deadline-owner', status, livekit_egress_id: null, mux_live_stream_id: 'test-mux' };
    const controller = createBroadcastController({ owner: row.creator_id, liveId: row.id, transport, countdownSeconds: 0,
      backend: {
        getLive: async () => row, connectHost: async () => connection,
        startBridge: async () => { bridges += 1; }, syncLive: async () => ({ status }), endLive: async () => {},
      } });
    const unsubscribe = transport.subscribe(snapshot => {
      controller.connectionChanged(snapshot.connectionState);
      if (snapshot.phase === 'error') controller.captureInterrupted();
    });
    controller.updateLive(row); await controller.prepare();
    const starting = controller.start(); await tick();
    assert.equal(h.calls.rooms.length, 1); timers.advance(45_000);
    assert.equal(await starting, false);
    assert.equal(controller.getSnapshot().phase, 'interrupted');
    assert.equal(controller.getSnapshot().localPublishing, false);
    assert.equal(controller.getSnapshot().mayBeOnAir, status === 'live');
    assert.equal(bridges, 0); assert.equal(h.calls.stops, 1);
    // busy/ready are released before the abandoned connect future resolves.
    assert.equal(await controller.prepare(), true);
    const ready = controller.getSnapshot(); joining.resolve(); await tick();
    assert.equal(controller.getSnapshot(), ready); assert.equal(h.calls.publishes.length, 0);
    unsubscribe(); await controller.dispose();
  }
});

test('disconnect elimina câmera/mic e só prepare explícito inicia nova prévia, sem cleanup anterior desligá-la', async () => {
  const h = harness(); const transport = h.create(); await transport.prepare(); await transport.connectAndPublish(connection);
  const old = [...h.calls.tracks]; const closing = transport.disconnect(); const preparing = transport.prepare();
  await closing; await preparing;
  assert.ok(old.every(track => track.stops > 0)); assert.equal(h.calls.rooms[0].closes, 1);
  assert.equal(h.calls.starts, 2); assert.equal(h.calls.stops, 1); assert.equal(h.calls.captures.length, 2);
  assert.equal(transport.getSnapshot().phase, 'preview'); assert.equal(h.calls.rooms.length, 1);
  old[0].emit(h.client.TrackEvent.Ended); assert.equal(transport.getSnapshot().phase, 'preview');
  await transport.dispose();
});

test('cancelar flip em andamento encerra também câmera reaberta pelo SDK sem publicar estado tardio', async () => {
  const flip = deferred(); const h = harness({ restart: () => flip.promise }); const transport = h.create();
  await transport.prepare(); const switching = transport.flipCamera(); await tick();
  const rejected = assert.rejects(switching, error => error.name === 'AbortError'); const closing = transport.disconnect();
  flip.resolve(); await rejected; await closing;
  assert.equal(transport.getSnapshot().phase, 'idle'); assert.equal(transport.getSnapshot().videoTrack, null);
  assert.ok(h.calls.tracks[0].stops >= 2); assert.equal(h.calls.stops, 1);
});

test('erro SDK com URL/token não aparece no estado/erro público e prévia pode tentar de novo', async () => {
  let failing = true; const h = harness({ connect: () => { if (failing) throw new Error(`failed ${connection.url}?access_token=${connection.token}`); } });
  const transport = h.create(); await transport.prepare();
  await assert.rejects(transport.connectAndPublish(connection), error => !error.message.includes(connection.token) && /enviar o sinal/.test(error.message));
  assert.equal(JSON.stringify(transport.getSnapshot()).includes(connection.token), false);
  assert.equal(transport.getSnapshot().phase, 'preview'); assert.equal(h.calls.tracks[0].stops, 0);
  failing = false; await transport.connectAndPublish(connection); assert.equal(transport.getSnapshot().phase, 'publishing');
  await transport.dispose();
});

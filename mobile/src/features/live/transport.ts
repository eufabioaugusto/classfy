import { NativeModules, Platform } from 'react-native';
import type { ComponentType } from 'react';
import type { RTCVideoViewProps } from '@livekit/react-native-webrtc';
import type { LocalAudioTrack, LocalTrack, LocalVideoTrack, Room, VideoCaptureOptions } from 'livekit-client';

type LiveKitSDK = typeof import('@livekit/react-native');
type ClientSDK = typeof import('livekit-client');
type WebRTCSDK = typeof import('@livekit/react-native-webrtc');
type NativeLiveSDK = { native: LiveKitSDK; client: ClientSDK; webrtc: WebRTCSDK };
export type NativeLiveAvailability = { available: boolean; reason: string | null };
export type NativeLiveFacing = 'front' | 'back';
export type NativeLiveQuality = '720p' | '1080p';
export type NativeLiveConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export type NativeLiveSnapshot = {
  phase: 'idle' | 'preparing' | 'preview' | 'connecting' | 'publishing' | 'reconnecting' | 'error' | 'disposed';
  connectionState: NativeLiveConnectionState;
  facing: NativeLiveFacing;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  videoTrack: LocalVideoTrack | null;
  streamURL: string | null;
  capture: { width: number; height: number; frameRate: number | null } | null;
  error: string | null;
};
export type NativeLivePrepareOptions = { facing?: NativeLiveFacing; quality?: NativeLiveQuality };
export type NativeLiveConnection = { url: string; token: string; operationId?: string };
export type NativeLiveTransport = {
  getSnapshot(): NativeLiveSnapshot;
  subscribe(listener: (snapshot: NativeLiveSnapshot) => void): () => void;
  /** Obtains local camera/microphone only. Never creates/connects a Room. */
  prepare(options?: NativeLivePrepareOptions): Promise<void>;
  /** The only network entry point. Backend start/sync and on-air state belong to the controller. */
  connectAndPublish(connection: NativeLiveConnection): Promise<void>;
  flipCamera(): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  /** Releases tracks and audio. A later explicit prepare may acquire them again. */
  disconnect(): Promise<void>;
  /** Invalidates pending permissions/connect/publication and permanently closes this owner. */
  dispose(): Promise<void>;
};

const upgradeMessage = 'Atualize o Classfy Dev para transmitir diretamente pelo aplicativo.';
const connectionDeadlineMs = 45_000;
let sdk: NativeLiveSDK | null = null;
let registrationFailure = false;
// One camera/audio owner across controllers; a stale cleanup cannot deactivate
// the audio session started by a newer controller.
let captureOwner: symbol | null = null;

export function getNativeLiveAvailability(): NativeLiveAvailability {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return { available: false, reason: 'A transmissão nativa está disponível no aplicativo para celular.' };
  const rtc = NativeModules.WebRTCModule;
  const live = NativeModules.LivekitReactNativeModule;
  if (!rtc || !live || !['getUserMedia', 'peerConnectionInit', 'mediaStreamTrackSetEnabled'].every(name => typeof rtc[name] === 'function')
    || !['configureAudio', 'startAudioSession', 'stopAudioSession'].every(name => typeof live[name] === 'function')
    || Platform.OS === 'ios' && typeof rtc.audioDeviceModuleSetAutomaticAudioSessionConfiguration !== 'function') {
    return { available: false, reason: upgradeMessage };
  }
  return registrationFailure ? { available: false, reason: 'Não foi possível preparar a transmissão nativa. Abra novamente o aplicativo atualizado.' } : { available: true, reason: null };
}

/** Called at the app entry point, without requesting permissions or joining a room. */
export function initializeNativeLiveSDK(): NativeLiveAvailability {
  const availability = getNativeLiveAvailability();
  if (!availability.available || sdk) return availability;
  try {
    // Static, conditional require is intentional: Metro bundles the SDK, but an
    // old native binary never evaluates WebRTC/RTCView or its event emitters.
    const native: LiveKitSDK = require('@livekit/react-native');
    const client: ClientSDK = require('livekit-client');
    const webrtc: WebRTCSDK = require('@livekit/react-native-webrtc');
    native.setLogLevel(client.LogLevel.silent);
    native.registerGlobals();
    sdk = { native, client, webrtc };
    return availability;
  } catch {
    registrationFailure = true;
    return getNativeLiveAvailability();
  }
}
function requireLiveSDK(): NativeLiveSDK {
  const availability = initializeNativeLiveSDK();
  if (!availability.available || !sdk) throw new Error(availability.reason ?? upgradeMessage);
  return sdk;
}
/** Returns the official native renderer only after the binary gate succeeded. */
export function getNativeLiveRTCView(): ComponentType<RTCVideoViewProps> | null {
  return initializeNativeLiveSDK().available ? sdk?.webrtc.RTCView ?? null : null;
}
function aborted() { const error = new Error('A operação da live foi cancelada.'); error.name = 'AbortError'; return error; }
function captureError(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  return name === 'NotAllowedError' || name === 'SecurityError'
    ? 'Permita o acesso à câmera e ao microfone nos Ajustes para preparar sua live.'
    : name === 'NotFoundError' || name === 'NotReadableError'
      ? 'A câmera ou o microfone não está disponível. Feche outra gravação e tente novamente.'
      : 'Não foi possível preparar a câmera e o microfone. Confira as permissões e tente novamente.';
}
function videoOptions(facing: NativeLiveFacing, quality: NativeLiveQuality): VideoCaptureOptions {
  return { facingMode: facing === 'front' ? 'user' : 'environment', frameRate: 30,
    resolution: quality === '1080p' ? { width: 1920, height: 1080, frameRate: 30 } : { width: 1280, height: 720, frameRate: 30 } };
}
function localPreview(video: LocalVideoTrack | null) {
  const media = video?.mediaStream as unknown as { toURL?: () => string } | undefined;
  const streamURL = media?.toURL?.() || null;
  const settings = video?.getSourceTrackSettings();
  const width = settings?.width; const height = settings?.height;
  const frameRate = settings?.frameRate;
  return { videoTrack: video, streamURL, capture: typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0
    ? { width, height, frameRate: typeof frameRate === 'number' && frameRate > 0 ? frameRate : null } : null };
}

export function createNativeLiveTransport(): NativeLiveTransport {
  const owner = Symbol('Classfy native live');
  const listeners = new Set<(snapshot: NativeLiveSnapshot) => void>();
  let snapshot: NativeLiveSnapshot = { phase: 'idle', connectionState: 'disconnected', facing: 'front', cameraEnabled: true,
    microphoneEnabled: true, videoTrack: null, streamURL: null, capture: null, error: null };
  let generation = 0; let disposed = false;
  let work: Promise<unknown> = Promise.resolve();
  let quality: NativeLiveQuality = '1080p';
  let tracks: LocalTrack[] = []; let video: LocalVideoTrack | null = null; let audio: LocalAudioTrack | null = null;
  let room: Room | null = null; let audioStarted = false;
  let interruptConnection: (() => void) | null = null;
  let removeTrackEvents: (() => void) | null = null;
  let removeRoomEvents: (() => void) | null = null;
  const roomClosures = new WeakMap<Room, Promise<void>>();
  const publish = (patch: Partial<NativeLiveSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  };
  const current = (token: number) => !disposed && generation === token;
  const assertCurrent = (token: number) => { if (!current(token)) throw aborted(); };
  const enqueue = (task: (token: number) => Promise<void>) => {
    const token = generation;
    const next = work.catch(() => undefined).then(async () => { assertCurrent(token); await task(token); });
    work = next.catch(() => undefined);
    return next;
  };
  const stopTracks = (owned: LocalTrack[]) => { for (const track of owned) { try { track.stop(); } catch {} } };
  const closeRoom = (owned: Room | null) => {
    if (!owned) return Promise.resolve();
    let closing = roomClosures.get(owned);
    if (!closing) { closing = owned.disconnect(false).catch(() => undefined); roomClosures.set(owned, closing); }
    return closing;
  };
  const releaseMedia = async () => {
    removeTrackEvents?.(); removeTrackEvents = null;
    stopTracks(tracks); tracks = []; video = null; audio = null;
    if (audioStarted) {
      audioStarted = false;
      try { await sdk?.native.AudioSession.stopAudioSession(); } catch {}
    }
    if (captureOwner === owner) captureOwner = null;
  };
  const close = (permanent: boolean) => {
    if (permanent) disposed = true;
    generation += 1;
    // Release an enqueued connect/publication even when the SDK never settles.
    // Its late continuation still owns the previous generation and Room only.
    const interrupt = interruptConnection; interruptConnection = null; interrupt?.();
    removeRoomEvents?.(); removeRoomEvents = null;
    const ownedRoom = room; room = null;
    const networkClose = closeRoom(ownedRoom); // abort connect immediately, before waiting for queued SDK work
    removeTrackEvents?.(); removeTrackEvents = null;
    stopTracks(tracks);
    publish({ phase: disposed ? 'disposed' : 'idle', connectionState: 'disconnected', videoTrack: null, streamURL: null, capture: null, error: null });
    const cleanup = work.catch(() => undefined).then(async () => { await networkClose; await releaseMedia(); });
    work = cleanup;
    return cleanup;
  };
  const controls = (task: (token: number) => Promise<void>) => enqueue(async token => {
    if (!video || !audio) throw new Error('Prepare a câmera e o microfone antes de usar este controle.');
    try { await task(token); }
    catch (error) { if (!current(token)) throw aborted(); throw new Error(captureError(error)); }
  });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    prepare(options = {}) {
      return enqueue(async token => {
        const runtime = requireLiveSDK();
        if (tracks.length) return;
        if (captureOwner && captureOwner !== owner) throw new Error('Encerre a outra prévia de live antes de abrir a câmera.');
        captureOwner = owner;
        quality = options.quality ?? '1080p';
        const facing = options.facing ?? 'front';
        publish({ phase: 'preparing', facing, error: null });
        let acquired: LocalTrack[] = [];
        try {
          await runtime.native.AudioSession.startAudioSession(); audioStarted = true;
          assertCurrent(token);
          acquired = await runtime.client.createLocalTracks({ video: videoOptions(facing, quality),
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          assertCurrent(token);
          const camera = acquired.find(track => track.kind === runtime.client.Track.Kind.Video) as LocalVideoTrack | undefined;
          const microphone = acquired.find(track => track.kind === runtime.client.Track.Kind.Audio) as LocalAudioTrack | undefined;
          if (!camera || !microphone) throw Object.assign(new Error(), { name: 'SecurityError' });
          tracks = acquired; video = camera; audio = microphone;
          const refreshed = () => { if (current(token) && video === camera) publish(localPreview(camera)); };
          const ended = () => { if (current(token)) publish({ phase: 'error', error: 'A câmera ou o microfone foi interrompido. Prepare a live novamente.' }); };
          camera.on(runtime.client.TrackEvent.Restarted, refreshed);
          for (const track of acquired) track.on(runtime.client.TrackEvent.Ended, ended);
          removeTrackEvents = () => { camera.off(runtime.client.TrackEvent.Restarted, refreshed); for (const track of acquired) track.off(runtime.client.TrackEvent.Ended, ended); };
          if (!snapshot.cameraEnabled) await camera.mute();
          if (!snapshot.microphoneEnabled) await microphone.mute();
          assertCurrent(token);
          publish({ ...localPreview(camera), phase: 'preview', connectionState: 'disconnected', error: null });
        } catch (error) {
          stopTracks(acquired); await releaseMedia();
          if (!current(token)) throw aborted();
          const message = captureError(error); publish({ phase: 'error', ...localPreview(null), error: message }); throw new Error(message);
        }
      });
    },
    connectAndPublish(connection) {
      return enqueue(async token => {
        if (!video || !audio || !tracks.length) throw new Error('Prepare a câmera e o microfone antes de iniciar a transmissão.');
        if (room) throw new Error('Esta transmissão já está conectada ou em conexão.');
        const runtime = requireLiveSDK();
        let endpoint: URL;
        try { endpoint = new URL(connection.url); } catch { throw new Error('O servidor da live não está disponível. Tente novamente.'); }
        if (endpoint.protocol !== 'wss:' || !connection.token) throw new Error('A conexão segura da live não está disponível. Tente novamente.');
        const owned = new runtime.client.Room({ dynacast: true, adaptiveStream: true, stopLocalTrackOnUnpublish: false,
          publishDefaults: { videoCodec: 'h264', simulcast: true, videoEncoding: { maxBitrate: quality === '1080p' ? 3_000_000 : 1_700_000, maxFramerate: 30 },
            audioPreset: runtime.client.AudioPresets.speech, stopMicTrackOnMute: true } });
        room = owned;
        let published = false;
        const changed = (state: string) => {
          if (!current(token) || room !== owned) return;
          if (state === runtime.client.ConnectionState.Connecting) publish({ connectionState: 'connecting' });
          else if (state === runtime.client.ConnectionState.Reconnecting || state === runtime.client.ConnectionState.SignalReconnecting) publish({ connectionState: 'reconnecting', phase: 'reconnecting' });
          else if (state === runtime.client.ConnectionState.Connected) publish({ connectionState: 'connected', phase: published ? 'publishing' : 'connecting' });
          else if (state === runtime.client.ConnectionState.Disconnected) publish({ connectionState: 'disconnected', phase: 'error', error: 'A conexão da live foi interrompida. Confira sua internet.' });
        };
        owned.on(runtime.client.RoomEvent.ConnectionStateChanged, changed);
        removeRoomEvents = () => owned.off(runtime.client.RoomEvent.ConnectionStateChanged, changed);
        let expired = false;
        let interrupt!: () => void;
        const interrupted = new Promise<never>((_resolve, reject) => { interrupt = () => reject(aborted()); });
        interruptConnection = interrupt;
        const deadline = setTimeout(() => {
          if (!current(token) || interruptConnection !== interrupt) return;
          expired = true;
          // Never await close here: its cleanup waits for this enqueued command.
          // Stops capture immediately, then the race releases work for cleanup.
          void close(false);
        }, connectionDeadlineMs);
        const send = async () => {
          try {
            // A snapshot subscriber can cancel synchronously. Check again before
            // opening the socket: an earlier disconnect of an idle Room is a no-op.
            assertCurrent(token);
            await owned.connect(connection.url, connection.token, { autoSubscribe: false });
            assertCurrent(token);
            for (const track of tracks) {
              assertCurrent(token);
              await owned.localParticipant.publishTrack(track);
              assertCurrent(token);
            }
            published = true;
            publish({ phase: 'publishing', connectionState: 'connected', error: null });
          } catch {
            if (room === owned) { removeRoomEvents?.(); removeRoomEvents = null; room = null; }
            await closeRoom(owned);
            if (!current(token)) throw aborted();
            const message = 'Não foi possível enviar o sinal da live. Confira sua internet e tente novamente.';
            publish({ phase: 'preview', connectionState: 'disconnected', error: message }); throw new Error(message);
          }
        };
        try {
          publish({ phase: 'connecting', connectionState: 'connecting', error: null });
          await Promise.race([Promise.resolve().then(send), interrupted]);
        } catch (error) {
          if (expired) throw new Error('A conexão da live demorou demais. Ative a prévia e tente novamente.');
          throw error;
        } finally {
          clearTimeout(deadline);
          if (interruptConnection === interrupt) interruptConnection = null;
        }
      });
    },
    flipCamera() {
      return controls(async token => {
        const camera = video!; const facing = snapshot.facing === 'front' ? 'back' : 'front';
        await camera.restartTrack(videoOptions(facing, quality));
        assertCurrent(token);
        publish({ ...localPreview(camera), facing, error: null });
      });
    },
    setCameraEnabled(enabled) {
      return controls(async token => { const camera = video!; await (enabled ? camera.unmute() : camera.mute()); assertCurrent(token); publish({ ...localPreview(camera), cameraEnabled: enabled }); });
    },
    setMicrophoneEnabled(enabled) {
      return controls(async token => { const microphone = audio!; await (enabled ? microphone.unmute() : microphone.mute()); assertCurrent(token); publish({ microphoneEnabled: enabled }); });
    },
    disconnect: () => close(false),
    dispose: () => close(true),
  };
}

import { NativeModules } from 'react-native';
import type { LocalVideoTrack, Room } from 'livekit-client';
import type { MediaStream } from '@livekit/react-native-webrtc';
import { withLiveDeadline } from '@/features/live/request';
import { startStudioRemoteCameraPreviewAsync, stopStudioRemoteCameraPreviewAsync } from '../../../modules/classfy-studio-media';
import { reserveNativeCaptureForStudioCamera } from '@/features/live/transport';
import type { StudioCameraMonitorConnection } from './cameraMonitorProtocol';

export type StudioMonitorTransportState = { connected: boolean; reconnecting: boolean; viewerPresent: boolean };
export type StudioMonitorPreviewTransport = {
  connect(tag: number, sessionId: string, connection: StudioCameraMonitorConnection): Promise<void>;
  disconnect(): Promise<void>;
};
let monitorSDK: { client: typeof import('livekit-client'); rtc: typeof import('@livekit/react-native-webrtc'); native: typeof import('@livekit/react-native') } | null = null;
function sdk() { return monitorSDK ||= { client: require('livekit-client'), rtc: require('@livekit/react-native-webrtc'), native: require('@livekit/react-native') }; }

/** A branch of the already-open native view. Never acquires or controls media. */
export function createStudioMonitorPreviewTransport(onState: (state: StudioMonitorTransportState) => void): StudioMonitorPreviewTransport {
  let room: Room | null = null, stream: MediaStream | null = null, track: LocalVideoTrack | null = null;
  let nativeTag: number | null = null, disposed = false, published = false;
  let lease: ReturnType<typeof reserveNativeCaptureForStudioCamera> | null = null;
  let connection: Promise<void> | null = null;
  let removeListeners: (() => void) | null = null;
  const abort = new AbortController();
  const check = () => { if (disposed) throw Object.assign(new Error('O monitor foi encerrado.'), { name: 'AbortError' }); };
  async function release() {
    removeListeners?.(); removeListeners = null;
    const owned = room; room = null; published = false;
    try { if (owned) await withLiveDeadline(() => owned.disconnect(), undefined, 10_000); } catch {}
    track = null;
    const tag = nativeTag; nativeTag = null;
    if (tag !== null) await stopStudioRemoteCameraPreviewAsync(tag).catch(() => undefined);
    stream?.release(); stream = null;
    // The normal capture may still be writing audio. Closing its display branch
    // must not change AVAudioSession policy or route underneath MovieFileOutput.
    if (lease?.current()) lease.release();
    lease = null;
  }
  return {
    connect(tag, sessionId, credentials) {
      if (connection) return connection;
      connection = (async () => {
        try {
          check();
          const url = new URL(credentials.url);
          if (url.protocol !== 'wss:' || url.username || url.password) throw new Error('O monitor precisa de uma conexão privada segura.');
          const runtime = sdk();
          lease = reserveNativeCaptureForStudioCamera();
          runtime.native.registerGlobals({ autoConfigureAudioSession: false });
          runtime.client.setLogLevel(runtime.client.LogLevel.silent);
          NativeModules.WebRTCModule?.audioDeviceModuleSetAutomaticAudioSessionConfiguration?.(null);
          nativeTag = tag;
          const descriptor = await withLiveDeadline(() => startStudioRemoteCameraPreviewAsync(tag), abort.signal, 10_000); check();
          const ownedStream = new runtime.rtc.MediaStream(descriptor); stream = ownedStream;
          const media = ownedStream.getVideoTracks()[0];
          if (!media) throw new Error('A câmera não confirmou a pista da prévia.');
          track = new runtime.client.LocalVideoTrack(media as unknown as globalThis.MediaStreamTrack, {}, true);
          const owned = new runtime.client.Room({ adaptiveStream: false, dynacast: true, stopLocalTrackOnUnpublish: false });
          room = owned;
          const notify = () => {
            if (disposed || room !== owned) return;
            const viewerPresent = [...owned.remoteParticipants.values()].some(participant => participant.identity.startsWith(`studio-monitor-viewer-${sessionId}-`));
            onState({ connected: published && owned.state === 'connected', reconnecting: owned.state === 'reconnecting', viewerPresent });
          };
          const events = [runtime.client.RoomEvent.ConnectionStateChanged, runtime.client.RoomEvent.ParticipantConnected, runtime.client.RoomEvent.ParticipantDisconnected];
          events.forEach(event => owned.on(event, notify));
          removeListeners = () => events.forEach(event => owned.off(event, notify));
          await withLiveDeadline(() => owned.connect(credentials.url, credentials.token, { autoSubscribe: false }), abort.signal, 30_000); check();
          await withLiveDeadline(() => owned.localParticipant.publishTrack(track!, { source: runtime.client.Track.Source.Camera, videoCodec: 'h264', simulcast: false,
            videoEncoding: { maxBitrate: 6_000_000, maxFramerate: 30, priority: 'high' }, degradationPreference: 'maintain-framerate' }), abort.signal, 10_000); check();
          published = true; notify();
        } catch (cause) { await release(); throw cause; }
      })();
      return connection;
    },
    async disconnect() {
      disposed = true; abort.abort();
      await connection?.catch(() => undefined);
      await release();
    },
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioCameraMonitorResponse } from '../../../../shared/studio/cameraMonitor';
const transport = vi.hoisted(() => ({ rooms: [] as { options: unknown; listeners: Map<string, (...args: unknown[]) => void>; remoteParticipants: Map<string, unknown>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; localParticipant: { publishData: ReturnType<typeof vi.fn>; publishTrack: ReturnType<typeof vi.fn>; setCameraEnabled: ReturnType<typeof vi.fn>; setMicrophoneEnabled: ReturnType<typeof vi.fn> } }[] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('livekit-client', async importOriginal => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  return { ...actual, Room: class {
    listeners = new Map<string, (...args: unknown[]) => void>(); remoteParticipants = new Map<string, unknown>();
    localParticipant = { publishData: vi.fn(), publishTrack: vi.fn(), setCameraEnabled: vi.fn(), setMicrophoneEnabled: vi.fn() };
    connect = vi.fn(async () => undefined); disconnect = vi.fn(async () => undefined);
    constructor(options: unknown) { transport.rooms.push({ options, listeners: this.listeners, remoteParticipants: this.remoteParticipants, connect: this.connect, disconnect: this.disconnect, localParticipant: this.localParticipant }); }
    on(name: string, listener: (...args: unknown[]) => void) { this.listeners.set(name, listener); }
    removeAllListeners() { this.listeners.clear(); }
  } };
});
import { RoomEvent, Track } from 'livekit-client';
import { connectStudioCameraMonitorPreview } from './cameraMonitorViewer';
const response = () => ({ monitor: { id: 'session', deviceId: 'device' }, connection: { url: 'wss://fixture.livekit.cloud', token: 'fixture-token', identity: 'viewer' } }) as StudioCameraMonitorResponse;
const phone = { identity: 'studio-monitor-device-session-device' };
class Camera extends EventTarget { id = 'camera'; kind = 'video'; readyState = 'live'; muted = false; }
const publication = (kind: Track.Kind) => ({ kind, setSubscribed: vi.fn() });
beforeEach(() => { transport.rooms = []; });
afterEach(() => { vi.clearAllMocks(); });
describe('subscriber do monitor não tem comandos nem captura no computador', () => {
  it('assina somente vídeo da publicação mobile esperada e nunca publica mídia ou data', async () => {
    const getUserMedia = vi.fn(); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const callbacks = { track: vi.fn(), connection: vi.fn() }, signal = new AbortController(), preview = await connectStudioCameraMonitorPreview(response(), callbacks, signal.signal), room = transport.rooms[0];
    expect(room.connect).toHaveBeenCalledWith('wss://fixture.livekit.cloud', 'fixture-token', { autoSubscribe: false });
    const video = publication(Track.Kind.Video), audio = publication(Track.Kind.Audio), foreign = publication(Track.Kind.Video);
    room.listeners.get(RoomEvent.TrackPublished)!(video, phone); room.listeners.get(RoomEvent.TrackPublished)!(audio, phone); room.listeners.get(RoomEvent.TrackPublished)!(foreign, { identity: 'other' });
    expect(video.setSubscribed).toHaveBeenCalledWith(true); expect(audio.setSubscribed).toHaveBeenCalledWith(false); expect(foreign.setSubscribed).toHaveBeenCalledWith(false);
    const camera = new Camera(), hint = vi.fn(), track = { kind: Track.Kind.Video, mediaStreamTrack: camera, setPlayoutDelay: hint };
    room.listeners.get(RoomEvent.TrackSubscribed)!(track, video, phone); expect(hint).toHaveBeenCalledWith(0); expect(callbacks.track).toHaveBeenCalledWith(camera);
    expect(getUserMedia).not.toHaveBeenCalled(); for (const method of Object.values(room.localParticipant)) expect(method).not.toHaveBeenCalled(); expect(Object.keys(preview)).toEqual(['disconnect']);
    await preview.disconnect(); expect(room.disconnect).toHaveBeenCalledTimes(1); vi.unstubAllGlobals();
  });
  it('mute, desconexão e reconnect retiram frame antigo; track unmute pode voltar enquanto sessão é válida', async () => {
    const callbacks = { track: vi.fn(), connection: vi.fn() }, signal = new AbortController(), preview = await connectStudioCameraMonitorPreview(response(), callbacks, signal.signal), room = transport.rooms[0], camera = new Camera();
    room.listeners.get(RoomEvent.TrackSubscribed)!({ kind: Track.Kind.Video, mediaStreamTrack: camera, setPlayoutDelay: vi.fn() }, {}, phone);
    camera.dispatchEvent(new Event('mute')); expect(callbacks.track).toHaveBeenLastCalledWith(null); camera.dispatchEvent(new Event('unmute')); expect(callbacks.track).toHaveBeenLastCalledWith(camera);
    room.listeners.get(RoomEvent.Reconnecting)!(); expect(callbacks.track).toHaveBeenLastCalledWith(null); expect(callbacks.connection).toHaveBeenLastCalledWith('reconnecting');
    camera.muted = true; room.listeners.get(RoomEvent.Reconnected)!(); expect(callbacks.track).toHaveBeenLastCalledWith(null);
    room.listeners.get(RoomEvent.Disconnected)!(); expect(callbacks.track).toHaveBeenLastCalledWith(null); expect(callbacks.connection).toHaveBeenLastCalledWith('lost'); await preview.disconnect();
  });
  it('abort limpa listeners e ignora publicador ou callback atrasado', async () => {
    const callbacks = { track: vi.fn(), connection: vi.fn() }, signal = new AbortController(), preview = await connectStudioCameraMonitorPreview(response(), callbacks, signal.signal), room = transport.rooms[0], subscribed = room.listeners.get(RoomEvent.TrackSubscribed)!, camera = new Camera(), hint = vi.fn();
    subscribed({ kind: Track.Kind.Video, mediaStreamTrack: camera, setPlayoutDelay: hint }, {}, { identity: 'other' }); expect(hint).not.toHaveBeenCalled();
    signal.abort(); await preview.disconnect(); callbacks.track.mockClear(); subscribed({ kind: Track.Kind.Video, mediaStreamTrack: camera, setPlayoutDelay: hint }, {}, phone); expect(callbacks.track).not.toHaveBeenCalled(); expect(room.disconnect).toHaveBeenCalledTimes(1); expect(room.listeners.size).toBe(0);
  });
  it('unsubscribe da câmera antiga depois de uma troca não remove a nova imagem', async () => {
    const callbacks = { track: vi.fn(), connection: vi.fn() }, signal = new AbortController(), preview = await connectStudioCameraMonitorPreview(response(), callbacks, signal.signal), room = transport.rooms[0];
    const oldCamera = new Camera(), newCamera = new Camera(); newCamera.id = 'new-camera';
    const oldTrack = { kind: Track.Kind.Video, mediaStreamTrack: oldCamera, setPlayoutDelay: vi.fn() }, newTrack = { kind: Track.Kind.Video, mediaStreamTrack: newCamera, setPlayoutDelay: vi.fn() };
    room.listeners.get(RoomEvent.TrackSubscribed)!(oldTrack, {}, phone); room.listeners.get(RoomEvent.TrackSubscribed)!(newTrack, {}, phone); expect(callbacks.track).toHaveBeenLastCalledWith(newCamera);
    room.listeners.get(RoomEvent.TrackUnsubscribed)!(oldTrack, {}, phone); oldCamera.dispatchEvent(new Event('ended')); expect(callbacks.track).toHaveBeenLastCalledWith(newCamera);
    room.listeners.get(RoomEvent.TrackUnsubscribed)!(newTrack, {}, phone); expect(callbacks.track).toHaveBeenLastCalledWith(null); await preview.disconnect();
  });
});

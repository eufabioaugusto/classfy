import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioRemoteResponse } from '../../../../shared/studio/remoteCamera';
const transport = vi.hoisted(() => ({ rooms: [] as { options: unknown; listeners: Map<string, (...args: unknown[]) => void>; participants: Map<string, unknown>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('livekit-client', async importOriginal => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  return { ...actual, Room: class {
    listeners = new Map<string, (...args: unknown[]) => void>(); remoteParticipants = new Map<string, unknown>();
    connect = vi.fn(async () => undefined); disconnect = vi.fn(async () => undefined);
    constructor(options: unknown) { transport.rooms.push({ options, listeners: this.listeners, participants: this.remoteParticipants, connect: this.connect, disconnect: this.disconnect }); }
    on(name: string, listener: (...args: unknown[]) => void) { this.listeners.set(name, listener); }
    removeAllListeners() { this.listeners.clear(); }
  } };
});
import { RemoteVideoTrack, RoomEvent, Track } from 'livekit-client';
import { connectStudioRemotePreview } from './remoteCameraCapture';
const response = () => ({ session: { id: 'fixture-session', deviceId: 'fixture-device' }, connection: { url: 'wss://fixture.livekit.cloud', token: 'fixture-token', identity: 'fixture-controller' } }) as unknown as StudioRemoteResponse;
const phone = { identity: 'studio-device-fixture-session-fixture-device' };
const media = { id: 'fixture-camera', kind: 'video', enabled: true } as MediaStreamTrack;
const publication = (kind: Track.Kind) => ({ kind, setSubscribed: vi.fn() });
beforeEach(() => { transport.rooms = []; });
afterEach(() => vi.restoreAllMocks());
describe('prévia remota pede reprodução imediata somente da câmera pareada', () => {
  it('assina somente o vídeo do iPhone esperado e aplica zero delay pela API real do SDK', async () => {
    const callbacks = { track: vi.fn(), connection: vi.fn() }, signal = new AbortController();
    const preview = await connectStudioRemotePreview(response(), callbacks, signal.signal), room = transport.rooms[0];
    expect(room.options).toMatchObject({ adaptiveStream: false }); expect(room.connect).toHaveBeenCalledWith(response().connection!.url, response().connection!.token, { autoSubscribe: false });
    const video = publication(Track.Kind.Video), audio = publication(Track.Kind.Audio), unrelated = publication(Track.Kind.Video);
    room.listeners.get(RoomEvent.TrackPublished)!(video, phone); room.listeners.get(RoomEvent.TrackPublished)!(audio, phone); room.listeners.get(RoomEvent.TrackPublished)!(unrelated, { identity: 'another-participant' });
    expect(video.setSubscribed).toHaveBeenCalledWith(true); expect(audio.setSubscribed).toHaveBeenCalledWith(false); expect(unrelated.setSubscribed).toHaveBeenCalledWith(false);
    const receiver = { playoutDelayHint: .5 } as RTCRtpReceiver & { playoutDelayHint: number };
    const track = new RemoteVideoTrack(media, 'fixture-video', receiver);
    room.listeners.get(RoomEvent.TrackSubscribed)!(track, video, phone);
    expect(receiver.playoutDelayHint).toBe(0); expect(callbacks.track).toHaveBeenCalledWith(media);
    const foreignReceiver = { playoutDelayHint: .5 } as RTCRtpReceiver & { playoutDelayHint: number };
    room.listeners.get(RoomEvent.TrackSubscribed)!(new RemoteVideoTrack(media, 'foreign-video', foreignReceiver), unrelated, { identity: 'another-participant' });
    const audioTrack = { kind: Track.Kind.Audio, setPlayoutDelay: vi.fn(), mediaStreamTrack: media };
    room.listeners.get(RoomEvent.TrackSubscribed)!(audioTrack, audio, phone);
    expect(foreignReceiver.playoutDelayHint).toBe(.5); expect(audioTrack.setPlayoutDelay).not.toHaveBeenCalled(); expect(callbacks.track).toHaveBeenCalledTimes(1);
    await preview.disconnect(); expect(room.disconnect).toHaveBeenCalledTimes(1); expect(room.listeners.size).toBe(0);
  });
  it('browser sem hint continua exibindo câmera e cancelamento impede callbacks tardios', async () => {
    const callbacks = { track: vi.fn(), connection: vi.fn() }, signal = new AbortController();
    const preview = await connectStudioRemotePreview(response(), callbacks, signal.signal), room = transport.rooms[0], subscribed = room.listeners.get(RoomEvent.TrackSubscribed)!;
    const track = new RemoteVideoTrack(media, 'unsupported-hint-video', {} as RTCRtpReceiver);
    subscribed(track, {}, phone); expect(callbacks.track).toHaveBeenCalledWith(media);
    const rejectedHint = { kind: Track.Kind.Video, mediaStreamTrack: media, setPlayoutDelay: vi.fn(() => { throw new TypeError('Unsupported receiver hint'); }) };
    subscribed(rejectedHint, {}, phone); expect(callbacks.track).toHaveBeenCalledTimes(2);
    signal.abort(); await preview.disconnect(); callbacks.track.mockClear(); subscribed(track, {}, phone); expect(callbacks.track).not.toHaveBeenCalled(); expect(room.disconnect).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioRemoteResponse } from '../../../../shared/studio/remoteCamera';
const transport = vi.hoisted(() => ({ rooms: [] as { options: unknown; listeners: Map<string, (...args: unknown[]) => void>; participants: Map<string, unknown>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; localParticipant: { publishData: ReturnType<typeof vi.fn>; publishTrack: ReturnType<typeof vi.fn>; setCameraEnabled: ReturnType<typeof vi.fn>; setMicrophoneEnabled: ReturnType<typeof vi.fn> } }[] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('livekit-client', async importOriginal => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  return { ...actual, Room: class {
    listeners = new Map<string, (...args: unknown[]) => void>(); remoteParticipants = new Map<string, unknown>();
    localParticipant = { publishData: vi.fn(async () => undefined), publishTrack: vi.fn(async () => undefined), setCameraEnabled: vi.fn(async () => undefined), setMicrophoneEnabled: vi.fn(async () => undefined) };
    connect = vi.fn(async () => undefined); disconnect = vi.fn(async () => undefined);
    constructor(options: unknown) { transport.rooms.push({ options, listeners: this.listeners, participants: this.remoteParticipants, connect: this.connect, disconnect: this.disconnect, localParticipant: this.localParticipant }); }
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
beforeEach(() => { transport.rooms = []; vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers(); });
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

const CONTROL_TOPIC = 'classfy-studio-camera-control-v1', ACK_TOPIC = 'classfy-studio-camera-control-ack-v1';
const ADJUSTMENT_ID = '00000000-0000-4000-8000-000000000001', SECOND_ID = '00000000-0000-4000-8000-000000000002', UNKNOWN_ID = '00000000-0000-4000-8000-000000000003';
const packet = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const receipt = (id = ADJUSTMENT_ID, pro: unknown = { iso: 50, autoExposure: false }) => ({ v: 1, id, ok: true, state: { configurationConfirmed: true, pro } });
async function connected() {
  const callbacks = { track: vi.fn(), connection: vi.fn() }, signal = new AbortController(), preview = await connectStudioRemotePreview(response(), callbacks, signal.signal), room = transport.rooms[0];
  room.participants.set(phone.identity, phone);
  return { preview, room, callbacks, signal, data: room.listeners.get(RoomEvent.DataReceived)! };
}

describe('ajustes diretos da câmera pelo canal RTC autenticado', () => {
  it('envia comando confiável só ao iPhone pareado e recebe o estado físico sem HTTP nem publicação de mídia', async () => {
    const fetch = vi.fn(), getUserMedia = vi.fn(); vi.stubGlobal('fetch', fetch); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const { preview, room, data } = await connected(), patch = { pro: { autoExposure: false, iso: 50 } };
    const configured = preview.configure!(ADJUSTMENT_ID, patch), state = { configurationConfirmed: true, pro: { autoExposure: false, iso: 49.98, minISO: 49.98, maxISO: 2000 } };
    expect(room.localParticipant.publishData).toHaveBeenCalledTimes(1);
    const [payload, options] = room.localParticipant.publishData.mock.calls[0];
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({ v: 1, id: ADJUSTMENT_ID, patch });
    expect(options).toEqual({ reliable: true, topic: CONTROL_TOPIC, destinationIdentities: [phone.identity] });
    data(packet({ v: 1, id: ADJUSTMENT_ID, ok: true, state }), phone, undefined, ACK_TOPIC);
    await expect(configured).resolves.toEqual(state); expect(vi.getTimerCount()).toBe(0);
    expect(fetch).not.toHaveBeenCalled(); expect(getUserMedia).not.toHaveBeenCalled(); expect(room.localParticipant.publishTrack).not.toHaveBeenCalled(); expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled(); expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    await preview.disconnect();
  });

  it.each([
    ['outro participante', () => packet(receipt()), { identity: 'another-participant' }, ACK_TOPIC],
    ['publicador ausente', () => packet(receipt()), undefined, ACK_TOPIC],
    ['tópico incorreto', () => packet(receipt()), phone, CONTROL_TOPIC],
    ['ID desconhecido', () => packet(receipt(UNKNOWN_ID)), phone, ACK_TOPIC],
    ['versão incorreta', () => packet({ ...receipt(), v: 2 }), phone, ACK_TOPIC],
    ['ID inválido', () => packet({ ...receipt(), id: 123 }), phone, ACK_TOPIC],
    ['JSON malformado', () => new TextEncoder().encode('{broken'), phone, ACK_TOPIC],
    ['envelope nulo', () => packet(null), phone, ACK_TOPIC],
    ['estado ausente', () => packet({ ...receipt(), state: null }), phone, ACK_TOPIC],
    ['estado em array', () => packet({ ...receipt(), state: [] }), phone, ACK_TOPIC],
    ['configuração não confirmada', () => packet({ ...receipt(), state: { configurationConfirmed: false, pro: {} } }), phone, ACK_TOPIC],
    ['confirmação ausente', () => packet({ ...receipt(), state: { pro: {} } }), phone, ACK_TOPIC],
    ['Pro ausente', () => packet({ ...receipt(), state: { configurationConfirmed: true } }), phone, ACK_TOPIC],
    ['Pro nulo', () => packet(receipt(ADJUSTMENT_ID, null)), phone, ACK_TOPIC],
    ['Pro inválido', () => packet(receipt(ADJUSTMENT_ID, 'invalid')), phone, ACK_TOPIC],
    ['Pro em array', () => packet(receipt(ADJUSTMENT_ID, [])), phone, ACK_TOPIC],
    ['pacote acima de 16 KiB', () => new TextEncoder().encode(JSON.stringify(receipt()).padEnd(16385, ' ')), phone, ACK_TOPIC],
  ] as const)('ignora %s sem encerrar o ajuste legítimo', async (_title, encode, publisher, topic) => {
    const { preview, data } = await connected(), settled = vi.fn(), configured = preview.configure!(ADJUSTMENT_ID, { pro: { iso: 50 } });
    void configured.then(settled, settled); data(encode(), publisher, undefined, topic); await Promise.resolve(); expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(799); expect(settled).not.toHaveBeenCalled();
    data(packet(receipt()), phone, undefined, ACK_TOPIC); await expect(configured).resolves.toEqual(receipt().state); expect(vi.getTimerCount()).toBe(0); await preview.disconnect();
  });

  it('aceita ACK no limite de 16 KiB e correlaciona IDs distintos mesmo fora de ordem', async () => {
    const { preview, data } = await connected(), first = preview.configure!(ADJUSTMENT_ID, { pro: { iso: 50 } }), second = preview.configure!(SECOND_ID, { pro: { iso: 100 } });
    const secondReceipt = receipt(SECOND_ID, { iso: 100 }), firstReceipt = receipt(ADJUSTMENT_ID, { iso: 50 });
    data(new TextEncoder().encode(JSON.stringify(secondReceipt).padEnd(16384, ' ')), phone, undefined, ACK_TOPIC); await expect(second).resolves.toEqual(secondReceipt.state);
    data(packet(firstReceipt), phone, undefined, ACK_TOPIC); await expect(first).resolves.toEqual(firstReceipt.state); expect(vi.getTimerCount()).toBe(0); await preview.disconnect();
  });

  it('rejeita a falta de ACK em 800 ms para permitir fallback sem declarar aplicação', async () => {
    const { preview, data } = await connected(), configured = preview.configure!(ADJUSTMENT_ID, { pro: { iso: 50 } }), rejected = expect(configured).rejects.toMatchObject({ code: 'live_configuration_timeout' });
    await vi.advanceTimersByTimeAsync(800); await rejected; expect(vi.getTimerCount()).toBe(0);
    // The later ACK cannot resurrect a timed-out promise.
    data(packet(receipt()), phone, undefined, ACK_TOPIC); await preview.disconnect();
  });

  it('rejeita o erro real do iPhone e erro sem mensagem recebe texto útil', async () => {
    const { preview, data } = await connected(), first = preview.configure!(ADJUSTMENT_ID, { pro: { iso: 50 } }), failed = expect(first).rejects.toMatchObject({ code: 'live_configuration_failed', message: 'A lente recusou o ajuste.' });
    data(packet({ v: 1, id: ADJUSTMENT_ID, ok: false, error: 'A lente recusou o ajuste.' }), phone, undefined, ACK_TOPIC); await failed;
    const second = preview.configure!(SECOND_ID, { pro: { iso: 50 } }), malformedError = expect(second).rejects.toMatchObject({ code: 'live_configuration_failed', message: 'O iPhone não confirmou o ajuste direto.' });
    data(packet({ v: 1, id: SECOND_ID, ok: false, error: { internal: true } }), phone, undefined, ACK_TOPIC); await malformedError; expect(vi.getTimerCount()).toBe(0); await preview.disconnect();
  });

  it('erro de publicação rejeita imediatamente e limpa o prazo', async () => {
    const { preview, room } = await connected(), cause = new Error('O canal RTC está indisponível.'); room.localParticipant.publishData.mockRejectedValueOnce(cause);
    await expect(preview.configure!(ADJUSTMENT_ID, { pro: { iso: 50 } })).rejects.toBe(cause); expect(vi.getTimerCount()).toBe(0); await preview.disconnect();
  });

  it('sem participante pareado e comando acima de 8 KiB não publicam nada', async () => {
    const { preview, room } = await connected(); room.participants.clear(); await expect(preview.configure!(ADJUSTMENT_ID, { pro: { iso: 50 } })).rejects.toThrow('desconectada');
    room.participants.set(phone.identity, phone); await expect(preview.configure!(ADJUSTMENT_ID, { pro: { oversized: 'x'.repeat(8192) } })).rejects.toThrow('grande demais'); expect(room.localParticipant.publishData).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); await preview.disconnect();
  });

  it('ID duplicado não substitui a promessa original nem cria outro prazo', async () => {
    const { preview, room, data } = await connected(), original = preview.configure!(ADJUSTMENT_ID, { pro: { iso: 50 } });
    await expect(preview.configure!(ADJUSTMENT_ID, { pro: { iso: 100 } })).rejects.toThrow('em andamento'); expect(room.localParticipant.publishData).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
    data(packet(receipt()), phone, undefined, ACK_TOPIC); await expect(original).resolves.toEqual(receipt().state); expect(vi.getTimerCount()).toBe(0); await preview.disconnect();
  });

  it('ID inválido e ajustes fora de Pro/imagem não são publicados', async () => {
    const { preview, room } = await connected();
    await expect(preview.configure!('invalid-id', { pro: { iso: 50 } })).rejects.toThrow('inválido');
    await expect(preview.configure!(ADJUSTMENT_ID, {})).rejects.toThrow('inválido');
    await expect(preview.configure!(ADJUSTMENT_ID, { cameraFacing: 'front' })).rejects.toThrow('inválido');
    await expect(preview.configure!(ADJUSTMENT_ID, { fps: 60, pro: { iso: 50 } })).rejects.toThrow('inválido');
    expect(room.localParticipant.publishData).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); await preview.disconnect();
  });

  it('limita ajustes pendentes a 128 e cancelamento encerra todos os prazos', async () => {
    const { preview, room } = await connected(), pending = Array.from({ length: 128 }, (_, index) => preview.configure!(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, { pro: { iso: 50 } }).catch(cause => cause));
    await expect(preview.configure!('00000000-0000-4000-8000-000000000129', { pro: { iso: 100 } })).rejects.toThrow('em andamento'); expect(room.localParticipant.publishData).toHaveBeenCalledTimes(128); expect(vi.getTimerCount()).toBe(128);
    await preview.disconnect(); const failures = await Promise.all(pending); expect(failures.every(cause => cause instanceof DOMException && cause.name === 'AbortError')).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['disconnect', 'abort'] as const)('%s rejeita pendências, limpa listeners e ignora ACK tardio', async mode => {
    const { preview, room, data, signal } = await connected(), first = preview.configure!(ADJUSTMENT_ID, { pro: { iso: 50 } }), second = preview.configure!(SECOND_ID, { pro: { iso: 100 } });
    const rejectedFirst = expect(first).rejects.toMatchObject({ name: 'AbortError' }), rejectedSecond = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    if (mode === 'abort') signal.abort(); await preview.disconnect(); await rejectedFirst; await rejectedSecond;
    expect(room.disconnect).toHaveBeenCalledTimes(1); expect(room.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    data(packet(receipt()), phone, undefined, ACK_TOPIC); await expect(preview.configure!(ADJUSTMENT_ID, { pro: { iso: 50 } })).rejects.toThrow('desconectada'); expect(room.localParticipant.publishData).toHaveBeenCalledTimes(2);
  });

  it('desconexão sinalizada pelo SDK rejeita os ajustes sem esperar timeout', async () => {
    const { preview, room, callbacks } = await connected(), configured = preview.configure!(ADJUSTMENT_ID, { pro: { iso: 50 } }), settled = vi.fn();
    const completed = configured.then(state => settled(state), cause => settled(cause));
    try { room.listeners.get(RoomEvent.Disconnected)!(); await Promise.resolve(); expect(vi.getTimerCount()).toBe(0); await completed; expect(settled).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' })); expect(callbacks.connection).toHaveBeenCalledWith('disconnected'); }
    finally { await preview.disconnect(); await completed; }
  });
});

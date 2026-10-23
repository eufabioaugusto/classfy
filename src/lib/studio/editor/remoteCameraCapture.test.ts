import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioRemoteCommand, StudioRemoteDeviceState, StudioRemoteResponse, StudioRemoteTake } from '../../../../shared/studio/remoteCamera';
import type { StudioCaptureState } from './capture';
import { createStudioRemoteCapture, remoteStudioProfile, studioRemoteControllerId, validateStudioRemoteMaster, type StudioRemoteCaptureController, type StudioRemotePreviewFactory, type StudioRemoteView } from './remoteCameraCapture';
import { StudioRemoteCameraError, type StudioRemoteClient } from './remoteCameraClient';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
const NOW = Date.parse('2026-10-12T12:00:00Z');
const original = new Blob(['master-original'], { type: 'video/mp4' });
const metadata = { kind: 'video' as const, width: 3840, height: 2160, frameRate: 30, duration: 2, hasAudio: true, mimeType: 'video/mp4', warnings: [] };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Stream { constructor(public tracks: MediaStreamTrack[]) {} getVideoTracks() { return this.tracks; } getAudioTracks() { return []; } getTracks() { return this.tracks; } }
const track = { id: 'phone-preview', kind: 'video', stop: vi.fn(), getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }) } as unknown as MediaStreamTrack;
let controllers: StudioRemoteCaptureController[];
function fixture(paired = true, transferTimeoutMs = 500) {
  const data: StudioRemoteResponse = {
    session: { id: 'session-remote', projectId: null, kind: 'aula', title: 'Minha aula', status: paired ? 'ready' : 'pairing', controllerId: 'controller', deviceId: paired ? 'phone' : null, sequence: 0, activeTakeId: null, configuration: { resolution: '4k', fps: 30, cameraFacing: 'back' }, deviceState: paired ? { deviceName: 'iPhone de teste', width: 3840, height: 2160, fps: 30, capabilities: { resolutions: ['720p', '1080p', '2k', '4k'], frameRates: [24, 30] } } : null, createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 300_000).toISOString(), pairedAt: paired ? new Date(NOW).toISOString() : null, controllerSeenAt: null, deviceSeenAt: null, closedAt: null }, commands: [], takes: [], serverAt: new Date(NOW).toISOString(), pairing: { code: 'ABC123', expiresAt: new Date(NOW + 300_000).toISOString() },
  };
  let autoAck = true, upload = true, staleResume = false;
  const download = vi.fn(async () => original), inspect = vi.fn(async () => metadata), disconnect = vi.fn(async () => undefined);
  const request = vi.fn(async (body: Record<string, unknown>) => {
    data.serverAt = new Date(Date.now()).toISOString();
    if (body.action === 'create') data.session.controllerId = String(body.controllerId);
    if (body.action === 'connect') data.connection = { url: 'wss://fixture.livekit.cloud', token: 'fixture-private-room', identity: 'controller' };
    if (body.action === 'download') data.download = { url: 'https://fixture.supabase.co/storage/v1/object/sign/master', parts: [{ url: 'https://fixture.supabase.co/storage/v1/object/sign/master', index: 0, bytes: original.size }], bytes: original.size, mime: 'video/mp4', totalParts: 1, nextPartIndex: null, expiresAt: new Date(NOW + 300_000).toISOString() };
    if (body.action === 'command' && !data.commands.some(command => command.id === body.commandId)) {
      const payload = body.payload as Record<string, unknown>, command = { id: String(body.commandId), sequence: ++data.session.sequence, type: body.type as StudioRemoteCommand['type'], payload, status: autoAck ? 'applied' as const : 'pending' as const, createdAt: new Date(Date.now()).toISOString(), acknowledgedAt: autoAck ? new Date(Date.now()).toISOString() : null, result: body.type === 'start' ? { takeId: payload.takeId, startedAtServerMs: Date.now() } : body.type === 'resume_upload' ? { takeId: payload.takeId, uploadState: 'uploading', uploadResumedAtServerMs: Date.now() } : {} };
      data.commands.push(command);
      if (body.type === 'start') { data.session.activeTakeId = String(payload.takeId); data.session.status = autoAck ? 'recording' : 'starting'; data.takes.push({ id: String(payload.takeId), status: 'recording', metadata: null, createdAt: new Date(NOW).toISOString(), uploadedAt: null }); }
      if (body.type === 'stop' && autoAck) { data.session.status = 'ready'; const take = data.takes.find(item => item.id === payload.takeId); if (take) { take.status = upload ? 'uploaded' : 'uploading'; take.metadata = { bytes: original.size, mime: 'video/mp4', width: 3840, height: 2160, fps: 30, duration: 2 }; } }
      if (body.type === 'configure' && autoAck) { Object.assign(data.session.configuration, payload); data.session.deviceState = { ...data.session.deviceState, configuration: { ...data.session.configuration } }; }
      if (body.type === 'resume_upload' && autoAck && !staleResume) { data.session.deviceState = { ...data.session.deviceState, uploadTakeId: payload.takeId, uploadState: 'uploading', uploadError: null, uploadResumedAtServerMs: Date.now() }; const take = data.takes.find(item => item.id === payload.takeId); if (take) take.status = upload ? 'uploaded' : 'uploading'; }
    }
    return structuredClone(data);
  });
  const preview: StudioRemotePreviewFactory = vi.fn(async (_response, callbacks) => { callbacks.track(track); callbacks.connection('connected'); return { disconnect }; });
  const client = { request, download } as StudioRemoteClient;
  const controller = createStudioRemoteCapture({ owner: 'owner', kind: 'aula', client, preview, inspect, persist: false, commandTimeoutMs: 500, transferTimeoutMs }); controllers.push(controller);
  let state!: StudioCaptureState, remote!: StudioRemoteView;
  controller.subscribe(value => state = value); controller.subscribeRemote(value => remote = value);
  return { controller, client, request, download, inspect, preview, disconnect, data, state: () => state, remote: () => remote, pending() { autoAck = false; }, applied() { autoAck = true; }, uploading() { upload = false; }, uploaded() { upload = true; }, staleResume() { staleResume = true; } };
}
beforeEach(() => { controllers = []; localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubGlobal('MediaStream', Stream); });
afterEach(() => { controllers.forEach(controller => controller.dispose()); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('câmera remota preserva o original nativo e a autoridade do iPhone', () => {
  it('desconexão definitiva libera a sala e retoma a mesma sessão sem outro REC ou CREATE', async () => {
    const h = fixture(), callbacks: Parameters<StudioRemotePreviewFactory>[1][] = [];
    const connect = h.preview as ReturnType<typeof vi.fn>;
    connect.mockImplementation(async (_response, events) => { callbacks.push(events); events.track(track); events.connection('connected'); return { disconnect: h.disconnect }; });
    await h.controller.prepare(); const sessionId = h.controller.getEnvelope()!.session.id;
    callbacks[0].connection('disconnected');
    expect(h.remote().connection).toBe('reconnecting'); expect(h.state()).toMatchObject({ phase: 'preparing', stream: null });
    await vi.advanceTimersByTimeAsync(1001);
    expect(connect).toHaveBeenCalledTimes(2); expect(h.state().phase).toBe('ready'); expect(h.remote().connection).toBe('connected');
    callbacks[0].track(null); callbacks[0].connection('disconnected');
    expect(h.state().stream!.getVideoTracks()[0]).toBe(track); expect(h.remote().connection).toBe('connected');
    expect(h.controller.getEnvelope()!.session.id).toBe(sessionId); expect(h.request.mock.calls.filter(([body]) => body.action === 'create')).toHaveLength(1);
    expect(h.request.mock.calls.some(([body]) => body.action === 'command')).toBe(false);
  });
  it('Reconectar cancela factory que nunca responde, compartilha clique e ignora a sala tardia', async () => {
    const h = fixture(), pending = deferred<{ disconnect(): Promise<void> }>(), lateDisconnect = vi.fn(async () => undefined);
    let previous!: Parameters<StudioRemotePreviewFactory>[1], previousSignal!: AbortSignal;
    (h.preview as ReturnType<typeof vi.fn>).mockImplementationOnce((_response, events, signal) => { previous = events; previousSignal = signal; return pending.promise; });
    const opening = h.controller.prepare(); await vi.advanceTimersByTimeAsync(0);
    expect(h.state().phase).toBe('preparing'); expect(h.preview).toHaveBeenCalledTimes(1);
    const first = h.controller.reconnect(), second = h.controller.reconnect(); expect(first).toBe(second);
    await first; await opening;
    expect(previousSignal.aborted).toBe(true); expect(h.preview).toHaveBeenCalledTimes(2);
    expect(h.state().phase).toBe('ready'); expect(h.remote().connection).toBe('connected');
    pending.resolve({ disconnect: lateDisconnect }); await vi.advanceTimersByTimeAsync(0);
    previous.track(null); previous.connection('disconnected');
    expect(lateDisconnect).toHaveBeenCalledTimes(1); expect(h.state().stream!.getVideoTracks()[0]).toBe(track);
    expect(h.remote().connection).toBe('connected'); expect(h.request.mock.calls.filter(([body]) => body.action === 'create')).toHaveLength(1);
    expect(h.data.takes).toHaveLength(0); expect(h.request.mock.calls.some(([body]) => body.action === 'command')).toBe(false);
  });
  it('Reconectar supersede polling HTTP pendurado sem aguardar sua resposta ou adotar estado antigo', async () => {
    const h = fixture(), pending = deferred<StudioRemoteResponse>(); await h.controller.prepare();
    const stale = structuredClone(h.data); stale.session.status = 'closed';
    h.request.mockImplementationOnce(() => pending.promise); await vi.advanceTimersByTimeAsync(1001);
    await h.controller.reconnect();
    expect(h.preview).toHaveBeenCalledTimes(2); expect(h.remote().connection).toBe('connected');
    pending.resolve(stale); await vi.advanceTimersByTimeAsync(0);
    expect(h.controller.getEnvelope()!.session.status).toBe('ready'); expect(h.state().phase).toBe('ready');
    expect(h.request.mock.calls.some(([body]) => body.action === 'command')).toBe(false);
  });
  it('factory sem resposta tem prazo e o polling tenta nova prévia mantendo heartbeat e REC parado', async () => {
    const h = fixture(); let oldSignal!: AbortSignal;
    (h.preview as ReturnType<typeof vi.fn>).mockImplementationOnce((_response, _events, signal) => { oldSignal = signal; return new Promise(() => undefined); });
    const opening = h.controller.prepare(); await vi.advanceTimersByTimeAsync(15_001); await opening;
    expect(oldSignal.aborted).toBe(true); expect(h.remote().error).toContain('A prévia não respondeu');
    await vi.advanceTimersByTimeAsync(1001);
    expect(h.preview).toHaveBeenCalledTimes(2); expect(h.state().phase).toBe('ready');
    expect(h.request.mock.calls.filter(([body]) => body.action === 'heartbeat').length).toBeGreaterThan(1);
    expect(h.request.mock.calls.some(([body]) => body.action === 'command')).toBe(false);
  });
  it('Reconectar substitui sessão encerrada ociosa com o mesmo vínculo e preserva takes já enviados', async () => {
    const h = fixture(); await h.controller.prepare(); const controllerId = h.data.session.controllerId;
    h.data.takes.push({ id: 'saved-original', status: 'uploaded', metadata: null, createdAt: new Date(NOW).toISOString(), uploadedAt: new Date(NOW).toISOString() });
    h.data.session.status = 'closed'; const request = h.request.getMockImplementation()!;
    h.request.mockImplementation(async body => { if (body.action === 'create') h.data.session = { ...h.data.session, id: 'replacement-session', status: 'ready' }; return request(body); });
    await h.controller.reconnect();
    expect(h.controller.getEnvelope()!.session).toMatchObject({ id: 'replacement-session', controllerId }); expect(h.state().phase).toBe('ready');
    expect(h.request.mock.calls.filter(([body]) => body.action === 'create')).toHaveLength(2);
    expect(h.data.takes).toEqual([expect.objectContaining({ id: 'saved-original', status: 'uploaded' })]);
    expect(h.request.mock.calls.some(([body]) => ['unpair', 'close', 'command'].includes(String(body.action)))).toBe(false);
  });
  it('sessão encerrada com original pendente continua recuperável e Reconectar não cria outro projeto ou REC', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.remoteStart(); h.data.session.status = 'closed';
    await h.controller.reconnect();
    expect(h.state()).toMatchObject({ phase: 'error', pendingRecovery: true });
    expect(h.request.mock.calls.filter(([body]) => body.action === 'create')).toHaveLength(1);
    expect(h.data.takes).toHaveLength(1); expect(h.data.commands.filter(command => command.type === 'start')).toHaveLength(1);
    expect(h.request.mock.calls.some(([body]) => ['unpair', 'close'].includes(String(body.action)))).toBe(false);
  });
  it('reconectar após CREATE bloqueado repete a preparação e conecta sem gravar um take', async () => {
    const h = fixture();
    h.request.mockRejectedValueOnce(new StudioRemoteCameraError('Há um envio pausado no iPhone.', 'studio_camera_pending_upload'));
    await expect(h.controller.prepare()).rejects.toMatchObject({ code: 'studio_camera_pending_upload' });
    expect(h.controller.getEnvelope()).toBeNull(); expect(h.state().phase).toBe('error'); expect(h.preview).not.toHaveBeenCalled();

    await h.controller.reconnect();
    const creates = h.request.mock.calls.map(([body]) => body).filter(body => body.action === 'create');
    expect(creates).toHaveLength(2); expect(creates[1].controllerId).toBe(creates[0].controllerId);
    expect(h.request.mock.calls.some(([body]) => body.action === 'connect')).toBe(true);
    expect(h.preview).toHaveBeenCalledTimes(1); expect(h.state()).toMatchObject({ phase: 'ready', file: null }); expect(h.state().pendingRecovery).toBeFalsy();
    expect(h.remote().connection).toBe('connected'); expect(h.data.takes).toHaveLength(0);
    expect(h.request.mock.calls.some(([body]) => body.action === 'command')).toBe(false);
  });
  it('controller descartado não refaz CREATE nem publica estado ao reconectar', async () => {
    const h = fixture(), listener = vi.fn(), remoteListener = vi.fn();
    h.controller.subscribe(listener); h.controller.subscribeRemote(remoteListener);
    h.request.mockRejectedValueOnce(new StudioRemoteCameraError('Envio pausado.', 'studio_camera_pending_upload'));
    await expect(h.controller.prepare()).rejects.toThrow('Envio pausado'); h.controller.dispose();
    const requests = h.request.mock.calls.length, publications = listener.mock.calls.length, remotePublications = remoteListener.mock.calls.length;

    await expect(h.controller.reconnect()).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.request).toHaveBeenCalledTimes(requests); expect(h.preview).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(publications); expect(remoteListener).toHaveBeenCalledTimes(remotePublications);
    expect(h.controller.getEnvelope()).toBeNull(); expect(h.state().phase).toBe('idle');
  });
  it('reconexões compartilham CREATE pendente e descarte ignora sua resposta tardia', async () => {
    const h = fixture(), pending = deferred<StudioRemoteResponse>();
    h.request.mockRejectedValueOnce(new StudioRemoteCameraError('Envio pausado.', 'studio_camera_pending_upload'));
    await expect(h.controller.prepare()).rejects.toThrow('Envio pausado');
    h.request.mockImplementationOnce(() => pending.promise);
    const first = h.controller.reconnect().catch(error => error), second = h.controller.reconnect().catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.request.mock.calls.filter(([body]) => body.action === 'create')).toHaveLength(2);
    h.controller.dispose(); pending.resolve(structuredClone(h.data));
    expect(await first).toMatchObject({ name: 'AbortError' }); expect(await second).toMatchObject({ name: 'AbortError' });
    expect(h.controller.getEnvelope()).toBeNull(); expect(h.state()).toMatchObject({ phase: 'idle', stream: null, file: null });
    expect(h.preview).not.toHaveBeenCalled(); expect(h.request.mock.calls.some(([body]) => body.action === 'connect')).toBe(false);
  });
  it('construção não conecta nem abre câmera/microfone; pareamento permanece aguardando aparelho', async () => {
    const h = fixture(false); expect(h.request).not.toHaveBeenCalled(); expect(h.preview).not.toHaveBeenCalled();
    await h.controller.prepare(); expect(h.state().phase).toBe('preparing'); expect(h.remote()).toMatchObject({ connection: 'pairing', pairing: { code: 'ABC123' } }); expect(h.preview).not.toHaveBeenCalled();
    h.data.session.deviceId = 'phone'; h.data.session.status = 'ready'; h.data.session.deviceState = { width: 3840, height: 2160, fps: 30, configurationConfirmed: true }; await vi.advanceTimersByTimeAsync(1001);
    expect(h.preview).toHaveBeenCalledTimes(1); expect(h.state()).toMatchObject({ phase: 'ready', width: 3840, height: 2160 });
    expect(h.state().stream?.getVideoTracks()[0]).toBe(track); expect(h.state().stream?.getAudioTracks()).toEqual([]);
  });
  it('REC só inicia após ACK do evento nativo e mantém mesmo takeId/commandId no retry', async () => {
    const h = fixture(); await h.controller.prepare(); h.pending();
    const starting = h.controller.remoteStart(); const observed = starting.catch(error => error);
    await vi.advanceTimersByTimeAsync(600); expect(h.state().phase).toBe('error'); expect((await observed).message).toContain('confirmação');
    const first = h.data.commands[0]; expect(first.type).toBe('start'); expect(h.state().file).toBeNull();
    first.status = 'applied'; first.acknowledgedAt = new Date().toISOString();
    const retried = h.controller.remoteStart(); await vi.advanceTimersByTimeAsync(250); const result = await retried;
    expect(result.takeId).toBe(first.payload.takeId); expect(h.data.commands.filter(item => item.type === 'start')).toHaveLength(1); expect(h.state().phase).toBe('recording');
    const calls = h.request.mock.calls.map(([body]) => body).filter(body => body.action === 'command' && body.type === 'start'); expect(calls[1].commandId).toBe(calls[0].commandId);
  });
  it('STOP aguarda upload+download+inspeção; preview nunca vira file e retries não duplicam take', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.remoteStart();
    const receive = deferred<Blob>(); h.download.mockImplementation(() => receive.promise);
    const stop = h.controller.stop(); await vi.advanceTimersByTimeAsync(0); expect(h.state().phase).toBe('stopping'); expect(h.state().file).toBeNull(); expect(h.remote().transfer).toBe('downloading');
    receive.resolve(original); const file = await stop;
    expect(file.size).toBe(original.size); expect(h.inspect).toHaveBeenCalledTimes(1); expect(h.state()).toMatchObject({ phase: 'recorded', file, pendingRecovery: false, stream: null });
    expect(await h.controller.stop()).toBe(file); expect(h.download).toHaveBeenCalledTimes(1); expect(h.data.takes).toHaveLength(1);
  });
  it('upload pendente mantém recuperação e o retry compartilha STOP confirmado', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.remoteStart(); h.uploading();
    const stop = h.controller.stop().catch(error => error); await vi.advanceTimersByTimeAsync(650); expect((await stop).message).toContain('confirmação');
    expect(h.state()).toMatchObject({ phase: 'error', pendingRecovery: true, file: null });
    h.data.takes[0].status = 'uploaded'; const retry = h.controller.stop(); await vi.advanceTimersByTimeAsync(250); await retry;
    expect(h.data.commands.filter(item => item.type === 'stop')).toHaveLength(1); expect(h.state().phase).toBe('recorded');
  });
  it('retomar solicita ao iPhone o mesmo original, expõe causa real e salva sem repetir REC ou STOP', async () => {
    const h = fixture(); await h.controller.prepare(); const start = await h.controller.remoteStart(); h.uploading();
    h.data.session.deviceState = { ...h.data.session.deviceState, uploadTakeId: start.takeId, uploadState: 'paused', uploadError: 'Não foi possível preparar esta parte do original.' };
    await expect(h.controller.stop()).rejects.toThrow('Não foi possível preparar esta parte do original.');
    expect(h.remote()).toMatchObject({ transfer: 'retry', pendingTakeId: start.takeId });
    h.uploaded(); const first = h.controller.stop(), second = h.controller.stop(); await Promise.all([first, second]);
    const commands = h.data.commands;
    expect(commands.filter(command => command.type === 'start')).toHaveLength(1); expect(commands.filter(command => command.type === 'stop')).toHaveLength(1);
    expect(commands.filter(command => command.type === 'resume_upload')).toHaveLength(1); expect(commands.at(-1)!.payload).toEqual({ takeId: start.takeId });
    expect(h.download).toHaveBeenCalledTimes(1); expect(h.state()).toMatchObject({ phase: 'recorded', pendingRecovery: false });
  });
  it('ACK de retomada não trata pausa antiga como erro novo enquanto aguarda heartbeat do novo envio', async () => {
    const h = fixture(true, 2000); await h.controller.prepare(); const start = await h.controller.remoteStart(); h.uploading();
    h.data.session.deviceState = { ...h.data.session.deviceState, uploadTakeId: start.takeId, uploadState: 'paused', uploadError: 'Falha anterior.' };
    await expect(h.controller.stop()).rejects.toThrow('Falha anterior'); h.data.takes[0].status = 'failed'; h.staleResume();
    const retry = h.controller.stop(); await vi.advanceTimersByTimeAsync(200);
    expect(h.state()).toMatchObject({ phase: 'stopping', error: null }); expect(h.remote().transfer).toBe('uploading');
    const receipt = h.data.commands.find(command => command.type === 'resume_upload')!;
    h.data.session.deviceState = { ...h.data.session.deviceState, uploadState: 'uploading', uploadError: null, uploadResumedAtServerMs: receipt.result!.uploadResumedAtServerMs, uploadProgressBytes: 5 };
    await vi.advanceTimersByTimeAsync(400); expect(h.state().phase).toBe('stopping'); expect(h.remote()).toMatchObject({ transfer: 'uploading', transferBytes: 5, transferTotalBytes: original.size });
    h.data.takes[0].status = 'uploaded'; await vi.advanceTimersByTimeAsync(400); await retry; expect(h.state().phase).toBe('recorded');
  });
  it('uma nova pausa após ACK aparece com sua causa e a próxima retomada recebe outro commandId', async () => {
    const h = fixture(true, 2000); await h.controller.prepare(); const start = await h.controller.remoteStart(); h.uploading();
    h.data.session.deviceState = { ...h.data.session.deviceState, uploadTakeId: start.takeId, uploadState: 'paused', uploadError: 'Falha anterior.' };
    await expect(h.controller.stop()).rejects.toThrow('Falha anterior');
    const retry = h.controller.stop().catch(error => error); await vi.advanceTimersByTimeAsync(0);
    expect(h.remote().transfer).toBe('uploading'); h.data.session.deviceState!.uploadState = 'paused'; h.data.session.deviceState!.uploadError = 'Sem conexão para enviar a parte 2.';
    await vi.advanceTimersByTimeAsync(400); expect((await retry).message).toContain('Sem conexão para enviar a parte 2.');
    h.uploaded(); const recovered = h.controller.stop(); await vi.advanceTimersByTimeAsync(200); await recovered;
    const resumes = h.data.commands.filter(command => command.type === 'resume_upload'); expect(resumes).toHaveLength(2); expect(resumes[0].id).not.toBe(resumes[1].id); expect(h.data.takes).toHaveLength(1);
  });
  it('ACK perdido da retomada repete o mesmo commandId e recebe original quando confirmação chega', async () => {
    const h = fixture(true, 2000); await h.controller.prepare(); const start = await h.controller.remoteStart(); h.uploading();
    h.data.session.deviceState = { ...h.data.session.deviceState, uploadTakeId: start.takeId, uploadState: 'paused', uploadError: 'Envio interrompido.' };
    await expect(h.controller.stop()).rejects.toThrow('Envio interrompido'); h.pending();
    const missingAck = h.controller.stop().catch(error => error); await vi.advanceTimersByTimeAsync(600); expect((await missingAck).code).toBe('ack_timeout');
    const receipt = h.data.commands.find(command => command.type === 'resume_upload')!;
    const retry = h.controller.stop(); await vi.advanceTimersByTimeAsync(0);
    const calls = h.request.mock.calls.map(([body]) => body).filter(body => body.type === 'resume_upload'); expect(calls).toHaveLength(2); expect(calls[0].commandId).toBe(calls[1].commandId);
    receipt.status = 'applied'; h.data.takes[0].status = 'uploaded'; await vi.advanceTimersByTimeAsync(400); await retry;
    expect(h.state()).toMatchObject({ phase: 'recorded', pendingRecovery: false }); expect(h.data.commands.filter(command => command.type === 'resume_upload')).toHaveLength(1);
  });
  it('ACK failed durante preparação libera outra intenção de Retomar sem repetir REC ou STOP', async () => {
    const h = fixture(true, 2000); await h.controller.prepare(); const start = await h.controller.remoteStart(); h.uploading();
    h.data.session.deviceState = { ...h.data.session.deviceState, uploadTakeId: start.takeId, uploadState: 'paused', uploadError: 'Preparação de imagem pausada.' };
    await expect(h.controller.stop()).rejects.toThrow('Preparação de imagem pausada'); h.pending();
    const failed = h.controller.stop().catch(error => error); await vi.advanceTimersByTimeAsync(0);
    const first = h.data.commands.find(command => command.type === 'resume_upload')!; first.status = 'failed'; first.result = { ok: false, error: 'Encoder temporariamente indisponível.' };
    await vi.advanceTimersByTimeAsync(600); expect(await failed).toMatchObject({ code: 'command_failed', message: 'Encoder temporariamente indisponível.' });
    const recovered = h.controller.stop(); await vi.advanceTimersByTimeAsync(0);
    const resumes = h.data.commands.filter(command => command.type === 'resume_upload'); expect(resumes).toHaveLength(2); expect(resumes[1].id).not.toBe(first.id);
    resumes[1].status = 'applied'; h.data.takes[0].status = 'uploaded'; await vi.advanceTimersByTimeAsync(600); await recovered;
    expect(h.state()).toMatchObject({ phase: 'recorded', pendingRecovery: false }); expect(h.download).toHaveBeenCalledTimes(1); expect(h.data.takes).toHaveLength(1);
    expect(h.data.commands.filter(command => command.type === 'start')).toHaveLength(1); expect(h.data.commands.filter(command => command.type === 'stop')).toHaveLength(1);
  });
  it('cancelamento invalida download tardio e enfileira STOP sem encerrar original pendente', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.remoteStart(); const pending = deferred<Blob>(); h.download.mockImplementation(() => pending.promise);
    const stopped = h.controller.stop().catch(error => error); await vi.advanceTimersByTimeAsync(0); h.controller.cancel(); pending.resolve(original);
    expect(await stopped).toMatchObject({ name: 'AbortError' }); expect(h.state()).toMatchObject({ phase: 'idle', file: null });
    expect(h.request.mock.calls.some(([body]) => body.action === 'close')).toBe(false); expect(h.request.mock.calls.filter(([body]) => body.action === 'command' && body.type === 'stop').every(([body]) => (body.payload as Record<string, unknown>)?.takeId === h.data.takes[0].id)).toBe(true); expect(track.stop).not.toHaveBeenCalled();
  });
  it('payloads de resolução e Pro usam comandos nativos, sem aplicar constraints na prévia', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.configureVideo({ output: { width: 2560, height: 1440, frameRate: 24 } });
    expect(h.data.commands[0].payload).toEqual({ resolution: '2k', fps: 24 });
    await h.controller.configureRemote({ pro: { autoWhiteBalance: false, temperatureKelvin: 5600 } }); expect(h.data.commands[1].payload).toEqual({ pro: { autoWhiteBalance: false, temperatureKelvin: 5600 } });
    await expect(h.controller.configureVideo({ grade: { exposure: 1 } })).rejects.toThrow('controles Pro');
    expect(h.state().videoControls?.effects).toBe(false);
  });
  it('microfone não confirmado no app novo impede reservar um take na nuvem', async () => {
    const usb = { id: 'USB-Audio-1', name: 'Microfone USB', type: 'USBAudio' }, builtin = { id: 'BuiltInMic', name: 'Microfone do iPhone', type: 'MicrophoneBuiltIn' };
    for (const patch of [{ selecting: true }, { confirmed: false }, { current: null }, { current: builtin }]) {
      const h = fixture(); h.data.session.deviceState!.capabilities!.audioInputSelection = true;
      h.data.session.deviceState!.audioInput = { version: 1, available: [usb, builtin], preferredId: usb.id, current: usb, confirmed: true, selecting: false, warning: 'Confirme o microfone antes de gravar.', ...patch };
      await h.controller.prepare(); await expect(h.controller.remoteStart()).rejects.toMatchObject({ code: 'audio_input_unconfirmed', message: 'Confirme o microfone antes de gravar.' });
      expect(h.data.takes).toHaveLength(0); expect(h.data.commands.filter(value => value.type === 'start')).toHaveLength(0); expect(h.remote().pendingTakeId).toBeNull();
    }
  });
  it('Auto com USB confirmado permite REC e troca nativa mantém UID até ACK', async () => {
    const usb = { id: 'USB-Audio-1', name: 'Microfone USB', type: 'USBAudio' }, h = fixture();
    h.data.session.deviceState!.capabilities!.audioInputSelection = true; h.data.session.deviceState!.audioInput = { version: 1, available: [usb], preferredId: null, current: usb, confirmed: true, selecting: false, warning: null };
    await h.controller.prepare(); await h.controller.configureRemote({ audioInputId: usb.id }); expect(h.data.commands[0].payload).toEqual({ audioInputId: usb.id });
    await h.controller.remoteStart(); expect(h.data.takes).toHaveLength(1);
  });
  it('seleção de microfone pendente impede REC mesmo após timeout, sem reservar take usando rota antiga', async () => {
    const h = fixture(); await h.controller.prepare(); h.pending();
    const configuring = h.controller.configureRemote({ audioInputId: 'USB-Audio-1' }).catch(error => error);
    await expect(h.controller.remoteStart()).rejects.toMatchObject({ code: 'configuration_pending' });
    await vi.advanceTimersByTimeAsync(600); expect((await configuring).code).toBe('ack_timeout'); expect(h.state().videoControls?.busy).toBe(true);
    await expect(h.controller.remoteStart()).rejects.toMatchObject({ code: 'configuration_pending' });
    expect(h.data.takes).toHaveLength(0); expect(h.data.commands.filter(value => value.type === 'start')).toHaveLength(0); expect(h.remote().pendingTakeId).toBeNull();
    h.data.commands[0].status = 'applied'; await h.controller.reconnect(); expect(h.state().videoControls?.busy).toBe(false);
  });
  it('arrastes rápidos conservam o último ISO e outro controle sem comandos simultâneos ou REC prematuro', async () => {
    const h = fixture(); await h.controller.prepare(); h.pending();
    const first = h.controller.configureRemote({ pro: { autoExposure: false, iso: 200 } });
    await vi.advanceTimersByTimeAsync(0);
    const middle = h.controller.configureRemote({ pro: { autoExposure: false, iso: 80 } });
    const balance = h.controller.configureRemote({ pro: { autoWhiteBalance: false, temperatureKelvin: 5900 } });
    const endpoint = h.controller.configureRemote({ pro: { autoExposure: false, iso: 20 } });
    expect(h.data.commands.filter(item => item.type === 'configure')).toHaveLength(1);
    await expect(h.controller.remoteStart()).rejects.toMatchObject({ code: 'configuration_pending' });
    h.data.commands[0].status = 'applied'; h.applied();
    await vi.advanceTimersByTimeAsync(210); await Promise.all([first, middle, balance, endpoint]);
    const changes = h.data.commands.filter(item => item.type === 'configure');
    expect(changes).toHaveLength(2); expect(changes[1].payload).toEqual({ pro: { autoExposure: false, iso: 20, autoWhiteBalance: false, temperatureKelvin: 5900 } });
    expect(h.state().videoControls?.busy).toBe(false); expect(h.preview).toHaveBeenCalledTimes(1); expect(h.disconnect).not.toHaveBeenCalled();
    expect(h.data.commands.filter(item => item.type === 'start')).toHaveLength(0);
  });
  it('Auto escolhido durante um ajuste remove valores manuais da fila antes de enviar', async () => {
    const h = fixture(); await h.controller.prepare(); h.pending();
    const first = h.controller.configureRemote({ pro: { autoExposure: false, iso: 200 } }); await vi.advanceTimersByTimeAsync(0);
    const manual = h.controller.configureRemote({ pro: { autoExposure: false, iso: 20, shutterSeconds: 1 / 60 } });
    const automatic = h.controller.configureRemote({ pro: { autoExposure: true } });
    h.data.commands[0].status = 'applied'; h.applied(); await vi.advanceTimersByTimeAsync(210); await Promise.all([first, manual, automatic]);
    expect(h.data.commands[1].payload).toEqual({ pro: { autoExposure: true } });
  });
  it('falha no ajuste rejeita também os arrastes seguintes e permite repetir exatamente o mesmo valor', async () => {
    const h = fixture(); await h.controller.prepare(); h.pending();
    const first = h.controller.configureRemote({ pro: { iso: 200 } }).catch(error => error); await vi.advanceTimersByTimeAsync(0);
    const final = h.controller.configureRemote({ pro: { iso: 20 } }).catch(error => error);
    h.data.commands[0].status = 'failed'; h.data.commands[0].result = { error: 'Ajuste recusado pelo sensor.' };
    await vi.advanceTimersByTimeAsync(210);
    expect((await first).message).toContain('sensor'); expect((await final).message).toContain('sensor'); expect(h.data.commands).toHaveLength(1);
    h.applied(); await h.controller.configureRemote({ pro: { iso: 20 } });
    expect(h.data.commands[1].payload).toEqual({ pro: { iso: 20 } }); expect(h.state().videoControls?.busy).toBe(false);
  });
  it('cancelamento rejeita a fila, ignora ACK atrasado e não altera a próxima sessão', async () => {
    const h = fixture(); await h.controller.prepare(); h.pending();
    const first = h.controller.configureRemote({ pro: { iso: 200 } }).catch(error => error); await vi.advanceTimersByTimeAsync(0);
    const final = h.controller.configureRemote({ pro: { iso: 20 } }).catch(error => error);
    h.controller.cancel(); expect(await final).toMatchObject({ name: 'AbortError' }); expect(await first).toMatchObject({ name: 'AbortError' });
    h.data.commands[0].status = 'applied'; h.applied(); await h.controller.prepare(); await h.controller.configureRemote({ pro: { iso: 40 } });
    expect(h.data.commands.filter(item => item.type === 'configure').map(item => item.payload)).toEqual([{ pro: { iso: 200 } }, { pro: { iso: 40 } }]);
    expect(h.state().videoControls?.busy).toBe(false);
  });
  it('ACK recebido pelo status conclui o ajuste sem mais 200 ms de espera', async () => {
    const h = fixture(); await h.controller.prepare(); h.pending();
    const request = h.request.getMockImplementation()!;
    h.request.mockImplementation(async body => {
      if (body.action === 'status' && h.data.commands.length) h.data.commands.at(-1)!.status = 'applied';
      return request(body);
    });
    const startedAt = Date.now(); await h.controller.configureRemote({ pro: { iso: 20 } });
    expect(Date.now()).toBe(startedAt); expect(h.state().videoControls?.busy).toBe(false);
  });
  it('resposta antiga no mesmo sequence não desfaz recibo aplicado nem o ISO confirmado', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.configureRemote({ pro: { iso: 20 } });
    const old = structuredClone(h.data); old.commands[0].status = 'pending'; old.session.deviceState = { ...old.session.deviceState, configuration: { ...old.session.configuration, pro: { iso: 200 } } };
    h.request.mockResolvedValueOnce(old); await h.controller.reconnect();
    expect(h.controller.getEnvelope()!.commands[0].status).toBe('applied'); expect(h.remote().session!.deviceState!.configuration!.pro).toEqual({ iso: 20 });
    expect(h.state().videoControls?.busy).toBe(false);
  });
  it('POST aceito com resposta perdida conserva pendência até o ACK tardio, sem outro ajuste ou REC', async () => {
    const h = fixture(); await h.controller.prepare(); h.pending(); const request = h.request.getMockImplementation()!;
    h.request.mockImplementationOnce(async body => { await request(body); throw new StudioRemoteCameraError('Resposta perdida.', 'transport'); });
    await expect(h.controller.configureRemote({ pro: { iso: 20 } })).rejects.toThrow('Resposta perdida');
    expect(h.state().videoControls?.busy).toBe(true);
    await expect(h.controller.configureRemote({ pro: { iso: 30 } })).rejects.toMatchObject({ code: 'configuration_pending' });
    await expect(h.controller.remoteStart()).rejects.toMatchObject({ code: 'configuration_pending' }); expect(h.data.commands).toHaveLength(1);
    h.data.commands[0].status = 'applied'; await h.controller.reconnect(); expect(h.state().videoControls?.busy).toBe(false);
    expect(h.data.commands.filter(command => command.type === 'start')).toHaveLength(0);
  });
  it('POST perdido antes de chegar ao servidor repete o mesmo UUID e alvo ao reconciliar', async () => {
    const h = fixture(); await h.controller.prepare();
    h.request.mockRejectedValueOnce(new StudioRemoteCameraError('Conexão interrompida.', 'transport'));
    await expect(h.controller.configureRemote({ pro: { iso: 20 } })).rejects.toThrow('Conexão interrompida');
    const first = h.request.mock.calls.at(-1)![0]; expect(h.state().videoControls?.busy).toBe(true); expect(h.data.commands).toHaveLength(0);
    await h.controller.reconnect(); const changes = h.request.mock.calls.map(([body]) => body).filter(body => body.action === 'command');
    expect(changes).toHaveLength(2); expect(changes[1]).toMatchObject({ commandId: first.commandId, payload: { pro: { iso: 20 } } });
    expect(h.data.commands).toHaveLength(1); expect(h.state().videoControls?.busy).toBe(false);
  });
  it('ACK direto atualiza ISO antes do servidor, conserva último desejo e bloqueia REC até escrita durável', async () => {
    const h = fixture(); h.data.session.deviceState!.capabilities!.liveControls = 1; h.data.session.deviceState!.pro = { iso: 100 };
    const fast = vi.fn(async (id: string, patch: Record<string, unknown>) => ({ configurationConfirmed: true, liveConfigurationId: id, configuration: { ...h.data.session.configuration, ...patch }, pro: patch.pro as Record<string, unknown> }));
    vi.mocked(h.preview).mockImplementation(async (_response, callbacks) => { callbacks.track(track); callbacks.connection('connected'); return { disconnect: h.disconnect, configure: fast }; });
    await h.controller.prepare(); h.pending();
    const first = h.controller.configureRemote({ pro: { autoExposure: false, iso: 20 } }); await vi.advanceTimersByTimeAsync(0);
    expect(h.remote().session!.deviceState!.pro!.iso).toBe(20); expect(h.data.session.deviceState!.pro!.iso).toBe(100);
    expect(h.state().videoControls?.busy).toBe(true); await expect(h.controller.remoteStart()).rejects.toMatchObject({ code: 'configuration_pending' });
    const second = h.controller.configureRemote({ pro: { iso: 80 } }); await vi.advanceTimersByTimeAsync(0);
    expect(h.remote().session!.deviceState!.pro!.iso).toBe(80);
    expect(fast).toHaveBeenLastCalledWith(expect.any(String), { pro: { autoExposure: false, iso: 80 } });
    expect(h.data.commands[0].id).toBe(fast.mock.calls[0][0]);
    h.data.commands[0].status = 'applied'; h.data.session.deviceState!.pro = { iso: 20 }; h.applied();
    await vi.advanceTimersByTimeAsync(210); await Promise.all([first, second]);
    expect(h.data.commands[1].id).toBe(fast.mock.calls[1][0]); expect(h.remote().session!.deviceState!.pro!.iso).toBe(80);
    expect(h.state().videoControls?.busy).toBe(false); expect(h.data.takes).toHaveLength(0);
  });
  it('pacote direto perdido conserva fallback e cancelamento não deixa uma promessa pendurada', async () => {
    const h = fixture(); h.data.session.deviceState!.capabilities!.liveControls = 1;
    const fast = vi.fn(async (): Promise<StudioRemoteDeviceState> => { throw new Error('Pacote perdido'); });
    vi.mocked(h.preview).mockImplementation(async (_response, callbacks) => { callbacks.track(track); callbacks.connection('connected'); return { disconnect: h.disconnect, configure: fast }; });
    await h.controller.prepare(); await h.controller.configureRemote({ pro: { iso: 20 } });
    expect(h.data.commands[0].payload).toEqual({ pro: { iso: 20 } }); expect(h.state().videoControls?.busy).toBe(false);
    const delayed = deferred<StudioRemoteDeviceState>(); fast.mockImplementationOnce(() => delayed.promise);
    const pending = h.controller.configureRemote({ pro: { iso: 40 } }).catch(error => error); h.controller.cancel(); delayed.resolve({ configurationConfirmed: true, pro: { iso: 40 } });
    expect(await pending).toMatchObject({ name: 'AbortError' }); expect(h.data.commands).toHaveLength(1); expect(h.remote().session).toBeNull();
  });
  it('toque de foco não é repetido no pacote direto do próximo ajuste de ISO', async () => {
    const h = fixture(); h.data.session.deviceState!.capabilities!.liveControls = 1;
    const fast = vi.fn(async (_id: string, patch: Record<string, unknown>) => ({ configurationConfirmed: true, pro: patch.pro as Record<string, unknown> }));
    vi.mocked(h.preview).mockImplementation(async (_response, callbacks) => { callbacks.track(track); callbacks.connection('connected'); return { disconnect: h.disconnect, configure: fast }; });
    await h.controller.prepare(); await h.controller.configureRemote({ pro: { focusPoint: { x: .5, y: .5, locked: false } } });
    await h.controller.configureRemote({ pro: { autoExposure: false, iso: 34 } });
    expect(fast.mock.calls[0][1]).toEqual({ pro: { focusPoint: { x: .5, y: .5, locked: false } } });
    expect(fast.mock.calls[1][1]).toEqual({ pro: { autoExposure: false, iso: 34 } });
  });
  it('snapshots não permitem alterar configuração/qualidades internas e o relógio usa server midpoint', async () => {
    const h = fixture(); await h.controller.prepare(); const external = h.controller.getEnvelope()!; external.session.configuration.resolution = '720p'; expect(h.controller.getEnvelope()!.session.configuration.resolution).toBe('4k');
    h.state().videoControls!.resolutions.length = 0; let fresh!: StudioCaptureState; h.controller.subscribe(value => fresh = value); expect(fresh.videoControls!.resolutions).toHaveLength(4); expect(h.controller.getServerNow()).toBe(Date.now());
  });
  it('restaura sessão privada pelo controller original e recebe master já enviado sem novo REC', async () => {
    const h = fixture(); await h.controller.prepare(); const started = await h.controller.remoteStart(); await h.controller.stop();
    const restored = createStudioRemoteCapture({ owner: 'owner', kind: 'aula', client: h.client, preview: h.preview, inspect: h.inspect, persist: false, resumeSessionId: h.data.session.id, controllerId: h.data.session.controllerId }); controllers.push(restored);
    let state!: StudioCaptureState; restored.subscribe(value => state = value); await restored.prepare();
    expect(state).toMatchObject({ phase: 'error', pendingRecovery: true, file: null }); const master = await restored.remoteStop(); expect(master.take.id).toBe(started.takeId); expect(master.metadata.width).toBe(3840);
    expect(h.data.commands.filter(command => command.type === 'start')).toHaveLength(1); expect(h.data.commands.filter(command => command.type === 'stop')).toHaveLength(1);
  });
  it('configuração física não confirmada bloqueia REC e permite recuperar Auto antes de iniciar', async () => {
    const h = fixture(); await h.controller.prepare(); h.data.session.deviceState!.configurationConfirmed = false; await h.controller.reconnect();
    expect(h.state()).toMatchObject({ phase: 'error', pendingRecovery: false }); await expect(h.controller.remoteStart()).rejects.toThrow('Confirme os ajustes'); expect(h.data.commands.filter(command => command.type === 'start')).toHaveLength(0);
    h.data.session.deviceState!.configurationConfirmed = true; await h.controller.configureRemote({ pro: { autoExposure: true } }); expect(h.state().phase).toBe('ready');
  });
  it('identidade do computador persiste por conta e limpar armazenamento exige identidade nova', () => {
    const first = studioRemoteControllerId('owner'); expect(studioRemoteControllerId('owner')).toBe(first);
    expect(studioRemoteControllerId('other-owner')).not.toBe(first); expect(studioRemoteControllerId('owner')).toBe(first);
    localStorage.clear(); expect(studioRemoteControllerId('owner')).not.toBe(first);
    localStorage.setItem('classfy:studio:remote-controller:v1:owner', 'invalid-client'); expect(studioRemoteControllerId('owner')).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('sessão vinculada sem QR conecta automaticamente e cancelar não desvincula o computador', async () => {
    const h = fixture(); delete h.data.pairing;
    const controller = createStudioRemoteCapture({ owner: 'owner', kind: 'aula', client: h.client, preview: h.preview, inspect: h.inspect }); controllers.push(controller);
    await controller.prepare(); const clientId = h.request.mock.calls.find(([body]) => body.action === 'create')![0].controllerId;
    let state!: StudioCaptureState, remote!: StudioRemoteView; controller.subscribe(value => state = value); controller.subscribeRemote(value => remote = value);
    expect(state.phase).toBe('ready'); expect(remote.pairing).toBeNull(); expect(remote.connection).toBe('connected');
    controller.cancel(); expect(studioRemoteControllerId('owner')).toBe(clientId); expect(h.request.mock.calls.some(([body]) => body.action === 'unpair')).toBe(false);
    await controller.prepare(); expect(h.request.mock.calls.filter(([body]) => body.action === 'create').every(([body]) => body.controllerId === clientId)).toBe(true);
  });
  it('troca de Aula para Short cria sessão correta usando o mesmo vínculo do computador, sem configure de formato fictício', async () => {
    const h=fixture();delete h.data.pairing;const aula=createStudioRemoteCapture({owner:'owner',kind:'aula',client:h.client,preview:h.preview,inspect:h.inspect});controllers.push(aula);await aula.prepare();const clientId=studioRemoteControllerId('owner');aula.dispose();
    h.data.session={...h.data.session,id:'session-short',kind:'short',deviceState:{...h.data.session.deviceState,width:2160,height:3840}};
    const short=createStudioRemoteCapture({owner:'owner',kind:'short',client:h.client,preview:h.preview,inspect:h.inspect});controllers.push(short);let state!:StudioCaptureState;short.subscribe(value=>state=value);expect(short.configureAspectRatio).toBeUndefined();await short.prepare();
    expect(h.request.mock.calls.filter(([body])=>body.action==='create').map(([body])=>[body.kind,body.controllerId])).toEqual([['aula',clientId],['short',clientId]]);expect(short.getEnvelope()!.session).toMatchObject({id:'session-short',kind:'short'});expect(state).toMatchObject({phase:'ready',width:2160,height:3840});expect(h.request.mock.calls.some(([body])=>body.action==='command')).toBe(false);expect(h.data.takes).toHaveLength(0);
  });
  it('resposta antiga com formato Aula não é adotada por controller Short e não abre preview', async () => {
    const h=fixture();const short=createStudioRemoteCapture({owner:'owner',kind:'short',client:h.client,preview:h.preview,inspect:h.inspect,persist:false});controllers.push(short);let state!:StudioCaptureState;short.subscribe(value=>state=value);
    await expect(short.prepare()).rejects.toMatchObject({code:'session_kind_mismatch'});expect(short.getEnvelope()).toBeNull();expect(state).toMatchObject({phase:'error',stream:null});expect(h.preview).not.toHaveBeenCalled();expect(h.request.mock.calls.some(([body])=>body.action==='connect')).toBe(false);
  });
  it('cancelamento de criação pendente ignora resposta tardia e permite conectar novamente', async () => {
    const h = fixture(false), pending = deferred<StudioRemoteResponse>(), originalRequest = h.request.getMockImplementation()!;
    h.request.mockImplementationOnce(() => pending.promise);
    const prepare = h.controller.prepare().catch(error => error); h.controller.cancel(); pending.resolve(structuredClone(h.data));
    expect(await prepare).toMatchObject({ name: 'AbortError' }); expect(h.state()).toMatchObject({ phase: 'idle', stream: null, pendingRecovery: false });
    h.request.mockImplementation(originalRequest); await h.controller.prepare(); expect(h.state().phase).toBe('preparing'); expect(h.remote().pairing?.code).toBe('ABC123');
  });
  it('desvincular usa revogação explícita, troca identidade e nunca toca originais pendentes', async () => {
    const h = fixture(); const controller = createStudioRemoteCapture({ owner: 'owner', kind: 'aula', client: h.client, preview: h.preview, inspect: h.inspect }); controllers.push(controller);
    await controller.prepare(); const first = studioRemoteControllerId('owner'); await controller.unlinkRemote();
    expect(h.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'unpair', sessionId: h.data.session.id, controllerId: first }), expect.anything()); expect(studioRemoteControllerId('owner')).not.toBe(first);
    await controller.prepare(); await controller.remoteStart(); await expect(controller.unlinkRemote()).rejects.toThrow('Finalize e salve'); expect(h.request.mock.calls.filter(([body]) => body.action === 'unpair')).toHaveLength(1);
  });
});
describe('recibo do original remoto', () => {
  const take = (): StudioRemoteTake => ({ id: 'take', status: 'uploaded', metadata: { bytes: original.size, mime: 'video/mp4', width: 3840, height: 2160, fps: 30, duration: 2 }, createdAt: new Date(NOW).toISOString(), uploadedAt: new Date(NOW).toISOString() });
  it('rejeita bytes incompletos, dimensão da prévia e ausência de áudio antes de importar', async () => {
    const inspect = vi.fn(async () => metadata); await expect(validateStudioRemoteMaster(new Blob(['short']), take(), inspect)).rejects.toThrow('incompleto'); expect(inspect).not.toHaveBeenCalled();
    await expect(validateStudioRemoteMaster(original, take(), async () => ({ ...metadata, width: 1280, height: 720 }))).rejects.toThrow('não corresponde');
    await expect(validateStudioRemoteMaster(original, take(), async () => ({ ...metadata, hasAudio: false }))).rejects.toThrow('não corresponde');
  });
  it('não inventa 4K/FPS quando o aparelho apenas confirmou 1080p', () => {
    const h = fixture(); h.data.session.configuration.resolution = '1080p'; h.data.session.deviceState = { width: 1080, height: 1920, fps: 24 }; const profile = remoteStudioProfile(h.data, 'short');
    expect(profile).toMatchObject({ width: 1080, height: 1920, frameRate: 24, frameRates: [30] }); expect(profile.resolutions.map(value => value.label)).toEqual(['1080p']);
  });
});

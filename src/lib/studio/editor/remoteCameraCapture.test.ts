import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioRemoteResponse, StudioRemoteTake } from '../../../../shared/studio/remoteCamera';
import type { StudioCaptureState } from './capture';
import { createStudioRemoteCapture, remoteStudioProfile, validateStudioRemoteMaster, type StudioRemoteCaptureController, type StudioRemotePreviewFactory, type StudioRemoteView } from './remoteCameraCapture';
import type { StudioRemoteClient } from './remoteCameraClient';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
const NOW = Date.parse('2026-10-12T12:00:00Z');
const original = new Blob(['master-original'], { type: 'video/mp4' });
const metadata = { kind: 'video' as const, width: 3840, height: 2160, frameRate: 30, duration: 2, hasAudio: true, mimeType: 'video/mp4', warnings: [] };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Stream { constructor(public tracks: MediaStreamTrack[]) {} getVideoTracks() { return this.tracks; } getAudioTracks() { return []; } getTracks() { return this.tracks; } }
const track = { id: 'phone-preview', kind: 'video', stop: vi.fn(), getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }) } as unknown as MediaStreamTrack;
let controllers: StudioRemoteCaptureController[];
function fixture(paired = true) {
  const data: StudioRemoteResponse = {
    session: { id: 'session-remote', projectId: null, kind: 'aula', title: 'Minha aula', status: paired ? 'ready' : 'pairing', controllerId: 'controller', deviceId: paired ? 'phone' : null, sequence: 0, activeTakeId: null, configuration: { resolution: '4k', fps: 30, cameraFacing: 'back' }, deviceState: paired ? { deviceName: 'iPhone de teste', width: 3840, height: 2160, fps: 30, capabilities: { resolutions: ['720p', '1080p', '2k', '4k'], frameRates: [24, 30] } } : null, createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 300_000).toISOString(), pairedAt: paired ? new Date(NOW).toISOString() : null, controllerSeenAt: null, deviceSeenAt: null, closedAt: null }, commands: [], takes: [], serverAt: new Date(NOW).toISOString(), pairing: { code: 'ABC123', expiresAt: new Date(NOW + 300_000).toISOString() },
  };
  let autoAck = true, upload = true;
  const download = vi.fn(async () => original), inspect = vi.fn(async () => metadata), disconnect = vi.fn(async () => undefined);
  const request = vi.fn(async (body: Record<string, unknown>) => {
    data.serverAt = new Date(Date.now()).toISOString();
    if (body.action === 'create') data.session.controllerId = String(body.controllerId);
    if (body.action === 'connect') data.connection = { url: 'wss://fixture.livekit.cloud', token: 'fixture-private-room', identity: 'controller' };
    if (body.action === 'download') data.download = { url: 'https://fixture.supabase.co/storage/v1/object/sign/master', parts: [{ url: 'https://fixture.supabase.co/storage/v1/object/sign/master', index: 0, bytes: original.size }], bytes: original.size, mime: 'video/mp4', totalParts: 1, nextPartIndex: null, expiresAt: new Date(NOW + 300_000).toISOString() };
    if (body.action === 'command' && !data.commands.some(command => command.id === body.commandId)) {
      const payload = body.payload as Record<string, unknown>, command = { id: String(body.commandId), sequence: ++data.session.sequence, type: body.type as 'configure' | 'start' | 'stop', payload, status: autoAck ? 'applied' as const : 'pending' as const, createdAt: new Date(Date.now()).toISOString(), acknowledgedAt: autoAck ? new Date(Date.now()).toISOString() : null, result: body.type === 'start' ? { takeId: payload.takeId, startedAtServerMs: Date.now() } : {} };
      data.commands.push(command);
      if (body.type === 'start') { data.session.activeTakeId = String(payload.takeId); data.session.status = autoAck ? 'recording' : 'starting'; data.takes.push({ id: String(payload.takeId), status: 'recording', metadata: null, createdAt: new Date(NOW).toISOString(), uploadedAt: null }); }
      if (body.type === 'stop' && autoAck) { data.session.status = 'ready'; const take = data.takes.find(item => item.id === payload.takeId); if (take) { take.status = upload ? 'uploaded' : 'uploading'; take.metadata = { bytes: original.size, mime: 'video/mp4', width: 3840, height: 2160, fps: 30, duration: 2 }; } }
      if (body.type === 'configure' && autoAck) { Object.assign(data.session.configuration, payload); data.session.deviceState = { ...data.session.deviceState, configuration: { ...data.session.configuration } }; }
    }
    return structuredClone(data);
  });
  const preview: StudioRemotePreviewFactory = vi.fn(async (_response, callbacks) => { callbacks.track(track); callbacks.connection('connected'); return { disconnect }; });
  const client = { request, download } as StudioRemoteClient;
  const controller = createStudioRemoteCapture({ owner: 'owner', kind: 'aula', client, preview, inspect, persist: false, commandTimeoutMs: 500, transferTimeoutMs: 500 }); controllers.push(controller);
  let state!: StudioCaptureState, remote!: StudioRemoteView;
  controller.subscribe(value => state = value); controller.subscribeRemote(value => remote = value);
  return { controller, client, request, download, inspect, preview, disconnect, data, state: () => state, remote: () => remote, pending() { autoAck = false; }, uploading() { upload = false; } };
}
beforeEach(() => { controllers = []; vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubGlobal('MediaStream', Stream); });
afterEach(() => { controllers.forEach(controller => controller.dispose()); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('câmera remota preserva o original nativo e a autoridade do iPhone', () => {
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

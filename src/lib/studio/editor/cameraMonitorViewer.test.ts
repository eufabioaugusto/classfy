import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioCameraMonitorResponse } from '../../../../shared/studio/cameraMonitor';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { createStudioCameraMonitorViewer, type StudioCameraMonitorPreviewFactory, type StudioCameraMonitorView } from './cameraMonitorViewer';
import { StudioCameraMonitorError } from './cameraMonitorClient';
const ID = '00000000-0000-4000-8000-000000000001', DEVICE = '00000000-0000-4000-8000-000000000002', VIEWER = '00000000-0000-4000-8000-000000000003';
const NOW = Date.parse('2026-10-14T12:00:00Z');
const envelope = (patch: Partial<NonNullable<StudioCameraMonitorResponse['monitor']>> = {}): StudioCameraMonitorResponse => ({ monitor: { id: ID, ownerId: 'creator', deviceId: DEVICE, kind: 'short', title: 'Minha cena', status: 'active', state: { recording: false, elapsedSeconds: 0, width: 2160, height: 3840, fps: 30, cameraFacing: 'back' }, createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 3600000).toISOString(), deviceSeenAt: new Date(Date.now()).toISOString(), closedAt: null, ...patch }, serverAt: new Date().toISOString(), connection: { url: 'wss://fixture.livekit.cloud', token: 'fixture-token', identity: 'viewer' } });
class Stream { constructor(readonly tracks: MediaStreamTrack[]) {} getTracks() { return this.tracks; } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { resolve, promise }; }
let state: StudioCameraMonitorView, callbacks: Parameters<StudioCameraMonitorPreviewFactory>[1], disconnect: ReturnType<typeof vi.fn>, preview: ReturnType<typeof vi.fn>, request: ReturnType<typeof vi.fn>, viewer: ReturnType<typeof createStudioCameraMonitorViewer>;
const camera = { id: 'mobile-video', kind: 'video' } as MediaStreamTrack;
function setup() { viewer = createStudioCameraMonitorViewer({ owner: 'creator', clientId: VIEWER, client: { request }, preview }); viewer.subscribe(value => { state = value; }); return viewer; }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubGlobal('MediaStream', Stream); disconnect = vi.fn(async () => undefined);
  request = vi.fn(async () => envelope()); preview = vi.fn(async (_response, listener) => { callbacks = listener; listener.connection('connecting'); listener.track(camera); listener.connection('connected'); return { disconnect }; });
});
afterEach(async () => { await viewer?.dispose(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });
describe('lifecycle do viewer privado sem autoridade de câmera', () => {
  it('espera publicação mobile, descobre em 2s e então conecta apenas como viewer', async () => {
    request.mockResolvedValueOnce({ monitor: null, serverAt: new Date(NOW).toISOString() }); await setup().start(); expect(state.connection).toBe('waiting'); expect(preview).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000); expect(request.mock.calls.map(call => call[0])).toEqual([{ action: 'monitor-discover' }, { action: 'monitor-discover' }, { action: 'monitor-connect', sessionId: ID, role: 'viewer', clientId: VIEWER }]); expect(state.stream?.getTracks()).toEqual([camera]); expect(state.connection).toBe('connected');
    await vi.advanceTimersByTimeAsync(5000); expect(request.mock.calls.at(-1)![0]).toEqual({ action: 'monitor-heartbeat', sessionId: ID, role: 'viewer', clientId: VIEWER });
  });
  it('adota REC e tempo mobile sem iniciar gravador, transferir bytes ou enviar comandos', async () => {
    const getUserMedia = vi.fn(), MediaRecorder = vi.fn(); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } }); vi.stubGlobal('MediaRecorder', MediaRecorder);
    await setup().start(); request.mockImplementation(async () => envelope({ state: { recording: true, elapsedSeconds: 12.5, width: 2160, height: 3840, fps: 30, cameraFacing: 'back' } })); await vi.advanceTimersByTimeAsync(5000);
    expect(state.monitor?.state?.recording).toBe(true); expect(state.monitor?.state?.elapsedSeconds).toBe(12.5); expect(getUserMedia).not.toHaveBeenCalled(); expect(MediaRecorder).not.toHaveBeenCalled(); expect(request.mock.calls.every(call => ['monitor-discover', 'monitor-connect', 'monitor-heartbeat'].includes(call[0].action))).toBe(true);
  });
  it('deixa de exibir imagem imediatamente quando o telefone fecha ou perde conexão', async () => {
    await setup().start(); request.mockImplementation(async () => envelope({ status: 'closed', closedAt: new Date().toISOString() })); await vi.advanceTimersByTimeAsync(5000); expect(state.stream).toBeNull(); expect(state.monitor).toBeNull(); expect(state.connection).toBe('lost'); expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it('expiração retira um track antigo mesmo com heartbeat HTTP pendente', async () => {
    request.mockImplementation(async () => envelope({ expiresAt: new Date(NOW + 10000).toISOString() })); await setup().start(); request.mockImplementation(() => new Promise(() => {})); await vi.advanceTimersByTimeAsync(10001); expect(state.stream).toBeNull(); expect(state.monitor).toBeNull(); expect(state.connection).toBe('lost'); expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it('heartbeat fresco no servidor com deviceSeenAt antigo não conserva imagem congelada', async () => {
    await setup().start(); request.mockImplementation(async () => envelope({ deviceSeenAt: new Date(NOW).toISOString() })); await vi.advanceTimersByTimeAsync(30001); expect(state.stream).toBeNull(); expect(state.connection).toBe('lost'); expect(disconnect).toHaveBeenCalled();
  });
  it('sessão selecionada não é trocada silenciosamente durante uma gravação', async () => {
    await setup().start(); request.mockImplementation(async () => envelope({ id: '00000000-0000-4000-8000-000000000004' })); await vi.advanceTimersByTimeAsync(5000); expect(state.stream).toBeNull(); expect(state.error).toContain('sessão'); expect(preview).toHaveBeenCalledTimes(1);
  });
  it('resposta ou track tardios após dispose não chegam à próxima conta', async () => {
    const pending = deferred<StudioCameraMonitorResponse>(); request.mockImplementation(() => pending.promise); const controller = setup(), running = controller.start(); await Promise.resolve(); await controller.dispose(); pending.resolve(envelope()); await running; expect(preview).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('conexão RTC que termina depois de expirar é descartada e não reaparece na sessão seguinte', async () => {
    const opening = deferred<{ disconnect(): Promise<void> }>();
    const oldDisconnect = vi.fn(async () => undefined);
    request.mockImplementation(async () => envelope({ expiresAt: new Date(NOW + 1000).toISOString() }));
    preview.mockImplementationOnce(async (_response, listener) => { callbacks = listener; return opening.promise; });
    const controller = setup(), running = controller.start(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const old = callbacks; await vi.advanceTimersByTimeAsync(1001); expect(state.monitor).toBeNull();
    old.connection('connected'); old.track(camera); expect(state.stream).toBeNull(); expect(state.connection).toBe('lost');
    opening.resolve({ disconnect: oldDisconnect }); await running; expect(oldDisconnect).toHaveBeenCalledTimes(1);
    request.mockImplementation(async () => envelope({ id: '00000000-0000-4000-8000-000000000004' })); await controller.reconnect(); expect(state.monitor?.id).toBe('00000000-0000-4000-8000-000000000004'); expect(state.stream).not.toBeNull(); old.track(null); expect(state.stream).not.toBeNull();
  });
  it('reconectar só substitui viewer e cleanup nunca fecha sessão mobile', async () => {
    await setup().start(); const old = callbacks; await viewer.reconnect(); expect(disconnect).toHaveBeenCalledTimes(1); expect(preview).toHaveBeenCalledTimes(2); old.track(null); expect(state.stream).not.toBeNull(); await viewer.dispose(); expect(disconnect).toHaveBeenCalledTimes(2); expect(request.mock.calls.some(call => ['monitor-close', 'monitor-create', 'command'].includes(call[0].action))).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['premium_required', 'studio_camera_premium_required', 'studio_camera_monitor_premium_required', 'studio_camera_creator_required'])('revogação %s encerra viewer e polling sem interferir no take mobile', async code => {
    await setup().start(); request.mockRejectedValue(new StudioCameraMonitorError('Este recurso faz parte do Premium.', code)); await vi.advanceTimersByTimeAsync(5000); expect(state.stream).toBeNull(); expect(state.error).toContain('Premium'); expect(vi.getTimerCount()).toBe(0); expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

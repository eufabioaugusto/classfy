import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioCameraMonitorViewerRequest } from '../../../../shared/studio/cameraMonitor';
const io = vi.hoisted(() => ({ owner: 'creator', session: vi.fn(), invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: io.session }, functions: { invoke: io.invoke } } }));
import { createStudioCameraMonitorClient, studioCameraMonitorFresh } from './cameraMonitorClient';
const ID = '00000000-0000-4000-8000-000000000001', DEVICE = '00000000-0000-4000-8000-000000000002', VIEWER = '00000000-0000-4000-8000-000000000003';
const NOW = Date.parse('2026-10-14T12:00:00Z');
const envelope = () => ({ monitor: { id: ID, ownerId: 'creator', deviceId: DEVICE, kind: 'aula', title: 'Cena privada', status: 'active', state: { recording: false, elapsedSeconds: 0, width: 3840, height: 2160, fps: 30, cameraFacing: 'back' }, createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 60000).toISOString(), deviceSeenAt: new Date(NOW).toISOString(), closedAt: null }, serverAt: new Date(NOW).toISOString() });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); io.owner = 'creator'; io.session.mockImplementation(async () => ({ data: { session: { user: { id: io.owner }, access_token: 'fixture-session' } }, error: null })); io.invoke.mockResolvedValue({ data: envelope(), error: null }); });
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe('cliente do monitor restrito ao viewer e à conta atual', () => {
  it('descobre e conecta pela sessão autenticada, descartando campos de controle ou estado', async () => {
    const client = createStudioCameraMonitorClient('creator');
    await client.request({ action: 'monitor-discover', state: { recording: true } } as StudioCameraMonitorViewerRequest);
    await client.request({ action: 'monitor-connect', sessionId: ID, clientId: VIEWER, role: 'viewer', command: 'start', state: { recording: true } } as StudioCameraMonitorViewerRequest);
    expect(io.invoke.mock.calls.map(call => call[1].body)).toEqual([{ action: 'monitor-discover' }, { action: 'monitor-connect', sessionId: ID, clientId: VIEWER, role: 'viewer' }]);
    expect(io.invoke).toHaveBeenCalledWith('studio-camera', expect.objectContaining({ headers: { Authorization: 'Bearer fixture-session' }, signal: expect.any(AbortSignal) }));
  });
  it.each(['monitor-create', 'monitor-close', 'command', 'download', 'upload-start'])('não autoriza ação %s mesmo se o caller contornar o tipo', async action => {
    await expect(createStudioCameraMonitorClient('creator').request({ action } as StudioCameraMonitorViewerRequest)).rejects.toMatchObject({ code: 'invalid_request' }); expect(io.invoke).not.toHaveBeenCalled();
  });
  it('logout ou troca de conta antes/depois da chamada impede adoção', async () => {
    io.owner = 'other'; const client = createStudioCameraMonitorClient('creator'); await expect(client.request({ action: 'monitor-discover' })).rejects.toMatchObject({ code: 'account_changed' }); expect(io.invoke).not.toHaveBeenCalled();
    io.owner = 'creator'; io.invoke.mockImplementation(async () => { io.owner = 'other'; return { data: envelope(), error: null }; }); await expect(client.request({ action: 'monitor-discover' })).rejects.toMatchObject({ code: 'account_changed' });
  });
  it('nega sessão de outro owner e dados incompletos', async () => {
    const other = envelope(); other.monitor.ownerId = 'other'; io.invoke.mockResolvedValue({ data: other, error: null }); await expect(createStudioCameraMonitorClient('creator').request({ action: 'monitor-discover' })).rejects.toMatchObject({ code: 'invalid_response' });
    io.invoke.mockResolvedValue({ data: { session: {}, commands: [], takes: [] }, error: null }); await expect(createStudioCameraMonitorClient('creator').request({ action: 'monitor-discover' })).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('recebe ausência de sessão e erro Premium concreto sem inventar acesso', async () => {
    const client = createStudioCameraMonitorClient('creator'); io.invoke.mockResolvedValue({ data: { monitor: null, serverAt: new Date(NOW).toISOString() }, error: null }); expect((await client.request({ action: 'monitor-discover' })).monitor).toBeNull();
    io.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ code: 'premium_required', message: 'Este recurso faz parte do Premium.' }), { status: 403 }) } }); await expect(client.request({ action: 'monitor-discover' })).rejects.toMatchObject({ code: 'premium_required', message: 'Este recurso faz parte do Premium.' });
  });
  it('aborta scope cancelado e timeout sem manter requisição pendente', async () => {
    const client = createStudioCameraMonitorClient('creator'), abort = new AbortController(); abort.abort(); await expect(client.request({ action: 'monitor-discover' }, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(io.invoke).not.toHaveBeenCalled();
    io.invoke.mockImplementation(() => new Promise(() => {})); const result = client.request({ action: 'monitor-discover' }).catch(error => error); await vi.advanceTimersByTimeAsync(12001); expect((await result).code).toBe('timeout'); expect(io.invoke.mock.calls[0][1].signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('sessão local que responde depois do timeout não invoca o endpoint', async () => {
    let resolve!: (value: unknown) => void; io.session.mockImplementation(() => new Promise(accept => { resolve = accept; }));
    const result = createStudioCameraMonitorClient('creator').request({ action: 'monitor-discover' }).catch(error => error);
    await vi.advanceTimersByTimeAsync(12001); expect((await result).code).toBe('timeout');
    resolve({ data: { session: { user: { id: 'creator' }, access_token: 'fixture-session' } }, error: null }); await Promise.resolve(); await Promise.resolve(); expect(io.invoke).not.toHaveBeenCalled();
  });
  it('imagem antiga, encerrada ou expirada não conta como monitor ao vivo', () => {
    const monitor = envelope().monitor; expect(studioCameraMonitorFresh(monitor as never, NOW)).toBe(true);
    expect(studioCameraMonitorFresh({ ...monitor, deviceSeenAt: new Date(NOW - 30000).toISOString() } as never, NOW)).toBe(false); expect(studioCameraMonitorFresh({ ...monitor, expiresAt: new Date(NOW).toISOString() } as never, NOW)).toBe(false); expect(studioCameraMonitorFresh({ ...monitor, status: 'closed' } as never, NOW)).toBe(false);
  });
});

import { supabase } from '@/integrations/supabase/client';
import type { StudioCameraMonitor, StudioCameraMonitorResponse, StudioCameraMonitorViewerRequest } from '../../../../shared/studio/cameraMonitor';

export type StudioCameraMonitorScope = { signal?: AbortSignal; isCurrent?: () => boolean };
export type StudioCameraMonitorClient = { request(body: StudioCameraMonitorViewerRequest, scope?: StudioCameraMonitorScope): Promise<StudioCameraMonitorResponse> };
export class StudioCameraMonitorError extends Error {
  constructor(message: string, readonly code = 'monitor_error') { super(message); this.name = 'StudioCameraMonitorError'; }
}
export const MONITOR_DEVICE_STALE_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function studioCameraMonitorFresh(monitor: StudioCameraMonitor | null, serverNow = Date.now()): boolean {
  return !!monitor && monitor.status === 'active' && !monitor.closedAt && timestamp(monitor.expiresAt) && Date.parse(monitor.expiresAt) > serverNow &&
    timestamp(monitor.deviceSeenAt) && Date.parse(monitor.deviceSeenAt) > serverNow - MONITOR_DEVICE_STALE_MS;
}
export function assertStudioCameraMonitorScope(scope: StudioCameraMonitorScope) {
  if (scope.signal?.aborted || scope.isCurrent?.() === false) throw new DOMException('Monitor desconectado.', 'AbortError');
}
function validateResponse(value: unknown, owner: string): StudioCameraMonitorResponse {
  const response = value as StudioCameraMonitorResponse | null;
  const fail = () => { throw new StudioCameraMonitorError('O monitor respondeu com dados incompletos.', 'invalid_response'); };
  if (!response || !timestamp(response.serverAt) || !Object.prototype.hasOwnProperty.call(response, 'monitor')) return fail();
  const monitor = response.monitor;
  if (monitor !== null) {
    if (!monitor || !UUID.test(monitor.id) || !UUID.test(monitor.deviceId) || monitor.ownerId !== owner || !['aula', 'short'].includes(monitor.kind) || typeof monitor.title !== 'string' || !['active', 'closed'].includes(monitor.status) || !timestamp(monitor.createdAt) || !timestamp(monitor.expiresAt) || monitor.deviceSeenAt !== null && !timestamp(monitor.deviceSeenAt) || monitor.closedAt !== null && !timestamp(monitor.closedAt)) return fail();
    const state = monitor.state;
    if (state !== null && (!state || typeof state.recording !== 'boolean' || !Number.isFinite(state.elapsedSeconds) || state.elapsedSeconds < 0 || !Number.isFinite(state.width) || state.width < 0 || !Number.isFinite(state.height) || state.height < 0 || !Number.isFinite(state.fps) || state.fps < 0 || !['front', 'back'].includes(state.cameraFacing))) return fail();
  }
  if (response.connection && (!monitor || typeof response.connection.token !== 'string' || !response.connection.token || typeof response.connection.identity !== 'string' || !response.connection.identity || typeof response.connection.url !== 'string' || !/^wss:\/\//.test(response.connection.url))) return fail();
  return response;
}
/** Owner is checked before and after each invocation; JWTs stay in the transport. */
export function createStudioCameraMonitorClient(owner: string): StudioCameraMonitorClient {
  return { async request(body, scope = {}) {
    assertStudioCameraMonitorScope(scope);
    if (!body || !['monitor-discover', 'monitor-connect', 'monitor-heartbeat'].includes(body.action) || body.action !== 'monitor-discover' && (!UUID.test(body.sessionId) || !UUID.test(body.clientId) || body.role !== 'viewer')) throw new StudioCameraMonitorError('A solicitação do monitor é inválida.', 'invalid_request');
    const controller = new AbortController();
    const cancel = () => controller.abort(); scope.signal?.addEventListener('abort', cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = async () => {
      const { data, error } = await supabase.auth.getSession(); assertStudioCameraMonitorScope(scope);
      if (controller.signal.aborted) throw new DOMException('Monitor desconectado.', 'AbortError');
      if (error || !owner || data.session?.user.id !== owner || !data.session.access_token) throw new StudioCameraMonitorError('Sua conta mudou. Entre novamente para abrir o monitor.', 'account_changed');
      return data.session.access_token;
    };
    const work = async () => {
      const token = await current();
      const request: StudioCameraMonitorViewerRequest = body.action === 'monitor-discover' ? { action: body.action } : { action: body.action, sessionId: body.sessionId, role: 'viewer', clientId: body.clientId };
      const { data, error } = await supabase.functions.invoke('studio-camera', { body: request, signal: controller.signal, headers: { Authorization: `Bearer ${token}` } });
      await current(); assertStudioCameraMonitorScope(scope);
      if (error) {
        let detail: { message?: string; error?: string; code?: string } | undefined;
        try { if ('context' in error && error.context instanceof Response) detail = await error.context.clone().json(); } catch { /* Network errors may have no JSON response. */ }
        throw new StudioCameraMonitorError(detail?.message ?? detail?.error ?? 'A conexão com o iPhone foi interrompida. Reconecte o monitor.', detail?.code ?? 'transport');
      }
      return validateResponse(data, owner);
    };
    try {
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new StudioCameraMonitorError('O iPhone demorou a responder. Reconecte o monitor.', 'timeout')); controller.abort(); }, 12_000); });
      const cancelled = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new DOMException('Monitor desconectado.', 'AbortError')), { once: true }));
      const response = await Promise.race([work(), deadline, cancelled]); assertStudioCameraMonitorScope(scope); return response;
    } finally { clearTimeout(timer); scope.signal?.removeEventListener('abort', cancel); }
  } };
}

import { requestRemoteCameraResponse, type RemoteCameraScope } from './remoteCameraApi';
import { studioMonitorUUID, validStudioMonitorState } from './cameraMonitorModel';
import type { StudioCameraMonitorResponse } from './cameraMonitorProtocol';

export type StudioCameraMonitorDeviceAction = 'monitor-create' | 'monitor-connect' | 'monitor-heartbeat' | 'monitor-close';
export async function requestStudioCameraMonitor(owner: string, action: StudioCameraMonitorDeviceAction,
  body: Record<string, unknown>, scope?: RemoteCameraScope): Promise<StudioCameraMonitorResponse> {
  const value = await requestRemoteCameraResponse(owner, action, body, scope) as StudioCameraMonitorResponse;
  const monitor = value?.monitor;
  if (!value || !Number.isFinite(Date.parse(value.serverAt)) || !monitor || !studioMonitorUUID(monitor.id)
    || monitor.id !== body.sessionId || monitor.ownerId !== owner || !studioMonitorUUID(monitor.deviceId)
    || monitor.deviceId !== (body.deviceId || body.clientId) || !['aula', 'short'].includes(monitor.kind)
    || typeof monitor.title !== 'string' || monitor.title.length > 150 || !['active', 'closed'].includes(monitor.status)
    || !Number.isFinite(Date.parse(monitor.createdAt)) || !Number.isFinite(Date.parse(monitor.expiresAt))
    || monitor.deviceSeenAt !== null && !Number.isFinite(Date.parse(monitor.deviceSeenAt))
    || monitor.closedAt !== null && !Number.isFinite(Date.parse(monitor.closedAt))
    || monitor.state !== null && !validStudioMonitorState(monitor.state)) throw new Error('O servidor não confirmou o monitor desta conta.');
  if (action !== 'monitor-close' && (monitor.status !== 'active' || Date.parse(monitor.expiresAt) <= Date.parse(value.serverAt))) {
    throw new Error('O monitor foi encerrado. Ative Ver no computador novamente.');
  }
  if (action === 'monitor-connect') {
    const connection = value.connection;
    let safeURL = false;
    try { const url = new URL(connection?.url || ''); safeURL = url.protocol === 'wss:' && !url.username && !url.password; } catch {}
    if (!connection || !safeURL || typeof connection.token !== 'string' || !connection.token
      || connection.identity !== `studio-monitor-device-${monitor.id}-${monitor.deviceId}`) throw new Error('O servidor não confirmou a prévia privada deste iPhone.');
  }
  return value;
}

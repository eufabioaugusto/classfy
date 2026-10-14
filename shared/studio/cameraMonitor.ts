/** Same-account, mobile-origin camera preview. The browser is a viewer only. */
export type StudioCameraMonitorState = {
  recording: boolean;
  elapsedSeconds: number;
  width: number;
  height: number;
  fps: number;
  cameraFacing: 'front' | 'back';
};
export type StudioCameraMonitor = {
  id: string;
  ownerId: string;
  deviceId: string;
  kind: 'aula' | 'short';
  title: string;
  status: 'active' | 'closed';
  state: StudioCameraMonitorState | null;
  createdAt: string;
  expiresAt: string;
  deviceSeenAt: string | null;
  closedAt: string | null;
};
export type StudioCameraMonitorConnection = { url: string; token: string; identity: string };
export type StudioCameraMonitorResponse = {
  monitor: StudioCameraMonitor | null;
  serverAt: string;
  connection?: StudioCameraMonitorConnection;
};
/** Viewer requests cannot create, close, record, configure or transfer media. */
export type StudioCameraMonitorViewerRequest = { action: 'monitor-discover' } | {
  action: 'monitor-connect' | 'monitor-heartbeat';
  sessionId: string;
  role: 'viewer';
  clientId: string;
};

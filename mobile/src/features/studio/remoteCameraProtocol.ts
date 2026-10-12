/** Private same-account DTO, copied from shared/studio/remoteCamera.ts and
 * extended to the deployed studio-camera wire. No native imports. */
export type StudioRemoteResolution = '720p' | '1080p' | '2k' | '4k';
export type StudioRemoteConfiguration = {
  resolution: StudioRemoteResolution;
  fps: 24 | 30 | 60;
  cameraFacing: 'front' | 'back';
  pro?: Record<string, unknown>;
};
export type StudioRemoteMetadata = {
  bytes: number; mime: string; width: number; height: number; fps: number; duration: number;
  startedAtServerMs?: number;
};
export type StudioRemoteDeviceState = {
  configuration?: StudioRemoteConfiguration;
  width?: number; height?: number; fps?: number;
  recording?: boolean; deviceName?: string;
  capabilities?: Record<string, unknown>; pro?: Record<string, unknown>;
  error?: string | null;
  [key: string]: unknown;
};
export type StudioRemoteSession = {
  id: string; ownerId: string; projectId: string | null; kind: 'aula' | 'short'; title: string;
  status: 'pairing' | 'ready' | 'starting' | 'recording' | 'stopping' | 'closed';
  controllerId: string; deviceId: string | null; sequence: number; activeTakeId: string | null;
  configuration: StudioRemoteConfiguration; deviceState: StudioRemoteDeviceState | null;
  createdAt: string; expiresAt: string; pairedAt: string | null;
  controllerSeenAt: string | null; deviceSeenAt: string | null; closedAt: string | null;
};
export type StudioRemoteCommand = {
  id: string; sequence: number; type: 'configure' | 'start' | 'stop';
  payload: Record<string, unknown>; status: 'pending' | 'applied' | 'failed';
  createdAt: string; acknowledgedAt: string | null; result: Record<string, unknown> | null;
};
export type StudioRemoteTake = {
  id: string; status: 'reserved' | 'recording' | 'local_ready' | 'uploading' | 'uploaded' | 'failed';
  metadata: StudioRemoteMetadata | null; createdAt: string; uploadedAt: string | null;
};
export type StudioRemoteEnvelope = {
  session: StudioRemoteSession; commands: StudioRemoteCommand[]; takes: StudioRemoteTake[]; serverAt: string;
};
export type StudioRemoteConnection = { url: string; token: string; identity: string; expiresAt: string };
export type StudioRemoteResponse = StudioRemoteEnvelope & {
  pairing?: { code: string; expiresAt: string };
  connection?: StudioRemoteConnection;
  upload?: { endpoint: string; bucket: string; path: string; token: string; chunkSize: number; expiresAt: string;
    partIndex: number; partOffset: number; partBytes: number; totalParts: number; mime: string; uploaded: boolean };
  download?: { url?: string; parts: {url:string;index:number;bytes:number}[];
    bytes:number;mime:string;totalParts:number;nextPartIndex:number|null;expiresAt:string };
};

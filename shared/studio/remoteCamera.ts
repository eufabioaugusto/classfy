import type {StudioGrade} from './model';
/** Private, same-account Studio camera protocol. Originals never pass through preview tracks. */
export type StudioRemoteResolution = '720p' | '1080p' | '2k' | '4k';
export type StudioRemoteConfiguration = {
  resolution: StudioRemoteResolution;
  fps: 24 | 30 | 60;
  cameraFacing: 'front' | 'back';
  pro?: Record<string, unknown>;
  imageGrade?: StudioGrade;
  /** null uses the iPhone's automatic route; strings are native available-input UIDs. */
  audioInputId?: string | null;
};
export type StudioRemoteAudioPort = { id: string; name: string; type: string };
export type StudioRemoteAudioInput = {
  version: 1; available: StudioRemoteAudioPort[]; preferredId: string | null;
  current: StudioRemoteAudioPort | null; confirmed: boolean; selecting: boolean; warning: string | null;
};
export type StudioRemoteAudioMonitor = {
  status: 'waiting' | 'live' | 'unavailable' | 'interrupted';
  input: { id?: string; name: string; type: string } | null;
  channels: { averageDb: number; peakDb: number }[];
  message?: string;
};
export type StudioRemoteMetadata = {
  bytes: number; mime: string; width: number; height: number; fps: number; duration: number;
  startedAtServerMs?: number;
};
export type StudioRemoteThumbnailDescriptor = {
  version: 1; hash: string; bytes: number; mime: 'image/jpeg'; width: number; height: number;
};
export type StudioRemoteLocalTake = {
  id: string; metadata: StudioRemoteMetadata; localSaved: true;
  phase: 'local_ready' | 'preparing' | 'uploading' | 'uploaded' | 'error'; error?: string;
};
export type StudioRemoteRecordingEnd = {
  version: 1; takeId: string; finishedAtServerMs: number; durationSeconds: number;
  reason: 'user_stop' | 'app_background' | 'view_inactive' | 'disposed' | 'capture_interrupted' | 'runtime_error' | 'startup_timeout' | 'native_finished';
  interrupted: boolean;
  /** Server-persisted durable source proof; no device paths. */
  startedAtServerMs?: number; sourceMetadata?: StudioRemoteMetadata; localTakeStorage?: 1; reconciledAtServerMs?: number;
};
export type StudioRemoteDeviceState = {
  configuration?: StudioRemoteConfiguration;
  width?: number; height?: number; fps?: number;
  recording?: boolean; deviceName?: string;
  /** Physical storage reported by the paired iPhone, in decimal bytes. */
  storageAvailableBytes?: number; storageTotalBytes?: number;
  recordingEnd?: StudioRemoteRecordingEnd;
  capabilities?: Record<string, unknown>; pro?: Record<string, unknown>;
  audioInput?: StudioRemoteAudioInput;
  audioMonitor?: StudioRemoteAudioMonitor;
  /** Durable originals, without device paths or public media URLs. */
  localTakes?: StudioRemoteLocalTake[];
  error?: string | null;
  [key: string]: unknown;
};
export type StudioRemoteSession = {
  id: string; projectId: string | null; kind: 'aula' | 'short'; title: string;
  status: 'pairing' | 'ready' | 'starting' | 'recording' | 'stopping' | 'closed';
  controllerId: string; deviceId: string | null; sequence: number; activeTakeId: string | null;
  configuration: StudioRemoteConfiguration; deviceState: StudioRemoteDeviceState | null;
  createdAt: string; expiresAt: string; pairedAt: string | null;
  controllerSeenAt: string | null; deviceSeenAt: string | null; closedAt: string | null;
};
export type StudioRemoteCommand = {
  id: string; sequence: number; type: 'configure' | 'start' | 'stop' | 'resume_upload';
  payload: Record<string, unknown>; status: 'pending' | 'applied' | 'failed';
  createdAt: string; acknowledgedAt: string | null; result: Record<string, unknown> | null;
};
export type StudioRemoteTake = {
  id: string; status: 'reserved' | 'recording' | 'local_ready' | 'uploading' | 'uploaded' | 'failed';
  recordingEnd?: StudioRemoteRecordingEnd | null;
  thumbnail?: StudioRemoteThumbnailDescriptor | null;
  metadata: StudioRemoteMetadata | null; createdAt: string; uploadedAt: string | null;
};
export type StudioRemoteEnvelope = {
  session: StudioRemoteSession; commands: StudioRemoteCommand[]; takes: StudioRemoteTake[]; serverAt: string;
};
export type StudioRemoteConnection = { url: string; token: string; identity: string };
export type StudioRemoteResponse = StudioRemoteEnvelope & {
  pairing?: { code: string; expiresAt: string };
  connection?: StudioRemoteConnection;
  upload?: { endpoint: string; bucket: string; path: string; token: string; chunkSize: number;
    partIndex: number; partOffset: number; partBytes: number; totalParts: number; uploaded?: boolean };
  download?: { url?: string; parts: { url: string; index: number; bytes: number }[];
    bytes: number; mime: string; totalParts: number; nextPartIndex: number | null; expiresAt: string };
};

import { Room, RoomEvent, Track, type RemoteTrack, type RemoteParticipant, type RemoteTrackPublication } from 'livekit-client';
import type { StudioRemoteCommand, StudioRemoteConfiguration, StudioRemoteDeviceState, StudioRemoteEnvelope, StudioRemoteLocalTake, StudioRemoteMetadata, StudioRemoteRecordingEnd, StudioRemoteResponse, StudioRemoteSession, StudioRemoteTake, StudioRemoteThumbnailDescriptor } from '../../../../shared/studio/remoteCamera';
import { studioGrade } from '../../../../shared/studio/model';
import type { StudioCaptureController, StudioCaptureState, StudioCaptureVideoPatch } from './capture';
import { inspectStudioMedia, type StudioMediaMetadata } from './media';
import { assertStudioRemoteScope, createStudioRemoteClient, StudioRemoteCameraError, type StudioRemoteClient } from './remoteCameraClient';

export type StudioRemoteStart = { takeId: string; startedAtServerMs: number; result: Record<string, unknown> };
export type StudioRemoteMaster = { file: File; take: StudioRemoteTake; session: StudioRemoteSession; metadata: StudioMediaMetadata };
export type StudioRemoteLocalTakeView = {
  id: string; metadata: StudioRemoteMetadata | null; localSaved: boolean; sessionId?: string; sourceMetadata?: StudioRemoteMetadata;
  phase: StudioRemoteLocalTake['phase'] | StudioRemoteTake['status']; error?: string; thumbnail?: StudioRemoteThumbnailDescriptor | null;
};
const remoteThumbnailDescriptor = (value: unknown): StudioRemoteThumbnailDescriptor | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const t = value as StudioRemoteThumbnailDescriptor;
  return t.version === 1 && typeof t.hash === 'string' && /^[a-f0-9]{64}$/.test(t.hash) && t.mime === 'image/jpeg' && Number.isSafeInteger(t.bytes) && t.bytes > 0 && t.bytes <= 16384 && [t.width, t.height].every(side => Number.isSafeInteger(side) && side > 0 && side <= 320) ? { version: 1, hash: t.hash, bytes: t.bytes, mime: 'image/jpeg', width: t.width, height: t.height } : null;
};
/** Only this versioned capability changes STOP semantics; older apps still transfer. */
export const studioRemoteLocalStorage = (device?: StudioRemoteDeviceState | null) => device?.capabilities?.localTakeStorage === 1;
export function studioRemoteLocalTakes(envelope: StudioRemoteEnvelope): StudioRemoteLocalTakeView[] {
  const result = new Map<string, StudioRemoteLocalTakeView>(envelope.takes.map(take => {
    const end = take.recordingEnd, raw = end?.sourceMetadata;
    const durable = !!raw && end?.version === 1 && end.takeId === take.id && end.localTakeStorage === 1 && end.interrupted === true && Number.isSafeInteger(raw.bytes) && raw.bytes > 0 && [raw.duration, raw.width, raw.height, raw.fps].every(value => Number.isFinite(value) && value > 0);
    return [take.id, { id: take.id, sessionId: envelope.session.id, metadata: take.metadata ?? (durable ? raw! : null), localSaved: durable, ...(durable ? { sourceMetadata: raw } : {}), phase: take.status, ...(take.thumbnail === null ? { thumbnail: null } : remoteThumbnailDescriptor(take.thumbnail) ? { thumbnail: remoteThumbnailDescriptor(take.thumbnail) } : {}) }];
  }));
  for (const entry of Array.isArray(envelope.session.deviceState?.localTakes) ? envelope.session.deviceState.localTakes.slice(-24) : []) {
    const m = entry?.metadata;
    if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 128 || entry.localSaved !== true || !m || !Number.isSafeInteger(m.bytes) || m.bytes <= 0 || ![m.duration, m.width, m.height, m.fps].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0) || typeof m.mime !== 'string' || !['local_ready', 'preparing', 'uploading', 'uploaded', 'error'].includes(entry.phase)) continue;
    const server = envelope.takes.find(take => take.id === entry.id);
    // Uploaded authority and its final metadata belong to the server. Raw
    // metadata remains useful before grading/upload has ever been requested.
    result.set(entry.id, { id: entry.id, sessionId: envelope.session.id, sourceMetadata: m, metadata: server?.status === 'uploaded' && server.metadata ? server.metadata : m, localSaved: true, phase: server?.status === 'uploaded' ? 'uploaded' : entry.phase, ...(result.get(entry.id)?.thumbnail !== undefined ? { thumbnail: result.get(entry.id)!.thumbnail } : {}), ...(typeof entry.error === 'string' && entry.error ? { error: entry.error.slice(0, 300) } : {}) });
  }
  return [...result.values()];
}
/** A physical end belongs to one take; an old heartbeat can never stop a new REC. */
export function studioRemoteRecordingEnd(envelope: StudioRemoteEnvelope, takeId: string, startedAtServerMs?: number): StudioRemoteRecordingEnd | null {
  const end = envelope.takes.find(take => take.id === takeId)?.recordingEnd ?? envelope.session.deviceState?.recordingEnd;
  if (!end || end.version !== 1 || end.takeId !== takeId || envelope.session.deviceState?.recording !== false || typeof end.interrupted !== 'boolean' ||
    !Number.isFinite(end.finishedAtServerMs) || !Number.isFinite(end.durationSeconds) || end.durationSeconds < 0 || end.durationSeconds > 86400 ||
    !['user_stop', 'app_background', 'view_inactive', 'disposed', 'capture_interrupted', 'runtime_error', 'startup_timeout', 'native_finished'].includes(end.reason) ||
    end.finishedAtServerMs > Date.parse(envelope.serverAt) + 3000 || startedAtServerMs !== undefined && (end.finishedAtServerMs < startedAtServerMs || end.durationSeconds > (end.finishedAtServerMs - startedAtServerMs) / 1000 + 3)) return null;
  return end;
}
const interruptedTakeMessage = (duration: number) => `A gravação foi interrompida no iPhone. ${duration > 0 ? `O trecho capturado de ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')} foi preservado; confira antes de continuar.` : 'Confira o original no aparelho antes de continuar.'}`;
export type StudioRemotePreviewDiagnostic = {
  stage: 'recovery-pending' | 'requesting-grant' | 'connecting' | 'room-connected' | 'media-received' | 'media-timeout' | 'subscription-failed' | 'disconnected';
  message: string | null;
  roomState?: string; participantCount?: number; expectedParticipantPresent?: boolean;
  expectedVideoCount?: number; subscribedVideoCount?: number; mutedVideoCount?: number; reasonCode?: number;
};
export type StudioRemoteView = {
  pairing: { code: string; expiresAt: string } | null;
  connection: 'idle' | 'pairing' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  session: StudioRemoteSession | null;
  transfer: 'idle' | 'waiting' | 'uploading' | 'downloading' | 'validating' | 'complete' | 'retry';
  transferBytes?: number; transferTotalBytes?: number;
  pendingTakeId: string | null; error: string | null;
  localFirst?: boolean; localTakes?: StudioRemoteLocalTakeView[]; transferTakeId?: string | null;
  previewDiagnostic?: StudioRemotePreviewDiagnostic | null;
  recordingEnd?: StudioRemoteRecordingEnd | null;
};
export type StudioRemotePreview = { disconnect(): Promise<void>; reconnect?(): Promise<void>; configure?(id: string, patch: Partial<StudioRemoteConfiguration>): Promise<StudioRemoteDeviceState> };
export type StudioRemotePreviewFactory = (response: StudioRemoteResponse, callbacks: { track(track: MediaStreamTrack | null): void; connection(value: StudioRemoteView['connection']): void; diagnostic?(value: StudioRemotePreviewDiagnostic): void }, signal: AbortSignal) => Promise<StudioRemotePreview>;
/** Older apps keep their existing audio route; new apps must confirm the chosen input. */
export function studioRemoteAudioReady(device: StudioRemoteDeviceState | null | undefined): boolean {
  if (device?.capabilities?.audioInputSelection !== true) return true;
  const audio = device.audioInput;
  return !!audio?.confirmed && !audio.selecting && !!audio.current && (audio.preferredId === null || audio.preferredId === audio.current.id);
}
export type StudioRemoteCaptureController = StudioCaptureController & {
  remoteStart(): Promise<StudioRemoteStart>;
  remoteStop(): Promise<StudioRemoteMaster>;
  finishLocalTake?(): Promise<StudioRemoteLocalTakeView>;
  receiveRemoteTake?(takeId: string): Promise<StudioRemoteMaster>;
  configureRemote(patch: Partial<StudioRemoteConfiguration>): Promise<void>;
  subscribeRemote(listener: (state: StudioRemoteView) => void): () => void;
  getReceivedCameraTrack(): MediaStreamTrack | null;
  reconnect(): Promise<void>;
  getEnvelope(): StudioRemoteEnvelope | null;
  getServerNow(): number;
  discardRemoteRecovery(): void;
  persistRemoteContext?(): void;
  unlinkRemote(): Promise<void>;
};

const controllerStorageKey = (owner: string) => `classfy:studio:remote-controller:v1:${owner}`;
const controllerUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Cancellation must settle our owner even when a provider ignores its signal. */
function boundedRemoteWork<T>(work: Promise<T>, signal: AbortSignal, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (done: () => void) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); done(); };
    const abort = () => finish(() => reject(new DOMException('Conexão cancelada.', 'AbortError')));
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => finish(() => reject(new StudioRemoteCameraError(message, 'preview_timeout'))), milliseconds);
    void work.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    if (signal.aborted) abort();
  });
}
/** Device binding belongs to this signed-in account and this browser's storage. */
export function studioRemoteControllerId(owner: string, persist = true): string {
  if (persist) { try { const existing = localStorage.getItem(controllerStorageKey(owner)); if (existing && controllerUUID.test(existing)) return existing; } catch { /* Private browsing may deny storage. */ } }
  const id = crypto.randomUUID();
  if (persist) { try { localStorage.setItem(controllerStorageKey(owner), id); } catch { /* QR pairing remains available without browser persistence. */ } }
  return id;
}

/** Subscribe only. The web controller never requests or publishes a camera or microphone. */
export const connectStudioRemotePreview: StudioRemotePreviewFactory = async (response, callbacks, signal) => {
  const connection = response.connection, deviceId = response.session.deviceId;
  if (!connection || !deviceId) throw new StudioRemoteCameraError('Aguarde a conexão do iPhone.');
  const room = new Room({ adaptiveStream: false, dynacast: true }); let closed = false;
  const identity = `studio-device-${response.session.id}-${deviceId}`;
  let firstMediaTimer: ReturnType<typeof setTimeout> | undefined, receivedMedia = false;
  const report = (stage: StudioRemotePreviewDiagnostic['stage'], message: string | null = null, reason?: unknown) => {
    if (closed || signal.aborted) return;
    const participant = room.remoteParticipants.get(identity);
    const videos = [...participant?.trackPublications.values() ?? []].filter(publication => publication.kind === Track.Kind.Video);
    const detail: StudioRemotePreviewDiagnostic = { stage, message,
      roomState: ['connected', 'connecting', 'reconnecting', 'signalReconnecting', 'disconnected'].includes(room.state) ? room.state : 'unknown',
      participantCount: room.remoteParticipants.size, expectedParticipantPresent: !!participant,
      expectedVideoCount: videos.length, subscribedVideoCount: videos.filter(publication => publication.isSubscribed).length,
      mutedVideoCount: videos.filter(publication => publication.isMuted).length,
      ...(typeof reason === 'number' && Number.isFinite(reason) ? { reasonCode: reason } : {}) };
    // Never log the SDK event, token, URL, SID, participant identity or session.
    if (message) console.warn('[Classfy Studio] Prévia da câmera', detail);
    else console.info('[Classfy Studio] Prévia da câmera', detail);
    callbacks.diagnostic?.(detail);
  };
  const watchFirstMedia = () => {
    clearTimeout(firstMediaTimer);
    firstMediaTimer = setTimeout(() => {
      if (receivedMedia || closed || signal.aborted) return;
      const participant = room.remoteParticipants.get(identity);
      const hasVideo = !!participant && [...participant.trackPublications.values()].some(publication => publication.kind === Track.Kind.Video);
      report('media-timeout', !participant ? 'A conexão abriu, mas o iPhone ainda não apareceu nesta prévia. Reconecte a câmera.' : !hasVideo ? 'O iPhone está conectado, mas ainda não publicou a câmera. Reconecte a prévia no app.' : 'A câmera foi publicada, mas a imagem ainda não chegou ao navegador. Reconecte a prévia.');
    }, 20_000);
  };
  const settings = new Map<string, { resolve(state: StudioRemoteDeviceState): void; reject(cause: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const rejectSettings = () => { for (const pending of settings.values()) { clearTimeout(pending.timer); pending.reject(new DOMException('Conexão cancelada.', 'AbortError')); } settings.clear(); };
  const data = (payload: Uint8Array, participant: RemoteParticipant | undefined, _kind: unknown, topic?: string) => {
    if (closed || signal.aborted || participant?.identity !== identity || topic !== 'classfy-studio-camera-control-ack-v1' || payload.byteLength > 16384) return;
    try {
      const receipt = JSON.parse(new TextDecoder().decode(payload));
      if (receipt.v !== 1 || typeof receipt.id !== 'string') return;
      const pending = settings.get(receipt.id); if (!pending) return;
      if (receipt.ok === true && receipt.state && receipt.state.configurationConfirmed === true && receipt.state.pro && typeof receipt.state.pro === 'object' && !Array.isArray(receipt.state.pro)) {
        settings.delete(receipt.id); clearTimeout(pending.timer); pending.resolve(receipt.state);
      } else if (receipt.ok === false) { settings.delete(receipt.id); clearTimeout(pending.timer); pending.reject(new StudioRemoteCameraError(typeof receipt.error === 'string' ? receipt.error : 'O iPhone não confirmou o ajuste direto.', 'live_configuration_failed')); }
    } catch { /* A malformed packet has no authority over the camera. */ }
  };
  room.on(RoomEvent.DataReceived, data);
  const published = (publication: RemoteTrackPublication, participant: RemoteParticipant) => { if (!closed && !signal.aborted) publication.setSubscribed(participant.identity === identity && publication.kind === Track.Kind.Video); };
  const subscribed = (track: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
    if (!closed && !signal.aborted && participant.identity === identity && track.kind === Track.Kind.Video) {
      // Camera direction needs the freshest frame. LiveKit guards unsupported
      // receivers; this optional hint must never prevent the preview from opening.
      try { track.setPlayoutDelay(0); } catch { /* Keep preview usable if the browser rejects the hint. */ }
      receivedMedia = true; clearTimeout(firstMediaTimer); report('media-received');
      callbacks.track(track.mediaStreamTrack);
    }
  };
  room.on(RoomEvent.TrackSubscribed, subscribed);
  room.on(RoomEvent.TrackPublished, published);
  room.on(RoomEvent.TrackSubscriptionFailed, (_trackSid, participant, reason) => {
    if (participant.identity !== identity) return;
    report('subscription-failed', reason === 1 ? 'O navegador não conseguiu receber o formato de vídeo da câmera. Reconecte a prévia.' : reason === 2 ? 'A câmera publicada não está mais disponível nesta conexão. Reconecte a prévia.' : 'A conexão não conseguiu receber a câmera do iPhone. Reconecte a prévia.', reason);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => { if (!closed && participant.identity === identity && track.kind === Track.Kind.Video) callbacks.track(null); });
  room.on(RoomEvent.Reconnecting, () => { if (!closed) callbacks.connection('reconnecting'); });
  room.on(RoomEvent.Reconnected, () => { if (!closed) { callbacks.connection('connected'); if (!receivedMedia) watchFirstMedia(); } });
  room.on(RoomEvent.Disconnected, reason => { if (!closed) { clearTimeout(firstMediaTimer); report('disconnected', reason === 2 ? 'Esta prévia foi aberta em outra aba. Reconecte para continuar aqui.' : 'A conexão de vídeo foi interrompida. Reconectando a prévia…', reason); rejectSettings(); callbacks.track(null); callbacks.connection('disconnected'); } });
  const disconnect = async () => { if (closed) return; closed = true; clearTimeout(firstMediaTimer); signal.removeEventListener('abort', abort); room.removeAllListeners(); rejectSettings(); callbacks.track(null); await room.disconnect(); };
  const abort = () => { void disconnect(); }; signal.addEventListener('abort', abort, { once: true });
  const configure = (id: string, patch: Partial<StudioRemoteConfiguration>) => new Promise<StudioRemoteDeviceState>((resolve, reject) => {
    if (closed || signal.aborted || !room.remoteParticipants.has(identity)) { reject(new StudioRemoteCameraError('A câmera direta está desconectada.')); return; }
    if (settings.has(id) || settings.size >= 128) { reject(new StudioRemoteCameraError('Aguarde o ajuste direto em andamento.')); return; }
    if (!controllerUUID.test(id) || !patch || !Object.keys(patch).length || Object.keys(patch).some(key => key !== 'pro' && key !== 'imageGrade')) { reject(new StudioRemoteCameraError('O ajuste direto é inválido.')); return; }
    const payload = new TextEncoder().encode(JSON.stringify({ v: 1, id, patch }));
    if (payload.byteLength > 8192) { reject(new StudioRemoteCameraError('O ajuste da câmera é grande demais.')); return; }
    const timer = setTimeout(() => { settings.delete(id); reject(new StudioRemoteCameraError('A câmera direta não respondeu.', 'live_configuration_timeout')); }, 800);
    settings.set(id, { resolve, reject, timer });
    void room.localParticipant.publishData(payload, { reliable: true, topic: 'classfy-studio-camera-control-v1', destinationIdentities: [identity] }).catch(cause => { const pending = settings.get(id); if (pending) { settings.delete(id); clearTimeout(pending.timer); pending.reject(cause); } });
  });
  try { callbacks.connection('connecting'); report('connecting'); await room.connect(connection.url, connection.token, { autoSubscribe: false }); if (signal.aborted || closed) throw new DOMException('Conexão cancelada.', 'AbortError'); room.remoteParticipants.forEach(participant => participant.trackPublications.forEach(publication => published(publication, participant))); report('room-connected'); if (!receivedMedia) watchFirstMedia(); callbacks.connection('connected'); return { disconnect, configure }; }
  catch (error) { await disconnect(); throw error; }
};

export function remoteStudioProfile(envelope: StudioRemoteEnvelope, kind: 'aula' | 'short') {
  const device = envelope.session.deviceState, configuration = device?.configuration ?? envelope.session.configuration;
  const edge = configuration.resolution === '4k' ? 2160 : configuration.resolution === '2k' ? 1440 : configuration.resolution === '720p' ? 720 : 1080;
  const width = Number(device?.width) || (kind === 'short' ? edge : Math.round(edge * 16 / 9)), height = Number(device?.height) || (kind === 'short' ? Math.round(edge * 16 / 9) : edge);
  const resolutions = device?.capabilities?.resolutions;
  const available = Array.isArray(resolutions) ? resolutions.filter(value => ['720p', '1080p', '2k', '4k'].includes(String(value))) : [];
  const profiles = (available.length ? available : [configuration.resolution]).map(value => { const short = value === '4k' ? 2160 : value === '2k' ? 1440 : value === '720p' ? 720 : 1080; return { width: kind === 'short' ? short : Math.round(short * 16 / 9), height: kind === 'short' ? Math.round(short * 16 / 9) : short, label: value === '4k' ? '4K' : value === '2k' ? '2K' : String(value) }; });
  const qualityProfiles = device?.capabilities?.qualityProfiles;
  const quality = Array.isArray(qualityProfiles) ? qualityProfiles.find(value => value && typeof value === 'object' && (value as Record<string, unknown>).resolution === configuration.resolution) as Record<string, unknown> | undefined : undefined;
  const reportedFPS = quality?.frameRates ?? quality?.fps ?? device?.capabilities?.frameRates ?? device?.capabilities?.fps;
  const frameRates = Array.isArray(reportedFPS) ? reportedFPS.filter((value): value is number => typeof value === 'number' && [24, 30, 60].includes(value)) : [configuration.fps];
  return { width, height, frameRate: Number(device?.fps) || configuration.fps, resolutions: profiles, frameRates: frameRates.length ? frameRates : [configuration.fps] };
}

/** Receipts come from original bytes, never from the low-bandwidth preview. */
export async function validateStudioRemoteMaster(blob: Blob, take: StudioRemoteTake, inspect = inspectStudioMedia, signal?: AbortSignal): Promise<StudioRemoteMaster['metadata']> {
  const expected = take.metadata;
  if (take.status !== 'uploaded' || !expected || !Number.isSafeInteger(expected.bytes) || expected.bytes <= 0 || blob.size !== expected.bytes) throw new StudioRemoteCameraError('O original recebido está incompleto. Retome a transferência.', 'original_incomplete');
  const metadata = await inspect(blob, { signal });
  if (metadata.kind !== 'video' || metadata.width !== expected.width || metadata.height !== expected.height || !metadata.hasAudio || Math.abs(metadata.duration - expected.duration) > Math.max(.4, expected.duration * .02)) throw new StudioRemoteCameraError('O original não corresponde ao take confirmado no iPhone. Receba o original novamente.', 'original_mismatch');
  return metadata;
}

export function createStudioRemoteCapture(options: { owner: string; kind: 'aula' | 'short'; title?: string; projectId?: string; getContext?: () => { title?: string; projectId?: string }; controllerId?: string; resumeSessionId?: string; resumeTakeId?: string; persist?: boolean; client?: StudioRemoteClient; preview?: StudioRemotePreviewFactory; inspect?: typeof inspectStudioMedia; commandTimeoutMs?: number; transferTimeoutMs?: number }): StudioRemoteCaptureController {
  const client = options.client ?? createStudioRemoteClient(options.owner); let clientId = options.controllerId ?? studioRemoteControllerId(options.owner, options.persist !== false);
  const recoveryKey = () => `classfy:studio:remote-camera:v1:${options.owner}:${options.getContext?.().projectId ?? options.projectId ?? 'new'}:${options.kind}`;
  const ownedRecoveryKeys = new Set<string>();
  const catalogKey = () => `classfy:studio:remote-library:v1:${options.owner}:${options.getContext?.().projectId ?? options.projectId ?? 'new'}:${options.kind}`;
  const ownedCatalogKeys = new Set<string>();
  type Intent = { sessionId: string; controllerId: string; takeId: string; startId?: string; stopId?: string; resumeId?: string };
  let forgotten = false, configuring = false;
  type ConfigurationWaiter = { resolve(): void; reject(error: unknown): void };
  let queuedConfiguration: Partial<StudioRemoteConfiguration> | null = null, configurationWaiters: ConfigurationWaiter[] = [];
  let configurationIntent: { id: string; patch: Partial<StudioRemoteConfiguration>; uncertain: boolean } | null = null;
  let queuedConfigurationId: string | null = null, liveDesired: Partial<StudioRemoteConfiguration> | null = null;
  let liveReceipt: { id: string; order: number; state: StudioRemoteDeviceState } | null = null, liveOrder = 0;
  const liveJobs = new Map<string, Promise<StudioRemoteDeviceState | null>>();
  let generation = 0, disposed = false, lifecycle = new AbortController(), envelope: StudioRemoteEnvelope | null = null, preview: StudioRemotePreview | null = null, cameraTrack: MediaStreamTrack | null = null;
  type PreviewLease = { abort: AbortController; transport: StudioRemotePreview | null; releaseLifecycle(): void };
  let previewLease: PreviewLease | null = null;
  let pollAbort: AbortController | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null, heartbeatAt = 0, serverOffset = 0, bestRTT = Infinity, polling: Promise<void> | null = null, connecting: Promise<void> | null = null, reconnectWork: Promise<void> | null = null, prepareWork: Promise<void> | null = null, startWork: Promise<StudioRemoteStart> | null = null, stopWork: Promise<StudioRemoteMaster> | null = null;
  let finishWork: Promise<StudioRemoteLocalTakeView> | null = null, receiveWork: Promise<StudioRemoteMaster> | null = null;
  const receivedMasters = new Map<string, StudioRemoteMaster>(), transferCommands = new Map<string, string>();
  let pendingStart: { id: string; takeId: string } | null = null, pendingStop: { id: string; takeId: string } | null = null, pendingResume: { id: string; takeId: string } | null = null, lastStart: StudioRemoteStart | null = null, cachedMaster: StudioRemoteMaster | null = null;
  const listeners = new Set<(state: StudioCaptureState) => void>(), remoteListeners = new Set<(state: StudioRemoteView) => void>();
  let state: StudioCaptureState = { phase: 'idle', stream: null, elapsed: 0, file: null, error: null, input: null, camera: null, devices: { cameras: [], microphones: [] }, microphoneEnabled: true, levels: [] };
  let remote: StudioRemoteView = { pairing: null, connection: 'idle', session: null, transfer: 'idle', pendingTakeId: null, error: null };
  const snapshot = () => ({ ...state, devices: { cameras: [], microphones: [] }, levels: [], ...(state.videoControls ? { videoControls: structuredClone(state.videoControls) } : {}), ...(state.outputVideo ? { outputVideo: structuredClone(state.outputVideo) } : {}) });
  const configurationPending = () => configuring || !!configurationIntent || !!envelope?.commands.some(command => command.type === 'configure' && command.status === 'pending');
  const view = () => structuredClone({ ...(liveReceipt && remote.session ? { ...remote, session: { ...remote.session, deviceState: { ...remote.session.deviceState,
    pro: liveReceipt.state.pro, configuration: liveReceipt.state.configuration, imageGrade: liveReceipt.state.imageGrade } } } : remote), error: remote.error ?? remote.previewDiagnostic?.message ?? null });
  const publish = (patch: Partial<StudioCaptureState>) => { if (disposed) return; state = { ...state, ...patch }; listeners.forEach(listener => listener(snapshot())); };
  const publishRemote = (patch: Partial<StudioRemoteView>) => { if (disposed) return; remote = { ...remote, ...patch }; remoteListeners.forEach(listener => listener(view())); };
  const scope = (token = generation) => ({ signal: lifecycle.signal, isCurrent: () => !disposed && token === generation });
  const assert = (token: number) => assertStudioRemoteScope(scope(token));
  const releasePreview = async (lease = previewLease) => {
    if (!lease || lease.abort.signal.aborted) return;
    if (previewLease === lease) {
      previewLease = null; preview = null; cameraTrack = null;
      publish({ stream: null, cameraPreviewStream: null });
    }
    lease.releaseLifecycle(); lease.abort.abort();
    // Teardown is best effort. A provider whose disconnect never settles must
    // not keep the browser's next connection or its heartbeat behind a promise.
    void lease.transport?.disconnect().catch(() => undefined);
  };
  const persistIntent = () => {
    if (options.persist === false || forgotten) return;
    const takeId = remote.pendingTakeId ?? pendingStart?.takeId ?? envelope?.session.activeTakeId ?? (remote.localFirst ? [...remote.localTakes ?? []].reverse().find(take => take.localSaved && take.sessionId === envelope?.session.id)?.id : undefined);
    try { if (envelope && takeId) { const key = recoveryKey(); for (const previous of ownedRecoveryKeys) if (previous !== key) localStorage.removeItem(previous); ownedRecoveryKeys.clear(); ownedRecoveryKeys.add(key); localStorage.setItem(key, JSON.stringify({ sessionId: envelope.session.id, controllerId: clientId, takeId, startId: pendingStart?.id, stopId: pendingStop?.id, resumeId: pendingResume?.id } satisfies Intent)); } } catch { /* Phone retains its original if browser storage is unavailable. */ }
  };
  const forgetIntent = () => { forgotten = true; ownedRecoveryKeys.add(recoveryKey()); try { for (const key of ownedRecoveryKeys) localStorage.removeItem(key); ownedRecoveryKeys.clear(); } catch { /* Best effort metadata cleanup, never delete the phone original. */ } };
  const durableTakes = new Map<string, StudioRemoteLocalTakeView>();
  const persistCatalog = () => {
    if (options.persist === false) return;
    try {
      const key = catalogKey(); localStorage.setItem(key, JSON.stringify([...durableTakes.values()].filter(take => take.localSaved || take.phase === 'uploaded').slice(-100)));
      // The first browser import assigns the pending library to its real project.
      for (const previous of ownedCatalogKeys) if (previous !== key) localStorage.removeItem(previous);
      ownedCatalogKeys.clear(); ownedCatalogKeys.add(key);
    } catch { /* Phone originals remain authoritative if browser metadata is full. */ }
  };
  const restoreCatalog = () => {
    if (options.persist === false) return;
    try {
      const key = catalogKey(), entries = JSON.parse(localStorage.getItem(key) ?? '[]'); ownedCatalogKeys.add(key);
      if (!Array.isArray(entries)) return;
      for (const take of entries.slice(-100)) {
        const metadata = take?.metadata;
        if (!take || typeof take.id !== 'string' || !take.id || typeof take.sessionId !== 'string' || !take.sessionId || !['local_ready', 'preparing', 'uploading', 'uploaded', 'error', 'failed'].includes(take.phase) || !metadata || !Number.isSafeInteger(metadata.bytes) || metadata.bytes <= 0 || ![metadata.duration, metadata.width, metadata.height, metadata.fps].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0) || typeof metadata.mime !== 'string') continue;
        durableTakes.set(take.id, { id: take.id, sessionId: take.sessionId, metadata, ...(take.sourceMetadata && Number.isSafeInteger(take.sourceMetadata.bytes) && take.sourceMetadata.bytes > 0 && [take.sourceMetadata.duration, take.sourceMetadata.width, take.sourceMetadata.height, take.sourceMetadata.fps].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0) && typeof take.sourceMetadata.mime === 'string' ? { sourceMetadata: take.sourceMetadata } : {}), localSaved: take.localSaved === true, phase: take.phase, ...(take.thumbnail === null ? { thumbnail: null } : remoteThumbnailDescriptor(take.thumbnail) ? { thumbnail: remoteThumbnailDescriptor(take.thumbnail) } : {}) });
      }
    } catch { /* Untrusted/malformed browser metadata cannot start a capture. */ }
    publishRemote({ localTakes: [...durableTakes.values()] });
  };
  const adopt = (response: StudioRemoteResponse, token: number) => {
    assert(token); if (response.session.kind !== options.kind) throw new StudioRemoteCameraError('A conexão do iPhone não confirmou o formato escolhido. Conecte novamente.', 'session_kind_mismatch');
    if (envelope && response.session.id !== envelope.session.id) throw new StudioRemoteCameraError('A sessão da câmera mudou.');
    if (envelope && response.session.sequence < envelope.session.sequence) return;
    // A status request started before an ACK can finish after it. Terminal
    // receipts are immutable; that older snapshot must not undo confirmation.
    if (envelope && response.session.sequence === envelope.session.sequence && (
      envelope.session.status === 'closed' && response.session.status !== 'closed' ||
      envelope.commands.some(previous => previous.status !== 'pending' && response.commands.some(next => next.id === previous.id && next.status === 'pending'))
    )) return;
    for (const incoming of studioRemoteLocalTakes(response)) { const previous = durableTakes.get(incoming.id), take = incoming.thumbnail === undefined && previous?.thumbnail ? { ...incoming, thumbnail: previous.thumbnail } : incoming; durableTakes.set(take.id, previous?.localSaved && !take.localSaved ? { ...take, localSaved: true, sourceMetadata: previous.sourceMetadata, metadata: take.metadata ?? previous.metadata } : take); }
    persistCatalog();
    envelope = response;
    if (liveReceipt && response.session.deviceState?.liveConfigurationId === liveReceipt.id && response.session.deviceState.configurationConfirmed === true) liveReceipt.state = response.session.deviceState;
    if (configurationIntent && (response.session.status === 'closed' || response.commands.some(command => command.id === configurationIntent?.id && command.status !== 'pending'))) configurationIntent = null;
    // Retain the proven browser identity separately from per-take recovery;
    // successfully saving a take must not erase its computer pairing.
    if (options.persist !== false && response.session.controllerId === clientId && controllerUUID.test(clientId)) { try { localStorage.setItem(controllerStorageKey(options.owner), clientId); } catch { /* The server remains authoritative. */ } }
    publishRemote({ session: response.session, localFirst: studioRemoteLocalStorage(response.session.deviceState), localTakes: [...durableTakes.values()], error: typeof response.session.deviceState?.error === 'string' ? response.session.deviceState.error : null }); persistIntent();
    const profile = remoteStudioProfile(response, options.kind);
    const confirmed = response.session.deviceState?.configurationConfirmed !== false && response.session.deviceState?.imageGradeConfirmed !== false && Number(response.session.deviceState?.width) > 0 && Number(response.session.deviceState?.height) > 0 && Number(response.session.deviceState?.fps) > 0;
    publish({ width: confirmed ? profile.width : undefined, height: confirmed ? profile.height : undefined, frameRate: confirmed ? profile.frameRate : undefined, camera: response.session.deviceId ? { id: response.session.deviceId, name: response.session.deviceState?.deviceName || 'iPhone · Câmera remota' } : null,
      videoControls: confirmed ? { busy: configurationPending(), processed: false, effects: false, grade: studioGrade(), zoom: { mode: 'none', min: 1, max: 1, step: 1, value: 1 }, resolutions: profile.resolutions, frameRates: profile.frameRates } : null, outputVideo: confirmed ? { resolutions: profile.resolutions, frameRates: profile.frameRates, sourceWidth: profile.width, sourceHeight: profile.height, sourceFrameRate: profile.frameRate, scaled: false } : null });
    if (response.session.deviceState?.error) publishRemote({ error: String(response.session.deviceState.error) });
    if (!confirmed && (response.session.deviceState?.configurationConfirmed === false || response.session.deviceState?.imageGradeConfirmed === false) && !remote.pendingTakeId && !pendingStart) publish({ phase: 'error', pendingRecovery: false, error: 'O iPhone não confirmou os ajustes. Restaure o modo Auto ou ajuste novamente antes de gravar.' });
    if (confirmed && response.session.status === 'ready' && cameraTrack && (state.phase === 'preparing' || state.phase === 'error' && !state.pendingRecovery) && !pendingStart) publish({ phase: 'ready', error: null });
    const physicalEnd = lastStart ? studioRemoteRecordingEnd(response, lastStart.takeId, lastStart.startedAtServerMs) : null;
    if (physicalEnd && (state.phase === 'recording' || physicalEnd.interrupted && state.phase === 'stopping')) {
      const confirmedSource = studioRemoteLocalTakes(response).some(take => take.id === physicalEnd.takeId && take.localSaved);
      const message = physicalEnd.interrupted ? confirmedSource ? interruptedTakeMessage(physicalEnd.durationSeconds) : 'A gravação foi interrompida no iPhone. Aguarde a confirmação do trecho no aparelho antes de continuar.' : 'A gravação terminou no iPhone. Confira o trecho salvo antes de continuar.';
      publishRemote({ recordingEnd: physicalEnd, error: message });
      publish({ phase: 'error', elapsed: physicalEnd.durationSeconds, pendingRecovery: true, error: message });
    } else if (lastStart && state.phase === 'recording') publish({ elapsed: Math.max(0, (Date.parse(response.serverAt) - lastStart.startedAtServerMs) / 1000) });
  };
  const request = async (body: Record<string, unknown>, token = generation, signal?: AbortSignal) => {
    const sentAt = Date.now(), ownedScope = { ...scope(token), ...(signal ? { signal } : {}) };
    const task = client.request({ ...body, action: String(body.action), clientId }, ownedScope);
    const response = signal ? await boundedRemoteWork(task, signal, 20_000, 'A conexão demorou. Reconecte a prévia para continuar.') : await task;
    assertStudioRemoteScope(ownedScope); const receivedAt = Date.now(); adopt(response, token);
    const rtt = receivedAt - sentAt; if (rtt < bestRTT) { bestRTT = rtt; serverOffset = Date.parse(response.serverAt) - (sentAt + receivedAt) / 2; } return response;
  };
  const connect = async (token: number, signal: AbortSignal) => {
    // Receiving an original and watching the camera are independent. A pending
    // recovery must block REC, never silently prevent this read-only preview.
    // A closed session can still transfer its original without a preview grant.
    if (!envelope?.session.deviceId || preview || envelope.session.status === 'closed') return; if (connecting) return connecting;
    const work = (async () => {
      publishRemote({ previewDiagnostic: { stage: 'requesting-grant', message: null } });
      const response = await request({ action: 'connect', sessionId: envelope!.session.id, role: 'controller' }, token, signal);
      const parentSignal = lifecycle.signal, abort = new AbortController();
      const lease: PreviewLease = { abort, transport: null, releaseLifecycle: () => parentSignal.removeEventListener('abort', cancelLease) };
      const cancelLease = () => { void releasePreview(lease).catch(() => undefined); };
      parentSignal.addEventListener('abort', cancelLease, { once: true }); previewLease = lease;
      const current = () => !disposed && token === generation && previewLease === lease && !abort.signal.aborted;
      try {
        const opening = (options.preview ?? connectStudioRemotePreview)(response, {
          diagnostic(value) { if (current()) publishRemote({ previewDiagnostic: value }); },
          track(track) {
            if (!current()) return; cameraTrack = track;
            publish({ stream: track ? new MediaStream([track]) : null, cameraPreviewStream: track ? new MediaStream([track]) : null });
            if (track && envelope?.session.status === 'ready' && state.width && state.height && state.frameRate && state.phase === 'preparing' && !pendingStart) publish({ phase: 'ready', error: null });
          },
          connection(value) {
            if (!current()) return;
            if (value === 'disconnected') {
              // LiveKit has exhausted its own retry. Release this exact room so
              // the next poll can obtain a fresh grant for the same session.
              void releasePreview(lease).catch(() => undefined);
              if (state.phase === 'ready') publish({ phase: 'preparing' });
              publishRemote({ connection: 'reconnecting', error: null });
            } else publishRemote({ connection: value });
          },
        }, abort.signal);
        // A late factory still owns a physical room and must close it, but may
        // never publish into the replacement lease or hold the poll forever.
        void opening.then(next => { if (!current()) void next.disconnect().catch(() => undefined); }, () => undefined);
        const next = await boundedRemoteWork(opening, abort.signal, 15_000, 'A prévia não respondeu. Reconecte para continuar; seus takes permanecem preservados.');
        lease.transport = next;
        if (!current()) { void next.disconnect().catch(() => undefined); assert(token); return; }
        preview = next;
      } catch (error) { await releasePreview(lease); throw error; }
    })(); connecting = work; void work.finally(() => { if (connecting === work) connecting = null; }).catch(() => undefined); return work;
  };
  const poll = async (token: number) => {
    if (polling) return polling;
    if (pollTimer) clearTimeout(pollTimer); pollTimer = null;
    const parentSignal = lifecycle.signal, abort = new AbortController(), cancelPoll = () => abort.abort();
    parentSignal.addEventListener('abort', cancelPoll, { once: true }); pollAbort = abort;
    const current = () => !disposed && token === generation && pollAbort === abort && !abort.signal.aborted;
    const work = (async () => {
      try {
        if (!envelope || !current()) return;
        await request({ action: 'status', sessionId: envelope.session.id, afterSequence: 0 }, token, abort.signal); assert(token);
        // A lost POST response is indeterminate. If status has no receipt, retry
        // that exact UUID and payload, never a second adjustment or a new REC.
        const intent = configurationIntent;
        if (intent?.uncertain && !envelope.commands.some(command => command.id === intent.id)) {
          try { await request({ action: 'command', sessionId: envelope.session.id, commandId: intent.id, type: 'configure', payload: intent.patch }, token, abort.signal); }
          catch (error) { if (error instanceof StudioRemoteCameraError && error.code.startsWith('studio_camera_') && configurationIntent === intent) { configurationIntent = null; publish({ videoControls: state.videoControls ? { ...state.videoControls, busy: configurationPending() } : null }); } throw error; }
        }
        if (Date.now() - heartbeatAt >= 8000) { await request({ action: 'heartbeat', sessionId: envelope.session.id, role: 'controller' }, token, abort.signal); heartbeatAt = Date.now(); }
        await connect(token, abort.signal);
        if (envelope.session.status === 'closed' && !stopWork) { if (!cachedMaster && (lastStart || remote.pendingTakeId || envelope.takes.some(take => take.status !== 'uploaded'))) publish({ phase: 'error', pendingRecovery: true, error: 'A conexão foi encerrada. O original permanece no iPhone; retome o recebimento do take.' }); else publish({ phase: 'error', error: 'A conexão com o iPhone foi encerrada. Reconecte para continuar.' }); }
      } catch (error) { if (current() && !(error instanceof DOMException && error.name === 'AbortError')) publishRemote({ error: error instanceof Error ? error.message : 'A conexão foi interrompida.' }); }
      finally {
        parentSignal.removeEventListener('abort', cancelPoll);
        if (current() && envelope?.session.status !== 'closed') pollTimer = setTimeout(() => { pollTimer = null; void poll(token); }, 1000);
        if (pollAbort === abort) pollAbort = null;
      }
    })(); polling = work; void work.finally(() => { if (polling === work) polling = null; }); return work;
  };
  const wait = async <T,>(find: () => T | undefined, token: number, milliseconds: number, active?: () => boolean): Promise<T> => {
    let deadline = Date.now() + milliseconds;
    while (true) { assert(token); const result = find(); if (result !== undefined) return result; if (active?.()) deadline = Date.now() + milliseconds; if (Date.now() >= deadline) throw new StudioRemoteCameraError('A confirmação do iPhone demorou. Mantenha o app aberto e retome a transferência; o original permanece no aparelho.', 'ack_timeout'); await poll(token); assert(token); const received = find(); if (received !== undefined) return received; await new Promise<void>((resolve, reject) => { const signal = lifecycle.signal; const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Conexão cancelada.', 'AbortError')); }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 200); signal.addEventListener('abort', abort, { once: true }); }); }
  };
  const command = async (id: string, type: StudioRemoteCommand['type'], payload: Record<string, unknown>, token: number) => {
    if (!envelope) throw new StudioRemoteCameraError('Conecte seu iPhone primeiro.');
    await request({ action: 'command', sessionId: envelope.session.id, commandId: id, type, payload }, token);
    let processingProgress = -1;
    return wait(() => { const receipt = envelope?.commands.find(value => value.id === id); if (receipt?.status === 'failed') throw new StudioRemoteCameraError(typeof receipt.result?.error === 'string' ? receipt.result.error : 'O iPhone não confirmou essa ação.', 'command_failed'); return receipt?.status === 'applied' ? receipt : undefined; }, token, options.commandTimeoutMs ?? 30_000, ['stop','resume_upload'].includes(type) ? () => {
      const device = envelope?.session.deviceState, progress = Number(device?.processingProgress);
      if (device?.processing === true && Number.isFinite(progress) && progress > processingProgress && progress >= 0 && progress <= 1) { processingProgress = progress; return true; }
      return false;
    } : undefined);
  };
  const remoteStart = () => {
    if (startWork) return startWork; if (state.phase === 'recording' && lastStart) return Promise.resolve(lastStart);
    if (!envelope || remote.connection !== 'connected' || !cameraTrack || !['ready', 'preparing', 'error'].includes(state.phase) || remote.pendingTakeId || state.pendingRecovery && !pendingStart) return Promise.reject(new StudioRemoteCameraError('Aguarde o iPhone ficar pronto antes de gravar.'));
    if (envelope.commands.some(command => command.type === 'resume_upload' && command.status === 'pending')) return Promise.reject(new StudioRemoteCameraError('Aguarde o iPhone iniciar o envio antes de gravar outro take.'));
    if (configurationPending()) return Promise.reject(new StudioRemoteCameraError('Aguarde o iPhone confirmar o ajuste antes de gravar.', 'configuration_pending'));
    if (envelope.session.deviceState?.configurationConfirmed === false || envelope.session.deviceState?.imageGradeConfirmed === false) return Promise.reject(new StudioRemoteCameraError('Confirme os ajustes no iPhone antes de gravar.'));
    if (!studioRemoteAudioReady(envelope.session.deviceState)) return Promise.reject(new StudioRemoteCameraError(envelope.session.deviceState?.audioInput?.warning?.trim() || 'Confirme o microfone antes de gravar.', 'audio_input_unconfirmed'));
    const token = generation; pendingStart ??= { id: crypto.randomUUID(), takeId: crypto.randomUUID() }; const intent = pendingStart;
    forgotten = false; persistIntent();
    publish({ phase: 'preparing', error: null });
    const work = (async () => {
      try {
        const ack = await command(intent.id, 'start', { takeId: intent.takeId }, token), takeId = typeof ack.result?.takeId === 'string' ? ack.result.takeId : intent.takeId;
        const startedAtServerMs = Number(ack.result?.startedAtServerMs);
        if (takeId !== intent.takeId || !Number.isFinite(startedAtServerMs)) throw new StudioRemoteCameraError('O iPhone não confirmou o início real deste take.', 'invalid_start');
        lastStart = { takeId, startedAtServerMs, result: ack.result ?? {} }; pendingStart = null; cachedMaster = null;
        pendingResume = null; publishRemote({ pendingTakeId: takeId, recordingEnd: null, ...(!receiveWork ? { transfer: 'idle' as const, transferTakeId: null, transferBytes: undefined, transferTotalBytes: undefined, error: null } : {}) }); persistIntent(); publish({ phase: 'recording', elapsed: 0, file: null, error: null, pendingRecovery: false }); return lastStart;
      } catch (error) { if (!disposed && token === generation) { publish({ phase: 'error', error: error instanceof Error ? error.message : 'Não foi possível iniciar o take.', pendingRecovery: true }); publishRemote({ error: error instanceof Error ? error.message : 'Confirme o estado da gravação no iPhone.' }); } throw error; }
    })(); startWork = work; void work.finally(() => { if (startWork === work) startWork = null; }).catch(() => undefined); return work;
  };
  const finishLocalTake = (): Promise<StudioRemoteLocalTakeView> => {
    if (finishWork) return finishWork;
    if (!envelope || !studioRemoteLocalStorage(envelope.session.deviceState)) return Promise.reject(new StudioRemoteCameraError('Atualize o app do iPhone para salvar no aparelho sem enviar.'));
    const takeId = remote.pendingTakeId ?? lastStart?.takeId ?? pendingStart?.takeId ?? envelope.session.activeTakeId;
    if (!takeId) return Promise.reject(new StudioRemoteCameraError('Nenhum take foi confirmado no iPhone.'));
    const token = generation; pendingStop ??= { id: crypto.randomUUID(), takeId }; persistIntent();
    publish({ phase: 'stopping', pendingRecovery: true, error: null });
    const work = (async () => {
      try {
        await request({ action: 'status', sessionId: envelope!.session.id, afterSequence: 0 }, token);
        if (envelope!.session.activeTakeId && envelope!.session.activeTakeId !== takeId) throw new StudioRemoteCameraError('Outro take está em gravação no iPhone. Finalize pelo app para continuar.');
        const isDurable = () => studioRemoteLocalTakes(envelope!).find(take => take.id === takeId && take.localSaved);
        if (!isDurable() || envelope!.session.activeTakeId === takeId || ['starting', 'recording', 'stopping'].includes(envelope!.session.status)) {
          try { await command(pendingStop!.id, 'stop', { takeId }, token); }
          catch (error) {
            // The server can retire a pending STOP after the native writer has
            // already ended. Only its matching durable receipt permits recovery.
            if (!isDurable() || envelope!.session.activeTakeId || envelope!.session.status !== 'ready' || !studioRemoteRecordingEnd(envelope!, takeId)?.interrupted) throw error;
          }
        }
        const saved = await wait(() => {
          const take = isDurable();
          return take && !envelope!.session.activeTakeId && envelope!.session.status === 'ready' && envelope!.session.deviceState?.recording !== true ? take : undefined;
        }, token, options.commandTimeoutMs ?? 30_000);
        pendingStart = null; pendingStop = null; lastStart = null; cachedMaster = null;
        publishRemote({ pendingTakeId: null, error: null }); persistIntent();
        const interrupted = studioRemoteRecordingEnd(envelope!, takeId);
        const warning = interrupted?.interrupted ? interruptedTakeMessage(interrupted.durationSeconds) : null;
        publishRemote({ error: warning });
        publish({ phase: cameraTrack ? 'ready' : 'preparing', elapsed: warning ? interrupted!.durationSeconds : 0, file: null, pendingRecovery: false, error: warning }); return saved;
      } catch (error) {
        if (!disposed && token === generation) publish({ phase: 'error', pendingRecovery: true, error: error instanceof Error ? error.message : 'Confirme no iPhone se o take foi salvo.' });
        throw error;
      }
    })(); finishWork = work; void work.finally(() => { if (finishWork === work) finishWork = null; }).catch(() => undefined); return work;
  };
  const receiveRemoteTake = (takeId: string): Promise<StudioRemoteMaster> => {
    const known = remote.localTakes?.find(take => take.id === takeId);
    if (!envelope && known && known.phase !== 'uploaded') return controller.prepare().then(() => receiveRemoteTake(takeId));
    if (receivedMasters.has(takeId)) return Promise.resolve(receivedMasters.get(takeId)!);
    if (receiveWork) return remote.transferTakeId === takeId ? receiveWork : Promise.reject(new StudioRemoteCameraError('Aguarde o envio atual antes de enviar outro take.'));
    if ((!envelope && !known?.sessionId) || !envelope?.takes.some(take => take.id === takeId) && !(known?.localSaved || known?.phase === 'uploaded')) return Promise.reject(new StudioRemoteCameraError('Este original não foi confirmado nesta sessão.'));
    const token = generation, sessionId = known?.sessionId ?? envelope!.session.id;
    const receiveRequest = async (body: Record<string, unknown>) => {
      if (sessionId === envelope?.session.id) return request({ ...body, sessionId }, token);
      const result = await client.request({ ...body, action: String(body.action), sessionId, clientId }, scope(token)); assert(token);
      if (result.session.id !== sessionId || result.session.kind !== options.kind) throw new StudioRemoteCameraError('O original não pertence a esta gravação.');
      return result;
    };
    publishRemote({ transferTakeId: takeId, transfer: 'waiting', transferBytes: undefined, transferTotalBytes: undefined, error: null });
    const work = (async () => {
      try {
        const originalSession = await receiveRequest({ action: 'status', afterSequence: 0 });
        let take = originalSession.takes.find(take => take.id === takeId);
        if (sessionId !== envelope?.session.id && take?.status !== 'uploaded') throw new StudioRemoteCameraError('Este original pertence a outra sessão. Compartilhe-o pelo app do iPhone e escolha Importar original recebido.');
        if (take?.status !== 'uploaded') {
          if (envelope!.session.activeTakeId || ['starting', 'recording', 'stopping'].includes(envelope!.session.status) || state.phase === 'recording') throw new StudioRemoteCameraError('Finalize este take antes de iniciar um novo envio. Os envios em andamento continuam durante a gravação.');
          let commandId = transferCommands.get(takeId); if (!commandId) { commandId = crypto.randomUUID(); transferCommands.set(takeId, commandId); }
          try { await command(commandId, 'resume_upload', { takeId }, token); }
          catch (error) { if (error instanceof StudioRemoteCameraError && error.code === 'command_failed') transferCommands.delete(takeId); throw error; }
          transferCommands.delete(takeId);
          let lastBytes = -1;
          take = await wait(() => {
            const target = envelope!.takes.find(take => take.id === takeId), device = envelope!.session.deviceState;
            if (target?.status === 'uploaded') return target;
            publishRemote({ transfer: 'uploading', transferBytes: device?.uploadTakeId === takeId ? Number(device.uploadProgressBytes) || 0 : undefined, transferTotalBytes: target?.metadata?.bytes ?? remote.localTakes?.find(take => take.id === takeId)?.metadata?.bytes });
            if (device?.uploadTakeId === takeId && (device.uploadState === 'paused' || device.uploadError)) throw new StudioRemoteCameraError('O envio foi pausado. Seu original está salvo no iPhone; retome quando quiser.', 'upload_paused');
            return undefined;
          }, token, options.transferTimeoutMs ?? 180_000, () => {
            const device = envelope!.session.deviceState, bytes = Number(device?.uploadProgressBytes), seen = Date.parse(envelope!.session.deviceSeenAt ?? '');
            if (options.transferTimeoutMs !== undefined || device?.uploadTakeId !== takeId || !Number.isFinite(seen) || Date.now() + serverOffset - seen >= 15_000 || !Number.isFinite(bytes) || bytes <= lastBytes) return false;
            lastBytes = bytes; return true;
          });
        }
        publishRemote({ transfer: 'downloading', transferBytes: 0, transferTotalBytes: take.metadata?.bytes });
        const response = await receiveRequest({ action: 'download', takeId });
        if (!response.download) throw new StudioRemoteCameraError('O original ainda não está disponível para receber.');
        const blob = await client.download(response.download, { ...scope(token), cacheKey: `${sessionId}-${takeId}`, onProgress: (bytes, total) => { if (!disposed && token === generation) publishRemote({ transferBytes: bytes, transferTotalBytes: total }); }, nextPage: async partStart => { const page = await receiveRequest({ action: 'download', takeId, partStart, partCount: 100 }); if (!page.download) throw new StudioRemoteCameraError('A próxima parte do original não foi confirmada.'); return page.download; } }); assert(token);
        publishRemote({ transfer: 'validating', transferBytes: blob.size });
        const metadata = await validateStudioRemoteMaster(blob, take, options.inspect ?? inspectStudioMedia, lifecycle.signal); assert(token);
        const master = { file: new File([blob], `iphone-${takeId}.${take.metadata!.mime.includes('quicktime') ? 'mov' : 'mp4'}`, { type: take.metadata!.mime }), take, session: originalSession.session, metadata };
        receivedMasters.set(takeId, master); publishRemote({ transfer: 'complete', error: null }); return master;
      } catch (error) { if (!disposed && token === generation) publishRemote({ transfer: 'retry', error: error instanceof Error ? error.message : 'O envio foi interrompido. Seu original continua no iPhone.' }); throw error; }
    })(); receiveWork = work; void work.finally(() => { if (receiveWork === work) receiveWork = null; }).catch(() => undefined); return work;
  };
  const remoteStop = () => {
    // This compatibility path is used only by explicit receive/composition
    // actions. The recording workspace calls finishLocalTake for ordinary STOP.
    if (envelope && studioRemoteLocalStorage(envelope.session.deviceState)) {
      const takeId = remote.pendingTakeId ?? lastStart?.takeId ?? envelope.session.activeTakeId ?? [...envelope.takes].reverse().find(take => ['local_ready', 'uploading', 'uploaded', 'failed'].includes(take.status))?.id;
      if (!takeId) return Promise.reject(new StudioRemoteCameraError('Nenhum original foi confirmado no iPhone.'));
      return remote.pendingTakeId ? finishLocalTake().then(() => receiveRemoteTake(takeId)) : receiveRemoteTake(takeId);
    }
    if (cachedMaster) return Promise.resolve(cachedMaster); if (stopWork) return stopWork;
    const takeId = remote.pendingTakeId ?? lastStart?.takeId ?? pendingStart?.takeId ?? envelope?.session.activeTakeId;
    if (!envelope || !takeId) return Promise.reject(new StudioRemoteCameraError('Nenhum take foi confirmado no iPhone.'));
    const token = generation, recovering = state.pendingRecovery === true; pendingStop ??= { id: crypto.randomUUID(), takeId };
    persistIntent();
    publish({ phase: 'stopping', pendingRecovery: true, error: null }); publishRemote({ transfer: 'waiting', pendingTakeId: takeId, transferBytes: undefined, transferTotalBytes: undefined, error: null });
    const work = (async () => {
      try {
        // A recovery gesture refreshes authority first, then asks the phone to
        // resume the same original. Repeating an applied STOP cannot restart upload.
        if (recovering) await request({ action: 'status', sessionId: envelope!.session.id, afterSequence: 0 }, token);
        const existing = envelope?.takes.find(value => value.id === takeId);
        if (!existing || ['reserved', 'recording'].includes(existing.status)) await command(pendingStop!.id, 'stop', { takeId }, token);
        const deviceBeforeResume = envelope?.session.deviceState;
        const paused = existing?.status === 'failed' || deviceBeforeResume?.uploadTakeId === takeId && (deviceBeforeResume.uploadState === 'paused' || !!deviceBeforeResume.uploadError);
        let resumedAtServerMs: number | undefined;
        if (recovering && paused && existing?.status !== 'uploaded') {
          pendingResume ??= { id: crypto.randomUUID(), takeId };
          persistIntent();
          const resumeIntent = pendingResume;
          let receipt: StudioRemoteCommand;
          try { receipt = await command(resumeIntent.id, 'resume_upload', { takeId }, token); }
          catch (error) {
            // A failed ACK is a settled outcome: the next explicit recovery
            // gesture needs a new command. Keep the ID for uncertain timeouts.
            if (error instanceof StudioRemoteCameraError && error.code === 'command_failed' && !disposed && token === generation && pendingResume?.id === resumeIntent.id) { pendingResume = null; persistIntent(); }
            throw error;
          }
          if (receipt.result?.takeId !== takeId || !Number.isFinite(Number(receipt.result?.uploadResumedAtServerMs)) || Number(receipt.result?.uploadResumedAtServerMs) <= 0 || !['uploading', 'complete'].includes(String(receipt.result?.uploadState))) throw new StudioRemoteCameraError('O iPhone não confirmou a retomada deste original. Mantenha o app aberto e retome a transferência.', 'invalid_resume');
          resumedAtServerMs = Number(receipt.result.uploadResumedAtServerMs); pendingResume = null; persistIntent();
        }
        let lastUploadBytes = 0;
        const take = await wait(() => {
          const target = envelope?.takes.find(value => value.id === takeId), device = envelope?.session.deviceState;
          if (target?.status === 'uploaded') return target;
          const freshResume = resumedAtServerMs === undefined || device?.uploadTakeId === takeId && Number(device.uploadResumedAtServerMs) >= resumedAtServerMs;
          if (target?.status === 'uploading' || resumedAtServerMs !== undefined) publishRemote({ transfer: 'uploading', transferBytes: device?.uploadTakeId === takeId && Number.isFinite(Number(device.uploadProgressBytes)) ? Math.max(0, Number(device.uploadProgressBytes)) : undefined, transferTotalBytes: target?.metadata?.bytes ?? (device?.uploadTakeId === takeId && Number.isFinite(Number(device.uploadTotalBytes)) ? Number(device.uploadTotalBytes) : undefined) });
          const failedTake = target?.status === 'failed' && !(resumedAtServerMs !== undefined && device?.uploadTakeId === takeId && device.uploadState === 'uploading');
          if (freshResume && (failedTake || device?.uploadTakeId === takeId && (device.uploadState === 'paused' || device.uploadError))) {
            const detail = typeof device?.uploadError === 'string' && device.uploadTakeId === takeId ? device.uploadError.trim() : '';
            throw new StudioRemoteCameraError(`A transferência foi pausada.${detail ? ` ${detail}` : ''} Retome a transferência com o app aberto; seu original continua preservado.`, 'upload_paused');
          }
          return undefined;
        }, token, options.transferTimeoutMs ?? 180_000, () => {
          const device = envelope?.session.deviceState, bytes = Number(device?.uploadProgressBytes), seen = Date.parse(envelope?.session.deviceSeenAt ?? '');
          if (options.transferTimeoutMs !== undefined || device?.uploadTakeId !== takeId || device.uploadState !== 'uploading' || !Number.isFinite(seen) || Date.now() + serverOffset - seen >= 15_000 || !Number.isFinite(bytes) || bytes <= lastUploadBytes) return false;
          lastUploadBytes = bytes; return true;
        });
        publishRemote({ transfer: 'downloading' }); const response = await request({ action: 'download', sessionId: envelope!.session.id, takeId }, token);
        if (!response.download) throw new StudioRemoteCameraError('O original ainda não está disponível para transferência.');
        publishRemote({ transferBytes: 0, transferTotalBytes: take.metadata?.bytes });
        const blob = await client.download(response.download, { ...scope(token), cacheKey: `${envelope!.session.id}-${takeId}`, onProgress: (receivedBytes, totalBytes) => { if (!disposed && token === generation) publishRemote({ transferBytes: receivedBytes, transferTotalBytes: totalBytes }); }, nextPage: async partStart => { const page = await request({ action: 'download', sessionId: envelope!.session.id, takeId, partStart, partCount: 100 }, token); if (!page.download) throw new StudioRemoteCameraError('A próxima parte do original não foi confirmada.'); return page.download; } }); assert(token); publishRemote({ transfer: 'validating', transferBytes: blob.size });
        const file = new File([blob], `iphone-${takeId}.${take.metadata?.mime.includes('quicktime') ? 'mov' : 'mp4'}`, { type: take.metadata!.mime });
        // A decoder limitation must still allow the user to download the actual
        // original. Publishing recorded remains gated on the media receipt.
        if (blob.size === take.metadata!.bytes) publish({ file });
        const metadata = await validateStudioRemoteMaster(blob, take, options.inspect ?? inspectStudioMedia, lifecycle.signal); assert(token);
        cachedMaster = { file, take, session: envelope!.session, metadata }; pendingStop = null;
        publishRemote({ transfer: 'complete', error: null }); return cachedMaster;
      } catch (error) { if (!disposed && token === generation) { const message = error instanceof Error ? error.message : 'O original ainda não foi recebido.'; publish({ phase: 'error', pendingRecovery: true, error: message }); publishRemote({ transfer: 'retry', error: message }); } throw error; }
    })(); stopWork = work; void work.finally(() => { if (stopWork === work) stopWork = null; }).catch(() => undefined); return work;
  };
  const configureRemote = (patch: Partial<StudioRemoteConfiguration>): Promise<void> => {
    if (!envelope || disposed || !['ready', 'error'].includes(state.phase) || state.pendingRecovery || startWork || stopWork)
      return Promise.reject(new StudioRemoteCameraError('Aguarde o iPhone estar pronto para ajustar a câmera.'));
    // An uncertain timeout still owns its server command. Never enqueue a new
    // command over that pending receipt or allow REC on unconfirmed settings.
    if (!configuring && configurationPending()) return Promise.reject(new StudioRemoteCameraError('Aguarde o iPhone confirmar o ajuste pendente.', 'configuration_pending'));
    const next = structuredClone(patch), previous = queuedConfiguration;
    queuedConfiguration = { ...previous, ...next,
      ...(previous?.pro || next.pro ? { pro: { ...previous?.pro, ...next.pro } } : {}) };
    const pro = queuedConfiguration.pro;
    if (pro?.autoExposure === true) { delete pro.iso; delete pro.shutterSeconds; }
    if (pro?.autoWhiteBalance === true) for (const key of ['redGain', 'greenGain', 'blueGain', 'temperatureKelvin', 'whiteBalanceTint']) delete pro[key];
    if (pro?.autoFocus === true) delete pro.lensPosition;
    const id = crypto.randomUUID(); queuedConfigurationId = id;
    const direct = preview?.configure && remote.connection === 'connected' && envelope.session.deviceState?.capabilities?.liveControls === 1 && Object.keys(next).every(key => key === 'pro' || key === 'imageGrade');
    if (direct) {
      const order = ++liveOrder;
      const { focusPoint: _previousFocus, ...previousPro } = liveDesired?.pro ?? {};
      liveDesired = { ...liveDesired, ...next, ...(liveDesired?.pro || next.pro ? { pro: { ...previousPro, ...next.pro } } : {}) };
      if (liveDesired.pro?.autoExposure === true) { delete liveDesired.pro.iso; delete liveDesired.pro.shutterSeconds; }
      if (liveDesired.pro?.autoWhiteBalance === true) for (const key of ['redGain', 'greenGain', 'blueGain', 'temperatureKelvin', 'whiteBalanceTint']) delete liveDesired.pro[key];
      if (liveDesired.pro?.autoFocus === true) delete liveDesired.pro.lensPosition;
      const token = generation;
      const job = preview!.configure!(id, structuredClone(liveDesired)).then(actual => {
        assert(token);
        if (!liveReceipt || order > liveReceipt.order) { liveReceipt = { id, order, state: actual }; publishRemote({}); }
        return actual;
      }).catch(() => null);
      liveJobs.set(id, job);
      if (liveJobs.size > 256) for (const key of liveJobs.keys()) { if (key !== configurationIntent?.id && key !== queuedConfigurationId) { liveJobs.delete(key); break; } }
    } else { liveReceipt = null; liveDesired = null; }
    const result = new Promise<void>((resolve, reject) => configurationWaiters.push({ resolve, reject }));
    if (configuring) return result;
    const token = generation; configuring = true;
    publish({ videoControls: state.videoControls ? { ...state.videoControls, busy: true } : null });
    void (async () => {
      try {
        while (queuedConfiguration) {
          assert(token);
          const desired = queuedConfiguration, waiters = configurationWaiters, id = queuedConfigurationId!;
          queuedConfiguration = null; queuedConfigurationId = null; configurationWaiters = [];
          const intent = { id, patch: desired, uncertain: false }; configurationIntent = intent;
          try { const direct = liveJobs.get(id); if (direct) { await direct; assert(token); liveJobs.delete(id); } await command(intent.id, 'configure', desired, token); assert(token); if (configurationIntent === intent) configurationIntent = null; waiters.forEach(waiter => waiter.resolve()); }
          catch (error) {
            if (token === generation && configurationIntent === intent) {
              if (error instanceof StudioRemoteCameraError && error.code.startsWith('studio_camera_')) configurationIntent = null;
              else intent.uncertain = true;
            }
            waiters.forEach(waiter => waiter.reject(error)); throw error;
          }
        }
      } catch (error) {
        if (token === generation) { queuedConfiguration = null; const waiting = configurationWaiters; configurationWaiters = []; waiting.forEach(waiter => waiter.reject(error)); }
      } finally {
        if (!disposed && token === generation) { configuring = false; publish({ videoControls: state.videoControls ? { ...state.videoControls, busy: configurationPending() } : null }); }
      }
    })();
    return result;
  };
  const cancel = () => {
    const previous = envelope, hadMaster = !!cachedMaster, takeId = remote.pendingTakeId ?? pendingStart?.takeId ?? previous?.session.activeTakeId; bestRTT = Infinity;
    const device = previous?.session.deviceState, activeTakeId = previous?.session.activeTakeId;
    const anotherTakeIsActive = !!activeTakeId && activeTakeId !== takeId;
    const completedIdleTake = previous?.takes.some(take => take.id === takeId && take.status === 'uploaded') &&
      !activeTakeId && !['starting', 'recording', 'stopping'].includes(previous.session.status) &&
      device?.recording !== true && device?.processing !== true && device?.uploading !== true && device?.uploadState !== 'uploading' &&
      !previous.commands.some(command => command.status === 'pending' && ['start', 'stop', 'resume_upload'].includes(command.type));
    const preserveLocalSession = studioRemoteLocalStorage(device) && studioRemoteLocalTakes(previous!).some(take => take.localSaved);
    persistIntent(); if (previous && (hadMaster || !takeId) && !preserveLocalSession) forgetIntent(); configuring = false;
    queuedConfiguration = null; queuedConfigurationId = null; configurationIntent = null; liveReceipt = null; liveDesired = null; liveJobs.clear(); const waiting = configurationWaiters; configurationWaiters = []; waiting.forEach(waiter => waiter.reject(new DOMException('Conexão cancelada.', 'AbortError')));
    const stopId = pendingStop?.id ?? crypto.randomUUID(); generation++; lifecycle.abort(); lifecycle = new AbortController(); if (pollTimer) clearTimeout(pollTimer); pollTimer = null; pollAbort?.abort(); pollAbort = null; polling = null; connecting = null;
    void releasePreview().catch(() => undefined); preview = null; cameraTrack = null; envelope = null; pendingStart = null; pendingStop = null; pendingResume = null; lastStart = null; cachedMaster = null; prepareWork = null; reconnectWork = null; startWork = null; stopWork = null; finishWork = null; receiveWork = null; receivedMasters.clear(); transferCommands.clear();
    // A lost browser must not delete/close the original while the phone is still
    // recording or transferring. Queue STOP and leave its private recovery open.
    if (previous && takeId && !hadMaster && !completedIdleTake && !anotherTakeIsActive && !(preserveLocalSession && !activeTakeId)) void client.request({ action: 'command', sessionId: previous.session.id, clientId, commandId: stopId, type: 'stop', payload: { takeId } }).catch(() => undefined);
    else if (previous && !anotherTakeIsActive && !preserveLocalSession) void client.request({ action: 'close', sessionId: previous.session.id, clientId, role: 'controller' }).catch(() => undefined);
    publishRemote({ pairing: null, session: null, connection: 'idle', transfer: 'idle', transferBytes: undefined, transferTotalBytes: undefined, pendingTakeId: null, localTakes: preserveLocalSession || durableTakes.size ? [...durableTakes.values()] : [], localFirst: preserveLocalSession, transferTakeId: null, previewDiagnostic: null, error: null }); publish({ phase: 'idle', stream: null, cameraPreviewStream: null, file: null, input: null, camera: null, pendingRecovery: false, error: null });
  };
  const controller: StudioRemoteCaptureController = {
    prepare() {
      if (prepareWork) return prepareWork; if (envelope && cameraTrack && state.phase === 'ready') return Promise.resolve();
      if (remote.pendingTakeId || state.pendingRecovery) return Promise.reject(new StudioRemoteCameraError('Recupere ou descarte o take pendente antes de reconectar.'));
      const token = generation; publish({ phase: 'preparing', error: null });
      const work = (async () => { try {
        if (!envelope) {
          restoreCatalog();
          let resume: Intent | undefined;
          if (options.resumeSessionId) resume = { sessionId: options.resumeSessionId, controllerId: clientId, takeId: options.resumeTakeId ?? '' };
          else if (options.persist !== false && !forgotten) { try { const key = recoveryKey(), stored = JSON.parse(localStorage.getItem(key) ?? 'null'); if (stored && ['sessionId', 'controllerId', 'takeId'].every(key => typeof stored[key] === 'string' && stored[key].length > 0 && stored[key].length < 128)) { ownedRecoveryKeys.add(key); resume = stored; } } catch { /* Malformed local metadata has no authority. */ } }
          if (resume) {
            clientId = resume.controllerId; const response = await request({ action: 'status', sessionId: resume.sessionId, afterSequence: 0 }, token);
            const takeId = resume.takeId || response.session.activeTakeId || response.takes.find(value => value.status !== 'failed')?.id;
            if (!takeId) throw new StudioRemoteCameraError('Nenhum original pendente foi confirmado nesta conexão.');
            const localSaved = studioRemoteLocalStorage(response.session.deviceState) && studioRemoteLocalTakes(response).some(take => take.id === takeId && take.localSaved);
            if (localSaved && response.session.status === 'closed' && !response.session.activeTakeId && response.session.deviceState?.recording !== true) {
              // Closed sessions retain their catalog/import actions. Replacing
              // only the monitor must never wait for an optional old transfer.
              envelope = null; pendingStart = null; pendingStop = null; pendingResume = null; forgotten = true;
              publishRemote({ pendingTakeId: null, connection: 'connecting', error: null }); publish({ phase: 'preparing', pendingRecovery: false, error: null });
              const context = options.getContext?.(); await request({ action: 'create', projectId: context?.projectId ?? options.projectId, kind: options.kind, title: context?.title ?? options.title, controllerId: clientId }, token);
              publishRemote({ pairing: envelope!.session.deviceId ? null : (envelope as StudioRemoteResponse).pairing ?? null, connection: envelope!.session.deviceId ? 'connecting' : 'pairing', error: null });
              await poll(token); return;
            }
            if (localSaved && response.session.status === 'ready' && !response.session.activeTakeId && response.session.deviceState?.recording !== true) {
              pendingStart = null; pendingStop = null; pendingResume = null;
              publishRemote({ pendingTakeId: null, connection: 'connecting', error: null }); publish({ phase: 'preparing', pendingRecovery: false, error: null });
              persistIntent(); await poll(token);
              const end = studioRemoteRecordingEnd(response, takeId);
              if (end?.interrupted) { const warning = interruptedTakeMessage(end.durationSeconds); publishRemote({ recordingEnd: end, error: warning }); publish({ error: warning, elapsed: end.durationSeconds }); }
              return;
            }
            pendingStart = resume.startId ? { id: resume.startId, takeId } : null; pendingStop = resume.stopId ? { id: resume.stopId, takeId } : null; pendingResume = resume.resumeId ? { id: resume.resumeId, takeId } : null;
            console.info('[Classfy Studio] Recuperação pendente', { sessionOpen: response.session.status !== 'closed', originalUploaded: response.takes.some(take => take.id === takeId && take.status === 'uploaded') });
            publishRemote({ pendingTakeId: takeId, transfer: 'retry', connection: 'disconnected', previewDiagnostic: { stage: 'recovery-pending', message: null }, error: null }); publish({ phase: 'error', pendingRecovery: true, error: 'Seu original do iPhone ainda está disponível. Salve ou descarte o trecho para continuar.' }); persistIntent(); await poll(token); return;
          }
          const context = options.getContext?.(); const response = await request({ action: 'create', projectId: context?.projectId ?? options.projectId, kind: options.kind, title: context?.title ?? options.title, controllerId: clientId }, token);
          if (!response.session.deviceId && !response.pairing?.code) throw new StudioRemoteCameraError('O código de conexão não foi criado.');
          publishRemote({ pairing: response.session.deviceId ? null : response.pairing ?? null, connection: response.session.deviceId ? 'connecting' : 'pairing', error: null });
        }
        await poll(token);
      } catch (error) { if (!disposed && token === generation) { const message = error instanceof Error ? error.message : 'Não foi possível conectar o iPhone.'; publish({ phase: 'error', error: message }); publishRemote({ error: message }); } throw error; } })();
      prepareWork = work; void work.finally(() => { if (prepareWork === work) prepareWork = null; }).catch(() => undefined); return work;
    },
    start() { void remoteStart().catch(() => undefined); },
    async stop() { const master = await remoteStop(); publish({ phase: 'recorded', file: master.file, pendingRecovery: false, stream: null, cameraPreviewStream: null, error: null }); return master.file; },
    remoteStart, remoteStop, finishLocalTake, receiveRemoteTake, configureRemote,
    async configureVideo(patch: StudioCaptureVideoPatch) {
      if (patch.grade || patch.hardware || patch.zoom !== undefined) throw new StudioRemoteCameraError('Use os controles Pro do iPhone para ajustar o original.');
      const output = patch.output ?? patch, resolution = output.height && output.width ? Math.min(output.width, output.height) : undefined;
      const next: Partial<StudioRemoteConfiguration> = {};
      if (resolution) { if (![720, 1080, 1440, 2160].includes(resolution)) throw new StudioRemoteCameraError('Selecione uma resolução disponível no iPhone.'); next.resolution = resolution === 2160 ? '4k' : resolution === 1440 ? '2k' : resolution === 720 ? '720p' : '1080p'; }
      if (output.frameRate !== undefined) { if (![24, 30, 60].includes(output.frameRate)) throw new StudioRemoteCameraError('Selecione uma cadência disponível no iPhone.'); next.fps = output.frameRate as 24 | 30 | 60; }
      await configureRemote(next);
    },
    async flip() { await configureRemote({ cameraFacing: envelope?.session.configuration.cameraFacing === 'back' ? 'front' : 'back' }); },
    async selectDevices() { throw new StudioRemoteCameraError('A câmera e o áudio são capturados no iPhone.'); },
    setMicrophoneEnabled() { publish({ error: 'Controle o microfone pelo iPhone para preservar o áudio do original.' }); },
    getMicrophoneTrack() { return null; },
    getReceivedCameraTrack() { return cameraTrack; }, getEnvelope() { return envelope ? structuredClone(envelope) : null; },
    getServerNow() { return Date.now() + serverOffset; },
    discardRemoteRecovery: forgetIntent,
    persistRemoteContext() { persistIntent(); persistCatalog(); },
    async unlinkRemote() {
      if (!envelope || remote.pendingTakeId || state.pendingRecovery || startWork || stopWork || configuring || state.phase === 'recording') throw new StudioRemoteCameraError('Finalize e salve o take antes de desvincular o iPhone.');
      const token = generation;
      await request({ action: 'unpair', sessionId: envelope.session.id, controllerId: clientId }, token); assert(token);
      cancel();
      if (options.persist !== false) { try { if (localStorage.getItem(controllerStorageKey(options.owner)) === clientId) localStorage.removeItem(controllerStorageKey(options.owner)); } catch { /* Server revocation is authoritative. */ } }
      clientId = studioRemoteControllerId(options.owner, options.persist !== false);
    },
    reconnect() {
      if (reconnectWork) return reconnectWork;
      const token = generation;
      const work = (async () => {
        assert(token);
        if (!envelope) return controller.prepare();
        publishRemote({ connection: 'reconnecting', error: null });
        if (state.phase === 'ready') publish({ phase: 'preparing', error: null });
        await releasePreview(); assert(token);
        // Supersede the old cycle immediately, including a provider that never
        // settles. Its signal and lease prevent every late response/callback.
        pollAbort?.abort(); pollAbort = null; polling = null; connecting = null;
        await poll(token); assert(token);
        if (envelope?.session.status !== 'closed') return;
        const device = envelope.session.deviceState;
        const protectedWork = remote.pendingTakeId || state.pendingRecovery || state.file || pendingStart || pendingStop || pendingResume || lastStart || cachedMaster || startWork || stopWork || configuring || configurationIntent ||
          envelope.session.activeTakeId || device?.recording === true || device?.processing === true || device?.uploading === true || device?.uploadState === 'uploading' ||
          envelope.takes.some(take => take.status !== 'uploaded') || envelope.commands.some(command => command.status === 'pending' && ['start', 'stop', 'resume_upload'].includes(command.type));
        if (protectedWork) return;
        // Keep the browser binding and every original. Only the expired preview
        // session is replaced, after status confirms there is no physical work.
        if (pollTimer) clearTimeout(pollTimer); pollTimer = null;
        envelope = null; forgotten = true; heartbeatAt = 0; bestRTT = Infinity;
        publishRemote({ session: null, pairing: null, pendingTakeId: null, transfer: 'idle', connection: 'connecting', error: null });
        await controller.prepare();
      })();
      reconnectWork = work; void work.finally(() => { if (reconnectWork === work) reconnectWork = null; }).catch(() => undefined); return work;
    },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    subscribeRemote(listener) { remoteListeners.add(listener); listener(view()); return () => remoteListeners.delete(listener); },
    cancel, dispose() { if (disposed) return; cancel(); disposed = true; listeners.clear(); remoteListeners.clear(); },
  };
  // Restore only private metadata. Preview grants and REC still need a gesture.
  restoreCatalog();
  return controller;
}

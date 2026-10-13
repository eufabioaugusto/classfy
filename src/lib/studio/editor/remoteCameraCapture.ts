import { Room, RoomEvent, Track, type RemoteTrack, type RemoteParticipant, type RemoteTrackPublication } from 'livekit-client';
import type { StudioRemoteCommand, StudioRemoteConfiguration, StudioRemoteEnvelope, StudioRemoteResponse, StudioRemoteSession, StudioRemoteTake } from '../../../../shared/studio/remoteCamera';
import { studioGrade } from '../../../../shared/studio/model';
import type { StudioCaptureController, StudioCaptureState, StudioCaptureVideoPatch } from './capture';
import { inspectStudioMedia, type StudioMediaMetadata } from './media';
import { assertStudioRemoteScope, createStudioRemoteClient, StudioRemoteCameraError, type StudioRemoteClient } from './remoteCameraClient';

export type StudioRemoteStart = { takeId: string; startedAtServerMs: number; result: Record<string, unknown> };
export type StudioRemoteMaster = { file: File; take: StudioRemoteTake; session: StudioRemoteSession; metadata: StudioMediaMetadata };
export type StudioRemoteView = {
  pairing: { code: string; expiresAt: string } | null;
  connection: 'idle' | 'pairing' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  session: StudioRemoteSession | null;
  transfer: 'idle' | 'waiting' | 'uploading' | 'downloading' | 'validating' | 'complete' | 'retry';
  transferBytes?: number; transferTotalBytes?: number;
  pendingTakeId: string | null; error: string | null;
};
export type StudioRemotePreview = { disconnect(): Promise<void>; reconnect?(): Promise<void> };
export type StudioRemotePreviewFactory = (response: StudioRemoteResponse, callbacks: { track(track: MediaStreamTrack | null): void; connection(value: StudioRemoteView['connection']): void }, signal: AbortSignal) => Promise<StudioRemotePreview>;
export type StudioRemoteCaptureController = StudioCaptureController & {
  remoteStart(): Promise<StudioRemoteStart>;
  remoteStop(): Promise<StudioRemoteMaster>;
  configureRemote(patch: Partial<StudioRemoteConfiguration>): Promise<void>;
  subscribeRemote(listener: (state: StudioRemoteView) => void): () => void;
  getReceivedCameraTrack(): MediaStreamTrack | null;
  reconnect(): Promise<void>;
  getEnvelope(): StudioRemoteEnvelope | null;
  getServerNow(): number;
  discardRemoteRecovery(): void;
  unlinkRemote(): Promise<void>;
};

const controllerStorageKey = (owner: string) => `classfy:studio:remote-controller:v1:${owner}`;
const controllerUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  const published = (publication: RemoteTrackPublication, participant: RemoteParticipant) => { if (!closed && !signal.aborted) publication.setSubscribed(participant.identity === identity && publication.kind === Track.Kind.Video); };
  const subscribed = (track: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
    if (!closed && !signal.aborted && participant.identity === identity && track.kind === Track.Kind.Video) {
      // Camera direction needs the freshest frame. LiveKit guards unsupported
      // receivers; this optional hint must never prevent the preview from opening.
      try { track.setPlayoutDelay(0); } catch { /* Keep preview usable if the browser rejects the hint. */ }
      callbacks.track(track.mediaStreamTrack);
    }
  };
  room.on(RoomEvent.TrackSubscribed, subscribed);
  room.on(RoomEvent.TrackPublished, published);
  room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => { if (!closed && participant.identity === identity && track.kind === Track.Kind.Video) callbacks.track(null); });
  room.on(RoomEvent.Reconnecting, () => { if (!closed) callbacks.connection('reconnecting'); });
  room.on(RoomEvent.Reconnected, () => { if (!closed) callbacks.connection('connected'); });
  room.on(RoomEvent.Disconnected, () => { if (!closed) { callbacks.track(null); callbacks.connection('disconnected'); } });
  const disconnect = async () => { if (closed) return; closed = true; signal.removeEventListener('abort', abort); room.removeAllListeners(); callbacks.track(null); await room.disconnect(); };
  const abort = () => { void disconnect(); }; signal.addEventListener('abort', abort, { once: true });
  try { callbacks.connection('connecting'); await room.connect(connection.url, connection.token, { autoSubscribe: false }); if (signal.aborted || closed) throw new DOMException('Conexão cancelada.', 'AbortError'); room.remoteParticipants.forEach(participant => participant.trackPublications.forEach(publication => published(publication, participant))); callbacks.connection('connected'); return { disconnect }; }
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

export function createStudioRemoteCapture(options: { owner: string; kind: 'aula' | 'short'; title?: string; projectId?: string; getContext?: () => { title?: string; projectId?: string }; controllerId?: string; resumeSessionId?: string; persist?: boolean; client?: StudioRemoteClient; preview?: StudioRemotePreviewFactory; inspect?: typeof inspectStudioMedia; commandTimeoutMs?: number; transferTimeoutMs?: number }): StudioRemoteCaptureController {
  const client = options.client ?? createStudioRemoteClient(options.owner); let clientId = options.controllerId ?? studioRemoteControllerId(options.owner, options.persist !== false);
  const recoveryKey = () => `classfy:studio:remote-camera:v1:${options.owner}:${options.getContext?.().projectId ?? options.projectId ?? 'new'}:${options.kind}`;
  const ownedRecoveryKeys = new Set<string>();
  type Intent = { sessionId: string; controllerId: string; takeId: string; startId?: string; stopId?: string; resumeId?: string };
  let forgotten = false, configuring = false;
  let generation = 0, disposed = false, lifecycle = new AbortController(), envelope: StudioRemoteEnvelope | null = null, preview: StudioRemotePreview | null = null, cameraTrack: MediaStreamTrack | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null, heartbeatAt = 0, serverOffset = 0, bestRTT = Infinity, polling: Promise<void> | null = null, connecting: Promise<void> | null = null, prepareWork: Promise<void> | null = null, startWork: Promise<StudioRemoteStart> | null = null, stopWork: Promise<StudioRemoteMaster> | null = null;
  let pendingStart: { id: string; takeId: string } | null = null, pendingStop: { id: string; takeId: string } | null = null, pendingResume: { id: string; takeId: string } | null = null, lastStart: StudioRemoteStart | null = null, cachedMaster: StudioRemoteMaster | null = null;
  const listeners = new Set<(state: StudioCaptureState) => void>(), remoteListeners = new Set<(state: StudioRemoteView) => void>();
  let state: StudioCaptureState = { phase: 'idle', stream: null, elapsed: 0, file: null, error: null, input: null, camera: null, devices: { cameras: [], microphones: [] }, microphoneEnabled: true, levels: [] };
  let remote: StudioRemoteView = { pairing: null, connection: 'idle', session: null, transfer: 'idle', pendingTakeId: null, error: null };
  const snapshot = () => ({ ...state, devices: { cameras: [], microphones: [] }, levels: [], ...(state.videoControls ? { videoControls: structuredClone(state.videoControls) } : {}), ...(state.outputVideo ? { outputVideo: structuredClone(state.outputVideo) } : {}) });
  const view = () => structuredClone(remote);
  const publish = (patch: Partial<StudioCaptureState>) => { if (disposed) return; state = { ...state, ...patch }; listeners.forEach(listener => listener(snapshot())); };
  const publishRemote = (patch: Partial<StudioRemoteView>) => { if (disposed) return; remote = { ...remote, ...patch }; remoteListeners.forEach(listener => listener(view())); };
  const scope = (token = generation) => ({ signal: lifecycle.signal, isCurrent: () => !disposed && token === generation });
  const assert = (token: number) => assertStudioRemoteScope(scope(token));
  const persistIntent = () => {
    if (options.persist === false || forgotten) return;
    const takeId = remote.pendingTakeId ?? pendingStart?.takeId ?? envelope?.session.activeTakeId;
    try { if (envelope && takeId) { const key = recoveryKey(); ownedRecoveryKeys.add(key); localStorage.setItem(key, JSON.stringify({ sessionId: envelope.session.id, controllerId: clientId, takeId, startId: pendingStart?.id, stopId: pendingStop?.id, resumeId: pendingResume?.id } satisfies Intent)); } } catch { /* Phone retains its original if browser storage is unavailable. */ }
  };
  const forgetIntent = () => { forgotten = true; ownedRecoveryKeys.add(recoveryKey()); try { for (const key of ownedRecoveryKeys) localStorage.removeItem(key); ownedRecoveryKeys.clear(); } catch { /* Best effort metadata cleanup, never delete the phone original. */ } };
  const adopt = (response: StudioRemoteResponse, token: number) => {
    assert(token); if (envelope && response.session.id !== envelope.session.id) throw new StudioRemoteCameraError('A sessão da câmera mudou.');
    if (envelope && response.session.sequence < envelope.session.sequence) return;
    envelope = response;
    // Retain the proven browser identity separately from per-take recovery;
    // successfully saving a take must not erase its computer pairing.
    if (options.persist !== false && response.session.controllerId === clientId && controllerUUID.test(clientId)) { try { localStorage.setItem(controllerStorageKey(options.owner), clientId); } catch { /* The server remains authoritative. */ } }
    publishRemote({ session: response.session, error: typeof response.session.deviceState?.error === 'string' ? response.session.deviceState.error : null }); persistIntent();
    const profile = remoteStudioProfile(response, options.kind);
    const confirmed = response.session.deviceState?.configurationConfirmed !== false && response.session.deviceState?.imageGradeConfirmed !== false && Number(response.session.deviceState?.width) > 0 && Number(response.session.deviceState?.height) > 0 && Number(response.session.deviceState?.fps) > 0;
    publish({ width: confirmed ? profile.width : undefined, height: confirmed ? profile.height : undefined, frameRate: confirmed ? profile.frameRate : undefined, camera: response.session.deviceId ? { id: response.session.deviceId, name: response.session.deviceState?.deviceName || 'iPhone · Câmera remota' } : null,
      videoControls: confirmed ? { busy: configuring, processed: false, effects: false, grade: studioGrade(), zoom: { mode: 'none', min: 1, max: 1, step: 1, value: 1 }, resolutions: profile.resolutions, frameRates: profile.frameRates } : null, outputVideo: confirmed ? { resolutions: profile.resolutions, frameRates: profile.frameRates, sourceWidth: profile.width, sourceHeight: profile.height, sourceFrameRate: profile.frameRate, scaled: false } : null });
    if (response.session.deviceState?.error) publishRemote({ error: String(response.session.deviceState.error) });
    if (!confirmed && (response.session.deviceState?.configurationConfirmed === false || response.session.deviceState?.imageGradeConfirmed === false) && !remote.pendingTakeId && !pendingStart) publish({ phase: 'error', pendingRecovery: false, error: 'O iPhone não confirmou os ajustes. Restaure o modo Auto ou ajuste novamente antes de gravar.' });
    if (confirmed && response.session.status === 'ready' && cameraTrack && (state.phase === 'preparing' || state.phase === 'error' && !state.pendingRecovery) && !pendingStart) publish({ phase: 'ready', error: null });
    if (lastStart && state.phase === 'recording') publish({ elapsed: Math.max(0, (Date.parse(response.serverAt) - lastStart.startedAtServerMs) / 1000) });
  };
  const request = async (body: Record<string, unknown>, token = generation) => { const sentAt = Date.now(); const response = await client.request({ ...body, action: String(body.action), clientId }, scope(token)); const receivedAt = Date.now(); adopt(response, token); const rtt = receivedAt - sentAt; if (rtt < bestRTT) { bestRTT = rtt; serverOffset = Date.parse(response.serverAt) - (sentAt + receivedAt) / 2; } return response; };
  const connect = async (token: number) => {
    // Recovering owned bytes does not need a new Premium preview token, and a
    // closed session can still finish its private original transfer.
    if (!envelope?.session.deviceId || preview || state.pendingRecovery || envelope.session.status === 'closed') return; if (connecting) return connecting;
    const work = (async () => {
      const response = await request({ action: 'connect', sessionId: envelope!.session.id, role: 'controller' }, token);
      const next = await (options.preview ?? connectStudioRemotePreview)(response, { track(track) { if (disposed || token !== generation) return; cameraTrack = track; publish({ stream: track ? new MediaStream([track]) : null, cameraPreviewStream: track ? new MediaStream([track]) : null }); if (track && envelope?.session.status === 'ready' && state.width && state.height && state.frameRate && state.phase === 'preparing' && !pendingStart) publish({ phase: 'ready', error: null }); }, connection(value) { if (!disposed && token === generation) publishRemote({ connection: value }); } }, lifecycle.signal);
      if (disposed || token !== generation) { await next.disconnect(); assert(token); } preview = next;
    })(); connecting = work; void work.finally(() => { if (connecting === work) connecting = null; }).catch(() => undefined); return work;
  };
  const poll = async (token: number) => {
    if (polling) return polling;
    if (pollTimer) clearTimeout(pollTimer); pollTimer = null;
    const work = (async () => {
      try {
        if (!envelope || disposed || token !== generation) return;
        await request({ action: 'status', sessionId: envelope.session.id, afterSequence: 0 }, token); assert(token);
        if (Date.now() - heartbeatAt >= 8000) { await request({ action: 'heartbeat', sessionId: envelope.session.id, role: 'controller' }, token); heartbeatAt = Date.now(); }
        await connect(token);
        if (envelope.session.status === 'closed' && !stopWork) { if (!cachedMaster && (lastStart || envelope.takes.length)) publish({ phase: 'error', pendingRecovery: true, error: 'A conexão foi encerrada. O original permanece no iPhone; retome o recebimento do take.' }); else publish({ phase: 'error', error: 'A conexão com o iPhone foi encerrada.' }); }
      } catch (error) { if (!disposed && token === generation && !(error instanceof DOMException && error.name === 'AbortError')) publishRemote({ error: error instanceof Error ? error.message : 'A conexão foi interrompida.' }); }
      finally { if (!disposed && token === generation && envelope?.session.status !== 'closed') pollTimer = setTimeout(() => { pollTimer = null; void poll(token); }, 1000); }
    })(); polling = work; void work.finally(() => { if (polling === work) polling = null; }); return work;
  };
  const wait = async <T,>(find: () => T | undefined, token: number, milliseconds: number, active?: () => boolean): Promise<T> => {
    let deadline = Date.now() + milliseconds;
    while (true) { assert(token); const result = find(); if (result !== undefined) return result; if (active?.()) deadline = Date.now() + milliseconds; if (Date.now() >= deadline) throw new StudioRemoteCameraError('A confirmação do iPhone demorou. Mantenha o app aberto e retome a transferência; o original permanece no aparelho.', 'ack_timeout'); await poll(token); await new Promise<void>((resolve, reject) => { const signal = lifecycle.signal; const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Conexão cancelada.', 'AbortError')); }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 200); signal.addEventListener('abort', abort, { once: true }); }); }
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
    if (!envelope || remote.connection !== 'connected' || !cameraTrack || !['ready', 'preparing', 'error'].includes(state.phase) || remote.pendingTakeId) return Promise.reject(new StudioRemoteCameraError('Aguarde o iPhone ficar pronto antes de gravar.'));
    if (envelope.session.deviceState?.configurationConfirmed === false || envelope.session.deviceState?.imageGradeConfirmed === false) return Promise.reject(new StudioRemoteCameraError('Confirme os ajustes no iPhone antes de gravar.'));
    const token = generation; pendingStart ??= { id: crypto.randomUUID(), takeId: crypto.randomUUID() }; const intent = pendingStart;
    forgotten = false; persistIntent();
    publish({ phase: 'preparing', error: null });
    const work = (async () => {
      try {
        const ack = await command(intent.id, 'start', { takeId: intent.takeId }, token), takeId = typeof ack.result?.takeId === 'string' ? ack.result.takeId : intent.takeId;
        const startedAtServerMs = Number(ack.result?.startedAtServerMs);
        if (takeId !== intent.takeId || !Number.isFinite(startedAtServerMs)) throw new StudioRemoteCameraError('O iPhone não confirmou o início real deste take.', 'invalid_start');
        lastStart = { takeId, startedAtServerMs, result: ack.result ?? {} }; pendingStart = null; cachedMaster = null;
        pendingResume = null; publishRemote({ pendingTakeId: takeId, transfer: 'idle', transferBytes: undefined, transferTotalBytes: undefined, error: null }); persistIntent(); publish({ phase: 'recording', elapsed: 0, file: null, error: null, pendingRecovery: false }); return lastStart;
      } catch (error) { if (!disposed && token === generation) { publish({ phase: 'error', error: error instanceof Error ? error.message : 'Não foi possível iniciar o take.', pendingRecovery: true }); publishRemote({ error: error instanceof Error ? error.message : 'Confirme o estado da gravação no iPhone.' }); } throw error; }
    })(); startWork = work; void work.finally(() => { if (startWork === work) startWork = null; }).catch(() => undefined); return work;
  };
  const remoteStop = () => {
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
  const configureRemote = async (patch: Partial<StudioRemoteConfiguration>) => {
    if (!envelope || !['ready', 'error'].includes(state.phase) || state.pendingRecovery || startWork || stopWork || configuring) throw new StudioRemoteCameraError('Aguarde o iPhone estar pronto para ajustar a câmera.');
    const token = generation; configuring = true; publish({ videoControls: state.videoControls ? { ...state.videoControls, busy: true } : null });
    try { await command(crypto.randomUUID(), 'configure', patch, token); assert(token); }
    finally { if (!disposed && token === generation) { configuring = false; publish({ videoControls: state.videoControls ? { ...state.videoControls, busy: false } : null }); } }
  };
  const cancel = () => {
    const previous = envelope, hadMaster = !!cachedMaster, takeId = remote.pendingTakeId ?? pendingStart?.takeId ?? previous?.session.activeTakeId; bestRTT = Infinity;
    persistIntent(); if (previous && (hadMaster || !takeId)) forgetIntent(); configuring = false;
    const stopId = pendingStop?.id ?? crypto.randomUUID(); generation++; lifecycle.abort(); lifecycle = new AbortController(); if (pollTimer) clearTimeout(pollTimer); pollTimer = null; polling = null; connecting = null;
    const ownedPreview = preview; preview = null; void ownedPreview?.disconnect(); cameraTrack = null; envelope = null; pendingStart = null; pendingStop = null; pendingResume = null; lastStart = null; cachedMaster = null; prepareWork = null; startWork = null; stopWork = null;
    // A lost browser must not delete/close the original while the phone is still
    // recording or transferring. Queue STOP and leave its private recovery open.
    if (previous && takeId && !hadMaster) void client.request({ action: 'command', sessionId: previous.session.id, clientId, commandId: stopId, type: 'stop', payload: { takeId } }).catch(() => undefined);
    else if (previous) void client.request({ action: 'close', sessionId: previous.session.id, clientId, role: 'controller' }).catch(() => undefined);
    publishRemote({ pairing: null, session: null, connection: 'idle', transfer: 'idle', transferBytes: undefined, transferTotalBytes: undefined, pendingTakeId: null, error: null }); publish({ phase: 'idle', stream: null, cameraPreviewStream: null, file: null, input: null, camera: null, pendingRecovery: false, error: null });
  };
  const controller: StudioRemoteCaptureController = {
    prepare() {
      if (prepareWork) return prepareWork; if (envelope && cameraTrack && state.phase === 'ready') return Promise.resolve();
      if (remote.pendingTakeId || state.pendingRecovery) return Promise.reject(new StudioRemoteCameraError('Recupere ou descarte o take pendente antes de reconectar.'));
      const token = generation; publish({ phase: 'preparing', error: null });
      const work = (async () => { try {
        if (!envelope) {
          let resume: Intent | undefined;
          if (options.resumeSessionId) resume = { sessionId: options.resumeSessionId, controllerId: clientId, takeId: '' };
          else if (options.persist !== false && !forgotten) { try { const key = recoveryKey(), stored = JSON.parse(localStorage.getItem(key) ?? 'null'); if (stored && ['sessionId', 'controllerId', 'takeId'].every(key => typeof stored[key] === 'string' && stored[key].length > 0 && stored[key].length < 128)) { ownedRecoveryKeys.add(key); resume = stored; } } catch { /* Malformed local metadata has no authority. */ } }
          if (resume) {
            clientId = resume.controllerId; const response = await request({ action: 'status', sessionId: resume.sessionId, afterSequence: 0 }, token);
            const takeId = resume.takeId || response.session.activeTakeId || response.takes.find(value => value.status !== 'failed')?.id;
            if (!takeId) throw new StudioRemoteCameraError('Nenhum original pendente foi confirmado nesta conexão.');
            pendingStart = resume.startId ? { id: resume.startId, takeId } : null; pendingStop = resume.stopId ? { id: resume.stopId, takeId } : null; pendingResume = resume.resumeId ? { id: resume.resumeId, takeId } : null;
            publishRemote({ pendingTakeId: takeId, transfer: 'retry', connection: 'disconnected', error: null }); publish({ phase: 'error', pendingRecovery: true, error: 'Seu original do iPhone ainda está disponível. Receba o take para continuar.' }); persistIntent(); await poll(token); return;
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
    remoteStart, remoteStop, configureRemote,
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
    async unlinkRemote() {
      if (!envelope || remote.pendingTakeId || state.pendingRecovery || startWork || stopWork || configuring || state.phase === 'recording') throw new StudioRemoteCameraError('Finalize e salve o take antes de desvincular o iPhone.');
      const token = generation;
      await request({ action: 'unpair', sessionId: envelope.session.id, controllerId: clientId }, token); assert(token);
      cancel();
      if (options.persist !== false) { try { if (localStorage.getItem(controllerStorageKey(options.owner)) === clientId) localStorage.removeItem(controllerStorageKey(options.owner)); } catch { /* Server revocation is authoritative. */ } }
      clientId = studioRemoteControllerId(options.owner, options.persist !== false);
    },
    async reconnect() { const token = generation; const current = preview; preview = null; await current?.disconnect(); assert(token); await poll(token); },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    subscribeRemote(listener) { remoteListeners.add(listener); listener(view()); return () => remoteListeners.delete(listener); },
    cancel, dispose() { if (disposed) return; cancel(); disposed = true; listeners.clear(); remoteListeners.clear(); },
  }; return controller;
}

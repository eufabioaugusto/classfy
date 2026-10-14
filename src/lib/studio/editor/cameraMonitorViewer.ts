import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from 'livekit-client';
import type { StudioCameraMonitor, StudioCameraMonitorResponse } from '../../../../shared/studio/cameraMonitor';
import { createStudioCameraMonitorClient, MONITOR_DEVICE_STALE_MS, StudioCameraMonitorError, studioCameraMonitorFresh, type StudioCameraMonitorClient } from './cameraMonitorClient';

export type StudioCameraMonitorView = {
  monitor: StudioCameraMonitor | null;
  connection: 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'lost';
  stream: MediaStream | null;
  error: string | null;
  serverOffset: number;
};
export type StudioCameraMonitorPreview = { disconnect(): Promise<void> };
export type StudioCameraMonitorPreviewFactory = (response: StudioCameraMonitorResponse, callbacks: { track(track: MediaStreamTrack | null): void; connection(value: 'connecting' | 'connected' | 'reconnecting' | 'lost'): void }, signal: AbortSignal) => Promise<StudioCameraMonitorPreview>;

/** The monitor has no media capture, data publishing, or camera commands. */
export const connectStudioCameraMonitorPreview: StudioCameraMonitorPreviewFactory = async (response, callbacks, signal) => {
  const monitor = response.monitor, connection = response.connection;
  if (!monitor || !connection) throw new StudioCameraMonitorError('Aguarde o iPhone abrir o monitor.');
  const identity = `studio-monitor-device-${monitor.id}-${monitor.deviceId}`;
  const room = new Room({ adaptiveStream: false, dynacast: true });
  let closed = false, camera: MediaStreamTrack | null = null;
  const mute = () => { if (!closed && !signal.aborted) callbacks.track(null); };
  const unmute = () => { if (!closed && !signal.aborted && camera && camera.readyState !== 'ended' && !camera.muted) callbacks.track(camera); };
  const detach = () => { camera?.removeEventListener('mute', mute); camera?.removeEventListener('ended', mute); camera?.removeEventListener('unmute', unmute); camera = null; };
  const published = (publication: RemoteTrackPublication, participant: RemoteParticipant) => { if (!closed && !signal.aborted) publication.setSubscribed(participant.identity === identity && publication.kind === Track.Kind.Video); };
  const subscribed = (track: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
    if (closed || signal.aborted || participant.identity !== identity || track.kind !== Track.Kind.Video) return;
    try { track.setPlayoutDelay(0); } catch { /* Unsupported delay hints must not block viewing. */ }
    detach(); camera = track.mediaStreamTrack;
    camera.addEventListener('mute', mute); camera.addEventListener('ended', mute); camera.addEventListener('unmute', unmute);
    callbacks.track(camera.readyState === 'ended' || camera.muted ? null : camera);
  };
  room.on(RoomEvent.TrackPublished, published);
  room.on(RoomEvent.TrackSubscribed, subscribed);
  room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => { if (!closed && participant.identity === identity && track.kind === Track.Kind.Video && track.mediaStreamTrack === camera) { detach(); callbacks.track(null); } });
  room.on(RoomEvent.Reconnecting, () => { if (!closed) { callbacks.track(null); callbacks.connection('reconnecting'); } });
  room.on(RoomEvent.Reconnected, () => { if (!closed && !signal.aborted) { unmute(); callbacks.connection('connected'); } });
  room.on(RoomEvent.Disconnected, () => { if (!closed) { detach(); callbacks.track(null); callbacks.connection('lost'); } });
  const disconnect = async () => { if (closed) return; closed = true; signal.removeEventListener('abort', abort); detach(); room.removeAllListeners(); callbacks.track(null); await room.disconnect(); };
  const abort = () => { void disconnect(); }; signal.addEventListener('abort', abort, { once: true });
  try {
    callbacks.connection('connecting'); await room.connect(connection.url, connection.token, { autoSubscribe: false });
    if (closed || signal.aborted) throw new DOMException('Monitor desconectado.', 'AbortError');
    room.remoteParticipants.forEach(participant => participant.trackPublications.forEach(publication => published(publication, participant)));
    callbacks.connection('connected'); return { disconnect };
  } catch (error) { await disconnect(); throw error; }
};

export function createStudioCameraMonitorViewer(options: { owner: string; sessionId?: string; client?: StudioCameraMonitorClient; preview?: StudioCameraMonitorPreviewFactory; clientId?: string }) {
  const client = options.client ?? createStudioCameraMonitorClient(options.owner), factory = options.preview ?? connectStudioCameraMonitorPreview;
  const clientId = options.clientId ?? crypto.randomUUID(), listeners = new Set<(state: StudioCameraMonitorView) => void>();
  let state: StudioCameraMonitorView = { monitor: null, connection: 'waiting', stream: null, error: null, serverOffset: 0 };
  let disposed = false, started = false, generation = 0, lifecycle = new AbortController(), preview: StudioCameraMonitorPreview | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined, freshnessTimer: ReturnType<typeof setTimeout> | undefined;
  let work: Promise<void> | null = null, terminal = false;
  const current = (token: number) => !disposed && token === generation && !lifecycle.signal.aborted;
  const publish = (patch: Partial<StudioCameraMonitorView>) => { if (disposed) return; state = { ...state, ...patch }; listeners.forEach(listener => listener(state)); };
  const clearTimers = () => { clearTimeout(pollTimer); clearTimeout(freshnessTimer); pollTimer = undefined; freshnessTimer = undefined; };
  const detach = async () => { const previous = preview; preview = null; publish({ stream: null }); await previous?.disconnect(); };
  const serverNow = () => Date.now() + state.serverOffset;
  const lost = async (message: string) => { publish({ monitor: null, stream: null, connection: 'lost', error: message }); clearTimeout(freshnessTimer); await detach(); };
  const scheduleFreshness = (monitor: StudioCameraMonitor, token: number) => {
    clearTimeout(freshnessTimer);
    const deadline = Math.min(Date.parse(monitor.expiresAt), Date.parse(monitor.deviceSeenAt!) + MONITOR_DEVICE_STALE_MS);
    freshnessTimer = setTimeout(() => { if (current(token) && !studioCameraMonitorFresh(state.monitor, serverNow())) void lost('A conexão com o iPhone foi perdida. A gravação continua no aparelho.'); }, Math.max(1, deadline - serverNow() + 1));
  };
  const request = async (body: Parameters<StudioCameraMonitorClient['request']>[0], token: number) => {
    const sent = Date.now(), response = await client.request(body, { signal: lifecycle.signal, isCurrent: () => current(token) });
    if (!current(token)) throw new DOMException('Monitor desconectado.', 'AbortError');
    publish({ serverOffset: Date.parse(response.serverAt) - (sent + Date.now()) / 2 }); return response;
  };
  const adopt = async (response: StudioCameraMonitorResponse, token: number) => {
    if (!current(token)) return false;
    if (!response.monitor || response.monitor.ownerId !== options.owner || !studioCameraMonitorFresh(response.monitor, serverNow())) {
      if (state.monitor || state.stream) await lost('O iPhone encerrou o monitor ou ficou desconectado.');
      return false;
    }
    if (options.sessionId && options.sessionId !== response.monitor.id) throw new StudioCameraMonitorError('Esta prévia foi encerrada. Ative uma nova pelo iPhone.');
    if (state.monitor && (state.monitor.id !== response.monitor.id || state.monitor.deviceId !== response.monitor.deviceId)) throw new StudioCameraMonitorError('A sessão do monitor mudou. Reconecte para continuar.');
    publish({ monitor: response.monitor, error: null }); scheduleFreshness(response.monitor, token); return true;
  };
  const connect = async (token: number) => {
    if (!state.monitor || preview || !current(token)) return;
    const response = await request({ action: 'monitor-connect', sessionId: state.monitor.id, role: 'viewer', clientId }, token);
    if (!await adopt(response, token) || !current(token)) return;
    const sessionId = response.monitor!.id;
    const connectedSession = () => current(token) && state.monitor?.id === sessionId && studioCameraMonitorFresh(state.monitor, serverNow());
    const result = await factory(response, {
      track: track => { if (connectedSession()) publish({ stream: track ? new MediaStream([track]) : null, connection: track ? 'connected' : state.connection === 'connected' ? 'reconnecting' : state.connection }); },
      connection: value => { if (connectedSession()) publish({ connection: value === 'connected' && !state.stream ? 'connecting' : value }); },
    }, lifecycle.signal);
    if (!connectedSession()) { await result.disconnect(); return; }
    preview = result;
  };
  const poll = async (token: number): Promise<void> => {
    if (!current(token) || terminal || work) return work ?? undefined;
    clearTimeout(pollTimer); pollTimer = undefined;
    const operation = (async () => {
      try {
        const response = await request(state.monitor ? { action: 'monitor-heartbeat', sessionId: state.monitor.id, role: 'viewer', clientId } : { action: 'monitor-discover' }, token);
        if (!await adopt(response, token) || !current(token)) return;
        if (state.connection === 'lost') await detach();
        await connect(token);
      } catch (cause) {
        if (!current(token) || cause instanceof DOMException && cause.name === 'AbortError') return;
        terminal = cause instanceof StudioCameraMonitorError && ['account_changed', 'unauthorized', 'premium_required', 'studio_camera_premium_required', 'studio_camera_monitor_premium_required', 'studio_camera_creator_required'].includes(cause.code);
        await lost(cause instanceof Error ? cause.message : 'A conexão com o iPhone foi interrompida.');
      } finally {
        if (current(token) && !terminal) pollTimer = setTimeout(() => { void poll(token); }, state.monitor ? 5_000 : 2_000);
      }
    })();
    work = operation;
    await operation; if (work === operation) work = null;
  };
  return {
    subscribe(listener: (view: StudioCameraMonitorView) => void) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    async start() { if (disposed || started) return; started = true; await poll(generation); },
    async reconnect() { if (disposed) return; generation++; lifecycle.abort(); lifecycle = new AbortController(); clearTimers(); work = null; terminal = false; await detach(); publish({ monitor: null, stream: null, connection: 'waiting', error: null }); await poll(generation); },
    async dispose() { if (disposed) return; generation++; lifecycle.abort(); clearTimers(); await detach(); disposed = true; listeners.clear(); },
  };
}

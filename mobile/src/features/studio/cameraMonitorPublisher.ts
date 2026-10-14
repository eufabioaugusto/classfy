import { STUDIO_CAMERA_MONITOR_HEARTBEAT_MS, studioMonitorConfigurationChanged, studioMonitorErrorMessage, validStudioMonitorState } from './cameraMonitorModel';
import type { StudioCameraMonitor, StudioCameraMonitorResponse, StudioCameraMonitorState } from './cameraMonitorProtocol';
import type { StudioCameraMonitorDeviceAction } from './cameraMonitorApi';
import type { StudioMonitorPreviewTransport, StudioMonitorTransportState } from './cameraMonitorTransport';

export type StudioMonitorPublisherSnapshot = {
  enabled: boolean; phase: 'off' | 'waiting' | 'connecting' | 'connected' | 'error';
  viewerPresent: boolean; monitor: StudioCameraMonitor | null; error: string | null;
};
export const initialStudioMonitorPublisher: StudioMonitorPublisherSnapshot = { enabled: false, phase: 'off', viewerPresent: false, monitor: null, error: null };
type Dependencies = {
  owner: string; kind: 'aula' | 'short'; title: string;
  current: () => boolean;
  deviceId: () => Promise<string>; uuid: () => string;
  request: (action: StudioCameraMonitorDeviceAction, body: Record<string, unknown>) => Promise<StudioCameraMonitorResponse>;
  transport: (onState: (state: StudioMonitorTransportState) => void) => StudioMonitorPreviewTransport;
};

/** Owns monitor requests only. Local REC, camera configuration and files are external. */
export function createStudioCameraMonitorPublisher(deps: Dependencies) {
  let snapshot = { ...initialStudioMonitorPublisher }, disposed = false, epoch = 0;
  let desiredTag: number | null = null, publishedTag: number | null = null;
  let source: StudioCameraMonitorState | null = null, sessionId: string | null = null, deviceId: string | null = null;
  let transport: StudioMonitorPreviewTransport | null = null;
  let queue = Promise.resolve(), heartbeat: ReturnType<typeof setInterval> | null = null;
  let stateTimer: ReturnType<typeof setTimeout> | null = null, stateQueued = false;
  const listeners = new Set<(value: StudioMonitorPublisherSnapshot) => void>();
  const closingPreviews = new WeakMap<StudioMonitorPreviewTransport, Promise<void>>();
  const emit = (patch: Partial<StudioMonitorPublisherSnapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener(snapshot)); };
  const current = (token: number) => !disposed && snapshot.enabled && token === epoch && deps.current();
  function clearTimers() { if (heartbeat) clearInterval(heartbeat); heartbeat = null; if (stateTimer) clearTimeout(stateTimer); stateTimer = null; stateQueued = false; }
  function enqueue(work: () => Promise<void>) { const next = queue.then(work, work); queue = next.catch(() => undefined); return next; }
  function disconnectPreview(owned: StudioMonitorPreviewTransport | null) {
    if (!owned) return Promise.resolve();
    let closing = closingPreviews.get(owned);
    if (!closing) { closing = owned.disconnect().catch(() => undefined); closingPreviews.set(owned, closing); }
    return closing;
  }
  async function releasePreview() { const owned = transport; transport = null; publishedTag = null; await disconnectPreview(owned); }
  async function close(id: string | null, device: string | null) {
    if (id && device) await deps.request('monitor-close', { sessionId: id, deviceId: device }).catch(() => undefined);
  }
  async function fail(cause: unknown, token: number) {
    if (!current(token)) return;
    const id = sessionId, device = deviceId;
    epoch++; clearTimers();
    emit({ enabled: false, phase: 'error', viewerPresent: false, error: studioMonitorErrorMessage(cause) });
    await releasePreview(); await close(id, device);
    if (sessionId === id) { sessionId = null; deviceId = null; }
  }
  async function reconcile(token: number) {
    if (!current(token) || !sessionId || !deviceId) return;
    while (current(token)) {
      if (publishedTag === desiredTag && transport) return;
      await releasePreview();
      if (!current(token)) return;
      const tag = desiredTag;
      if (tag === null) { emit({ phase: 'waiting', viewerPresent: false }); return; }
      emit({ phase: 'connecting', viewerPresent: false, error: null });
      const response = await deps.request('monitor-connect', { sessionId, role: 'device', clientId: deviceId });
      if (!current(token)) return;
      if (!response.connection || !response.monitor || response.monitor.status !== 'active') throw new Error('Ative o monitor novamente para abrir a prévia.');
      const owned = deps.transport(value => {
        if (!current(token) || transport !== owned || desiredTag !== tag) return;
        if (value.connected) emit({ phase: 'connected', viewerPresent: value.viewerPresent, error: null });
        else if (value.reconnecting) emit({ phase: 'connecting', viewerPresent: false });
        else if (snapshot.phase === 'connected') void enqueue(() => fail(new Error('A prévia desconectou. Ative o monitor novamente; a gravação continua no iPhone.'), token));
      });
      transport = owned;
      await owned.connect(tag, sessionId, response.connection);
      if (!current(token)) { await releasePreview(); return; }
      publishedTag = tag;
      if (desiredTag === tag) return;
    }
  }
  function heartbeatNow(token = epoch) {
    if (!current(token) || stateQueued) return;
    stateQueued = true;
    void enqueue(async () => {
      stateQueued = false;
      if (!current(token) || !sessionId || !deviceId || !source) return;
      try {
        const response = await deps.request('monitor-heartbeat', { sessionId, role: 'device', clientId: deviceId, state: { ...source } });
        if (!current(token)) return;
        if (!response.monitor || response.monitor.status !== 'active') throw new Error('O monitor foi encerrado. Ative Ver no computador novamente.');
        emit({ monitor: response.monitor });
      } catch (cause) { await fail(cause, token); }
    });
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: (value: StudioMonitorPublisherSnapshot) => void) { listeners.add(listener); listener(snapshot); return () => { listeners.delete(listener); }; },
    enable(tag: number | null, state: StudioCameraMonitorState) {
      if (disposed || !deps.current() || snapshot.enabled) return Promise.resolve();
      if (!validStudioMonitorState(state)) return Promise.reject(new Error('Aguarde a câmera preparar o enquadramento.'));
      const token = ++epoch;
      desiredTag = tag; source = { ...state }; sessionId = deps.uuid(); deviceId = null;
      const id = sessionId;
      emit({ enabled: true, phase: 'connecting', viewerPresent: false, error: null, monitor: null });
      return enqueue(async () => {
        try {
          const device = await deps.deviceId();
          if (!current(token)) return;
          deviceId = device;
          const response = await deps.request('monitor-create', { sessionId: id, deviceId: device, kind: deps.kind, title: deps.title.slice(0, 150) });
          if (!current(token)) { await close(id, device); return; }
          emit({ monitor: response.monitor });
          heartbeat = setInterval(() => heartbeatNow(token), STUDIO_CAMERA_MONITOR_HEARTBEAT_MS);
          await reconcile(token);
          heartbeatNow(token);
        } catch (cause) { await fail(cause, token); }
      });
    },
    setSource(tag: number | null) {
      if (desiredTag === tag) return;
      desiredTag = tag;
      if (!snapshot.enabled) return;
      const token = epoch;
      if (tag === null) emit({ phase: 'waiting', viewerPresent: false });
      void enqueue(async () => { try { await reconcile(token); } catch (cause) { await fail(cause, token); } });
    },
    updateState(state: StudioCameraMonitorState) {
      if (!validStudioMonitorState(state)) return;
      const previous = source; source = { ...state };
      if (!snapshot.enabled || !previous || !studioMonitorConfigurationChanged(previous, state)) return;
      if (state.recording !== previous.recording) {
        if (stateTimer) clearTimeout(stateTimer); stateTimer = null;
        heartbeatNow();
      } else if (!stateTimer) stateTimer = setTimeout(() => { stateTimer = null; heartbeatNow(); }, 150);
    },
    previewFailed(message = 'A prévia foi interrompida. Ative o monitor novamente; seu take continua no iPhone.') {
      const token = epoch;
      void enqueue(() => fail(new Error(message), token));
    },
    disable() {
      const id = sessionId, device = deviceId;
      epoch++; clearTimers();
      emit({ enabled: false, phase: 'off', viewerPresent: false, monitor: null, error: null });
      // Cancel a pending connect now; serialized cleanup still owns the old tag.
      void disconnectPreview(transport);
      return enqueue(async () => { await releasePreview(); await close(id, device); if (sessionId === id) { sessionId = null; deviceId = null; } });
    },
    dispose() {
      const pending = this.disable(); disposed = true; listeners.clear(); return pending;
    },
  };
}

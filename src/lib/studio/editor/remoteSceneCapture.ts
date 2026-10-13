import { studioGrade } from '../../../../shared/studio/model';
import type { StudioRemoteConfiguration } from '../../../../shared/studio/remoteCamera';
import { studioCaptureMime, type StudioCaptureController, type StudioCaptureState, type StudioCaptureVideoPatch } from './capture';
import { studioCaptureGrade } from './captureVideo';
import { inspectStudioMedia } from './media';
import { remoteStudioProfile, type StudioRemoteCaptureController, type StudioRemoteStart } from './remoteCameraCapture';
import { createStudioRemoteSceneStore, recoverStudioRemoteScene, studioRemoteScreenFileName, STUDIO_REMOTE_SCREEN_DATABASE, type StudioRemoteSceneRecovery, type StudioRemoteSceneStore } from './remoteSceneRecovery';
import { studioRemoteSceneOffset, type StudioRemoteSceneEvent } from './remoteSceneRender';
import { createStudioSceneCapture } from './sceneCapture';
import { createStudioSceneRecordingBuffer, type StudioSceneRecordingBuffer } from './sceneRecordingBuffer';
import { studioDefaultSceneConfiguration, studioSceneOutputProfile, studioSceneOutputResolutions, studioSceneVideoBitrate, type StudioSceneOutputProfile } from './sceneTypes';

const cancelled = () => new DOMException('Gravação cancelada.', 'AbortError');
const message = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir a gravação. Os originais foram preservados.';
type Dependencies = { store?: StudioRemoteSceneStore; sceneFactory?: typeof createStudioSceneCapture; inspect?: typeof inspectStudioMedia; recover?: typeof recoverStudioRemoteScene; bufferFactory?: typeof createStudioSceneRecordingBuffer };
/** Program is a live monitor. The final take is always rebuilt from native and screen originals. */
export function createStudioRemoteSceneCapture({ remote, owner, aspectRatio = '16:9', ...dependencies }: { remote: StudioRemoteCaptureController; owner: string; aspectRatio?: '16:9' | '9:16' } & Dependencies): StudioRemoteCaptureController {
  const store = dependencies.store ?? createStudioRemoteSceneStore(), listeners = new Set<(state: StudioCaptureState) => void>();
  let state: StudioCaptureState = { phase: 'idle', stream: null, elapsed: 0, file: null, error: null, input: null, camera: null, devices: { cameras: [], microphones: [] }, microphoneEnabled: true, levels: [] };
  let local: StudioCaptureController | null = null, localState: StudioCaptureState | null = null, unsubscribeLocal: (() => void) | null = null;
  let closed = false, generation = 0, prepareWork: Promise<void> | null = null, startWork: Promise<StudioRemoteStart> | null = null, stopWork: Promise<File> | null = null, cancellationWork: Promise<void> | null = null;
  let preparation: AbortController | null = null, entry: StudioRemoteSceneRecovery | null = null, buffer: StudioSceneRecordingBuffer | null = null, raw: MediaRecorder | null = null;
  let rawResult: Promise<File> | null = null, rawStarted = 0, journal = Promise.resolve(), failure: Error | null = null, recording = false;
  let grade = studioGrade(), zoom = 1, profile: StudioSceneOutputProfile = { width: aspectRatio === '9:16' ? 1080 : 1920, height: aspectRatio === '9:16' ? 1920 : 1080, frameRate: 30 };
  const snapshot = () => ({ ...state, devices: structuredClone(state.devices), levels: state.levels.map(value => ({ ...value })), scenes: state.scenes ? structuredClone(state.scenes) : undefined, videoControls: state.videoControls ? structuredClone(state.videoControls) : state.videoControls, outputVideo: state.outputVideo ? structuredClone(state.outputVideo) : state.outputVideo });
  const publish = (patch: Partial<StudioCaptureState>) => { if (closed) return; state = { ...state, ...patch }; for (const listener of listeners) listener(snapshot()); };
  const assert = (expected: number) => { if (closed || generation !== expected) throw cancelled(); };
  const authoritative = () => {
    const screen = localState?.scenes?.selected !== 'camera' ? local?.getScreenOriginalStream?.()?.getVideoTracks()[0]?.getSettings() : undefined;
    const envelope = remote.getEnvelope(), native = envelope ? remoteStudioProfile(envelope, aspectRatio === '9:16' ? 'short' : 'aula') : profile;
    const sourceWidth = screen?.width ?? native.width, sourceHeight = screen?.height ?? native.height, sourceFrameRate = screen?.frameRate ?? native.frameRate;
    return { width: profile.width, height: profile.height, frameRate: profile.frameRate, outputVideo: { resolutions: studioSceneOutputResolutions(aspectRatio), frameRates: [24, 30, 60], sourceWidth, sourceHeight, sourceFrameRate, scaled: sourceWidth < profile.width || sourceHeight < profile.height } };
  };
  const syncProfile = () => { const envelope = remote.getEnvelope(); if (!envelope) return; const native = remoteStudioProfile(envelope, aspectRatio === '9:16' ? 'short' : 'aula'); const short = Math.min(native.width, native.height), long = Math.max(native.width, native.height); profile = { width: aspectRatio === '9:16' ? short : long, height: aspectRatio === '9:16' ? long : short, frameRate: envelope.session.deviceState?.configuration?.fps ?? envelope.session.configuration.fps }; };
  const save = () => {
    if (!entry) return Promise.resolve(); const copy = structuredClone(entry);
    const work = journal.then(() => store.save(copy)); journal = work.catch(error => { failure ??= new Error(`Não foi possível preservar o histórico das cenas. ${message(error)}`); }); return work;
  };
  const event = (atSeconds: number): StudioRemoteSceneEvent => { const value = localState?.scenes; return { atSeconds, scene: value?.selected ?? 'camera', configuration: value ? { position: { ...value.position }, size: value.size, transition: value.transition } : studioDefaultSceneConfiguration(), grade: { ...grade }, zoom }; };
  const recordEvent = () => {
    if (!recording || !entry) return;
    const next = event(Math.max(0, (performance.now() - rawStarted) / 1000)), previous = entry.events.at(-1);
    if (previous && JSON.stringify({ ...previous, atSeconds: 0 }) === JSON.stringify({ ...next, atSeconds: 0 })) return;
    entry.events.push(next); void save().catch(() => { if (recording) void controller.stop().catch(() => undefined); });
  };
  const unsubscribeRemoteState = remote.subscribe(value => {
    if (entry && value.file && !entry.cameraFile) {
      const envelope = remote.getEnvelope(), take = envelope?.takes.find(value => value.id === entry!.takeId);
      if (take?.status === 'uploaded' && value.file.size === take.metadata?.bytes) { entry.cameraFile = value.file; entry.take = take; entry.session = envelope!.session; void save().catch(() => undefined); }
    }
    if (local || startWork || stopWork || recording || entry) return;
    publish({ ...value, file: null, ...(value.phase === 'ready' ? { phase: 'preparing' as const } : {}) });
  });
  const unsubscribeRemoteView = remote.subscribeRemote(value => {
    // The server reserves the take before native START is acknowledged. Save
    // that proven association while activeTakeId exists, even if ACK is lost
    // and a later STOP clears it. An unknown start clock remains unknown.
    if (entry && !entry.takeId && value.session?.id === entry.sessionId && value.session.activeTakeId) {
      entry.takeId = value.session.activeTakeId; void save().catch(() => undefined);
    }
  });
  function waitForCamera(signal: AbortSignal): Promise<MediaStreamTrack> {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {}, done = false;
      const finish = (error?: unknown, track?: MediaStreamTrack) => { if (done) return; done = true; unsubscribe(); clearTimeout(timer); signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(track!); };
      const check = () => { const track = remote.getReceivedCameraTrack(), envelope = remote.getEnvelope(); if (track?.readyState === 'live' && !track.muted && envelope?.session.status === 'ready') finish(undefined, track); };
      const abort = () => finish(cancelled()), timer = setTimeout(() => finish(new Error('A conexão do iPhone ainda não ficou pronta. Tente reconectar.')), 180_000);
      signal.addEventListener('abort', abort, { once: true }); unsubscribe = remote.subscribeRemote(check); if (done) unsubscribe(); else check();
      if (signal.aborted) abort();
    });
  }
  function finishRaw(): Promise<File> {
    if (!rawResult) return Promise.reject(new Error('A tela original ainda não foi gravada.'));
    if (raw && raw.state !== 'inactive') { try { raw.stop(); } catch (error) { failure ??= new Error(message(error)); } }
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('O navegador não finalizou a tela original. O trecho capturado foi preservado; retome pela lista de originais.')), 8000); });
    return Promise.race([rawResult, deadline]).finally(() => clearTimeout(timer));
  }
  function beginRaw(stream: MediaStream, expected: number) {
    const ownedBuffer = buffer!, mime = entry!.screenMime, track = stream.getVideoTracks()[0], settings = track.getSettings();
    const owned = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: studioSceneVideoBitrate({ width: settings.width ?? 1920, height: settings.height ?? 1080, frameRate: settings.frameRate ?? profile.frameRate }), audioBitsPerSecond: 192000 }); raw = owned;
    const interrupted = () => { if (!closed && expected === generation && recording && raw === owned) void controller.stop().catch(() => undefined); };
    track.addEventListener?.('ended', interrupted, { once: true }); track.addEventListener?.('mute', interrupted, { once: true });
    rawResult = new Promise<File>((resolve, reject) => {
      let finalizing = false;
      owned.ondataavailable = value => { if (value.data.size) void ownedBuffer.append(value.data).catch(error => { failure ??= new Error(message(error)); if (owned.state !== 'inactive') owned.stop(); interrupted(); }); };
      owned.onerror = value => { failure ??= new Error(message((value as Event & { error?: unknown }).error)); if (owned.state !== 'inactive') owned.stop(); interrupted(); };
      owned.onstop = () => {
        if (finalizing) return; finalizing = true;
        void (async () => { const file = await ownedBuffer.file(studioRemoteScreenFileName(mime), mime); if (!entry) throw new Error('O histórico da gravação não está disponível.'); entry.screenFile = file; entry.status = 'awaiting-master'; await save(); return file; })().then(resolve, reject);
      };
    }); void rawResult.finally(() => { track.removeEventListener?.('ended', interrupted); track.removeEventListener?.('mute', interrupted); }).catch(() => undefined);
    assert(expected); owned.start(1000); rawStarted = performance.now();
  }
  const controller: StudioRemoteCaptureController = {
    prepare() {
      if (closed) return Promise.reject(cancelled());
      if (cancellationWork) return cancellationWork.then(() => controller.prepare());
      if (prepareWork) return prepareWork;
      if (local && state.phase === 'ready') return Promise.resolve();
      if (entry || state.pendingRecovery) return Promise.reject(new Error('Recupere os originais pendentes antes de iniciar outro take.'));
      const expected = ++generation; preparation = new AbortController(); publish({ phase: 'preparing', error: null });
      prepareWork = (async () => {
        await remote.prepare(); assert(expected);
        const track = await waitForCamera(preparation!.signal); assert(expected); syncProfile();
        local = (dependencies.sceneFactory ?? createStudioSceneCapture)({ aspectRatio, externalCamera: { track, name: 'Câmera do iPhone' } });
        unsubscribeLocal = local.subscribe(value => {
          localState = value;
          // Do not publish a preview recorder file, even during its finalization/error callbacks.
          const { phase: _phase, file: _file, pendingRecovery: _pending, ...preview } = value;
          publish({ ...preview, ...authoritative(), camera: { id: 'remote-iphone', name: 'Câmera do iPhone' } }); recordEvent();
        });
        await local.prepare(); assert(expected); await local.configureVideo({ output: profile }); assert(expected);
        publish({ phase: 'ready', file: null, ...authoritative(), error: null });
      })().catch(error => { if (!closed && expected === generation) { local?.dispose(); local = null; publish({ phase: 'error', error: message(error) }); } throw error; }).finally(() => { prepareWork = null; });
      return prepareWork;
    },
    async prepareScreen() { if (!local?.prepareScreen || state.phase !== 'ready') throw new Error('Conecte o iPhone antes de compartilhar a tela.'); await local.prepareScreen(); },
    start() { if (closed || state.phase !== 'ready' || !localState?.scenes?.screenReady || entry) throw new Error('Prepare o compartilhamento de tela e o iPhone antes de gravar com cenas.'); void controller.remoteStart().catch(() => undefined); },
    remoteStart() {
      if (startWork) return startWork;
      const stream = local?.getScreenOriginalStream?.();
      if (closed || state.phase !== 'ready' || !localState?.scenes?.screenReady || !stream || entry) return Promise.reject(new Error('Prepare o compartilhamento de tela e o iPhone antes de gravar com cenas.'));
      const expected = generation; publish({ phase: 'preparing', error: null });
      startWork = (async () => {
        const session = remote.getEnvelope()?.session; if (!session) throw new Error('A sessão do iPhone não está disponível.');
        const mime = studioCaptureMime('scenes'); if (!mime) throw new Error('Este navegador não oferece gravação da tela.');
        const localId = crypto.randomUUID(); entry = { version: 1, key: `${owner}:${session.id}:${localId}`, owner, sessionId: session.id, controllerId: session.controllerId, takeId: null, bufferId: `${owner}-${localId}`, screenMime: mime, title: session.title, createdAt: Date.now(), status: 'preparing', output: { ...profile }, events: [event(0)], startedAtServerMs: null, screenStartedAtServerMs: null, cameraOffsetSeconds: null };
        buffer = (dependencies.bufferFactory ?? createStudioSceneRecordingBuffer)({ databaseName: STUDIO_REMOTE_SCREEN_DATABASE, id: entry.bufferId }); await buffer.prepare(); await save(); assert(expected);
        const acknowledgement = await remote.remoteStart(); assert(expected);
        entry.takeId = acknowledgement.takeId; entry.startedAtServerMs = acknowledgement.startedAtServerMs; await save(); assert(expected);
        beginRaw(stream, expected); entry.screenStartedAtServerMs = remote.getServerNow(); entry.cameraOffsetSeconds = studioRemoteSceneOffset(entry.screenStartedAtServerMs, acknowledgement.startedAtServerMs); entry.status = 'recording';
        // The compositor recorder provides continuous scene monitoring; its file is never a take.
        local!.start(); recording = true; await save(); assert(expected); publish({ phase: 'recording', pendingRecovery: false, file: null }); return acknowledgement;
      })().catch(async error => {
        failure ??= new Error(message(error)); recording = false;
        if (rawResult) await finishRaw().catch(() => undefined);
        if (entry) { entry.status = 'recoverable'; entry.error = message(error); await save().catch(() => undefined); }
        remote.cancel(); local?.cancel();
        if (!closed && expected === generation) publish({ phase: 'error', file: null, pendingRecovery: !!entry, error: message(error) }); throw error;
      }).finally(() => { startWork = null; });
      return startWork;
    },
    stop() {
      if (stopWork) return stopWork;
      if (!entry) return Promise.reject(new Error('Inicie um take antes de finalizar.'));
      const expected = generation; publish({ phase: 'stopping', file: null });
      stopWork = (async () => {
        if (startWork) await startWork; recording = false;
        const stoppedEntry = entry!;
        // Flush raw screen+mixed audio before local.stop closes borrowed sources.
        const screenStop = rawResult ? finishRaw() : Promise.resolve(null);
        // Dispatch native STOP even if a browser recorder cannot flush its final chunk.
        const stopNative = remote.remoteStop().then(async master => {
          stoppedEntry.cameraFile = master.file; stoppedEntry.cameraMetadata = master.metadata; stoppedEntry.take = master.take; stoppedEntry.session = master.session;
          if (entry === stoppedEntry) await save(); else await store.save(stoppedEntry); return master;
        }); void stopNative.catch(() => undefined);
        await screenStop;
        if (localState?.phase === 'recording') await local!.stop().catch(() => undefined); else local?.cancel();
        await stopNative;
        await journal; if (failure) throw failure; assert(expected);
        const file = await (dependencies.recover ?? recoverStudioRemoteScene)(owner, entry!.key, { store, remote, inspect: dependencies.inspect }); assert(expected);
        entry = await store.get(owner, entry!.key) ?? { ...entry!, status: 'complete', outputFile: file }; await save(); assert(expected);
        publish({ phase: 'recorded', stream: null, cameraPreviewStream: null, file, pendingRecovery: false, error: null }); return file;
      })().catch(async error => {
        if (entry) { entry.status = 'recoverable'; entry.error = message(error); await save().catch(() => undefined); }
        if (!closed && expected === generation) publish({ phase: 'error', file: null, pendingRecovery: true, error: message(error) }); throw error;
      }).finally(() => { stopWork = null; }); return stopWork;
    },
    remoteStop: () => remote.remoteStop(),
    async configureVideo(patch: StudioCaptureVideoPatch) {
      if (state.phase !== 'ready' || !local || entry) throw new Error('Ajuste a qualidade antes de iniciar o take.');
      if (patch.hardware) throw new Error('Use os controles Pro do iPhone para ajustar a câmera física.');
      const quality = patch.output ?? (patch.width !== undefined || patch.height !== undefined || patch.frameRate !== undefined ? { width: patch.width ?? profile.width, height: patch.height ?? profile.height, frameRate: patch.frameRate } : undefined);
      if (quality) {
        studioSceneOutputProfile(aspectRatio, profile, quality);
        const short = Math.min(quality.width, quality.height), resolution: StudioRemoteConfiguration['resolution'] = short === 2160 ? '4k' : short === 1440 ? '2k' : short === 1080 ? '1080p' : short === 720 ? '720p' : (() => { throw new Error('Escolha 720p, 1080p, 2K ou 4K.'); })();
        await controller.configureRemote({ resolution, ...(quality.frameRate !== undefined ? { fps: quality.frameRate as 24 | 30 | 60 } : {}) });
      }
      if (patch.grade || patch.zoom !== undefined) { const next = studioCaptureGrade(grade, patch.grade); await local.configureVideo({ ...(patch.grade ? { grade: next } : {}), ...(patch.zoom !== undefined ? { zoom: patch.zoom } : {}) }); grade = next; zoom = patch.zoom ?? zoom; }
    },
    async configureRemote(patch) { if (state.phase !== 'ready' || !local || entry) throw new Error('Ajuste o iPhone antes de gravar.'); await remote.configureRemote(patch); syncProfile(); await local.configureVideo({ output: profile }); publish(authoritative()); },
    async flip() { await controller.configureRemote({ cameraFacing: remote.getEnvelope()?.session.configuration.cameraFacing === 'back' ? 'front' : 'back' }); },
    async selectDevices(selection) { if (selection.cameraId !== undefined) throw new Error('Escolha a câmera nos controles do iPhone.'); if (!local) throw new Error('Conecte o iPhone primeiro.'); await local.selectDevices(selection); },
    setMicrophoneEnabled(value) { if (!local) throw new Error('Conecte o iPhone primeiro.'); local.setMicrophoneEnabled(value); },
    getMicrophoneTrack: () => local?.getMicrophoneTrack() ?? null,
    getScreenOriginalStream: () => local?.getScreenOriginalStream?.() ?? null,
    selectScene(scene) { if (!local || !['ready', 'recording'].includes(state.phase)) throw new Error('Prepare as cenas antes de alternar.'); local.selectScene?.(scene); recordEvent(); },
    configureScene(patch) { if (!local || !['ready', 'recording'].includes(state.phase)) throw new Error('Prepare as cenas antes de ajustar.'); local.configureScene?.(patch); recordEvent(); },
    getReceivedCameraTrack: () => remote.getReceivedCameraTrack(), getServerNow: () => remote.getServerNow(), getEnvelope: () => remote.getEnvelope(), subscribeRemote: listener => remote.subscribeRemote(listener),
    async reconnect() { await remote.reconnect(); }, discardRemoteRecovery() { remote.discardRemoteRecovery(); },
    async unlinkRemote() { if (entry || recording || startWork || stopWork) throw new Error('Finalize e salve o take antes de desvincular o iPhone.'); await remote.unlinkRemote(); controller.cancel(); },
    cancel() {
      if (cancellationWork) return;
      generation++; preparation?.abort(); recording = false;
      // This is salvage, not deletion. The native adapter queues STOP and retains its master.
      const salvage = rawResult ? finishRaw().catch(() => undefined) : Promise.resolve(), completed = state.phase === 'recorded' && !!state.file;
      remote.cancel();
      const work = (async () => {
        await Promise.all([salvage, startWork?.catch(() => undefined), stopWork?.catch(() => undefined), prepareWork?.catch(() => undefined)]);
        local?.cancel();
        if (entry) { entry.status = completed ? 'complete' : 'recoverable'; await save().catch(() => undefined); }
        unsubscribeLocal?.(); unsubscribeLocal = null; local?.dispose(); local = null; localState = null;
        entry = null; buffer = null; raw = null; rawResult = null; failure = null; grade = studioGrade(); zoom = 1;
        publish({ pendingRecovery: false });
      })(); cancellationWork = work; void work.finally(() => { if (cancellationWork === work) cancellationWork = null; });
      publish({ phase: 'idle', stream: null, file: null, pendingRecovery: !!entry && !completed });
    },
    dispose() { if (closed) return; controller.cancel(); closed = true; unsubscribeRemoteState(); unsubscribeRemoteView(); unsubscribeLocal?.(); listeners.clear(); void (rawResult ?? Promise.resolve()).catch(() => undefined).finally(() => local?.dispose()); remote.dispose(); },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
  };
  return controller;
}

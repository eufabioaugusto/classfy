import { inspectStudioMedia } from './media';

export type StudioCaptureMode = 'camera' | 'screen' | 'audio';
export type StudioCaptureDevice = { id: string; name: string };
export type StudioCaptureState = {
  phase: 'idle' | 'preparing' | 'ready' | 'recording' | 'stopping' | 'recorded' | 'error';
  stream: MediaStream | null; elapsed: number; file: File | null; error: string | null;
  input: StudioCaptureDevice | null; camera: StudioCaptureDevice | null;
  devices: { cameras: StudioCaptureDevice[]; microphones: StudioCaptureDevice[] };
  microphoneEnabled: boolean; levels: { averageDb: number; peakDb: number }[];
  width?: number; height?: number; frameRate?: number;
};
export type StudioCaptureController = {
  prepare(): Promise<void>; start(): void; stop(): Promise<File>; flip(): Promise<void>;
  selectDevices(selection: { cameraId?: string; microphoneId?: string }): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): void;
  cancel(): void; dispose(): void; subscribe(listener: (state: StudioCaptureState) => void): () => void;
};
export function studioAudioLevels(channels: readonly Float32Array[]) {
  return channels.map(samples => {
    let sum = 0, peak = 0; for (const sample of samples) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
    const db = (value: number) => Math.max(-120, 20 * Math.log10(Math.max(value, 1e-6)));
    return { averageDb: db(Math.sqrt(sum / Math.max(1, samples.length))), peakDb: db(peak) };
  });
}
export function studioCaptureMime(mode: StudioCaptureMode): string {
  const candidates = mode === 'audio' ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'] : ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}
type Pipeline = { stream: MediaStream; camera: MediaStreamTrack | null; microphone: MediaStreamTrack | null; display: MediaStream | null; context: AudioContext | null; analyser: AnalyserNode | null };
/** No permission, enumeration or device work is performed by construction. */
export function createStudioCapture({ mode, facing = 'user', deviceId, cameraId }: { mode: StudioCaptureMode; facing?: 'user' | 'environment'; deviceId?: string; cameraId?: string }): StudioCaptureController {
  let state: StudioCaptureState = { phase: 'idle', stream: null, elapsed: 0, file: null, error: null, input: null, camera: null, devices: { cameras: [], microphones: [] }, microphoneEnabled: true, levels: [] };
  const tracks = new Set<MediaStreamTrack>(), contexts = new Set<AudioContext>(), listeners = new Set<(state: StudioCaptureState) => void>();
  const media = navigator.mediaDevices;
  let generation = 0, enumeration = 0, authorized = false, closed = false, pipeline: Pipeline | null = null, recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [], meterTimer: ReturnType<typeof setInterval> | null = null, started = 0, stopPromise: Promise<File> | null = null, recordingGeneration = 0, notice: string | null = null;
  let stopReject: ((reason: unknown) => void) | null = null, candidate: File | null = null;
  const snapshot = () => ({ ...state, levels: state.levels.map(value => ({ ...value })), devices: { cameras: state.devices.cameras.map(value => ({ ...value })), microphones: state.devices.microphones.map(value => ({ ...value })) } });
  const publish = (patch: Partial<StudioCaptureState>) => { if (closed) return; state = { ...state, ...patch }; listeners.forEach(listener => listener(snapshot())); };
  const assert = (expected: number) => { if (closed || expected !== generation) throw new DOMException('Captura cancelada.', 'AbortError'); };
  const closeContext = (context: AudioContext) => { if (!contexts.delete(context)) return; void context.close().catch(() => undefined); };
  const releaseTrack = (track: MediaStreamTrack) => { if (!tracks.delete(track)) return; track.onended = null; track.onmute = null; track.onunmute = null; track.stop(); };
  const stopMeter = () => { if (meterTimer) clearInterval(meterTimer); meterTimer = null; };
  const stopDevices = () => {
    stopMeter(); [...tracks].forEach(releaseTrack); [...contexts].forEach(closeContext); pipeline = null;
    publish({ stream: null, input: null, camera: null, levels: [], width: undefined, height: undefined, frameRate: undefined });
  };
  const own = (stream: MediaStream, expected: number) => {
    if (closed || generation !== expected) { new Set(stream.getTracks()).forEach(track => track.stop()); assert(expected); }
    stream.getTracks().forEach(track => tracks.add(track)); return stream;
  };
  const interrupt = () => {
    if (!['ready', 'preparing', 'recording'].includes(state.phase)) return;
    notice = 'A entrada foi interrompida. O trecho já capturado foi preservado.';
    if (state.phase === 'recording') void controller.stop().catch(() => undefined);
    else { generation++; enumeration++; stopDevices(); publish({ phase: 'idle', error: 'A entrada foi desconectada. Ative a captura novamente.' }); }
  };
  const refreshDevices = async () => {
    if (!authorized || closed || !media?.enumerateDevices) return;
    const request = ++enumeration, expected = generation;
    try {
      const list = await media.enumerateDevices();
      if (closed || request !== enumeration || expected !== generation) return;
      const inputs = (kind: MediaDeviceKind) => list.filter(value => value.kind === kind && value.deviceId).map(value => ({ id: value.deviceId, name: value.label || (kind === 'videoinput' ? 'Câmera autorizada' : 'Microfone autorizado') }));
      publish({ devices: { cameras: inputs('videoinput'), microphones: inputs('audioinput') }, ...(pipeline ? { input: inputIdentity(pipeline.microphone, 'Microfone autorizado'), camera: inputIdentity(pipeline.camera, 'Câmera autorizada') } : {}) });
      // Track lifetime is authoritative; a restricted enumeration alone is not
      // proof that an input has disappeared or permission has been revoked.
      if (pipeline && [...tracks].some(track => track.readyState === 'ended')) interrupt();
    } catch { /* The active tracks remain usable if enumeration is unavailable. */ }
  };
  const videoConstraints = (id: string | undefined): MediaTrackConstraints => ({ ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: facing } }), width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
  const audioConstraints = (id: string | undefined): true | MediaTrackConstraints => id ? { deviceId: { exact: id }, echoCancellation: true } : true;
  const buildPipeline = async (camera: MediaStreamTrack | null, microphone: MediaStreamTrack | null, display: MediaStream | null, expected: number): Promise<Pipeline> => {
    if (microphone) microphone.enabled = state.microphoneEnabled;
    let context: AudioContext | null = null, analyser: AnalyserNode | null = null;
    if (microphone || display?.getAudioTracks().length) {
      context = new AudioContext(); contexts.add(context); await context.resume(); assert(expected);
      // Meter the named physical mic before mixing display audio. Disabling its
      // track yields silence; display audio can continue without false mic peaks.
      if (microphone) { analyser = context.createAnalyser(); analyser.fftSize = 2048; context.createMediaStreamSource(new MediaStream([microphone])).connect(analyser); }
    }
    let stream: MediaStream;
    if (display) {
      const destination = context!.createMediaStreamDestination();
      if (display.getAudioTracks().length) context!.createMediaStreamSource(display).connect(destination);
      if (microphone) context!.createMediaStreamSource(new MediaStream([microphone])).connect(destination);
      stream = own(new MediaStream([...display.getVideoTracks(), ...destination.stream.getAudioTracks()]), expected);
    } else stream = own(new MediaStream([...(camera ? [camera] : []), ...(microphone ? [microphone] : [])]), expected);
    assert(expected); return { stream, camera, microphone, display, context, analyser };
  };
  const meter = () => {
    const mic = pipeline?.microphone, analyser = pipeline?.analyser;
    if (mic && analyser) {
      const samples = new Float32Array(analyser.fftSize);
      if (state.microphoneEnabled && !mic.muted && mic.readyState === 'live') analyser.getFloatTimeDomainData(samples);
      publish({ levels: studioAudioLevels([samples]) });
    }
    if (recorder?.state === 'recording') publish({ elapsed: (performance.now() - started) / 1000 });
  };
  const install = (next: Pipeline, expected: number) => {
    assert(expected); stopMeter();
    if (next.microphone) next.microphone.enabled = state.microphoneEnabled;
    const retained = new Set([...next.stream.getTracks(), ...(next.display?.getTracks() ?? []), ...(next.camera ? [next.camera] : []), ...(next.microphone ? [next.microphone] : [])]);
    [...tracks].forEach(track => { if (!retained.has(track)) releaseTrack(track); });
    [...contexts].forEach(context => { if (context !== next.context) closeContext(context); }); pipeline = next;
    retained.forEach(track => {
      track.onended = () => { if (tracks.has(track)) interrupt(); };
      track.onmute = () => { if (!tracks.has(track)) return; if (track.readyState === 'ended') interrupt(); else if (track === pipeline?.microphone) meter(); };
      track.onunmute = () => { if (tracks.has(track) && track === pipeline?.microphone) meter(); };
    });
    const settings = next.camera?.getSettings() ?? next.display?.getVideoTracks()[0]?.getSettings();
    publish({ phase: 'ready', stream: next.stream, input: inputIdentity(next.microphone, 'Microfone autorizado'), camera: inputIdentity(next.camera, 'Câmera autorizada'), width: settings?.width, height: settings?.height, frameRate: settings?.frameRate, levels: [], error: null });
    meterTimer = setInterval(() => { if (!closed && expected === generation) meter(); }, 100);
    authorized = true; void refreshDevices();
  };
  const assertCanSelect = () => {
    if (closed) throw new DOMException('Captura encerrada.', 'AbortError');
    if (candidate || state.file) throw new Error('Salve ou descarte o take pendente antes de trocar a entrada.');
    if (['recording', 'stopping', 'preparing'].includes(state.phase)) throw new Error('Troque a entrada antes de iniciar a gravação.');
  };
  const prepare = async () => {
    assertCanSelect();
    if (!media?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este navegador não oferece gravação local. Use Chrome, Edge ou Safari atualizado em HTTPS.');
    const expected = ++generation; enumeration++; stopDevices(); notice = null; stopPromise = null; publish({ phase: 'preparing', error: null, file: null, elapsed: 0 });
    try {
      let display: MediaStream | null = null, source: MediaStream;
      if (mode === 'screen') {
        if (!media.getDisplayMedia) throw new Error('A gravação da tela não está disponível neste navegador.');
        display = own(await media.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true }), expected);
        source = own(await media.getUserMedia({ video: false, audio: audioConstraints(deviceId) }), expected);
      } else source = own(await media.getUserMedia({ video: mode === 'camera' ? videoConstraints(cameraId) : false, audio: audioConstraints(deviceId) }), expected);
      const camera = source.getVideoTracks()[0] ?? null, microphone = source.getAudioTracks()[0] ?? null;
      if (!microphone || mode === 'camera' && !camera || display && !display.getVideoTracks().length) throw new Error('A entrada autorizada não forneceu os canais necessários para gravar.');
      install(await buildPipeline(camera, microphone, display, expected), expected);
    } catch (error) { if (expected === generation && !closed) { stopDevices(); publish({ phase: 'error', error: captureError(error) }); } throw friendlyError(error); }
  };
  const controller: StudioCaptureController = {
    prepare,
    async selectDevices(selection) {
      assertCanSelect();
      const changeCamera = selection.cameraId !== undefined, changeMicrophone = selection.microphoneId !== undefined;
      if (changeCamera && mode !== 'camera') throw new Error('A câmera só pode ser selecionada na gravação pela câmera.');
      const nextCamera = changeCamera ? selection.cameraId || undefined : cameraId, nextMicrophone = changeMicrophone ? selection.microphoneId || undefined : deviceId;
      if (state.phase !== 'ready' || !pipeline) { cameraId = nextCamera; deviceId = nextMicrophone; publish({ error: null }); return; }
      const replaceCamera = changeCamera && (!nextCamera || pipeline.camera?.getSettings().deviceId !== nextCamera);
      const replaceMic = changeMicrophone && (!nextMicrophone || pipeline.microphone?.getSettings().deviceId !== nextMicrophone);
      if (!replaceCamera && !replaceMic) { cameraId = nextCamera; deviceId = nextMicrophone; return; }
      const original = pipeline, originalTracks = new Set(tracks), originalContexts = new Set(contexts), expected = ++generation;
      enumeration++; stopMeter(); publish({ phase: 'preparing', error: null });
      try {
        const source = own(await media.getUserMedia({ video: replaceCamera ? videoConstraints(nextCamera) : false, audio: replaceMic ? audioConstraints(nextMicrophone) : false }), expected);
        const camera = replaceCamera ? source.getVideoTracks()[0] ?? null : original.camera, microphone = replaceMic ? source.getAudioTracks()[0] ?? null : original.microphone;
        if (replaceCamera && !camera || replaceMic && !microphone) throw new Error('O dispositivo escolhido não forneceu uma entrada válida.');
        const next = await buildPipeline(camera, microphone, original.display, expected);
        assert(expected); cameraId = nextCamera; deviceId = nextMicrophone; install(next, expected);
      } catch (error) {
        if (!closed && expected === generation) {
          [...tracks].forEach(track => { if (!originalTracks.has(track)) releaseTrack(track); }); [...contexts].forEach(context => { if (!originalContexts.has(context)) closeContext(context); });
          install(original, expected); publish({ error: captureError(error) });
        }
        throw friendlyError(error);
      }
    },
    setMicrophoneEnabled(enabled) {
      if (closed) throw new DOMException('Captura encerrada.', 'AbortError');
      if (state.phase === 'stopping' || candidate) throw new Error('Conclua o take antes de alterar o microfone.');
      const microphone = pipeline?.microphone; if (microphone) microphone.enabled = enabled;
      publish({ microphoneEnabled: enabled, levels: [] }); if (microphone && !enabled) meter();
    },
    start() {
      if (closed || state.phase !== 'ready' || !state.stream) throw new Error('Ative a entrada antes de gravar.');
      if ([...tracks].some(track => track.readyState === 'ended')) { interrupt(); throw new Error('Uma entrada foi desconectada. Ative a captura novamente.'); }
      const mime = studioCaptureMime(mode); if (!mime) throw new Error('O navegador não oferece um formato de gravação compatível.');
      chunks = []; stopPromise = null; notice = null; recordingGeneration = generation;
      recorder = new MediaRecorder(state.stream, { mimeType: mime, ...(mode !== 'audio' ? { videoBitsPerSecond: 8000000 } : {}), audioBitsPerSecond: 192000 });
      const ownedGeneration = recordingGeneration;
      recorder.ondataavailable = event => { if (ownedGeneration === generation && event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { notice = 'O gravador encontrou um erro. Tentaremos preservar o trecho disponível.'; void controller.stop().catch(() => undefined); };
      recorder.start(1000); started = performance.now(); publish({ phase: 'recording', elapsed: 0, error: null });
    },
    stop() {
      if (stopPromise) return stopPromise;
      if (candidate && state.phase === 'error') {
        const file = candidate, expected = generation; publish({ phase: 'stopping', error: null });
        const attempt = (async () => { try { const metadata = await inspectStudioMedia(file); assert(expected); if (metadata.duration < .1 || mode === 'audio' && !metadata.hasAudio) throw new Error('Não foi encontrado um trecho válido de áudio ou vídeo.'); publish({ phase: 'recorded', file, elapsed: metadata.duration, error: notice }); return file; } catch (error) { if (expected === generation && !closed) publish({ phase: 'error', file, error: captureError(error) }); throw error; } })();
        stopPromise = attempt; void attempt.finally(() => { if (stopPromise === attempt) stopPromise = null; }).catch(() => undefined); return attempt;
      }
      if (!recorder || !['recording', 'paused'].includes(recorder.state)) return Promise.reject(new Error('Não existe gravação ativa para concluir.'));
      const owned = recorder, expected = recordingGeneration; publish({ phase: 'stopping' });
      stopPromise = new Promise<File>((resolve, reject) => {
        stopReject = reject;
        owned.onstop = () => { void (async () => {
          try {
            assert(expected); stopDevices(); const type = owned.mimeType || chunks[0]?.type || studioCaptureMime(mode), extension = type.includes('mp4') ? mode === 'audio' ? 'm4a' : 'mp4' : 'webm';
            const file = new File(chunks, `Classfy-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type }); chunks = []; candidate = file;
            // Recorder clocks are not proof of content: inspect the actual bytes.
            const metadata = await inspectStudioMedia(file); assert(expected);
            if (metadata.duration < .1 || mode === 'audio' && !metadata.hasAudio) throw new Error('Não foi encontrado um trecho válido de áudio ou vídeo. Grave por mais tempo e tente novamente.');
            recorder = null; stopReject = null; publish({ phase: 'recorded', file, elapsed: metadata.duration, error: notice }); resolve(file);
          } catch (error) { if (expected === generation && !closed) { recorder = null; stopReject = null; stopPromise = null; stopDevices(); publish({ phase: 'error', file: candidate, error: captureError(error) }); } reject(error); }
        })(); };
        try { owned.stop(); } catch (error) { reject(error); }
      }); return stopPromise;
    },
    async flip() { if (mode !== 'camera' || state.phase !== 'ready') throw new Error('Troque a câmera antes de iniciar a gravação.'); const previous = facing; facing = facing === 'user' ? 'environment' : 'user'; try { await controller.selectDevices({ cameraId: '' }); } catch (error) { facing = previous; throw error; } },
    cancel() {
      generation++; enumeration++; stopReject?.(new DOMException('Captura cancelada.', 'AbortError')); stopReject = null;
      if (recorder) { recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null; if (recorder.state !== 'inactive') try { recorder.stop(); } catch { /* already stopped by the device */ } }
      recorder = null; chunks = []; candidate = null; stopPromise = null; stopDevices(); publish({ phase: 'idle', file: null, elapsed: 0, error: null });
    },
    dispose() { if (closed) return; controller.cancel(); closed = true; listeners.clear(); document.removeEventListener('visibilitychange', visibility); media?.removeEventListener?.('devicechange', devicechange); },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
  };
  const visibility = () => { if (document.visibilityState === 'visible') return; if (state.phase === 'recording') { notice = 'A gravação foi encerrada ao sair desta aba. Confira o trecho antes de usar.'; void controller.stop().catch(() => undefined); } else if (state.phase === 'ready' || state.phase === 'preparing') controller.cancel(); };
  const devicechange = () => { void refreshDevices(); };
  document.addEventListener('visibilitychange', visibility); media?.addEventListener?.('devicechange', devicechange); return controller;
}
function inputIdentity(track: MediaStreamTrack | null, fallback: string): StudioCaptureDevice | null { return track ? { id: track.getSettings().deviceId ?? track.id, name: track.label || fallback } : null; }
function captureError(error: unknown) {
  const value = error as Error;
  if (value.name === 'NotAllowedError' || value.name === 'SecurityError') return 'Permita câmera e microfone no navegador para gravar. Se negou, abra as permissões deste site e tente novamente.';
  if (value.name === 'NotFoundError') return 'A entrada de câmera ou microfone não foi encontrada. Confira a conexão e escolha outra entrada.';
  if (value.name === 'OverconstrainedError') return 'O dispositivo escolhido não está disponível ou não atende à captura. Confira a conexão e escolha outra entrada.';
  if (value.name === 'NotReadableError') return 'Não foi possível acessar a entrada. Feche outro aplicativo que esteja usando a câmera ou o microfone e tente novamente.';
  return value.message || 'Não foi possível iniciar a captura.';
}
function friendlyError(error: unknown) { const value = new Error(captureError(error)); value.name = (error as Error).name || 'Error'; return value; }

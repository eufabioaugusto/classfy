import { studioGrade, type StudioGrade } from '../../../../shared/studio/model';
import { inspectStudioMedia } from './media';
import type { StudioCaptureController, StudioCaptureDevice, StudioCaptureState } from './capture';
import { studioCaptureGrade, studioCaptureIdentityGrade, studioCaptureSourceDimensions, studioCaptureVideoControls, type StudioCaptureVideoPatch, type StudioCaptureVideoProcessor } from './captureVideo';
import { createStudioSceneComposition, type StudioSceneComposition } from './sceneComposition';
import { normalizeStudioSceneConfiguration, studioDefaultSceneConfiguration, studioScenesSupport, studioSceneOutputProfile, studioSceneOutputResolutions, studioSceneVideoBitrate, type StudioCaptureScene, type StudioSceneConfiguration, type StudioSceneOutputProfile } from './sceneTypes';
import { createStudioSceneRecordingBuffer } from './sceneRecordingBuffer';
import { applyStudioCameraHardware, StudioCameraHardwareRestoreError, cloneStudioCameraHardware } from './cameraHardware';
import { resumeStudioCaptureAudio } from './audioPreparation';

export function getStudioSceneCapabilities(): { available: boolean; reason?: string } { const result = studioScenesSupport(); return { available: result.supported, reason: result.reason }; }
const abort = () => new DOMException('Captura cancelada.', 'AbortError');
const identity = (track: MediaStreamTrack | null, fallback: string): StudioCaptureDevice | null => track ? { id: track.getSettings().deviceId || track.id, name: track.label || fallback } : null;
const errorMessage = (error: unknown) => {
  const value = error as Error;
  if (value.name === 'NotAllowedError' || value.name === 'SecurityError') return 'Autorize a câmera, o microfone ou a tela no navegador. Você pode tentar novamente sem perder as entradas já prontas.';
  if (value.name === 'NotReadableError') return 'A entrada não pôde ser aberta. Confira a conexão e se outro aplicativo está usando o dispositivo.';
  if (value.name === 'NotFoundError' || value.name === 'OverconstrainedError') return 'A entrada escolhida não está disponível. Confira a conexão e escolha outra câmera ou microfone.';
  return value.message || 'Não foi possível preparar as cenas.';
};
type Buffer = ReturnType<typeof createStudioSceneRecordingBuffer>;
type Finalization = { buffer: Buffer; expected: number; mime: string; name: string };
export type StudioSceneCaptureController = StudioCaptureController & {
  /** Choose one narration source before REC without replacing Program or the screen audio graph. */
  setExternalNarration(source: 'iphone' | 'browser', microphoneId?: string): Promise<void>;
};
/** One Program video track and one AudioContext destination live for the entire take. Scene changes never replace them. */
export function createStudioSceneCapture({ aspectRatio = '16:9', facing = 'user', cameraId, deviceId, externalCamera, externalNarration = 'browser' }: {
  aspectRatio?: '16:9' | '9:16'; facing?: 'user' | 'environment'; cameraId?: string; deviceId?: string;
  externalCamera?: { track: MediaStreamTrack; name: string };
  externalNarration?: 'iphone' | 'browser';
}): StudioSceneCaptureController {
  let width = aspectRatio === '9:16' ? 1080 : 1920, height = aspectRatio === '9:16' ? 1920 : 1080, frameRate = 30;
  let config = normalizeStudioSceneConfiguration(studioDefaultSceneConfiguration(), {}, width, height), grade: StudioGrade = studioGrade(), zoom = 1;
  let state: StudioCaptureState = { phase: 'idle', stream: null, file: null, elapsed: 0, error: null, input: null, camera: null, devices: { cameras: [], microphones: [] }, microphoneEnabled: true, levels: [],
    scenes: { ...config, selected: 'camera', cameraReady: false, screenReady: false, screenName: null, preparingScreen: false, backgroundSupported: getStudioSceneCapabilities().available, error: null } };
  const media = navigator.mediaDevices, listeners = new Set<(value: StudioCaptureState) => void>(), tracks = new Set<MediaStreamTrack>();
  let generation = 0, enumeration = 0, closed = false, authorized = false, camera: MediaStreamTrack | null = null, microphone: MediaStreamTrack | null = null, display: MediaStream | null = null;
  let composition: StudioSceneComposition | null = null, context: AudioContext | null = null, destination: MediaStreamAudioDestinationNode | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null, analyser: AnalyserNode | null = null, screenSource: MediaStreamAudioSourceNode | null = null, screenGain: GainNode | null = null;
  let meterTimer: ReturnType<typeof setInterval> | null = null, recorder: MediaRecorder | null = null, buffer: Buffer | null = null, candidate: File | null = null;
  let stopWork: Promise<File> | null = null, recordingResult: Promise<File> | null = null, stopReject: ((reason: unknown) => void) | null = null, started = 0, notice: string | null = null;
  let pendingFinalization: Finalization | null = null;
  const pendingCompositions = new Set<StudioSceneComposition>();
  const outputVideo = (selected = state.scenes!.selected): NonNullable<StudioCaptureState['outputVideo']> => {
    const source = selected === 'camera' ? camera : display?.getVideoTracks()[0], settings = source?.getSettings();
    const sourceWidth = settings?.width, sourceHeight = settings?.height, cameraSettings = camera?.getSettings();
    const cameraZoom = state.videoControls?.zoom.mode === 'hardware' ? 1 : zoom;
    const sourceScale = sourceWidth && sourceHeight ? (selected === 'camera' ? Math.max(width / sourceWidth, height / sourceHeight) * cameraZoom : Math.min(width / sourceWidth, height / sourceHeight)) : 1;
    const bubbleScale = selected === 'screen-camera' && cameraSettings?.width && cameraSettings.height ? Math.min(width, height) * config.size / Math.min(cameraSettings.width, cameraSettings.height) * cameraZoom : 1;
    return { resolutions: studioSceneOutputResolutions(aspectRatio), frameRates: [24, 30, 60], sourceWidth, sourceHeight, sourceFrameRate: settings?.frameRate, scaled: sourceScale > 1.001 || bubbleScale > 1.001 };
  };
  const snapshot = (): StudioCaptureState => ({ ...state, scenes: state.scenes ? { ...state.scenes, position: { ...state.scenes.position } } : undefined,
    outputVideo: state.outputVideo ? { ...state.outputVideo, resolutions: state.outputVideo.resolutions.map(value => ({ ...value })), frameRates: [...state.outputVideo.frameRates] } : undefined,
    videoControls: state.videoControls ? { ...state.videoControls, grade: { ...state.videoControls.grade }, zoom: { ...state.videoControls.zoom }, resolutions: state.videoControls.resolutions.map(value => ({ ...value })), frameRates: [...state.videoControls.frameRates], hardware: state.videoControls.hardware ? cloneStudioCameraHardware(state.videoControls.hardware) : undefined } : null,
    devices: { cameras: state.devices.cameras.map(value => ({ ...value })), microphones: state.devices.microphones.map(value => ({ ...value })) }, levels: state.levels.map(value => ({ ...value })) });
  const publish = (patch: Partial<StudioCaptureState>) => { if (closed) return; state = { ...state, ...patch }; listeners.forEach(listener => listener(snapshot())); };
  const scenes = (patch: Partial<NonNullable<StudioCaptureState['scenes']>>) => publish({ scenes: { ...state.scenes!, ...patch }, outputVideo: outputVideo(patch.selected ?? state.scenes!.selected) });
  const assert = (expected: number) => { if (closed || generation !== expected) throw abort(); };
  const own = (stream: MediaStream, expected: number) => { if (closed || expected !== generation) { stream.getTracks().forEach(track => track.stop()); throw abort(); } stream.getTracks().forEach(track => tracks.add(track)); return stream; };
  const release = (track: MediaStreamTrack | null) => { if (!track || !tracks.delete(track)) return; track.onended = null; track.onmute = null; track.onunmute = null; track.stop(); };
  const cleanup = () => {
    if (meterTimer) clearInterval(meterTimer); meterTimer = null; composition?.dispose(); composition = null;
    pendingCompositions.forEach(value => value.dispose()); pendingCompositions.clear();
    [...tracks].forEach(release); camera = null; microphone = null; display = null;
    micSource?.disconnect(); screenSource?.disconnect(); screenGain?.disconnect(); micSource = null; screenSource = null; screenGain = null; analyser = null; destination = null;
    if (context) { context.onstatechange = null; void context.close().catch(() => undefined); } context = null;
    publish({ stream: null, cameraPreviewStream: null, input: null, camera: null, levels: [], videoControls: null, outputVideo: undefined, scenes: { ...state.scenes!, cameraReady: false, screenReady: false, screenName: null, preparingScreen: false } });
  };
  const disposeBuffer = () => { const previous = buffer; buffer = null; if (previous) void previous.dispose().catch(() => undefined); };
  const controls = () => camera ? studioCaptureVideoControls(camera, composition ? { effects: composition.effects } as StudioCaptureVideoProcessor : null, grade, zoom) : null;
  const syncAudioScene = () => {
    if (!context || !screenGain) return;
    const target = state.scenes!.selected === 'camera' ? 0 : 1;
    screenGain.gain.cancelScheduledValues(context.currentTime); screenGain.gain.setTargetAtTime(target, context.currentTime, .015);
  };
  const updateComposition = async () => { const owned = composition, expected = generation; if (!owned) return; await owned.configure(state.scenes!.selected, config, grade, state.videoControls?.zoom.mode === 'hardware' ? 1 : zoom); assert(expected); if (owned !== composition) throw abort(); };
  const fail = (error: Error, expected: number) => {
    if (closed || expected !== generation || !['preparing', 'ready', 'recording'].includes(state.phase)) return;
    notice = errorMessage(error); scenes({ error: notice }); publish({ error: notice });
    if (state.phase === 'recording') void controller.stop().catch(() => undefined);
    else { generation++; cleanup(); publish({ phase: 'error', error: notice }); }
  };
  const sourceLost = (source: 'camera' | 'screen', expected: number) => {
    if (closed || expected !== generation || !['ready', 'recording', 'preparing'].includes(state.phase)) return;
    composition?.removeSource(source);
    const previous = state.scenes!.selected;
    if (source === 'camera') {
      publish({ cameraPreviewStream: null });
      scenes({ cameraReady: false, error: 'A câmera foi desconectada. A tela e o microfone continuam disponíveis.' });
      if (camera?.readyState === 'ended') { release(camera); camera = null; publish({ camera: null, videoControls: null }); }
      if (previous !== 'screen' && state.scenes!.screenReady) scenes({ selected: 'screen' });
    } else {
      screenSource?.disconnect(); screenSource = null; screenGain?.disconnect(); screenGain = null;
      const old = display; display = null; old?.getTracks().forEach(release);
      scenes({ screenReady: false, screenName: null, error: 'O compartilhamento terminou. A câmera e o microfone continuam disponíveis.' });
      if (previous !== 'camera' && state.scenes!.cameraReady) scenes({ selected: 'camera' });
    }
    if (!state.scenes!.cameraReady && !state.scenes!.screenReady) { fail(new Error('As fontes de vídeo foram interrompidas. O trecho capturado será preservado.'), expected); return; }
    syncAudioScene(); void updateComposition().catch(error => { if ((error as Error).name !== 'AbortError') fail(error as Error, expected); });
  };
  const wireCamera = (track: MediaStreamTrack, expected: number) => {
    track.onended = () => { if (camera === track) sourceLost('camera', expected); };
    track.onmute = () => { if (camera === track && ['ready', 'recording'].includes(state.phase)) sourceLost('camera', expected); };
    track.onunmute = () => {
      const owned = composition; if (camera !== track || !owned || track.readyState !== 'live' || closed || generation !== expected) return;
      void owned.setSource('camera', track).then(() => { assert(expected); if (camera === track && composition === owned) { publish({ cameraPreviewStream: new MediaStream([track]) }); scenes({ cameraReady: true, error: null }); } }).catch(error => { if (!closed && generation === expected && camera === track && composition === owned && (error as Error).name !== 'AbortError') scenes({ error: errorMessage(error) }); });
    };
  };
  const wireMic = (track: MediaStreamTrack, expected: number) => { track.onended = () => { if (microphone === track) fail(new Error('O microfone foi desconectado. O trecho capturado será preservado.'), expected); }; };
  const meter = () => {
    if (microphone && analyser) {
      const values = new Float32Array(analyser.fftSize); if (state.microphoneEnabled && !microphone.muted && microphone.readyState === 'live') analyser.getFloatTimeDomainData(values);
      let sum = 0, peak = 0; for (const value of values) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
      const db = (value: number) => Math.max(-120, 20 * Math.log10(Math.max(value, 1e-6)));
      publish({ levels: [{ averageDb: db(Math.sqrt(sum / Math.max(1, values.length))), peakDb: db(peak) }] });
    }
    if (recorder?.state === 'recording') publish({ elapsed: (performance.now() - started) / 1000 });
  };
  const refreshDevices = async () => {
    if (!authorized || closed || !media?.enumerateDevices) return; const expected = generation, request = ++enumeration;
    try { const list = await media.enumerateDevices(); if (closed || expected !== generation || request !== enumeration) return;
      const inputs = (kind: MediaDeviceKind) => list.filter(value => value.kind === kind && value.deviceId).map(value => ({ id: value.deviceId, name: value.label || (kind === 'videoinput' ? 'Câmera autorizada' : externalNarration === 'iphone' ? 'Microfone do computador' : 'Microfone autorizado') }));
      publish({ devices: { cameras: inputs('videoinput'), microphones: inputs('audioinput') } });
    } catch { /* The live physical tracks are authoritative. */ }
  };
  const assertInputsEditable = () => {
    if (closed) throw abort(); if (candidate || state.file || state.pendingRecovery || pendingFinalization) throw new Error('Salve ou descarte o take pendente antes de trocar a entrada.');
    if (['recording', 'stopping', 'preparing'].includes(state.phase) || state.scenes!.preparingScreen) throw new Error('Prepare as entradas antes de iniciar a gravação.');
  };
  const assertSceneEditable = () => { if (closed) throw abort(); if (!['ready', 'recording'].includes(state.phase) || state.scenes!.preparingScreen) throw new Error('Prepare a câmera e a tela antes de escolher a cena.'); };
  const newComposition = (profile: StudioSceneOutputProfile, expected: number) => {
    let failure: Error | null = null;
    const engine = createStudioSceneComposition({ ...profile, fps: profile.frameRate,
      onError: error => { failure = error; if (composition === engine) fail(error, expected); },
      onSourceLost: source => { if (composition === engine) sourceLost(source, expected); else failure = new Error('A fonte deixou de entregar imagem durante a mudança de resolução.'); },
    });
    return { engine, assertReady() { assert(expected); if (failure) throw failure; } };
  };
  const videoConstraints = (id = cameraId): MediaTrackConstraints => ({ ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: facing } }), width: { ideal: Math.max(width, height) }, height: { ideal: Math.min(width, height) }, frameRate: { ideal: frameRate } });
  const audioConstraints = (id = deviceId): MediaTrackConstraints => ({ ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: true });
  const validateCandidate = async (file: File, expected: number) => { const metadata = await inspectStudioMedia(file); assert(expected); if (metadata.duration < .1 || !metadata.hasAudio || metadata.kind !== 'video') throw new Error('Não foi encontrado um trecho válido de vídeo e áudio. Grave por mais tempo e tente novamente.'); publish({ phase: 'recorded', file, pendingRecovery: false, elapsed: metadata.duration, error: notice }); return file; };
  const finalizeBuffer = async (entry: Finalization) => {
    assert(entry.expected); const file = await entry.buffer.file(entry.name, entry.mime); assert(entry.expected);
    candidate = file; pendingFinalization = null;
    return validateCandidate(file, entry.expected);
  };
  const finalizationFailed = (entry: Finalization, error: unknown) => {
    if (closed || entry.expected !== generation) return;
    cleanup(); recorder = null; stopReject = null; stopWork = null; recordingResult = null;
    const pendingRecovery = !candidate && buffer === entry.buffer && entry.buffer.bytes > 0;
    pendingFinalization = pendingRecovery ? entry : null;
    publish({ phase: 'error', file: candidate, pendingRecovery, error: errorMessage(error) });
  };
  const controller: StudioSceneCaptureController = {
    async prepare() {
      assertInputsEditable(); const support = getStudioSceneCapabilities(); if (!support.available) { publish({ phase: 'error', error: support.reason! }); throw new Error(support.reason); }
      if (!media?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este navegador não oferece gravação local. Use Chrome ou Edge atualizado em HTTPS.');
      const expected = ++generation; cleanup(); disposeBuffer(); pendingFinalization = null; stopWork = null; notice = null; publish({ phase: 'preparing', error: null, file: null, pendingRecovery: false, elapsed: 0 });
      try {
        // Confirm the worker, transferable streams, GPU/2D surface and local disk before requesting physical inputs.
        composition = newComposition({ width, height, frameRate }, expected).engine; own(new MediaStream([composition.track]), expected);
        await composition.ready(); assert(expected); buffer = createStudioSceneRecordingBuffer(); await buffer.prepare(); assert(expected);
        if (externalNarration === 'iphone' && !externalCamera) throw new Error('Conecte a câmera do iPhone para usar o áudio do aparelho.');
        const incoming = externalNarration === 'iphone' ? null : await media.getUserMedia({ video: externalCamera ? false : videoConstraints(), audio: audioConstraints() });
        // Own only a clone of the transport track; stopping this engine cannot stop the phone preview.
        const source = own(externalCamera ? new MediaStream([externalCamera.track.clone(), ...(incoming?.getAudioTracks() ?? [])]) : incoming!, expected);
        camera = source.getVideoTracks()[0] ?? null; microphone = source.getAudioTracks()[0] ?? null;
        if (!camera || externalNarration !== 'iphone' && !microphone) throw new Error('Autorize câmera e microfone para preparar as cenas.'); if (microphone) microphone.enabled = state.microphoneEnabled;
        context = new AudioContext(); await resumeStudioCaptureAudio(context, () => assert(expected)); assert(expected); destination = context.createMediaStreamDestination(); own(destination.stream, expected);
        analyser = context.createAnalyser(); analyser.fftSize = 2048; if (microphone) { micSource = context.createMediaStreamSource(new MediaStream([microphone])); micSource.connect(destination); micSource.connect(analyser); }
        await composition.setSource('camera', camera); assert(expected);
        scenes({ ...config, selected: 'camera', cameraReady: true, screenReady: false, preparingScreen: false, backgroundSupported: true, error: null });
        publish({ videoControls: controls() }); await updateComposition(); assert(expected);
        wireCamera(camera, expected); if (microphone) wireMic(microphone, expected);
        publish({ phase: 'ready', stream: new MediaStream([composition.track, ...destination.stream.getAudioTracks()]), cameraPreviewStream: new MediaStream([camera]), camera: identity(camera, 'Câmera autorizada'), input: identity(microphone, 'Microfone autorizado'), width, height, frameRate, videoControls: controls(), outputVideo: outputVideo(), error: null });
        meterTimer = setInterval(meter, 100); authorized = true; void refreshDevices();
        const owned = context; owned.onstatechange = () => { if (context !== owned || generation !== expected || closed || state.phase !== 'recording' || owned.state === 'running') return; void owned.resume().catch(error => fail(new Error(`O áudio das cenas foi interrompido. ${errorMessage(error)}`), expected)); };
      } catch (error) { if (!closed && expected === generation) { cleanup(); disposeBuffer(); publish({ phase: 'error', error: errorMessage(error) }); } throw error; }
    },
    async prepareScreen() {
      assertInputsEditable(); if (state.phase !== 'ready' || !composition || !context) throw new Error('Abra a câmera antes de preparar o compartilhamento.');
      if (!media.getDisplayMedia) throw new Error('Este navegador não oferece compartilhamento de tela.');
      const expected = generation, owned = composition; scenes({ preparingScreen: true, error: null }); let incoming: MediaStream | null = null;
      try {
        incoming = own(await media.getDisplayMedia({ video: { width: { ideal: Math.max(width, height) }, height: { ideal: Math.min(width, height) }, frameRate: { ideal: frameRate, max: 60 } }, audio: true }), expected);
        const video = incoming.getVideoTracks()[0]; if (!video) throw new Error('Escolha uma tela, janela ou aba com imagem.'); await owned.setSource('screen', video); assert(expected); if (composition !== owned) throw abort();
        const previous = display; screenSource?.disconnect(); screenGain?.disconnect(); screenSource = null; screenGain = null; display = incoming;
        if (incoming.getAudioTracks().length) { screenSource = context!.createMediaStreamSource(new MediaStream(incoming.getAudioTracks())); screenGain = context!.createGain(); screenGain.gain.value = state.scenes!.selected === 'camera' ? 0 : 1; screenSource.connect(screenGain); screenGain.connect(destination!); }
        previous?.getTracks().forEach(release);
        video.onended = () => { if (display === incoming) sourceLost('screen', expected); };
        video.onmute = () => { if (display === incoming) sourceLost('screen', expected); };
        scenes({ preparingScreen: false, screenReady: true, screenName: video.label || 'Tela compartilhada', error: null });
      } catch (error) { incoming?.getTracks().forEach(release); if (!closed && expected === generation) scenes({ preparingScreen: false, error: errorMessage(error) }); throw error; }
    },
    selectScene(selected) {
      assertSceneEditable(); if (!['camera', 'screen', 'screen-camera'].includes(selected)) throw new Error('Escolha uma cena disponível.');
      if (selected !== 'screen' && !state.scenes!.cameraReady || selected !== 'camera' && !state.scenes!.screenReady) throw new Error('Prepare as fontes desta cena antes de selecioná-la.');
      scenes({ selected }); syncAudioScene(); const expected = generation; void updateComposition().catch(error => { if ((error as Error).name !== 'AbortError') fail(error as Error, expected); });
    },
    configureScene(patch) { assertSceneEditable(); config = normalizeStudioSceneConfiguration(config, patch, width, height); scenes(config); const expected = generation; void updateComposition().catch(error => { if ((error as Error).name !== 'AbortError') fail(error as Error, expected); }); },
    async selectDevices(selection) {
      if (externalCamera && selection.cameraId !== undefined) throw new Error('Escolha a câmera do iPhone nos controles da conexão.');
      if (externalNarration === 'iphone' && selection.microphoneId !== undefined) throw new Error('Escolha o microfone do iPhone pela conexão remota.');
      assertInputsEditable(); const nextCamera = selection.cameraId !== undefined ? selection.cameraId || undefined : cameraId, nextMic = selection.microphoneId !== undefined ? selection.microphoneId || undefined : deviceId;
      if (state.phase !== 'ready' || !composition || !context) { cameraId = nextCamera; deviceId = nextMic; return; }
      const changeCamera = selection.cameraId !== undefined, changeMic = selection.microphoneId !== undefined, expected = generation, owned = composition;
      const oldCamera = camera, oldMic = microphone; publish({ phase: 'preparing', error: null }); let incoming: MediaStream | null = null;
      try {
        incoming = own(await media.getUserMedia({ video: changeCamera ? videoConstraints(nextCamera) : false, audio: changeMic ? audioConstraints(nextMic) : false }), expected);
        const cam = changeCamera ? incoming.getVideoTracks()[0] : camera, mic = changeMic ? incoming.getAudioTracks()[0] : microphone;
        if (!cam || !mic) throw new Error('O dispositivo escolhido não forneceu a entrada necessária.'); if (changeCamera) await owned.setSource('camera', cam); assert(expected);
        if (changeMic) { mic.enabled = state.microphoneEnabled; const nextSource = context!.createMediaStreamSource(new MediaStream([mic])); nextSource.connect(destination!); nextSource.connect(analyser!); micSource?.disconnect(); micSource = nextSource; microphone = mic; release(oldMic); wireMic(mic, expected); }
        if (changeCamera) { camera = cam; zoom = 1; release(oldCamera); wireCamera(cam, expected); publish({ cameraPreviewStream: new MediaStream([cam]) }); scenes({ cameraReady: true, error: null }); }
        cameraId = nextCamera; deviceId = nextMic; publish({ phase: 'ready', camera: identity(camera, 'Câmera autorizada'), input: identity(microphone, 'Microfone autorizado'), videoControls: controls(), outputVideo: outputVideo() }); await updateComposition(); assert(expected); void refreshDevices();
      } catch (error) { incoming?.getTracks().forEach(track => { if (track !== camera && track !== microphone) release(track); }); if (!closed && expected === generation) publish({ phase: 'ready', error: errorMessage(error) }); throw error; }
    },
    async setExternalNarration(source, microphoneId) {
      assertInputsEditable(); if (!externalCamera || state.phase !== 'ready' || !context || !destination || !analyser) throw new Error('Prepare o iPhone e as cenas antes de escolher a narração.');
      if (source === externalNarration && source === 'iphone') return;
      if (source === 'browser' && externalNarration === 'browser') { if (microphoneId !== undefined) await controller.selectDevices({ microphoneId }); return; }
      const expected = generation, previous = microphone; let incoming: MediaStream | null = null, nextSource: MediaStreamAudioSourceNode | null = null;
      publish({ phase: 'preparing', error: null });
      try {
        if (source === 'browser') {
          incoming = own(await media.getUserMedia({ video: false, audio: audioConstraints(microphoneId || undefined) }), expected);
          const next = incoming.getAudioTracks()[0]; if (!next || next.readyState !== 'live') throw new Error('O microfone do computador não está disponível.');
          next.enabled = state.microphoneEnabled; nextSource = context!.createMediaStreamSource(new MediaStream([next])); nextSource.connect(destination!); nextSource.connect(analyser!); assert(expected);
          micSource?.disconnect(); micSource = nextSource; nextSource = null; microphone = next; deviceId = microphoneId || undefined; wireMic(next, expected);
        } else { micSource?.disconnect(); micSource = null; microphone = null; }
        release(previous); externalNarration = source; publish({ phase: 'ready', input: identity(microphone, 'Microfone autorizado'), levels: [], error: null }); meter(); void refreshDevices();
      } catch (error) {
        nextSource?.disconnect(); incoming?.getTracks().forEach(track => { if (track !== microphone) release(track); });
        if (!closed && expected === generation) publish({ phase: 'ready', error: errorMessage(error) }); throw error;
      }
    },
    async configureVideo(patch: StudioCaptureVideoPatch) {
      assertInputsEditable(); if (state.phase !== 'ready' || !composition) throw new Error('Prepare as cenas antes de ajustar a gravação.');
      patch = { ...patch, ...patch.output };
      if (!camera && (patch.hardware || patch.zoom !== undefined || patch.grade)) throw new Error('Prepare a câmera antes de ajustar a imagem.');
      if (patch.hardware) {
        if (externalCamera) throw new Error('Ajuste a câmera do iPhone pelos controles remotos.');
        if (Object.keys(patch).some(key => key !== 'hardware')) throw new Error('Ajuste os controles da câmera separadamente do formato da gravação.');
        const expected = generation, owned = camera!, current = controls()!;
        publish({ phase: 'preparing', videoControls: { ...current, busy: true }, error: null });
        try { await applyStudioCameraHardware(owned, patch.hardware, () => { assert(expected); if (camera !== owned || owned.readyState !== 'live') throw abort(); }); assert(expected); publish({ phase: 'ready', videoControls: controls(), outputVideo: outputVideo(), error: null }); }
        catch (error) { if (!closed && expected === generation) { if (error instanceof StudioCameraHardwareRestoreError) fail(error, expected); else publish({ phase: 'ready', videoControls: controls(), outputVideo: outputVideo(), error: errorMessage(error) }); } throw error; }
        return;
      }
      const current = controls() ?? { busy: false, processed: true, effects: composition.effects, grade, zoom: { mode: 'none' as const, value: 1, min: 1, max: 1, step: 1 }, resolutions: [], frameRates: [] }, nextGrade = studioCaptureGrade(grade, patch.grade), nextZoom = patch.zoom ?? current.zoom.value;
      if (!Number.isFinite(nextZoom) || nextZoom < current.zoom.min || nextZoom > current.zoom.max) throw new Error('O zoom está fora dos limites da câmera.');
      if (!composition.effects && !studioCaptureIdentityGrade(nextGrade)) throw new Error('O navegador não oferece processamento de cor nas cenas.');
      const expected = generation, owned = camera, hardware = current.zoom.mode === 'hardware' && patch.zoom !== undefined, resize = patch.width !== undefined || patch.height !== undefined || patch.frameRate !== undefined;
      const profile = studioSceneOutputProfile(aspectRatio, { width, height, frameRate }, { ...(patch.width !== undefined ? { width: patch.width } : {}), ...(patch.height !== undefined ? { height: patch.height } : {}), ...(patch.frameRate !== undefined ? { frameRate: patch.frameRate } : {}) });
      const previousEngine = composition, previous = owned?.getConstraints?.() ?? {}, previousGrade = grade, previousZoom = zoom;
      const screenInput = display?.getVideoTracks()[0], previousScreen = screenInput?.getConstraints?.() ?? {};
      const nextConfig = normalizeStudioSceneConfiguration(config, {}, profile.width, profile.height);
      publish({ phase: 'preparing', videoControls: { ...current, busy: true }, error: null }); let applied = false, screenApplied = false, replacement: StudioSceneComposition | null = null;
      try {
        if (resize) {
          // Ask authorized sources for detail, but Program output never depends on a camera supporting this profile.
          if (!externalCamera && owned?.readyState === 'live' && !owned.muted) {
            const target = studioCaptureSourceDimensions(owned.getSettings(), profile.width, profile.height);
            try { await owned.applyConstraints({ ...previous, width: { ideal: target.width }, height: { ideal: target.height }, frameRate: { ideal: profile.frameRate } }); applied = true; }
            catch { /* Retain the real input and disclose enlargement in outputVideo. */ }
          }
          assert(expected);
          if (screenInput?.readyState === 'live' && !screenInput.muted) {
            try { await screenInput.applyConstraints({ ...previousScreen, width: { ideal: Math.max(profile.width, profile.height) }, height: { ideal: Math.min(profile.width, profile.height) }, frameRate: { ideal: profile.frameRate, max: 60 } }); screenApplied = true; }
            catch { /* Window/display size stays authoritative when the browser cannot deliver this preference. */ }
            assert(expected);
          }
        }
        if (hardware && owned) { await owned.applyConstraints({ ...(owned.getConstraints?.() ?? previous), advanced: [{ zoom: nextZoom } as MediaTrackConstraintSet & { zoom: number }] }); applied = true; assert(expected);
          const settings = owned.getSettings() as MediaTrackSettings & { zoom?: number };
          if (!Number.isFinite(settings.zoom) || Math.abs(settings.zoom! - nextZoom) > Math.max(.02, current.zoom.step)) throw new Error('A câmera não confirmou este zoom.');
        }
        if (resize) {
          const attempt = newComposition(profile, expected); replacement = attempt.engine; pendingCompositions.add(replacement); own(new MediaStream([replacement.track]), expected);
          await replacement.ready(); attempt.assertReady();
          if (!replacement.effects && !studioCaptureIdentityGrade(nextGrade)) throw new Error('Este perfil não oferece processamento de cor. O formato anterior foi mantido.');
          if (state.scenes!.cameraReady && owned?.readyState === 'live' && !owned.muted) { await replacement.setSource('camera', owned); attempt.assertReady(); }
          const screen = display?.getVideoTracks()[0];
          if (state.scenes!.screenReady && screen?.readyState === 'live' && !screen.muted) { await replacement.setSource('screen', screen); attempt.assertReady(); }
          await replacement.configure(state.scenes!.selected, nextConfig, nextGrade, current.zoom.mode === 'hardware' ? 1 : nextZoom); attempt.assertReady();
          if (composition !== previousEngine) throw abort();
          // Swap only after the new worker wrote a frame for the selected scene. The audio graph and physical tracks remain owned by this session.
          composition = replacement; pendingCompositions.delete(replacement); replacement = null;
          width = profile.width; height = profile.height; frameRate = profile.frameRate; config = nextConfig;
          tracks.delete(previousEngine.track); previousEngine.dispose();
          publish({ stream: new MediaStream([composition.track, ...destination!.stream.getAudioTracks()]), width, height, frameRate }); scenes(config);
        } else {
          await previousEngine.configure(state.scenes!.selected, config, nextGrade, current.zoom.mode === 'hardware' ? 1 : nextZoom); assert(expected);
        }
        grade = nextGrade; zoom = current.zoom.mode === 'digital' ? nextZoom : 1; publish({ phase: 'ready', videoControls: controls(), outputVideo: outputVideo(), error: null });
      } catch (error) {
        if (!closed && expected === generation) {
          grade = previousGrade; zoom = previousZoom;
          if (applied && owned?.readyState === 'live') { try { await owned.applyConstraints(previous); assert(expected); } catch (restoreError) { fail(new Error(`A câmera não recuperou o perfil anterior. ${errorMessage(restoreError)}`), expected); throw error; } }
          if (screenApplied && screenInput?.readyState === 'live') { try { await screenInput.applyConstraints(previousScreen); assert(expected); } catch (restoreError) { fail(new Error(`A tela não recuperou o perfil anterior. ${errorMessage(restoreError)}`), expected); throw error; } }
          publish({ phase: 'ready', videoControls: controls(), outputVideo: outputVideo(), error: errorMessage(error) });
        }
        throw error;
      } finally { if (replacement) { pendingCompositions.delete(replacement); tracks.delete(replacement.track); replacement.dispose(); } }
    },
    getMicrophoneTrack() { return !closed && microphone?.readyState === 'live' ? microphone : null; },
    getScreenOriginalStream() {
      const track = display?.getVideoTracks()[0];
      return !closed && track?.readyState === 'live' && destination ? new MediaStream([track, ...destination.stream.getAudioTracks()]) : null;
    },
    setMicrophoneEnabled(enabled) { if (closed) throw abort(); if (state.phase === 'stopping' || candidate || state.pendingRecovery) throw new Error('Conclua o take antes de alterar o microfone.'); if (microphone) microphone.enabled = enabled; publish({ microphoneEnabled: enabled }); meter(); },
    async flip() { const previous = facing; facing = facing === 'user' ? 'environment' : 'user'; try { await controller.selectDevices({ cameraId: '' }); } catch (error) { facing = previous; throw error; } },
    start() {
      if (closed || state.phase !== 'ready' || !state.stream || !buffer || state.pendingRecovery || pendingFinalization || state.scenes!.preparingScreen) throw new Error('Prepare a cena antes de iniciar a gravação.');
      if (document.visibilityState === 'hidden') throw new Error('Volte à aba do Studio para iniciar a gravação.');
      if (externalNarration !== 'iphone' && (!microphone || microphone.readyState !== 'live')) throw new Error('O microfone foi desconectado.');
      const selected = state.scenes!.selected; if (selected !== 'screen' && !state.scenes!.cameraReady || selected !== 'camera' && !state.scenes!.screenReady) throw new Error('Uma fonte desta cena não está disponível.');
      // Let the browser negotiate H.264 profile/level; pinning level 3.0 excludes legitimate 4K encoders.
      const mimeType = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type)); if (!mimeType) throw new Error('O navegador não oferece um formato de vídeo compatível.');
      const expected = generation, ownedBuffer = buffer; stopWork = null; candidate = null; notice = null;
      const owned = new MediaRecorder(state.stream, { mimeType, videoBitsPerSecond: studioSceneVideoBitrate({ width, height, frameRate }), audioBitsPerSecond: 192000 }); recorder = owned;
      let resolveResult!: (file: File) => void, rejectResult!: (reason: unknown) => void, finalizing = false;
      const result = new Promise<File>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; }); recordingResult = result; stopReject = rejectResult; void result.catch(() => undefined);
      owned.ondataavailable = event => { if (closed || expected !== generation || recorder !== owned || !event.data.size) return; void ownedBuffer.append(event.data).catch(error => { if (closed || expected !== generation) return; notice = `O armazenamento da gravação foi interrompido. Preservaremos o trecho disponível. ${errorMessage(error)}`; if (state.phase === 'recording') void controller.stop().catch(() => undefined); }); };
      owned.onerror = () => { if (closed || expected !== generation || recorder !== owned) return; notice = 'O gravador foi interrompido. Preservaremos o trecho disponível.'; void controller.stop().catch(() => undefined); };
      // Install before start: encoder failure and source exhaustion deliver inactive -> error -> final data -> stop.
      owned.onstop = () => {
        if (finalizing || closed || expected !== generation || recorder !== owned) return; finalizing = true; stopWork = result; publish({ phase: 'stopping' });
        const mime = owned.mimeType || mimeType, extension = mime.includes('mp4') ? 'mp4' : 'webm';
        const entry: Finalization = { buffer: ownedBuffer, expected, mime, name: `Classfy-cenas-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}` };
        pendingFinalization = entry;
        void (async () => {
          try { assert(expected); cleanup(); const validated = await finalizeBuffer(entry); recorder = null; stopReject = null; resolveResult(validated); }
          catch (error) { finalizationFailed(entry, error); rejectResult(error); }
        })();
      };
      try { owned.start(1000); } catch (error) { owned.ondataavailable = null; owned.onerror = null; owned.onstop = null; recorder = null; recordingResult = null; stopReject = null; rejectResult(error); throw error; }
      started = performance.now(); publish({ phase: 'recording', elapsed: 0, error: null });
    },
    stop() {
      if (stopWork) return stopWork;
      if (state.pendingRecovery && pendingFinalization && state.phase === 'error') {
        const entry = pendingFinalization; publish({ phase: 'stopping', error: null });
        let resolve!: (file: File) => void, reject!: (reason: unknown) => void;
        const attempt = new Promise<File>((yes, no) => { resolve = yes; reject = no; }); stopWork = attempt; stopReject = reject; void attempt.catch(() => undefined);
        void finalizeBuffer(entry).then(file => { if (stopWork === attempt) stopReject = null; resolve(file); }, error => { finalizationFailed(entry, error); reject(error); });
        return attempt;
      }
      if (candidate && state.phase === 'error') { const expected = generation, file = candidate; publish({ phase: 'stopping', error: null }); const attempt = validateCandidate(file, expected).catch(error => { if (!closed && expected === generation) publish({ phase: 'error', file, error: errorMessage(error) }); throw error; }); stopWork = attempt; void attempt.finally(() => { if (stopWork === attempt) stopWork = null; }).catch(() => undefined); return attempt; }
      if (!recorder || !recordingResult || !buffer) return Promise.reject(new Error('Não existe gravação ativa para concluir.'));
      const owned = recorder; stopWork = recordingResult; publish({ phase: 'stopping' });
      if (owned.state !== 'inactive') try { owned.stop(); } catch (error) { stopReject?.(error); stopReject = null; stopWork = null; publish({ phase: 'error', error: errorMessage(error) }); return Promise.reject(error); }
      return stopWork;
    },
    cancel() { generation++; enumeration++; stopReject?.(abort()); stopReject = null; if (recorder) { recorder.ondataavailable = null; recorder.onerror = null; recorder.onstop = null; if (recorder.state !== 'inactive') try { recorder.stop(); } catch { /* owned recorder already ended */ } } recorder = null; recordingResult = null; stopWork = null; candidate = null; pendingFinalization = null; cleanup(); disposeBuffer(); publish({ phase: 'idle', file: null, pendingRecovery: false, elapsed: 0, error: null }); scenes({ error: null }); },
    dispose() { if (closed) return; controller.cancel(); closed = true; listeners.clear(); media?.removeEventListener?.('devicechange', devicechange); document.removeEventListener('visibilitychange', visibility); },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
  };
  const devicechange = () => { void refreshDevices(); };
  // Visibility affects only the DOM preview, never this worker's Program frames or the recording state.
  const visibility = () => { if (!closed && context && ['ready', 'recording'].includes(state.phase) && context.state !== 'running') { const expected = generation; void context.resume().catch(error => fail(new Error(`O áudio das cenas foi interrompido. ${errorMessage(error)}`), expected)); } };
  media?.addEventListener?.('devicechange', devicechange); document.addEventListener('visibilitychange', visibility); return controller;
}

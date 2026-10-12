import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBIndex } from 'fake-indexeddb';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { createStudioCapture, type StudioCaptureState } from './capture';
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), compositions: [] as unknown[], readyError: null as Error | null }));
vi.mock('./media', () => ({ inspectStudioMedia: mocks.inspect }));
vi.mock('./sceneComposition', () => ({ createStudioSceneComposition: vi.fn((options: unknown) => {
  const track = new Track('video', 'program', 'Program'), composition = { options, track, effects: true, ready: vi.fn(async () => { if (mocks.readyError) throw mocks.readyError; }), setSource: vi.fn(async () => {}), removeSource: vi.fn(), configure: vi.fn(async () => {}), dispose: vi.fn(() => track.stop()) };
  mocks.compositions.push(composition); return composition;
}) }));
class Track {
  readyState = 'live'; muted = false; enabled = true; id: string; onended: (() => void) | null = null; onmute: (() => void) | null = null; onunmute: (() => void) | null = null;
  constructor(public kind: string, public deviceId: string, public label: string) { this.id = deviceId; }
  stop = vi.fn(() => { this.readyState = 'ended'; });
  getSettings() { return { deviceId: this.deviceId, width: 1920, height: 1080, frameRate: 30 }; }
  getCapabilities() { return { width: { min: 640, max: 1920 }, height: { min: 360, max: 1080 }, frameRate: { min: 24, max: 30 } }; }
  getConstraints() { return {}; } applyConstraints = vi.fn(async () => {});
}
class Stream { constructor(public tracks: Track[] = []) {} getTracks() { return this.tracks; } getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); } getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); } }
class Node { connect = vi.fn(); disconnect = vi.fn(); }
class Audio {
  static instances: Audio[] = []; state = 'running'; currentTime = 0; onstatechange: (() => void) | null = null; sources: { stream: Stream; node: Node }[] = []; gains: { gain: { value: number; cancelScheduledValues: ReturnType<typeof vi.fn>; setTargetAtTime: ReturnType<typeof vi.fn> } }[] = [];
  constructor() { Audio.instances.push(this); }
  resume = vi.fn(async () => {}); close = vi.fn(async () => {});
  createMediaStreamDestination() { return { stream: new Stream([new Track('audio', 'mixed', 'Program audio')]) }; }
  createMediaStreamSource(stream: Stream) { const node = new Node(); this.sources.push({ stream, node }); return node; }
  createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(values: Float32Array) { values.fill(.5); } }; }
  createGain() { const node = { ...new Node(), connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() } }; this.gains.push(node); return node; }
}
class Recorder {
  static instances: Recorder[] = []; static isTypeSupported() { return true; } state = 'inactive'; mimeType = 'video/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null; onerror: (() => void) | null = null; onstop: (() => void) | null = null;
  constructor(public stream: Stream) { Recorder.instances.push(this); } start() { this.state = 'recording'; }
  stop = vi.fn(() => { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['header+frames+audio'], { type: this.mimeType }) }); this.onstop?.(); }); });
}
const events = new EventTarget(), media = { getUserMedia: vi.fn(), getDisplayMedia: vi.fn(), enumerateDevices: vi.fn(async () => []), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
const pending = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; };
const watch = (aspectRatio: '16:9' | '9:16' = '16:9') => { const capture = createStudioCapture({ mode: 'scenes', aspectRatio }); let state!: StudioCaptureState; capture.subscribe(value => { state = value; }); return { capture, state: () => state }; };
const sources = () => ({ camera: new Track('video', 'continuity', 'iPhone conectado'), mic: new Track('audio', 'usb', 'Microfone USB'), screen: new Track('video', 'display', 'Janela da aula'), system: new Track('audio', 'system', 'Áudio compartilhado') });
const composition = () => mocks.compositions.at(-1) as { configure: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; removeSource: ReturnType<typeof vi.fn>; setSource: ReturnType<typeof vi.fn>; options: { onError(error: Error): void; onSourceLost(source: 'camera' | 'screen'): void } };
const visibility = (value: string) => { Object.defineProperty(document, 'visibilityState', { configurable: true, value }); document.dispatchEvent(new Event('visibilitychange')); };
beforeEach(() => {
  mocks.compositions.length = 0; mocks.readyError = null; Audio.instances = []; Recorder.instances = []; media.getUserMedia.mockReset(); media.getDisplayMedia.mockReset(); mocks.inspect.mockReset().mockResolvedValue({ kind: 'video', duration: 3, hasAudio: true });
  vi.stubGlobal('MediaRecorder', Recorder); vi.stubGlobal('MediaStream', Stream); vi.stubGlobal('AudioContext', Audio); vi.stubGlobal('indexedDB', new IDBFactory());
  // fake-indexeddb uses the host structuredClone; Node's native Blob preserves real bytes across that boundary.
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('MediaStreamTrackProcessor', function () {}); vi.stubGlobal('MediaStreamTrackGenerator', function () {}); vi.stubGlobal('Worker', function () {}); vi.stubGlobal('OffscreenCanvas', function () {}); vi.stubGlobal('VideoFrame', function () {});
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media }); visibility('visible');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); visibility('visible'); });
describe('sessão única de cenas Premium', () => {
  it('prévia pessoal reutiliza só a câmera autorizada e permanece separada do Program em cena só tela', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); media.getDisplayMedia.mockResolvedValue(new Stream([s.screen, s.system])); const h = watch();
    expect(h.state().cameraPreviewStream ?? null).toBeNull(); await h.capture.prepare();
    const preview = h.state().cameraPreviewStream!, program = h.state().stream!;
    expect(preview).not.toBe(program); expect(preview.getTracks()).toEqual([s.camera]); expect(preview.getAudioTracks()).toEqual([]);
    await h.capture.prepareScreen!(); h.capture.selectScene!('screen'); h.capture.start();
    expect(h.state().cameraPreviewStream).toBe(preview); expect(h.state().stream).toBe(program); expect(Recorder.instances[0].stream).toBe(program);
    expect(media.getUserMedia).toHaveBeenCalledTimes(1); expect(s.camera.stop).not.toHaveBeenCalled(); expect(s.mic.stop).not.toHaveBeenCalled();
    await h.capture.stop(); expect(h.state().cameraPreviewStream).toBeNull(); h.capture.dispose();
  });
  it('troca confirmada de câmera substitui prévia pessoal sem reconstruir Program ou abrir microfone novamente', async () => {
    const s = sources(), replacement = new Track('video', 'usb-camera', 'Câmera externa'); media.getUserMedia.mockResolvedValueOnce(new Stream([s.camera, s.mic])).mockResolvedValueOnce(new Stream([replacement])); const h = watch();
    await h.capture.prepare(); const program = h.state().stream, oldPreview = h.state().cameraPreviewStream;
    await h.capture.selectDevices({ cameraId: 'usb-camera' });
    expect(h.state().cameraPreviewStream).not.toBe(oldPreview); expect(h.state().cameraPreviewStream?.getTracks()).toEqual([replacement]); expect(h.state().cameraPreviewStream?.getAudioTracks()).toEqual([]);
    expect(h.state().stream).toBe(program); expect(h.capture.getMicrophoneTrack()).toBe(s.mic); expect(s.mic.stop).not.toHaveBeenCalled(); expect(replacement.stop).not.toHaveBeenCalled();
    h.capture.cancel(); expect(h.state().cameraPreviewStream).toBeNull(); expect(replacement.stop).toHaveBeenCalledOnce(); h.capture.dispose();
  });
  it('câmera muda perde autoimagem até confirmação de recuperação sem exibir frames antigos', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); media.getDisplayMedia.mockResolvedValue(new Stream([s.screen])); const h = watch();
    await h.capture.prepare(); await h.capture.prepareScreen!(); h.capture.selectScene!('screen-camera'); h.capture.start();
    s.camera.muted = true; s.camera.onmute?.(); expect(h.state().cameraPreviewStream).toBeNull(); expect(h.state().scenes).toMatchObject({ cameraReady: false, screenReady: true, selected: 'screen' });
    const frame = pending<void>(); composition().setSource.mockReturnValueOnce(frame.promise); s.camera.muted = false; s.camera.onunmute?.();
    expect(h.state().cameraPreviewStream).toBeNull(); frame.resolve(); await vi.waitFor(() => expect(h.state().scenes?.cameraReady).toBe(true));
    expect(h.state().cameraPreviewStream?.getTracks()).toEqual([s.camera]); expect(Recorder.instances[0].stop).not.toHaveBeenCalled(); expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    await h.capture.stop(); h.capture.dispose();
  });
  it('prévia não autoriza REC em aba oculta e não pode ressuscitar após câmera tardia cancelada', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValueOnce(new Stream([s.camera, s.mic])); const h = watch(); await h.capture.prepare();
    visibility('hidden'); expect(() => h.capture.start()).toThrow('Volte à aba do Studio'); expect(Recorder.instances).toHaveLength(0); expect(h.state().cameraPreviewStream?.getTracks()).toEqual([s.camera]);
    h.capture.cancel(); expect(h.state().cameraPreviewStream).toBeNull(); h.capture.dispose(); visibility('visible');
    const later = pending<Stream>(); media.getUserMedia.mockReturnValueOnce(later.promise); const next = watch(), opening = next.capture.prepare();
    await vi.waitFor(() => expect(media.getUserMedia).toHaveBeenCalledTimes(2)); next.capture.dispose(); const lateSources = sources(); later.resolve(new Stream([lateSources.camera, lateSources.mic]));
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' }); expect(next.state().cameraPreviewStream).toBeNull(); expect(lateSources.camera.stop).toHaveBeenCalledOnce();
  });
  it('não pede permissões na construção; tela separada mantém Program, mic e contexto únicos em dez mudanças durante REC', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); media.getDisplayMedia.mockResolvedValue(new Stream([s.screen, s.system])); const h = watch();
    expect(media.getUserMedia).not.toHaveBeenCalled(); await h.capture.prepare(); const program = h.state().stream!, audio = program.getAudioTracks()[0], video = program.getVideoTracks()[0];
    expect(media.getDisplayMedia).not.toHaveBeenCalled(); await h.capture.prepareScreen!(); expect(h.state().stream).toBe(program); expect(h.state().scenes?.screenName).toBe('Janela da aula'); h.capture.start();
    for (let i = 0; i < 10; i++) h.capture.selectScene!(i % 3 === 0 ? 'screen-camera' : i % 3 === 1 ? 'camera' : 'screen');
    expect(h.state().stream).toBe(program); expect(Recorder.instances).toHaveLength(1); expect(Recorder.instances[0].stream).toBe(program); expect(program.getAudioTracks()[0]).toBe(audio); expect(program.getVideoTracks()[0]).toBe(video);
    expect(Audio.instances).toHaveLength(1); expect(s.mic.stop).not.toHaveBeenCalled(); expect(h.capture.getMicrophoneTrack()).toBe(s.mic); expect(media.getUserMedia).toHaveBeenCalledTimes(1); expect(media.getDisplayMedia).toHaveBeenCalledTimes(1);
    const stopping = h.capture.stop(); expect(h.capture.stop()).toBe(stopping); const file = await stopping; expect(file.size).toBeGreaterThan(0); expect(h.state().phase).toBe('recorded'); expect(h.state().elapsed).toBe(3); h.capture.dispose();
  });
  it('hidden mantém REC, fontes e fluxo enquanto troca cena; microfone mudo não apaga áudio de tela', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); media.getDisplayMedia.mockResolvedValue(new Stream([s.screen, s.system])); const h = watch(); await h.capture.prepare(); await h.capture.prepareScreen!(); h.capture.selectScene!('screen-camera'); h.capture.start();
    visibility('hidden'); expect(h.state().phase).toBe('recording'); expect(Recorder.instances[0].stop).not.toHaveBeenCalled(); expect(s.camera.stop).not.toHaveBeenCalled(); h.capture.selectScene!('screen'); h.capture.setMicrophoneEnabled(false);
    expect(s.mic.enabled).toBe(false); expect(s.system.enabled).toBe(true); expect(h.state().levels[0].averageDb).toBe(-120); expect(Audio.instances[0].sources[1].stream.getAudioTracks()).toEqual([s.system]);
    h.capture.selectScene!('camera'); expect(Audio.instances[0].gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, .015); visibility('visible'); await h.capture.stop(); h.capture.dispose();
  });
  it('encerrar compartilhamento durante REC volta câmera sem parar gravador/mic; perda posterior da câmera salva parcial', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); media.getDisplayMedia.mockResolvedValue(new Stream([s.screen, s.system])); const h = watch(); await h.capture.prepare(); await h.capture.prepareScreen!(); h.capture.selectScene!('screen-camera'); h.capture.start();
    s.screen.readyState = 'ended'; s.screen.onended?.(); expect(h.state().scenes).toMatchObject({ selected: 'camera', screenReady: false, cameraReady: true }); expect(h.state().phase).toBe('recording'); expect(s.mic.stop).not.toHaveBeenCalled(); expect(Recorder.instances[0].stop).not.toHaveBeenCalled();
    s.camera.readyState = 'ended'; s.camera.onended?.(); await vi.waitFor(() => expect(h.state().phase).toBe('recorded')); expect(h.state().file?.size).toBeGreaterThan(0); expect(h.state().error).toContain('preservado'); h.capture.dispose();
  });
  it('Continuity interrompida cai para tela e recuperação confirma frame antes de oferecer bolha novamente', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); media.getDisplayMedia.mockResolvedValue(new Stream([s.screen])); const h = watch(); await h.capture.prepare(); await h.capture.prepareScreen!(); h.capture.selectScene!('screen-camera'); h.capture.start();
    s.camera.muted = true; s.camera.onmute?.(); expect(h.state().scenes).toMatchObject({ selected: 'screen', cameraReady: false, screenReady: true }); expect(() => h.capture.selectScene!('screen-camera')).toThrow('fontes');
    const first = pending<void>(); composition().setSource.mockReturnValueOnce(first.promise); s.camera.muted = false; s.camera.onunmute?.(); expect(h.state().scenes?.cameraReady).toBe(false); first.resolve(); await vi.waitFor(() => expect(h.state().scenes?.cameraReady).toBe(true)); expect(h.state().scenes?.selected).toBe('screen');
    await h.capture.stop(); h.capture.dispose();
  });
  it('perda do mic encerra e salva parcial; fontes de vídeo não podem substituir áudio silenciosamente', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); const h = watch(); await h.capture.prepare(); h.capture.start(); s.mic.readyState = 'ended'; s.mic.onended?.(); await vi.waitFor(() => expect(h.state().phase).toBe('recorded')); expect(h.state().error).toContain('microfone'); expect(Recorder.instances[0].stop).toHaveBeenCalledTimes(1); h.capture.dispose();
  });
  it('negação de tela preserva câmera; picker que resolve após cancel fecha só a entrada tardia e não ressuscita a sessão', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); media.getDisplayMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError')); const h = watch(); await h.capture.prepare(); const stream = h.state().stream;
    await expect(h.capture.prepareScreen!()).rejects.toMatchObject({ name: 'NotAllowedError' }); expect(h.state().stream).toBe(stream); expect(h.state().scenes?.cameraReady).toBe(true); expect(s.camera.stop).not.toHaveBeenCalled();
    const picker = pending<Stream>(); media.getDisplayMedia.mockReturnValueOnce(picker.promise); const selection = h.capture.prepareScreen!(); h.capture.cancel(); picker.resolve(new Stream([s.screen, s.system])); await expect(selection).rejects.toMatchObject({ name: 'AbortError' }); expect(s.screen.stop).toHaveBeenCalledTimes(1); expect(s.system.stop).toHaveBeenCalledTimes(1); expect(h.state().phase).toBe('idle'); h.capture.dispose();
  });
  it('bloqueia permissões/formatos durante REC; geometria bolha pode mudar sem reconstruir saída e Short é vertical real', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); media.getDisplayMedia.mockResolvedValue(new Stream([s.screen])); const h = watch('9:16'); await h.capture.prepare(); await h.capture.prepareScreen!(); const stream = h.state().stream; expect(h.state()).toMatchObject({ width: 1080, height: 1920, frameRate: 30 }); h.capture.start();
    await expect(h.capture.prepareScreen!()).rejects.toThrow('antes de iniciar'); await expect(h.capture.configureVideo({ zoom: 2 })).rejects.toThrow('antes de iniciar'); await expect(h.capture.selectDevices({ cameraId: 'other' })).rejects.toThrow('antes de iniciar');
    h.capture.configureScene!({ size: .5, position: { x: 1, y: 1 }, transition: 'fade' }); expect(h.state().scenes?.position).toEqual({ x: .75, y: .859375 }); expect(h.state().stream).toBe(stream); await h.capture.stop(); h.capture.dispose();
  });
  it('falha metadata preserva candidato/journal; retry não duplica REC nem abre dispositivos', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); mocks.inspect.mockRejectedValueOnce(new Error('Decoder indisponível')).mockResolvedValueOnce({ kind: 'video', duration: 9, hasAudio: true }); const h = watch(); await h.capture.prepare(); h.capture.start(); await expect(h.capture.stop()).rejects.toThrow('Decoder'); const file = h.state().file;
    expect(file?.size).toBeGreaterThan(0); await expect(h.capture.prepare()).rejects.toThrow('take pendente'); const retry = await h.capture.stop(); expect(retry).toBe(file); expect(Recorder.instances).toHaveLength(1); expect(media.getUserMedia).toHaveBeenCalledTimes(1); h.capture.dispose();
  });
  it('worker inválido durante REC salva parcial; dispose cancela metadata pendente sem arquivo/evento tardio', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); const h = watch(); await h.capture.prepare(); h.capture.start(); composition().options.onError(new Error('GPU perdida; trecho preservado')); await vi.waitFor(() => expect(h.state().phase).toBe('recorded')); expect(h.state().error).toContain('GPU'); h.capture.dispose();
    media.getUserMedia.mockResolvedValue(new Stream([new Track('video', 'new', 'Nova'), new Track('audio', 'newmic', 'Novo')])); const read = pending<{ kind: string; duration: number; hasAudio: boolean }>(); mocks.inspect.mockReturnValue(read.promise); const next = watch(); await next.capture.prepare(); next.capture.start(); const stop = next.capture.stop(); await vi.waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(2)); next.capture.dispose(); await expect(stop).rejects.toMatchObject({ name: 'AbortError' }); read.resolve({ kind: 'video', duration: 3, hasAudio: true }); await Promise.resolve(); expect(next.state().phase).toBe('idle'); expect(next.state().file).toBeNull();
  });
  it('capability ausente falha antes permissão; resposta de câmera tardia após dispose não vaza', async () => {
    vi.stubGlobal('MediaStreamTrackProcessor', undefined); const unsupported = watch(); await expect(unsupported.capture.prepare()).rejects.toThrow('Chrome'); expect(media.getUserMedia).not.toHaveBeenCalled(); unsupported.capture.dispose();
    vi.stubGlobal('MediaStreamTrackProcessor', function () {}); const input = pending<Stream>(); media.getUserMedia.mockReturnValue(input.promise); const h = watch(); const opening = h.capture.prepare(); await vi.waitFor(() => expect(media.getUserMedia).toHaveBeenCalledTimes(1)); h.capture.dispose(); const s = sources(); input.resolve(new Stream([s.camera, s.mic])); await expect(opening).rejects.toMatchObject({ name: 'AbortError' }); expect(s.camera.stop).toHaveBeenCalledTimes(1); expect(s.mic.stop).toHaveBeenCalledTimes(1);
  });
  it('worker/transfer runtime indisponível falha antes permissões e encerra output já criado', async () => {
    mocks.readyError = new Error('Transferência de vídeo indisponível.'); const h = watch(); await expect(h.capture.prepare()).rejects.toThrow('Transferência'); expect(media.getUserMedia).not.toHaveBeenCalled(); expect(composition().dispose).toHaveBeenCalled(); expect(h.state().phase).toBe('error'); h.capture.dispose();
  });
  it('ordem real inactive→error→dataavailable→stop preserva chunk final sem depender de stop imperativo', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); const h = watch(); await h.capture.prepare(); h.capture.start(); const recorder = Recorder.instances[0];
    recorder.ondataavailable?.({ data: new Blob(['before-error']) }); recorder.state = 'inactive'; recorder.onerror?.(); expect(h.state().phase).toBe('stopping'); expect(recorder.stop).not.toHaveBeenCalled();
    recorder.ondataavailable?.({ data: new Blob(['final-after-error']) }); recorder.onstop?.(); await vi.waitFor(() => expect(h.state().phase).toBe('recorded')); const file = h.state().file!;
    const text = await file.text();
    expect(text).toBe('before-errorfinal-after-error'); expect(h.state().error).toContain('gravador'); expect(Recorder.instances).toHaveLength(1); h.capture.dispose();
  });
  it('falha real de leitura IDB retém chunks e retry consolida os mesmos bytes sem nova permissão ou REC', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); const h = watch(); await h.capture.prepare(); h.capture.start();
    Recorder.instances[0].ondataavailable?.({ data: new Blob(['before-stop/']) });
    const read = vi.spyOn(IDBIndex.prototype, 'getAll').mockImplementationOnce(() => { throw new DOMException('Leitura temporariamente indisponível.', 'InvalidStateError'); });
    await expect(h.capture.stop()).rejects.toThrow('Leitura temporariamente');
    expect(h.state()).toMatchObject({ phase: 'error', file: null, pendingRecovery: true, stream: null }); expect(mocks.inspect).not.toHaveBeenCalled();
    await expect(h.capture.prepare()).rejects.toThrow('take pendente'); await expect(h.capture.selectDevices({ microphoneId: 'new-mic' })).rejects.toThrow('take pendente');
    await expect(h.capture.configureVideo({ zoom: 1 })).rejects.toThrow('take pendente'); expect(() => h.capture.start()).toThrow('Prepare');
    read.mockRestore(); const retry = h.capture.stop(); expect(h.capture.stop()).toBe(retry); const file = await retry;
    expect(await file.text()).toBe('before-stop/header+frames+audio'); expect(file.type).toBe('video/webm');
    expect(h.state()).toMatchObject({ phase: 'recorded', file, pendingRecovery: false }); expect(Recorder.instances).toHaveLength(1); expect(Recorder.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(media.getUserMedia).toHaveBeenCalledTimes(1); expect(mocks.inspect).toHaveBeenCalledTimes(1); h.capture.dispose();
  });
  it('nova falha mantém recovery e cancelamento explícito rejeita retry pendente sem ressuscitar File', async () => {
    const s = sources(); media.getUserMedia.mockResolvedValue(new Stream([s.camera, s.mic])); const h = watch(); await h.capture.prepare(); h.capture.start();
    const read = vi.spyOn(IDBIndex.prototype, 'getAll').mockImplementation(() => { throw new DOMException('Leitura indisponível.', 'InvalidStateError'); });
    await expect(h.capture.stop()).rejects.toThrow('Leitura'); await expect(h.capture.stop()).rejects.toThrow('Leitura');
    expect(h.state()).toMatchObject({ phase: 'error', file: null, pendingRecovery: true }); read.mockRestore();
    const metadata = pending<{ kind: string; duration: number; hasAudio: boolean }>(); mocks.inspect.mockReturnValueOnce(metadata.promise);
    const retry = h.capture.stop(); const cancelled = expect(retry).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(1)); h.capture.cancel(); await cancelled;
    expect(h.state()).toMatchObject({ phase: 'idle', file: null, pendingRecovery: false }); metadata.resolve({ kind: 'video', duration: 3, hasAudio: true });
    await Promise.resolve(); await Promise.resolve(); expect(h.state()).toMatchObject({ phase: 'idle', file: null, pendingRecovery: false }); expect(media.getUserMedia).toHaveBeenCalledTimes(1); h.capture.dispose();
  });
});

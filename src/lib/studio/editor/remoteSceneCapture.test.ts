import { afterEach, describe, expect, it, vi } from 'vitest';
import { studioGrade } from '../../../../shared/studio/model';
import type { StudioRemoteEnvelope } from '../../../../shared/studio/remoteCamera';
import type { StudioCaptureController, StudioCaptureState } from './capture';
import type { StudioRemoteCaptureController } from './remoteCameraCapture';
import { createStudioRemoteSceneCapture, studioRemoteMicrophoneId, studioRemoteMicrophoneUID } from './remoteSceneCapture';
import type { StudioSceneCaptureController } from './sceneCapture';
import { studioDefaultSceneConfiguration } from './sceneTypes';
import type { StudioRemoteSceneRecovery } from './remoteSceneRecovery';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('./capture', () => ({ studioCaptureMime: () => 'video/webm' }));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const instances: Recorder[] = [];
class Recorder {
  static isTypeSupported() { return true; } state = 'inactive'; ondataavailable: ((event: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null; onerror: ((event: Event) => void) | null = null;
  constructor(public stream: MediaStream, public options: MediaRecorderOptions) { instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['raw-screen-audio']) }); this.onstop?.(); }
}
const controllers: StudioCaptureController[] = [];
afterEach(() => { controllers.splice(0).forEach(controller => controller.dispose()); instances.length = 0; vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture() {
  vi.stubGlobal('MediaRecorder', Recorder);
  const preview = { kind: 'video', readyState: 'live', muted: false, stop: vi.fn(), clone: vi.fn() } as unknown as MediaStreamTrack;
  const screenTrack = { kind: 'video', readyState: 'live', stop: vi.fn(), getSettings: () => ({ width: 2560, height: 1440, frameRate: 30 }) } as unknown as MediaStreamTrack;
  const rawStream = { getVideoTracks: () => [screenTrack], getAudioTracks: () => [{ id: 'screen-system-audio' }] } as unknown as MediaStream;
  const envelope = { session: { id: 'session', title: 'Minha aula', controllerId: 'controller', status: 'ready', configuration: { resolution: '4k', fps: 30, cameraFacing: 'back' }, deviceState: { width: 3840, height: 2160, fps: 30 } }, takes: [], commands: [], serverAt: '' } as unknown as StudioRemoteEnvelope;
  const ack = deferred<{ takeId: string; startedAtServerMs: number; result: Record<string, unknown> }>();
  const builtin = { id: 'BuiltInMic', name: 'Microfone integrado', type: 'MicrophoneBuiltIn' }, usb = { id: 'USB-Audio-1', name: 'Microfone USB externo', type: 'USBAudio' };
  envelope.session.deviceSeenAt = new Date().toISOString();
  envelope.session.deviceState = { ...envelope.session.deviceState, capabilities: { audioInputSelection: true }, audioInput: { version: 1, available: [builtin, usb], preferredId: null, current: builtin, selecting: false, confirmed: true, warning: null }, audioMonitor: { status: 'live', input: builtin, channels: [{ averageDb: -24, peakDb: -8 }] } };
  const remoteListeners = new Set<(state: any) => void>();
  const base: StudioRemoteCaptureController = { prepare: vi.fn(async () => undefined), remoteStart: vi.fn(() => ack.promise), remoteStop: vi.fn(async () => ({ file: new File(['native4k'], 'native.mp4'), take: { id: 'take' }, session: envelope.session, metadata: { width: 3840, height: 2160 } })), subscribe: vi.fn(listener => { listener({ phase: 'idle' } as StudioCaptureState); return () => {}; }), subscribeRemote: vi.fn(listener => { listener({} as any); return () => {}; }), getReceivedCameraTrack: () => preview, getEnvelope: () => envelope, getServerNow: () => 100250, configureRemote: vi.fn(async () => undefined), reconnect: vi.fn(async () => undefined), discardRemoteRecovery: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), start: vi.fn(), stop: vi.fn(), flip: vi.fn(), configureVideo: vi.fn(), getMicrophoneTrack: vi.fn(), selectDevices: vi.fn(), setMicrophoneEnabled: vi.fn() } as unknown as StudioRemoteCaptureController;
  base.subscribeRemote = listener => { remoteListeners.add(listener); listener({ connection: 'connected', session: envelope.session } as any); return () => remoteListeners.delete(listener); };
  vi.mocked(base.configureRemote).mockImplementation(async patch => {
    if (patch.audioInputId === undefined) return;
    const current = patch.audioInputId === null ? builtin : [builtin, usb].find(port => port.id === patch.audioInputId); if (!current) throw new Error('Esse microfone não está conectado.');
    envelope.session.configuration.audioInputId = patch.audioInputId;
    envelope.session.deviceState!.audioInput = { ...envelope.session.deviceState!.audioInput!, preferredId: patch.audioInputId, current, confirmed: true, selecting: false, warning: null };
    envelope.session.deviceState!.audioMonitor!.input = current; remoteListeners.forEach(listener => listener({ connection: 'connected', session: envelope.session }));
  });
  let localListener = (_state: StudioCaptureState) => {};
  const localState: StudioCaptureState = { phase: 'idle', stream: {} as MediaStream, elapsed: 0, file: null, error: null, camera: null, input: null, microphoneEnabled: true, devices: { cameras: [], microphones: [{ id: 'mac-usb', name: 'Microfone do Mac' }] }, levels: [], scenes: { ...studioDefaultSceneConfiguration(), selected: 'camera', cameraReady: true, screenReady: false, preparingScreen: false, screenName: 'Tela', backgroundSupported: true, error: null }, videoControls: { busy: false, processed: true, effects: true, grade: studioGrade(), zoom: { mode: 'digital', value: 1, min: 1, max: 4, step: .1 }, resolutions: [], frameRates: [] } };
  const update = () => localListener({ ...localState, scenes: { ...localState.scenes! } });
  const local: StudioSceneCaptureController = { subscribe(listener) { localListener = listener; update(); return () => {}; }, prepare: vi.fn(async () => { localState.phase = 'ready'; localState.stream = {} as MediaStream; update(); }), configureVideo: vi.fn(async () => undefined), prepareScreen: vi.fn(async () => { localState.scenes!.screenReady = true; update(); }), getScreenOriginalStream: () => localState.scenes!.screenReady ? rawStream : null, start: vi.fn(() => { localState.phase = 'recording'; update(); }), stop: vi.fn(async () => { expect(instances[0].state).toBe('inactive'); localState.phase = 'recorded'; localState.stream = null; localState.input = null; localState.levels = []; const program = new File(['preview-720p'], 'program.webm'); localState.file = program; update(); return program; }), cancel: vi.fn(), dispose: vi.fn(), selectScene: vi.fn(scene => { localState.scenes!.selected = scene; update(); }), configureScene: vi.fn(), getMicrophoneTrack: vi.fn(), setMicrophoneEnabled: vi.fn(value => { localState.microphoneEnabled = value; update(); }), selectDevices: vi.fn(), flip: vi.fn(), setExternalNarration: vi.fn(async (source, id) => { localState.input = source === 'browser' ? { id: id!, name: 'Microfone do Mac' } : null; update(); }) } as unknown as StudioSceneCaptureController;
  const saves: StudioRemoteSceneRecovery[] = [];
  const store = { save: vi.fn(async (entry: StudioRemoteSceneRecovery) => { saves.push(structuredClone(entry)); }), get: vi.fn(), list: vi.fn() };
  const chunks: Blob[] = [], disposeBuffer = vi.fn();
  const bufferFactory = vi.fn(() => ({ prepare: vi.fn(async () => undefined), append: vi.fn(async (blob: Blob) => { chunks.push(blob); }), file: vi.fn(async (name: string, mime: string) => new File(chunks, name, { type: mime })), dispose: disposeBuffer, get bytes() { return chunks.reduce((sum, chunk) => sum + chunk.size, 0); } }));
  const result = new File(['original-derived-4k'], 'Final.mp4'); const recover = vi.fn(async () => result);
  const sceneFactory = vi.fn(() => local);
  const controller = createStudioRemoteSceneCapture({ remote: base, owner: 'owner', sceneFactory, store, recover, bufferFactory }); controllers.push(controller);
  let state!: StudioCaptureState; controller.subscribe(value => state = value);
  return { controller, base, ack, saves, store, local, sceneFactory, preview, rawStream, recover, result, state: () => state, disposeBuffer, screenTrack, envelope, builtin, usb, remoteEvent: (session: Record<string, unknown>) => { if (session.id === envelope.session.id) Object.assign(envelope.session, session); remoteListeners.forEach(listener => listener({ connection: 'connected', session: session.id === envelope.session.id ? envelope.session : session })); } };
}
describe('cenas remotas preservam RAW e nunca promovem preview a4K', () => {
  it('UIDs nativos têm namespace próprio, Auto não colide e a lista reúne entradas reais de ambos aparelhos', async () => {
    for (const uid of ['auto', 'USB-Audio:1/2%']) expect(studioRemoteMicrophoneUID(studioRemoteMicrophoneId(uid))).toBe(uid);
    expect(studioRemoteMicrophoneUID(studioRemoteMicrophoneId(null))).toBeNull(); expect(studioRemoteMicrophoneUID('mac-usb')).toBeUndefined(); expect(() => studioRemoteMicrophoneUID('remote-iphone:input:%xx')).toThrow('disponível');
    const h = fixture(); await h.controller.prepare(); expect(h.state().devices.microphones.map(value => value.id)).toEqual([studioRemoteMicrophoneId(null), studioRemoteMicrophoneId(h.builtin.id), studioRemoteMicrophoneId(h.usb.id), 'mac-usb']); expect(h.state().levels).toEqual([{ averageDb: -24, peakDb: -8 }]);
  });
  it('entrada do iPhone só muda após ACK e falha conserva a fonte e o graph anteriores', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); const oldInput = h.state().input, pending = deferred<void>();
    vi.mocked(h.base.configureRemote).mockImplementationOnce(() => pending.promise); const changing = h.controller.selectDevices({ microphoneId: studioRemoteMicrophoneId(h.usb.id) });
    expect(h.state().phase).toBe('preparing'); expect(h.state().input).toEqual(oldInput); expect(h.local.setExternalNarration).not.toHaveBeenCalled(); await expect(h.controller.remoteStart()).rejects.toThrow('Prepare'); expect(h.saves).toHaveLength(0); expect(h.base.remoteStart).not.toHaveBeenCalled();
    pending.reject(new Error('O iPhone não confirmou esse USB.')); await expect(changing).rejects.toThrow('não confirmou'); expect(h.state()).toMatchObject({ phase: 'ready', input: oldInput, scenes: { narrationSource: 'iphone', screenReady: true } });
    await h.controller.selectDevices({ microphoneId: studioRemoteMicrophoneId(h.usb.id) }); expect(h.base.configureRemote).toHaveBeenLastCalledWith({ audioInputId: h.usb.id }); expect(h.local.setExternalNarration).toHaveBeenLastCalledWith('iphone'); expect(h.local.selectDevices).not.toHaveBeenCalled(); expect(h.state().input).toEqual({ id: studioRemoteMicrophoneId(h.usb.id), name: 'Microfone USB externo · iPhone' });
  });
  it('medidor não atribui PCM antigo ao novo UID nem publica níveis após heartbeat vencido', async () => {
    const h = fixture(); await h.controller.prepare();
    h.envelope.session.deviceState!.audioInput = { ...h.envelope.session.deviceState!.audioInput!, preferredId: h.usb.id, current: h.usb }; h.remoteEvent({ id: 'session' });
    expect(h.state().input?.id).toBe(studioRemoteMicrophoneId(h.usb.id)); expect(h.state().levels).toEqual([]);
    h.envelope.session.deviceState!.audioMonitor!.input = h.usb; h.remoteEvent({ id: 'session' }); expect(h.state().levels[0].averageDb).toBe(-24);
    h.envelope.session.deviceSeenAt = new Date(Date.now() - 7000).toISOString(); h.remoteEvent({ id: 'session' }); expect(h.state().levels).toEqual([]);
  });
  it('estado compartilhado/PiP expira barras sem novo heartbeat nem callback remoto', async () => {
    vi.useFakeTimers(); const h = fixture(); await h.controller.prepare(); expect(h.state().levels[0].averageDb).toBe(-24);
    await vi.advanceTimersByTimeAsync(7000); expect(h.state().levels).toEqual([]); expect(h.state().phase).toBe('ready'); expect(h.base.remoteStop).not.toHaveBeenCalled(); expect(h.preview.stop).not.toHaveBeenCalled();
    h.controller.cancel(); await vi.advanceTimersByTimeAsync(2000); expect(h.state().levels).toEqual([]);
  });
  it('Mac é uma escolha explícita, grava a política congelada e não troca entrada durante REC', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!();
    await h.controller.selectDevices({ microphoneId: 'mac-usb' }); expect(h.local.setExternalNarration).toHaveBeenCalledWith('browser', 'mac-usb'); expect(h.base.configureRemote).not.toHaveBeenCalled(); expect(h.state()).toMatchObject({ input: { id: 'mac-usb' }, scenes: { narrationSource: 'browser' } });
    h.ack.resolve({ takeId: 'take', startedAtServerMs: 100000, result: {} }); await h.controller.remoteStart(); expect(h.saves.at(-1)).toMatchObject({ narrationSource: 'browser' });
    await expect(h.controller.selectDevices({ microphoneId: studioRemoteMicrophoneId(null) })).rejects.toThrow('antes de iniciar'); expect(h.local.setExternalNarration).toHaveBeenCalledTimes(1); await h.controller.stop(); expect(h.saves.at(-1)).toMatchObject({ narrationSource: 'browser' });
  });
  it('seleção explícita de Mac restaura nativeAuto perdido e, se ACK falha, mantém source anterior', async () => {
    const h = fixture(); await h.controller.prepare(); h.envelope.session.deviceState!.audioInput = { ...h.envelope.session.deviceState!.audioInput!, preferredId: h.usb.id, confirmed: false, warning: 'USB do iPhone desconectado.' };
    h.remoteEvent({ id: 'session' }); vi.mocked(h.base.configureRemote).mockRejectedValueOnce(new Error('Auto não confirmado.'));
    await expect(h.controller.selectDevices({ microphoneId: 'mac-usb' })).rejects.toThrow('Auto não confirmado'); expect(h.local.setExternalNarration).not.toHaveBeenCalled(); expect(h.state().scenes?.narrationSource).toBe('iphone');
    await h.controller.selectDevices({ microphoneId: 'mac-usb' }); expect(h.base.configureRemote).toHaveBeenLastCalledWith({ audioInputId: null }); expect(h.envelope.session.deviceState!.audioInput?.confirmed).toBe(true); expect(h.state().scenes?.narrationSource).toBe('browser');
  });
  it('micNative não confirmado ou configure pendente bloqueia antes de buffer, intenção e reserva cloud', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); h.envelope.session.deviceState!.audioInput!.confirmed = false;
    await expect(h.controller.remoteStart()).rejects.toThrow('Confirme o microfone'); expect(() => h.controller.start()).toThrow('Confirme o microfone'); expect(h.saves).toHaveLength(0); expect(h.base.remoteStart).not.toHaveBeenCalled();
    h.envelope.session.deviceState!.audioInput!.confirmed = true; h.envelope.commands.push({ type: 'configure', status: 'pending' } as StudioRemoteEnvelope['commands'][number]);
    await expect(h.controller.remoteStart()).rejects.toThrow('confirmar o microfone'); expect(h.saves).toHaveLength(0); expect(h.base.remoteStart).not.toHaveBeenCalled();
  });
  it('histórico congela voz do iPhone em todas cenas e registra mute sem apagar sistema da tela', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); h.ack.resolve({ takeId: 'take', startedAtServerMs: 100000, result: {} }); await h.controller.remoteStart();
    h.controller.selectScene!('screen'); h.controller.setMicrophoneEnabled(false); h.controller.selectScene!('screen-camera'); h.controller.setMicrophoneEnabled(true); await h.controller.stop();
    expect(h.saves.at(-1)).toMatchObject({ narrationSource: 'iphone' }); expect(h.saves.at(-1)!.events.map(value => [value.scene, value.microphoneEnabled])).toEqual([['camera', true], ['screen', true], ['screen', false], ['screen-camera', false], ['screen-camera', true]]); expect(h.state().file).toBe(h.result);
  });
  it('cleanup de STOP remove input e níveis da revisão mesmo com heartbeat nativo ainda vivo', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); expect(h.state().input).not.toBeNull(); expect(h.state().levels).not.toEqual([]);
    h.ack.resolve({ takeId: 'take', startedAtServerMs: 100000, result: {} }); await h.controller.remoteStart(); await h.controller.stop();
    expect(h.state()).toMatchObject({ phase: 'recorded', stream: null, input: null, levels: [] }); expect(h.state().devices.microphones).toHaveLength(4);
    h.remoteEvent({ id: 'session' }); expect(h.state().input).toBeNull(); expect(h.state().levels).toEqual([]); expect(h.state().devices.microphones).toHaveLength(4);
  });
  it('perda do mic iPhone em REC finaliza parcial com original preservado, sem escolher Mac ocultamente', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); h.ack.resolve({ takeId: 'take', startedAtServerMs: 100000, result: {} }); await h.controller.remoteStart();
    h.envelope.session.deviceState!.audioInput!.confirmed = false; h.envelope.session.deviceState!.audioInput!.warning = 'O USB do iPhone foi desconectado.'; h.remoteEvent({ id: 'session' });
    await vi.waitFor(() => expect(h.state().phase).toBe('recorded')); expect(h.base.remoteStop).toHaveBeenCalledOnce(); expect(h.state().error).toContain('USB do iPhone'); expect(h.saves.at(-1)).toMatchObject({ narrationSource: 'iphone', cameraFile: expect.anything(), screenFile: expect.anything() }); expect(h.local.setExternalNarration).not.toHaveBeenCalled();
  });
  it('prepara com câmera emprestada e exige tela antesREC', async () => { const h = fixture(); await h.controller.prepare(); expect(h.sceneFactory).toHaveBeenCalledWith(expect.objectContaining({ externalCamera: { track: h.preview, name: 'Câmera do iPhone' }, externalNarration: 'iphone' })); expect(h.state()).toMatchObject({ phase: 'ready', width: 3840, height: 2160, scenes: { narrationSource: 'iphone' }, input: { id: studioRemoteMicrophoneId(null), name: 'Microfone integrado · iPhone' } }); expect(() => h.controller.start()).toThrow('compartilhamento'); expect(h.base.remoteStart).not.toHaveBeenCalled(); });
  it('persiste intenção antesACK, aguarda master e grava tela+mixaudio raw sem trocarrecorder', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); const starting = h.controller.remoteStart();
    await vi.waitFor(() => expect(h.base.remoteStart).toHaveBeenCalledOnce()); expect(instances).toHaveLength(0); expect(h.saves[0]).toMatchObject({ owner: 'owner', takeId: null, bufferId: expect.stringContaining('owner-') });
    h.ack.resolve({ takeId: 'take', startedAtServerMs: 100000, result: {} }); await starting;
    expect(instances).toHaveLength(1); expect(instances[0].stream).toBe(h.rawStream); expect(h.saves.at(-1)).toMatchObject({ takeId: 'take', cameraOffsetSeconds: .25, status: 'recording' });
    h.controller.selectScene!('screen-camera'); h.controller.selectScene!('screen'); expect(instances).toHaveLength(1);
    const final = await h.controller.stop(); expect(final).toBe(h.result); expect(h.local.stop).toHaveBeenCalledOnce(); expect(h.recover).toHaveBeenCalledOnce(); expect(h.saves.find(entry => entry.screenFile)).toBeTruthy(); expect(h.saves.find(entry => entry.cameraFile)).toBeTruthy(); expect(h.saves.at(-1)!.events.map(event => event.scene)).toEqual(['camera', 'screen-camera', 'screen']); expect(h.state()).toMatchObject({ phase: 'recorded', file: h.result }); expect(h.preview.stop).not.toHaveBeenCalled(); expect(h.screenTrack.stop).not.toHaveBeenCalled(); expect(h.disposeBuffer).not.toHaveBeenCalled();
  });
  it('falha deexport mantém originais e retry não cria outroREC nem retornaProgram', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); h.ack.resolve({ takeId: 'take', startedAtServerMs: 100000, result: {} }); await h.controller.remoteStart(); h.recover.mockRejectedValueOnce(new Error('Encoder ocupado'));
    await expect(h.controller.stop()).rejects.toThrow('Encoder ocupado'); expect(h.state()).toMatchObject({ phase: 'error', pendingRecovery: true, file: null }); expect(h.saves.at(-1)).toMatchObject({ status: 'recoverable', cameraFile: expect.anything(), screenFile: expect.anything() });
    expect(await h.controller.stop()).toBe(h.result); expect(h.base.remoteStart).toHaveBeenCalledOnce(); expect(h.local.start).toHaveBeenCalledOnce(); expect(h.disposeBuffer).not.toHaveBeenCalled();
  });
  it('cancelamento consolida raw e pedeSTOP nativo sem apagar arquivos ou parartrackRoom', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); h.ack.resolve({ takeId: 'take', startedAtServerMs: 100000, result: {} }); await h.controller.remoteStart(); h.controller.cancel(); await vi.waitFor(() => expect(h.saves.at(-1)).toMatchObject({ status: 'recoverable', screenFile: expect.anything() }));
    expect(h.base.cancel).toHaveBeenCalled(); expect(h.disposeBuffer).not.toHaveBeenCalled(); expect(h.preview.stop).not.toHaveBeenCalled(); expect(h.state().file).toBeNull();
  });
  it('cancel após salvar preserva recibo completo e permite próximo take no mesmo controller', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); h.ack.resolve({ takeId: 'take', startedAtServerMs: 100000, result: {} }); await h.controller.remoteStart(); await h.controller.stop(); h.controller.cancel(); await h.controller.prepare();
    expect(h.saves.filter(entry => entry.status === 'complete')).toHaveLength(2); expect(h.saves.at(-1)).toMatchObject({ status: 'complete', outputFile: h.result }); expect(h.state()).toMatchObject({ phase: 'ready', pendingRecovery: false, file: null }); expect(h.sceneFactory).toHaveBeenCalledTimes(2); expect(h.disposeBuffer).not.toHaveBeenCalled();
  });
  it('avisa ampliação da tela1080/2K mesmo quando câmera original4K está confirmada', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); expect(h.state().outputVideo?.scaled).toBe(false); h.controller.selectScene!('screen-camera'); expect(h.state().outputVideo).toMatchObject({ sourceWidth: 2560, sourceHeight: 1440, scaled: true }); expect(h.state().width).toBe(3840);
  });
  it('recorder travado não deixa iPhone gravando e preserva master antes timeoutbounded', async () => {
    vi.useFakeTimers(); const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); h.ack.resolve({ takeId: 'take', startedAtServerMs: 100000, result: {} }); await h.controller.remoteStart();
    const recorder = instances[0]; recorder.ondataavailable?.({ data: new Blob(['durable-part']) }); recorder.stop = () => { recorder.state = 'inactive'; };
    const stopping = h.controller.stop().catch(error => error); await vi.advanceTimersByTimeAsync(8001);
    expect((await stopping).message).toContain('não finalizou'); expect(h.base.remoteStop).toHaveBeenCalledOnce(); expect(h.saves.some(entry => !!entry.cameraFile)).toBe(true); expect(h.state()).toMatchObject({ phase: 'error', pendingRecovery: true, file: null }); expect(h.disposeBuffer).not.toHaveBeenCalled();
    recorder.onstop?.();
  });
  it('ACK perdido vincula take backend antesSTOP limparactiveid; não inventa timestampnemgravaRAW', async () => {
    const h = fixture(); await h.controller.prepare(); await h.controller.prepareScreen!(); const starting = h.controller.remoteStart().catch(error => error); await vi.waitFor(() => expect(h.base.remoteStart).toHaveBeenCalledOnce());
    h.remoteEvent({ id: 'other-session', activeTakeId: 'wrong-take' }); await Promise.resolve(); expect(h.saves.at(-1)!.takeId).toBeNull();
    h.remoteEvent({ id: 'session', activeTakeId: 'take-reserved' }); await vi.waitFor(() => expect(h.saves.at(-1)!.takeId).toBe('take-reserved'));
    h.remoteEvent({ id: 'session', activeTakeId: null }); h.ack.reject(new Error('ACK perdido')); expect((await starting).message).toBe('ACK perdido');
    expect(h.saves.at(-1)).toMatchObject({ takeId: 'take-reserved', startedAtServerMs: null, cameraOffsetSeconds: null, status: 'recoverable' }); expect(instances).toHaveLength(0); expect(h.base.cancel).toHaveBeenCalled();
  });
});

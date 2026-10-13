import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioCaptureState } from '@/lib/studio/editor/capture';
import type { StudioRemoteCaptureController, StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import { studioRemoteMicrophoneId, studioRemoteMicrophoneUID } from '@/lib/studio/editor/remoteSceneCapture';
import { studioDefaultSceneConfiguration } from '@/lib/studio/editor/sceneTypes';
import { StudioRecordingWorkspace } from './StudioRecordingWorkspace';

const factories = vi.hoisted(() => ({ local: vi.fn(), remote: vi.fn(), scenes: vi.fn() }));
vi.mock('@/lib/studio/editor/capture', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/studio/editor/capture')>(),
  createStudioCapture: (options: unknown) => factories.local(options),
}));
vi.mock('@/lib/studio/editor/remoteCameraCapture', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/studio/editor/remoteCameraCapture')>(),
  createStudioRemoteCapture: (options: unknown) => factories.remote(options),
}));
vi.mock('@/lib/studio/editor/remoteSceneCapture', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/studio/editor/remoteSceneCapture')>(),
  createStudioRemoteSceneCapture: (options: unknown) => factories.scenes(options),
}));

const builtin = { id: 'BuiltInMic', name: 'Microfone integrado do iPhone', type: 'MicrophoneBuiltIn' };
const usb = { id: 'USB:Áudio / externo', name: 'USB externo no iPhone', type: 'USBAudio' };
const computer = { id: 'mac-microphone', name: 'Microfone do computador' };
const computerUSB = { id: 'mac-usb', name: 'USB conectado ao computador' };
function deferred() { let resolve!: () => void, reject!: (error: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Track extends EventTarget {
  id = 'remote-camera'; kind = 'video'; label = 'Câmera do iPhone'; readyState = 'live'; muted = false; enabled = true;
  getSettings() { return { width: 1920, height: 1080, frameRate: 30 }; }
  stop = vi.fn();
}
class Stream {
  constructor(private tracks = [new Track()]) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
}
const idle = (): StudioCaptureState => ({ phase: 'idle', stream: null, elapsed: 0, file: null, error: null, input: null, camera: null, devices: { cameras: [], microphones: [] }, microphoneEnabled: true, levels: [] });
function nativeView(): StudioRemoteView {
  const now = new Date().toISOString();
  return { pairing: null, connection: 'connected', transfer: 'idle', pendingTakeId: null, error: null, session: {
    id: 'native-session', projectId: null, kind: 'aula', title: 'Aula com iPhone', status: 'ready',
    controllerId: 'browser', deviceId: 'phone', sequence: 1, activeTakeId: null,
    configuration: { resolution: '1080p', fps: 30, cameraFacing: 'back', audioInputId: null },
    deviceState: { width: 1920, height: 1080, fps: 30, capabilities: { audioInputSelection: true },
      audioInput: { version: 1, available: [builtin, usb], preferredId: null, current: builtin, confirmed: true, selecting: false, warning: null },
      audioMonitor: { status: 'live', input: builtin, channels: [{ averageDb: -27, peakDb: -9 }] },
    },
    createdAt: now, expiresAt: now, pairedAt: now, controllerSeenAt: now, deviceSeenAt: now, closedAt: null,
  } };
}

/** Controllers are capture/transport boundaries. Workspace, monitor, selectors and guards are real. */
function controlledCapture(withScenes: boolean) {
  let state = idle(), view = nativeView();
  const listeners = new Set<(value: StudioCaptureState) => void>(), remoteListeners = new Set<(value: StudioRemoteView) => void>();
  let selection: ReturnType<typeof deferred> | null = null;
  const publish = (patch: Partial<StudioCaptureState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener(state)); };
  const publishRemote = () => remoteListeners.forEach(listener => listener(view));
  const receiveNativeAck = (uid: string | null) => {
    const current = uid === null ? builtin : usb;
    view = { ...view, session: { ...view.session!, deviceState: { ...view.session!.deviceState!,
      audioInput: { ...view.session!.deviceState!.audioInput!, preferredId: uid, current },
      audioMonitor: { status: 'live', input: current, channels: [{ averageDb: -33, peakDb: -15 }] },
    } } }; publishRemote();
  };
  const acknowledge = (uid: string | null) => {
    const current = uid === null ? builtin : usb;
    receiveNativeAck(uid);
    if (withScenes) base.receiveNativeAck(uid);
    publish({ input: { id: studioRemoteMicrophoneId(uid), name: `${current.name} · iPhone` }, scenes: { ...state.scenes!, narrationSource: 'iphone' } });
  };
  const controller: StudioRemoteCaptureController = {
    prepare: vi.fn(async () => publish({ phase: 'ready', stream: new Stream() as unknown as MediaStream,
      input: withScenes ? { id: studioRemoteMicrophoneId(null), name: `${builtin.name} · iPhone` } : null,
      camera: { id: 'remote-camera', name: 'Câmera do iPhone' },
      // Deliberately different from native PCM: an iPhone monitor must not display this value.
      levels: [{ averageDb: -8, peakDb: -2 }],
      devices: { cameras: [], microphones: withScenes ? [
        { id: studioRemoteMicrophoneId(null), name: 'Automático · iPhone' },
        ...[builtin, usb].map(port => ({ id: studioRemoteMicrophoneId(port.id), name: `${port.name} · iPhone` })), computer, computerUSB,
      ] : [] },
      ...(withScenes ? { scenes: { ...studioDefaultSceneConfiguration(), selected: 'camera', cameraReady: true, screenReady: true, screenName: 'Tela compartilhada', preparingScreen: false, backgroundSupported: true, error: null, narrationSource: 'iphone' } } : {}),
    })),
    start: vi.fn(() => publish({ phase: 'recording' })),
    stop: vi.fn(async () => { throw new Error('STOP não é a fronteira exercitada neste teste.'); }),
    flip: vi.fn(async () => {}), configureVideo: vi.fn(async () => {}),
    selectDevices: vi.fn(async value => {
      if (selection) await selection.promise;
      const uid = studioRemoteMicrophoneUID(value.microphoneId!);
      if (uid !== undefined) acknowledge(uid);
      else publish({ input: value.microphoneId === computerUSB.id ? computerUSB : computer,
        levels: [{ averageDb: -12, peakDb: -4 }], scenes: { ...state.scenes!, narrationSource: 'browser' } });
    }),
    setMicrophoneEnabled: vi.fn(value => publish({ microphoneEnabled: value })),
    getMicrophoneTrack: () => null,
    prepareScreen: vi.fn(async () => {}), selectScene: vi.fn(), configureScene: vi.fn(),
    cancel: vi.fn(), dispose: vi.fn(() => { listeners.clear(); remoteListeners.clear(); }),
    subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    subscribeRemote(listener) { remoteListeners.add(listener); listener(view); return () => { remoteListeners.delete(listener); }; },
    configureRemote: vi.fn(async () => {}),
    remoteStart: vi.fn(async () => ({ takeId: 'native-take', startedAtServerMs: Date.now(), result: {} })),
    remoteStop: vi.fn(async () => { throw new Error('Nenhum original foi solicitado.'); }),
    getReceivedCameraTrack: () => new Track() as unknown as MediaStreamTrack,
    getEnvelope: () => ({ session: view.session!, takes: [], commands: [], serverAt: new Date().toISOString() }),
    getServerNow: () => Date.now(), reconnect: vi.fn(async () => {}), discardRemoteRecovery: vi.fn(), unlinkRemote: vi.fn(async () => {}),
  };
  return { controller, publish, receiveNativeAck, snapshot: () => state, setSelection: (value: ReturnType<typeof deferred>) => { selection = value; } };
}

let root: Root, host: HTMLDivElement, base: ReturnType<typeof controlledCapture>, scenes: ReturnType<typeof controlledCapture>;
let permissions: ReturnType<typeof vi.fn>;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.getAttribute('aria-label') === label || value.textContent?.trim() === label);
async function click(label: string) { const target = button(label); expect(target, label).toBeTruthy(); await act(async () => target!.click()); }
const footer = () => host.querySelector<HTMLSelectElement>('select[aria-label="Microfone"]')!;
async function selectMicrophone(id: string) { expect(footer()).toBeTruthy(); await act(async () => { footer().value = id; footer().dispatchEvent(new Event('change', { bubbles: true })); }); }
async function mountScenes() {
  await act(async () => root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><StudioRecordingWorkspace owner="owner" canUseScenes /></MemoryRouter>));
  await click('Usar meu iPhone · Premium');
  const checkbox = host.querySelector<HTMLInputElement>('input[aria-label="Gravar com cenas usando meu iPhone"]'); expect(checkbox).toBeTruthy();
  await act(async () => checkbox!.click());
  await click('Conectar meu iPhone');
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Feature availability is a browser boundary; the tests never construct a worker or capture hardware.
  for (const name of ['MediaStreamTrackProcessor', 'MediaStreamTrackGenerator', 'Worker', 'OffscreenCanvas', 'VideoFrame']) vi.stubGlobal(name, class {});
  vi.stubGlobal('MediaStream', Stream); vi.stubGlobal('indexedDB', undefined);
  permissions = vi.fn(); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: permissions } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  factories.local.mockReset().mockImplementation(() => controlledCapture(false).controller);
  factories.remote.mockReset().mockImplementation(() => { base = controlledCapture(false); return base.controller; });
  factories.scenes.mockReset().mockImplementation(() => { scenes = controlledCapture(true); return scenes.controller; });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Workspace de cenas com a narração real do iPhone', () => {
  it('oferece Auto, inputs nativos e computador; default usa PCM remoto e legenda do iPhone', async () => {
    await mountScenes();
    expect(scenes.snapshot().scenes?.narrationSource).toBe('iphone');
    expect([...footer().options].map(option => [option.value, option.text])).toEqual([
      [studioRemoteMicrophoneId(null), 'Automático · iPhone'],
      [studioRemoteMicrophoneId(builtin.id), `${builtin.name} · iPhone`],
      [studioRemoteMicrophoneId(usb.id), `${usb.name} · iPhone`],
      [computer.id, computer.name], [computerUSB.id, computerUSB.name],
    ]);
    expect(footer().value).toBe(studioRemoteMicrophoneId(null));
    expect(host.querySelector('[aria-label="Nível do microfone do iPhone"]')?.getAttribute('aria-valuenow')).toBe('-27');
    expect(host.querySelector('[aria-label="Nível real do microfone"]')).toBeNull();
    expect(host.textContent).toContain('Imagem e áudio no iPhone'); expect(permissions).not.toHaveBeenCalled();
  });

  it('footer espera ACK USB mantendo input anterior e reserva REC, inclusive se controller continua ready', async () => {
    await mountScenes(); const reply = deferred(); scenes.setSelection(reply); const startButton = button('Iniciar gravação')!;
    await selectMicrophone(studioRemoteMicrophoneId(usb.id));
    expect(scenes.controller.selectDevices).toHaveBeenCalledWith({ microphoneId: studioRemoteMicrophoneId(usb.id) });
    expect(base.controller.configureRemote).not.toHaveBeenCalled();
    expect(footer().value).toBe(studioRemoteMicrophoneId(null)); expect(footer().disabled).toBe(true);
    expect(button('Iniciar gravação')?.disabled).toBe(true);
    await act(async () => startButton.click()); expect(scenes.controller.start).not.toHaveBeenCalled();
    await act(async () => reply.resolve());
    expect(footer().value).toBe(studioRemoteMicrophoneId(usb.id)); expect(footer().disabled).toBe(false);
    expect(button('Iniciar gravação')?.disabled).toBe(false);
    expect(host.querySelector('.src-audio-heading')?.textContent).toContain(usb.name);
  });

  it('picker do medidor chama o wrapper com namespace, sem bypass direto para a câmera base', async () => {
    await mountScenes(); const reply = deferred(); scenes.setSelection(reply);
    await click('Selecionar microfone do iPhone');
    const choice = [...host.querySelectorAll<HTMLButtonElement>('.src-audio-option')].find(value => value.textContent?.includes(usb.name))!;
    await act(async () => choice.click());
    expect(scenes.controller.selectDevices).toHaveBeenCalledWith({ microphoneId: studioRemoteMicrophoneId(usb.id) });
    expect(base.controller.configureRemote).not.toHaveBeenCalled(); expect(footer().value).toBe(studioRemoteMicrophoneId(null));
    expect(button('Iniciar gravação')?.disabled).toBe(true);
    await act(async () => reply.resolve()); expect(footer().value).toBe(studioRemoteMicrophoneId(usb.id));
    expect(host.querySelector('.src-audio-heading')?.textContent).toContain(usb.name);
  });

  it('escolher computador troca para medidor local e legenda correta; Auto restaura narração do iPhone', async () => {
    await mountScenes(); await selectMicrophone(computerUSB.id);
    expect(scenes.controller.selectDevices).toHaveBeenLastCalledWith({ microphoneId: computerUSB.id });
    expect(footer().value).toBe(computerUSB.id); expect(host.querySelector('[aria-label="Selecionar microfone do iPhone"]')).toBeNull();
    expect(host.querySelector('[aria-label="Nível real do microfone"]')?.getAttribute('aria-valuenow')).toBe('-12');
    expect(host.textContent).toContain('Imagem do iPhone · áudio no computador');
    await selectMicrophone(studioRemoteMicrophoneId(null));
    expect(scenes.controller.selectDevices).toHaveBeenLastCalledWith({ microphoneId: studioRemoteMicrophoneId(null) });
    expect(footer().value).toBe(studioRemoteMicrophoneId(null)); expect(host.querySelector('[aria-label="Nível real do microfone"]')).toBeNull();
    expect(host.querySelector('[aria-label="Nível do microfone do iPhone"]')).toBeTruthy(); expect(host.textContent).toContain('Imagem e áudio no iPhone');
  });

  it('mute não publica níveis nativos como voz gravada e conserva seletor de fonte/inputs', async () => {
    await mountScenes(); await click('Desativar microfone');
    expect(scenes.controller.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(host.querySelector('[aria-label="Nível do microfone do iPhone"]')).toBeNull();
    expect(host.textContent).toContain('Microfone desativado'); expect(footer().disabled).toBe(false);
    expect(button('Selecionar microfone do iPhone')?.disabled).toBe(false);
    await click('Selecionar microfone do iPhone'); expect(host.querySelector('[role="dialog"][aria-label="Microfone do iPhone"]')).toBeTruthy();
    await click('Fechar seleção de microfone'); await click('Ativar microfone da gravação');
    expect(host.querySelector('[aria-label="Nível do microfone do iPhone"]')).toBeTruthy();
  });

  it('falha de confirmação conserva fonte anterior e erro útil sem abrir REC nem substituir input', async () => {
    await mountScenes(); const reply = deferred(); scenes.setSelection(reply);
    await selectMicrophone(studioRemoteMicrophoneId(usb.id));
    await act(async () => reply.reject(new Error('O iPhone não confirmou esse microfone USB.')));
    expect(footer().value).toBe(studioRemoteMicrophoneId(null)); expect(footer().disabled).toBe(false);
    expect(host.textContent).toContain('O iPhone não confirmou esse microfone USB.');
    expect(scenes.controller.start).not.toHaveBeenCalled(); expect(host.textContent).toContain('Imagem e áudio no iPhone');
  });

  it('REC impede mudança de narração pelo footer e picker, mantendo PCM real somente para monitoramento', async () => {
    await mountScenes(); await click('Selecionar microfone do iPhone');
    const oldChoice = [...host.querySelectorAll<HTMLButtonElement>('.src-audio-option')].find(value => value.textContent?.includes(usb.name))!;
    const selector = footer(), start = button('Iniciar gravação')!;
    // A source input queued before React paints REC must still consult the
    // synchronous capture phase, rather than authorizing the old ready UI.
    await act(async () => {
      start.click(); selector.value = computer.id; selector.dispatchEvent(new Event('change', { bubbles: true })); oldChoice.click();
    });
    expect(scenes.controller.start).toHaveBeenCalledTimes(1); expect(button('Encerrar gravação')).toBeTruthy();
    expect(footer()).toBeNull(); expect(button('Selecionar microfone do iPhone')?.disabled).toBe(true);
    expect(host.querySelector('[role="dialog"][aria-label="Microfone do iPhone"]')).toBeNull();
    expect(scenes.controller.selectDevices).not.toHaveBeenCalled(); expect(base.controller.configureRemote).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Nível do microfone do iPhone"]')?.getAttribute('aria-valuenow')).toBe('-27');
  });
});

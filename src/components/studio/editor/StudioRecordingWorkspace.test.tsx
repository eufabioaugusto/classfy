import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileStudioRecipe, emptyStudioEditing, withStudioTakes, type StudioKind, type StudioProject } from '../../../../shared/studio';
import { StudioRecordingWorkspace } from './StudioRecordingWorkspace';
import { initializeStudioExitGuard } from './useStudioExitGuard';
import type { StudioCaptureState } from '@/lib/studio/editor/capture';
import * as videoProcessing from '@/lib/studio/editor/captureVideo';
import * as remoteSceneRecovery from '@/lib/studio/editor/remoteSceneRecovery';
import type { StudioRemoteCaptureController, StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import { readStudioRecordingSelection, saveStudioRecordingSelection } from '@/lib/studio/editor/recordingSetupPreferences';

const io = vi.hoisted(() => ({ inspect: vi.fn(), create: vi.fn(), get: vi.fn(), save: vi.fn(), put: vi.fn(), asset: vi.fn() }));
const remoteIO = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/studio/editor/remoteCameraCapture', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/studio/editor/remoteCameraCapture')>();
  return { ...actual, createStudioRemoteCapture: (options: Parameters<typeof actual.createStudioRemoteCapture>[0]) => remoteIO.create(options) ?? actual.createStudioRemoteCapture(options) };
});
vi.mock('@/lib/studio/editor/media', () => ({ inspectStudioMedia: io.inspect }));
vi.mock('@/lib/studio/editor/storage', () => ({
  createProject: io.create, getProject: io.get, saveProject: io.save, putAsset: io.put, getAsset: io.asset,
  studioAssetUri: (owner: string, project: string, asset: string, name: string) => `file://classfy-studio/${[owner, project, asset, name].map(encodeURIComponent).join('/')}`,
}));

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Track extends EventTarget {
  id: string; label: string; readyState = 'live'; onended: null | (() => void) = null; onmute = null;
  enabled = true; muted = false;
  constructor(public kind = 'audio', public deviceId = kind === 'audio' ? 'usb-id' : 'camera-id', name?: string) { super(); this.id = `${kind}-${deviceId}`; this.label = name ?? (kind === 'audio' ? 'USB Microphone' : 'Camera autorizada'); }
  end() { this.readyState = 'ended'; this.onended?.(); this.dispatchEvent(new Event('ended')); }
  stop = vi.fn(() => { this.readyState = 'ended'; }); getSettings() { return { deviceId: this.deviceId, width: 1920, height: 1080, frameRate: 30 }; }
}
class Stream {
  constructor(public tracks = [new Track()]) {} getTracks() { return this.tracks; } getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); } getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
}
class Recorder {
  static instances: Recorder[] = []; static isTypeSupported() { return true; }
  state = 'inactive'; mimeType: string; ondataavailable: null | ((e: { data: Blob }) => void) = null; onstop: null | (() => void) = null; onerror = null;
  constructor(public stream: Stream, options: { mimeType: string }) { this.mimeType = options.mimeType; Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop = vi.fn(() => { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['encoded-original'], { type: this.mimeType }) }); this.onstop?.(); }); });
}
class Audio {
  resume = vi.fn(async () => {}); close = vi.fn(async () => {}); createMediaStreamSource() { return { connect: vi.fn() }; }
  createMediaStreamDestination() { return { stream: new Stream([new Track('audio', 'program-audio', 'Mixagem autorizada')]) }; }
  createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(samples: Float32Array) { samples.fill(.5); } }; }
}
class Recognition {
  static instances: Recognition[] = [];
  onstart: null | (() => void) = null; onresult: null | ((event: unknown) => void) = null;
  onerror: null | ((event: { error: string }) => void) = null; onend: null | (() => void) = null;
  constructor() { Recognition.instances.push(this); }
  start = vi.fn((_track?: MediaStreamTrack) => { queueMicrotask(() => this.onstart?.()); }); abort = vi.fn();
}
function speechBoundary() {
  Recognition.instances = []; vi.stubGlobal('SpeechRecognition', Recognition); vi.stubGlobal('webkitSpeechRecognition', undefined);
  vi.stubGlobal('isSecureContext', true);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36');
}
function fixture(owner = 'owner', id = 'project', kind: StudioKind = 'aula', title = 'Aula local'): StudioProject {
  return withStudioTakes({ version: 2, id, ownerId: owner, kind, title, description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0', editing: emptyStudioEditing(kind), revision: 0, state: 'draft', progress: 0, createdAt: '2026-10-11', updatedAt: '2026-10-11' });
}
const projects = new Map<string, StudioProject>(), assets = new Map<string, Blob>();
const key = (...parts: string[]) => parts.join('/');
let root: Root, host: HTMLDivElement, owner = 'owner', initialKind: StudioKind = 'aula', title = '', permissions: ReturnType<typeof vi.fn>;
let added: ReturnType<typeof vi.spyOn>, removed: ReturnType<typeof vi.spyOn>;
function Screen() {
  const location = useLocation(), id = new URLSearchParams(location.search).get('project') ?? undefined;
  return <><output data-location>{location.pathname}{location.search}</output><output data-live-title>{location.state?.studioRecordingTitle}</output>{location.pathname === '/studio/record' ? <StudioRecordingWorkspace owner={owner} initialKind={initialKind} initialTitle={title} projectId={id} /> : <p>Destino alcançado</p>}</>;
}
async function mount(url = '/studio/record', browser = false) {
  await act(async () => root.render(<StrictMode>{browser ? <BrowserRouter><Screen /></BrowserRouter> : <MemoryRouter initialEntries={[url]}><Screen /></MemoryRouter>}</StrictMode>));
}
// Preparing a take enters the production stage first; only its REC action starts capture.
function button(label: string) {
  const setup = host.querySelector('.se-recording')?.getAttribute('data-stage') === 'setup';
  const labels = [label, ...(setup ? ['Abrir câmera', 'Preparar câmera e tela'].includes(label) ? ['Ativar câmera'] : [] : [])];
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => labels.includes(item.getAttribute('aria-label') ?? '') || labels.includes(item.textContent?.trim() ?? ''));
}
async function click(label: string) { const target = button(label); expect(target, label).toBeTruthy(); await act(async () => target!.click()); }
async function enterProduction() { if (host.querySelector('.se-recording')?.getAttribute('data-stage') === 'setup') await click('Ir para gravação'); }
async function startTake() { await enterProduction(); await click('Iniciar gravação'); }
const confirmation = () => document.querySelector('[role="alertdialog"]');
async function answer(label: string) {
  expect(confirmation(), 'Confirmação visual aberta').toBeTruthy();
  const target = [...confirmation()!.querySelectorAll('button')].find(value => value.textContent?.trim() === label);
  expect(target, `Resposta do diálogo: ${label}`).toBeTruthy(); await act(async () => target!.click());
}
const formatButton = (label: string) => button(label);
async function format(label: string) { const target = formatButton(label); expect(target).toBeTruthy(); await act(async () => target!.click()); }
async function select(label: string, id: string) {
  const target = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  expect(target).toBeTruthy(); await act(async () => { target.value = id; target.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function toggle(label: string) {
  const input = [...host.querySelectorAll('label')].find(value => value.textContent?.trim() === label)?.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(input, label).toBeTruthy(); await act(async () => input.click()); return input;
}
async function input(label: string, value: string) {
  const element = host.querySelector(`input[aria-label="${label}"],textarea[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement;
  expect(element, label).toBeTruthy(); const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); return element;
}
async function visibility(value: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
}
const activeVisibility = () => {
  const listeners = new Set(added.mock.calls.filter(([name]) => name === 'visibilitychange').map(([, listener]) => listener));
  removed.mock.calls.filter(([name]) => name === 'visibilitychange').forEach(([, listener]) => listeners.delete(listener)); return listeners.size;
};
async function record() { await click(initialKind === 'podcast' ? 'Ativar microfone' : 'Abrir câmera'); await startTake(); await click('Encerrar gravação'); }
async function pop(index: number, url: string) { window.history.replaceState({ idx: index, key: `entry-${index}` }, '', url); await act(async () => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))); }
beforeEach(() => {
  localStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  projects.clear(); assets.clear(); Recorder.instances = []; owner = 'owner'; initialKind = 'aula'; title = '';
  remoteIO.create.mockReset();
  io.create.mockReset().mockImplementation(async (account: string, kind: StudioKind, name: string) => { const value = fixture(account, crypto.randomUUID(), kind, name); projects.set(key(account, value.id), value); return value; });
  io.get.mockReset().mockImplementation(async (account: string, id: string) => projects.get(key(account, id)) ?? null);
  io.save.mockReset().mockImplementation(async (account: string, value: StudioProject) => { const saved = withStudioTakes({ ...value, editing: value.editing!, revision: value.revision + 1 }); projects.set(key(account, value.id), saved); return saved; });
  io.put.mockReset().mockImplementation(async (account: string, id: string, asset: string, blob: Blob) => { assets.set(key(account, id, asset), blob); });
  io.asset.mockReset().mockImplementation(async (account: string, id: string, asset: string) => assets.get(key(account, id, asset)) ?? null);
  io.inspect.mockReset().mockImplementation(async (file: File) => ({ kind: file.type.startsWith('audio/') ? 'audio' : 'video', duration: 2, hasAudio: true, width: 1920, height: 1080, frameRate: 30, mimeType: file.type, thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }), warnings: [] }));
  const deviceId = (value: boolean | MediaTrackConstraints | undefined) => typeof value === 'object' && typeof value.deviceId === 'object' && 'exact' in value.deviceId ? String(value.deviceId.exact) : undefined;
  permissions = vi.fn(async (options: MediaStreamConstraints) => new Stream([
    ...(options.video ? [new Track('video', deviceId(options.video) ?? 'camera-id', deviceId(options.video) === 'continuity-id' ? 'iPhone de Fabio' : undefined)] : []),
    ...(options.audio ? [new Track('audio', deviceId(options.audio) ?? 'usb-id', deviceId(options.audio) === 'external-mic' ? 'Microfone externo' : undefined)] : []),
  ]));
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: permissions, enumerateDevices: vi.fn(async () => [
    { deviceId: 'camera-id', kind: 'videoinput', label: 'Camera autorizada' }, { deviceId: 'continuity-id', kind: 'videoinput', label: 'iPhone de Fabio' },
    { deviceId: 'usb-id', kind: 'audioinput', label: 'USB Microphone' }, { deviceId: 'external-mic', kind: 'audioinput', label: 'Microfone externo' },
  ]) }, configurable: true });
  vi.stubGlobal('MediaRecorder', Recorder); vi.stubGlobal('MediaStream', Stream); vi.stubGlobal('AudioContext', Audio);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => `blob:owned-${crypto.randomUUID()}`), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  added = vi.spyOn(document, 'addEventListener'); removed = vi.spyOn(document, 'removeEventListener');
  initializeStudioExitGuard(); window.history.replaceState({ idx: 1, key: 'record' }, '', '/studio/record');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('funil de gravação com componente, captura e sessão reais', () => {
  it('STOP local mantém câmera, novo REC sobrevive ao recebimento anterior e AirDrop adiciona outro take sem substituir', async () => {
    const firstId = '50000000-0000-4000-8000-000000000001', secondId = '50000000-0000-4000-8000-000000000002';
    const file = new File(['phone-original'], 'iPhone.mp4', { type: 'video/mp4' }), receiving = deferred<any>();
    const raw = { bytes: file.size, mime: file.type, width: 1920, height: 1080, fps: 30, duration: 2 };
    const stream = new Stream([new Track('video', 'remote-camera', 'Câmera remota')]) as unknown as MediaStream;
    const cancel = vi.fn(), legacyStop = vi.fn(), finish = vi.fn(), receive = vi.fn(), start = vi.fn();
    let activeTake: string | null = null, count = 0;
    remoteIO.create.mockImplementation(() => {
      const listeners = new Set<(state: StudioCaptureState) => void>(), remoteListeners = new Set<(state: StudioRemoteView) => void>();
      let state: StudioCaptureState = { phase: 'idle', stream: null, file: null, error: null, elapsed: 0, input: null, camera: null, devices: { cameras: [], microphones: [] }, levels: [], microphoneEnabled: true };
      const device = { capabilities: { localTakeStorage: 1 }, localTakes: [] as any[], width: 1920, height: 1080, fps: 30 };
      let remote: StudioRemoteView = { pairing: null, connection: 'connected', session: { id: 'remote-session', deviceId: 'iphone', configuration: { resolution: '1080p', fps: 30, cameraFacing: 'back' }, deviceState: device, status: 'ready' } as any, transfer: 'idle', pendingTakeId: null, error: null, localFirst: true, localTakes: [] };
      const publish = (patch: Partial<StudioCaptureState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener(state)); };
      const transfer = (patch: Partial<StudioRemoteView>) => { remote = { ...remote, ...patch }; remoteListeners.forEach(listener => listener(remote)); };
      start.mockImplementation(() => { activeTake = ++count === 1 ? firstId : secondId; transfer({ pendingTakeId: activeTake }); publish({ phase: 'recording' }); });
      finish.mockImplementation(async () => {
        const row = { id: activeTake!, metadata: raw, sourceMetadata: raw, phase: 'local_ready' as const, localSaved: true }; device.localTakes.push(row);
        transfer({ pendingTakeId: null, localTakes: [...device.localTakes] }); publish({ phase: 'ready', pendingRecovery: false, file: null }); activeTake = null; return row;
      });
      receive.mockImplementation(async () => { transfer({ transfer: 'uploading', transferTakeId: firstId }); const master = await receiving.promise; transfer({ transfer: 'complete' }); return master; });
      return { subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); }, subscribeRemote(listener) { remoteListeners.add(listener); listener(remote); return () => remoteListeners.delete(listener); },
        prepare: async () => publish({ phase: 'ready', stream, width: 1920, height: 1080, frameRate: 30 }), start, stop: legacyStop, finishLocalTake: finish, receiveRemoteTake: receive,
        getEnvelope: () => ({ session: remote.session, takes: [], commands: [], serverAt: '' }), getMicrophoneTrack: () => null, cancel, discardRemoteRecovery() {}, dispose() { listeners.clear(); remoteListeners.clear(); } } as unknown as StudioRemoteCaptureController;
    });
    function Route() { const location = useLocation(); return <StudioRecordingWorkspace owner={owner} projectId={new URLSearchParams(location.search).get('project') ?? undefined} canUseScenes />; }
    await act(async () => root.render(<MemoryRouter><Route /></MemoryRouter>));
    await click('Meu iPhone · Premium'); await click('Conectar meu iPhone'); await startTake(); await click('Encerrar gravação');
    expect(finish).toHaveBeenCalledOnce(); expect(legacyStop).not.toHaveBeenCalled(); expect(receive).not.toHaveBeenCalled(); expect(io.put).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Salvo no iPhone'); expect(button('Iniciar gravação')?.disabled).toBe(false);
    await click('Enviar ao computador'); await click('Iniciar gravação'); expect(activeTake).toBe(secondId);
    const cancelsBefore = cancel.mock.calls.length, sourcesBefore = remoteIO.create.mock.calls.length;
    await act(async () => receiving.resolve({ file, take: { id: firstId }, metadata: raw, session: remoteIO.create.mock.results.at(-1)!.value.getEnvelope().session }));
    expect(host.querySelector('[aria-label="Gravação em andamento"]')).toBeTruthy(); expect(activeTake).toBe(secondId);
    expect(cancel).toHaveBeenCalledTimes(cancelsBefore); expect(remoteIO.create).toHaveBeenCalledTimes(sourcesBefore); expect(host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')?.srcObject).toBe(stream);
    expect(io.put.mock.calls.find(call => call[2] === `remote-${firstId}`)?.[3]).toBe(file); expect(host.querySelectorAll('.se-recording-recovery')).toHaveLength(0);
    await click('Encerrar gravação'); expect(finish).toHaveBeenCalledTimes(2); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1);
    // A graded archived receipt has other final bytes; AirDrop still carries raw.
    const previousDevice = remoteIO.create.mock.results.at(-1)!.value.getEnvelope().session.deviceState;
    const archived = previousDevice.localTakes.pop(); archived.metadata = { ...raw, bytes: raw.bytes + 1000 }; archived.sessionId = 'archived-session';
    await click('Importar original recebido do take 2');
    const importInput = host.querySelector<HTMLInputElement>('input[type="file"]')!, secondFile = new File(['other-original'], 'AirDrop.mov', { type: 'video/quicktime' });
    expect(secondFile.size).toBe(file.size);
    await act(async () => { Object.defineProperty(importInput, 'files', { configurable: true, value: [secondFile] }); importInput.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.querySelectorAll('.se-recording-take')).toHaveLength(2); expect(io.put.mock.calls.find(call => call[2] === `remote-${secondId}`)?.[3]).toBe(secondFile);
    expect(assets.get(key(owner, [...projects.values()][0].id, `remote-${firstId}`))).toBe(file); expect(permissions).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0); expect(button('Iniciar gravação')?.disabled).toBe(false);
    await click('Importar original recebido'); const writes = io.put.mock.calls.length;
    owner = 'different-owner'; await act(async () => root.render(<MemoryRouter><Route /></MemoryRouter>));
    await act(async () => { Object.defineProperty(importInput, 'files', { configurable: true, value: [secondFile] }); importInput.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(io.put).toHaveBeenCalledTimes(writes);
  });
  it.each(['save', 'discard'] as const)('take pendente restaurado na preparação oferece %s sem REC e sai do bloqueio de conexão', async action => {
    const start = vi.fn(), discardRecovery = vi.fn(), file = new File(['uploaded-original'], 'iPhone.mp4', { type: 'video/mp4' });
    remoteIO.create.mockImplementation(() => {
      const listeners = new Set<(state: StudioCaptureState) => void>(), remoteListeners = new Set<(state: StudioRemoteView) => void>();
      let state: StudioCaptureState = { phase: 'idle', stream: null, file: null, error: null, elapsed: 0, input: null, camera: null, devices: { cameras: [], microphones: [] }, levels: [], microphoneEnabled: true };
      const publish = (patch: Partial<StudioCaptureState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener(state)); };
      return {
        subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
        subscribeRemote(listener) { remoteListeners.add(listener); return () => remoteListeners.delete(listener); },
        async prepare() {
          remoteListeners.forEach(listener => listener({ pairing: null, session: null, connection: 'connected', transfer: 'retry', pendingTakeId: '50000000-0000-4000-8000-000000000001', error: null }));
          publish({ phase: 'error', pendingRecovery: true, error: 'Seu original está disponível. Salve ou descarte para continuar.' });
        },
        async stop() { return file; }, start, discardRemoteRecovery: discardRecovery,
        cancel() { publish({ phase: 'idle', pendingRecovery: false, stream: null, file: null, error: null }); },
        dispose() { listeners.clear(); remoteListeners.clear(); }, getMicrophoneTrack() { return null; },
      } as unknown as StudioRemoteCaptureController;
    });
    await act(async () => root.render(<MemoryRouter><StudioRecordingWorkspace owner={owner} canUseScenes /></MemoryRouter>));
    await click('Meu iPhone · Premium'); await click('Conectar meu iPhone');
    expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('production'); expect(host.querySelector('.se-recording-recovery')).toBeTruthy();
    expect(button('Retomar transferência')?.disabled).toBe(false); expect(button('Descartar trecho')?.disabled).toBe(false); expect(start).not.toHaveBeenCalled();
    if (action === 'save') { await click('Retomar transferência'); expect(io.put.mock.calls[0][3]).toBe(file); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1); }
    else {
      await click('Descartar trecho'); expect(discardRecovery).not.toHaveBeenCalled(); await answer('Descartar trecho');
      expect(discardRecovery).toHaveBeenCalledTimes(1); expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('setup');
      expect(button('Conectar meu iPhone')?.disabled).toBe(false); expect(io.put).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled();
    }
    expect(start).not.toHaveBeenCalled(); expect(permissions).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
  });
  it('reload do mesmo projeto restaura iPhone no preparo, mas conecta somente por clique e nunca inicia REC', async () => {
    const project = fixture(); projects.set(key(owner, project.id), project);
    saveStudioRecordingSelection(owner, { kind: 'aula', mode: 'remote', remoteScenes: false }, project.id);
    const prepare = vi.fn(), start = vi.fn();
    remoteIO.create.mockImplementation(() => {
      const listeners = new Set<(state: StudioCaptureState) => void>();
      const idle: StudioCaptureState = { phase: 'idle', stream: null, elapsed: 0, file: null, error: null, input: null, levels: [], camera: null, devices: { cameras: [], microphones: [] }, microphoneEnabled: true };
      prepare.mockImplementation(async () => listeners.forEach(listener => listener({ ...idle, phase: 'ready', stream: new Stream([new Track('video')]) as unknown as MediaStream })));
      return { subscribe(listener) { listeners.add(listener); listener(idle); return () => listeners.delete(listener); }, subscribeRemote() { return () => undefined; }, prepare, start, cancel() {}, dispose() { listeners.clear(); }, getMicrophoneTrack() { return null; } } as unknown as StudioRemoteCaptureController;
    });
    await act(async () => root.render(<StrictMode><MemoryRouter><StudioRecordingWorkspace owner={owner} projectId={project.id} canUseScenes /></MemoryRouter></StrictMode>));
    expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('setup'); expect(button('Conectar meu iPhone')).toBeTruthy();
    expect(prepare).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(permissions).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
    await click('Conectar meu iPhone'); expect(prepare).toHaveBeenCalledTimes(1); expect(start).not.toHaveBeenCalled();
    await enterProduction(); expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('production'); expect(button('Iniciar gravação')).toBeTruthy();
    expect(start).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled(); expect(io.put).not.toHaveBeenCalled();
  });
  it('projeto não herda iPhone da preferência global, de outro projeto ou de outra conta', async () => {
    const project = fixture(); projects.set(key(owner, project.id), project);
    const remote = { kind: 'aula' as const, mode: 'remote' as const, remoteScenes: false };
    saveStudioRecordingSelection(owner, remote); saveStudioRecordingSelection(owner, remote, 'other-project'); saveStudioRecordingSelection('other-owner', remote, project.id);
    await act(async () => root.render(<MemoryRouter><StudioRecordingWorkspace owner={owner} projectId={project.id} canUseScenes /></MemoryRouter>));
    expect(button('Ativar câmera')).toBeTruthy(); expect(button('Conectar meu iPhone')).toBeUndefined(); expect(remoteIO.create).not.toHaveBeenCalled(); expect(permissions).not.toHaveBeenCalled();
    await click('Meu iPhone · Premium');
    expect(readStudioRecordingSelection(owner, true, true, project.id)).toEqual(remote); expect(permissions).not.toHaveBeenCalled();
  });
  it('restaurar origem remota aguarda Premium da mesma conta e continua exigindo ativação explícita', async () => {
    const project = fixture(); projects.set(key(owner, project.id), project);
    saveStudioRecordingSelection(owner, { kind: 'aula', mode: 'remote', remoteScenes: false }, project.id);
    await act(async () => root.render(<MemoryRouter><StudioRecordingWorkspace owner={owner} projectId={project.id} premiumLoading /></MemoryRouter>));
    expect(remoteIO.create).not.toHaveBeenCalled(); expect(button('Confirmando seu plano…')?.disabled).toBe(true);
    await click('Confirmando seu plano…'); expect(permissions).not.toHaveBeenCalled(); expect(readStudioRecordingSelection(owner, true, true, project.id)?.mode).toBe('remote');
    await act(async () => root.render(<MemoryRouter><StudioRecordingWorkspace owner={owner} projectId={project.id} canUseScenes /></MemoryRouter>));
    expect(button('Conectar meu iPhone')).toBeTruthy(); expect(host.querySelector('.src-pairing')).toBeNull(); expect(permissions).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
  });
  it('a prévia usa a câmera real na preparação, sem gravador ou rascunho, e REC reutiliza a mesma fonte', async () => {
    await mount();
    expect(host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')?.srcObject ?? null).toBeNull();
    expect(permissions).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0); expect(io.create).not.toHaveBeenCalled();
    await click('Ativar câmera');
    const stream = await permissions.mock.results[0].value as Stream;
    const preview = host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]');
    expect((preview?.srcObject as MediaStream | null)?.getTracks()).toEqual(stream.getTracks()); expect(stream.getVideoTracks()[0].readyState).toBe('live');
    const prepared = preview!.srcObject;
    expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('setup');
    expect(button('Ir para gravação')?.disabled).toBe(false); expect(Recorder.instances).toHaveLength(0); expect(io.create).not.toHaveBeenCalled(); expect(io.put).not.toHaveBeenCalled();
    expect(button('Iniciar gravação')).toBeUndefined();
    await click('Ir para gravação');
    expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('production');
    expect(host.querySelector('aside[aria-label="Configurações da gravação"]')).toBeTruthy();
    expect(host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')?.srcObject).toBe(prepared);
    expect(Recorder.instances).toHaveLength(0); expect(io.create).not.toHaveBeenCalled(); expect(io.put).not.toHaveBeenCalled();
    expect(permissions).toHaveBeenCalledTimes(1); expect(stream.getTracks().every(track => track.stop.mock.calls.length === 0)).toBe(true);
    await click('Iniciar gravação');
    expect(Recorder.instances).toHaveLength(1); expect(Recorder.instances[0].stream).toBe(prepared); expect(permissions).toHaveBeenCalledTimes(1);
    expect(stream.getTracks().every(track => track.stop.mock.calls.length === 0)).toBe(true);
    expect(io.create).not.toHaveBeenCalled(); await click('Encerrar gravação'); expect(io.create).toHaveBeenCalledTimes(1);
    expect(readStudioRecordingSelection(owner, true, true, [...projects.values()][0].id)).toEqual({ kind: 'aula', mode: 'camera', remoteScenes: false });
  });

  it('Aula e Short mudam o enquadramento da prévia preparada sem reabrir a câmera', async () => {
    // Canvas output is a browser/GPU boundary; the capture/controller/session remain real.
    vi.stubGlobal('HTMLCanvasElement', class { captureStream() { return new Stream([]); } });
    const processor = vi.spyOn(videoProcessing, 'createStudioCaptureVideoProcessor').mockImplementation((_track, _grade, _zoom, _error, output) => {
      if (!output) return null;
      const track = new Track('video', `processed-${output.width}-${output.height}`, 'Enquadramento processado');
      return { stream: new Stream([track]), effects: true, profile: output, prepare: vi.fn(async () => {}), configure: vi.fn(), setVisible: vi.fn(), dispose: vi.fn() } as unknown as videoProcessing.StudioCaptureVideoProcessor;
    });
    await mount(); await click('Ativar câmera');
    const stream = await permissions.mock.results[0].value as Stream, track = stream.getVideoTracks()[0];
    for (const label of ['Short', 'Aula', 'Short']) {
      await format(label); expect(formatButton(label)?.getAttribute('aria-pressed')).toBe('true');
      expect((host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')?.srcObject as MediaStream | null)?.getVideoTracks()[0].readyState).toBe('live');
      expect(processor).toHaveBeenLastCalledWith(track, expect.anything(), expect.any(Number), expect.any(Function), expect.objectContaining(label === 'Short' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }));
      expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('setup');
      expect(permissions).toHaveBeenCalledTimes(1); expect(track.stop).not.toHaveBeenCalled(); expect(button('Ir para gravação')?.disabled).toBe(false);
    }
    expect(Recorder.instances).toHaveLength(0); expect(io.create).not.toHaveBeenCalled();
    const prepared = host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')!.srcObject;
    await input('Nome da gravação', 'Short nomeado depois da prévia'); await click('Ir para gravação'); await click('Iniciar gravação'); await click('Encerrar gravação');
    expect([...projects.values()][0]).toMatchObject({ kind: 'short', title: 'Short nomeado depois da prévia' });
    expect(permissions).toHaveBeenCalledTimes(1); expect(Recorder.instances[0].stream).toBe(prepared);
  });

  it('trocar o conteúdo da cena encerra a fonte anterior e aguarda nova ativação explícita', async () => {
    const display = vi.fn(async () => new Stream([new Track('video', 'display', 'Janela compartilhada')]));
    Object.assign(navigator.mediaDevices, { getDisplayMedia: display });
    await mount(); await click('Ativar câmera');
    const camera = await permissions.mock.results[0].value as Stream;
    await click('Só tela');
    expect(camera.getTracks().every(track => track.stop.mock.calls.length === 1)).toBe(true);
    expect(host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')?.srcObject ?? null).toBeNull();
    expect(display).not.toHaveBeenCalled(); expect(permissions).toHaveBeenCalledTimes(1); expect(button('Ir para gravação')).toBeUndefined();
    await click('Compartilhar tela'); expect(display).toHaveBeenCalledTimes(1); expect(button('Ir para gravação')?.disabled).toBe(false);
    const screen = await display.mock.results[0].value as Stream;
    await format('Podcast');
    expect(screen.getTracks().every(track => track.stop.mock.calls.length === 1)).toBe(true);
    expect(host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')?.srcObject ?? null).toBeNull(); expect(button('Ativar microfone')).toBeTruthy();
    expect(button('Ir para gravação')).toBeUndefined(); expect(permissions).toHaveBeenCalledTimes(2); expect(Recorder.instances).toHaveLength(0); expect(io.create).not.toHaveBeenCalled();
  });

  it('cancelar a abertura libera uma permissão tardia e mantém a preparação pronta para novo gesto', async () => {
    const permission = deferred<Stream>(); permissions.mockReturnValueOnce(permission.promise);
    await mount(); await click('Ativar câmera'); expect(button('Cancelar')).toBeTruthy(); expect(button('Ir para gravação')).toBeUndefined();
    await click('Cancelar'); expect(button('Ativar câmera')?.disabled).toBe(false);
    const stale = new Stream([new Track('video'), new Track()]); await act(async () => permission.resolve(stale));
    expect(stale.getTracks().every(track => track.stop.mock.calls.length === 1)).toBe(true);
    expect(host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')?.srcObject ?? null).toBeNull(); expect(button('Ir para gravação')).toBeUndefined();
    expect(io.create).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
    await click('Ativar câmera'); expect(permissions).toHaveBeenCalledTimes(2); expect(button('Ir para gravação')?.disabled).toBe(false);
  });

  it('cancelar um reenquadramento em andamento não instala frames nem erros atrasados na nova preparação', async () => {
    const processing = deferred<void>(), output = new Track('video', 'cancelled-output', 'Enquadramento cancelado');
    vi.stubGlobal('HTMLCanvasElement', class { captureStream() { return new Stream([]); } });
    vi.spyOn(videoProcessing, 'createStudioCaptureVideoProcessor').mockImplementation((_track, _grade, _zoom, _error, profile) => profile ? {
      stream: new Stream([output]), effects: true, profile, prepare: () => processing.promise, configure: vi.fn(), setVisible: vi.fn(), dispose: vi.fn(),
    } as unknown as videoProcessing.StudioCaptureVideoProcessor : null);
    await mount(); await click('Ativar câmera'); const camera = await permissions.mock.results[0].value as Stream;
    await format('Short'); expect(button('Cancelar')).toBeTruthy(); expect(button('Ir para gravação')).toBeUndefined();
    await click('Cancelar'); expect(camera.getTracks().every(track => track.stop.mock.calls.length === 1)).toBe(true);
    await act(async () => processing.resolve());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')?.srcObject ?? null).toBeNull();
    expect(formatButton('Aula')?.getAttribute('aria-pressed')).toBe('true'); expect(formatButton('Short')?.getAttribute('aria-pressed')).toBe('false');
    expect(button('Ativar câmera')?.disabled).toBe(false); expect(output.stop).toHaveBeenCalledTimes(1);
    expect(io.create).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
    await click('Ativar câmera'); expect(permissions).toHaveBeenCalledTimes(2); expect(button('Ir para gravação')?.disabled).toBe(false);
  });

  it('perda da câmera durante a preparação impede REC até reativar a fonte', async () => {
    await mount(); await click('Ativar câmera'); const stream = await permissions.mock.results[0].value as Stream;
    await act(async () => stream.getVideoTracks()[0].end());
    expect(!button('Ir para gravação') || button('Ir para gravação')!.disabled).toBe(true);
    expect(Recorder.instances).toHaveLength(0); expect(io.create).not.toHaveBeenCalled(); expect(permissions).toHaveBeenCalledTimes(1);
  });

  it('recuperar um Short na preparação de Aula grava o próximo take no enquadramento do original recuperado', async () => {
    const file = new File(['recovered-portrait-master'], 'Short recuperado.mp4', { type: 'video/mp4' });
    const entry = { key: 'owner:short-recovery', owner: 'owner', takeId: '60000000-0000-4000-8000-000000000001', title: 'Short preservado', createdAt: Date.now(), output: { width: 1080, height: 1920, frameRate: 30 }, outputFile: file,
      session: { kind: 'short', projectId: null, title: 'Short preservado' },
    } as unknown as remoteSceneRecovery.StudioRemoteSceneRecovery;
    vi.stubGlobal('indexedDB', {});
    vi.spyOn(remoteSceneRecovery, 'createStudioRemoteSceneStore').mockReturnValue({ save: vi.fn(async () => {}), get: vi.fn(async () => entry), list: vi.fn(async () => [entry]) });
    const recover = vi.spyOn(remoteSceneRecovery, 'recoverStudioRemoteScene').mockResolvedValue(file);
    vi.stubGlobal('HTMLCanvasElement', class { captureStream() { return new Stream([]); } });
    const processor = vi.spyOn(videoProcessing, 'createStudioCaptureVideoProcessor').mockImplementation((_track, _grade, _zoom, _error, output) => output ? {
      stream: new Stream([new Track('video', 'portrait-output', 'Short processado')]), effects: true, profile: output, prepare: vi.fn(async () => {}), configure: vi.fn(), setVisible: vi.fn(), dispose: vi.fn(),
    } as unknown as videoProcessing.StudioCaptureVideoProcessor : null);
    await mount(); await click('Ativar câmera'); const original = await permissions.mock.results[0].value as Stream;
    await click('Adicionar take pronto');
    expect(recover).toHaveBeenCalledWith('owner', entry.key, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect([...projects.values()][0]).toMatchObject({ kind: 'short', title: entry.title }); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1);
    expect(original.getTracks().every(track => track.stop.mock.calls.length === 1)).toBe(true); expect(Recorder.instances).toHaveLength(0);
    expect(io.put.mock.calls[0][3]).toBe(file);
    await click('Gravar outro take');
    expect(processor).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.any(Number), expect.any(Function), expect.objectContaining({ width: 1080, height: 1920 }));
    expect(permissions).toHaveBeenCalledTimes(2); const preview = host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')!.srcObject;
    await startTake(); expect(Recorder.instances[0].stream).toBe(preview); await click('Encerrar gravação');
    expect([...projects.values()][0].takes).toHaveLength(2); expect([...projects.values()][0].kind).toBe('short'); expect(io.create).toHaveBeenCalledTimes(1);
  });

  it('recuperação de outro formato concluída após trocar owner não reinicia a câmera da nova conta', async () => {
    const file = new File(['recovered-original'], 'Short preservado.mp4', { type: 'video/mp4' });
    const entry = { key: 'owner:delayed-short-recovery', owner: 'owner', takeId: '60000000-0000-4000-8000-000000000002', title: 'Short preservado', createdAt: Date.now(), output: { width: 1080, height: 1920, frameRate: 30 }, outputFile: file,
      session: { kind: 'short', projectId: null, title: 'Short preservado' },
    } as unknown as remoteSceneRecovery.StudioRemoteSceneRecovery;
    vi.stubGlobal('indexedDB', {});
    vi.spyOn(remoteSceneRecovery, 'createStudioRemoteSceneStore').mockReturnValue({ save: vi.fn(async () => {}), get: vi.fn(async () => entry), list: vi.fn(async account => account === 'owner' ? [entry] : []) });
    vi.spyOn(remoteSceneRecovery, 'recoverStudioRemoteScene').mockResolvedValue(file);
    const held = deferred<void>(), originalSave = io.save.getMockImplementation()!;
    io.save.mockImplementationOnce(async (...args) => { await held.promise; return originalSave(...args); });
    await mount(); await click('Adicionar take pronto'); expect(io.save).toHaveBeenCalledTimes(1);
    owner = 'other'; await mount(); await click('Ativar câmera');
    const preview = host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')!.srcObject as unknown as Stream;
    await act(async () => held.resolve());
    expect(host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')!.srcObject).toBe(preview);
    expect(preview.getTracks().every(track => track.stop.mock.calls.length === 0)).toBe(true);
    expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('setup'); expect(formatButton('Aula')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Ir para gravação')?.disabled).toBe(false); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(0);
    expect(Recorder.instances).toHaveLength(0); expect(permissions).toHaveBeenCalledTimes(1);
  });

  it('trocar formato e layout permite voltar sem pedir permissão, iniciar REC ou criar rascunho', async () => {
    await mount();
    for (const label of ['Short', 'Podcast', 'Live', 'Aula']) {
      await format(label); expect(formatButton(label)?.getAttribute('aria-pressed')).toBe('true');
      expect(permissions).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
    }
    await click('Só tela'); expect(button('Só tela')?.getAttribute('aria-pressed')).toBe('true'); expect(button('Compartilhar tela')).toBeTruthy();
    await click('Só câmera'); expect(button('Abrir câmera')).toBeTruthy();
    await click('Voltar aos projetos');
    expect(confirmation()).toBeNull(); expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/projects');
    expect(permissions).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled(); expect(io.put).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled();
  });

  it('Podcast esconde escolhas de vídeo e volta à câmera simples quando Aula é escolhida', async () => {
    await mount(); await click('Só tela'); await format('Podcast');
    expect(button('Ativar microfone')).toBeTruthy();
    for (const label of ['Só câmera', 'Só tela', 'Câmera e tela · Premium', 'Computador', 'Meu iPhone · Premium']) expect(button(label), label).toBeUndefined();
    expect(host.querySelector('[aria-label="Nome da gravação"]')).toBeTruthy();
    await format('Aula'); expect(button('Só câmera')?.getAttribute('aria-pressed')).toBe('true'); expect(button('Computador')?.getAttribute('aria-pressed')).toBe('true'); expect(button('Abrir câmera')).toBeTruthy();
    expect(permissions).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled();
  });

  it('expiração Premium na preparação permite sair de iPhone com cenas pelas escolhas gratuitas sem abrir upgrade', async () => {
    for (const name of ['MediaStreamTrackProcessor', 'MediaStreamTrackGenerator', 'Worker', 'OffscreenCanvas', 'VideoFrame']) vi.stubGlobal(name, class {});
    const upgradeScenes = vi.fn(), upgradeRemote = vi.fn();
    const render = async (premium: boolean) => act(async () => root.render(<MemoryRouter initialEntries={['/studio/record']}><StudioRecordingWorkspace owner="owner" canUseScenes={premium} onUpgradeScenes={upgradeScenes} onUpgradeRemote={upgradeRemote} /></MemoryRouter>));
    for (const freeChoice of ['Só câmera', 'Computador']) {
      await render(true); await click('Meu iPhone · Premium'); await click('Câmera e tela · Premium');
      expect(button('Meu iPhone · Premium')?.getAttribute('aria-pressed')).toBe('true'); expect(button('Câmera e tela · Premium')?.getAttribute('aria-pressed')).toBe('true');
      await render(false); await click(freeChoice);
      expect(button('Só câmera')?.getAttribute('aria-pressed')).toBe('true'); expect(button('Computador')?.getAttribute('aria-pressed')).toBe('true'); expect(button('Abrir câmera')).toBeTruthy();
      expect(upgradeScenes).not.toHaveBeenCalled(); expect(upgradeRemote).not.toHaveBeenCalled();
    }
    expect(permissions).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled(); expect(io.put).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
  });

  it.each([['aula', 'Aula'], ['short', 'Short'], ['podcast', 'Podcast']] as const)('projeto %s existente sem takes mantém o formato carregado e impede escolher outro', async (kind, label) => {
    const existing = fixture('owner', 'project', kind); projects.set(key('owner', existing.id), existing);
    await mount('/studio/record?project=project');
    expect(formatButton(label)?.getAttribute('aria-pressed')).toBe('true');
    for (const next of ['Aula', 'Short', 'Podcast', 'Live']) {
      expect(formatButton(next)?.disabled, next).toBe(true); await format(next);
    }
    expect(formatButton(label)?.getAttribute('aria-pressed')).toBe('true');
    expect(button(kind === 'podcast' ? 'Ativar microfone' : 'Abrir câmera')).toBeTruthy();
    expect((host.querySelector('[aria-label="Nome da gravação"]') as HTMLInputElement).value).toBe(existing.title);
    expect(permissions).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled();
  });

  it('StrictMode não abre permissão nem rascunho; formato e gesto abrem uma única captura com monitor real', async () => {
    vi.useFakeTimers(); await mount(); expect(permissions).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled(); expect(activeVisibility()).toBe(2);
    await format('Podcast'); await click('Ativar microfone'); expect(permissions).toHaveBeenCalledTimes(1); expect(host.querySelector('[aria-label="Microfone em uso: USB Microphone"]')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(100)); expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('-6.020599913279624');
    await startTake(); expect(host.querySelector('header')).toBeNull(); expect(host.querySelector('.se-recording-takes')).toBeNull(); expect(button('Trocar câmera')).toBeUndefined(); expect(host.querySelector('[role="timer"]')).toBeTruthy();
    await click('Encerrar gravação'); expect(io.save).toHaveBeenCalledTimes(1); expect(Recorder.instances).toHaveLength(1); expect(host.textContent).toContain('Takes salvos');
    const review = host.querySelector<HTMLAudioElement>('audio[aria-label="Reproduzir take salvo"]');
    expect(review).toBeTruthy(); expect(review!.controls).toBe(false); expect(button('Reproduzir take')).toBeTruthy();
    await act(async () => root.unmount()); expect(activeVisibility()).toBe(0);
  });

  it('espera salvamento durável, mantém sessão após query replace e concatena dois takes antes de excluir/editar', async () => {
    const saved = deferred<StudioProject>(), originalSave = io.save.getMockImplementation()!; io.save.mockImplementationOnce(async (account, value) => { await saved.promise; return originalSave(account, value); });
    await mount(); await record(); expect(button('Ir para edição')?.disabled).toBe(true); expect(host.querySelector('.se-recording-take')).toBeNull();
    await act(async () => saved.resolve(fixture())); expect(button('Ir para edição')?.disabled).toBe(false); expect(host.querySelector('[data-location]')?.textContent).toContain('?project=');
    expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('production'); expect(activeVisibility()).toBe(2);
    const review = host.querySelector<HTMLVideoElement>('video[aria-label="Reproduzir take salvo"]');
    expect(review).toBeTruthy(); expect(review!.controls).toBe(false); expect(button('Reproduzir take')).toBeTruthy();
    await click('Gravar outro take'); await startTake(); await click('Encerrar gravação'); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(2); expect(io.create).toHaveBeenCalledTimes(1); expect(io.save).toHaveBeenCalledTimes(2);
    const value = [...projects.values()][0]; expect(compileStudioRecipe(value).durationTicks).toBe(480000);
    await click('Excluir take 1'); await answer('Excluir take'); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1); expect(assets.size).toBe(4);
    await click('Ir para edição'); expect(host.querySelector('[data-location]')?.textContent).toBe(`/studio/projects/${value.id}`); expect(activeVisibility()).toBe(0);
  });

  it('erro de escrita mantém o mesmo File/IDs, permite backup e repete sem permissão/REC/duplicação', async () => {
    io.save.mockRejectedValueOnce(new Error('Sem espaço para salvar.')); await mount(); await record(); expect(host.textContent).toContain('Sem espaço');
    expect(button('Ir para edição')?.disabled).toBe(true); const original = io.put.mock.calls[0][3], assetIds = io.put.mock.calls.map(args => args[2]);
    const clickDownload = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined); vi.useFakeTimers(); await click('Baixar original'); expect(URL.createObjectURL).toHaveBeenLastCalledWith(original); expect(clickDownload).toHaveBeenCalledTimes(1); await act(async () => vi.advanceTimersByTime(1000)); expect(URL.revokeObjectURL).toHaveBeenCalled(); vi.useRealTimers();
    await click('Salvar take'); expect(io.put.mock.calls.map(args => args[2])).toEqual(assetIds); expect(io.save).toHaveBeenCalledTimes(2); expect(permissions).toHaveBeenCalledTimes(1); expect(Recorder.instances).toHaveLength(1); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1);
  });

  it('erro de metadados retém arquivo e libera dispositivos; retry lê os mesmos bytes e salva automaticamente', async () => {
    io.inspect.mockRejectedValueOnce(new Error('Decoder temporariamente ocupado.')); await mount(); await record(); const original = io.inspect.mock.calls[0][0];
    expect(io.create).not.toHaveBeenCalled(); expect(host.textContent).toContain('Decoder'); expect(button('Baixar original')).toBeTruthy();
    const stream = await permissions.mock.results[0].value; expect(stream.tracks.every((t: Track) => t.stop.mock.calls.length === 1)).toBe(true);
    await click('Salvar take'); expect(io.inspect.mock.calls[1][0]).toBe(original); expect(io.put.mock.calls[0][3]).toBe(original); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1); expect(Recorder.instances).toHaveLength(1);
  });

  it('retomada do iPhone mantém ação concreta, progresso visível e bloqueio de clique até salvar o original', async () => {
    const receive = deferred<File>(), file = new File(['native-4k-original'], 'iPhone.mp4', { type: 'video/mp4' });
    const newConnection = deferred<void>();
    let publishTransfer!: (patch: Partial<StudioRemoteView>) => void;
    remoteIO.create.mockImplementation(() => {
      const listeners = new Set<(state: StudioCaptureState) => void>(), remoteListeners = new Set<(state: StudioRemoteView) => void>();
      let state: StudioCaptureState = { phase: 'idle', stream: null, file: null, error: null, elapsed: 0, input: null, camera: null, devices: { cameras: [], microphones: [] }, levels: [], microphoneEnabled: true };
      let remote: StudioRemoteView = { pairing: null, session: null, connection: 'connected', transfer: 'idle', pendingTakeId: '50000000-0000-4000-8000-000000000001', error: null };
      let attempts = 0, preparations = 0, waiting = false;
      const publish = (patch: Partial<StudioCaptureState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener(state)); };
      const transfer = (patch: Partial<StudioRemoteView>) => { remote = { ...remote, ...patch }; remoteListeners.forEach(listener => listener(remote)); };
      return {
        subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
        subscribeRemote(listener) { remoteListeners.add(listener); listener(remote); return () => remoteListeners.delete(listener); },
        async prepare() { publishTransfer = transfer; if (++preparations > 1) { waiting = true; publish({ phase: 'preparing', stream: null }); transfer({ pendingTakeId: null, session: { deviceId: 'paired-phone' } as StudioRemoteView['session'] }); await newConnection.promise; if (!waiting) return; } publish({ phase: 'ready', stream: new Stream([new Track('video')]) as unknown as MediaStream, width: 3840, height: 2160, frameRate: 30 }); },
        start() { publish({ phase: 'recording', pendingRecovery: false }); },
        async stop() {
          if (++attempts === 1) { publish({ phase: 'error', pendingRecovery: true, error: 'Não foi possível preparar esta parte do original.' }); transfer({ transfer: 'retry' }); throw new Error('Não foi possível preparar esta parte do original.'); }
          publish({ phase: 'stopping', pendingRecovery: true, error: null }); transfer({ transfer: 'uploading', transferBytes: 25, transferTotalBytes: 100 });
          const original = await receive.promise; publish({ phase: 'recorded', stream: null, file: original, pendingRecovery: false }); return original;
        },
        discardRemoteRecovery() {}, cancel() { waiting = false; publish({ phase: 'idle', stream: null, file: null, pendingRecovery: false }); },
        dispose() { listeners.clear(); remoteListeners.clear(); }, getMicrophoneTrack() { return null; },
      } as unknown as StudioRemoteCaptureController;
    });
    await act(async () => root.render(<MemoryRouter initialEntries={['/studio/record']}><StudioRecordingWorkspace owner="owner" initialKind="aula" canUseScenes /></MemoryRouter>));
    await click('Meu iPhone · Premium'); await click('Conectar meu iPhone'); await startTake(); await click('Encerrar gravação');
    expect(host.textContent).toContain('Não foi possível preparar esta parte'); expect(host.textContent).not.toMatch(/Tentar salvar|tente recuperar/); expect(button('Retomar transferência')?.disabled).toBe(false);
    await click('Retomar transferência'); expect(host.querySelector('.se-recording-recovery')?.getAttribute('aria-busy')).toBe('true');
    expect(host.textContent).toContain('Enviando original do iPhone… 25%'); expect(button('Transferindo original…')?.disabled).toBe(true); expect(button('Descartar trecho')?.disabled).toBe(true);
    await act(async () => publishTransfer({ transfer: 'downloading', transferBytes: 75, transferTotalBytes: 100 })); expect(host.textContent).toContain('Recebendo original no computador… 75%');
    await act(async () => receive.resolve(file)); expect(host.querySelector('.se-recording-recovery')).toBeNull(); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1); expect(io.put.mock.calls[0][3]).toBe(file);
    await click('Gravar outro take'); expect(host.textContent).toContain('Aguardando meu iPhone.'); expect(button('Cancelar conexão')?.disabled).toBe(false);
    await click('Cancelar conexão'); expect(host.querySelector('.src-pairing')).toBeNull(); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1); expect(button('Reproduzir take')).toBeTruthy();
    await act(async () => newConnection.resolve()); expect(host.querySelector('.src-pairing')).toBeNull(); expect(host.querySelector('video[aria-label="Reproduzir take salvo"]')).toBeTruthy(); expect(io.save).toHaveBeenCalledTimes(1);
  });

  it('Short mantém enquadramento cover e formato carregado após excluir o último take, sem voltar à preparação', async () => {
    initialKind = 'short'; await mount(); await record(); const value = [...projects.values()][0]; expect(value.editing!.main[0].fit).toBe('cover');
    expect(host.querySelector('.se-recording-stage.short')).toBeTruthy(); await click('Excluir take 1'); await answer('Excluir take'); expect(button('Ir para edição')?.disabled).toBe(true);
    expect(button('Voltar à preparação')).toBeUndefined(); await click('Configurações da gravação');
    expect(host.querySelectorAll('.se-recording-formats button')).toHaveLength(0); expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('production');
    await click('Fechar configurações'); await click('Abrir câmera'); expect(permissions.mock.calls.at(-1)![0].video).toBeTruthy(); await startTake(); await click('Encerrar gravação'); expect([...projects.values()][0].kind).toBe('short'); expect(io.create).toHaveBeenCalledTimes(1);
  });

  it('seleção do mic remoto usa UID do iPhone, bloqueia REC sem confirmação e mantém medidor no take', async () => {
    const builtin = { id: 'BuiltInMic', name: 'Microfone integrado do iPhone', type: 'MicrophoneBuiltIn' };
    const usb = { id: 'USB-Audio-1', name: 'USB externo do iPhone', type: 'USBAudio' };
    const configure = vi.fn(), start = vi.fn();
    remoteIO.create.mockImplementation(() => {
      const listeners = new Set<(state: StudioCaptureState) => void>(), remoteListeners = new Set<(state: StudioRemoteView) => void>();
      let state: StudioCaptureState = { phase: 'idle', stream: null, file: null, error: null, elapsed: 0, input: null, camera: null, devices: { cameras: [], microphones: [] }, levels: [], microphoneEnabled: true };
      let remote: StudioRemoteView = { pairing: null, connection: 'connected', transfer: 'idle', pendingTakeId: null, error: null, session: {
        id: 'native-session', projectId: null, kind: 'aula', title: 'Nova aula', status: 'ready', controllerId: 'browser', deviceId: 'iphone', sequence: 0, activeTakeId: null,
        configuration: { resolution: '4k', fps: 30, cameraFacing: 'back' }, deviceState: {
          capabilities: { audioInputSelection: true },
          audioInput: { version: 1, available: [builtin, usb], preferredId: usb.id, current: builtin, confirmed: false, selecting: false, warning: 'Confirme o microfone USB no iPhone.' },
          audioMonitor: { status: 'live', input: builtin, channels: [{ averageDb: -24, peakDb: -10 }] },
        }, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), pairedAt: new Date().toISOString(), controllerSeenAt: null, deviceSeenAt: new Date().toISOString(), closedAt: null,
      } };
      const publish = (patch: Partial<StudioCaptureState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener(state)); };
      configure.mockImplementation(async ({ audioInputId }: { audioInputId: string | null }) => {
        const current = audioInputId === usb.id ? usb : builtin;
        remote = { ...remote, session: { ...remote.session!, deviceState: { ...remote.session!.deviceState, audioInput: { ...remote.session!.deviceState!.audioInput!, preferredId: audioInputId, current, confirmed: true, warning: null }, audioMonitor: { status: 'live', input: current, channels: [{ averageDb: -24, peakDb: -10 }] } } } };
        remoteListeners.forEach(listener => listener(remote));
      });
      start.mockImplementation(async () => publish({ phase: 'recording' }));
      return {
        subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
        subscribeRemote(listener) { remoteListeners.add(listener); listener(remote); return () => remoteListeners.delete(listener); },
        async prepare() { publish({ phase: 'ready', stream: new Stream([new Track('video')]) as unknown as MediaStream }); },
        configureRemote: configure, start, cancel() {}, dispose() { listeners.clear(); remoteListeners.clear(); }, getMicrophoneTrack() { return null; },
      } as unknown as StudioRemoteCaptureController;
    });
    await act(async () => root.render(<MemoryRouter initialEntries={['/studio/record']}><StudioRecordingWorkspace owner="owner" initialKind="aula" canUseScenes /></MemoryRouter>));
    await click('Meu iPhone · Premium'); await click('Conectar meu iPhone');
    await enterProduction();
    expect(button('Iniciar gravação')?.disabled).toBe(true); expect(host.textContent).toContain('Confirme o microfone do iPhone'); expect(host.querySelector('[role="meter"]')).toBeNull();
    await startTake(); expect(start).not.toHaveBeenCalled();
    await click('Selecionar microfone do iPhone'); const option = [...host.querySelectorAll<HTMLButtonElement>('.src-audio-option')].find(value => value.textContent?.includes(usb.name))!;
    await act(async () => option.click()); expect(configure).toHaveBeenCalledWith({ audioInputId: usb.id }); expect(permissions).not.toHaveBeenCalled();
    expect(button('Iniciar gravação')?.disabled).toBe(false); expect(host.querySelector('.src-audio-heading')?.textContent).toContain(usb.name);
    await startTake(); expect(start).toHaveBeenCalledTimes(1); expect(button('Selecionar microfone do iPhone')?.disabled).toBe(true); expect(host.querySelector('[role="meter"]')).toBeTruthy(); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('saída tranquila não pede confirmação nem trava leaving; captura pronta é encerrada antes de voltar', async () => {
    await mount(); await click('Abrir câmera'); const stream = await permissions.mock.results[0].value; await click('Voltar aos projetos');
    expect(confirmation()).toBeNull(); expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/projects'); expect(stream.tracks.every((t: Track) => t.stop.mock.calls.length === 1)).toBe(true);
  });

  it('POP cancelado preserva REC; POP confirmado espera o take durável antes de liberar histórico', async () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined); await mount('/studio/record', true); await click('Abrir câmera'); await startTake();
    await pop(0, '/studio/projects'); await pop(1, '/studio/record'); expect(confirmation()?.textContent).toContain('Salvar e sair?'); await answer('Cancelar'); expect(host.querySelector('.is-recording')).toBeTruthy(); expect(Recorder.instances[0].stop).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled(); expect(go).toHaveBeenCalledTimes(1);
    const held = deferred<void>(), save = io.save.getMockImplementation()!; io.save.mockImplementationOnce(async (...args) => { await held.promise; return save(...args); });
    await pop(0, '/studio/projects'); await pop(1, '/studio/record'); await answer('Salvar e sair'); expect(go).toHaveBeenCalledTimes(2); expect(host.querySelector('.se-recording')).toBeTruthy();
    await act(async () => held.resolve()); expect(go).toHaveBeenLastCalledWith(-1); expect([...projects.values()][0].takes).toHaveLength(1); await pop(0, '/studio/projects'); expect(host.querySelector('.se-recording')).toBeNull();
  });

  it('saída durante remoção espera receipt e mantém página quando a transação falha', async () => {
    await mount(); await record(); const held = deferred<StudioProject>(); io.save.mockImplementationOnce(() => held.promise);
    await click('Excluir take 1'); await answer('Excluir take'); expect(host.textContent).toContain('Removendo take'); await click('Voltar aos projetos'); expect(host.querySelector('.se-recording')).toBeTruthy();
    await act(async () => held.reject(new Error('Falha removendo take.'))); expect(host.querySelector('[data-location]')?.textContent).toContain('/studio/record'); expect(button('Voltar aos projetos')?.disabled).toBe(false); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1);
  });

  it('diálogo de exclusão permite cancelar e reserva um único take contra cliques duplicados/conflitantes', async () => {
    await mount(); await record(); await click('Gravar outro take'); await startTake(); await click('Encerrar gravação');
    const original = [...projects.values()][0], source = host.querySelector('video[aria-label="Reproduzir take salvo"]')?.getAttribute('src');
    const first = button('Excluir take 1')!, second = button('Excluir take 2')!;
    await act(async () => { first.click(); second.click(); first.click(); });
    expect(confirmation()?.textContent).toContain('Excluir take 1?'); expect(confirmation()?.textContent).toContain('Os demais takes permanecem'); expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(io.save).toHaveBeenCalledTimes(2); expect(button('Excluir take 2')?.disabled).toBe(true); expect(button('Ir para edição')?.disabled).toBe(true);
    await click('Ir para edição'); expect(permissions).toHaveBeenCalledTimes(2); expect(host.querySelector('[data-location]')?.textContent).toContain('/studio/record'); expect(host.querySelector('video[aria-label="Reproduzir take salvo"]')?.getAttribute('src')).toBe(source);
    await answer('Cancelar'); expect(confirmation()).toBeNull(); expect([...projects.values()][0]).toBe(original); expect(button('Ir para edição')?.disabled).toBe(false);
    await click('Excluir take 1'); const accept = [...confirmation()!.querySelectorAll('button')].find(value => value.textContent === 'Excluir take')!;
    await act(async () => { accept.click(); accept.click(); });
    expect(io.save).toHaveBeenCalledTimes(3); expect([...projects.values()][0].takes.map(item => item.id)).toEqual([original.takes[1].id]); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1);
  });

  it('troca de owner ou desmontagem cancela exclusão pendente e nenhuma resposta antiga remove take', async () => {
    await mount(); await record(); const original = [...projects.values()][0]; await click('Excluir take 1');
    const stale = [...confirmation()!.querySelectorAll('button')].find(value => value.textContent === 'Excluir take')!;
    projects.set(key('other',original.id),fixture('other',original.id)); owner = 'other'; await mount(); expect(confirmation()).toBeNull(); await act(async () => stale.click());
    expect(io.save).toHaveBeenCalledTimes(1); expect(projects.get(key('owner', original.id))).toBe(original); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(0);
    await mount('/studio/record'); await record(); await click('Excluir take 1');
    const afterUnmount = [...confirmation()!.querySelectorAll('button')].find(value => value.textContent === 'Excluir take')!;
    await act(async () => root.unmount()); expect(confirmation()).toBeNull(); await act(async () => afterUnmount.click()); expect(io.save).toHaveBeenCalledTimes(2);
  });

  it('REC salva parcial enquanto o diálogo de saída está aberto; confirmar compartilha o salvamento sem duplicar', async () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined); await mount('/studio/record', true); await click('Abrir câmera'); await startTake();
    await pop(0, '/studio/projects'); await pop(1, '/studio/record'); expect(confirmation()?.textContent).toContain('Salvar e sair?'); expect(Recorder.instances[0].state).toBe('recording');
    expect(button('Encerrar gravação')?.disabled).toBe(true); await click('Encerrar gravação'); expect(Recorder.instances[0].stop).not.toHaveBeenCalled();
    await visibility('hidden'); expect(Recorder.instances[0].stop).toHaveBeenCalledTimes(1); expect(io.save).toHaveBeenCalledTimes(1); expect([...projects.values()][0].takes).toHaveLength(1);
    expect(confirmation()?.textContent).toContain('Salvar e sair?'); await answer('Salvar e sair');
    expect(io.save).toHaveBeenCalledTimes(1); expect(Recorder.instances[0].stop).toHaveBeenCalledTimes(1); expect(go).toHaveBeenLastCalledWith(-1);
  });

  it('permissão resolve durante saída pendente; cancelar mantém a entrada pronta e impede REC até responder', async () => {
    const permission = deferred<Stream>(); permissions.mockReturnValueOnce(permission.promise); await mount(); await click('Abrir câmera'); await click('Voltar aos projetos');
    expect(confirmation()?.textContent).toContain('Cancelar a abertura?'); const stream = new Stream([new Track('video'), new Track()]); await act(async () => permission.resolve(stream));
    expect(button('Iniciar gravação')).toBeUndefined(); expect(button('Ir para gravação')?.disabled).toBe(true); await click('Ir para gravação'); expect(Recorder.instances).toHaveLength(0); expect(stream.getTracks().every(track => track.readyState === 'live')).toBe(true);
    await answer('Cancelar'); expect(confirmation()).toBeNull(); expect(button('Ir para gravação')?.disabled).toBe(false); expect(button('Voltar aos projetos')?.disabled).toBe(false);
    await startTake(); await click('Encerrar gravação'); expect(io.save).toHaveBeenCalledTimes(1); expect(permissions).toHaveBeenCalledTimes(1);
  });

  it('descarte visual preserva o candidato ao cancelar e só remove o trecho pendente após aprovação', async () => {
    await mount(); await record(); const saved = [...projects.values()][0];
    io.save.mockRejectedValueOnce(new Error('Sem espaço para o segundo take.')); await click('Gravar outro take'); await startTake(); await click('Encerrar gravação');
    const original = io.inspect.mock.calls.at(-1)![0]; await click('Descartar trecho'); expect(confirmation()?.textContent).toContain('Este trecho ainda não foi salvo'); expect(button('Salvar take')?.disabled).toBe(true);
    await click('Salvar take'); expect(io.save).toHaveBeenCalledTimes(2); await answer('Cancelar'); expect(button('Baixar original')).toBeTruthy();
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined); await click('Baixar original'); expect(URL.createObjectURL).toHaveBeenLastCalledWith(original); expect(download).toHaveBeenCalledTimes(1);
    await click('Descartar trecho'); await answer('Descartar trecho'); expect(button('Baixar original')).toBeUndefined(); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1); expect([...projects.values()][0]).toBe(saved);
    expect(io.save).toHaveBeenCalledTimes(2); expect(button('Ir para edição')?.disabled).toBe(false); expect(Recorder.instances).toHaveLength(2);
  });

  it('double Back durante o diálogo restaura a entrada e libera apenas o destino final após um salvamento', async () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined); await mount('/studio/record', true); await click('Abrir câmera'); await startTake();
    await pop(0, '/studio/projects'); await pop(1, '/studio/record'); await pop(-1, '/studio'); await pop(1, '/studio/record');
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1); expect(Recorder.instances[0].stop).not.toHaveBeenCalled(); expect(go.mock.calls.map(args => args[0])).toEqual([1,2]);
    await answer('Salvar e sair'); expect(Recorder.instances[0].stop).toHaveBeenCalledTimes(1); expect(io.save).toHaveBeenCalledTimes(1); expect(go).toHaveBeenLastCalledWith(-2);
  });

  it('diálogo pausa countdown; Cancelar retoma o restante e confirmar saída cancela sem criar outro take', async () => {
    vi.useFakeTimers(); await mount(); await click('Abrir câmera'); await click('Configurações da gravação'); await click('Gravação'); await select('Temporizador','3'); await click('Fechar configurações');
    await startTake(); await act(async()=>vi.advanceTimersByTime(1000)); expect(host.querySelector('.se-recording-countdown strong')?.textContent).toBe('2');
    await click('Voltar aos projetos'); expect(confirmation()?.textContent).toContain('Cancelar a contagem?'); await act(async()=>vi.advanceTimersByTime(10000));
    expect(host.querySelector('.se-recording-countdown strong')?.textContent).toBe('2'); expect(Recorder.instances).toHaveLength(0); expect(io.save).not.toHaveBeenCalled();
    await answer('Cancelar'); await act(async()=>vi.advanceTimersByTime(1000)); expect(host.querySelector('.se-recording-countdown strong')?.textContent).toBe('1');
    await act(async()=>vi.advanceTimersByTime(1000)); expect(Recorder.instances).toHaveLength(1); expect(Recorder.instances[0].state).toBe('recording'); await click('Encerrar gravação');
    await click('Gravar outro take'); await startTake(); await click('Voltar aos projetos'); await answer('Sair da gravação'); await act(async()=>vi.advanceTimersByTime(10000));
    expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/projects'); expect(Recorder.instances).toHaveLength(1); expect(io.save).toHaveBeenCalledTimes(1); expect([...projects.values()][0].takes).toHaveLength(1);
  });

  it('owner novo invalida permissão e salvamento antigos sem navegação/controle da conta anterior', async () => {
    const permission = deferred<Stream>(); permissions.mockReturnValueOnce(permission.promise); await mount(); await click('Abrir câmera'); owner = 'other'; await mount();
    const late = new Stream([new Track('video'), new Track()]); await act(async () => permission.resolve(late)); expect(late.tracks.every(t => t.stop.mock.calls.length === 1)).toBe(true); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(activeVisibility()).toBe(2);
    const held = deferred<void>(), save = io.save.getMockImplementation()!; io.save.mockImplementationOnce(async (...args) => { await held.promise; return save(...args); }); await record(); owner = 'third'; await mount(); await act(async () => held.resolve());
    expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('setup'); expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/record'); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(0); expect(io.save.mock.calls[0][0]).toBe('other');
  });

  it('revisão usa Blob salvo e revoga URL ao reabrir captura ou desmontar, mantendo entradas fechadas', async () => {
    await mount(); await record(); const renderedURL = host.querySelector('video[aria-label="Reproduzir take salvo"]')?.getAttribute('src'); expect(renderedURL).toMatch(/^blob:/); expect(permissions).toHaveBeenCalledTimes(1);
    const stream = await permissions.mock.results[0].value; expect(stream.tracks.every((t: Track) => t.readyState === 'ended')).toBe(true);
    await click('Gravar outro take'); expect(URL.revokeObjectURL).toHaveBeenCalledWith(renderedURL); expect(permissions).toHaveBeenCalledTimes(2); const next = await permissions.mock.results[1].value;
    await act(async () => root.unmount()); expect(next.tracks.every((t: Track) => t.readyState === 'ended')).toBe(true); expect(activeVisibility()).toBe(0);
  });

  it('seletores exibem dispositivos autorizados reais, trocam câmera/mic e REC mantém só parar/monitor', async () => {
    await mount(); expect(navigator.mediaDevices.enumerateDevices).not.toHaveBeenCalled();
    await click('Abrir câmera');
    const camera = host.querySelector('select[aria-label="Câmera"]') as HTMLSelectElement, mic = host.querySelector('select[aria-label="Microfone"]') as HTMLSelectElement;
    expect(camera.value).toBe('camera-id'); expect(camera.selectedOptions[0].textContent).toBe('Camera autorizada');
    expect(mic.value).toBe('usb-id'); expect(mic.selectedOptions[0].textContent).toBe('USB Microphone');
    await select('Câmera', 'continuity-id');
    expect(permissions.mock.calls.at(-1)![0]).toMatchObject({ video: { deviceId: { exact: 'continuity-id' } }, audio: false });
    expect(camera.value).toBe('continuity-id'); expect(camera.selectedOptions[0].textContent).toBe('iPhone de Fabio'); expect(mic.value).toBe('usb-id');
    await select('Microfone', 'external-mic');
    expect(permissions.mock.calls.at(-1)![0]).toMatchObject({ video: false, audio: { deviceId: { exact: 'external-mic' } } });
    expect(mic.value).toBe('external-mic'); expect(mic.selectedOptions[0].textContent).toBe('Microfone externo');
    expect(host.querySelector('[aria-label="Microfone em uso: Microfone externo"]')).toBeTruthy();
    expect(((host.querySelector('video[aria-label="Prévia da gravação"]') as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0].getSettings().deviceId).toBe('continuity-id');
    await startTake();
    expect(host.querySelectorAll('[data-testid="recording-toolbar"] button')).toHaveLength(1); expect(button('Encerrar gravação')).toBeTruthy();
    expect(host.querySelectorAll('select')).toHaveLength(0); expect(button('Desativar microfone')).toBeUndefined(); expect(button('Voltar aos projetos')).toBeUndefined();
    expect(host.querySelector('[role="timer"]')).toBeTruthy(); expect(host.querySelector('[aria-label="Microfone em uso: Microfone externo"]')).toBeTruthy();
    await click('Encerrar gravação'); expect(host.querySelector('.se-recording-takes')).toBeTruthy(); expect(button('Ir para edição')?.disabled).toBe(false);
    expect(host.querySelector('[data-permission-state]')).toBeNull();
  });

  it('mute usa a pista real sem trocar identidade; indicador volta ao sinal quando reativado', async () => {
    vi.useFakeTimers(); await mount(); await click('Abrir câmera');
    const preview = host.querySelector('video[aria-label="Prévia da gravação"]') as HTMLVideoElement;
    const track = (preview.srcObject as unknown as Stream).getAudioTracks()[0] as Track & { enabled: boolean };
    await act(async () => vi.advanceTimersByTime(100)); expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).not.toBe('-60');
    await click('Desativar microfone'); expect(track.enabled).toBe(false); expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('-60');
    expect(host.textContent).toContain('Microfone desativado'); expect(host.querySelector('[aria-label="Microfone em uso: USB Microphone"]')).toBeTruthy();
    expect(button('Ativar microfone da gravação')?.getAttribute('aria-pressed')).toBe('true');
    await click('Ativar microfone da gravação'); expect(track.enabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(100)); expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('-6.020599913279624');
    expect(permissions).toHaveBeenCalledTimes(1);
  });

  it('preparação central orienta permissão, negação é amigável e retry só libera REC com stream confirmado', async () => {
    const pending = deferred<Stream>(); permissions.mockReturnValueOnce(pending.promise);
    await mount(); await click('Abrir câmera');
    expect(host.querySelector('[aria-label="Prévia e preparação"] [aria-busy="true"]')).toBeTruthy(); expect(host.textContent).toContain('Autorize o acesso');
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(button('Iniciar gravação')).toBeUndefined();
    expect(host.querySelector('select[aria-label="Câmera"]')).toBeNull();
    await act(async () => pending.reject(new DOMException('Permission denied', 'NotAllowedError')));
    expect(host.querySelector('[aria-label="Prévia e preparação"] [aria-busy="true"]')).toBeNull(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Permita câmera e microfone');
    expect(host.textContent).not.toContain('Permission denied'); expect(host.textContent).toContain('permissões deste site');
    await click('Abrir câmera'); expect(permissions).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull(); expect(button('Ir para gravação')?.disabled).toBe(false);
  });

  it('erro de entrada ocupada mostra orientação de dispositivo, sem diagnosticar permissão negada', async () => {
    permissions.mockRejectedValueOnce(new DOMException('Could not start video source', 'NotReadableError'));
    await mount(); await click('Abrir câmera');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Feche outro aplicativo');
    expect(button('Iniciar gravação')).toBeUndefined(); expect(host.textContent).not.toContain('Permita câmera e microfone');
    expect(host.textContent).not.toContain('Could not start video source'); expect(button('Abrir câmera')).toBeTruthy();
  });

  it('sair durante troca de entrada pendente cancela sem aguardar permissão e fecha tracks tardios', async () => {
    await mount(); await click('Abrir câmera'); const original = await permissions.mock.results[0].value;
    const pending = deferred<Stream>(); permissions.mockReturnValueOnce(pending.promise);
    await select('Câmera', 'continuity-id'); expect(button('Iniciar gravação')).toBeUndefined(); expect(host.textContent).toContain('Ajustando');
    await click('Voltar aos projetos'); expect(confirmation()?.textContent).toContain('Cancelar a abertura?'); await answer('Sair');
    expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/projects');
    expect(original.tracks.every((track: Track) => track.readyState === 'ended')).toBe(true);
    const late = new Stream([new Track('video', 'continuity-id')]); await act(async () => pending.resolve(late));
    expect(late.tracks.every(track => track.readyState === 'ended')).toBe(true); expect(io.create).not.toHaveBeenCalled();
  });

  it('troca que falha conserva preview/nome anterior e não impede uma saída sem risco', async () => {
    await mount(); await click('Abrir câmera'); const original = await permissions.mock.results[0].value;
    permissions.mockRejectedValueOnce(new DOMException('Device not found', 'NotFoundError'));
    await select('Câmera', 'continuity-id');
    const camera = host.querySelector('select[aria-label="Câmera"]') as HTMLSelectElement;
    expect(camera.value).toBe('camera-id'); expect(camera.selectedOptions[0].textContent).toBe('Camera autorizada');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Confira a conexão'); expect(host.textContent).not.toContain('Device not found');
    expect(host.querySelector('[data-permission-state]')).toBeNull(); expect(original.tracks.every((track: Track) => track.readyState === 'live')).toBe(true);
    await click('Voltar aos projetos'); expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/projects');
    expect(confirmation()).toBeNull(); expect(original.tracks.every((track: Track) => track.readyState === 'ended')).toBe(true);
  });

  it('take strip recolhe sem alterar montagem, câmera ou revisão e reabre com exclusão acessível', async () => {
    await mount(); await record(); const saved = [...projects.values()][0], source = host.querySelector('video[aria-label="Reproduzir take salvo"]')?.getAttribute('src');
    await click('Recolher takes salvos');
    expect(host.querySelector('#se-recording-saved-takes')?.hasAttribute('hidden')).toBe(true); expect(button('Mostrar takes salvos')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('video[aria-label="Reproduzir take salvo"]')?.getAttribute('src')).toBe(source); expect(io.save).toHaveBeenCalledTimes(1);
    await click('Mostrar takes salvos'); expect(host.querySelector('#se-recording-saved-takes')?.hasAttribute('hidden')).toBe(false);
    expect(button('Excluir take 1')?.disabled).toBe(false); expect(compileStudioRecipe([...projects.values()][0])).toEqual(compileStudioRecipe(saved)); expect(permissions).toHaveBeenCalledTimes(1);
  });

  it('selecionar Live abre somente sua preparação, sem câmera, REC ou rascunho local', async () => {
    await mount(); await format('Live');
    expect(button('Preparar live')).toBeTruthy(); expect(button('Abrir câmera')).toBeUndefined();
    const name = host.querySelector<HTMLInputElement>('[aria-label="Nome da gravação"]');
    expect(name).toBeTruthy(); expect(name?.placeholder).toBe('Nova live'); expect(name?.maxLength).toBe(150);
    await input('Nome da gravação', '  Minha live de hoje  ');
    await format('Podcast'); expect(host.querySelector<HTMLInputElement>('[aria-label="Nome da gravação"]')?.value).toBe('  Minha live de hoje  ');
    await format('Live'); expect(host.querySelector<HTMLInputElement>('[aria-label="Nome da gravação"]')?.value).toBe('  Minha live de hoje  ');
    for (const label of ['Só câmera', 'Só tela', 'Câmera e tela · Premium', 'Computador', 'Meu iPhone · Premium']) expect(button(label), label).toBeUndefined();
    expect(permissions).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
    await click('Preparar live');
    expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/live');
    expect(host.querySelector('[data-live-title]')?.textContent).toBe('Minha live de hoje');
    expect(permissions).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled(); expect(io.put).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled();
    expect(activeVisibility()).toBe(0);
  });

  it('configurações abrem no palco e conservam stream, takes e a sessão durável ao gravar novamente', async () => {
    await mount(); await input('Nome da gravação', 'Aula com dois takes'); await record();
    const saved = [...projects.values()][0], firstTake = saved.takes[0], firstAsset = saved.editing!.assets[0];
    await click('Gravar outro take');
    const preview = host.querySelector('video[aria-label="Prévia da gravação"]') as HTMLVideoElement, stream = preview.srcObject as unknown as Stream;
    await click('Configurações da gravação'); await click('Gravação'); await toggle('Grade de enquadramento');
    expect(host.querySelector('aside[aria-label="Configurações da gravação"]')).toBeTruthy();
    expect(button('Voltar à preparação')).toBeUndefined(); expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('production');
    expect(preview.srcObject).toBe(stream); expect(stream.tracks.every(track => track.readyState === 'live' && track.stop.mock.calls.length === 0)).toBe(true);
    expect(io.save).toHaveBeenCalledTimes(1); expect(io.create).toHaveBeenCalledTimes(1); expect(permissions).toHaveBeenCalledTimes(2);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('aside[aria-label="Configurações da gravação"]')).toBeNull(); expect(preview.srcObject).toBe(stream);
    await startTake(); await click('Encerrar gravação');
    const updated = [...projects.values()][0];
    expect(updated.id).toBe(saved.id); expect(updated.title).toBe('Aula com dois takes'); expect(updated.takes).toHaveLength(2);
    expect(updated.takes[0]).toEqual(firstTake); expect(updated.editing!.assets[0]).toEqual(firstAsset);
    expect(io.create).toHaveBeenCalledTimes(1); expect(io.save).toHaveBeenCalledTimes(2); expect(compileStudioRecipe(updated).durationTicks).toBe(480000);
  });

  it('temporizador cancelado ou ocultado não inicia REC nem cria take; nova contagem completa inicia uma única gravação', async () => {
    vi.useFakeTimers(); await mount(); await click('Abrir câmera');
    await click('Configurações da gravação'); await click('Gravação'); await select('Temporizador', '3'); await click('Fechar configurações');
    await enterProduction();
    const preview = host.querySelector('video[aria-label="Prévia da gravação"]') as HTMLVideoElement, stream = preview.srcObject as unknown as Stream;
    await startTake(); expect(host.querySelector('.se-recording-countdown strong')?.textContent).toBe('3');
    expect(Recorder.instances).toHaveLength(0); await click('Cancelar contagem'); await act(async () => vi.advanceTimersByTime(5000));
    expect(host.querySelector('.se-recording-countdown')).toBeNull(); expect(Recorder.instances).toHaveLength(0); expect(io.create).not.toHaveBeenCalled();
    await startTake(); await act(async () => vi.advanceTimersByTime(1000)); expect(host.querySelector('.se-recording-countdown strong')?.textContent).toBe('2');
    await visibility('hidden'); await act(async () => vi.advanceTimersByTime(5000));
    expect(host.querySelector('.se-recording-countdown')).toBeNull(); expect(Recorder.instances).toHaveLength(0); expect(io.create).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled();
    await visibility('visible'); expect(preview.srcObject).toBe(stream); expect(permissions).toHaveBeenCalledTimes(1);
    await startTake();
    for (let second = 0; second < 3; second++) await act(async () => vi.advanceTimersByTime(1000));
    expect(Recorder.instances).toHaveLength(1); expect(Recorder.instances[0].state).toBe('recording');
    expect(host.querySelector('.se-recording-countdown')).toBeNull(); expect(host.querySelector('[role="timer"]')).toBeTruthy(); expect(io.create).not.toHaveBeenCalled();
    await click('Encerrar gravação'); expect([...projects.values()][0].takes).toHaveLength(1); expect(io.save).toHaveBeenCalledTimes(1);
  });

  it('troca de conta durante a contagem invalida o início tardio e não cria gravação na conta anterior ou nova', async () => {
    vi.useFakeTimers(); await mount(); await click('Abrir câmera');
    await click('Configurações da gravação'); await click('Gravação'); await select('Temporizador', '3'); await click('Fechar configurações');
    const stream = await permissions.mock.results[0].value;
    await startTake(); await act(async () => vi.advanceTimersByTime(1000)); owner = 'other'; await mount();
    await act(async () => vi.advanceTimersByTime(5000));
    expect(stream.tracks.every((track: Track) => track.readyState === 'ended')).toBe(true); expect(Recorder.instances).toHaveLength(0);
    expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('setup'); expect(host.querySelector('.se-recording-countdown')).toBeNull();
    expect(io.create).not.toHaveBeenCalled(); expect(io.put).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled();
  });

  it('roteiro, grade e espelhamento são overlays da prévia e não entram no stream, no original ou na receita salva', async () => {
    const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    await mount(); await click('Abrir câmera'); const preview = host.querySelector('video[aria-label="Prévia da gravação"]') as HTMLVideoElement;
    const stream = preview.srcObject as unknown as Stream, tracks = [...stream.tracks];
    await click('Configurações da gravação'); await click('Gravação');
    await toggle('Grade de enquadramento'); await toggle('Espelhar prévia');
    await click('Roteiro'); await input('Roteiro do teleprompter', 'Um roteiro para a aula, sem gravar este texto no vídeo.'); await toggle('Teleprompter');
    await select('Modo de leitura', 'timed'); await input('Velocidade da leitura', '140'); await click('Fechar configurações');
    expect(host.querySelector('.se-recording-grid')?.getAttribute('aria-hidden')).toBe('true');
    let prompter = host.querySelector('[aria-label="Texto do roteiro"]') as HTMLDivElement;
    expect(prompter.textContent).toContain('Um roteiro para a aula'); expect(preview.style.transform).toBe('scaleX(-1)'); expect(prompter.scrollTop).toBe(0);
    Object.defineProperty(prompter, 'clientHeight', { configurable: true, value: 100 });
    prompter.querySelectorAll<HTMLElement>('[data-word-index]').forEach(element => Object.defineProperty(element, 'offsetTop', { configurable: true, value: Number(element.dataset.wordIndex) * 40 }));
    await startTake();
    expect(host.querySelector('.se-recording-grid')).toBeNull(); expect(host.querySelector('aside')).toBeNull(); expect(host.querySelector('[aria-label="Teleprompter"]')).toBeTruthy();
    // The live track is retained; the presentation moves from preparation to the production stage.
    prompter = host.querySelector('[aria-label="Texto do roteiro"]') as HTMLDivElement;
    Object.defineProperty(prompter, 'clientHeight', { configurable: true, value: 100 });
    prompter.querySelectorAll<HTMLElement>('[data-word-index]').forEach(element => Object.defineProperty(element, 'offsetTop', { configurable: true, value: Number(element.dataset.wordIndex) * 40 }));
    expect(Recorder.instances[0].stream).toBe(stream); expect(Recorder.instances[0].stream.tracks).toEqual(tracks);
    const baseline = performance.now();
    for (let n = 1; n <= 5; n++) { const [id, callback] = [...frames][0]; frames.delete(id); await act(async () => callback(baseline + n * 100)); }
    expect(prompter.querySelectorAll('.is-read').length).toBeGreaterThan(0);
    expect(prompter.scrollTop).toBeGreaterThan(0); expect(io.create).not.toHaveBeenCalled();
    await click('Encerrar gravação'); expect(frames.size).toBe(0);
    const saved = [...projects.values()][0], recipe = compileStudioRecipe(saved);
    expect(saved.script).toBe(''); expect(recipe.clips).toHaveLength(1); expect(recipe.clips[0].kind).toBe('video'); expect(recipe.clips[0].text).toBeUndefined();
    expect(recipe.clips[0].flipHorizontal).not.toBe(true); expect(recipe.clips[0].grade).toBeUndefined(); expect(recipe.clips[0].effect).toBe('natural');
    expect(io.put.mock.calls[0][3]).toBe(io.inspect.mock.calls[0][0]); expect(io.create).toHaveBeenCalledTimes(1); expect(permissions).toHaveBeenCalledTimes(1);
  });

  it('voz usa o microfone físico da captura, pausa com mute/troca e REC mantém o mesmo original sem roteiro gravado', async () => {
    speechBoundary(); vi.useFakeTimers(); await mount(); await click('Abrir câmera');
    const original = await permissions.mock.results[0].value, camera = original.getVideoTracks()[0], microphone = original.getAudioTracks()[0];
    await click('Roteiro e teleprompter'); await input('Roteiro do teleprompter', 'Aprendemos iluminação e praticamos fotografia juntos.'); await toggle('Teleprompter');
    expect((host.querySelector('select[aria-label="Modo de leitura"]') as HTMLSelectElement).value).toBe('voice');
    await click('Fechar configurações'); expect(Recognition.instances).toHaveLength(0);
    await click('Ensaiar leitura'); const first = Recognition.instances.at(-1)!; expect(first.start).toHaveBeenCalledWith(microphone); expect(permissions).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1000)); expect(Recognition.instances).toHaveLength(1);
    await click('Desativar microfone'); expect(first.abort).toHaveBeenCalled(); expect(microphone.enabled).toBe(false); expect(microphone.stop).not.toHaveBeenCalled();
    await click('Ativar microfone da gravação'); expect(Recognition.instances).toHaveLength(1); expect(microphone.enabled).toBe(true);
    await select('Microfone', 'external-mic'); const replacement = (await permissions.mock.results[1].value).getAudioTracks()[0];
    expect(camera.stop).not.toHaveBeenCalled(); expect(permissions).toHaveBeenCalledTimes(2);
    await click('Retomar leitura'); expect(Recognition.instances.at(-1)!.start).toHaveBeenCalledWith(replacement);
    await startTake(); const current = Recognition.instances.at(-1)!;
    expect(current.start).toHaveBeenCalledWith(replacement); expect(Recorder.instances).toHaveLength(1);
    expect(Recorder.instances[0].stream.getAudioTracks()).toEqual([replacement]); expect(button('Encerrar gravação')).toBeTruthy();
    expect(host.querySelector('select[aria-label="Microfone"]')).toBeNull(); expect(io.create).not.toHaveBeenCalled();
    await act(async () => current.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'Aprendemos iluminação e praticamos fotografia', confidence: .98 }], { isFinal: true })] }));
    expect(host.querySelectorAll('[data-word-index].is-read').length).toBeGreaterThan(0);
    await click('Encerrar gravação'); expect(current.abort).toHaveBeenCalled(); expect(host.querySelector('[aria-label="Teleprompter"]')).toBeNull();
    const saved = [...projects.values()][0], recipe = compileStudioRecipe(saved);
    expect(saved.script).toBe(''); expect(recipe.clips).toHaveLength(1); expect(recipe.clips[0].text).toBeUndefined();
    expect(io.put.mock.calls[0][3]).toBe(io.inspect.mock.calls[0][0]); expect(io.save).toHaveBeenCalledTimes(1); expect(permissions).toHaveBeenCalledTimes(2);
  });

  it('troca de conta encerra ensaio e impede transcrição antiga de alterar a nova sessão ou criar arquivo', async () => {
    speechBoundary(); await mount(); await click('Abrir câmera'); const original = await permissions.mock.results[0].value;
    await click('Roteiro e teleprompter'); await input('Roteiro do teleprompter', 'Aprendemos iluminação e praticamos fotografia juntos.'); await toggle('Teleprompter'); await click('Fechar configurações');
    await click('Ensaiar leitura'); const recognition = Recognition.instances.at(-1)!, late = recognition.onresult;
    owner = 'other'; await mount(); expect(recognition.abort).toHaveBeenCalled(); expect(original.getTracks().every((value: Track) => value.readyState === 'ended')).toBe(true);
    await act(async () => late?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'Aprendemos iluminação e praticamos fotografia juntos', confidence: .99 }], { isFinal: true })] }));
    expect(host.querySelector('[aria-label="Teleprompter"]')).toBeNull(); expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('setup');
    expect(Recorder.instances).toHaveLength(0); expect(io.create).not.toHaveBeenCalled(); expect(io.put).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled();
  });

  it('ocultar aba durante REC encerra voz e salva take uma vez; voltar não religa captura ou transcrição', async () => {
    speechBoundary(); await mount(); await click('Abrir câmera');
    await click('Roteiro e teleprompter'); await input('Roteiro do teleprompter', 'Aprendemos iluminação e praticamos fotografia juntos.'); await toggle('Teleprompter'); await click('Fechar configurações');
    await startTake(); const recognition = Recognition.instances.at(-1)!, late = recognition.onresult;
    expect(recognition.start).toHaveBeenCalledTimes(1); await visibility('hidden');
    expect(Recorder.instances[0].stop).toHaveBeenCalledTimes(1); expect(recognition.abort).toHaveBeenCalled(); expect(io.save).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1); expect(host.textContent).toContain('gravação foi encerrada ao sair desta aba');
    const count = Recognition.instances.length, saved = [...projects.values()][0];
    await visibility('visible'); await act(async () => late?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'Aprendemos iluminação e praticamos fotografia juntos', confidence: .99 }], { isFinal: true })] }));
    expect(Recognition.instances).toHaveLength(count); expect(permissions).toHaveBeenCalledTimes(1); expect(Recorder.instances).toHaveLength(1);
    expect(io.save).toHaveBeenCalledTimes(1); expect(host.querySelector('[aria-label="Teleprompter"]')).toBeNull(); expect([...projects.values()][0]).toBe(saved);
    expect(saved.script).toBe(''); expect(compileStudioRecipe(saved).clips).toHaveLength(1);
  });
});

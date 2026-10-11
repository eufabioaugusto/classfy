import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileStudioRecipe, emptyStudioEditing, withStudioTakes, type StudioKind, type StudioProject } from '../../../../shared/studio';
import { StudioRecordingWorkspace } from './StudioRecordingWorkspace';
import { initializeStudioExitGuard } from './useStudioExitGuard';

// Only browser media/worker/storage boundaries are replaced. The Workspace,
// scene controller, entitlement gate, source lifecycle and recording session run together.
const io = vi.hoisted(() => ({ inspect: vi.fn(), create: vi.fn(), get: vi.fn(), save: vi.fn(), put: vi.fn(), asset: vi.fn(), compose: vi.fn(), readBuffer: vi.fn(), disposeBuffer: vi.fn() }));
vi.mock('@/lib/studio/editor/media', () => ({ inspectStudioMedia: io.inspect }));
vi.mock('@/lib/studio/editor/storage', () => ({
  createProject: io.create, getProject: io.get, saveProject: io.save, putAsset: io.put, getAsset: io.asset,
  studioAssetUri: (owner: string, project: string, asset: string, name: string) => `file://classfy-studio/${[owner, project, asset, name].map(encodeURIComponent).join('/')}`,
}));
vi.mock('@/lib/studio/editor/sceneComposition', () => ({ createStudioSceneComposition: io.compose }));
vi.mock('@/lib/studio/editor/sceneRecordingBuffer', () => ({ createStudioSceneRecordingBuffer: () => {
  const chunks: Blob[] = [];
  return { prepare: async () => undefined, append: async (blob: Blob) => { chunks.push(blob); }, file: (name: string, type: string) => io.readBuffer(chunks, name, type), dispose: async () => { io.disposeBuffer(); chunks.length = 0; }, get bytes() { return chunks.reduce((sum, blob) => sum + blob.size, 0); } };
} }));

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
class Track extends EventTarget {
  readonly id: string; readyState = 'live'; enabled = true; muted = false; onended: null | (() => void) = null; onmute: null | (() => void) = null; onunmute: null | (() => void) = null;
  constructor(public kind: 'video' | 'audio', public label: string, public deviceId: string) { super(); this.id = `${kind}:${deviceId}`; }
  stop = vi.fn(() => { this.readyState = 'ended'; });
  getSettings() { return { deviceId: this.deviceId, width: 1920, height: 1080, frameRate: 30 }; }
  getCapabilities() { return { width: { min: 1920, max: 1920 }, height: { min: 1080, max: 1080 }, frameRate: { min: 30, max: 30 } }; }
  end() { this.readyState = 'ended'; this.onended?.(); this.dispatchEvent(new Event('ended')); }
}
class Stream {
  constructor(public tracks: Track[]) {} getTracks() { return this.tracks; } getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); } getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
}
const audioNode = () => ({ connect: vi.fn(), disconnect: vi.fn() });
class Audio {
  state = 'running'; currentTime = 0; onstatechange: null | (() => void) = null;
  resume = vi.fn(async () => undefined); close = vi.fn(async () => { this.state = 'closed'; });
  createMediaStreamDestination() { return { ...audioNode(), stream: new Stream([new Track('audio', 'Mixagem', 'program-audio')]) }; }
  createMediaStreamSource() { return audioNode(); }
  createAnalyser() { return { ...audioNode(), fftSize: 2048, getFloatTimeDomainData(values: Float32Array) { values.fill(.25); } }; }
  createGain() { return { ...audioNode(), gain: { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() } }; }
}
class Recorder {
  static instances: Recorder[] = []; static isTypeSupported() { return true; }
  state = 'inactive'; mimeType: string; ondataavailable: null | ((e: { data: Blob }) => void) = null; onstop: null | (() => void) = null; onerror: null | (() => void) = null;
  constructor(public stream: Stream, options: { mimeType: string }) { this.mimeType = options.mimeType; Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop = vi.fn(() => { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['composed-frame-and-audio'], { type: this.mimeType }) }); this.onstop?.(); }); });
}
function fixture(owner: string, kind: StudioKind, title: string): StudioProject {
  return withStudioTakes({ version: 2, id: crypto.randomUUID(), ownerId: owner, kind, title, description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0', editing: emptyStudioEditing(kind), revision: 0, state: 'draft', progress: 0, createdAt: '2026-10-11', updatedAt: '2026-10-11' });
}
const upgrade = vi.fn(), compositions: Array<{ track: Track; configure: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];
let root: Root, host: HTMLDivElement, owner: string, premium: boolean, initialKind: StudioKind;
let camera: Track, mic: Track, screen: Track, displayAudio: Track;
let permissions: ReturnType<typeof vi.fn>, display: ReturnType<typeof vi.fn>;
const projects = new Map<string, StudioProject>();
function Screen() { const location = useLocation(), id = new URLSearchParams(location.search).get('project') ?? undefined; return <><output data-location>{location.pathname}</output>{location.pathname === '/studio/record' && <StudioRecordingWorkspace owner={owner} initialKind={initialKind} projectId={id} canUseScenes={premium} onUpgradeScenes={upgrade} />}</>; }
async function mount() { await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={['/studio/record']}><Screen /></MemoryRouter></StrictMode>)); }
const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
async function click(label: string) { const item = button(label); expect(item, label).toBeTruthy(); await act(async () => item!.click()); }
async function answer(label: string) { const dialog = document.querySelector('[role="alertdialog"]'); expect(dialog).toBeTruthy(); const item = [...dialog!.querySelectorAll('button')].find(value => value.textContent?.trim() === label); expect(item).toBeTruthy(); await act(async () => item!.click()); }
async function enterScenes() { await mount(); await click('Gravação com cenas · Premium'); await click('Abrir produção com cenas'); }
async function interruptEncoder(recorder: Recorder) {
  // MediaRecorder becomes inactive before delivering error, final data and stop.
  // No Workspace STOP action runs in this path.
  await act(async () => {
    recorder.state = 'inactive'; recorder.onerror?.();
    recorder.ondataavailable?.({ data: new Blob(['final-composed-frame-and-audio'], { type: recorder.mimeType }) });
    recorder.onstop?.();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  owner = 'owner'; premium = true; initialKind = 'aula'; upgrade.mockReset(); projects.clear(); compositions.length = 0; Recorder.instances = [];
  camera = new Track('video', 'Câmera real autorizada', 'camera'); mic = new Track('audio', 'Microfone autorizado', 'mic'); screen = new Track('video', 'Janela de slides', 'display'); displayAudio = new Track('audio', 'Áudio da tela', 'display-audio');
  permissions = vi.fn(async () => new Stream([camera, mic])); display = vi.fn(async () => new Stream([screen, displayAudio]));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: permissions, getDisplayMedia: display, enumerateDevices: async () => [], addEventListener: vi.fn(), removeEventListener: vi.fn() } });
  vi.stubGlobal('MediaRecorder', Recorder); vi.stubGlobal('MediaStream', Stream); vi.stubGlobal('AudioContext', Audio);
  // Capability feature detection is real; only the transport implementation is a boundary.
  for (const key of ['MediaStreamTrackProcessor', 'MediaStreamTrackGenerator', 'Worker', 'OffscreenCanvas', 'VideoFrame']) vi.stubGlobal(key, function Capability() {});
  io.compose.mockReset().mockImplementation(() => { const track = new Track('video', 'Composição do Worker', `program-${compositions.length}`), entry = { track, configure: vi.fn(async () => undefined), dispose: vi.fn(() => track.stop()) }; compositions.push(entry); return { ...entry, effects: true, ready: async () => undefined, setSource: async () => undefined, removeSource: vi.fn() }; });
  io.create.mockReset().mockImplementation(async (account: string, kind: StudioKind, title: string) => { const value = fixture(account, kind, title); projects.set(value.id, value); return value; });
  io.get.mockReset().mockImplementation(async (_account: string, id: string) => projects.get(id) ?? null);
  io.save.mockReset().mockImplementation(async (_account: string, value: StudioProject) => { const saved = withStudioTakes({ ...value, editing: value.editing!, revision: value.revision + 1 }); projects.set(value.id, saved); return saved; });
  io.put.mockReset().mockResolvedValue(undefined); io.asset.mockReset().mockResolvedValue(null);
  io.readBuffer.mockReset().mockImplementation(async (chunks: Blob[], name: string, type: string) => new File(chunks, name, { type })); io.disposeBuffer.mockReset();
  io.inspect.mockReset().mockImplementation(async (file: File) => ({ kind: 'video', duration: 2, hasAudio: true, width: initialKind === 'short' ? 1080 : 1920, height: initialKind === 'short' ? 1920 : 1080, frameRate: 30, mimeType: file.type, warnings: [] }));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:owned'), configurable: true }); Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  initializeStudioExitGuard(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('produção Premium com Workspace e controller de cenas reais', () => {
  it('Free abre upgrade sem mudar modo, pedir fontes, gravar ou criar projeto; Podcast não oferece cenas', async () => {
    premium = false; await mount(); await click('Gravação com cenas · Premium'); expect(upgrade).toHaveBeenCalledTimes(1);
    expect(button('Gravação com cenas · Premium')?.getAttribute('aria-pressed')).toBe('false'); expect(button('Abrir câmera')).toBeTruthy();
    expect(permissions).not.toHaveBeenCalled(); expect(display).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
    const podcast = [...host.querySelectorAll('.se-recording-formats button')].find(value => value.querySelector('strong')?.textContent === 'Podcast'); await act(async () => (podcast as HTMLButtonElement).click());
    expect(button('Gravação com cenas · Premium')).toBeUndefined(); expect(button('Ativar microfone')).toBeTruthy();
  });

  it('capacidade ausente explica o limite antes de qualquer permissão, mantendo gravação simples', async () => {
    vi.stubGlobal('MediaStreamTrackGenerator', undefined); await mount(); await click('Gravação com cenas · Premium');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Chrome ou Edge'); expect(permissions).not.toHaveBeenCalled(); expect(display).not.toHaveBeenCalled(); expect(button('Abrir câmera')).toBeTruthy();
  });

  it('abre câmera primeiro e compartilha tela só pelo gesto; alterna REC sem trocar Program ou encerrar gravador e preserva take após perda da tela', async () => {
    await enterScenes(); expect(permissions).toHaveBeenCalledTimes(1); expect(display).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled();
    expect(button('Cena 2: Tela')?.disabled).toBe(true); await click('Compartilhar tela'); expect(display).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('Janela de slides');
    await click('Cena 3: Tela + você'); expect(button('Cena 3: Tela + você')?.getAttribute('aria-pressed')).toBe('true');
    const program = host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')!.srcObject;
    await click('Iniciar gravação'); expect(Recorder.instances).toHaveLength(1); const recorder = Recorder.instances[0]; expect(recorder.stream).toBe(program);
    expect(host.querySelector('select[aria-label="Câmera"]')).toBeNull(); expect(button('Compartilhar tela')).toBeUndefined();
    await click('Cena 1: Câmera'); await click('Cena 2: Tela'); expect(recorder.stop).not.toHaveBeenCalled(); expect(recorder.state).toBe('recording'); expect(recorder.stream).toBe(program);
    await act(async () => screen.end()); expect(button('Cena 1: Câmera')?.getAttribute('aria-pressed')).toBe('true'); expect(button('Cena 2: Tela')?.disabled).toBe(true); expect(button('Cena 3: Tela + você')?.disabled).toBe(true);
    expect(host.querySelector('.se-scenes-warning')?.textContent).toContain('compartilhamento terminou'); expect(recorder.stop).not.toHaveBeenCalled(); expect(mic.readyState).toBe('live');
    await click('Encerrar gravação'); expect(io.create).toHaveBeenCalledTimes(1); expect(io.save).toHaveBeenCalledTimes(1); expect([...projects.values()][0].takes).toHaveLength(1); expect(button('Ir para edição')?.disabled).toBe(false);
    expect(compileStudioRecipe([...projects.values()][0]).clips).toHaveLength(1); expect(camera.readyState).toBe('ended'); expect(mic.readyState).toBe('ended');
  });

  it('Short prepara Program1080×1920 real e mantém saída vertical no projeto salvo', async () => {
    initialKind = 'short'; await enterScenes(); expect(io.compose).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 1920, fps: 30 }));
    await click('Iniciar gravação'); await click('Encerrar gravação'); const saved = [...projects.values()][0]; expect(saved.kind).toBe('short'); expect(saved.editing!.assets[0]).toMatchObject({ width: 1080, height: 1920 }); expect(saved.takes).toHaveLength(1);
  });

  it('parada automática do encoder salva o último chunk, capa e um take sem clicar em STOP', async () => {
    io.inspect.mockImplementation(async (file: File) => ({ kind: 'video', duration: 2, hasAudio: true, width: 1920, height: 1080, frameRate: 30, mimeType: file.type, thumbnail: new Blob(['actual-thumbnail'], { type: 'image/jpeg' }), warnings: [] }));
    await enterScenes(); await click('Iniciar gravação'); const recorder = Recorder.instances[0];
    await interruptEncoder(recorder);
    const saved = [...projects.values()][0], original = io.put.mock.calls.find(([, , id]) => !id.endsWith(':thumbnail'));
    expect(recorder.stop).not.toHaveBeenCalled(); expect(original?.[3].size).toBeGreaterThan(0);
    expect(io.create).toHaveBeenCalledTimes(1); expect(io.save).toHaveBeenCalledTimes(1); expect(saved.takes).toHaveLength(1);
    expect(saved.coverUri).toBe(saved.editing!.assets[0].thumbnailUri); expect(io.put.mock.calls.some(([, , id]) => id.endsWith(':thumbnail'))).toBe(true);
    expect(button('Ir para edição')?.disabled).toBe(false); expect(host.textContent).toContain('O gravador foi interrompido');
    expect(camera.readyState).toBe('ended'); expect(mic.readyState).toBe('ended');
  });

  it('perda da última fonte de vídeo encerra e salva o trecho com aviso sem intervenção no botão STOP', async () => {
    await enterScenes(); await click('Iniciar gravação'); const recorder = Recorder.instances[0];
    await act(async () => camera.end());
    expect(recorder.stop).toHaveBeenCalledTimes(1); expect(recorder.state).toBe('inactive');
    expect(io.save).toHaveBeenCalledTimes(1); expect([...projects.values()][0].takes).toHaveLength(1);
    expect(host.textContent).toContain('As fontes de vídeo foram interrompidas'); expect(button('Ir para edição')?.disabled).toBe(false);
    expect(mic.readyState).toBe('ended'); expect(host.querySelector('.se-recording-recovery')).toBeNull();
  });

  it('quota após parada automática conserva o File recuperável e retry salva uma única vez sem nova REC', async () => {
    io.save.mockRejectedValueOnce(Object.assign(new Error('Armazenamento cheio.'), { name: 'QuotaExceededError' }));
    await enterScenes(); await click('Iniciar gravação'); const recorder = Recorder.instances[0]; await interruptEncoder(recorder);
    const original = io.put.mock.calls[0][3] as File, assetId = io.put.mock.calls[0][2];
    expect(host.querySelector('.se-recording-recovery')?.textContent).toContain('Armazenamento cheio');
    expect(button('Tentar salvar take')?.disabled).toBe(false); expect(button('Baixar original')).toBeTruthy(); expect(button('Descartar trecho')).toBeTruthy();
    expect(button('Ir para edição')?.disabled).toBe(true); expect([...projects.values()][0].takes).toHaveLength(0);
    await click('Tentar salvar take');
    expect(io.create).toHaveBeenCalledTimes(1); expect(io.save).toHaveBeenCalledTimes(2); expect([...projects.values()][0].takes).toHaveLength(1);
    expect(io.put.mock.calls.every(([, , id, file]) => id === assetId && file === original)).toBe(true);
    expect(Recorder.instances).toHaveLength(1); expect(permissions).toHaveBeenCalledTimes(1); expect(recorder.stop).not.toHaveBeenCalled();
    expect(host.querySelector('.se-recording-recovery')).toBeNull(); expect(button('Ir para edição')?.disabled).toBe(false);
  });

  it('arquivo de autoSTOP rejeitado pelo decoder continua recuperável e só persiste após revalidação explícita', async () => {
    io.inspect.mockRejectedValueOnce(new Error('O decoder ainda não leu este trecho.'));
    await enterScenes(); await click('Iniciar gravação'); const recorder = Recorder.instances[0]; await interruptEncoder(recorder);
    const original = io.inspect.mock.calls[0][0] as File;
    expect(io.create).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled();
    expect(host.querySelector('.se-recording-recovery')?.textContent).toContain('O decoder ainda não leu este trecho');
    expect(button('Tentar salvar take')?.disabled).toBe(false); expect(button('Baixar original')).toBeTruthy();
    await click('Tentar salvar take');
    expect(io.inspect.mock.calls.every(([file]) => file === original)).toBe(true); expect(io.put.mock.calls[0][3]).toBe(original);
    expect(io.save).toHaveBeenCalledTimes(1); expect([...projects.values()][0].takes).toHaveLength(1);
    expect(recorder.stop).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(1); expect(button('Ir para edição')?.disabled).toBe(false);
  });

  it('falha ao formar File conserva os chunks, bloqueia nova captura e recupera pelo mesmo buffer sem nova REC', async () => {
    io.readBuffer.mockRejectedValueOnce(new Error('A leitura do armazenamento foi interrompida.'));
    await enterScenes(); await click('Iniciar gravação'); const recorder = Recorder.instances[0]; await interruptEncoder(recorder);
    expect(host.querySelector('.se-recording-recovery')?.textContent).toContain('Mantenha esta página aberta');
    expect(button('Tentar salvar take')?.disabled).toBe(false); expect(button('Baixar original')).toBeUndefined(); expect(button('Tentar novamente')).toBeUndefined();
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Câmera"]')?.disabled).toBe(true); expect(button('Ir para edição')?.disabled).toBe(true);
    expect(io.create).not.toHaveBeenCalled(); expect(io.put).not.toHaveBeenCalled(); expect(io.disposeBuffer).not.toHaveBeenCalled();
    await click('Tentar salvar take');
    expect(io.readBuffer).toHaveBeenCalledTimes(2); expect(io.put.mock.calls[0][3].size).toBeGreaterThan(0); expect(io.save).toHaveBeenCalledTimes(1);
    expect([...projects.values()][0].takes).toHaveLength(1); expect(Recorder.instances).toHaveLength(1); expect(permissions).toHaveBeenCalledTimes(1);
    expect(button('Ir para edição')?.disabled).toBe(false); expect(host.querySelector('.se-recording-recovery')).toBeNull();
  });

  it('saída com chunks pendentes pede decisão, conserva ao cancelar ou falhar e só navega depois da recuperação durável', async () => {
    io.readBuffer.mockRejectedValueOnce(new Error('Leitura indisponível.')).mockRejectedValueOnce(new Error('Leitura continua indisponível.'));
    await enterScenes(); await click('Iniciar gravação'); await interruptEncoder(Recorder.instances[0]);
    const beforeUnload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(beforeUnload); expect(beforeUnload.defaultPrevented).toBe(true);
    await click('Voltar aos projetos'); await answer('Cancelar'); expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/record'); expect(io.readBuffer).toHaveBeenCalledTimes(1); expect(io.disposeBuffer).not.toHaveBeenCalled();
    await click('Voltar aos projetos'); await answer('Salvar e sair'); expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/record');
    expect(host.querySelector('.se-recording-recovery')?.textContent).toContain('Leitura continua indisponível'); expect(io.save).not.toHaveBeenCalled(); expect(io.disposeBuffer).not.toHaveBeenCalled();
    await click('Voltar aos projetos'); await answer('Salvar e sair');
    expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/projects'); expect(io.readBuffer).toHaveBeenCalledTimes(3); expect(io.save).toHaveBeenCalledTimes(1); expect([...projects.values()][0].takes).toHaveLength(1);
  });

  it('descarte de chunks sem File requer confirmação e só o aceite libera os dados pendentes', async () => {
    io.readBuffer.mockRejectedValueOnce(new Error('Leitura indisponível.'));
    await enterScenes(); await click('Iniciar gravação'); await interruptEncoder(Recorder.instances[0]);
    await click('Descartar trecho'); await answer('Cancelar'); expect(io.disposeBuffer).not.toHaveBeenCalled(); expect(button('Tentar salvar take')?.disabled).toBe(false);
    await click('Descartar trecho'); await answer('Descartar trecho');
    expect(io.disposeBuffer).toHaveBeenCalledTimes(1); expect(host.querySelector('.se-recording-recovery')).toBeNull(); expect(button('Abrir produção com cenas')).toBeTruthy();
    expect(io.create).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(1);
  });

  it('cancelar saída durante picker mantém câmera e reserva; confirmar saída invalida compartilhamento tardio sem criar take', async () => {
    const choosing = deferred<Stream>(); display.mockReturnValue(choosing.promise); await enterScenes(); await click('Compartilhar tela');
    expect(button('Iniciar gravação')?.disabled).toBe(true); await click('Voltar aos projetos'); await answer('Cancelar'); expect(camera.readyState).toBe('live'); expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/record');
    await click('Voltar aos projetos'); await answer('Sair'); expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/projects'); expect(camera.readyState).toBe('ended');
    await act(async () => choosing.resolve(new Stream([screen, displayAudio]))); expect(screen.readyState).toBe('ended'); expect(displayAudio.readyState).toBe('ended'); expect(io.create).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled();
  });

  it('troca de owner invalida picker pendente e não contamina novas fontes/projeto', async () => {
    const choosing = deferred<Stream>(); display.mockReturnValue(choosing.promise); await enterScenes(); await click('Compartilhar tela'); owner = 'other'; premium = false; await mount();
    await act(async () => choosing.resolve(new Stream([screen, displayAudio]))); expect(screen.readyState).toBe('ended'); expect(camera.readyState).toBe('ended'); expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('setup'); expect(button('Gravação com cenas · Premium')?.getAttribute('aria-pressed')).toBe('false'); expect(io.create).not.toHaveBeenCalled(); expect(io.save).not.toHaveBeenCalled();
  });

  it('expiração Premium durante REC preserva gravador e salvamento, mas próxima abertura exige upgrade', async () => {
    await enterScenes(); await click('Iniciar gravação'); const recorder = Recorder.instances[0]; premium = false; await mount();
    expect(recorder.state).toBe('recording'); expect(recorder.stop).not.toHaveBeenCalled(); await click('Cena 1: Câmera'); await click('Encerrar gravação'); expect(io.save).toHaveBeenCalledTimes(1); expect([...projects.values()][0].takes).toHaveLength(1);
    await click('Gravar outro take'); expect(upgrade).toHaveBeenCalledTimes(1); expect(permissions).toHaveBeenCalledTimes(1); expect(Recorder.instances).toHaveLength(1); expect(io.save).toHaveBeenCalledTimes(1);
  });

  it('expiração antes do início bloqueia REC mesmo com fontes já preparadas', async () => {
    await enterScenes(); premium = false; await mount(); await click('Iniciar gravação'); expect(upgrade).toHaveBeenCalledTimes(1); expect(Recorder.instances).toHaveLength(0); expect(camera.readyState).toBe('live'); expect(io.create).not.toHaveBeenCalled();
  });

  it('posição, tamanho e fade configuram o compositor durante REC; atalhos funcionam no palco e não roubam inputs', async () => {
    await enterScenes(); await click('Compartilhar tela'); await click('Iniciar gravação'); const recorder = Recorder.instances[0];
    await click('Ajustar composição'); await click('Câmera no canto superior esquerdo');
    const size = host.querySelector<HTMLInputElement>('input[aria-label="Tamanho da câmera na cena"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(size, '.4'); size.dispatchEvent(new Event('input', { bubbles: true })); });
    const transition = host.querySelector<HTMLSelectElement>('select[aria-label="Transição entre cenas"]')!;
    await act(async () => { transition.value = 'fade'; transition.dispatchEvent(new Event('change', { bubbles: true })); });
    const compositor = compositions.at(-1)!;
    expect(compositor.configure).toHaveBeenLastCalledWith('camera', expect.objectContaining({ position: { x: .18, y: .2 }, size: .4, transition: 'fade' }), expect.any(Object), expect.any(Number));
    await act(async () => size.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))); expect(button('Cena 1: Câmera')?.getAttribute('aria-pressed')).toBe('true');
    await click('Fechar ajustes de cenas');
    await act(async () => button('Cena 1: Câmera')!.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))); expect(button('Cena 3: Tela + você')?.getAttribute('aria-pressed')).toBe('true');
    expect(compositor.configure).toHaveBeenLastCalledWith('screen-camera', expect.objectContaining({ size: .4, transition: 'fade' }), expect.any(Object), expect.any(Number)); expect(recorder.stop).not.toHaveBeenCalled(); expect(recorder.state).toBe('recording');
    await click('Encerrar gravação');
  });

  it('cancelar o picker mantém Program/câmera disponíveis e permite nova seleção explícita sem criar take', async () => {
    display.mockRejectedValueOnce(new DOMException('Pedido cancelado', 'NotAllowedError')); await enterScenes();
    const preview = host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]')!, program = preview.srcObject;
    await click('Compartilhar tela'); expect(preview.srcObject).toBe(program); expect(camera.readyState).toBe('live'); expect(mic.readyState).toBe('live'); expect(button('Cena 2: Tela')?.disabled).toBe(true); expect(button('Iniciar gravação')?.disabled).toBe(false); expect(io.create).not.toHaveBeenCalled();
    await click('Compartilhar tela'); expect(display).toHaveBeenCalledTimes(2); expect(button('Cena 2: Tela')?.disabled).toBe(false); expect(preview.srcObject).toBe(program); expect(permissions).toHaveBeenCalledTimes(1);
  });

  it('ocultar a aba de cenas não encerra REC nem cria take; parar explícito persiste uma única montagem', async () => {
    await enterScenes(); await click('Compartilhar tela'); await click('Cena 3: Tela + você'); await click('Iniciar gravação'); const recorder = Recorder.instances[0];
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(recorder.state).toBe('recording'); expect(recorder.stop).not.toHaveBeenCalled(); expect(camera.readyState).toBe('live'); expect(screen.readyState).toBe('live'); expect(io.create).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await click('Encerrar gravação'); expect(io.save).toHaveBeenCalledTimes(1); expect([...projects.values()][0].takes).toHaveLength(1);
  });
});

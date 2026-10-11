import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileStudioRecipe, emptyStudioEditing, withStudioTakes, type StudioKind, type StudioProject } from '../../../../shared/studio';
import { StudioRecordingWorkspace } from './StudioRecordingWorkspace';
import { initializeStudioExitGuard } from './useStudioExitGuard';

const io = vi.hoisted(() => ({ inspect: vi.fn(), create: vi.fn(), get: vi.fn(), save: vi.fn(), put: vi.fn(), asset: vi.fn() }));
vi.mock('@/lib/studio/editor/media', () => ({ inspectStudioMedia: io.inspect }));
vi.mock('@/lib/studio/editor/storage', () => ({
  createProject: io.create, getProject: io.get, saveProject: io.save, putAsset: io.put, getAsset: io.asset,
  studioAssetUri: (owner: string, project: string, asset: string, name: string) => `file://classfy-studio/${[owner, project, asset, name].map(encodeURIComponent).join('/')}`,
}));

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Track {
  id: string; label: string; readyState = 'live'; onended: null | (() => void) = null; onmute = null;
  constructor(public kind = 'audio', public deviceId = kind === 'audio' ? 'usb-id' : 'camera-id', name?: string) { this.id = `${kind}-${deviceId}`; this.label = name ?? (kind === 'audio' ? 'USB Microphone' : 'Camera autorizada'); }
  stop = vi.fn(() => { this.readyState = 'ended'; }); getSettings() { return { deviceId: this.deviceId, width: 1920, height: 1080, frameRate: 30 }; }
}
class Stream {
  constructor(public tracks = [new Track()]) {} getTracks() { return this.tracks; } getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); } getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
}
class Recorder {
  static instances: Recorder[] = []; static isTypeSupported() { return true; }
  state = 'inactive'; mimeType: string; ondataavailable: null | ((e: { data: Blob }) => void) = null; onstop: null | (() => void) = null; onerror = null;
  constructor(_stream: unknown, options: { mimeType: string }) { this.mimeType = options.mimeType; Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop = vi.fn(() => { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['encoded-original'], { type: this.mimeType }) }); this.onstop?.(); }); });
}
class Audio {
  resume = vi.fn(async () => {}); close = vi.fn(async () => {}); createMediaStreamSource() { return { connect: vi.fn() }; }
  createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(samples: Float32Array) { samples.fill(.5); } }; }
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
  return <><output data-location>{location.pathname}{location.search}</output>{location.pathname === '/studio/record' ? <StudioRecordingWorkspace owner={owner} initialKind={initialKind} initialTitle={title} projectId={id} /> : <p>Destino alcançado</p>}</>;
}
async function mount(url = '/studio/record', browser = false) {
  await act(async () => root.render(<StrictMode>{browser ? <BrowserRouter><Screen /></BrowserRouter> : <MemoryRouter initialEntries={[url]}><Screen /></MemoryRouter>}</StrictMode>));
}
function button(label: string) { return [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label); }
async function click(label: string) { const target = button(label); expect(target, label).toBeTruthy(); await act(async () => target!.click()); }
async function format(label: string) { const target = [...host.querySelectorAll('.se-recording-formats button')].find(b => b.querySelector('strong')?.textContent === label); expect(target).toBeTruthy(); await act(async () => (target as HTMLButtonElement).click()); }
async function select(label: 'Câmera' | 'Microfone', id: string) {
  const target = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  expect(target).toBeTruthy(); await act(async () => { target.value = id; target.dispatchEvent(new Event('change', { bubbles: true })); });
}
const activeVisibility = () => {
  const listeners = new Set(added.mock.calls.filter(([name]) => name === 'visibilitychange').map(([, listener]) => listener));
  removed.mock.calls.filter(([name]) => name === 'visibilitychange').forEach(([, listener]) => listeners.delete(listener)); return listeners.size;
};
async function record() { await click(initialKind === 'podcast' ? 'Ativar microfone' : 'Abrir câmera'); await click('Iniciar gravação'); await click('Encerrar gravação'); }
async function pop(index: number, url: string) { window.history.replaceState({ idx: index, key: `entry-${index}` }, '', url); await act(async () => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  projects.clear(); assets.clear(); Recorder.instances = []; owner = 'owner'; initialKind = 'aula'; title = '';
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
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  added = vi.spyOn(document, 'addEventListener'); removed = vi.spyOn(document, 'removeEventListener');
  initializeStudioExitGuard(); window.history.replaceState({ idx: 1, key: 'record' }, '', '/studio/record');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('funil de gravação com componente, captura e sessão reais', () => {
  it('StrictMode não abre permissão nem rascunho; formato e gesto abrem uma única captura com monitor real', async () => {
    vi.useFakeTimers(); await mount(); expect(permissions).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled(); expect(activeVisibility()).toBe(1);
    await format('Podcast'); await click('Ativar microfone'); expect(permissions).toHaveBeenCalledTimes(1); expect(host.querySelector('[aria-label="Microfone em uso: USB Microphone"]')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(100)); expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('-6.020599913279624');
    await click('Iniciar gravação'); expect(host.querySelector('header')).toBeNull(); expect(host.querySelector('.se-recording-takes')).toBeNull(); expect(button('Trocar câmera')).toBeUndefined(); expect(host.querySelector('[role="timer"]')).toBeTruthy();
    await click('Encerrar gravação'); expect(io.save).toHaveBeenCalledTimes(1); expect(Recorder.instances).toHaveLength(1); expect(host.textContent).toContain('Takes salvos');
    await act(async () => root.unmount()); expect(activeVisibility()).toBe(0);
  });

  it('espera salvamento durável, mantém sessão após query replace e concatena dois takes antes de excluir/editar', async () => {
    const saved = deferred<StudioProject>(), originalSave = io.save.getMockImplementation()!; io.save.mockImplementationOnce(async (account, value) => { await saved.promise; return originalSave(account, value); });
    await mount(); await record(); expect(button('Ir para edição')?.disabled).toBe(true); expect(host.querySelector('.se-recording-take')).toBeNull();
    await act(async () => saved.resolve(fixture())); expect(button('Ir para edição')?.disabled).toBe(false); expect(host.querySelector('[data-location]')?.textContent).toContain('?project=');
    expect(host.querySelector('.se-recording')?.getAttribute('data-stage')).toBe('production'); expect(activeVisibility()).toBe(1);
    await click('Gravar outro take'); await click('Iniciar gravação'); await click('Encerrar gravação'); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(2); expect(io.create).toHaveBeenCalledTimes(1); expect(io.save).toHaveBeenCalledTimes(2);
    const value = [...projects.values()][0]; expect(compileStudioRecipe(value).durationTicks).toBe(480000);
    await click('Excluir take 1'); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1); expect(assets.size).toBe(4);
    await click('Ir para edição'); expect(host.querySelector('[data-location]')?.textContent).toBe(`/studio/projects/${value.id}`); expect(activeVisibility()).toBe(0);
  });

  it('erro de escrita mantém o mesmo File/IDs, permite backup e repete sem permissão/REC/duplicação', async () => {
    io.save.mockRejectedValueOnce(new Error('Sem espaço para salvar.')); await mount(); await record(); expect(host.textContent).toContain('Sem espaço');
    expect(button('Ir para edição')?.disabled).toBe(true); const original = io.put.mock.calls[0][3], assetIds = io.put.mock.calls.map(args => args[2]);
    const clickDownload = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined); vi.useFakeTimers(); await click('Baixar original'); expect(URL.createObjectURL).toHaveBeenLastCalledWith(original); expect(clickDownload).toHaveBeenCalledTimes(1); await act(async () => vi.advanceTimersByTime(1000)); expect(URL.revokeObjectURL).toHaveBeenCalled(); vi.useRealTimers();
    await click('Tentar salvar take'); expect(io.put.mock.calls.map(args => args[2])).toEqual(assetIds); expect(io.save).toHaveBeenCalledTimes(2); expect(permissions).toHaveBeenCalledTimes(1); expect(Recorder.instances).toHaveLength(1); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1);
  });

  it('erro de metadados retém arquivo e libera dispositivos; retry lê os mesmos bytes e salva automaticamente', async () => {
    io.inspect.mockRejectedValueOnce(new Error('Decoder temporariamente ocupado.')); await mount(); await record(); const original = io.inspect.mock.calls[0][0];
    expect(io.create).not.toHaveBeenCalled(); expect(host.textContent).toContain('Decoder'); expect(button('Baixar original')).toBeTruthy();
    const stream = await permissions.mock.results[0].value; expect(stream.tracks.every((t: Track) => t.stop.mock.calls.length === 1)).toBe(true);
    await click('Tentar salvar take'); expect(io.inspect.mock.calls[1][0]).toBe(original); expect(io.put.mock.calls[0][3]).toBe(original); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1); expect(Recorder.instances).toHaveLength(1);
  });

  it('Short mantém enquadramento cover e formato carregado fica travado após excluir o último take', async () => {
    initialKind = 'short'; await mount(); await record(); const value = [...projects.values()][0]; expect(value.editing!.main[0].fit).toBe('cover');
    expect(host.querySelector('.se-recording-stage.short')).toBeTruthy(); await click('Excluir take 1'); expect(button('Ir para edição')?.disabled).toBe(true);
    await click('Voltar à preparação'); const formatButtons = [...host.querySelectorAll('.se-recording-formats button')] as HTMLButtonElement[]; expect(formatButtons.every(b => b.disabled)).toBe(true);
    await format('Podcast'); await click('Abrir câmera'); expect(permissions.mock.calls.at(-1)![0].video).toBeTruthy(); await click('Iniciar gravação'); await click('Encerrar gravação'); expect([...projects.values()][0].kind).toBe('short'); expect(io.create).toHaveBeenCalledTimes(1);
  });

  it('saída tranquila não pede confirmação nem trava leaving; captura pronta é encerrada antes de voltar', async () => {
    await mount(); await click('Abrir câmera'); const stream = await permissions.mock.results[0].value; await click('Voltar aos projetos');
    expect(window.confirm).not.toHaveBeenCalled(); expect(host.querySelector('[data-location]')?.textContent).toBe('/studio/projects'); expect(stream.tracks.every((t: Track) => t.stop.mock.calls.length === 1)).toBe(true);
  });

  it('POP cancelado preserva REC; POP confirmado espera o take durável antes de liberar histórico', async () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined); await mount('/studio/record', true); await click('Abrir câmera'); await click('Iniciar gravação');
    vi.mocked(window.confirm).mockReturnValueOnce(false); await pop(0, '/studio/projects'); await pop(1, '/studio/record'); expect(host.querySelector('.is-recording')).toBeTruthy(); expect(io.save).not.toHaveBeenCalled(); expect(go).toHaveBeenCalledTimes(1);
    const held = deferred<void>(), save = io.save.getMockImplementation()!; io.save.mockImplementationOnce(async (...args) => { await held.promise; return save(...args); });
    await pop(0, '/studio/projects'); await pop(1, '/studio/record'); expect(go).toHaveBeenCalledTimes(2); expect(host.querySelector('.se-recording')).toBeTruthy();
    await act(async () => held.resolve()); expect(go).toHaveBeenLastCalledWith(-1); expect([...projects.values()][0].takes).toHaveLength(1); await pop(0, '/studio/projects'); expect(host.querySelector('.se-recording')).toBeNull();
  });

  it('saída durante remoção espera receipt e mantém página quando a transação falha', async () => {
    await mount(); await record(); const held = deferred<StudioProject>(); io.save.mockImplementationOnce(() => held.promise);
    await click('Excluir take 1'); expect(host.textContent).toContain('Removendo take'); await click('Voltar aos projetos'); expect(host.querySelector('.se-recording')).toBeTruthy();
    await act(async () => held.reject(new Error('Falha removendo take.'))); expect(host.querySelector('[data-location]')?.textContent).toContain('/studio/record'); expect(button('Voltar aos projetos')?.disabled).toBe(false); expect(host.querySelectorAll('.se-recording-take')).toHaveLength(1);
  });

  it('owner novo invalida permissão e salvamento antigos sem navegação/controle da conta anterior', async () => {
    const permission = deferred<Stream>(); permissions.mockReturnValueOnce(permission.promise); await mount(); await click('Abrir câmera'); owner = 'other'; await mount();
    const late = new Stream([new Track('video'), new Track()]); await act(async () => permission.resolve(late)); expect(late.tracks.every(t => t.stop.mock.calls.length === 1)).toBe(true); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(activeVisibility()).toBe(1);
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
    await click('Iniciar gravação');
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
    expect(host.querySelector('[data-permission-state="preparing"]')).toBeTruthy(); expect(host.textContent).toContain('Quando o navegador pedir');
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(button('Iniciar gravação')).toBeUndefined();
    expect((host.querySelector('select[aria-label="Câmera"]') as HTMLSelectElement).disabled).toBe(true);
    await act(async () => pending.reject(new DOMException('Permission denied', 'NotAllowedError')));
    expect(host.querySelector('[data-permission-state="error"]')).toBeTruthy(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Permita câmera e microfone');
    expect(host.textContent).not.toContain('Permission denied'); expect(host.textContent).toContain('ícone ao lado do endereço');
    await click('Tentar novamente'); expect(permissions).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-permission-state]')).toBeNull(); expect(button('Iniciar gravação')?.disabled).toBe(false);
  });

  it('erro de entrada ocupada mostra orientação de dispositivo, sem diagnosticar permissão negada', async () => {
    permissions.mockRejectedValueOnce(new DOMException('Could not start video source', 'NotReadableError'));
    await mount(); await click('Abrir câmera');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Feche outro aplicativo');
    expect(host.textContent).toContain('conexão do dispositivo'); expect(host.textContent).not.toContain('ícone ao lado do endereço');
    expect(host.textContent).not.toContain('Could not start video source'); expect(button('Tentar novamente')).toBeTruthy();
  });

  it('sair durante troca de entrada pendente cancela sem aguardar permissão e fecha tracks tardios', async () => {
    await mount(); await click('Abrir câmera'); const original = await permissions.mock.results[0].value;
    const pending = deferred<Stream>(); permissions.mockReturnValueOnce(pending.promise);
    await select('Câmera', 'continuity-id'); expect(button('Iniciar gravação')).toBeUndefined(); expect(host.textContent).toContain('Abrindo entrada');
    await click('Voltar aos projetos'); expect(window.confirm).toHaveBeenCalledWith('Cancelar a abertura da captura e sair?');
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
    expect(window.confirm).not.toHaveBeenCalled(); expect(original.tracks.every((track: Track) => track.readyState === 'ended')).toBe(true);
  });

  it('take strip recolhe sem alterar montagem, câmera ou revisão e reabre com exclusão acessível', async () => {
    await mount(); await record(); const saved = [...projects.values()][0], source = host.querySelector('video[aria-label="Reproduzir take salvo"]')?.getAttribute('src');
    await click('Recolher takes salvos');
    expect(host.querySelector('#se-recording-saved-takes')?.hasAttribute('hidden')).toBe(true); expect(button('Mostrar takes salvos')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('video[aria-label="Reproduzir take salvo"]')?.getAttribute('src')).toBe(source); expect(io.save).toHaveBeenCalledTimes(1);
    await click('Mostrar takes salvos'); expect(host.querySelector('#se-recording-saved-takes')?.hasAttribute('hidden')).toBe(false);
    expect(button('Excluir take 1')?.disabled).toBe(false); expect(compileStudioRecipe([...projects.values()][0])).toEqual(compileStudioRecipe(saved)); expect(permissions).toHaveBeenCalledTimes(1);
  });
});

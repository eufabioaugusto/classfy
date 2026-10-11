import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioCaptureState } from '@/lib/studio/editor/capture';
import { useStudioSceneDirector } from './useStudioSceneDirector';

type Options = Parameters<typeof useStudioSceneDirector>[0];
let root: Root, host: HTMLElement, frame: HTMLIFrameElement, pip: Window;
let api: ReturnType<typeof useStudioSceneDirector>, options: Options, closed: boolean;
const select = vi.fn(), stop = vi.fn(), microphone = vi.fn(), start = vi.fn();
let request: ReturnType<typeof vi.fn>, previous: PropertyDescriptor | undefined;
const stream = {} as MediaStream;
function ready(): StudioCaptureState {
  return { phase: 'ready', stream, elapsed: 0, file: null, error: null,
    input: { id: 'usb', name: 'Microfone USB' }, camera: { id: 'cam', name: 'Câmera autorizada' }, devices: { cameras: [], microphones: [] },
    microphoneEnabled: true, levels: [{ averageDb: -12, peakDb: -4 }], scenes: { selected: 'camera', cameraReady: true, screenReady: false, screenName: null, position: { x: .85, y: .8 }, size: .2, transition: 'fade', preparingScreen: false, backgroundSupported: true, error: null } } as StudioCaptureState;
}
function Harness() { api = useStudioSceneDirector(options); return <><button onClick={() => void api.open()}>Abrir</button>{api.portal}</>; }
async function render(patch: Partial<Options> = {}) { options = { ...options, ...patch }; await act(async () => root.render(<StrictMode><Harness /></StrictMode>)); }
function button(label: string) { const result = [...pip.document.querySelectorAll<HTMLButtonElement>('button')].find(value => value.getAttribute('aria-label') === label || value.textContent === label); expect(result, label).toBeTruthy(); return result!; }
async function click(label: string) { await act(async () => button(label).click()); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  frame = document.createElement('iframe'); document.body.append(frame); pip = frame.contentWindow!; closed = false;
  Object.defineProperty(pip, 'closed', { configurable: true, get: () => closed });
  vi.spyOn(pip, 'close').mockImplementation(() => { closed = true; pip.dispatchEvent(new Event('pagehide')); });
  vi.spyOn(pip, 'focus').mockImplementation(() => undefined);
  request = vi.fn().mockResolvedValue(pip); previous = Object.getOwnPropertyDescriptor(window, 'documentPictureInPicture');
  Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow: request } });
  options = { scope: 'owner/project', state: ready(), onScene: select, onStop: stop, onMicrophone: microphone, onStart: start };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); frame.remove();
  if (previous) Object.defineProperty(window, 'documentPictureInPicture', previous); else Reflect.deleteProperty(window, 'documentPictureInPicture');
  vi.restoreAllMocks(); select.mockClear(); stop.mockClear(); microphone.mockClear(); start.mockClear();
});

describe('controle flutuante com janela própria e sessão contínua', () => {
  it('não abre janela antes do gesto; limita cenas por fonte e compartilha as ações do Studio', async () => {
    await render(); expect(api.supported).toBe(true); expect(request).not.toHaveBeenCalled();
    await act(async () => api.open()); expect(request).toHaveBeenCalledWith({ width: 430, height: 380 }); expect(api.isOpen).toBe(true);
    expect(button('Cena 2: Tela').disabled).toBe(true); expect(button('Cena 3: Tela + você').disabled).toBe(true);
    await click('Cena 1: Câmera'); expect(select).toHaveBeenLastCalledWith('camera'); await click('Gravar take'); expect(start).toHaveBeenCalledOnce();
    await render({ state: { ...ready(), phase: 'recording', elapsed: 72, scenes: { ...ready().scenes!, screenReady: true, selected: 'screen-camera' } } });
    expect(pip.document.querySelector('time')?.textContent).toBe('1:12'); expect(button('Cena 3: Tela + você').getAttribute('aria-pressed')).toBe('true');
    await click('Cena 2: Tela'); expect(select).toHaveBeenLastCalledWith('screen'); await click('Silenciar microfone'); expect(microphone).toHaveBeenLastCalledWith(false);
    await click('Parar e salvar take'); expect(stop).toHaveBeenCalledOnce(); expect(options.state.stream).toBe(stream);
  });
  it('fechar o controle mantém REC e permite abrir novamente', async () => {
    await render({ state: { ...ready(), phase: 'recording' } }); await act(async () => api.open());
    await click('Fechar controle flutuante'); expect(pip.close).toHaveBeenCalledOnce(); expect(api.isOpen).toBe(false); expect(stop).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
  });
  it('pagehide da janela só encerra o portal e não o take', async () => {
    await render(); await act(async () => api.open());
    await act(async () => { closed = true; pip.dispatchEvent(new Event('pagehide')); });
    expect(api.isOpen).toBe(false); expect(stop).not.toHaveBeenCalled(); expect(pip.close).not.toHaveBeenCalled();
  });
  it('cliques repetidos reutilizam janela existente e não pedem duas janelas em paralelo', async () => {
    let resolve!: (value: Window) => void; request.mockReturnValue(new Promise<Window>(done => { resolve = done; })); await render();
    let opening!: Promise<void>; await act(async () => { opening = api.open(); void api.open(); }); expect(request).toHaveBeenCalledOnce();
    await act(async () => { resolve(pip); await opening; }); await act(async () => api.open());
    expect(request).toHaveBeenCalledOnce(); expect(pip.focus).toHaveBeenCalledOnce();
  });
  it('resposta após troca de owner/projeto fecha janela sem ações na nova sessão', async () => {
    let resolve!: (value: Window) => void; request.mockReturnValue(new Promise<Window>(done => { resolve = done; })); await render();
    let opening!: Promise<void>; await act(async () => { opening = api.open(); }); await render({ scope: 'other-owner/other-project' });
    await act(async () => { resolve(pip); await opening; }); expect(api.isOpen).toBe(false); expect(pip.close).toHaveBeenCalledOnce(); expect(stop).not.toHaveBeenCalled();
  });
  it('unmount durante abertura fecha o resultado tardio e não mantém janela órfã', async () => {
    let resolve!: (value: Window) => void; request.mockReturnValue(new Promise<Window>(done => { resolve = done; })); await render();
    let opening!: Promise<void>; await act(async () => { opening = api.open(); }); await act(async () => root.render(null));
    await act(async () => { resolve(pip); await opening; }); expect(pip.close).toHaveBeenCalledOnce(); expect(stop).not.toHaveBeenCalled();
  });
  it('bloqueio de decisão e perda da fonte desabilitam comandos, sem atalhos atravessarem campos', async () => {
    await render(); await act(async () => api.open());
    await render({ blocked: true }); await click('Cena 1: Câmera'); expect(select).not.toHaveBeenCalled(); expect(button('Silenciar microfone').disabled).toBe(true);
    await render({ blocked: false, state: { ...ready(), scenes: { ...ready().scenes!, cameraReady: false, screenReady: true, selected: 'screen' } } });
    expect(button('Cena 1: Câmera').disabled).toBe(true); expect(button('Cena 3: Tela + você').disabled).toBe(true);
    const section = pip.document.querySelector<HTMLElement>('.se-director')!;
    const input = pip.document.createElement('input'); section.append(input);
    const typing = new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }); await act(async () => input.dispatchEvent(typing)); expect(typing.defaultPrevented).toBe(false); expect(select).not.toHaveBeenCalled();
    const scene = new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }); await act(async () => section.dispatchEvent(scene)); expect(scene.defaultPrevented).toBe(true); expect(select).toHaveBeenLastCalledWith('screen');
  });
  it('encerrar sessão fecha somente janela própria; browser sem API tem fallback no Studio', async () => {
    await render(); await act(async () => api.open()); await render({ state: { ...ready(), phase: 'recorded', stream: null } }); expect(api.isOpen).toBe(false); expect(pip.close).toHaveBeenCalledOnce();
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined }); await render({ state: ready() }); expect(api.supported).toBe(false);
    await expect(api.open()).rejects.toThrow('controles do Studio'); expect(stop).not.toHaveBeenCalled();
  });
  it('negação de janela devolve erro legível sem interromper REC', async () => {
    request.mockRejectedValue(new DOMException('denied', 'NotAllowedError')); await render({ state: { ...ready(), phase: 'recording' } });
    await expect(api.open()).rejects.toThrow('permita a janela'); expect(api.isOpen).toBe(false); expect(stop).not.toHaveBeenCalled();
  });
});

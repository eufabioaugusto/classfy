import { StrictMode, act, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWatchFloatingPlayer } from './useWatchFloatingPlayer';

type Options = Parameters<typeof useWatchFloatingPlayer>[0];
type Floating = ReturnType<typeof useWatchFloatingPlayer>;
type MediaAction = (() => void) | null;

let root: Root, host: HTMLElement, frame: HTMLIFrameElement, pip: Window;
let options: Options, api: Floating, closed: boolean;
let request: ReturnType<typeof vi.fn>;
let originalDocumentPiP: PropertyDescriptor | undefined;
let originalMediaSession: PropertyDescriptor | undefined;
let originalPiPEnabled: PropertyDescriptor | undefined;
let originalPiPElement: PropertyDescriptor | undefined;
let originalExitPiP: PropertyDescriptor | undefined;
let originalNativeRequest: PropertyDescriptor | undefined;
let nativeElement: Element | null;
const setNativeElement = (element: Element | null) => { nativeElement = element; };
const handlers = new Map<string, MediaAction>();
const setActionHandler = vi.fn((action: string, handler: MediaAction) => handlers.set(action, handler));

function Harness() {
  api = useWatchFloatingPlayer(options);
  return <>
    <div data-original-stage>
      {options.audioOnly
        ? <audio ref={options.mediaRef as RefObject<HTMLAudioElement>} src="https://media.example/audio.mp3" />
        : <video ref={options.mediaRef as RefObject<HTMLVideoElement>} src="https://media.example/video.mp4" />}
      <span data-original-next />
    </div>
    <button type="button" onClick={() => void api.open()}>Abrir mini player</button>
    {api.portal}
  </>;
}

async function render(patch: Partial<Options> = {}) {
  options = { ...options, ...patch };
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
}

function defer<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function disableDocumentPiP() {
  Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
}

function enableNativePiP() {
  disableDocumentPiP();
  Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true });
  const exit = vi.fn(async () => {
    const previous = nativeElement;
    nativeElement = null;
    previous?.dispatchEvent(new Event('leavepictureinpicture'));
  });
  Object.defineProperty(document, 'exitPictureInPicture', { configurable: true, value: exit });
  const nativeRequest = vi.fn(async function (this: HTMLVideoElement) {
    setNativeElement(this);
    this.dispatchEvent(new Event('enterpictureinpicture'));
    return { width: 420, height: 236 };
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', { configurable: true, value: nativeRequest });
  return { request: nativeRequest, exit };
}

function restoreProperty(object: object, key: string, value: PropertyDescriptor | undefined) {
  if (value) Object.defineProperty(object, key, value);
  else Reflect.deleteProperty(object, key);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  frame = document.createElement('iframe'); document.body.append(frame); pip = frame.contentWindow!;
  closed = false; nativeElement = null;
  Object.defineProperty(pip, 'closed', { configurable: true, get: () => closed });
  vi.spyOn(pip, 'close').mockImplementation(() => { closed = true; pip.dispatchEvent(new Event('pagehide')); });
  vi.spyOn(pip, 'focus').mockImplementation(() => undefined);
  vi.spyOn(window, 'focus').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  originalDocumentPiP = Object.getOwnPropertyDescriptor(window, 'documentPictureInPicture');
  originalMediaSession = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
  originalPiPEnabled = Object.getOwnPropertyDescriptor(document, 'pictureInPictureEnabled');
  originalPiPElement = Object.getOwnPropertyDescriptor(document, 'pictureInPictureElement');
  originalExitPiP = Object.getOwnPropertyDescriptor(document, 'exitPictureInPicture');
  originalNativeRequest = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'requestPictureInPicture');
  request = vi.fn().mockResolvedValue(pip);
  Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow: request } });
  Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => nativeElement });
  handlers.clear(); setActionHandler.mockClear();
  Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: { setActionHandler } });
  options = { mediaRef: { current: null }, scope: 'viewer/video-a', title: 'Aula em foco', creator: 'Classfy',
    poster: 'https://media.example/poster.jpg', enabled: true, isPlaying: true };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); frame.remove();
  restoreProperty(window, 'documentPictureInPicture', originalDocumentPiP);
  restoreProperty(navigator, 'mediaSession', originalMediaSession);
  restoreProperty(document, 'pictureInPictureEnabled', originalPiPEnabled);
  restoreProperty(document, 'pictureInPictureElement', originalPiPElement);
  restoreProperty(document, 'exitPictureInPicture', originalExitPiP);
  restoreProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', originalNativeRequest);
  vi.restoreAllMocks();
});

describe('mini player externo do Watch preserva a mídia e seu dono', () => {
  it('pede a janela na mesma chamada do gesto, sem abrir por montagem ou visibilidade', async () => {
    await render(); expect(api.supported).toBe(true); expect(request).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(request).not.toHaveBeenCalled();
    const pending = defer<Window>(); request.mockReturnValueOnce(pending.promise);
    let opening!: Promise<void>;
    await act(async () => {
      opening = api.open();
      expect(request).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledWith(expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }));
    });
    await act(async () => { pending.resolve(pip); await opening; });
    expect(api.isOpen).toBe(true);
  });

  it('adota o mesmo vídeo sem clonar, recarregar fonte, perder posição ou iniciar outra reprodução', async () => {
    await render(); const media = options.mediaRef.current!;
    const originalParent = media.parentNode, next = media.nextSibling;
    media.currentTime = 42; media.volume = .4; media.muted = true; media.playbackRate = 1.5;
    const source = media.getAttribute('src');
    await act(async () => api.open());
    expect(options.mediaRef.current).toBe(media);
    expect(pip.document.querySelector('video')).toBe(media);
    expect(host.querySelector('video')).toBeNull();
    expect(media.ownerDocument).toBe(pip.document);
    expect(media.currentTime).toBe(42); expect(media.volume).toBe(.4); expect(media.muted).toBe(true); expect(media.playbackRate).toBe(1.5);
    expect(media.getAttribute('src')).toBe(source);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled(); expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    await act(async () => api.close());
    expect(media.parentNode).toBe(originalParent); expect(media.nextSibling).toBe(next); expect(media.ownerDocument).toBe(document);
    expect(media.currentTime).toBe(42); expect(media.getAttribute('src')).toBe(source);
    expect(api.isOpen).toBe(false); expect(pip.close).toHaveBeenCalledOnce();
  });

  it('fechar pelo navegador restaura o vídeo na posição original e não pausa a reprodução', async () => {
    await render(); const media = options.mediaRef.current!, parent = media.parentNode, next = media.nextSibling;
    await act(async () => api.open());
    await act(async () => { closed = true; pip.dispatchEvent(new Event('pagehide')); });
    expect(media.parentNode).toBe(parent); expect(media.nextSibling).toBe(next); expect(media.ownerDocument).toBe(document);
    expect(api.isOpen).toBe(false); expect(pip.close).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it('unmount devolve o nó antes da remoção React e não deixa janela ou mídia órfã', async () => {
    await render(); const media = options.mediaRef.current!, parent = media.parentNode!;
    await act(async () => api.open());
    await act(async () => root.render(null));
    expect(pip.close).toHaveBeenCalledOnce(); expect(pip.document.querySelector('video')).toBeNull();
    expect(media.ownerDocument).toBe(document); expect(parent.contains(media)).toBe(true);
    expect(host.childElementCount).toBe(0); expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it('cliques repetidos compartilham abertura pendente e depois focam a janela existente', async () => {
    const pending = defer<Window>(); request.mockReturnValueOnce(pending.promise); await render();
    let opening!: Promise<void>;
    await act(async () => { opening = api.open(); void api.open(); }); expect(request).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(pip); await opening; });
    await act(async () => api.open());
    expect(request).toHaveBeenCalledOnce(); expect(pip.focus).toHaveBeenCalledOnce();
  });

  it.each([
    ['troca de conteúdo', { scope: 'viewer/video-b' }],
    ['perda de acesso ou logout', { enabled: false }],
    ['troca de conta', { scope: 'other-viewer/video-a' }],
  ] as Array<[string, Partial<Options>]>)('descarta resposta tardia após %s', async (_label, patch) => {
    const pending = defer<Window>(); request.mockReturnValueOnce(pending.promise); await render();
    const media = options.mediaRef.current!, parent = media.parentNode;
    let opening!: Promise<void>; await act(async () => { opening = api.open(); });
    await render(patch);
    await act(async () => { pending.resolve(pip); await opening; });
    expect(api.isOpen).toBe(false); expect(pip.close).toHaveBeenCalledOnce();
    expect(media.parentNode).toBe(parent); expect(pip.document.querySelector('video')).toBeNull();
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it('unmount durante requestWindow fecha a resposta tardia sem adotar a mídia removida', async () => {
    const pending = defer<Window>(); request.mockReturnValueOnce(pending.promise); await render();
    let opening!: Promise<void>; await act(async () => { opening = api.open(); });
    await act(async () => root.render(null));
    await act(async () => { pending.resolve(pip); await opening; });
    expect(pip.close).toHaveBeenCalledOnce(); expect(pip.document.querySelector('video')).toBeNull(); expect(host.childElementCount).toBe(0);
  });

  it('perda de acesso ou troca de sessão restaura a janela já aberta', async () => {
    await render(); const media = options.mediaRef.current!, parent = media.parentNode;
    await act(async () => api.open()); await render({ enabled: false });
    expect(api.isOpen).toBe(false); expect(pip.close).toHaveBeenCalledOnce(); expect(media.parentNode).toBe(parent);
    expect(media.ownerDocument).toBe(document);
  });

  it('negação preserva mídia, posição e fonte no Watch e informa o erro sem parar o vídeo', async () => {
    request.mockRejectedValueOnce(new DOMException('not permitted', 'NotAllowedError')); await render();
    const media = options.mediaRef.current!, parent = media.parentNode, source = media.getAttribute('src'); media.currentTime = 17;
    await act(async () => { await api.open().catch(() => undefined); });
    expect(api.isOpen).toBe(false); expect(api.error).toBeTruthy(); expect(media.parentNode).toBe(parent);
    expect(media.currentTime).toBe(17); expect(media.getAttribute('src')).toBe(source);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled(); expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });

  it('podcast usa o mesmo áudio em Document PiP sem criar um vídeo substituto', async () => {
    await render({ audioOnly: true }); const media = options.mediaRef.current!;
    await act(async () => api.open());
    expect(pip.document.querySelector('audio')).toBe(media); expect(pip.document.querySelector('video')).toBeNull();
    expect(options.mediaRef.current).toBe(media); expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });

  it('fallback nativo pede PiP no mesmo vídeo e só encerra a própria sessão', async () => {
    const native = enableNativePiP(); await render(); const media = options.mediaRef.current!, parent = media.parentNode;
    expect(api.supported).toBe(true);
    await act(async () => api.open());
    expect(native.request).toHaveBeenCalledOnce(); expect(native.request.mock.instances[0]).toBe(media);
    expect(request).not.toHaveBeenCalled(); expect(media.parentNode).toBe(parent); expect(api.isOpen).toBe(true);
    await act(async () => api.close()); expect(native.exit).toHaveBeenCalledOnce(); expect(api.isOpen).toBe(false);
  });

  it('fechamento tardio do player anterior não encerra PiP nativo de outra mídia', async () => {
    const native = enableNativePiP(); await render();
    await act(async () => api.open());
    const other = document.createElement('video'); nativeElement = other;
    await act(async () => api.close());
    expect(native.exit).not.toHaveBeenCalled(); expect(nativeElement).toBe(other); expect(api.isOpen).toBe(false);
  });

  it('resposta de PiP nativo após logout encerra apenas a própria abertura e não publica estado aberto', async () => {
    const native = enableNativePiP(), pending = defer<{ width: number; height: number }>();
    native.request.mockImplementationOnce(function (this: HTMLVideoElement) {
      setNativeElement(this);
      return pending.promise;
    });
    await render(); let opening!: Promise<void>;
    await act(async () => { opening = api.open(); });
    await render({ enabled: false });
    await act(async () => { pending.resolve({ width: 400, height: 225 }); await opening; });
    expect(api.isOpen).toBe(false); expect(nativeElement).toBeNull(); expect(native.exit).toHaveBeenCalled();
  });

  it('janela rejeitada de uma sessão antiga não apresenta erro na sessão atual', async () => {
    const pending = defer<Window>(); request.mockReturnValueOnce(pending.promise); await render();
    let opening!: Promise<void>; await act(async () => { opening = api.open(); });
    await render({ scope: 'viewer/video-b' });
    await act(async () => { pending.reject(new DOMException('denied', 'NotAllowedError')); await opening.catch(() => undefined); });
    expect(api.isOpen).toBe(false); expect(api.error).toBeNull();
  });

  it('requisições nativas repetidas durante a abertura não criam duas sessões de PiP', async () => {
    const native = enableNativePiP(), pending = defer<{ width: number; height: number }>();
    native.request.mockImplementationOnce(() => pending.promise);
    await render(); let opening!: Promise<void>;
    await act(async () => { opening = api.open(); void api.open(); });
    expect(native.request).toHaveBeenCalledOnce();
    await act(async () => { nativeElement = options.mediaRef.current; pending.resolve({ width: 400, height: 225 }); await opening; });
    expect(api.isOpen).toBe(true);
  });

  it('áudio sem Document PiP não anuncia fallback de vídeo que o navegador não pode oferecer', async () => {
    const native = enableNativePiP(); await render({ audioOnly: true });
    expect(api.supported).toBe(false); await act(async () => { await api.open().catch(() => undefined); });
    expect(native.request).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });

  it('registra auto PiP só em reprodução autorizada e abrir automaticamente não rouba foco', async () => {
    await render({ isPlaying: false }); expect(handlers.get('enterpictureinpicture')).toBeFalsy();
    await render({ isPlaying: true }); const automatic = handlers.get('enterpictureinpicture'); expect(automatic).toBeTypeOf('function');
    await act(async () => { automatic!(); await Promise.resolve(); });
    expect(request).toHaveBeenCalledOnce(); expect(api.isOpen).toBe(true);
    await act(async () => { handlers.get('enterpictureinpicture')!(); await Promise.resolve(); });
    expect(request).toHaveBeenCalledOnce(); expect(pip.focus).not.toHaveBeenCalled();
    await act(async () => api.open()); expect(pip.focus).toHaveBeenCalledOnce();
    await render({ isPlaying: false }); expect(handlers.get('enterpictureinpicture')).toBeFalsy();
  });

  it('callback automático rejeitado fica tratado e mantém o player original disponível', async () => {
    request.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError')); await render();
    const media = options.mediaRef.current!, parent = media.parentNode;
    await act(async () => { handlers.get('enterpictureinpicture')!(); await Promise.resolve(); await Promise.resolve(); });
    expect(api.isOpen).toBe(false); expect(api.error).toBeTruthy(); expect(media.parentNode).toBe(parent);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it('desmontar um dono anterior não remove o handler automático de outro player', async () => {
    const refs = [{ current: null }, { current: null }] as Array<RefObject<HTMLMediaElement>>;
    const owners = new Map<string, Floating>();
    function Owner({ id, index }: { id: string; index: number }) {
      const value = useWatchFloatingPlayer({ ...options, mediaRef: refs[index], scope: id }); owners.set(id, value);
      return <><video ref={refs[index] as RefObject<HTMLVideoElement>} />{value.portal}</>;
    }
    await act(async () => root.render(<><Owner key="a" id="a" index={0} /><Owner key="b" id="b" index={1} /></>));
    const secondHandler = handlers.get('enterpictureinpicture'); expect(secondHandler).toBeTypeOf('function');
    await act(async () => root.render(<><Owner key="b" id="b" index={1} /></>));
    expect(handlers.get('enterpictureinpicture')).toBe(secondHandler);
    await act(async () => { secondHandler!(); await Promise.resolve(); });
    expect(owners.get('b')!.isOpen).toBe(true); expect(pip.document.querySelector('video')).toBe(refs[1].current);
    expect(request).toHaveBeenCalledOnce();
  });

  it('MediaSession sem suporte à ação experimental conserva abertura manual', async () => {
    setActionHandler.mockImplementationOnce(() => { throw new TypeError('unsupported action'); });
    await render(); await act(async () => api.open()); expect(api.isOpen).toBe(true); expect(request).toHaveBeenCalledOnce();
  });
});

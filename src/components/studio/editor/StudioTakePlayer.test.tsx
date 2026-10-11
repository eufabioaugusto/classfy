import { StrictMode, act, createRef, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioTakePlayer, type StudioTakePlayerHandle } from './StudioTakePlayer';

// Only the media/OS boundary is simulated: React, player, controls and event
// handlers are production code. jsdom cannot decode or play an actual file.
type MediaState = { paused: boolean; duration: number; ended: boolean };
let states: WeakMap<HTMLMediaElement, MediaState>, root: Root, host: HTMLDivElement;
let nextPlay: Promise<void> | undefined;
let play: ReturnType<typeof vi.spyOn>, pause: ReturnType<typeof vi.spyOn>;
const handle = createRef<StudioTakePlayerHandle>();
const base: ComponentProps<typeof StudioTakePlayer> = { src: 'blob:take-one', kind: 'video', durationSeconds: 12.5, label: 'Take 1' };
function native(element: HTMLMediaElement): MediaState {
  let value = states.get(element);
  if (!value) { value = { paused: true, duration: NaN, ended: false }; states.set(element, value); }
  return value;
}
function deferred() {
  let resolve!: () => void, reject!: (cause: Error) => void;
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
const media = () => host.querySelector<HTMLMediaElement>('video,audio')!;
const control = <T extends HTMLElement = HTMLButtonElement,>(label: string) => {
  const element = host.querySelector<T>(`[aria-label="${label}"]`);
  expect(element, `Controle ${label}`).toBeTruthy(); return element!;
};
async function render(patch: Partial<ComponentProps<typeof StudioTakePlayer>> = {}) {
  await act(async () => root.render(<StrictMode><StudioTakePlayer ref={handle} {...base} {...patch} /><input aria-label="Título externo" /></StrictMode>));
}
async function click(label: string) { await act(async () => control<HTMLButtonElement>(label).click()); }
async function emit(type: string, patch: Partial<MediaState> = {}, element = media()) {
  await act(async () => { Object.assign(native(element), patch); element.dispatchEvent(new Event(type)); });
}
async function range(label: string, value: number) {
  const element = control<HTMLInputElement>(label);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, `${value}`); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); states = new WeakMap(); nextPlay = undefined;
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function () { return native(this).paused; });
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockImplementation(function () { return native(this).duration; });
  vi.spyOn(HTMLMediaElement.prototype, 'ended', 'get').mockImplementation(function () { return native(this).ended; });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function () { native(this).duration = NaN; native(this).ended = false; });
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () { native(this).paused = true; this.dispatchEvent(new Event('pause')); });
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
    const planned = nextPlay; nextPlay = undefined;
    if (planned) return planned;
    native(this).paused = false; native(this).ended = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve();
  });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('StudioTakePlayer com controles Classfy e lifecycle real', () => {
  it.each(['video', 'audio'] as const)('usa %s sem controls nativos e mostra transport próprio', async kind => {
    await render({ kind }); const element = media(); expect(element.tagName.toLowerCase()).toBe(kind); expect(element.controls).toBe(false); expect(element.hasAttribute('controls')).toBe(false);
    expect(control('Reproduzir take')).toBeTruthy(); expect(control('Posição do take')).toBeTruthy(); expect(control('Volume do take')).toBeTruthy();
    if (kind === 'audio') expect(host.querySelector('video')).toBeNull();
  });
  it('eventos de mídia atualizam posição/tempo, pausa e EOF; rever volta ao início e reproduz', async () => {
    await render(); const element = media(); await emit('loadedmetadata', { duration: 18.5 });
    element.currentTime = 4.25; await emit('timeupdate'); expect(Number(control<HTMLInputElement>('Posição do take').max)).toBe(18.5); expect(Number(control<HTMLInputElement>('Posição do take').value)).toBeCloseTo(4.25);
    expect(control('Posição do take').getAttribute('aria-valuetext')).toMatch(/0*:04/);
    await click('Reproduzir take'); await emit('play', { paused: false }); expect(control('Pausar take')).toBeTruthy();
    await emit('pause', { paused: true }); expect(control('Reproduzir take')).toBeTruthy();
    element.currentTime = 18.5; await emit('ended', { paused: true, ended: true }); expect(control('Rever take')).toBeTruthy();
    await click('Rever take'); expect(element.currentTime).toBe(0); expect(play).toHaveBeenCalledTimes(2); expect(control('Pausar take')).toBeTruthy();
  });
  it('duração Infinity usa fallback finito; seek nunca ultrapassa o take nem fica negativo', async () => {
    await render(); await emit('loadedmetadata', { duration: Infinity });
    const seek = control<HTMLInputElement>('Posição do take'); expect(Number(seek.max)).toBe(12.5); expect(seek.getAttribute('aria-valuetext')).not.toMatch(/Infinity|NaN/);
    await range('Posição do take', 99); expect(Number.isFinite(media().currentTime)).toBe(true); expect(media().currentTime).toBeLessThanOrEqual(12.5); expect(media().currentTime).toBeGreaterThan(12);
    await range('Posição do take', -20); expect(media().currentTime).toBe(0);
  });
  it('falha de play fica visível e sanitizada, mantendo nova tentativa disponível', async () => {
    await render(); nextPlay = Promise.reject(new Error('NotAllowedError secret blob:internal-file'));
    await click('Reproduzir take'); expect(host.querySelector('[role="alert"]')?.textContent).toBe('Não foi possível reproduzir o take. Tente novamente.'); expect(host.textContent).not.toContain('internal-file'); expect(control<HTMLButtonElement>('Reproduzir take').disabled).toBe(false);
    await click('Reproduzir take'); expect(play).toHaveBeenCalledTimes(2); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(control('Pausar take')).toBeTruthy();
  });
  it.each(['resolve', 'reject'] as const)('trocar src pausa a mídia e ignora %s de play da fonte anterior', async result => {
    await render(); const previous = media(), waiting = deferred(); nextPlay = waiting.promise; pause.mockClear(); await click('Reproduzir take');
    await render({ src: 'blob:take-two', durationSeconds: 6, label: 'Take 2' }); expect(pause.mock.contexts).toContain(previous);
    await act(async () => { if (result === 'resolve') waiting.resolve(); else waiting.reject(new Error('Fonte anterior inválida')); });
    expect(control('Reproduzir take')).toBeTruthy(); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(Number(control<HTMLInputElement>('Posição do take').value)).toBe(0);
    await click('Reproduzir take'); expect(control('Pausar take')).toBeTruthy(); expect(play).toHaveBeenCalledTimes(2);
  });
  it('handle pausa o áudio atual e desmontagem pausa uma reprodução ainda pendente', async () => {
    await render({ kind: 'audio' }); await click('Reproduzir take'); await act(async () => handle.current!.pause()); expect(media().paused).toBe(true); expect(control('Reproduzir take')).toBeTruthy();
    const element = media(), waiting = deferred(); nextPlay = waiting.promise; await click('Reproduzir take'); pause.mockClear(); await act(async () => root.unmount()); expect(pause.mock.contexts).toContain(element);
    const count = play.mock.calls.length; await act(async () => waiting.resolve()); expect(play).toHaveBeenCalledTimes(count); expect(host.querySelector('audio')).toBeNull();
  });
  it('mute e volume alteram a mídia própria sem substituir o áudio pelo vídeo', async () => {
    await render({ kind: 'audio' }); const element = media(); await click('Silenciar take'); expect(element.muted).toBe(true); expect(control('Ativar som do take')).toBeTruthy();
    await click('Ativar som do take'); expect(element.muted).toBe(false); await range('Volume do take', .35); expect(element.volume).toBeCloseTo(.35); expect(element.tagName).toBe('AUDIO');
  });
  it('tela cheia usa callback do dono sem pausar, alterar cursor ou criar controles nativos', async () => {
    const onFullscreen = vi.fn(); await render({ onFullscreen }); const element = media(); element.currentTime = 4.5; await emit('timeupdate'); await click('Reproduzir take'); pause.mockClear();
    await click('Tela cheia'); expect(onFullscreen).toHaveBeenCalledOnce(); expect(element.currentTime).toBe(4.5); expect(pause).not.toHaveBeenCalled();
    await render({ onFullscreen, fullscreen: true }); expect(media()).toBe(element); expect(control('Sair da tela cheia')).toBeTruthy(); expect(control('Pausar take')).toBeTruthy();
  });
  it('pause imperativo invalida o play pendente, sem retomar ao receber uma Promise antiga', async () => {
    await render(); const waiting = deferred(); nextPlay = waiting.promise; await click('Reproduzir take');
    await act(async () => handle.current!.pause()); await act(async () => waiting.resolve());
    expect(media().paused).toBe(true); expect(control('Reproduzir take')).toBeTruthy(); expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it('disabled impede iniciar reprodução e uma pausa do dono continua disponível', async () => {
    await render({ disabled: true }); expect(control<HTMLButtonElement>('Reproduzir take').disabled).toBe(true); await click('Reproduzir take'); expect(play).not.toHaveBeenCalled();
    await emit('play', { paused: false }); await act(async () => handle.current!.pause()); expect(media().paused).toBe(true);
  });

  it('atalhos atuam só na superfície focada e não roubam teclas dos ranges ou de um campo externo', async () => {
    const onFullscreen = vi.fn(); await render({ onFullscreen }); const shell = host.querySelector<HTMLElement>('[role="region"]')!, title = control<HTMLInputElement>('Título externo');
    await act(async () => title.focus()); const typing = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true }); await act(async () => title.dispatchEvent(typing)); expect(typing.defaultPrevented).toBe(false); expect(play).not.toHaveBeenCalled();
    const seek = control<HTMLInputElement>('Posição do take'); await act(async () => seek.focus()); const adjusting = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }); await act(async () => seek.dispatchEvent(adjusting)); expect(adjusting.defaultPrevented).toBe(false); expect(media().currentTime).toBe(0);
    await act(async () => shell.focus()); const start = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }); await act(async () => shell.dispatchEvent(start)); expect(start.defaultPrevented).toBe(true); expect(control('Pausar take')).toBeTruthy();
    await act(async () => shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))); expect(media().currentTime).toBe(5);
    await act(async () => shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true }))); expect(media().muted).toBe(true);
    await act(async () => shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }))); expect(onFullscreen).toHaveBeenCalledOnce();
  });
  it('auto-hide só esconde durante Play sem foco; pointer/foco devolvem controles e pausado continua visível', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render(); const shell = host.querySelector<HTMLElement>('[role="region"]')!; await click('Reproduzir take');
    await act(async () => vi.advanceTimersByTime(3000)); expect(shell.classList.contains('has-controls')).toBe(false);
    await act(async () => shell.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))); expect(shell.classList.contains('has-controls')).toBe(true);
    await act(async () => control<HTMLButtonElement>('Pausar take').focus()); await act(async () => vi.advanceTimersByTime(3000)); expect(shell.classList.contains('has-controls')).toBe(true);
    await click('Pausar take'); await act(async () => control<HTMLInputElement>('Título externo').focus()); await act(async () => vi.advanceTimersByTime(3000)); expect(shell.classList.contains('has-controls')).toBe(true);
  });
  it('foco no Play central removido não conserva controles abertos durante reprodução', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render(); const shell = host.querySelector<HTMLElement>('[role="region"]')!, center = host.querySelector<HTMLButtonElement>('.se-take-player__center')!;
    await act(async () => center.focus()); expect(document.activeElement).toBe(center); await click('Reproduzir take'); expect(center.isConnected).toBe(false);
    await act(async () => vi.advanceTimersByTime(2600)); expect(shell.classList.contains('has-controls')).toBe(false);
  });
  it('duração desconhecida não cria tempo infinito e deixa seek indisponível sem chamar mídia', async () => {
    await render({ durationSeconds: NaN }); await emit('loadedmetadata', { duration: Infinity }); const seek = control<HTMLInputElement>('Posição do take');
    expect(seek.disabled).toBe(true); expect(Number.isFinite(Number(seek.max))).toBe(true); expect(seek.getAttribute('aria-valuetext')).not.toMatch(/NaN|Infinity/); expect(media().currentTime).toBe(0);
  });

});

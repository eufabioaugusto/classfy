import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedVideoPlayer, type UnifiedVideoPlayerProps } from './UnifiedVideoPlayer';

const mocks = vi.hoisted(() => ({
  user: { id: 'viewer' } as { id: string } | null,
  track: vi.fn(), flush: vi.fn(), courseTrack: vi.fn(), coursePersist: vi.fn(), courseReset: vi.fn(), complete: vi.fn(),
  metricMounts: 0, metricUnmounts: 0,
  hlsConstructed: 0, hlsAttached: [] as HTMLMediaElement[], hlsLoad: vi.fn(), hlsDestroy: vi.fn(), hlsStart: vi.fn(),
  playbackUrl: 'https://media.example/manifest.m3u8',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useContentMetrics', () => ({ useContentMetrics: () => {
  useEffect(() => { ++mocks.metricMounts; return () => { ++mocks.metricUnmounts; }; }, []);
  return { handleTimeUpdate: mocks.track, flushProgress: mocks.flush };
} }));
vi.mock('@/hooks/useCourseLessonProgress', () => ({ useCourseLessonProgress: () => ({
  handleTimeUpdate: mocks.courseTrack, persistCurrent: mocks.coursePersist, reset: mocks.courseReset, completeLesson: mocks.complete,
}) }));
vi.mock('@/hooks/usePlaybackSource', () => ({ usePlaybackSource: () => ({
  url: mocks.playbackUrl, loading: false, error: null, retry: vi.fn(),
}) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }),
    not: async () => ({ data: [], error: null }), insert: async () => ({ data: null, error: null }) };
  return query;
} } }));
vi.mock('hls.js', () => ({ default: class {
  static isSupported() { return true; }
  static Events = { MEDIA_ATTACHED: 'attached', MANIFEST_PARSED: 'manifest', LEVEL_SWITCHED: 'level', ERROR: 'error' };
  static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
  callbacks = new Map<string, () => void>(); levels = [{ height: 1080 }]; currentLevel = -1;
  constructor() { ++mocks.hlsConstructed; }
  on(name: string, callback: () => void) { this.callbacks.set(name, callback); }
  loadSource = mocks.hlsLoad;
  attachMedia(media: HTMLMediaElement) { mocks.hlsAttached.push(media); this.callbacks.get('attached')?.(); }
  startLoad = mocks.hlsStart;
  destroy = mocks.hlsDestroy;
} }));

let root: Root, host: HTMLElement, frame: HTMLIFrameElement, pip: Window, closed: boolean;
let props: UnifiedVideoPlayerProps;
let originalPiP: PropertyDescriptor | undefined, originalMediaSession: PropertyDescriptor | undefined, originalMetadata: PropertyDescriptor | undefined;
let request: ReturnType<typeof vi.fn>;
const onPlayback = vi.fn(), onTime = vi.fn();
const mediaSession = { metadata: null as unknown, playbackState: 'none', setActionHandler: vi.fn(), setPositionState: vi.fn() };
let paused = new WeakMap<HTMLMediaElement, boolean>();
const defaultContent: UnifiedVideoPlayerProps['content'] = { id: 'video-a', content_id: 'video-a', title: 'Aula em foco',
  content_type: 'aula', file_url: 'media:asset-a', media_asset_id: 'asset-a', duration_seconds: 120, creator: { display_name: 'Criador' } };

async function render(patch: Partial<UnifiedVideoPlayerProps> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(<UnifiedVideoPlayer {...props} />));
}
function button(container: ParentNode, label: string) {
  const value = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(value, label).toBeTruthy(); return value!;
}
async function click(container: ParentNode, label: string) { await act(async () => button(container, label).click()); }
async function startAndOpen() {
  await render(); const media = host.querySelector<HTMLVideoElement>('video')!;
  await act(async () => { media.dispatchEvent(new Event('loadedmetadata')); });
  await click(host, 'Reproduzir'); await click(host, 'Mini player'); return media;
}
function restoreProperty(object: object, key: string, previous: PropertyDescriptor | undefined) {
  if (previous) Object.defineProperty(object, key, previous); else Reflect.deleteProperty(object, key);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); mocks.user = { id: 'viewer' }; mocks.metricMounts = 0; mocks.metricUnmounts = 0;
  mocks.hlsConstructed = 0; mocks.hlsAttached = []; mocks.playbackUrl = 'https://media.example/manifest.m3u8';
  paused = new WeakMap();
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(120);
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) { return paused.get(this) ?? true; });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, false); this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    if (paused.get(this) === false) { paused.set(this, true); this.dispatchEvent(new Event('pause')); }
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  frame = document.createElement('iframe'); document.body.append(frame); pip = frame.contentWindow!; closed = false;
  Object.defineProperty(pip, 'closed', { configurable: true, get: () => closed });
  vi.spyOn(pip, 'close').mockImplementation(() => { closed = true; pip.dispatchEvent(new Event('pagehide')); });
  vi.spyOn(pip, 'focus').mockImplementation(() => undefined); vi.spyOn(window, 'focus').mockImplementation(() => undefined);
  originalPiP = Object.getOwnPropertyDescriptor(window, 'documentPictureInPicture');
  request = vi.fn().mockResolvedValue(pip);
  Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow: request } });
  originalMediaSession = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
  Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: mediaSession });
  originalMetadata = Object.getOwnPropertyDescriptor(globalThis, 'MediaMetadata');
  Object.defineProperty(globalThis, 'MediaMetadata', { configurable: true, value: class { constructor(data: object) { Object.assign(this, data); } } });
  props = { content: defaultContent, mode: 'watch', showNoteButton: false, onTimeUpdate: onTime, onPlaybackStateChange: onPlayback };
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); frame.remove();
  restoreProperty(window, 'documentPictureInPicture', originalPiP);
  restoreProperty(navigator, 'mediaSession', originalMediaSession); restoreProperty(globalThis, 'MediaMetadata', originalMetadata);
  vi.restoreAllMocks();
});

describe('Watch principal integrado à janela flutuante real', () => {
  it('abre e fecha mantendo a mesma mídia/HLS e uma única instância de métricas', async () => {
    const media = await startAndOpen();
    expect(pip.document.querySelector('video')).toBe(media); expect(host.querySelector('video')).toBeNull();
    expect(mocks.hlsConstructed).toBe(1); expect(mocks.hlsAttached).toEqual([media]); expect(mocks.metricMounts).toBe(1); expect(mocks.metricUnmounts).toBe(0);
    mocks.track.mockClear(); onTime.mockClear();
    await act(async () => { media.currentTime = 1; media.dispatchEvent(new Event('timeupdate')); });
    expect(mocks.track).toHaveBeenCalledOnce(); expect(mocks.track).toHaveBeenLastCalledWith(1);
    expect(onTime).toHaveBeenCalledOnce(); expect(onTime).toHaveBeenLastCalledWith(1);
    await click(pip.document, 'Fechar mini player');
    expect(host.querySelector('video')).toBe(media); expect(media.currentTime).toBe(1); expect(media.paused).toBe(false);
    expect(mocks.hlsConstructed).toBe(1); expect(mocks.hlsDestroy).not.toHaveBeenCalled(); expect(mocks.metricMounts).toBe(1);
    mocks.track.mockClear();
    await act(async () => { media.currentTime = 2; media.dispatchEvent(new Event('timeupdate')); });
    expect(mocks.track).toHaveBeenCalledOnce(); expect(mocks.track).toHaveBeenLastCalledWith(2);
  });

  it('pausar/reproduzir na janela sincroniza controles principais e MediaSession sem novo progresso', async () => {
    const media = await startAndOpen(); mocks.track.mockClear(); onPlayback.mockClear();
    await click(pip.document, 'Pausar');
    expect(media.paused).toBe(true); expect(onPlayback).toHaveBeenLastCalledWith(false);
    expect(mediaSession.playbackState).toBe('paused'); expect(button(host, 'Reproduzir')).toBeTruthy();
    expect(mocks.track).not.toHaveBeenCalled();
    await click(pip.document, 'Reproduzir');
    expect(media.paused).toBe(false); expect(onPlayback).toHaveBeenLastCalledWith(true);
    expect(mediaSession.playbackState).toBe('playing'); expect(button(host, 'Pausar')).toBeTruthy();
    expect(mocks.track).not.toHaveBeenCalled(); expect(mocks.metricMounts).toBe(1);
  });

  it('timeupdate pausado ou durante seek atualiza a interface sem contabilizar consumo e retoma ao reproduzir', async () => {
    const media = await startAndOpen();
    let seeking = false;
    Object.defineProperty(media, 'seeking', { configurable: true, get: () => seeking });
    await click(pip.document, 'Pausar');
    mocks.track.mockClear(); mocks.courseTrack.mockClear(); onTime.mockClear();
    await act(async () => { media.currentTime = 50; media.dispatchEvent(new Event('timeupdate')); });
    expect(onTime).toHaveBeenLastCalledWith(50);
    expect(pip.document.querySelector('time')?.textContent).toBe('0:50');
    expect(mocks.track).not.toHaveBeenCalled(); expect(mocks.courseTrack).not.toHaveBeenCalled();
    await click(pip.document, 'Reproduzir');
    seeking = true;
    await act(async () => { media.currentTime = 60; media.dispatchEvent(new Event('timeupdate')); });
    expect(onTime).toHaveBeenLastCalledWith(60);
    expect(mocks.track).not.toHaveBeenCalled(); expect(mocks.courseTrack).not.toHaveBeenCalled();
    seeking = false;
    await act(async () => { media.currentTime = 61; media.dispatchEvent(new Event('timeupdate')); });
    expect(mocks.track).toHaveBeenCalledOnce(); expect(mocks.track).toHaveBeenLastCalledWith(61);
    expect(mocks.courseTrack).toHaveBeenCalledOnce(); expect(mocks.courseTrack).toHaveBeenLastCalledWith(61);
    expect(onTime).toHaveBeenCalledTimes(3); expect(mocks.metricMounts).toBe(1); expect(mocks.hlsConstructed).toBe(1);
  });

  it('mute e velocidade na janela atualizam o estado do player e a posição da MediaSession', async () => {
    const media = await startAndOpen();
    await click(pip.document, 'Silenciar');
    await act(async () => { media.dispatchEvent(new Event('volumechange')); });
    expect(media.muted).toBe(true); expect(button(host, 'Ativar som')).toBeTruthy();
    const speed = pip.document.querySelector<HTMLSelectElement>('select[aria-label="Velocidade de reprodução"]')!;
    await act(async () => { speed.value = '1.5'; speed.dispatchEvent(new Event('change', { bubbles: true })); media.dispatchEvent(new Event('ratechange')); });
    expect(media.playbackRate).toBe(1.5);
    expect(mediaSession.setPositionState).toHaveBeenLastCalledWith(expect.objectContaining({ playbackRate: 1.5 }));
    await click(pip.document, 'Ativar som');
    await act(async () => { media.dispatchEvent(new Event('volumechange')); });
    expect(media.muted).toBe(false); expect(button(host, 'Silenciar')).toBeTruthy();
    expect(mocks.hlsConstructed).toBe(1); expect(mocks.metricMounts).toBe(1);
  });

  it('fechar a janela pelo navegador restaura o mesmo vídeo e unmount libera uma vez sem erro React', async () => {
    const media = await startAndOpen();
    await act(async () => { closed = true; pip.dispatchEvent(new Event('pagehide')); });
    expect(host.querySelector('video')).toBe(media); expect(pip.close).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    expect(host.childElementCount).toBe(0); expect(mocks.hlsDestroy).toHaveBeenCalledOnce(); expect(mocks.metricUnmounts).toBe(1);
  });

  it('unmount com janela ainda aberta restaura a mídia antes de React remover o player', async () => {
    const media = await startAndOpen(); await act(async () => root.render(null));
    expect(pip.close).toHaveBeenCalledOnce(); expect(media.ownerDocument).toBe(document);
    expect(pip.document.querySelector('video')).toBeNull(); expect(host.childElementCount).toBe(0);
    expect(mocks.hlsDestroy).toHaveBeenCalledOnce(); expect(mocks.metricUnmounts).toBe(1);
  });

  it('troca de URL/conteúdo fecha a janela antes da nova fonte entrar no mesmo player', async () => {
    const media = await startAndOpen(); mocks.playbackUrl = 'https://media.example/second.m3u8';
    await render({ content: { ...defaultContent, id: 'video-b', content_id: 'video-b', media_asset_id: 'asset-b', title: 'Outra aula' } });
    expect(pip.close).toHaveBeenCalledOnce(); expect(host.querySelector('video')).toBe(media); expect(media.ownerDocument).toBe(document);
    expect(mocks.hlsDestroy).toHaveBeenCalledOnce(); expect(mocks.hlsConstructed).toBe(2); expect(mocks.metricMounts).toBe(1);
  });
});

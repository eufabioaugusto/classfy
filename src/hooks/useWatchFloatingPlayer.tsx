import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { WatchFloatingControls } from '@/components/watch/WatchFloatingControls';
import floatingCSS from '@/styles/watch-floating-player.css?inline';

type DocumentPiP = { requestWindow(options: { width: number; height: number }): Promise<Window> };
type PresentationVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};
type Options = {
  mediaRef: RefObject<HTMLMediaElement>;
  scope: string;
  title: string;
  creator?: string;
  poster?: string;
  audioOnly?: boolean;
  enabled: boolean;
  isPlaying: boolean;
};
type Lease = { window: Window; media: HTMLMediaElement; anchor: Comment; parent: Node; stage: HTMLDivElement | null };
const documentAPI = () => (window as Window & { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;
// MediaSession belongs to the tab. An old player's cleanup must never clear
// the action installed by the next lesson/player.
let automaticOwner: object | null = null;

/** Borrows the existing media node. It never loads a source or owns progress. */
export function useWatchFloatingPlayer(options: Options) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [nativeOpen, setNativeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(options); latest.current = options;
  const owned = useRef<Lease | null>(null);
  const native = useRef<PresentationVideo | null>(null);
  const pending = useRef<Promise<Window> | null>(null);
  const nativePending = useRef<Promise<unknown> | null>(null);
  const generation = useRef(0), mounted = useRef(false);
  const docSupported = typeof documentAPI()?.requestWindow === 'function';
  const nativeSupported = !options.audioOnly && (
    document.pictureInPictureEnabled && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function'
    || typeof (HTMLVideoElement.prototype as PresentationVideo).webkitSetPresentationMode === 'function'
  );
  const supported = docSupported || !!nativeSupported;

  const restore = useCallback((lease: Lease) => {
    // Restore synchronously, including React's deletion/layout cleanup. React
    // still owns this exact node in its original parent and must find it there.
    const parent = lease.anchor.parentNode ?? lease.parent;
    parent.insertBefore(lease.media, lease.anchor.parentNode === parent ? lease.anchor : null);
    lease.anchor.remove();
    lease.stage = null;
  }, []);
  const close = useCallback(() => {
    ++generation.current; pending.current = null; nativePending.current = null;
    const lease = owned.current; owned.current = null;
    if (lease) {
      restore(lease);
      if (!lease.window.closed) lease.window.close();
    }
    const video = native.current; native.current = null;
    if (video) {
      if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
      else if (video.webkitPresentationMode === 'picture-in-picture') video.webkitSetPresentationMode?.('inline');
    }
    if (mounted.current) { setTarget(null); setNativeOpen(false); setError(null); }
  }, [restore]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; close(); };
  }, [close]);
  useLayoutEffect(() => {
    close();
    return close;
  }, [options.scope, options.enabled, close]);

  const mountMedia = useCallback((stage: HTMLDivElement | null) => {
    const lease = owned.current;
    if (!stage || !lease || lease.window.closed || stage.ownerDocument !== lease.window.document) return;
    lease.stage = stage;
    stage.appendChild(lease.media);
  }, []);

  const open = useCallback(async (source: 'manual' | 'automatic' = 'manual') => {
    const current = latest.current, media = current.mediaRef.current;
    if (!mounted.current || !current.enabled || !media) return;
    if (owned.current && !owned.current.window.closed) {
      if (source === 'manual') owned.current.window.focus();
      return;
    }
    if (pending.current || nativePending.current) return;
    if (media.readyState < 1) { setError('Dê play no conteúdo antes de abrir o mini player.'); return; }
    const expected = ++generation.current, scope = current.scope;
    const fresh = () => mounted.current && expected === generation.current
      && latest.current.enabled && latest.current.scope === scope && latest.current.mediaRef.current === media;
    setError(null);
    const api = documentAPI();
    if (typeof api?.requestWindow !== 'function') {
      if (current.audioOnly) return;
      const video = media as PresentationVideo;
      let entering: Promise<unknown> | null = null;
      try {
        // Native video PiP is the capability fallback; its controls belong to
        // the browser. This call also preserves the originating user gesture.
        native.current = video;
        if (document.pictureInPictureElement === video) return;
        if (typeof video.requestPictureInPicture === 'function' && document.pictureInPictureEnabled) {
          entering = video.requestPictureInPicture(); nativePending.current = entering;
          await entering;
        } else if (video.webkitSupportsPresentationMode?.('picture-in-picture') && video.webkitSetPresentationMode) {
          video.webkitSetPresentationMode('picture-in-picture');
        } else throw new Error('unsupported');
        if (!fresh()) {
          if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
          else if (video.webkitPresentationMode === 'picture-in-picture') video.webkitSetPresentationMode?.('inline');
          return;
        }
        setNativeOpen(true);
      } catch { if (fresh()) { native.current = null; setError('Não foi possível abrir o mini player. Use o botão novamente.'); } }
      finally { if (nativePending.current === entering) nativePending.current = null; }
      return;
    }
    let opening: Promise<Window> | null = null;
    try {
      // No await before requestWindow: only a click or the browser-authorized
      // MediaSession action may open an always-on-top window.
      opening = api.requestWindow({ width: 380, height: current.audioOnly ? 420 : 310 });
      pending.current = opening;
      const opened = await opening;
      if (!fresh() || !media.parentNode) { opened.close(); return; }
      const doc = opened.document;
      doc.documentElement.lang = 'pt-BR'; doc.title = `${current.title} · Classfy`;
      const style = doc.createElement('style'); style.textContent = floatingCSS; doc.head.append(style);
      const host = doc.createElement('main'); host.className = 'cf-watch-floating-host'; doc.body.append(host);
      const anchor = document.createComment('Classfy floating media');
      const parent = media.parentNode; parent.insertBefore(anchor, media);
      const lease: Lease = { window: opened, media, anchor, parent, stage: null };
      owned.current = lease;
      opened.addEventListener('pagehide', () => {
        if (owned.current !== lease) return;
        owned.current = null; restore(lease);
        if (mounted.current) { setTarget(null); setError(null); }
      }, { once: true });
      setTarget(host);
    } catch {
      if (fresh()) setError('Não foi possível abrir o mini player. Abra pelo botão do player e permita a janela no navegador.');
    } finally { if (pending.current === opening) pending.current = null; }
  }, [restore]);

  useEffect(() => {
    const media = options.mediaRef.current as PresentationVideo | null;
    if (!media || !options.enabled) return;
    const update = () => {
      const active = document.pictureInPictureElement === media || media.webkitPresentationMode === 'picture-in-picture';
      if (!active && native.current === media) native.current = null;
      setNativeOpen(active);
    };
    media.addEventListener('leavepictureinpicture', update);
    media.addEventListener('webkitpresentationmodechanged', update);
    return () => {
      media.removeEventListener('leavepictureinpicture', update);
      media.removeEventListener('webkitpresentationmodechanged', update);
    };
  }, [options.enabled, options.scope, options.mediaRef]);
  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!supported || !options.enabled || !options.isPlaying || typeof mediaSession?.setActionHandler !== 'function') return;
    const owner = {}, action = 'enterpictureinpicture' as MediaSessionAction;
    try {
      mediaSession.setActionHandler(action, () => {
        if (automaticOwner !== owner || !latest.current.enabled || !latest.current.isPlaying) return;
        void open('automatic');
      });
      automaticOwner = owner;
    } catch { return; }
    return () => {
      if (automaticOwner !== owner) return;
      automaticOwner = null;
      try { mediaSession.setActionHandler(action, null); } catch { /* Optional browser action. */ }
    };
  }, [supported, options.enabled, options.isPlaying, options.scope, open]);

  const media = owned.current?.media;
  const portal = target && media ? createPortal(<WatchFloatingControls media={media} title={options.title}
    creator={options.creator} poster={options.poster} audioOnly={options.audioOnly} mediaMount={mountMedia}
    onClose={close} onReturn={() => { close(); window.focus(); }} />, target) : null;
  return { supported, isOpen: !!target || nativeOpen, open, close, error, portal };
}

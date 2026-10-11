import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Maximize2, Mic, Minimize2, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import '@/styles/studio-take-player.css';

export type StudioTakePlayerHandle = { pause(): void };
export type StudioTakePlayerProps = {
  src: string;
  kind: 'video' | 'audio';
  durationSeconds: number;
  label?: string;
  disabled?: boolean;
  fullscreen?: boolean;
  onFullscreen?: () => void;
};
type Playback = { source: string; playing: boolean; ended: boolean; position: number; duration: number; error: string | null };
const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
const finiteDuration = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;
const clock = (value: number) => {
  const seconds = Math.floor(Number.isFinite(value) ? Math.max(0, value) : 0);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
};
const emptyPlayback = (source: string): Playback => ({ source, playing: false, ended: false, position: 0, duration: 0, error: null });

/** Local originals only. Playback never opens a device or a publishing service. */
export const StudioTakePlayer = forwardRef<StudioTakePlayerHandle, StudioTakePlayerProps>(function StudioTakePlayer({
  src, kind, durationSeconds, label = 'Prévia do take', disabled = false, fullscreen = false, onFullscreen,
}, forwardedRef) {
  const identity = `${kind}:${src}`;
  const root = useRef<HTMLDivElement>(null), media = useRef<HTMLMediaElement | null>(null);
  const source = useRef(identity), mounted = useRef(false), lifecycle = useRef(0), request = useRef(0), wantsPlay = useRef(false);
  const current = useRef({ disabled, onFullscreen }); source.current = identity; current.current = { disabled, onFullscreen };
  const [playback, setPlayback] = useState<Playback>(() => emptyPlayback(identity));
  const [muted, setMuted] = useState(false), [volume, setVolume] = useState(1), [rate, setRate] = useState(1);
  const preferences = useRef({ muted, volume }); preferences.current = { muted, volume };
  const [visible, setVisible] = useState(true), [speedOpen, setSpeedOpen] = useState(false);
  const hiding = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), playingNow = useRef(false), menuNow = useRef(false), focused = useRef(false);
  const view = playback.source === identity ? playback : emptyPlayback(identity);
  const duration = finiteDuration(view.duration) || finiteDuration(durationSeconds);
  const position = Math.min(duration || Number.MAX_SAFE_INTEGER, Math.max(0, view.position));
  const progress = duration ? Math.min(100, position / duration * 100) : 0;
  playingNow.current = view.playing; menuNow.current = speedOpen;

  const clearHide = useCallback(() => { clearTimeout(hiding.current); hiding.current = undefined; }, []);
  const reveal = useCallback(() => {
    setVisible(true); clearHide();
    if (playingNow.current) hiding.current = setTimeout(() => {
      const hasFocus = focused.current && root.current?.contains(document.activeElement);
      if (mounted.current && playingNow.current && !hasFocus && !menuNow.current) setVisible(false);
    }, 2500);
  }, [clearHide]);
  const owns = (element: HTMLMediaElement) => mounted.current && media.current === element && source.current === identity;
  const playable = () => {
    const element = media.current;
    return element && owns(element) && !current.current.disabled && !!src ? element : null;
  };
  const patch = (element: HTMLMediaElement, values: Partial<Playback>) => {
    if (!owns(element)) return;
    setPlayback(previous => ({ ...(previous.source === identity ? previous : emptyPlayback(identity)), ...values }));
  };
  const pause = useCallback(() => {
    request.current++; wantsPlay.current = false; media.current?.pause(); playingNow.current = false;
    setPlayback(previous => ({ ...(previous.source === source.current ? previous : emptyPlayback(source.current)), playing: false }));
    setVisible(true); clearHide();
  }, [clearHide]);
  useImperativeHandle(forwardedRef, () => ({ pause }), [pause]);
  const release = useCallback((element: HTMLMediaElement | null, generation: number) => {
    element?.pause(); clearHide();
    if (lifecycle.current === generation) { mounted.current = false; request.current++; wantsPlay.current = false; }
  }, [clearHide]);

  useLayoutEffect(() => {
    const element = media.current, generation = ++lifecycle.current;
    mounted.current = true; request.current++; wantsPlay.current = false; focused.current = false;
    setPlayback(emptyPlayback(identity)); setVisible(true); setSpeedOpen(false); setRate(1);
    if (element) {
      element.pause(); element.playbackRate = 1; element.volume = preferences.current.volume; element.muted = preferences.current.muted;
      try { element.currentTime = 0; } catch { /* Metadata may not exist yet; a new source starts at zero. */ }
    }
    return () => release(element, generation);
  }, [identity, release]);
  useEffect(() => { if (disabled) { pause(); setSpeedOpen(false); } }, [disabled, pause]);
  useEffect(() => { reveal(); return clearHide; }, [view.playing, reveal, clearHide]);

  const togglePlayback = async () => {
    const element = playable(); if (!element) return;
    reveal();
    if (wantsPlay.current || !element.paused) { pause(); return; }
    const ticket = ++request.current; wantsPlay.current = true; patch(element, { error: null, ended: false });
    try {
      if (element.ended || view.ended || duration > 0 && element.currentTime >= duration) element.currentTime = 0;
      await element.play();
      if (!owns(element)) { if (media.current !== element) element.pause(); return; }
      if (ticket !== request.current || current.current.disabled) { if (!wantsPlay.current || current.current.disabled) element.pause(); return; }
      patch(element, { playing: !element.paused });
    } catch {
      if (!owns(element) || ticket !== request.current) return;
      wantsPlay.current = false; element.pause(); patch(element, { playing: false, error: 'Não foi possível reproduzir o take. Tente novamente.' });
    }
  };
  const seek = (seconds: number) => {
    const element = playable(); if (!element || !duration || !Number.isFinite(seconds)) return;
    const next = Math.max(0, Math.min(duration, seconds)); reveal();
    try { element.currentTime = next; patch(element, { position: next, ended: false, error: null }); }
    catch { patch(element, { error: 'Não foi possível mover a reprodução. Tente novamente.' }); }
  };
  const changeVolume = (value: number) => {
    const element = playable(); if (!element || !Number.isFinite(value)) return;
    const next = Math.max(0, Math.min(1, value)); element.volume = next; element.muted = next === 0;
    setVolume(element.volume); setMuted(element.muted); reveal();
  };
  const toggleMute = () => {
    const element = playable(); if (!element) return;
    const next = !(element.muted || element.volume === 0);
    if (!next && element.volume === 0) { element.volume = 1; setVolume(element.volume); }
    element.muted = next; setMuted(element.muted); reveal();
  };
  const changeRate = (next: number) => {
    const element = playable(); if (!element) return;
    element.playbackRate = next; setRate(element.playbackRate); setSpeedOpen(false); reveal();
  };
  const toggleFullscreen = () => { if (playable() && current.current.onFullscreen) { reveal(); current.current.onFullscreen(); } };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="menuitemradio"]')) return;
    // Buttons retain their own native Space/Enter behavior; shortcuts belong to
    // the focused viewing surface and cannot act on a surrounding editor.
    if (event.key === ' ' && target.closest('button')) return;
    if (!playable()) return;
    if (event.key === ' ' || event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopPropagation(); void togglePlayback(); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); seek(position + (event.key === 'ArrowLeft' ? -5 : 5)); }
    else if (event.key.toLowerCase() === 'm') { event.preventDefault(); event.stopPropagation(); toggleMute(); }
    else if (event.key.toLowerCase() === 'f' && current.current.onFullscreen) { event.preventDefault(); event.stopPropagation(); toggleFullscreen(); }
  };
  const events = {
    onLoadedMetadata: (event: { currentTarget: HTMLMediaElement }) => patch(event.currentTarget, { duration: finiteDuration(event.currentTarget.duration) }),
    onDurationChange: (event: { currentTarget: HTMLMediaElement }) => patch(event.currentTarget, { duration: finiteDuration(event.currentTarget.duration) }),
    onTimeUpdate: (event: { currentTarget: HTMLMediaElement }) => patch(event.currentTarget, { position: Number.isFinite(event.currentTarget.currentTime) ? Math.max(0, event.currentTarget.currentTime) : 0 }),
    onPlay: (event: { currentTarget: HTMLMediaElement }) => {
      if (!owns(event.currentTarget)) return;
      if (!wantsPlay.current || current.current.disabled) { event.currentTarget.pause(); return; }
      patch(event.currentTarget, { playing: true, ended: false, error: null });
    },
    onPause: (event: { currentTarget: HTMLMediaElement }) => { if (owns(event.currentTarget)) { wantsPlay.current = false; patch(event.currentTarget, { playing: false }); } },
    onEnded: (event: { currentTarget: HTMLMediaElement }) => { if (owns(event.currentTarget)) { wantsPlay.current = false; patch(event.currentTarget, { playing: false, ended: true, position: duration || event.currentTarget.currentTime }); } },
    onVolumeChange: (event: { currentTarget: HTMLMediaElement }) => { if (owns(event.currentTarget)) { setVolume(event.currentTarget.volume); setMuted(event.currentTarget.muted); } },
    onError: (event: { currentTarget: HTMLMediaElement }) => { if (owns(event.currentTarget)) { wantsPlay.current = false; patch(event.currentTarget, { playing: false, error: 'Não foi possível carregar o take. Tente novamente.' }); } },
  };
  const playbackLabel = view.playing ? 'Pausar take' : view.ended ? 'Rever take' : 'Reproduzir take';
  const PlaybackIcon = view.playing ? Pause : view.ended ? RotateCcw : Play;
  const unavailable = disabled || !src;

  return <div ref={root} className={`se-take-player${kind === 'audio' ? ' se-take-player--audio' : ''}${visible || !view.playing || speedOpen ? ' has-controls' : ''}`} role="region" aria-label={label} tabIndex={0}
    onKeyDown={keyDown} onPointerMove={reveal} onPointerDown={reveal} onPointerLeave={reveal}
    onFocusCapture={() => { focused.current = true; reveal(); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { focused.current = false; reveal(); } }}>
    {kind === 'video' ? <video key={identity} ref={element => { media.current = element; }} src={src || undefined} className="se-take-player__media" playsInline preload="metadata" aria-label={label} onClick={() => void togglePlayback()} {...events} />
      : <><audio key={identity} ref={element => { media.current = element; }} src={src || undefined} preload="metadata" aria-label={label} {...events} /><div className="se-take-player__audio-heading"><span><Mic size={22} strokeWidth={1.5} /></span><div><strong>{label}</strong><small>Original de áudio</small></div></div></>}
    {kind === 'video' && !view.playing && <button type="button" className="se-take-player__center" aria-label={playbackLabel} disabled={unavailable} onClick={() => void togglePlayback()}><PlaybackIcon size={29} fill={view.ended ? 'none' : 'currentColor'} strokeWidth={1.6} /></button>}
    {view.error && <p className="se-take-player__error" role="alert">{view.error}</p>}
    <div className="se-take-player__controls">
      <input className="se-take-player__seek" type="range" min={0} max={duration || 1} step={0.1} value={position} disabled={unavailable || !duration} aria-label="Posição do take" aria-valuetext={`${clock(position)} de ${clock(duration)}`} onChange={event => seek(Number(event.target.value))} style={{ '--take-progress': `${progress}%` } as CSSProperties} />
      <div className="se-take-player__row">
        <button type="button" className="se-take-player__button" aria-label={playbackLabel} title={playbackLabel} disabled={unavailable} onClick={() => void togglePlayback()}><PlaybackIcon size={19} fill={view.ended ? 'none' : 'currentColor'} strokeWidth={1.6} /></button>
        <div className="se-take-player__volume"><button type="button" className="se-take-player__button" aria-label={muted || volume === 0 ? 'Ativar som do take' : 'Silenciar take'} title={muted || volume === 0 ? 'Ativar som' : 'Silenciar'} disabled={unavailable} onClick={toggleMute}>{muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
          <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volume do take" disabled={unavailable} onChange={event => changeVolume(Number(event.target.value))} /></div>
        <span className="se-take-player__time">{clock(position)}<i>/</i>{clock(duration)}</span><span className="se-take-player__spacer" />
        <DropdownMenu.Root open={speedOpen} onOpenChange={value => { if (!current.current.disabled && source.current === identity) { setSpeedOpen(value); reveal(); } }}>
          <DropdownMenu.Trigger asChild><button type="button" className="se-take-player__button se-take-player__rate" aria-label="Velocidade de reprodução" title="Velocidade de reprodução" disabled={unavailable}>{rate}×</button></DropdownMenu.Trigger>
          <DropdownMenu.Portal container={document.fullscreenElement ?? undefined}><DropdownMenu.Content className="se-take-player__speed-menu" aria-label="Velocidade do take" side="top" align="end" sideOffset={8} collisionPadding={12} onCloseAutoFocus={reveal}>
            <DropdownMenu.Label className="se-take-player__speed-label">Velocidade</DropdownMenu.Label><DropdownMenu.RadioGroup value={String(rate)} onValueChange={value => changeRate(Number(value))}>
              {rates.map(value => <DropdownMenu.RadioItem key={value} value={String(value)}>{value === 1 ? 'Normal' : `${value}×`}<DropdownMenu.ItemIndicator><Check size={14} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
        {onFullscreen && <button type="button" className="se-take-player__button" aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} disabled={unavailable} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button>}
      </div>
    </div>
  </div>;
});

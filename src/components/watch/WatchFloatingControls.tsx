import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Headphones, Loader2, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX, X, ArrowUpRight } from 'lucide-react';

export interface WatchFloatingControlsProps {
  media: HTMLMediaElement;
  title: string;
  creator?: string;
  poster?: string;
  audioOnly?: boolean;
  mediaMount: (element: HTMLDivElement | null) => void;
  onReturn: () => void;
  onClose: () => void;
}

const safeTime = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const formatTime = (value: number) => {
  const seconds = Math.floor(safeTime(value));
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${hours}:` : ''}${hours ? String(Math.floor(seconds / 60) % 60).padStart(2, '0') : Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const readMedia = (media: HTMLMediaElement) => ({
  paused: media.paused || media.ended,
  time: safeTime(media.currentTime),
  duration: safeTime(media.duration),
  live: media.duration === Infinity,
  volume: Math.max(0, Math.min(1, media.volume)),
  muted: media.muted,
  rate: media.playbackRate,
  waiting: !media.paused && !media.ended && media.readyState < 3,
  failed: !!media.error,
});
const rangeStyle = (progress: number): CSSProperties => ({ '--cf-watch-floating-progress': `${Math.max(0, Math.min(100, progress))}%` } as CSSProperties);

/** Controls borrow the existing media element. They never create a second playback or change its source. */
export function WatchFloatingControls({ media, title, creator, poster, audioOnly = false, mediaMount, onReturn, onClose }: WatchFloatingControlsProps) {
  const [state, setState] = useState(() => readMedia(media));
  const [playError, setPlayError] = useState<string | null>(null);
  const generation = useRef(0);
  const lastAudibleVolume = useRef(media.volume || 1);

  useEffect(() => {
    const version = ++generation.current;
    const update = () => {
      if (generation.current !== version) return;
      setState(readMedia(media));
      if (media.volume > 0) lastAudibleVolume.current = media.volume;
    };
    const playing = () => { update(); setPlayError(null); };
    const events = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'volumechange', 'ratechange', 'waiting', 'ended', 'error', 'seeking', 'seeked', 'emptied'] as const;
    update(); setPlayError(null);
    events.forEach(event => media.addEventListener(event, update));
    media.addEventListener('playing', playing);
    return () => {
      generation.current = version + 1;
      events.forEach(event => media.removeEventListener(event, update));
      media.removeEventListener('playing', playing);
    };
  }, [media]);

  const togglePlay = useCallback(() => {
    if (!media.paused && !media.ended) { media.pause(); return; }
    const version = generation.current;
    setPlayError(null);
    try {
      void Promise.resolve(media.play()).catch(() => {
        if (generation.current === version) { setPlayError('A reprodução foi interrompida. Toque para continuar.'); setState(readMedia(media)); }
      });
    } catch {
      if (generation.current === version) { setPlayError('Não foi possível iniciar a reprodução.'); setState(readMedia(media)); }
    }
  }, [media]);

  const seek = useCallback((value: number) => {
    if (!Number.isFinite(media.duration) || media.duration <= 0) return;
    try { media.currentTime = Math.max(0, Math.min(media.duration, value)); setState(readMedia(media)); }
    catch { /* The source can become unavailable while the control is being dragged. */ }
  }, [media]);
  const mute = useCallback(() => {
    if (media.muted || media.volume === 0) {
      if (media.volume === 0) media.volume = lastAudibleVolume.current || 1;
      media.muted = false;
    } else media.muted = true;
    setState(readMedia(media));
  }, [media]);
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest('input, select, textarea, button, a, [contenteditable="true"]')) return;
    if (event.key === ' ' || event.key === 'k') { event.preventDefault(); togglePlay(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); seek(media.currentTime - 10); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); seek(media.currentTime + 10); }
    else if (event.key.toLowerCase() === 'm') { event.preventDefault(); mute(); }
  };
  const duration = state.duration;
  const seekable = duration > 0 && !state.live;
  const progress = seekable ? state.time / duration * 100 : 0;
  const silent = state.muted || state.volume === 0;
  const error = playError || (state.failed ? 'A reprodução está indisponível. Volte ao Watch para reconectar.' : null);

  return <section className={`cf-watch-floating${audioOnly ? ' cf-watch-floating--audio' : ''}${state.paused ? ' cf-watch-floating--paused' : ''}${error ? ' cf-watch-floating--error' : ''}`} aria-label="Mini player Classfy" onKeyDown={keyboard}>
    <header className="cf-watch-floating-header">
      <span className="cf-watch-floating-brand"><img src={`${window.location.origin}/brand/classfy-simbolo-vermelho.svg`} alt="" width="18" height="18" /><span>Classfy</span></span>
      <div className="cf-watch-floating-window-actions">
        <button type="button" onClick={onReturn} aria-label="Voltar ao Watch" title="Voltar ao Watch"><ArrowUpRight size={16} aria-hidden="true" /></button>
        <button type="button" onClick={onClose} aria-label="Fechar mini player" title="Fechar mini player"><X size={16} aria-hidden="true" /></button>
      </div>
    </header>

    <div className="cf-watch-floating-stage" tabIndex={0} aria-label={audioOnly ? 'Reprodução de áudio. Espaço pausa ou reproduz.' : 'Reprodução de vídeo. Espaço pausa ou reproduz.'}>
      {audioOnly && <div className="cf-watch-floating-art" aria-hidden="true">
        {poster ? <><img className="cf-watch-floating-art-backdrop" src={poster} alt="" /><img className="cf-watch-floating-art-cover" src={poster} alt="" /></> : <div className="cf-watch-floating-art-empty"><Headphones size={44} /></div>}
      </div>}
      <div ref={mediaMount} className="cf-watch-floating-media-mount" />
      {state.waiting && !error && <span className="cf-watch-floating-buffering" role="status" aria-label="Carregando reprodução"><Loader2 size={23} aria-hidden="true" /></span>}
      {error && <div className="cf-watch-floating-feedback" role="status"><span>{error}</span>{playError && <button type="button" onClick={togglePlay}>Continuar reprodução</button>}</div>}

      <div className="cf-watch-floating-overlay">
        <div className="cf-watch-floating-transport">
          <div className="cf-watch-floating-volume">
            <button type="button" className="cf-watch-floating-icon" onClick={mute} aria-label={silent ? 'Ativar som' : 'Silenciar'} title={silent ? 'Ativar som (M)' : 'Silenciar (M)'}>{silent ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}</button>
            <input className="cf-watch-floating-range cf-watch-floating-volume-range" aria-label="Volume" type="range" min="0" max="1" step="0.01" value={state.muted ? 0 : state.volume} style={rangeStyle((state.muted ? 0 : state.volume) * 100)} onChange={event => { media.volume = Number(event.target.value); media.muted = false; setState(readMedia(media)); }} />
          </div>
          <div className="cf-watch-floating-playback">
            <button type="button" className="cf-watch-floating-icon cf-watch-floating-skip" disabled={!seekable} onClick={() => seek(media.currentTime - 10)} aria-label="Voltar 10 segundos" title="Voltar 10 segundos"><RotateCcw size={21} aria-hidden="true" /><span>10</span></button>
            <button type="button" className="cf-watch-floating-play" onClick={togglePlay} aria-label={state.paused ? 'Reproduzir' : 'Pausar'} title={state.paused ? 'Reproduzir (espaço)' : 'Pausar (espaço)'}>{state.paused ? <Play size={22} fill="currentColor" aria-hidden="true" /> : <Pause size={22} fill="currentColor" aria-hidden="true" />}</button>
            <button type="button" className="cf-watch-floating-icon cf-watch-floating-skip" disabled={!seekable} onClick={() => seek(media.currentTime + 10)} aria-label="Avançar 10 segundos" title="Avançar 10 segundos"><RotateCw size={21} aria-hidden="true" /><span>10</span></button>
          </div>
          <select className="cf-watch-floating-speed" value={state.rate} aria-label="Velocidade de reprodução" title="Velocidade de reprodução" onChange={event => { media.playbackRate = Number(event.target.value); setState(readMedia(media)); }}>
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
          </select>
        </div>
        <div className="cf-watch-floating-timeline">
          <div className="cf-watch-floating-time"><time>{formatTime(state.time)}</time><span>{state.live ? 'Ao vivo' : formatTime(duration)}</span></div>
          <input className="cf-watch-floating-range cf-watch-floating-progress" aria-label="Posição da reprodução" aria-valuetext={`${formatTime(state.time)} de ${formatTime(duration)}`} type="range" min="0" max={duration || 1} step="0.1" value={Math.min(state.time, duration || 1)} disabled={!seekable} style={rangeStyle(progress)} onChange={event => seek(Number(event.target.value))} />
        </div>
      </div>
    </div>
    <footer className="cf-watch-floating-info"><strong title={title}>{title}</strong><span title={creator || 'Classfy'}>{creator || 'Classfy'}</span></footer>
  </section>;
}

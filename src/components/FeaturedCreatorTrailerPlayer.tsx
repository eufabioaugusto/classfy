import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Maximize, Minimize, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import "./featured-creator-trailer-player.css";

interface FeaturedCreatorTrailerPlayerProps {
  src: string | null;
  poster: string;
  creatorName: string;
  signedIn: boolean;
  onRegister: () => void;
  onExplore: () => void;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function FeaturedCreatorTrailerPlayer({ src, poster, creatorName, signedIn, onRegister, onExplore }: FeaturedCreatorTrailerPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const hasVideo = Boolean(src) && !mediaFailed;

  useEffect(() => {
    setMediaFailed(false);
    setPlaying(false);
    setHasStarted(false);
    setEnded(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video || !hasVideo) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    try {
      if (video.ended) video.currentTime = 0;
      await video.play();
    } catch {
      setMediaFailed(true);
      setPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const changeVolume = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    video.muted = value === 0;
    setVolume(value);
    setMuted(video.muted);
  };

  const changeRate = () => {
    const nextRate = rate === 1 ? 1.25 : rate === 1.25 ? 1.5 : rate === 1.5 ? 2 : 1;
    if (videoRef.current) videoRef.current.playbackRate = nextRate;
    setRate(nextRate);
  };

  const toggleFullscreen = async () => {
    if (!playerRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await playerRef.current.requestFullscreen();
  };

  const showPauseCta = hasStarted && !playing && hasVideo && !ended;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div ref={playerRef} className="featured-trailer" aria-label={`Trailer de ${creatorName}`}>
      {hasVideo ? (
        <video
          key={src}
          ref={videoRef}
          src={src || undefined}
          poster={poster}
          preload="metadata"
          playsInline
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => { setPlaying(true); setHasStarted(true); setEnded(false); }}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setEnded(true); }}
          onError={() => { setMediaFailed(true); setPlaying(false); }}
          onClick={togglePlayback}
          className="featured-trailer__video"
        />
      ) : (
        <img src={poster} alt="" className="featured-trailer__video" />
      )}

      <div className="featured-trailer__top">
        <span>Conheça {creatorName}</span>
        <span className="featured-trailer__badge">Trailer</span>
      </div>

      {showPauseCta ? (
        <div
          className="featured-trailer__message featured-trailer__message--paused"
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest("button")) void togglePlayback();
          }}
        >
          <span className="featured-trailer__message-kicker">CONTINUE SUA JORNADA</span>
          <h3>Gostou do que viu?</h3>
          <p>{signedIn ? `Explore as aulas e conteúdos de ${creatorName} na Classfy.` : "Crie sua conta grátis para descobrir mais aulas e creators na Classfy."}</p>
          <button type="button" onClick={signedIn ? onExplore : onRegister}>{signedIn ? "Ver conteúdos" : "Cadastrar grátis"}</button>
          <button type="button" className="featured-trailer__resume" onClick={togglePlayback}>Continuar trailer</button>
        </div>
      ) : hasVideo && !playing ? (
        <button type="button" className="featured-trailer__center-play" onClick={togglePlayback} aria-label={ended ? "Rever trailer" : "Reproduzir trailer"}>
          {ended ? <RotateCcw size={30} /> : <Play size={32} fill="currentColor" />}
        </button>
      ) : null}

      <div className="featured-trailer__controls">
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(currentTime, duration || 1)}
          disabled={!hasVideo || duration === 0}
          onChange={(event) => { if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); }}
          style={{ "--trailer-progress": `${progress}%` } as CSSProperties}
          aria-label="Progresso do trailer"
          className="featured-trailer__seek"
        />
        <div className="featured-trailer__controls-row">
          <button type="button" onClick={togglePlayback} disabled={!hasVideo} aria-label={playing ? "Pausar trailer" : "Reproduzir trailer"}>
            {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
          </button>
          <button type="button" onClick={toggleMute} disabled={!hasVideo} aria-label={muted ? "Ativar som" : "Silenciar"}>
            {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} disabled={!hasVideo}
            onChange={(event) => changeVolume(Number(event.target.value))} aria-label="Volume" className="featured-trailer__volume" />
          <span className="featured-trailer__time">{formatTime(currentTime)} / {duration > 0 ? formatTime(duration) : "--:--"}</span>
          <span className="featured-trailer__controls-spacer" />
          <button type="button" onClick={changeRate} disabled={!hasVideo} aria-label={`Velocidade ${rate} vezes`} className="featured-trailer__rate">{rate}×</button>
          <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}>
            {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </button>
        </div>
      </div>
    </div>
  );
}

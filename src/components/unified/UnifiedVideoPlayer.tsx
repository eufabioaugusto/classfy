import { useEffect, useRef, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  FileText,
  RectangleHorizontal,
  Minimize2,
  SkipBack,
  SkipForward,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useMediaSession } from "@/hooks/useMediaSession";
import { useContentMetrics } from "@/hooks/useContentMetrics";
import { cn } from "@/lib/utils";

export interface UnifiedVideoPlayerProps {
  content: {
    id: string;
    title: string;
    file_url: string;
    thumbnail_url?: string;
    content_type: "aula" | "short" | "podcast" | "curso" | "live";
    duration_seconds?: number;
    content_id?: string | null;
    lesson_id?: string | null;
    creator?: {
      display_name: string;
    };
  };
  mode?: "watch" | "study";
  compact?: boolean;
  onTimeUpdate?: (currentTime: number) => void;
  onVideoEnded?: () => void;
  onNoteCreated?: () => void;
  seekToTime?: number | null;
  theaterMode?: boolean;
  onTheaterModeToggle?: () => void;
  showNoteButton?: boolean;
  className?: string;
  /** Slot para toolbar de ferramentas (aparece como overlay no topo no hover) */
  toolbarSlot?: React.ReactNode;
}

export function UnifiedVideoPlayer({
  content,
  mode = "watch",
  compact = false,
  onTimeUpdate,
  onVideoEnded,
  onNoteCreated,
  seekToTime,
  theaterMode,
  onTheaterModeToggle,
  showNoteButton = true,
  className,
  toolbarSlot,
}: UnifiedVideoPlayerProps) {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showPlaybackMenu, setShowPlaybackMenu] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteTimestamp, setNoteTimestamp] = useState(0);
  const [noteMarkers, setNoteMarkers] = useState<number[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clickAnimation, setClickAnimation] = useState<"play" | "pause" | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  const controlsTimeoutRef = useRef<NodeJS.Timeout>();
  const volumeTimeoutRef = useRef<NodeJS.Timeout>();
  const clickAnimTimeoutRef = useRef<NodeJS.Timeout>();

  const { setMetadata, setPlaybackState, setPositionState, clearSession } = useMediaSession();
  const { handleTimeUpdate: trackMetrics } = useContentMetrics({
    contentId: content.content_id ?? content.id,
    duration: content.duration_seconds || duration,
  });

  const mediaRef = content.content_type === "podcast" ? audioRef : videoRef;
  const isVideo = content.content_type !== "podcast";

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire if focused on an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const media = mediaRef.current;
      if (!media) return;

      switch (e.code) {
        case "Space":
        case "KeyK":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          skip(-10);
          break;
        case "ArrowRight":
          e.preventDefault();
          skip(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          changeVolume(Math.min(1, volume + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          changeVolume(Math.max(0, volume - 0.1));
          break;
        case "KeyM":
          e.preventDefault();
          toggleMute();
          break;
        case "KeyF":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "KeyJ":
          e.preventDefault();
          skip(-10);
          break;
        case "KeyL":
          e.preventDefault();
          skip(10);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, volume, duration]);

  // ── Fullscreen change listener ────────────────────────────────────────────
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // ── Media Session ─────────────────────────────────────────────────────────
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !content.title) return;

    setMetadata({
      title: content.title,
      artist: content.creator?.display_name || "Classfy",
      artwork: content.thumbnail_url,
      onPlay: () => { media.play(); setIsPlaying(true); },
      onPause: () => { media.pause(); setIsPlaying(false); },
      onSeekBackward: () => { media.currentTime = Math.max(0, media.currentTime - 10); },
      onSeekForward: () => { media.currentTime = Math.min(media.duration || 0, media.currentTime + 10); },
      onSeekTo: (time) => { media.currentTime = time; setCurrentTime(time); },
    });

    return () => clearSession();
  }, [content.title, content.thumbnail_url, content.creator?.display_name, setMetadata, clearSession]);

  useEffect(() => {
    setPlaybackState(isPlaying ? "playing" : "paused");
  }, [isPlaying, setPlaybackState]);

  useEffect(() => {
    if (duration > 0) {
      setPositionState({ duration, position: currentTime, playbackRate });
    }
  }, [currentTime, duration, playbackRate, setPositionState]);

  // ── Load saved position ───────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (!user || !content.id) return;
      const { data } = await supabase
        .from("user_progress")
        .select("last_position_seconds")
        .eq("user_id", user.id)
        .eq("content_id", content.content_id ?? content.id)
        .maybeSingle();
      if (data?.last_position_seconds && data.last_position_seconds > 0) {
        const media = mediaRef.current;
        if (media) {
          media.currentTime = data.last_position_seconds;
          setCurrentTime(data.last_position_seconds);
        }
      }
    };
    load();
  }, [content.id, user]);

  // ── Load note markers ─────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (!user || !content.id) return;
      const { data, error } = await supabase
        .from("study_notes")
        .select("timestamp_seconds")
        .eq("user_id", user.id)
        .eq("content_id", content.content_id ?? content.id)
        .not("timestamp_seconds", "is", null);
      if (!error && data) {
        setNoteMarkers(data.map((n) => n.timestamp_seconds as number));
      }
    };
    load();
  }, [content.id, user]);

  // ── External seek ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (seekToTime !== null && seekToTime !== undefined) {
      const media = mediaRef.current;
      if (media) {
        media.currentTime = seekToTime;
        setCurrentTime(seekToTime);
        if (!isPlaying) { media.play(); setIsPlaying(true); }
      }
    }
  }, [seekToTime]);

  // ── Media event listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const onLoadedMetadata = () => setDuration(media.duration);

    const onTimeUpdateEv = () => {
      const t = media.currentTime;
      setCurrentTime(t);
      onTimeUpdate?.(t);
      trackMetrics(t);

      // Update buffered range
      if (media.buffered.length > 0) {
        setBuffered(media.buffered.end(media.buffered.length - 1));
      }
    };

    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);
    const onPlaying = () => setIsBuffering(false);

    const onEnded = async () => {
      setIsPlaying(false);
      if (user && content.id && media.duration) {
        await supabase.from("user_progress").upsert(
          {
            user_id: user.id,
            content_id: content.content_id ?? content.id,
            last_position_seconds: Math.floor(media.duration),
            progress_percent: 100,
            completed: true,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,content_id" }
        );
      }
      onVideoEnded?.();
    };

    const onPause = () => saveCurrentPosition(media.currentTime);

    media.addEventListener("loadedmetadata", onLoadedMetadata);
    media.addEventListener("timeupdate", onTimeUpdateEv);
    media.addEventListener("waiting", onWaiting);
    media.addEventListener("canplay", onCanPlay);
    media.addEventListener("playing", onPlaying);
    media.addEventListener("ended", onEnded);
    media.addEventListener("pause", onPause);

    return () => {
      saveCurrentPosition(media.currentTime);
      media.removeEventListener("loadedmetadata", onLoadedMetadata);
      media.removeEventListener("timeupdate", onTimeUpdateEv);
      media.removeEventListener("waiting", onWaiting);
      media.removeEventListener("canplay", onCanPlay);
      media.removeEventListener("playing", onPlaying);
      media.removeEventListener("ended", onEnded);
      media.removeEventListener("pause", onPause);
    };
  }, [content.id, content.content_id, user, duration, onTimeUpdate, onVideoEnded, trackMetrics]);

  const saveCurrentPosition = useCallback(async (time: number) => {
    if (!user || !content.id || !time || time < 1) return;
    await supabase.from("user_progress").upsert(
      {
        user_id: user.id,
        content_id: content.content_id ?? content.id,
        last_position_seconds: Math.floor(time),
        progress_percent: duration > 0 ? Math.floor((time / duration) * 100) : 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,content_id" }
    );
  }, [user, content.id, content.content_id, duration]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (isPlaying) {
      media.pause();
      setIsPlaying(false);
      triggerClickAnim("pause");
    } else {
      media.play();
      setIsPlaying(true);
      triggerClickAnim("play");
    }
  }, [isPlaying]);

  const skip = useCallback((seconds: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(0, Math.min(media.duration || 0, media.currentTime + seconds));
  }, []);

  const toggleMute = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const changeVolume = useCallback((val: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = val;
    setVolume(val);
    if (val === 0) {
      media.muted = true;
      setIsMuted(true);
    } else if (isMuted) {
      media.muted = false;
      setIsMuted(false);
    }
  }, [isMuted]);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, []);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const media = mediaRef.current;
    if (!media) return;
    const time = parseFloat(e.target.value);
    media.currentTime = time;
    setCurrentTime(time);
  };

  const changePlaybackRate = (rate: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.playbackRate = rate;
    setPlaybackRate(rate);
    setShowPlaybackMenu(false);
  };

  const triggerClickAnim = (type: "play" | "pause") => {
    setClickAnimation(type);
    if (clickAnimTimeoutRef.current) clearTimeout(clickAnimTimeoutRef.current);
    clickAnimTimeoutRef.current = setTimeout(() => setClickAnimation(null), 600);
  };

  // ── Controls visibility ───────────────────────────────────────────────────
  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  };

  const handleMouseLeave = () => {
    if (isPlaying) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 1000);
    }
  };

  // ── Progress bar hover ────────────────────────────────────────────────────
  const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || duration === 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    setHoverTime(pct * duration);
    setHoverX(x);
  };

  const handleProgressLeave = () => setHoverTime(null);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const media = mediaRef.current;
    if (!progressRef.current || !media || duration === 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const time = pct * duration;
    media.currentTime = time;
    setCurrentTime(time);
  };

  // ── Note ──────────────────────────────────────────────────────────────────
  const openNoteModal = () => {
    setNoteTimestamp(Math.floor(currentTime));
    setNoteModalOpen(true);
    const media = mediaRef.current;
    if (media && isPlaying) { media.pause(); setIsPlaying(false); }
  };

  const handleSaveNote = async () => {
    if (!noteText.trim() || !user) { toast.error("Digite uma nota antes de salvar"); return; }
    try {
      const { error } = await supabase.from("study_notes").insert({
        user_id: user.id,
        content_id: content.content_id ?? null,
        lesson_id: content.lesson_id ?? null,
        study_id: null,
        note_text: noteText,
        timestamp_seconds: noteTimestamp,
      });
      if (error) { toast.error("Erro ao salvar nota"); return; }
      setNoteMarkers((prev) => [...prev, noteTimestamp]);
      toast.success("Nota salva!");
      setNoteModalOpen(false);
      setNoteText("");
      onNoteCreated?.();
      const media = mediaRef.current;
      if (media) { media.play(); setIsPlaying(true); }
    } catch {
      toast.error("Erro ao salvar nota");
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const playedPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "relative overflow-hidden bg-black rounded-xl",
          compact && "rounded-none",
          theaterMode && "max-h-[calc(100vh-7rem)]",
          className
        )}
        onMouseMove={resetControlsTimeout}
        onMouseLeave={handleMouseLeave}
      >
        {isVideo ? (
          <video
            ref={videoRef}
            className={cn(
              "w-full",
              compact ? "h-full object-contain" : "aspect-video",
              theaterMode && "max-h-[calc(100vh-7rem)] object-contain"
            )}
            src={content.file_url}
            poster={content.thumbnail_url}
            onClick={togglePlay}
            onDoubleClick={toggleFullscreen}
          />
        ) : (
          <>
            <div
              className="w-full aspect-video flex items-center justify-center relative cursor-pointer"
              style={
                content.thumbnail_url
                  ? { backgroundImage: `url(${content.thumbnail_url})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : { background: "linear-gradient(135deg, hsl(var(--primary)/0.2), hsl(var(--background)))" }
              }
              onClick={togglePlay}
            >
              {content.thumbnail_url && <div className="absolute inset-0 bg-black/50" />}
              <div className="text-center relative z-10 pointer-events-none">
                <Volume2 className="w-16 h-16 mx-auto mb-4 text-white drop-shadow-lg" />
                <h3 className="text-xl font-semibold text-white drop-shadow-lg">{content.title}</h3>
              </div>
            </div>
            <audio ref={audioRef} src={content.file_url} />
          </>
        )}

        {/* Toolbar overlay — topo, aparece com os controles */}
        {toolbarSlot && (
          <div
            className={cn(
              "absolute top-0 left-0 right-0 z-20 transition-opacity duration-300",
              showControls ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
          >
            <div className="bg-gradient-to-b from-black/80 to-transparent px-3 pt-3 pb-6">
              {toolbarSlot}
            </div>
          </div>
        )}

        {/* Buffering spinner */}
        {isBuffering && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="w-12 h-12 text-white animate-spin opacity-80" />
          </div>
        )}

        {/* Click animation (play/pause flash) */}
        {clickAnimation && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/40 rounded-full p-4 animate-ping-once">
              {clickAnimation === "play"
                ? <Play className="w-10 h-10 text-white fill-white" />
                : <Pause className="w-10 h-10 text-white fill-white" />
              }
            </div>
          </div>
        )}

        {/* Controls overlay */}
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 transition-opacity duration-300",
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          {/* Gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />

          <div className="relative px-3 pb-3 pt-8 space-y-2">
            {/* Progress bar */}
            <div
              ref={progressRef}
              className="relative w-full h-4 flex items-center cursor-pointer group"
              onMouseMove={handleProgressHover}
              onMouseLeave={handleProgressLeave}
              onClick={handleProgressClick}
            >
              {/* Track */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 group-hover:h-1.5 transition-all duration-150 bg-white/20 rounded-full overflow-hidden">
                {/* Buffered */}
                <div
                  className="absolute inset-y-0 left-0 bg-white/30 rounded-full"
                  style={{ width: `${bufferedPct}%` }}
                />
                {/* Played */}
                <div
                  className="absolute inset-y-0 left-0 bg-primary rounded-full"
                  style={{ width: `${playedPct}%` }}
                />
              </div>

              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none"
                style={{ left: `calc(${playedPct}% - 6px)` }}
              />

              {/* Note markers */}
              {duration > 0 && noteMarkers.map((ts, i) => {
                if (ts == null || ts < 0 || ts > duration) return null;
                return (
                  <div
                    key={`m-${ts}-${i}`}
                    className="absolute top-1/2 -translate-y-1/2 w-1.5 h-3 bg-red-500 rounded-sm z-10 hover:bg-red-400 transition-colors pointer-events-auto"
                    style={{ left: `${(ts / duration) * 100}%`, transform: "translateX(-50%) translateY(-50%)" }}
                    title={`Nota em ${formatTime(ts)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const media = mediaRef.current;
                      if (media) { media.currentTime = ts; setCurrentTime(ts); if (!isPlaying) { media.play(); setIsPlaying(true); } }
                    }}
                  />
                );
              })}

              {/* Hover time tooltip */}
              {hoverTime !== null && (
                <div
                  className="absolute -top-8 px-1.5 py-0.5 bg-black/80 text-white text-xs rounded pointer-events-none select-none"
                  style={{ left: hoverX, transform: "translateX(-50%)" }}
                >
                  {formatTime(hoverTime)}
                </div>
              )}
            </div>

            {/* Buttons row */}
            <div className="flex items-center justify-between gap-1">
              {/* Left side */}
              <div className="flex items-center gap-0.5 sm:gap-1">
                {/* Skip back */}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => skip(-10)}
                  className="text-white hover:bg-white/20 h-8 w-8 flex-shrink-0"
                  title="Voltar 10s (←)"
                >
                  <SkipBack className="w-4 h-4" />
                </Button>

                {/* Play/Pause */}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={togglePlay}
                  className="text-white hover:bg-white/20 h-8 w-8 sm:h-9 sm:w-9 flex-shrink-0"
                >
                  {isPlaying ? <Pause className="w-4 h-4 sm:w-5 sm:h-5" /> : <Play className="w-4 h-4 sm:w-5 sm:h-5" />}
                </Button>

                {/* Skip forward */}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => skip(10)}
                  className="text-white hover:bg-white/20 h-8 w-8 flex-shrink-0"
                  title="Avançar 10s (→)"
                >
                  <SkipForward className="w-4 h-4" />
                </Button>

                {/* Volume */}
                <div
                  className="flex items-center gap-1 group/vol"
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  onMouseLeave={() => {
                    if (volumeTimeoutRef.current) clearTimeout(volumeTimeoutRef.current);
                    volumeTimeoutRef.current = setTimeout(() => setShowVolumeSlider(false), 400);
                  }}
                >
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={toggleMute}
                    className="text-white hover:bg-white/20 h-8 w-8 flex-shrink-0"
                  >
                    {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </Button>

                  <div
                    className={cn(
                      "overflow-hidden transition-all duration-200",
                      showVolumeSlider ? "w-20 opacity-100" : "w-0 opacity-0"
                    )}
                  >
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={(e) => changeVolume(parseFloat(e.target.value))}
                      className="w-full h-1 appearance-none cursor-pointer rounded-full"
                      style={{
                        background: `linear-gradient(to right, white 0%, white ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.3) ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.3) 100%)`
                      }}
                    />
                  </div>
                </div>

                {/* Time */}
                <span className="text-white text-xs font-medium whitespace-nowrap ml-1 hidden sm:block">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              {/* Right side */}
              <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
                {/* Note button */}
                {showNoteButton && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={openNoteModal}
                    className="text-white hover:bg-white/20 h-8 w-8"
                    title="Adicionar Nota"
                  >
                    <FileText className="w-4 h-4" />
                  </Button>
                )}

                {/* Playback Speed */}
                <div className="relative">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setShowPlaybackMenu(!showPlaybackMenu)}
                    className="text-white hover:bg-white/20 h-8 w-8"
                    title="Velocidade"
                  >
                    <span className="text-xs font-medium">{playbackRate}x</span>
                  </Button>

                  {showPlaybackMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-xl p-1 z-50 min-w-[80px]">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                        <button
                          key={rate}
                          onClick={() => changePlaybackRate(rate)}
                          className={cn(
                            "w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors",
                            playbackRate === rate
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-muted"
                          )}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Theater Mode */}
                {isVideo && onTheaterModeToggle && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={onTheaterModeToggle}
                    className="text-white hover:bg-white/20 h-8 w-8 hidden md:flex"
                    title={theaterMode ? "Sair do Modo Teatro" : "Modo Teatro"}
                  >
                    {theaterMode ? <Minimize2 className="w-4 h-4" /> : <RectangleHorizontal className="w-4 h-4" />}
                  </Button>
                )}

                {/* Fullscreen */}
                {isVideo && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={toggleFullscreen}
                    className="text-white hover:bg-white/20 h-8 w-8"
                    title="Tela cheia (F)"
                  >
                    {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Note Modal */}
      <Dialog open={noteModalOpen} onOpenChange={setNoteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Nota</DialogTitle>
            <DialogDescription>Timestamp: {formatTime(noteTimestamp)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Digite sua nota aqui..."
              rows={5}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNoteModalOpen(false)}>Cancelar</Button>
              <Button onClick={handleSaveNote}>Salvar Nota</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

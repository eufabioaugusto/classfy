import { useEffect, useRef, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Pause, Volume2, VolumeX, Maximize, FileText, RectangleHorizontal, Minimize2 } from "lucide-react";
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
    content_type: "aula" | "short" | "podcast" | "curso";
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
}: UnifiedVideoPlayerProps) {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showPlaybackMenu, setShowPlaybackMenu] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteTimestamp, setNoteTimestamp] = useState(0);
  const [noteMarkers, setNoteMarkers] = useState<number[]>([]);
  const controlsTimeoutRef = useRef<NodeJS.Timeout>();
  
  const { setMetadata, setPlaybackState, setPositionState, clearSession } = useMediaSession();
  const { handleTimeUpdate: trackMetrics } = useContentMetrics({
    contentId: content.content_id ?? content.id,
    duration: content.duration_seconds || duration,
  });

  const mediaRef = content.content_type === "podcast" ? audioRef : videoRef;
  const isVideo = content.content_type !== "podcast";

  // Setup Media Session for lock screen controls
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !content.title) return;

    setMetadata({
      title: content.title,
      artist: content.creator?.display_name || "Classfy",
      artwork: content.thumbnail_url,
      onPlay: () => {
        media.play();
        setIsPlaying(true);
      },
      onPause: () => {
        media.pause();
        setIsPlaying(false);
      },
      onSeekBackward: () => {
        media.currentTime = Math.max(0, media.currentTime - 10);
      },
      onSeekForward: () => {
        media.currentTime = Math.min(media.duration || 0, media.currentTime + 10);
      },
      onSeekTo: (time) => {
        media.currentTime = time;
        setCurrentTime(time);
      },
    });

    return () => {
      clearSession();
    };
  }, [content.title, content.thumbnail_url, content.creator?.display_name, setMetadata, clearSession]);

  // Update playback state
  useEffect(() => {
    setPlaybackState(isPlaying ? "playing" : "paused");
  }, [isPlaying, setPlaybackState]);

  // Update position state
  useEffect(() => {
    if (duration > 0) {
      setPositionState({
        duration,
        position: currentTime,
        playbackRate,
      });
    }
  }, [currentTime, duration, playbackRate, setPositionState]);

  // Load saved position
  useEffect(() => {
    const loadSavedPosition = async () => {
      if (!user || !content.id) return;

      try {
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
      } catch (error) {
        console.error("Error loading saved position:", error);
      }
    };

    loadSavedPosition();
  }, [content.id, user]);

  // Load note markers
  useEffect(() => {
    const loadNoteMarkers = async () => {
      if (!user || !content.id) return;

      try {
        const { data, error } = await supabase
          .from("study_notes")
          .select("timestamp_seconds")
          .eq("user_id", user.id)
          .eq("content_id", content.content_id ?? content.id)
          .not("timestamp_seconds", "is", null);

        if (error) throw error;

        const markers = data.map((note) => note.timestamp_seconds as number);
        setNoteMarkers(markers);
      } catch (error) {
        console.error("Error loading note markers:", error);
      }
    };

    loadNoteMarkers();
  }, [content.id, user]);

  // Handle seek from external trigger
  useEffect(() => {
    if (seekToTime !== null && seekToTime !== undefined) {
      const media = mediaRef.current;
      if (media) {
        media.currentTime = seekToTime;
        setCurrentTime(seekToTime);
        if (!isPlaying) {
          media.play();
          setIsPlaying(true);
        }
      }
    }
  }, [seekToTime]);

  // Media event listeners
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const handleLoadedMetadata = () => {
      setDuration(media.duration);
    };

    const handleTimeUpdateEvent = () => {
      const time = media.currentTime;
      setCurrentTime(time);
      onTimeUpdate?.(time);
      trackMetrics(time);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      onVideoEnded?.();
    };

    const handlePause = () => {
      saveCurrentPosition(media.currentTime);
    };

    media.addEventListener("loadedmetadata", handleLoadedMetadata);
    media.addEventListener("timeupdate", handleTimeUpdateEvent);
    media.addEventListener("ended", handleEnded);
    media.addEventListener("pause", handlePause);

    return () => {
      saveCurrentPosition(media.currentTime);
      media.removeEventListener("loadedmetadata", handleLoadedMetadata);
      media.removeEventListener("timeupdate", handleTimeUpdateEvent);
      media.removeEventListener("ended", handleEnded);
      media.removeEventListener("pause", handlePause);
    };
  }, [content.id, onTimeUpdate, onVideoEnded, trackMetrics]);

  const saveCurrentPosition = useCallback(async (time: number) => {
    if (!user || !content.id || !time || time < 1) return;

    try {
      await supabase
        .from("user_progress")
        .upsert(
          {
            user_id: user.id,
            content_id: content.content_id ?? content.id,
            last_position_seconds: Math.floor(time),
            progress_percent: duration > 0 ? Math.floor((time / duration) * 100) : 0,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id,content_id",
          }
        );
    } catch (error) {
      console.error("Error saving position:", error);
    }
  }, [user, content.id, content.content_id, duration]);

  const togglePlay = () => {
    const media = mediaRef.current;
    if (!media) return;

    if (isPlaying) {
      media.pause();
    } else {
      media.play();
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    const media = mediaRef.current;
    if (!media) return;

    media.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const toggleFullscreen = () => {
    const media = mediaRef.current;
    if (!media) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      media.requestFullscreen();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const media = mediaRef.current;
    if (!media) return;

    const time = parseFloat(e.target.value);
    media.currentTime = time;
    setCurrentTime(time);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  const handleMouseLeave = () => {
    if (isPlaying) {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 1000);
    }
  };

  const changePlaybackRate = (rate: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.playbackRate = rate;
    setPlaybackRate(rate);
    setShowPlaybackMenu(false);
  };

  const openNoteModal = () => {
    setNoteTimestamp(Math.floor(currentTime));
    setNoteModalOpen(true);

    const media = mediaRef.current;
    if (media && isPlaying) {
      media.pause();
      setIsPlaying(false);
    }
  };

  const handleSaveNote = async () => {
    if (!noteText.trim() || !user) {
      toast.error("Digite uma nota antes de salvar");
      return;
    }

    try {
      const contentIdToSave = content.content_id ?? null;
      const lessonIdToSave = content.lesson_id ?? null;

      const { error: insertError } = await supabase.from("study_notes").insert({
        user_id: user.id,
        content_id: contentIdToSave,
        lesson_id: lessonIdToSave,
        study_id: null,
        note_text: noteText,
        timestamp_seconds: noteTimestamp,
      });

      if (insertError) {
        console.error("Error saving note:", insertError);
        toast.error("Erro ao salvar nota");
        return;
      }

      setNoteMarkers((prev) => [...prev, noteTimestamp]);
      toast.success("Nota salva!");
      setNoteModalOpen(false);
      setNoteText("");
      onNoteCreated?.();

      const media = mediaRef.current;
      if (media) {
        media.play();
        setIsPlaying(true);
      }
    } catch (error) {
      console.error("Error saving note:", error);
      toast.error("Erro ao salvar nota");
    }
  };

  return (
    <>
      <Card
        className={cn(
          "relative overflow-hidden bg-black",
          compact && "border-0 rounded-none",
          className
        )}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {isVideo ? (
          <video
            ref={videoRef}
            className={cn("w-full", compact ? "h-full object-contain" : "aspect-video")}
            src={content.file_url}
            poster={content.thumbnail_url}
            onClick={togglePlay}
          />
        ) : (
          <>
            <div className="w-full aspect-video bg-gradient-to-br from-primary/20 to-background flex items-center justify-center">
              <div className="text-center">
                <Volume2 className="w-16 h-16 mx-auto mb-4 text-primary" />
                <h3 className="text-xl font-semibold">{content.title}</h3>
              </div>
            </div>
            <audio ref={audioRef} src={content.file_url} />
          </>
        )}

        {/* Custom Controls */}
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2 sm:p-4 transition-opacity duration-300",
            showControls ? "opacity-100" : "opacity-0"
          )}
        >
          {/* Progress Bar */}
          <div className="relative w-full mb-2 sm:mb-4">
            <input
              type="range"
              min="0"
              max={duration}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1 bg-white/30 rounded-lg appearance-none cursor-pointer slider relative z-0"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${
                  (currentTime / Math.max(duration, 1)) * 100
                }%, rgba(255,255,255,0.3) ${(currentTime / Math.max(duration, 1)) * 100}%, rgba(255,255,255,0.3) 100%)`,
              }}
            />

            {/* Note markers */}
            {duration > 0 &&
              noteMarkers.length > 0 &&
              noteMarkers.map((timestamp, index) => {
                if (timestamp == null || timestamp < 0 || timestamp > duration) return null;
                const position = (timestamp / duration) * 100;
                return (
                  <div
                    key={`marker-${timestamp}-${index}`}
                    className="absolute bottom-0 w-1 h-5 bg-red-500 z-20 cursor-pointer hover:bg-red-600 transition-colors"
                    style={{
                      left: `${position}%`,
                      transform: "translateX(-50%)",
                    }}
                    title={`Nota em ${formatTime(timestamp)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const media = mediaRef.current;
                      if (media) {
                        media.currentTime = timestamp;
                        setCurrentTime(timestamp);
                        if (!isPlaying) {
                          media.play();
                          setIsPlaying(true);
                        }
                      }
                    }}
                  />
                );
              })}
          </div>

          <div className="flex items-center justify-between gap-1 sm:gap-4">
            <div className="flex items-center gap-1 sm:gap-3 min-w-0">
              <Button
                size="icon"
                variant="ghost"
                onClick={togglePlay}
                className="text-white hover:bg-white/20 h-8 w-8 sm:h-10 sm:w-10 flex-shrink-0"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 sm:w-5 sm:h-5" />
                ) : (
                  <Play className="w-4 h-4 sm:w-5 sm:h-5" />
                )}
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={toggleMute}
                className="text-white hover:bg-white/20 h-8 w-8 sm:h-10 sm:w-10 flex-shrink-0"
              >
                {isMuted ? (
                  <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" />
                ) : (
                  <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                )}
              </Button>

              <span className="text-white text-xs sm:text-sm font-medium whitespace-nowrap">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              {/* Note Button */}
              {showNoteButton && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={openNoteModal}
                  className="text-white hover:bg-white/20 h-8 w-8 sm:h-10 sm:w-10"
                  title="Adicionar Nota"
                >
                  <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                </Button>
              )}

              {/* Playback Speed */}
              <div className="relative">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setShowPlaybackMenu(!showPlaybackMenu)}
                  className="text-white hover:bg-white/20 h-8 w-8 sm:h-10 sm:w-10 text-xs sm:text-sm"
                  title="Velocidade"
                >
                  <span className="text-xs">{playbackRate}x</span>
                </Button>

                {showPlaybackMenu && (
                  <div className="absolute bottom-full right-0 mb-2 bg-background border border-border rounded-lg shadow-lg p-1 sm:p-2 space-y-1 z-50">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                      <Button
                        key={rate}
                        size="sm"
                        variant={playbackRate === rate ? "default" : "ghost"}
                        onClick={() => changePlaybackRate(rate)}
                        className="w-full justify-start text-xs sm:text-sm"
                      >
                        {rate}x
                      </Button>
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
                  className="text-white hover:bg-white/20 h-8 w-8 sm:h-10 sm:w-10 hidden md:flex"
                  title={theaterMode ? "Sair do Modo Teatro" : "Modo Teatro"}
                >
                  {theaterMode ? (
                    <Minimize2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  ) : (
                    <RectangleHorizontal className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                </Button>
              )}

              {/* Fullscreen */}
              {isVideo && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={toggleFullscreen}
                  className="text-white hover:bg-white/20 h-8 w-8 sm:h-10 sm:w-10"
                >
                  <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

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
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNoteModalOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveNote}>Salvar Nota</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

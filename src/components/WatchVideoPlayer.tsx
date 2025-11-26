import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Volume2, VolumeX, Maximize, Settings, FileText, BookmarkPlus } from "lucide-react";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface WatchVideoPlayerProps {
  content: {
    id: string;
    title: string;
    file_url: string;
    thumbnail_url?: string;
    content_type: "aula" | "short" | "podcast" | "curso";
    duration_seconds?: number;
    content_id?: string | null; // ID do content real para lessons de curso
  };
  onTimeUpdate?: (currentTime: number) => void;
  onCreateNote?: () => void;
  seekToTime?: number | null;
}

export const WatchVideoPlayer = ({ content, onTimeUpdate, onCreateNote, seekToTime }: WatchVideoPlayerProps) => {
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
  const { trackProgress } = useRewardSystem();
  const controlsTimeoutRef = useRef<NodeJS.Timeout>();

  const mediaRef = content.content_type === "podcast" ? audioRef : videoRef;
  const isVideo = content.content_type !== "podcast";

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

        const markers = data.map(note => note.timestamp_seconds as number);
        console.log("📌 Marcadores carregados:", markers);
        setNoteMarkers(markers);
      } catch (error) {
        console.error("Error loading note markers:", error);
      }
    };

    loadNoteMarkers();
  }, [content.id, user]);

  // Handle seek from external trigger (notes)
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

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const handleLoadedMetadata = () => {
      setDuration(media.duration);
    };

    const handleTimeUpdate = () => {
      const time = media.currentTime;
      setCurrentTime(time);
      onTimeUpdate?.(time);
      handleProgressTracking(time);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    const handlePause = () => {
      saveCurrentPosition(media.currentTime);
    };

    media.addEventListener("loadedmetadata", handleLoadedMetadata);
    media.addEventListener("timeupdate", handleTimeUpdate);
    media.addEventListener("ended", handleEnded);
    media.addEventListener("pause", handlePause);

    return () => {
      saveCurrentPosition(media.currentTime);
      media.removeEventListener("loadedmetadata", handleLoadedMetadata);
      media.removeEventListener("timeupdate", handleTimeUpdate);
      media.removeEventListener("ended", handleEnded);
      media.removeEventListener("pause", handlePause);
    };
  }, [content.id]);

  const saveCurrentPosition = async (currentTime: number) => {
    if (!user || !content.id || !currentTime || currentTime < 1) return;

    try {
      await supabase
        .from("user_progress")
        .upsert({
          user_id: user.id,
          content_id: content.content_id ?? content.id,
          last_position_seconds: Math.floor(currentTime),
          progress_percent: duration > 0 ? Math.floor((currentTime / duration) * 100) : 0,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,content_id'
        });
    } catch (error) {
      console.error("Error saving position:", error);
    }
  };

  const handleProgressTracking = async (currentTime: number) => {
    if (!user || !content.id || duration === 0) return;

    const percent = (currentTime / duration) * 100;
    
    // Track progress every 5 seconds
    if (currentTime % 5 < 0.5) {
      await trackProgress(user.id, content.id, percent, currentTime);
    }
  };

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
    
    // Pausar o player ao abrir o modal de nota
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
      // Para notas, sempre usamos o content_id que referencia contents.id
      const contentIdToSave = content.content_id ?? null;
      
      const { error: insertError } = await supabase.from("study_notes").insert({
        user_id: user.id,
        content_id: contentIdToSave,
        study_id: null, // Notas standalone do Watch não precisam de estudo
        note_text: noteText,
        timestamp_seconds: noteTimestamp,
      });

      if (insertError) {
        console.error("Error saving note:", insertError);
        toast.error("Erro ao salvar nota");
        return;
      }

      // Adicionar marcador visual imediatamente
      setNoteMarkers(prev => [...prev, noteTimestamp]);

      toast.success("Nota salva!");
      setNoteModalOpen(false);
      setNoteText("");
      onCreateNote?.();
      
      // Dar play novamente após salvar a nota
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
        className="relative overflow-hidden bg-black"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {isVideo ? (
          <video
            ref={videoRef}
            className="w-full aspect-video"
            src={content.file_url}
            poster={content.thumbnail_url}
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
          className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* Progress Bar */}
          <div className="relative w-full mb-4">
            <input
              type="range"
              min="0"
              max={duration}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1 bg-white/30 rounded-lg appearance-none cursor-pointer slider relative z-0"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${(currentTime / Math.max(duration, 1)) * 100}%, rgba(255,255,255,0.3) ${(currentTime / Math.max(duration, 1)) * 100}%, rgba(255,255,255,0.3) 100%)`
              }}
            />
            
            {/* Note markers - rendered after input to be on top */}
            {duration > 0 && noteMarkers.length > 0 && noteMarkers.map((timestamp, index) => {
              if (timestamp == null || timestamp < 0 || timestamp > duration) return null;
              const position = (timestamp / duration) * 100;
              console.log(`📍 Marcador ${index + 1}: ${timestamp}s = ${position}%`);
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
                    console.log(`🎯 Clicou no marcador: ${timestamp}s`);
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

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Play/Pause */}
              <Button
                size="icon"
                variant="ghost"
                onClick={togglePlay}
                className="text-white hover:bg-white/20"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </Button>

              {/* Volume */}
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleMute}
                className="text-white hover:bg-white/20"
              >
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </Button>

              {/* Time */}
              <span className="text-white text-sm font-medium">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Add Note */}
              <Button
                size="sm"
                variant="ghost"
                onClick={openNoteModal}
                className="text-white hover:bg-white/20 gap-2"
              >
                <FileText className="w-4 h-4" />
                Adicionar Nota
              </Button>

              {/* Playback Speed */}
              <div className="relative">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowPlaybackMenu(!showPlaybackMenu)}
                  className="text-white hover:bg-white/20 gap-2"
                >
                  <Settings className="w-4 h-4" />
                  {playbackRate}x
                </Button>

                {showPlaybackMenu && (
                  <div className="absolute bottom-full right-0 mb-2 bg-background border border-border rounded-lg shadow-lg p-2 space-y-1">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                      <Button
                        key={rate}
                        size="sm"
                        variant={playbackRate === rate ? "default" : "ghost"}
                        onClick={() => changePlaybackRate(rate)}
                        className="w-full justify-start"
                      >
                        {rate}x
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fullscreen */}
              {isVideo && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={toggleFullscreen}
                  className="text-white hover:bg-white/20"
                >
                  <Maximize className="w-5 h-5" />
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
            <DialogDescription>
              Timestamp: {formatTime(noteTimestamp)}
            </DialogDescription>
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
              <Button onClick={handleSaveNote}>
                Salvar Nota
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

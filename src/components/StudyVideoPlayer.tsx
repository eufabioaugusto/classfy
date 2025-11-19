import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Pause, Volume2, VolumeX, Maximize, X, Settings, Maximize2 } from "lucide-react";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface StudyVideoPlayerProps {
  content: {
    id: string;
    title: string;
    file_url: string;
    content_type: "aula" | "short" | "podcast";
    duration_seconds?: number;
    savedPosition?: number;
  };
  studyId: string;
  onClose: () => void;
  onTranscriptionUpdate?: () => void;
  onCreateNote?: (timestamp: number) => void;
  onVideoEnded?: () => void;
}

export const StudyVideoPlayer = ({ content, studyId, onClose, onTranscriptionUpdate, onCreateNote, onVideoEnded }: StudyVideoPlayerProps) => {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showPlaybackMenu, setShowPlaybackMenu] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteTimestamp, setNoteTimestamp] = useState(0);
  const [metricsRecorded, setMetricsRecorded] = useState({
    start: false,
    half: false,
    complete: false,
  });
  const { processReward, trackProgress } = useRewardSystem();
  const controlsTimeoutRef = useRef<NodeJS.Timeout>();

  const mediaRef = content.content_type === "podcast" ? audioRef : videoRef;
  const isVideo = content.content_type !== "podcast";

  // Restore saved position when content loads
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !content.savedPosition) return;

    const restorePosition = () => {
      if (content.savedPosition && content.savedPosition > 0) {
        media.currentTime = content.savedPosition;
        setCurrentTime(content.savedPosition);
      }
    };

    // Restore once metadata is loaded
    if (media.readyState >= 1) {
      restorePosition();
    } else {
      media.addEventListener("loadedmetadata", restorePosition, { once: true });
    }

    return () => {
      media.removeEventListener("loadedmetadata", restorePosition);
    };
  }, [content.id, content.savedPosition]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const handleLoadedMetadata = () => {
      setDuration(media.duration);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(media.currentTime);
      handleProgressTracking(media.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      if (onVideoEnded) {
        onVideoEnded();
      }
    };

    const handlePause = () => {
      // Save position when video is paused
      saveCurrentPosition(media.currentTime);
    };

    media.addEventListener("loadedmetadata", handleLoadedMetadata);
    media.addEventListener("timeupdate", handleTimeUpdate);
    media.addEventListener("ended", handleEnded);
    media.addEventListener("pause", handlePause);

    return () => {
      // Save position when component unmounts
      saveCurrentPosition(media.currentTime);
      
      media.removeEventListener("loadedmetadata", handleLoadedMetadata);
      media.removeEventListener("timeupdate", handleTimeUpdate);
      media.removeEventListener("ended", handleEnded);
      media.removeEventListener("pause", handlePause);
    };
  }, [onVideoEnded]);

  const saveCurrentPosition = async (currentTime: number) => {
    if (!user || !content.id || !currentTime || currentTime < 1) return;

    try {
      await supabase
        .from("user_progress")
        .upsert({
          user_id: user.id,
          content_id: content.id,
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

    // Only track progress every 5 seconds or at key milestones
    const shouldTrack = 
      currentTime % 5 < 0.5 || // Every 5 seconds
      (percent >= 50 && !metricsRecorded.half) ||
      (percent >= 95 && !metricsRecorded.complete);

    if (!shouldTrack) return;

    if (percent >= 1 && !metricsRecorded.start) {
      setMetricsRecorded((prev) => ({ ...prev, start: true }));
    }

    if (percent >= 50 && !metricsRecorded.half) {
      setMetricsRecorded((prev) => ({ ...prev, half: true }));
    }

    if (percent >= 95 && !metricsRecorded.complete) {
      setMetricsRecorded((prev) => ({ ...prev, complete: true }));
    }

    // trackProgress now handles all reward logic internally
    await trackProgress(user.id, content.id, percent, currentTime);
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
  };

  const handleSaveNote = async () => {
    if (!noteText.trim() || !user) {
      toast.error("Digite uma anotação válida");
      return;
    }

    try {
      const { error } = await supabase.from("study_notes").insert({
        user_id: user.id,
        study_id: studyId,
        content_id: content.id,
        note_text: noteText,
        timestamp_seconds: noteTimestamp,
      });

      if (error) throw error;

      toast.success("Anotação salva com sucesso!");
      setNoteText("");
      setNoteModalOpen(false);
    } catch (error) {
      console.error("Error saving note:", error);
      toast.error("Erro ao salvar anotação");
    }
  };

  return (
    <>
      <Card className="h-full flex flex-col bg-background border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-foreground line-clamp-1">{content.title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Media Player */}
        <div 
          className="flex-1 bg-black relative flex items-center justify-center group"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {isVideo ? (
            <video
              ref={videoRef}
              src={content.file_url}
              className="w-full h-full object-contain cursor-pointer"
              onClick={togglePlay}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <audio ref={audioRef} src={content.file_url} />
              <div className="text-white text-center">
                <Play className="h-20 w-20 mx-auto mb-4 opacity-50" />
                <p className="text-lg">Podcast em reprodução</p>
              </div>
            </div>
          )}

          {/* Fixed Note Button - Top Right */}
          <button
            onClick={openNoteModal}
            className="absolute top-4 right-4 px-3 py-1.5 bg-black/70 hover:bg-black/90 text-white text-sm rounded transition-all duration-200 z-10"
          >
            Inserir Anotação
          </button>

          {/* YouTube-style Controls Overlay */}
          <div 
            className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity duration-300 ${
              showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            {/* Progress Bar */}
            <div className="px-4 pt-2">
              <input
                type="range"
                min="0"
                max={duration || 0}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1 bg-white/30 rounded-lg appearance-none cursor-pointer hover:h-1.5 transition-all"
                style={{
                  background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${
                    (currentTime / duration) * 100
                  }%, rgba(255,255,255,0.3) ${(currentTime / duration) * 100}%, rgba(255,255,255,0.3) 100%)`,
                }}
              />
            </div>

            {/* Control Buttons */}
            <div className="flex items-center justify-between px-4 pb-3 pt-2">
              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={togglePlay}
                  className="text-white hover:bg-white/20 h-10 w-10"
                >
                  {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={toggleMute}
                  className="text-white hover:bg-white/20 h-10 w-10"
                >
                  {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </Button>
                <span className="text-white text-sm font-medium ml-2">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Playback Speed */}
                <div className="relative">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setShowPlaybackMenu(!showPlaybackMenu)}
                    className="text-white hover:bg-white/20 h-10 px-3"
                  >
                    {playbackRate}x
                  </Button>
                  {showPlaybackMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-black/95 rounded-lg p-2 min-w-[100px]">
                      {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                        <button
                          key={rate}
                          onClick={() => changePlaybackRate(rate)}
                          className={`block w-full text-left px-3 py-2 text-sm rounded transition-colors ${
                            playbackRate === rate 
                              ? 'bg-white/20 text-white font-semibold' 
                              : 'text-white/80 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {isVideo && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={toggleFullscreen}
                    className="text-white hover:bg-white/20 h-10 w-10"
                  >
                    <Maximize2 className="h-5 w-5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Note Modal */}
      <Dialog open={noteModalOpen} onOpenChange={setNoteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar Anotação</DialogTitle>
            <DialogDescription>
              Adicione uma anotação no momento {formatTime(noteTimestamp)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <Textarea
              placeholder="Digite sua anotação..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={6}
              className="resize-none"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setNoteModalOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveNote}>
                Salvar Anotação
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

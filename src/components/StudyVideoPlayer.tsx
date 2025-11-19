import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Pause, Volume2, VolumeX, Maximize, X, StickyNote } from "lucide-react";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface StudyVideoPlayerProps {
  content: {
    id: string;
    title: string;
    file_url: string;
    content_type: "aula" | "short" | "podcast";
    duration_seconds?: number;
  };
  studyId: string;
  onClose: () => void;
  onTranscriptionUpdate?: () => void;
  onCreateNote?: (timestamp: number) => void;
}

export const StudyVideoPlayer = ({ content, studyId, onClose, onTranscriptionUpdate, onCreateNote }: StudyVideoPlayerProps) => {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [metricsRecorded, setMetricsRecorded] = useState({
    start: false,
    half: false,
    complete: false,
  });
  const { processReward, trackProgress } = useRewardSystem();

  const mediaRef = content.content_type === "podcast" ? audioRef : videoRef;
  const isVideo = content.content_type !== "podcast";

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

    media.addEventListener("loadedmetadata", handleLoadedMetadata);
    media.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      media.removeEventListener("loadedmetadata", handleLoadedMetadata);
      media.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, []);

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

  const handleCreateNote = () => {
    if (onCreateNote) {
      onCreateNote(Math.floor(currentTime));
    }
  };

  return (
    <Card className="h-full flex flex-col bg-background border-border">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-semibold text-foreground line-clamp-1">{content.title}</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Media Player */}
      <div className="flex-1 bg-black relative flex items-center justify-center">
        {isVideo ? (
          <video
            ref={videoRef}
            src={content.file_url}
            className="w-full h-full object-contain"
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
      </div>

      {/* Controls */}
      <div className="p-4 bg-muted border-t border-border">
        {/* Timeline */}
        <div className="mb-3">
          <input
            type="range"
            min="0"
            max={duration || 0}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${
                (currentTime / duration) * 100
              }%, hsl(var(--border)) ${(currentTime / duration) * 100}%, hsl(var(--border)) 100%)`,
            }}
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={togglePlay}>
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleMute}>
            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleCreateNote}
            title="Criar anotação neste momento"
          >
            <StickyNote className="h-5 w-5" />
          </Button>
          {isVideo && (
            <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="ml-auto">
              <Maximize className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};

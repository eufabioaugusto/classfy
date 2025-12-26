import { useRef, useState, useEffect } from "react";
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Maximize, 
  Settings,
  RotateCcw,
  RotateCw,
  FileText
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileVideoPlayerProps {
  src: string;
  poster?: string;
  title: string;
  onTimeUpdate?: (currentTime: number) => void;
  onNoteClick?: () => void;
  seekToTime?: number | null;
  isPodcast?: boolean;
}

export function MobileVideoPlayer({
  src,
  poster,
  title,
  onTimeUpdate,
  onNoteClick,
  seekToTime,
  isPodcast = false,
}: MobileVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const controlsTimeoutRef = useRef<NodeJS.Timeout>();
  const lastTapRef = useRef<number>(0);

  const mediaRef = isPodcast ? audioRef : videoRef;

  useEffect(() => {
    if (seekToTime !== null && seekToTime !== undefined && mediaRef.current) {
      mediaRef.current.currentTime = seekToTime;
      setCurrentTime(seekToTime);
    }
  }, [seekToTime]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const handleLoadedMetadata = () => setDuration(media.duration);
    const handleTimeUpdate = () => {
      setCurrentTime(media.currentTime);
      onTimeUpdate?.(media.currentTime);
    };
    const handleEnded = () => setIsPlaying(false);

    media.addEventListener("loadedmetadata", handleLoadedMetadata);
    media.addEventListener("timeupdate", handleTimeUpdate);
    media.addEventListener("ended", handleEnded);

    return () => {
      media.removeEventListener("loadedmetadata", handleLoadedMetadata);
      media.removeEventListener("timeupdate", handleTimeUpdate);
      media.removeEventListener("ended", handleEnded);
    };
  }, []);

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

  const handleTap = (e: React.TouchEvent) => {
    const now = Date.now();
    const container = containerRef.current;
    if (!container) return;

    const touch = e.changedTouches[0];
    const rect = container.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const width = rect.width;

    // Double tap detection
    if (now - lastTapRef.current < 300) {
      const media = mediaRef.current;
      if (!media) return;

      if (x < width / 3) {
        // Left third - rewind 10s
        media.currentTime = Math.max(0, media.currentTime - 10);
      } else if (x > (width * 2) / 3) {
        // Right third - forward 10s
        media.currentTime = Math.min(duration, media.currentTime + 10);
      } else {
        // Center - toggle fullscreen
        toggleFullscreen();
      }
    } else {
      // Single tap - show/hide controls
      setShowControls(!showControls);
    }

    lastTapRef.current = now;
  };

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video || isPodcast) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      video.requestFullscreen();
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

  const changePlaybackRate = (rate: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div 
      ref={containerRef}
      className="relative bg-black w-full max-w-full aspect-video overflow-hidden"
      onTouchEnd={handleTap}
    >
      {isPodcast ? (
        <>
          <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-primary/10 to-background flex items-center justify-center">
            <div className="text-center px-6">
              <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                <Volume2 className="w-10 h-10 text-primary" />
              </div>
              <h3 className="text-lg font-semibold line-clamp-2">{title}</h3>
            </div>
          </div>
          <audio ref={audioRef} src={src} />
        </>
      ) : (
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          src={src}
          poster={poster}
          playsInline
        />
      )}

      {/* Play button overlay */}
      {!isPlaying && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/30"
        >
          <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <Play className="w-8 h-8 text-black fill-black ml-1" />
          </div>
        </button>
      )}

      {/* Controls overlay */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent transition-opacity duration-200",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {/* Progress bar */}
        <div className="px-3 pb-1">
          <input
            type="range"
            min="0"
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${progressPercent}%, rgba(255,255,255,0.3) ${progressPercent}%, rgba(255,255,255,0.3) 100%)`
            }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-1">
            <button
              onClick={togglePlay}
              className="w-10 h-10 flex items-center justify-center text-white"
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </button>

            <button
              onClick={() => {
                const media = mediaRef.current;
                if (media) media.currentTime = Math.max(0, media.currentTime - 10);
              }}
              className="w-10 h-10 flex items-center justify-center text-white"
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            <button
              onClick={() => {
                const media = mediaRef.current;
                if (media) media.currentTime = Math.min(duration, media.currentTime + 10);
              }}
              className="w-10 h-10 flex items-center justify-center text-white"
            >
              <RotateCw className="w-5 h-5" />
            </button>

            <span className="text-white text-xs font-medium ml-1">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Note button */}
            {onNoteClick && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNoteClick();
                }}
                className="w-10 h-10 flex items-center justify-center text-white"
              >
                <FileText className="w-5 h-5" />
              </button>
            )}

            {/* Speed */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSpeedMenu(!showSpeedMenu);
                }}
                className="w-10 h-10 flex items-center justify-center text-white text-xs font-medium"
              >
                {playbackRate}x
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-2 bg-background border rounded-lg shadow-lg p-1 z-50">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <button
                      key={rate}
                      onClick={(e) => {
                        e.stopPropagation();
                        changePlaybackRate(rate);
                      }}
                      className={cn(
                        "block w-full px-4 py-2 text-sm text-left rounded hover:bg-muted transition-colors",
                        playbackRate === rate && "bg-primary/20 text-primary"
                      )}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Mute */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                const media = mediaRef.current;
                if (media) {
                  media.muted = !isMuted;
                  setIsMuted(!isMuted);
                }
              }}
              className="w-10 h-10 flex items-center justify-center text-white"
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>

            {/* Fullscreen */}
            {!isPodcast && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFullscreen();
                }}
                className="w-10 h-10 flex items-center justify-center text-white"
              >
                <Maximize className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Double-tap hints */}
      <div className={cn(
        "absolute inset-y-0 left-4 flex items-center pointer-events-none transition-opacity",
        showControls ? "opacity-50" : "opacity-0"
      )}>
        <RotateCcw className="w-6 h-6 text-white/50" />
      </div>
      <div className={cn(
        "absolute inset-y-0 right-4 flex items-center pointer-events-none transition-opacity",
        showControls ? "opacity-50" : "opacity-0"
      )}>
        <RotateCw className="w-6 h-6 text-white/50" />
      </div>
    </div>
  );
}

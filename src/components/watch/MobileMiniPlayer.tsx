import { useMiniPlayer } from "@/contexts/MiniPlayerContext";
import { useNavigate } from "react-router-dom";
import { X, Play, Pause } from "lucide-react";
import { motion, useMotionValue, useTransform, PanInfo, AnimatePresence } from "framer-motion";
import { useRef, useEffect, useCallback, useState } from "react";
import { cn } from "@/lib/utils";

const EXPAND_THRESHOLD = -80; // Drag up to expand

export function MobileMiniPlayer() {
  const navigate = useNavigate();
  const {
    state,
    videoRef,
    closeMiniPlayer,
    togglePlay,
    setCurrentTime,
    setDuration,
    setIsPlaying,
  } = useMiniPlayer();

  const [isDragging, setIsDragging] = useState(false);
  const y = useMotionValue(0);
  const progress = useTransform(
    () => (state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0)
  );

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !state.content) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => setDuration(video.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);

    // Set video src if needed
    if (state.content.file_url && video.src !== state.content.file_url) {
      video.src = state.content.file_url;
      video.currentTime = state.currentTime;
      if (state.isPlaying) {
        video.play().catch(console.error);
      }
    }

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
    };
  }, [state.content, videoRef]);

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleDragEnd = useCallback(
    (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      setIsDragging(false);
      const { offset, velocity } = info;

      // Drag up to expand (go to watch page)
      if (offset.y < EXPAND_THRESHOLD || velocity.y < -300) {
        if (state.content?.id) {
          navigate(`/watch/${state.content.id}`);
        }
      }
      // Drag down to dismiss
      else if (offset.y > 60 || velocity.y > 300) {
        closeMiniPlayer();
      }
      
      // Snap back
      y.set(0);
    },
    [state.content, navigate, closeMiniPlayer, y]
  );

  const handleGoToWatch = () => {
    if (state.content?.id) {
      navigate(`/watch/${state.content.id}`);
    }
  };

  const progressPercent = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;

  if (!state.isVisible || !state.content) return null;

  return (
    <AnimatePresence>
      <motion.div
        className={cn(
          "fixed z-50 left-2 right-2 bg-card rounded-xl shadow-2xl overflow-hidden border border-border",
          "bottom-[calc(4rem+env(safe-area-inset-bottom)+8px)]" // Above mobile nav
        )}
        style={{ y }}
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        drag="y"
        dragConstraints={{ top: -100, bottom: 100 }}
        dragElastic={0.2}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Progress bar at top */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-muted">
          <motion.div
            className="h-full bg-primary"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="flex items-center gap-3 p-2 pt-2.5">
          {/* Thumbnail / Video */}
          <div 
            className="relative w-28 aspect-video rounded-lg overflow-hidden bg-black flex-shrink-0 cursor-pointer"
            onClick={handleGoToWatch}
          >
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              poster={state.content.thumbnail_url}
              playsInline
              muted={false}
            />
            
            {/* Play/Pause overlay on video */}
            {!state.isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <Play className="w-6 h-6 text-white fill-white" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 py-1" onClick={handleGoToWatch}>
            <h4 className="text-sm font-medium text-foreground line-clamp-1">
              {state.content.title}
            </h4>
            <p className="text-xs text-muted-foreground line-clamp-1">
              {state.content.subtitle || state.content.creator?.display_name}
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="p-2 rounded-full hover:bg-muted transition-colors"
            >
              {state.isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5" />
              )}
            </button>
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeMiniPlayer();
              }}
              className="p-2 rounded-full hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drag hint */}
        {isDragging && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-x-0 -top-8 flex justify-center"
          >
            <span className="text-[10px] text-muted-foreground bg-card px-2 py-0.5 rounded-full border border-border shadow">
              ↑ Expandir • ↓ Fechar
            </span>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
import { useState, useEffect, useRef } from "react";
import { useMiniPlayer } from "@/contexts/MiniPlayerContext";
import { useNavigate } from "react-router-dom";
import { X, Play, Pause, ChevronUp, ChevronDown, PictureInPicture2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface RelatedContent {
  id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  creator?: { display_name: string } | null;
}

export const MiniPlayer = () => {
  const navigate = useNavigate();
  const {
    state,
    videoRef,
    closeMiniPlayer,
    togglePlay,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    expandPlayer,
    collapsePlayer,
  } = useMiniPlayer();

  const [isHovered, setIsHovered] = useState(false);
  const [relatedContents, setRelatedContents] = useState<RelatedContent[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch related contents when expanded
  useEffect(() => {
    if (state.isExpanded && state.content?.id) {
      fetchRelatedContents();
    }
  }, [state.isExpanded, state.content?.id]);

  const fetchRelatedContents = async () => {
    if (!state.content?.id) return;
    
    const { data } = await supabase
      .from("contents")
      .select("id, title, thumbnail_url, duration_seconds, creator:profiles!creator_id(display_name)")
      .eq("status", "approved")
      .neq("id", state.content.id)
      .limit(5);
    
    setRelatedContents(data || []);
  };

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

    // Auto-play when content loads
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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progressPercent = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;

  const handleGoToWatch = () => {
    if (state.content?.id) {
      navigate(`/watch/${state.content.id}`);
      closeMiniPlayer();
    }
  };

  const handlePlayRelated = (content: RelatedContent) => {
    navigate(`/watch/${content.id}`);
    closeMiniPlayer();
  };

  if (!state.isVisible || !state.content) return null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed z-50 bg-card border border-border rounded-xl shadow-2xl overflow-hidden transition-all duration-300",
        "bottom-4 right-4",
        state.isExpanded ? "w-[400px]" : "w-[400px]"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Video Container */}
      <div className="relative aspect-video bg-black cursor-pointer" onClick={handleGoToWatch}>
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          poster={state.content.thumbnail_url}
          playsInline
        />

        {/* Hover Controls Overlay */}
        <div
          className={cn(
            "absolute inset-0 bg-black/40 transition-opacity duration-200 flex items-center justify-center",
            isHovered ? "opacity-100" : "opacity-0"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top Left - Back to full player */}
          <button
            onClick={handleGoToWatch}
            className="absolute top-3 left-3 p-1.5 rounded-md bg-black/60 hover:bg-black/80 transition-colors"
            title="Voltar ao player"
          >
            <PictureInPicture2 className="h-4 w-4 text-white" />
          </button>

          {/* Top Right - Close */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeMiniPlayer();
            }}
            className="absolute top-3 right-3 p-1.5 rounded-md bg-black/60 hover:bg-black/80 transition-colors"
          >
            <X className="h-4 w-4 text-white" />
          </button>

          {/* Center - Play/Pause */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="p-3 rounded-full bg-black/60 hover:bg-black/80 transition-colors"
          >
            {state.isPlaying ? (
              <Pause className="h-6 w-6 text-white" />
            ) : (
              <Play className="h-6 w-6 text-white" />
            )}
          </button>

          {/* Bottom Left - Time */}
          <div className="absolute bottom-3 left-3 text-xs text-white font-medium">
            {formatTime(state.currentTime)} / {formatTime(state.duration)}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${progressPercent}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full"
            style={{ left: `${progressPercent}%`, transform: `translateX(-50%) translateY(-50%)` }}
          />
        </div>
      </div>

      {/* Info Bar */}
      <div className="p-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-foreground truncate">
            {state.content.title}
          </h4>
          <p className="text-xs text-muted-foreground truncate">
            {state.content.subtitle || state.content.creator?.display_name}
          </p>
        </div>
        <button
          onClick={() => state.isExpanded ? collapsePlayer() : expandPlayer()}
          className="p-1.5 rounded-md hover:bg-muted transition-colors flex-shrink-0"
        >
          {state.isExpanded ? (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
      </div>

      {/* Related Contents (Expanded) */}
      {state.isExpanded && (
        <div className="border-t border-border max-h-[300px] overflow-y-auto">
          {relatedContents.map((content) => (
            <div
              key={content.id}
              className={cn(
                "flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer transition-colors",
                content.id === state.content?.id && "bg-muted"
              )}
              onClick={() => handlePlayRelated(content)}
            >
              {/* Play indicator */}
              <div className="flex-shrink-0 w-6 flex items-center justify-center">
                <Play className="h-3 w-3 text-muted-foreground" />
              </div>

              {/* Thumbnail */}
              <div className="relative flex-shrink-0 w-24 aspect-video rounded overflow-hidden bg-muted">
                {content.thumbnail_url && (
                  <img
                    src={content.thumbnail_url}
                    alt={content.title}
                    className="w-full h-full object-cover"
                  />
                )}
                {content.duration_seconds && (
                  <span className="absolute bottom-1 right-1 px-1 py-0.5 text-[10px] bg-black/80 text-white rounded">
                    {formatTime(content.duration_seconds)}
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <h5 className="text-sm font-medium text-foreground line-clamp-2">
                  {content.title}
                </h5>
                <p className="text-xs text-muted-foreground truncate">
                  {content.creator?.display_name}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

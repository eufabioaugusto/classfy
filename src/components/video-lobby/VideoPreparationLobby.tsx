import { useState, useRef, useEffect, useCallback } from "react";
import { X, ChevronRight, Play, Pause, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoTrimBar } from "./VideoTrimBar";
import { LobbyToolbar } from "./LobbyToolbar";
import { CoverFrameSelector } from "@/components/CoverFrameSelector";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { captureCurrentFrame } from "./seekAndCapture";

type ContentType = "aula" | "short" | "podcast" | "curso";

interface VideoPreparationLobbyProps {
  videoSrc: string;
  contentType: ContentType;
  onConfirm: (data: {
    thumbnailFile?: File;
    thumbnailPreview?: string;
    trimStart: number;
    trimEnd: number;
    duration: number;
  }) => void;
  onClose: () => void;
  open: boolean;
}

export function VideoPreparationLobby({
  videoSrc,
  contentType,
  onConfirm,
  onClose,
  open,
}: VideoPreparationLobbyProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [coverMode, setCoverMode] = useState(false);
  const [trimActive, setTrimActive] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);

  // Poster overlay — shown during background seeks to prevent "trembling"
  const [posterOverlay, setPosterOverlay] = useState<string | null>(null);

  // Final applied thumbnail
  const [thumbnailFile, setThumbnailFile] = useState<File | undefined>();
  const [thumbnailPreview, setThumbnailPreview] = useState<string | undefined>();

  // Pending cover selection (not yet confirmed)
  const [pendingCoverFile, setPendingCoverFile] = useState<File | undefined>();
  const [pendingCoverPreview, setPendingCoverPreview] = useState<string | undefined>();

  const maxTrimDuration = contentType === "short" ? 90 : undefined;
  const isVertical = aspectRatio < 1;

  // Load metadata — uses loadedmetadata (much faster than loadeddata, works on iOS)
  useEffect(() => {
    if (!open || !videoSrc) return;
    setVideoReady(false);
    setPosterOverlay(null);

    const v = videoRef.current;
    if (!v) return;

    let resolved = false;

    const handleReady = () => {
      if (resolved) return;
      resolved = true;
      const d = v.duration;
      if (!d || !isFinite(d) || d <= 0) return;
      const ratio = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
      setDuration(d);
      setAspectRatio(ratio);
      setTrimStart(0);
      setTrimEnd(maxTrimDuration ? Math.min(d, maxTrimDuration) : d);
      setVideoReady(true);
      // Force first frame render — seek to 0.01 to paint a frame on paused video
      if (v.currentTime === 0) {
        v.currentTime = 0.01;
      }
    };

    v.addEventListener("loadedmetadata", handleReady);
    v.addEventListener("canplay", handleReady);

    // Fallback: if neither fires within 3s, try forcing
    const fallbackTimer = setTimeout(() => {
      if (!resolved && v.readyState >= 1) handleReady();
    }, 3000);

    return () => {
      v.removeEventListener("loadedmetadata", handleReady);
      v.removeEventListener("canplay", handleReady);
      clearTimeout(fallbackTimer);
    };
  }, [open, videoSrc, maxTrimDuration]);

  // Sync playback with trim range
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => {
      setCurrentTime(v.currentTime);
      if (v.currentTime >= trimEnd) {
        v.currentTime = trimStart;
      }
    };

    v.addEventListener("timeupdate", onTimeUpdate);
    return () => v.removeEventListener("timeupdate", onTimeUpdate);
  }, [trimStart, trimEnd]);

  // Poster overlay management: show static frame while seeks happen in background
  const handleGeneratingFrames = useCallback((generating: boolean) => {
    if (generating) {
      const v = videoRef.current;
      if (v) {
        const poster = captureCurrentFrame(v, v.videoWidth || 1280, v.videoHeight || 720);
        if (poster) setPosterOverlay(poster);
      }
    } else {
      setPosterOverlay(null);
    }
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < trimStart || v.currentTime >= trimEnd) {
        v.currentTime = trimStart;
      }
      v.muted = false;
      setIsMuted(false);
      v.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }, [trimStart, trimEnd]);

  const handleTrimChange = useCallback((start: number, end: number) => {
    setTrimStart(start);
    setTrimEnd(end);
    const v = videoRef.current;
    if (v) {
      v.currentTime = Math.max(0.01, start);
      // Force visual update on paused video (mobile Safari)
      if (v.paused) {
        v.play().then(() => {
          requestAnimationFrame(() => v.pause());
        }).catch(() => {});
      }
    }
  }, []);

  // Cover selection stores pending, not applied yet
  const handleCoverFrameSelect = useCallback((file: File, previewUrl: string) => {
    setPendingCoverFile(file);
    setPendingCoverPreview(previewUrl);
  }, []);

  // Confirm cover selection
  const handleCoverConfirm = useCallback(() => {
    if (pendingCoverFile && pendingCoverPreview) {
      setThumbnailFile(pendingCoverFile);
      setThumbnailPreview(pendingCoverPreview);
    }
    setCoverMode(false);
    setPendingCoverFile(undefined);
    setPendingCoverPreview(undefined);
  }, [pendingCoverFile, pendingCoverPreview]);

  // Cancel cover selection
  const handleCoverCancel = useCallback(() => {
    setCoverMode(false);
    setPendingCoverFile(undefined);
    setPendingCoverPreview(undefined);
  }, []);

  // Pause video when entering cover mode
  const handleOpenCoverMode = useCallback(() => {
    const v = videoRef.current;
    if (v && !v.paused) {
      v.pause();
      setIsPlaying(false);
    }
    setCoverMode(true);
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm({
      thumbnailFile,
      thumbnailPreview,
      trimStart,
      trimEnd,
      duration: trimEnd - trimStart,
    });
  }, [onConfirm, thumbnailFile, thumbnailPreview, trimStart, trimEnd]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black flex flex-col"
          style={{ touchAction: "none" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 z-10 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="p-2 -ml-2 text-white/80 hover:text-white rounded-full transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            <Button type="button" size="sm" onClick={handleConfirm} className="gap-1 font-semibold">
              Avançar
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Video Preview */}
          <div className="flex-1 flex items-center justify-center overflow-hidden relative min-h-0">
            {!videoReady && (
              <div className="absolute inset-0 flex items-center justify-center z-20">
                <Loader2 className="w-10 h-10 text-white/60 animate-spin" />
              </div>
            )}

            {/* Poster overlay — covers video during background seeks */}
            {posterOverlay && (
              <img
                src={posterOverlay}
                alt=""
                className={cn(
                  "absolute z-30 max-w-full max-h-full pointer-events-none",
                  isVertical ? "h-full w-auto" : "w-full h-auto"
                )}
                style={{ objectFit: "contain" }}
              />
            )}

            <video
              ref={videoRef}
              src={videoSrc}
              className={cn(
                "max-w-full max-h-full transition-opacity duration-300",
                isVertical ? "h-full w-auto" : "w-full h-auto",
                videoReady ? "opacity-100" : "opacity-0"
              )}
              playsInline
              muted={isMuted}
              loop
              preload="auto"
              onClick={togglePlay}
              style={{ objectFit: "contain" }}
            />
            {!isPlaying && videoReady && !posterOverlay && (
              <button
                type="button"
                onClick={togglePlay}
                className="absolute inset-0 flex items-center justify-center z-10"
              >
                <div className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                  <Play className="w-8 h-8 text-white ml-1" />
                </div>
              </button>
            )}
          </div>

          {/* Playback info */}
          <div className="flex items-center justify-center gap-3 px-4 py-2 shrink-0">
            <button type="button" onClick={togglePlay} className="p-1.5 text-white/80 hover:text-white">
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <span className="text-xs text-white/60 font-mono tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Trim bar — uses the same videoRef, zero extra video elements */}
          <div className="px-4 shrink-0">
            <VideoTrimBar
              videoRef={videoRef}
              videoReady={videoReady}
              duration={duration}
              trimStart={trimStart}
              trimEnd={trimEnd}
              onTrimChange={handleTrimChange}
              onGeneratingFrames={handleGeneratingFrames}
              maxDuration={maxTrimDuration}
            />
          </div>

          {/* Toolbar */}
          <div className="shrink-0 pb-safe">
            <LobbyToolbar
              onCoverSelect={handleOpenCoverMode}
              onTrimToggle={() => setTrimActive(!trimActive)}
              trimActive={trimActive}
            />
          </div>

          {/* Fullscreen cover selector overlay — uses the same videoRef */}
          <AnimatePresence>
            {coverMode && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 z-[110] bg-black flex flex-col"
              >
                <div className="flex items-center justify-between px-4 py-3 shrink-0">
                  <button
                    type="button"
                    onClick={handleCoverCancel}
                    className="p-2 -ml-2 text-white/80 hover:text-white rounded-full transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                  <span className="text-white font-semibold text-base">Escolher capa</span>
                  <Button type="button" size="sm" onClick={handleCoverConfirm} className="font-semibold">
                    Confirmar
                  </Button>
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                  <CoverFrameSelector
                    videoRef={videoRef}
                    videoReady={videoReady}
                    duration={duration}
                    videoAspect={aspectRatio}
                    onFrameSelect={handleCoverFrameSelect}
                    onGeneratingFrames={handleGeneratingFrames}
                    className="border-0 rounded-none bg-transparent flex-1"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

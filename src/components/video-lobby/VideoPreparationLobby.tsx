import { useState, useRef, useEffect, useCallback } from "react";
import { X, ChevronRight, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoTrimBar } from "./VideoTrimBar";
import { LobbyToolbar } from "./LobbyToolbar";
import { CoverFrameSelector } from "@/components/CoverFrameSelector";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

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
  const [coverSheetOpen, setCoverSheetOpen] = useState(false);
  const [trimActive, setTrimActive] = useState(true);
  const [thumbnailFile, setThumbnailFile] = useState<File | undefined>();
  const [thumbnailPreview, setThumbnailPreview] = useState<string | undefined>();

  const maxTrimDuration = contentType === "short" ? 90 : undefined;
  const isVertical = aspectRatio < 1;

  // Load video metadata
  useEffect(() => {
    if (!open || !videoSrc) return;

    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "true");
    if (!videoSrc.startsWith("blob:")) v.crossOrigin = "anonymous";
    v.src = videoSrc;

    const onMeta = () => {
      const d = v.duration;
      const ratio = v.videoWidth / v.videoHeight;
      setDuration(d);
      setAspectRatio(ratio);
      setTrimStart(0);
      setTrimEnd(maxTrimDuration ? Math.min(d, maxTrimDuration) : d);
      v.remove();
    };

    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("error", () => v.remove());
    v.load();

    return () => { v.remove(); };
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

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < trimStart || v.currentTime >= trimEnd) {
        v.currentTime = trimStart;
      }
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
    if (v) v.currentTime = start;
  }, []);

  const handleCoverSelect = useCallback((file: File, previewUrl: string) => {
    setThumbnailFile(file);
    setThumbnailPreview(previewUrl);
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

            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              className="gap-1 font-semibold"
            >
              Avançar
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Video Preview */}
          <div className="flex-1 flex items-center justify-center overflow-hidden relative min-h-0">
            <video
              ref={videoRef}
              src={videoSrc}
              className={cn(
                "max-w-full max-h-full",
                isVertical ? "h-full w-auto" : "w-full h-auto"
              )}
              playsInline
              muted
              loop
              preload="auto"
              onClick={togglePlay}
              style={{ objectFit: "contain" }}
            />

            {/* Play/pause overlay */}
            {!isPlaying && (
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
            <button
              type="button"
              onClick={togglePlay}
              className="p-1.5 text-white/80 hover:text-white"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <span className="text-xs text-white/60 font-mono tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Trim bar */}
          <div className="px-4 shrink-0">
            <VideoTrimBar
              videoSrc={videoSrc}
              duration={duration}
              trimStart={trimStart}
              trimEnd={trimEnd}
              onTrimChange={handleTrimChange}
              maxDuration={maxTrimDuration}
            />
          </div>

          {/* Toolbar */}
          <div className="shrink-0 pb-safe">
            <LobbyToolbar
              onCoverSelect={() => setCoverSheetOpen(true)}
              onTrimToggle={() => setTrimActive(!trimActive)}
              trimActive={trimActive}
            />
          </div>

          {/* Cover selector sheet */}
          <Sheet open={coverSheetOpen} onOpenChange={setCoverSheetOpen}>
            <SheetContent side="bottom" className="max-h-[80vh] bg-background rounded-t-2xl p-0">
              <SheetHeader className="px-4 pt-4 pb-2">
                <SheetTitle>Escolher capa</SheetTitle>
              </SheetHeader>
              <div className="px-4 pb-6 overflow-auto">
                <CoverFrameSelector
                  videoSrc={videoSrc}
                  onFrameSelect={handleCoverSelect}
                  className="border-0"
                />
                <Button
                  type="button"
                  className="w-full mt-4"
                  onClick={() => setCoverSheetOpen(false)}
                >
                  Confirmar capa
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Loader2, ImageIcon, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { seekAndCapture, generateFramesFromRef, dataURLtoFile } from "@/components/video-lobby/seekAndCapture";

interface CoverFrameSelectorProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  videoReady: boolean;
  duration: number;
  videoAspect: number;
  onFrameSelect: (file: File, previewUrl: string) => void;
  className?: string;
}

const FRAME_COUNT_DESKTOP = 12;
const FRAME_COUNT_MOBILE = 8;

function getFrameCount() {
  return window.innerWidth < 768 ? FRAME_COUNT_MOBILE : FRAME_COUNT_DESKTOP;
}

export function CoverFrameSelector({
  videoRef,
  videoReady,
  duration,
  videoAspect,
  onFrameSelect,
  className,
}: CoverFrameSelectorProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [currentPreview, setCurrentPreview] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const isDragging = useRef(false);
  const abortRef = useRef(false);
  const frameCountRef = useRef(getFrameCount());
  const generatingRef = useRef(false);

  // Generate frames using the lobby's video element — zero createElement("video")
  useEffect(() => {
    if (!videoReady || !videoRef.current || duration <= 0 || generatingRef.current) return;
    generatingRef.current = true;
    abortRef.current = false;

    const video = videoRef.current;
    const savedTime = video.currentTime;
    video.pause();

    const FRAME_COUNT = frameCountRef.current;
    const thumbWidth = Math.min(320, window.innerWidth / 2);

    generateFramesFromRef(video, FRAME_COUNT, thumbWidth, { get aborted() { return abortRef.current; } }).then((generated) => {
      if (abortRef.current) return;

      if (generated.length === 0) {
        setError(true);
        setLoading(false);
        generatingRef.current = false;
        return;
      }

      setFrames(generated);
      setLoading(false);

      // Auto-select at 25% VISUALLY only — do NOT call onFrameSelect
      const autoIndex = Math.floor(FRAME_COUNT * 0.25);
      setSelectedIndex(autoIndex);
      setCurrentPreview(generated[autoIndex]);

      // Restore video position
      if (videoRef.current) {
        videoRef.current.currentTime = savedTime;
      }
      generatingRef.current = false;
    });

    return () => { abortRef.current = true; generatingRef.current = false; };
  }, [videoReady, videoRef, duration]);

  // HQ capture using the same video element
  const captureAndSelect = useCallback(async (index: number) => {
    const video = videoRef.current;
    if (!video) return;

    const FRAME_COUNT = frameCountRef.current;
    const time = Math.min((duration / FRAME_COUNT) * index + 0.1, duration - 0.1);

    try {
      const hqWidth = 1920;
      const hqHeight = Math.round(hqWidth / videoAspect);
      const dataUrl = await seekAndCapture(video, time, hqWidth, hqHeight, 0.85);
      setCurrentPreview(dataUrl);
      const file = dataURLtoFile(dataUrl, `cover_${Date.now()}.jpg`);
      onFrameSelect(file, dataUrl);
    } catch (e) {
      console.warn("HQ frame capture failed:", e);
    }
  }, [duration, videoAspect, videoRef, onFrameSelect]);

  const handleStripInteraction = useCallback((clientX: number) => {
    const strip = stripRef.current;
    if (!strip || frames.length === 0) return;
    const rect = strip.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = x / rect.width;
    const index = Math.min(Math.floor(ratio * frames.length), frames.length - 1);
    if (index !== selectedIndex) {
      setSelectedIndex(index);
      setCurrentPreview(frames[index]);
      captureAndSelect(index);
    }
  }, [frames, selectedIndex, captureAndSelect]);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handleStripInteraction(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    handleStripInteraction(e.clientX);
  };

  const handlePointerUp = () => {
    isDragging.current = false;
  };

  if (loading) {
    return (
      <div className={cn("flex-1 flex items-center justify-center", className)}>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Gerando preview de capa...</span>
        </div>
      </div>
    );
  }

  if (error || frames.length === 0) {
    return (
      <div className={cn("flex-1 flex items-center justify-center", className)}>
        <div className="flex items-center gap-3 text-muted-foreground">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">Não foi possível gerar preview.</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn("flex flex-col h-full", className)}
    >
      {currentPreview && (
        <div className="flex-1 relative bg-black flex items-center justify-center min-h-0">
          <img
            src={currentPreview}
            alt="Capa selecionada"
            className={cn(
              "max-w-full max-h-full object-contain",
              videoAspect < 1 ? "h-full w-auto" : "w-full h-auto"
            )}
          />
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-white text-xs font-medium flex items-center gap-1.5">
            <ImageIcon className="w-3 h-3" />
            Capa do vídeo
          </div>
        </div>
      )}

      <div className="p-3 space-y-2 shrink-0">
        <p className="text-xs text-white/60">Arraste para escolher o frame da capa</p>
        <div
          ref={stripRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="relative flex h-14 rounded-lg overflow-hidden cursor-grab active:cursor-grabbing touch-none select-none"
        >
          {frames.map((frame, i) => (
            <div
              key={i}
              className={cn(
                "flex-1 relative border-r border-black/20 last:border-r-0 transition-all duration-100",
                selectedIndex === i && "ring-2 ring-accent ring-inset z-10"
              )}
            >
              <img src={frame} alt="" className="w-full h-full object-cover pointer-events-none" draggable={false} />
            </div>
          ))}
          {selectedIndex >= 0 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-accent shadow-[0_0_6px_rgba(var(--accent),0.5)] z-20 pointer-events-none transition-all duration-100"
              style={{ left: `${((selectedIndex + 0.5) / frames.length) * 100}%` }}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}

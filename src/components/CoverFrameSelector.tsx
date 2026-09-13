import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Loader2, ImageIcon, AlertCircle, Check } from "lucide-react";
import { motion } from "framer-motion";
import {
  seekAndCapture,
  generateFramesProgressive,
  dataURLtoFile,
} from "@/components/video-lobby/seekAndCapture";

interface CoverFrameSelectorProps {
  /** Hidden capture video ref — never the visible player */
  captureVideoRef: React.RefObject<HTMLVideoElement>;
  captureReady: boolean;
  duration: number;
  videoAspect: number;
  onFrameSelect: (file: File, previewUrl: string) => void;
  selectionMode?: "immediate" | "confirm";
  confirmLabel?: string;
  className?: string;
}

const FRAME_COUNT_DESKTOP = 12;
const FRAME_COUNT_MOBILE = 8;

function getFrameCount() {
  return window.innerWidth < 768 ? FRAME_COUNT_MOBILE : FRAME_COUNT_DESKTOP;
}

export function CoverFrameSelector({
  captureVideoRef,
  captureReady,
  duration,
  videoAspect,
  onFrameSelect,
  selectionMode = "immediate",
  confirmLabel = "Usar este frame",
  className,
}: CoverFrameSelectorProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const frameCountRef = useRef(getFrameCount());
  const FRAME_COUNT = frameCountRef.current;

  const [frames, setFrames] = useState<(string | null)[]>(() =>
    Array(FRAME_COUNT).fill(null),
  );
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [currentPreview, setCurrentPreview] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState(false);
  const isDragging = useRef(false);
  const capturingRef = useRef(false);
  const selectedIndexRef = useRef(-1);
  const abortRef = useRef(false);
  const generatingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Generate frames progressively on the hidden capture video
  useEffect(() => {
    if (
      !captureReady ||
      !captureVideoRef.current ||
      duration <= 0 ||
      generatingRef.current
    )
      return;
    generatingRef.current = true;
    abortRef.current = false;

    const video = captureVideoRef.current;

    const startGeneration = () => {
      const thumbWidth = Math.min(320, window.innerWidth / 2);

      // 8s total timeout
      timeoutRef.current = setTimeout(() => {
        abortRef.current = true;
        setError(true);
        setLoading(false);
        generatingRef.current = false;
      }, 8000);

      generateFramesProgressive(
        video,
        FRAME_COUNT,
        thumbWidth,
        (index, dataUrl) => {
          if (abortRef.current) return;
          setFrames((prev) => {
            const next = [...prev];
            next[index] = dataUrl;
            return next;
          });
          // Auto-select at 25% on first meaningful frame
          if (index === Math.floor(FRAME_COUNT * 0.25)) {
            setSelectedIndex(index);
            selectedIndexRef.current = index;
            setCurrentPreview(dataUrl);
          }
          // Hide loader once first frame arrives
          if (index === 0) setLoading(false);
        },
        {
          get aborted() {
            return abortRef.current;
          },
        },
      ).then((generated) => {
        clearTimeout(timeoutRef.current);
        if (abortRef.current) return;
        if (generated.length === 0) {
          setError(true);
          setLoading(false);
        }
        generatingRef.current = false;
      });
    };

    if (video.readyState >= 2) {
      startGeneration();
    } else {
      const onCanPlay = () => {
        video.removeEventListener("canplay", onCanPlay);
        if (!abortRef.current) startGeneration();
      };
      video.addEventListener("canplay", onCanPlay);
      video
        .play()
        .then(() => video.pause())
        .catch(() => {});
    }

    return () => {
      abortRef.current = true;
      clearTimeout(timeoutRef.current);
      generatingRef.current = false;
    };
  }, [captureReady, captureVideoRef, duration, FRAME_COUNT]);

  // HQ capture on the hidden capture video
  const captureAndSelect = useCallback(
    async (index: number) => {
      const video = captureVideoRef.current;
      if (!video || index < 0 || capturingRef.current) return;

      const time = Math.min(
        (duration / FRAME_COUNT) * index + 0.1,
        duration - 0.1,
      );

      capturingRef.current = true;
      setCapturing(true);
      try {
        const hqWidth = 1280;
        const hqHeight = Math.round(hqWidth / videoAspect);
        const dataUrl = await seekAndCapture(
          video,
          time,
          hqWidth,
          hqHeight,
          0.85,
        );
        setCurrentPreview(dataUrl);
        const file = dataURLtoFile(dataUrl, `cover_${Date.now()}.jpg`);
        onFrameSelect(file, dataUrl);
      } catch (e) {
        console.warn("HQ frame capture failed:", e);
      } finally {
        capturingRef.current = false;
        setCapturing(false);
      }
    },
    [duration, videoAspect, captureVideoRef, onFrameSelect, FRAME_COUNT],
  );

  const selectIndex = useCallback(
    (index: number) => {
      const safeIndex = Math.max(0, Math.min(index, FRAME_COUNT - 1));
      selectedIndexRef.current = safeIndex;
      setSelectedIndex(safeIndex);
      const frame = frames[safeIndex];
      if (frame) setCurrentPreview(frame);
    },
    [FRAME_COUNT, frames],
  );

  const handleStripInteraction = useCallback(
    (clientX: number) => {
      const strip = stripRef.current;
      const validFrames = frames.filter(Boolean);
      if (!strip || validFrames.length === 0) return;
      const rect = strip.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const ratio = x / rect.width;
      const index = Math.min(Math.floor(ratio * FRAME_COUNT), FRAME_COUNT - 1);
      if (index !== selectedIndexRef.current) selectIndex(index);
    },
    [frames, selectIndex, FRAME_COUNT],
  );

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
    if (selectionMode === "immediate") {
      void captureAndSelect(selectedIndexRef.current);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      selectIndex(selectedIndexRef.current + direction);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void captureAndSelect(selectedIndexRef.current);
    }
  };

  const hasAnyFrame = frames.some(Boolean);

  if (loading && !hasAnyFrame) {
    return (
      <div className={cn("flex-1 flex items-center justify-center", className)}>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Gerando preview de capa...</span>
        </div>
      </div>
    );
  }

  if (error && !hasAnyFrame) {
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
              videoAspect < 1 ? "h-full w-auto" : "w-full h-auto",
            )}
          />
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-white text-xs font-medium flex items-center gap-1.5">
            <ImageIcon className="w-3 h-3" />
            Capa do vídeo
          </div>
        </div>
      )}

      <div className="p-3 space-y-2 shrink-0">
        <p className="text-xs text-white/60">
          Arraste para escolher o frame da capa
        </p>
        <div
          ref={stripRef}
          role="slider"
          tabIndex={0}
          aria-label="Escolher frame da capa"
          aria-valuemin={1}
          aria-valuemax={FRAME_COUNT}
          aria-valuenow={Math.max(1, selectedIndex + 1)}
          aria-valuetext={`Frame ${Math.max(1, selectedIndex + 1)} de ${FRAME_COUNT}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            isDragging.current = false;
          }}
          onKeyDown={handleKeyDown}
          className="relative flex h-14 rounded-lg overflow-hidden cursor-grab active:cursor-grabbing touch-none select-none"
        >
          {frames.map((frame, i) => (
            <div
              key={i}
              className={cn(
                "flex-1 relative border-r border-black/20 last:border-r-0 bg-white/5",
                selectedIndex === i && "ring-2 ring-accent ring-inset z-10",
              )}
            >
              {frame && (
                <img
                  src={frame}
                  alt=""
                  className="w-full h-full object-cover pointer-events-none animate-in fade-in duration-300"
                  draggable={false}
                />
              )}
            </div>
          ))}
          {selectedIndex >= 0 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-accent shadow-[0_0_6px_rgba(var(--accent),0.5)] z-20 pointer-events-none transition-all duration-100"
              style={{
                left: `${((selectedIndex + 0.5) / FRAME_COUNT) * 100}%`,
              }}
            />
          )}
        </div>
        {selectionMode === "confirm" && (
          <button
            type="button"
            className="studio-frame-selector__confirm"
            disabled={selectedIndex < 0 || capturing}
            onClick={() => void captureAndSelect(selectedIndexRef.current)}
          >
            {capturing ? <Loader2 className="animate-spin" /> : <Check />}
            {capturing ? "Preparando capa..." : confirmLabel}
          </button>
        )}
      </div>
    </motion.div>
  );
}

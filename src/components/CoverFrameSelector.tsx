import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Loader2, ImageIcon, AlertCircle, Check } from "lucide-react";
import { motion } from "framer-motion";
import {
  seekAndCaptureCover,
  generateFramesProgressive,
  dataURLtoFile,
} from "@/components/video-lobby/seekAndCapture";
import { coverTargetSize } from "@/lib/media/coverCrop";

interface CoverFrameSelectorProps {
  /** Hidden capture video ref — never the visible player */
  captureVideoRef: React.RefObject<HTMLVideoElement>;
  captureReady: boolean;
  duration: number;
  videoAspect: number;
  targetAspect?: number;
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
  targetAspect = 16 / 9,
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
  const [cropPosition, setCropPosition] = useState(50);
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
      const previewWidth = window.innerWidth * window.devicePixelRatio * 0.75;
      const thumbWidth = Math.round(
        Math.min(1920, Math.max(1280, previewWidth)),
      );

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
        0.92,
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
        const target = coverTargetSize(targetAspect);
        const cropsVertically = videoAspect < targetAspect;
        const dataUrl = await seekAndCaptureCover(
          video,
          time,
          target.width,
          target.height,
          {
            x: cropsVertically ? 50 : cropPosition,
            y: cropsVertically ? cropPosition : 50,
          },
          0.92,
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
    [
      duration,
      videoAspect,
      targetAspect,
      cropPosition,
      captureVideoRef,
      onFrameSelect,
      FRAME_COUNT,
    ],
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
  const cropAxis =
    Math.abs(videoAspect - targetAspect) < 0.01
      ? null
      : videoAspect < targetAspect
        ? "vertical"
        : "horizontal";
  const objectPosition =
    cropAxis === "vertical"
      ? `50% ${cropPosition}%`
      : cropAxis === "horizontal"
        ? `${cropPosition}% 50%`
        : "50% 50%";
  const selectedTime =
    selectedIndex < 0
      ? 0
      : Math.min((duration / FRAME_COUNT) * selectedIndex + 0.1, duration);
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  };

  if (loading && !hasAnyFrame) {
    return (
      <div className={cn("flex-1 flex items-center justify-center", className)}>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Gerando prévia da capa...</span>
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
      className={cn("studio-frame-selector", className)}
    >
      <div className="studio-frame-selector__toolbar">
        <div>
          <strong>Frame em {formatTime(selectedTime)}</strong>
          <span>A prévia representa exatamente a capa final.</span>
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

      {currentPreview && (
        <div
          className="studio-frame-selector__preview"
          style={{ aspectRatio: targetAspect }}
        >
          <img
            src={currentPreview}
            alt="Capa selecionada"
            style={{ objectPosition }}
          />
          <div className="studio-frame-selector__label">
            <ImageIcon />
            Capa do vídeo
          </div>
        </div>
      )}

      <div className="studio-frame-selector__controls">
        <div className="studio-frame-selector__instruction">
          <span>Arraste para procurar o melhor momento</span>
          <strong>{formatTime(selectedTime)}</strong>
        </div>
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
          className="studio-frame-selector__strip"
        >
          {frames.map((frame, i) => (
            <div
              key={i}
              className={cn(
                "studio-frame-selector__frame",
                selectedIndex === i && "is-selected",
              )}
            >
              {frame && (
                <img
                  src={frame}
                  alt=""
                  className="animate-in fade-in duration-300"
                  draggable={false}
                />
              )}
            </div>
          ))}
          {selectedIndex >= 0 && (
            <div
              className="studio-frame-selector__playhead"
              style={{
                left: `${((selectedIndex + 0.5) / FRAME_COUNT) * 100}%`,
              }}
            />
          )}
        </div>
        {cropAxis && (
          <label className="studio-frame-selector__reposition">
            <span>
              Enquadramento{" "}
              {cropAxis === "vertical" ? "vertical" : "horizontal"}
            </span>
            <input
              type="range"
              min="0"
              max="100"
              value={cropPosition}
              onChange={(event) => setCropPosition(Number(event.target.value))}
              aria-label={`Ajustar enquadramento ${cropAxis}`}
            />
          </label>
        )}
      </div>
    </motion.div>
  );
}

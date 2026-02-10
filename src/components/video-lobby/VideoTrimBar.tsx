import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { generateFramesProgressive } from "./seekAndCapture";

interface VideoTrimBarProps {
  /** Hidden capture video ref — never the visible player */
  captureVideoRef: React.RefObject<HTMLVideoElement>;
  captureReady: boolean;
  duration: number;
  trimStart: number;
  trimEnd: number;
  /** Called continuously during drag — only updates state, no seeks */
  onTrimChange: (start: number, end: number) => void;
  /** Called on pointerUp — triggers a single seek on the visible video */
  onTrimCommit: (start: number, end: number) => void;
  maxDuration?: number;
  className?: string;
}

const THUMB_COUNT = 20;

export function VideoTrimBar({
  captureVideoRef,
  captureReady,
  duration,
  trimStart,
  trimEnd,
  onTrimChange,
  onTrimCommit,
  maxDuration,
  className,
}: VideoTrimBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  // Progressive frames: array grows frame-by-frame
  const [frames, setFrames] = useState<(string | null)[]>(() => Array(THUMB_COUNT).fill(null));
  const [dragging, setDragging] = useState<"start" | "end" | "window" | null>(null);
  const dragStartX = useRef(0);
  const dragStartTrim = useRef({ start: 0, end: 0 });
  const generatingRef = useRef(false);

  // Generate thumbnail frames progressively on the HIDDEN capture video
  useEffect(() => {
    if (!captureReady || !captureVideoRef.current || duration <= 0 || generatingRef.current) return;
    generatingRef.current = true;

    const abort = { aborted: false };
    const video = captureVideoRef.current;

    const startGeneration = () => {
      if (abort.aborted) return;
      const thumbWidth = 80;

      generateFramesProgressive(
        video,
        THUMB_COUNT,
        thumbWidth,
        (index, dataUrl) => {
          if (abort.aborted) return;
          setFrames(prev => {
            const next = [...prev];
            next[index] = dataUrl;
            return next;
          });
        },
        abort
      ).then(() => {
        generatingRef.current = false;
      });
    };

    // Wait for capture video to be ready
    if (video.readyState >= 2) {
      startGeneration();
    } else {
      const onCanPlay = () => {
        video.removeEventListener("canplay", onCanPlay);
        if (!abort.aborted) startGeneration();
      };
      video.addEventListener("canplay", onCanPlay);
      video.play().then(() => video.pause()).catch(() => {});
    }

    return () => {
      abort.aborted = true;
      generatingRef.current = false;
    };
  }, [captureReady, captureVideoRef, duration]);

  const handlePointerDown = useCallback((e: React.PointerEvent, handle: "start" | "end") => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(handle);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleWindowPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging("window");
    dragStartX.current = e.clientX;
    dragStartTrim.current = { start: trimStart, end: trimEnd };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [trimStart, trimEnd]);

  // Drag: ONLY update CSS positions — zero seeks, pure math
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const bar = barRef.current;
    if (!bar || duration <= 0) return;

    if (dragging === "window") {
      const rect = bar.getBoundingClientRect();
      const deltaX = e.clientX - dragStartX.current;
      const deltaTime = (deltaX / rect.width) * duration;
      const windowSize = dragStartTrim.current.end - dragStartTrim.current.start;
      let newStart = dragStartTrim.current.start + deltaTime;
      newStart = Math.max(0, Math.min(newStart, duration - windowSize));
      onTrimChange(newStart, newStart + windowSize);
      return;
    }

    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pos = (x / rect.width) * duration;

    if (dragging === "start") {
      let newStart = Math.max(0, Math.min(pos, trimEnd - 1));
      if (maxDuration && trimEnd - newStart > maxDuration) {
        newStart = trimEnd - maxDuration;
      }
      onTrimChange(newStart, trimEnd);
    } else {
      let newEnd = Math.min(duration, Math.max(pos, trimStart + 1));
      if (maxDuration && newEnd - trimStart > maxDuration) {
        newEnd = trimStart + maxDuration;
      }
      onTrimChange(trimStart, newEnd);
    }
  }, [dragging, trimStart, trimEnd, maxDuration, duration, onTrimChange]);

  // On release: single seek via onTrimCommit
  const handlePointerUp = useCallback(() => {
    if (dragging) {
      onTrimCommit(trimStart, trimEnd);
    }
    setDragging(null);
  }, [dragging, trimStart, trimEnd, onTrimCommit]);

  const startPct = duration > 0 ? (trimStart / duration) * 100 : 0;
  const endPct = duration > 0 ? (trimEnd / duration) * 100 : 100;
  const selectedDuration = Math.max(0, trimEnd - trimStart);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-white/60">
          {formatTime(trimStart)} - {formatTime(trimEnd)}
        </span>
        <span className="text-xs text-white/60 font-medium">
          {formatTime(selectedDuration)}
          <span className="text-white/40 ml-1">/ {formatTime(duration)}</span>
        </span>
      </div>

      <div
        ref={barRef}
        className="relative h-12 rounded-lg overflow-visible touch-none select-none"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Frame strip — progressive fade-in */}
        <div className="absolute inset-0 flex rounded-lg overflow-hidden">
          {frames.map((f, i) => (
            <div key={i} className="flex-1 h-full bg-white/5">
              {f && (
                <img
                  src={f}
                  alt=""
                  className="w-full h-full object-cover pointer-events-none animate-in fade-in duration-300"
                  draggable={false}
                />
              )}
            </div>
          ))}
        </div>

        {/* Darkened regions outside trim */}
        <div
          className="absolute inset-y-0 left-0 bg-black/70 z-10 pointer-events-none rounded-l-lg"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-black/70 z-10 pointer-events-none rounded-r-lg"
          style={{ width: `${100 - endPct}%` }}
        />

        {/* Draggable selection window */}
        <div
          className="absolute inset-y-0 z-20 border-y-2 border-accent cursor-grab active:cursor-grabbing"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
          onPointerDown={handleWindowPointerDown}
        />

        {/* Start handle */}
        <div
          className="absolute inset-y-0 z-40 w-6 flex items-center justify-center cursor-ew-resize"
          style={{ left: `calc(${startPct}% - 12px)` }}
          onPointerDown={(e) => handlePointerDown(e, "start")}
        >
          <div className={cn(
            "w-4 h-8 rounded-sm flex items-center justify-center transition-colors",
            dragging === "start" ? "bg-accent" : "bg-accent/80"
          )}>
            <div className="w-0.5 h-4 bg-accent-foreground/80 rounded-full" />
          </div>
        </div>

        {/* End handle */}
        <div
          className="absolute inset-y-0 z-40 w-6 flex items-center justify-center cursor-ew-resize"
          style={{ left: `calc(${endPct}% - 12px)` }}
          onPointerDown={(e) => handlePointerDown(e, "end")}
        >
          <div className={cn(
            "w-4 h-8 rounded-sm flex items-center justify-center transition-colors",
            dragging === "end" ? "bg-accent" : "bg-accent/80"
          )}>
            <div className="w-0.5 h-4 bg-accent-foreground/80 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

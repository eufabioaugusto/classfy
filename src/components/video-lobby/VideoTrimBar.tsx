import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { generateFramesFromRef } from "./seekAndCapture";

interface VideoTrimBarProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  videoReady: boolean;
  duration: number;
  trimStart: number;
  trimEnd: number;
  onTrimChange: (start: number, end: number) => void;
  onGeneratingFrames?: (generating: boolean) => void;
  maxDuration?: number;
  className?: string;
}

const THUMB_COUNT = 20;

export function VideoTrimBar({
  videoRef,
  videoReady,
  duration,
  trimStart,
  trimEnd,
  onTrimChange,
  onGeneratingFrames,
  maxDuration,
  className,
}: VideoTrimBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [dragging, setDragging] = useState<"start" | "end" | "window" | null>(null);
  const dragStartX = useRef(0);
  const dragStartTrim = useRef({ start: 0, end: 0 });
  const generatingRef = useRef(false);

  // Generate thumbnail frames with 500ms delay — non-blocking
  useEffect(() => {
    if (!videoReady || !videoRef.current || duration <= 0 || generatingRef.current) return;
    generatingRef.current = true;

    const abort = { aborted: false };
    const timerId = setTimeout(() => {
      if (abort.aborted) return;
      const video = videoRef.current;
      if (!video) { generatingRef.current = false; return; }

      const wasPaused = video.paused;
      const savedTime = video.currentTime;
      video.pause();

      onGeneratingFrames?.(true);

      const thumbWidth = 80;
      generateFramesFromRef(video, THUMB_COUNT, thumbWidth, abort).then((generated) => {
        onGeneratingFrames?.(false);
        if (!abort.aborted && generated.length > 0) {
          setFrames(generated);
        }
        // Restore video state
        if (videoRef.current) {
          videoRef.current.currentTime = savedTime;
          if (!wasPaused) videoRef.current.play().catch(() => {});
        }
        generatingRef.current = false;
      });
    }, 500);

    return () => { abort.aborted = true; clearTimeout(timerId); generatingRef.current = false; };
  }, [videoReady, videoRef, duration, onGeneratingFrames]);

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

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

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
          {maxDuration && (
            <span className="text-white/40 ml-1">/ {formatTime(maxDuration)}</span>
          )}
        </span>
      </div>

      <div
        ref={barRef}
        className="relative h-12 rounded-lg overflow-visible touch-none select-none"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="absolute inset-0 flex rounded-lg overflow-hidden">
          {frames.length > 0
            ? frames.map((f, i) => (
                <img key={i} src={f} alt="" className="flex-1 h-full object-cover pointer-events-none" draggable={false} />
              ))
            : Array.from({ length: THUMB_COUNT }).map((_, i) => (
                <div key={i} className="flex-1 h-full bg-white/5" />
              ))}
        </div>

        <div
          className="absolute inset-y-0 left-0 bg-black/70 z-10 pointer-events-none rounded-l-lg"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-black/70 z-10 pointer-events-none rounded-r-lg"
          style={{ width: `${100 - endPct}%` }}
        />

        <div
          className="absolute inset-y-0 z-20 border-y-2 border-accent cursor-grab active:cursor-grabbing"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
          onPointerDown={handleWindowPointerDown}
        />

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

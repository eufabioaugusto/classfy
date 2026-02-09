import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface VideoTrimBarProps {
  videoSrc: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  onTrimChange: (start: number, end: number) => void;
  maxDuration?: number; // e.g. 90 for shorts
  className?: string;
}

const THUMB_COUNT = 20;

export function VideoTrimBar({
  videoSrc,
  duration,
  trimStart,
  trimEnd,
  onTrimChange,
  maxDuration,
  className,
}: VideoTrimBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);

  // Generate thumbnail frames
  useEffect(() => {
    if (!videoSrc || duration <= 0) return;
    let cancelled = false;

    const generate = async () => {
      const thumbWidth = 80;
      const generated: string[] = [];

      for (let i = 0; i < THUMB_COUNT; i++) {
        if (cancelled) return;
        const time = (duration / THUMB_COUNT) * i + 0.1;
        try {
          const frame = await extractFrame(videoSrc, time, thumbWidth);
          generated.push(frame);
        } catch {
          // gray placeholder
          const c = document.createElement("canvas");
          c.width = thumbWidth;
          c.height = Math.round(thumbWidth * 9 / 16);
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = "#222";
          ctx.fillRect(0, 0, c.width, c.height);
          generated.push(c.toDataURL("image/jpeg", 0.5));
        }
      }
      if (!cancelled) setFrames(generated);
    };

    generate();
    return () => { cancelled = true; };
  }, [videoSrc, duration]);

  const extractFrame = (url: string, time: number, w: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "true");
      v.setAttribute("webkit-playsinline", "true");
      if (!url.startsWith("blob:")) v.crossOrigin = "anonymous";
      v.src = url;

      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; v.remove(); reject(); } }, 5000);

      v.addEventListener("loadeddata", () => {
        v.currentTime = Math.min(time, v.duration - 0.1);
      });

      v.addEventListener("seeked", () => {
        if (done) return;
        requestAnimationFrame(() => {
          setTimeout(() => {
            try {
              const c = document.createElement("canvas");
              c.width = w;
              c.height = Math.round(w * (v.videoHeight / v.videoWidth));
              c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
              done = true;
              clearTimeout(t);
              v.remove();
              resolve(c.toDataURL("image/jpeg", 0.4));
            } catch { done = true; clearTimeout(t); v.remove(); reject(); }
          }, 100);
        });
      });

      v.addEventListener("error", () => { if (!done) { done = true; clearTimeout(t); v.remove(); reject(); } });
      v.load();
    });
  };

  const getPositionFromEvent = useCallback((clientX: number) => {
    const bar = barRef.current;
    if (!bar || duration <= 0) return null;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (x / rect.width) * duration;
  }, [duration]);

  const handlePointerDown = useCallback((e: React.PointerEvent, handle: "start" | "end") => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(handle);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const pos = getPositionFromEvent(e.clientX);
    if (pos === null) return;

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
  }, [dragging, getPositionFromEvent, trimStart, trimEnd, maxDuration, duration, onTrimChange]);

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
      {/* Duration label */}
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

      {/* Trim bar */}
      <div
        ref={barRef}
        className="relative h-12 rounded-lg overflow-hidden touch-none select-none"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Frame thumbnails */}
        <div className="absolute inset-0 flex">
          {frames.length > 0
            ? frames.map((f, i) => (
                <img
                  key={i}
                  src={f}
                  alt=""
                  className="flex-1 h-full object-cover pointer-events-none"
                  draggable={false}
                />
              ))
            : Array.from({ length: THUMB_COUNT }).map((_, i) => (
                <div key={i} className="flex-1 h-full bg-white/5" />
              ))}
        </div>

        {/* Dimmed areas outside trim */}
        <div
          className="absolute inset-y-0 left-0 bg-black/70 z-10 pointer-events-none"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-black/70 z-10 pointer-events-none"
          style={{ width: `${100 - endPct}%` }}
        />

        {/* Selected area border */}
        <div
          className="absolute inset-y-0 z-20 border-y-2 border-accent pointer-events-none"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />

        {/* Start handle */}
        <div
          className="absolute inset-y-0 z-30 w-5 flex items-center justify-center cursor-ew-resize"
          style={{ left: `calc(${startPct}% - 10px)` }}
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
          className="absolute inset-y-0 z-30 w-5 flex items-center justify-center cursor-ew-resize"
          style={{ left: `calc(${endPct}% - 10px)` }}
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

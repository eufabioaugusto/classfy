import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Loader2, ImageIcon, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

interface CoverFrameSelectorProps {
  videoSrc: string;
  onFrameSelect: (file: File, previewUrl: string) => void;
  className?: string;
}

const FRAME_COUNT = 12;
const FRAME_TIMEOUT = 8000; // 8s max per frame extraction attempt

export function CoverFrameSelector({ videoSrc, onFrameSelect, className }: CoverFrameSelectorProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [currentPreview, setCurrentPreview] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const isDragging = useRef(false);
  const abortRef = useRef(false);

  const dataURLtoFile = useCallback((dataUrl: string, filename: string): File => {
    const arr = dataUrl.split(",");
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
  }, []);

  // iOS Safari-compatible frame extraction
  const extractFrameAtTime = useCallback((videoUrl: string, time: number, thumbWidth: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      // Don't set crossOrigin for blob URLs or same-origin URLs
      if (!videoUrl.startsWith("blob:") && !videoUrl.includes(window.location.hostname)) {
        video.crossOrigin = "anonymous";
      }
      video.src = videoUrl;

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error("Frame extraction timeout"));
        }
      }, FRAME_TIMEOUT);

      const cleanup = () => {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.remove();
        clearTimeout(timeout);
      };

      const captureCanvas = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = thumbWidth;
          canvas.height = Math.round(thumbWidth * (video.videoHeight / video.videoWidth));
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // Check if the canvas is actually drawn (not blank)
          const pixel = ctx.getImageData(0, 0, 1, 1).data;
          const isBlank = pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 0;
          
          if (isBlank) {
            reject(new Error("Blank frame"));
            return;
          }
          
          const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
          resolved = true;
          cleanup();
          resolve(dataUrl);
        } catch (e) {
          resolved = true;
          cleanup();
          reject(e);
        }
      };

      video.addEventListener("loadeddata", () => {
        video.currentTime = Math.min(time, video.duration - 0.1);
      });

      video.addEventListener("seeked", () => {
        if (resolved) return;
        // Small delay for iOS to render the frame
        requestAnimationFrame(() => {
          setTimeout(captureCanvas, 100);
        });
      });

      video.addEventListener("error", () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error("Video load error"));
        }
      });

      // iOS Safari: try to trigger load
      video.load();
    });
  }, []);

  // Generate frames sequentially (more reliable on iOS)
  useEffect(() => {
    if (!videoSrc) return;
    abortRef.current = false;

    const generateFrames = async () => {
      // First, get video duration
      const dur = await new Promise<number>((resolve, reject) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.muted = true;
        v.playsInline = true;
        v.setAttribute("playsinline", "true");
        if (!videoSrc.startsWith("blob:") && !videoSrc.includes(window.location.hostname)) {
          v.crossOrigin = "anonymous";
        }
        v.src = videoSrc;
        
        const t = setTimeout(() => { v.remove(); reject(new Error("metadata timeout")); }, 10000);
        v.addEventListener("loadedmetadata", () => {
          clearTimeout(t);
          const d = v.duration;
          v.remove();
          resolve(d);
        });
        v.addEventListener("error", () => {
          clearTimeout(t);
          v.remove();
          reject(new Error("metadata error"));
        });
        v.load();
      });

      setVideoDuration(dur);

      const generatedFrames: string[] = [];
      const thumbWidth = Math.min(320, window.innerWidth / 2);

      for (let i = 0; i < FRAME_COUNT; i++) {
        if (abortRef.current) return;
        const time = (dur / FRAME_COUNT) * i + 0.1;
        try {
          const frame = await extractFrameAtTime(videoSrc, time, thumbWidth);
          generatedFrames.push(frame);
        } catch (e) {
          console.warn(`Frame ${i} extraction failed:`, e);
          // Use a gray placeholder for failed frames
          const canvas = document.createElement("canvas");
          canvas.width = thumbWidth;
          canvas.height = Math.round(thumbWidth * 9 / 16);
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#333";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          generatedFrames.push(canvas.toDataURL("image/jpeg", 0.5));
        }
      }

      if (abortRef.current) return;

      if (generatedFrames.length === 0) {
        setError(true);
        setLoading(false);
        return;
      }

      setFrames(generatedFrames);
      setLoading(false);

      // Auto-select frame at 25%
      const autoIndex = Math.floor(FRAME_COUNT * 0.25);
      selectHighQualityFrame(autoIndex, dur, videoSrc);
    };

    generateFrames().catch((e) => {
      console.error("Frame generation failed:", e);
      setError(true);
      setLoading(false);
    });

    return () => {
      abortRef.current = true;
    };
  }, [videoSrc, extractFrameAtTime]);

  const selectHighQualityFrame = useCallback(async (index: number, duration: number, src: string) => {
    setSelectedIndex(index);
    const time = (duration / FRAME_COUNT) * index + 0.1;

    try {
      const dataUrl = await extractFrameAtTime(src, time, 1920);
      setCurrentPreview(dataUrl);
      const file = dataURLtoFile(dataUrl, `cover_${Date.now()}.jpg`);
      onFrameSelect(file, dataUrl);
    } catch (e) {
      console.warn("High-quality frame capture failed, using thumbnail:", e);
    }
  }, [extractFrameAtTime, dataURLtoFile, onFrameSelect]);

  const handleStripInteraction = useCallback((clientX: number) => {
    const strip = stripRef.current;
    if (!strip || frames.length === 0) return;
    const rect = strip.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = x / rect.width;
    const index = Math.min(Math.floor(ratio * frames.length), frames.length - 1);
    if (index !== selectedIndex) {
      setSelectedIndex(index);
      // Show thumbnail immediately, then fetch HQ
      setCurrentPreview(frames[index]);
      selectHighQualityFrame(index, videoDuration, videoSrc);
    }
  }, [frames, selectedIndex, videoDuration, videoSrc, selectHighQualityFrame]);

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
      <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Gerando preview de capa...</span>
        </div>
      </div>
    );
  }

  if (error || frames.length === 0) {
    return (
      <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
        <div className="flex items-center gap-3 text-muted-foreground">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">Não foi possível gerar preview. Faça upload de uma thumbnail manualmente.</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}
    >
      {/* Current selected frame preview */}
      {currentPreview && (
        <div className="relative aspect-video bg-black">
          <img
            src={currentPreview}
            alt="Capa selecionada"
            className="w-full h-full object-cover"
          />
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-white text-xs font-medium flex items-center gap-1.5">
            <ImageIcon className="w-3 h-3" />
            Capa do vídeo
          </div>
        </div>
      )}

      {/* Frame strip scrubber */}
      <div className="p-3 space-y-2">
        <p className="text-xs text-muted-foreground">Arraste para escolher o frame da capa</p>
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
              <img
                src={frame}
                alt=""
                className="w-full h-full object-cover pointer-events-none"
                draggable={false}
              />
            </div>
          ))}
          {/* Indicator line */}
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

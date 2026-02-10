import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Loader2, ImageIcon, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

interface CoverFrameSelectorProps {
  videoSrc: string;
  onFrameSelect: (file: File, previewUrl: string) => void;
  className?: string;
}

const FRAME_COUNT_DESKTOP = 12;
const FRAME_COUNT_MOBILE = 8;

function getFrameCount() {
  return window.innerWidth < 768 ? FRAME_COUNT_MOBILE : FRAME_COUNT_DESKTOP;
}

export function CoverFrameSelector({ videoSrc, onFrameSelect, className }: CoverFrameSelectorProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [currentPreview, setCurrentPreview] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const isDragging = useRef(false);
  const abortRef = useRef(false);
  const frameCountRef = useRef(getFrameCount());

  const dataURLtoFile = useCallback((dataUrl: string, filename: string): File => {
    const arr = dataUrl.split(",");
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
  }, []);

  // Single video element pattern: 1 load + N seeks
  useEffect(() => {
    if (!videoSrc) return;
    abortRef.current = false;
    const FRAME_COUNT = frameCountRef.current;

    const generateFrames = async () => {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      if (!videoSrc.startsWith("blob:") && !videoSrc.includes(window.location.hostname)) {
        video.crossOrigin = "anonymous";
      }
      video.src = videoSrc;

      // Wait for loadeddata (video has first frame ready)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { reject(new Error("load timeout")); }, 15000);
        video.addEventListener("loadeddata", () => { clearTimeout(t); resolve(); }, { once: true });
        video.addEventListener("error", () => { clearTimeout(t); reject(new Error("load error")); }, { once: true });
        video.load();
      });

      const dur = video.duration;
      const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
      setVideoDuration(dur);
      setVideoAspect(aspect);

      const thumbWidth = Math.min(320, window.innerWidth / 2);
      const thumbHeight = Math.round(thumbWidth / aspect);
      const generatedFrames: string[] = [];

      // Sequential seek on single element
      for (let i = 0; i < FRAME_COUNT; i++) {
        if (abortRef.current) { video.remove(); return; }
        const time = Math.min((dur / FRAME_COUNT) * i + 0.1, dur - 0.1);

        // Seek and wait
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            // iOS needs a small delay after seeked
            setTimeout(resolve, 100);
          };
          video.addEventListener("seeked", onSeeked);
          video.currentTime = time;
        });

        // Capture
        try {
          const canvas = document.createElement("canvas");
          canvas.width = thumbWidth;
          canvas.height = thumbHeight;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          generatedFrames.push(canvas.toDataURL("image/jpeg", 0.6));
        } catch {
          // Gray placeholder on failure
          const canvas = document.createElement("canvas");
          canvas.width = thumbWidth;
          canvas.height = thumbHeight;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#333";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          generatedFrames.push(canvas.toDataURL("image/jpeg", 0.5));
        }
      }

      video.remove();

      if (abortRef.current) return;
      if (generatedFrames.length === 0) {
        setError(true);
        setLoading(false);
        return;
      }

      setFrames(generatedFrames);
      setLoading(false);

      // Auto-select frame at 25% VISUALLY only — do NOT call onFrameSelect
      const autoIndex = Math.floor(FRAME_COUNT * 0.25);
      setSelectedIndex(autoIndex);
      setCurrentPreview(generatedFrames[autoIndex]);
    };

    generateFrames().catch((e) => {
      console.error("Frame generation failed:", e);
      setError(true);
      setLoading(false);
    });

    return () => { abortRef.current = true; };
  }, [videoSrc]);

  // Capture HQ frame and call onFrameSelect (user interaction only)
  const captureAndSelect = useCallback(async (index: number) => {
    const FRAME_COUNT = frameCountRef.current;
    const time = Math.min((videoDuration / FRAME_COUNT) * index + 0.1, videoDuration - 0.1);

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    if (!videoSrc.startsWith("blob:") && !videoSrc.includes(window.location.hostname)) {
      video.crossOrigin = "anonymous";
    }
    video.src = videoSrc;

    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 8000);
        video.addEventListener("loadeddata", () => { clearTimeout(t); resolve(); }, { once: true });
        video.addEventListener("error", () => { clearTimeout(t); reject(); }, { once: true });
        video.load();
      });

      await new Promise<void>((resolve) => {
        video.addEventListener("seeked", () => setTimeout(resolve, 100), { once: true });
        video.currentTime = time;
      });

      const canvas = document.createElement("canvas");
      canvas.width = 1920;
      canvas.height = Math.round(1920 / (video.videoWidth / video.videoHeight));
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      video.remove();

      setCurrentPreview(dataUrl);
      const file = dataURLtoFile(dataUrl, `cover_${Date.now()}.jpg`);
      onFrameSelect(file, dataUrl);
    } catch (e) {
      video.remove();
      console.warn("HQ frame capture failed:", e);
    }
  }, [videoDuration, videoSrc, dataURLtoFile, onFrameSelect]);

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
      {/* Current selected frame preview */}
      {currentPreview && (
        <div className={cn(
          "flex-1 relative bg-black flex items-center justify-center min-h-0",
        )}>
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

      {/* Frame strip scrubber */}
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
              <img
                src={frame}
                alt=""
                className="w-full h-full object-cover pointer-events-none"
                draggable={false}
              />
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

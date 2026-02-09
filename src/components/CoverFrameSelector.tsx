import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Loader2, ImageIcon } from "lucide-react";
import { motion } from "framer-motion";

interface CoverFrameSelectorProps {
  videoSrc: string;
  onFrameSelect: (file: File, previewUrl: string) => void;
  className?: string;
}

const FRAME_COUNT = 12;

export function CoverFrameSelector({ videoSrc, onFrameSelect, className }: CoverFrameSelectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [currentPreview, setCurrentPreview] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [videoDuration, setVideoDuration] = useState(0);
  const isDragging = useRef(false);

  const captureFrame = useCallback((video: HTMLVideoElement, canvas: HTMLCanvasElement): string => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  }, []);

  const dataURLtoFile = useCallback((dataUrl: string, filename: string): File => {
    const arr = dataUrl.split(",");
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
  }, []);

  // Generate frames on load
  useEffect(() => {
    if (!videoSrc) return;

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = videoSrc;

    const canvas = document.createElement("canvas");
    const generatedFrames: string[] = [];
    let currentFrame = 0;

    video.addEventListener("loadedmetadata", () => {
      setVideoDuration(video.duration);
      canvas.width = Math.min(video.videoWidth, 320);
      canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth));

      const seekToNextFrame = () => {
        if (currentFrame >= FRAME_COUNT) {
          setFrames(generatedFrames);
          setLoading(false);

          // Auto-select frame at 25%
          const autoIndex = Math.floor(FRAME_COUNT * 0.25);
          selectFrameAtIndex(autoIndex, video.duration, generatedFrames);
          video.remove();
          return;
        }
        const time = (video.duration / FRAME_COUNT) * currentFrame + 0.1;
        video.currentTime = Math.min(time, video.duration - 0.1);
      };

      video.addEventListener("seeked", () => {
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        generatedFrames.push(canvas.toDataURL("image/jpeg", 0.6));
        currentFrame++;
        seekToNextFrame();
      });

      seekToNextFrame();
    });

    video.addEventListener("error", () => {
      console.error("Error loading video for frame extraction");
      setLoading(false);
    });

    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [videoSrc]);

  const selectFrameAtIndex = useCallback((index: number, duration: number, framesArr?: string[]) => {
    const sourceFrames = framesArr || frames;
    if (index < 0 || index >= sourceFrames.length) return;

    setSelectedIndex(index);
    
    // Generate high-quality frame
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.src = videoSrc;

    const time = (duration / FRAME_COUNT) * index + 0.1;

    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(time, video.duration - 0.1);
    });

    video.addEventListener("seeked", () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      setCurrentPreview(dataUrl);
      const file = dataURLtoFile(dataUrl, `cover_${Date.now()}.jpg`);
      onFrameSelect(file, dataUrl);
      video.remove();
    }, { once: true });
  }, [frames, videoSrc, onFrameSelect, dataURLtoFile]);

  const handleStripInteraction = useCallback((clientX: number) => {
    const strip = stripRef.current;
    if (!strip || frames.length === 0) return;
    const rect = strip.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = x / rect.width;
    const index = Math.min(Math.floor(ratio * frames.length), frames.length - 1);
    if (index !== selectedIndex) {
      selectFrameAtIndex(index, videoDuration);
    }
  }, [frames, selectedIndex, videoDuration, selectFrameAtIndex]);

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

  if (frames.length === 0) return null;

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

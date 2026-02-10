import { useRef, useState, useEffect } from "react";
import { CoverFrameSelector } from "@/components/CoverFrameSelector";

/**
 * Standalone wrapper for CoverFrameSelector that creates its own video element.
 * Used outside the VideoPreparationLobby (e.g. StudioUpload drawer/inline).
 */
interface StandaloneCoverSelectorProps {
  videoSrc: string;
  onFrameSelect: (file: File, previewUrl: string) => void;
  className?: string;
}

export function StandaloneCoverSelector({ videoSrc, onFrameSelect, className }: StandaloneCoverSelectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [videoAspect, setVideoAspect] = useState(16 / 9);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoSrc) return;
    setVideoReady(false);

    const onLoaded = () => {
      setDuration(v.duration);
      setVideoAspect(v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9);
      setVideoReady(true);
    };

    v.addEventListener("loadeddata", onLoaded);
    v.src = videoSrc;
    v.load();

    return () => v.removeEventListener("loadeddata", onLoaded);
  }, [videoSrc]);

  return (
    <>
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        className="hidden"
      />
      <CoverFrameSelector
        videoRef={videoRef}
        videoReady={videoReady}
        duration={duration}
        videoAspect={videoAspect}
        onFrameSelect={onFrameSelect}
        className={className}
      />
    </>
  );
}

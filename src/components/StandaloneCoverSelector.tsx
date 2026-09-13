import { useRef, useState, useEffect } from "react";
import Hls from "hls.js";
import { CoverFrameSelector } from "@/components/CoverFrameSelector";
import { releaseMediaElement, standardHlsConfig } from "@/lib/video/hlsConfig";

/**
 * Standalone wrapper for CoverFrameSelector that creates its own video element.
 * Used outside the VideoPreparationLobby (e.g. StudioUpload drawer/inline).
 */
interface StandaloneCoverSelectorProps {
  videoSrc: string;
  onFrameSelect: (file: File, previewUrl: string) => void;
  targetAspect?: number;
  selectionMode?: "immediate" | "confirm";
  confirmLabel?: string;
  className?: string;
}

export function StandaloneCoverSelector({
  videoSrc,
  onFrameSelect,
  targetAspect,
  selectionMode,
  confirmLabel,
  className,
}: StandaloneCoverSelectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [captureReady, setCaptureReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [videoAspect, setVideoAspect] = useState(16 / 9);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoSrc) return;
    setCaptureReady(false);
    let hls: Hls | null = null;

    const onLoaded = () => {
      setDuration(v.duration);
      setVideoAspect(
        v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9,
      );
      setCaptureReady(true);
    };

    v.addEventListener("loadeddata", onLoaded);
    const isHls = videoSrc.includes(".m3u8");
    if (isHls && Hls.isSupported()) {
      hls = new Hls(standardHlsConfig);
      hls.loadSource(videoSrc);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls?.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR)
          hls?.recoverMediaError();
        else hls?.destroy();
      });
    } else {
      v.src = videoSrc;
      v.load();
    }

    return () => {
      v.removeEventListener("loadeddata", onLoaded);
      hls?.destroy();
      releaseMediaElement(v);
    };
  }, [videoSrc]);

  return (
    <>
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        className="hidden"
      />
      <CoverFrameSelector
        captureVideoRef={videoRef}
        captureReady={captureReady}
        duration={duration}
        videoAspect={videoAspect}
        targetAspect={targetAspect}
        onFrameSelect={onFrameSelect}
        selectionMode={selectionMode}
        confirmLabel={confirmLabel}
        className={className}
      />
    </>
  );
}

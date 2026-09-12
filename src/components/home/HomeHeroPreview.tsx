import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { usePlaybackSource } from "@/hooks/usePlaybackSource";
import { heroPreviewHlsConfig, releaseMediaElement } from "@/lib/video/hlsConfig";
import { videoService } from "@/lib/video/service";
import type { PreviewSource } from "@/lib/video/types";
import type { HomeHeroContent } from "./HomeHero";

interface HomeHeroPreviewProps {
  content: HomeHeroContent;
  maxDurationSeconds: number;
}

type NavigatorWithConnection = Navigator & {
  connection?: { saveData?: boolean };
};

export function HomeHeroPreview({ content, maxDurationSeconds }: HomeHeroPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const startedRef = useRef(false);
  const [isVisible, setIsVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === "visible");
  const [previewFinished, setPreviewFinished] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [publicPreview, setPublicPreview] = useState<PreviewSource | null>(null);

  useEffect(() => {
    startedRef.current = false;
    setPreviewFinished(false);
    setPreviewActive(false);
    setPublicPreview(null);
  }, [content.id]);

  useEffect(() => {
    const handleVisibility = () => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (!visible && startedRef.current) setPreviewFinished(true);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as NavigatorWithConnection).connection?.saveData === true;
    setMotionAllowed(!reducedMotion && !saveData);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !motionAllowed || previewFinished) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.45) {
          setIsVisible(true);
          return;
        }

        setIsVisible(false);
        if (startedRef.current) setPreviewFinished(true);
      },
      { threshold: [0, 0.45] },
    );

    observer.observe(root);
    return () => observer.disconnect();
  }, [motionAllowed, previewFinished]);

  const previewEnabled = motionAllowed && pageVisible && isVisible && !previewFinished;
  const hasProtectedSource = Boolean(content.media_asset_id || content.file_url);
  const playback = usePlaybackSource(content, previewEnabled && hasProtectedSource);

  useEffect(() => {
    if (!previewEnabled || hasProtectedSource || publicPreview) return;

    let active = true;
    videoService.getHeroPreviewSource(content.id)
      .then((source) => {
        if (!active) return;
        setPublicPreview(source);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [content.id, hasProtectedSource, previewEnabled, publicPreview]);

  const previewUrl = playback.url || publicPreview?.url || "";
  const previewDuration = Math.min(
    maxDurationSeconds,
    publicPreview?.duration || maxDurationSeconds,
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewEnabled || !previewUrl) return;

    let active = true;
    let hls: Hls | null = null;
    const isHls = publicPreview?.type === "hls" || previewUrl.includes(".m3u8") || Boolean(content.media_asset_id);

    const revealPreview = () => {
      if (active) setPreviewActive(true);
    };

    const startPreview = () => {
      if (!active) return;
      startedRef.current = true;
      void video.play().catch(() => {
        if (!active) return;
        setPreviewActive(false);
        setPreviewFinished(true);
      });
    };

    const mountSource = async () => {
      if (isHls) {
        const { default: HlsConstructor } = await import("hls.js");
        if (!active) return;

        // Browsers com MediaSource (Chrome/Edge/Firefox) usam hls.js.
        // Safari cai no HLS nativo, preservando a implementacao mais adequada.
        if (!HlsConstructor.isSupported()) {
          if (!video.canPlayType("application/vnd.apple.mpegurl")) return;
          video.src = previewUrl;
          startPreview();
          return;
        }

        hls = new HlsConstructor(heroPreviewHlsConfig);
        hls.loadSource(previewUrl);
        hls.attachMedia(video);
        hls.on(HlsConstructor.Events.MANIFEST_PARSED, startPreview);
        return;
      }

      video.src = previewUrl;
      startPreview();
    };

    const stopAtPreviewLimit = () => {
      if (video.currentTime < previewDuration) return;
      video.pause();
      hls?.stopLoad();
      setPreviewActive(false);
      setPreviewFinished(true);
    };

    video.addEventListener("timeupdate", stopAtPreviewLimit);
    video.addEventListener("playing", revealPreview, { once: true });
    void mountSource();

    return () => {
      active = false;
      video.removeEventListener("playing", revealPreview);
      video.removeEventListener("timeupdate", stopAtPreviewLimit);
      hls?.destroy();
      releaseMediaElement(video);
      setPreviewActive(false);
    };
  }, [content.media_asset_id, previewDuration, previewEnabled, previewUrl, publicPreview?.type]);

  return (
    <div ref={rootRef} className="cf2-home-hero__preview" aria-hidden="true">
      {playback.poster || content.thumbnail_url ? (
        <img
          className="cf2-home-hero__poster"
          src={playback.poster || content.thumbnail_url || ""}
          alt=""
          loading="eager"
        />
      ) : null}
      <video
        ref={videoRef}
        className={previewActive ? "is-active" : undefined}
        muted
        playsInline
        preload="none"
        tabIndex={-1}
      />
    </div>
  );
}

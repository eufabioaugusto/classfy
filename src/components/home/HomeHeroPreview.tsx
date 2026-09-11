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
        startedRef.current = true;
        setPublicPreview(source);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [content.id, hasProtectedSource, previewEnabled, publicPreview]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewEnabled || !playback.url) return;

    let active = true;
    let hls: Hls | null = null;
    const isHls = playback.url.includes(".m3u8") || Boolean(content.media_asset_id);

    const startPreview = () => {
      if (!active) return;
      startedRef.current = true;
      setPreviewActive(true);
      void video.play().catch(() => undefined);
    };

    const mountSource = async () => {
      if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playback.url;
        video.addEventListener("canplay", startPreview, { once: true });
        return;
      }

      if (isHls) {
        const { default: HlsConstructor } = await import("hls.js");
        if (!active || !HlsConstructor.isSupported()) return;

        hls = new HlsConstructor(heroPreviewHlsConfig);
        hls.loadSource(playback.url);
        hls.attachMedia(video);
        hls.on(HlsConstructor.Events.MANIFEST_PARSED, startPreview);
        return;
      }

      video.src = playback.url;
      video.addEventListener("canplay", startPreview, { once: true });
    };

    const stopAtPreviewLimit = () => {
      if (video.currentTime < maxDurationSeconds) return;
      video.pause();
      hls?.stopLoad();
      setPreviewActive(false);
      setPreviewFinished(true);
    };

    video.addEventListener("timeupdate", stopAtPreviewLimit);
    void mountSource();

    return () => {
      active = false;
      video.removeEventListener("canplay", startPreview);
      video.removeEventListener("timeupdate", stopAtPreviewLimit);
      hls?.destroy();
      releaseMediaElement(video);
      setPreviewActive(false);
    };
  }, [content.media_asset_id, maxDurationSeconds, playback.url, previewEnabled]);

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
      {previewEnabled && publicPreview?.type === "animated-image" && (
        <img
          className={`cf2-home-hero__motion ${previewActive ? "is-active" : ""}`}
          src={publicPreview.url}
          alt=""
          onLoad={() => setPreviewActive(true)}
        />
      )}
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

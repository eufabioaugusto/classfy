import { useEffect, useMemo, useState } from "react";
import Hls from "hls.js";
import { useMiniPlayer } from "@/contexts/MiniPlayerContext";
import { usePlaybackSource } from "@/hooks/usePlaybackSource";
import { useContentMetrics } from "@/hooks/useContentMetrics";
import { releaseMediaElement, standardHlsConfig } from "@/lib/video/hlsConfig";

/** Mesmo contrato de streaming e progresso do player principal, nos dois layouts. */
export function useMiniPlayerPlayback() {
  const { state, videoRef, setCurrentTime, setDuration, setIsPlaying } = useMiniPlayer();
  const content = state.content;
  const playback = usePlaybackSource(content ?? {}, Boolean(content && state.isVisible));
  const [attempt, setAttempt] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const metrics = useContentMetrics({
    contentId: content?.id ?? "",
    duration: state.duration || content?.duration_seconds || 0,
    enabled: Boolean(content && state.isVisible),
    initialPosition: state.currentTime,
  });
  const session = useMemo(() => ({ state, metrics }), [content?.id]);
  session.state = state;
  session.metrics = metrics;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !content || !state.isVisible || !playback.url) return;
    let active = true;
    let hls: Hls | null = null;
    const resumeTime = session.state.currentTime;
    const shouldPlay = session.state.isPlaying;
    setMediaError(null);

    const play = () => {
      if (shouldPlay && active) {
        void video.play().catch(() => { if (active) setIsPlaying(false); });
      }
    };
    const loaded = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : content.duration_seconds || 0;
      setDuration(duration);
      video.currentTime = Math.max(0, Math.min(resumeTime, duration || resumeTime));
      play();
    };
    const tick = () => {
      setCurrentTime(video.currentTime);
      if (!video.paused && !video.seeking) void session.metrics.handleTimeUpdate(video.currentTime);
    };
    const flush = () => { void session.metrics.flushProgress(video.currentTime, video.ended); };
    const playing = () => setIsPlaying(true);
    const paused = () => { setIsPlaying(false); flush(); };
    const ended = () => { setIsPlaying(false); flush(); };
    const fail = () => {
      setIsPlaying(false);
      setMediaError("Não foi possível reproduzir o vídeo.");
    };
    video.addEventListener("loadedmetadata", loaded);
    video.addEventListener("timeupdate", tick);
    video.addEventListener("play", playing);
    video.addEventListener("pause", paused);
    video.addEventListener("ended", ended);
    video.addEventListener("error", fail);
    window.addEventListener("pagehide", flush);

    if (playback.url.includes(".m3u8") || content.media_asset_id) {
      if (Hls.isSupported()) {
        hls = new Hls(standardHlsConfig);
        hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) fail(); });
        hls.loadSource(playback.url);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playback.url;
      } else fail();
    } else video.src = playback.url;

    return () => {
      active = false;
      flush();
      video.removeEventListener("loadedmetadata", loaded);
      video.removeEventListener("timeupdate", tick);
      video.removeEventListener("play", playing);
      video.removeEventListener("pause", paused);
      video.removeEventListener("ended", ended);
      video.removeEventListener("error", fail);
      window.removeEventListener("pagehide", flush);
      hls?.destroy();
      releaseMediaElement(video);
    };
  }, [content?.id, content?.media_asset_id, state.isVisible, playback.url, attempt, videoRef, setCurrentTime, setDuration, setIsPlaying]);

  return { ...playback, error: playback.error || mediaError, retry: () => {
    setMediaError(null);
    setIsPlaying(true);
    setAttempt(value => value + 1);
    playback.retry();
  } };
}

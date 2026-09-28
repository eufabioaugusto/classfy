import { useEffect, useRef, useState, useCallback, type ComponentProps } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  FileText,
  RectangleHorizontal,
  Minimize2,
  SkipBack,
  SkipForward,
  Loader2,
  RefreshCw,
  Settings,
  ChevronLeft,
  ChevronRight,
  StickyNote,
  Clock,
  Check,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useMediaSession } from "@/hooks/useMediaSession";
import { useContentMetrics } from "@/hooks/useContentMetrics";
import { useCourseLessonProgress } from "@/hooks/useCourseLessonProgress";
import { cn } from "@/lib/utils";
import Hls from "hls.js";
import { usePlaybackSource } from "@/hooks/usePlaybackSource";
import { releaseMediaElement, standardHlsConfig } from "@/lib/video/hlsConfig";
import {
  resolveResumePosition,
  shouldRestartFromBeginning,
} from "@/lib/video/resumePosition";

function PlayerControl({ label, shortcut, children, ...props }: ComponentProps<typeof Button> & { label: string; shortcut?: string }) {
  const [boundary, setBoundary] = useState<Element | null>(null);
  const bindTrigger = useCallback((node: HTMLButtonElement | null) => {
    setBoundary(node?.closest("[data-player-root]") ?? null);
  }, []);
  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip>
        <TooltipTrigger asChild><Button {...props} ref={bindTrigger} aria-label={label}>{children}</Button></TooltipTrigger>
        <TooltipContent side="top" sideOffset={14} collisionBoundary={boundary} collisionPadding={8} className="pointer-events-none flex items-center gap-1.5 rounded-md border-0 bg-neutral-900/95 px-2.5 py-1.5 text-[10px] font-medium text-white shadow-none" >
          {label}
          {shortcut && <kbd className="rounded border border-white/40 px-1.5 py-0.5 font-sans text-[10px] leading-none text-white/90">{shortcut}</kbd>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface UnifiedVideoPlayerProps {
  content: {
    id: string;
    title: string;
    file_url: string;
    thumbnail_url?: string;
    content_type: "aula" | "short" | "podcast" | "curso" | "live";
    duration_seconds?: number;
    content_id?: string | null;
    lesson_id?: string | null;
    creator?: {
      display_name: string;
    };
    video_provider?: string;
    bunny_video_id?: string | null;
    bunny_library_id?: string | null;
    media_asset_id?: string | null;
  };
  mode?: "watch" | "study";
  compact?: boolean;
  onTimeUpdate?: (currentTime: number) => void;
  onVideoEnded?: () => void;
  onNoteCreated?: () => void;
  seekToTime?: number | null;
  theaterMode?: boolean;
  onTheaterModeToggle?: () => void;
  showNoteButton?: boolean;
  className?: string;
  /** Slot para toolbar de ferramentas (aparece como overlay no topo no hover) */
  toolbarSlot?: React.ReactNode;
  /** Callback disparado quando um milestone de progresso é atingido (15s, 50%, 90%) */
  onMilestone?: () => void;
  courseProgress?: {
    courseId: string;
    lessonId: string;
  };
}

export function UnifiedVideoPlayer({
  content,
  mode = "watch",
  compact = false,
  onTimeUpdate,
  onVideoEnded,
  onNoteCreated,
  seekToTime,
  theaterMode,
  onTheaterModeToggle,
  showNoteButton = true,
  className,
  toolbarSlot,
  onMilestone,
  courseProgress,
}: UnifiedVideoPlayerProps) {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(content.duration_seconds || 0);
  const [buffered, setBuffered] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isSourceAttached, setIsSourceAttached] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [settingsSubMenu, setSettingsSubMenu] = useState<"main" | "speed" | "quality">("main");
  const [availableQualities, setAvailableQualities] = useState<Array<{ index: number; label: string }>>([]);
  const [currentQualityLabel, setCurrentQualityLabel] = useState("Auto");
  const [activeQualityIndex, setActiveQualityIndex] = useState(-1);
  const hlsRef = useRef<Hls | null>(null);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [noteTimestamp, setNoteTimestamp] = useState(0);
  const [noteMarkers, setNoteMarkers] = useState<number[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clickAnimation, setClickAnimation] = useState<"play" | "pause" | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPct, setDragPct] = useState(0);

  const controlsTimeoutRef = useRef<NodeJS.Timeout>();
  const volumeTimeoutRef = useRef<NodeJS.Timeout>();
  const clickAnimTimeoutRef = useRef<NodeJS.Timeout>();

  const { setMetadata, setPlaybackState, setPositionState, clearSession } = useMediaSession();
  const { handleTimeUpdate: trackMetrics, flushProgress } = useContentMetrics({
    contentId: content.content_id ?? content.id,
    duration: content.duration_seconds || duration,
    enabled: !courseProgress,
    onMilestone,
    initialPosition: seekToTime ?? 0,
  });
  const {
    handleTimeUpdate: trackCourseProgress,
    completeLesson,
    persistCurrent: persistCourseProgress,
    reset: resetCourseProgress,
  } = useCourseLessonProgress({
    courseId: courseProgress?.courseId,
    lessonId: courseProgress?.lessonId,
    duration: content.duration_seconds || duration,
    enabled: Boolean(courseProgress),
    onMilestone,
  });

  const mediaRef = content.content_type === "podcast" ? audioRef : videoRef;
  const isVideo = content.content_type !== "podcast";
  const playback = usePlaybackSource(content);
  const pendingResumePositionRef = useRef<number | null>(null);
  const hasUserRequestedPlaybackRef = useRef(false);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(content.duration_seconds || 0);
    setBuffered(0);
    setIsSourceAttached(false);
    pendingResumePositionRef.current = null;
    hasUserRequestedPlaybackRef.current = false;
    resetCourseProgress();
  }, [content.id, content.duration_seconds, courseProgress?.lessonId, resetCourseProgress]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire if focused on an input/textarea
      if ((e.target as HTMLElement)?.closest('[role="dialog"]')) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const media = mediaRef.current;
      if (!media) return;

      switch (e.code) {
        case "Space":
        case "KeyK":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          skip(-10);
          break;
        case "ArrowRight":
          e.preventDefault();
          skip(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          changeVolume(Math.min(1, volume + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          changeVolume(Math.max(0, volume - 0.1));
          break;
        case "KeyM":
          e.preventDefault();
          toggleMute();
          break;
        case "KeyF":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "KeyJ":
          e.preventDefault();
          skip(-10);
          break;
        case "KeyL":
          e.preventDefault();
          skip(10);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, volume, duration]);

  // ── Fullscreen change listener ────────────────────────────────────────────
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // ── HLS Stream Loading ──────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    setIsSourceAttached(false);
    if (!video || !playback.url) return;

    let hls: Hls | null = null;
    const isHls = playback.url.includes(".m3u8") || Boolean(content.media_asset_id) || content.video_provider === "bunny";

    if (isHls && Hls.isSupported()) {
      hls = new Hls({ ...standardHlsConfig, autoStartLoad: false });

      hls.on(Hls.Events.MEDIA_ATTACHED, () => setIsSourceAttached(true));
      hls.loadSource(playback.url);
      hls.attachMedia(video);
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls) {
          const qualities = hls.levels.map((level, index) => ({
            index,
            label: `${level.height}p`
          })).reverse();
          setAvailableQualities(qualities);
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        if (hls && hls.currentLevel === -1) {
          const autoLevel = hls.levels[data.level];
          if (autoLevel) {
            setCurrentQualityLabel(`Auto (${autoLevel.height}p)`);
          }
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls?.recoverMediaError();
              break;
            default:
              hls?.destroy();
              hlsRef.current = null;
              break;
          }
        }
      });
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS fallback (Safari/iOS)
      video.src = playback.url;
      setIsSourceAttached(true);
      setAvailableQualities([]);
      setCurrentQualityLabel("Auto");
    } else {
      // Standard MP4 fallback
      video.src = playback.url;
      setIsSourceAttached(true);
      setAvailableQualities([]);
      setCurrentQualityLabel("Padrão");
    }

    return () => {
      if (hls) {
        hls.destroy();
        hlsRef.current = null;
      }
      releaseMediaElement(video);
    };
  }, [playback.url, content.media_asset_id, content.video_provider]);

  useEffect(() => {
    const audio = audioRef.current;
    if (isVideo || !audio || !playback.url) return;

    let hls: Hls | null = null;
    const isHls = playback.url.includes(".m3u8") || Boolean(content.media_asset_id);
    if (isHls && Hls.isSupported()) {
      hls = new Hls(standardHlsConfig);
      hls.loadSource(playback.url);
      hls.attachMedia(audio);
      setIsSourceAttached(true);
    } else {
      audio.src = playback.url;
      setIsSourceAttached(true);
    }

    return () => {
      hls?.destroy();
      releaseMediaElement(audio);
    };
  }, [content.media_asset_id, isVideo, playback.url]);

  // ── Media Session ─────────────────────────────────────────────────────────
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !content.title) return;

    setMetadata({
      title: content.title,
      artist: content.creator?.display_name || "Classfy",
      artwork: content.thumbnail_url,
      onPlay: () => { media.play(); setIsPlaying(true); },
      onPause: () => { media.pause(); setIsPlaying(false); },
      onSeekBackward: () => { media.currentTime = Math.max(0, media.currentTime - 10); },
      onSeekForward: () => { media.currentTime = Math.min(media.duration || 0, media.currentTime + 10); },
      onSeekTo: (time) => { media.currentTime = time; setCurrentTime(time); },
    });

    return () => clearSession();
  }, [content.title, content.thumbnail_url, content.creator?.display_name, setMetadata, clearSession]);

  useEffect(() => {
    setPlaybackState(isPlaying ? "playing" : "paused");
  }, [isPlaying, setPlaybackState]);

  useEffect(() => {
    if (duration > 0) {
      setPositionState({ duration, position: currentTime, playbackRate });
    }
  }, [currentTime, duration, playbackRate, setPositionState]);

  // ── Load saved position ───────────────────────────────────────────────────
  useEffect(() => {
    const applySavedPosition = (
      savedPosition?: number | null,
      completed?: boolean | null,
    ) => {
      if (hasUserRequestedPlaybackRef.current) return;

      const media = mediaRef.current;
      const resumePosition = resolveResumePosition({
        savedPosition,
        completed,
        duration: content.duration_seconds,
      });

      pendingResumePositionRef.current = resumePosition;
      setCurrentTime(resumePosition);

      if (media && media.readyState >= 1) {
        const finalPosition = resolveResumePosition({
          savedPosition: resumePosition,
          completed,
          duration: media.duration,
        });
        media.currentTime = finalPosition;
        setCurrentTime(finalPosition);
        pendingResumePositionRef.current = null;
      }
    };

    const load = async () => {
      if (!user || !content.id) return;
      if (courseProgress) {
        const { data } = await supabase
          .from("course_lesson_progress")
          .select("last_position_seconds, completed")
          .eq("user_id", user.id)
          .eq("lesson_id", courseProgress.lessonId)
          .maybeSingle();
        if (data) {
          applySavedPosition(data.last_position_seconds, data.completed);
        }
        return;
      }
      const { data } = await supabase
        .from("user_progress")
        .select("last_position_seconds, completed")
        .eq("user_id", user.id)
        .eq("content_id", content.content_id ?? content.id)
        .maybeSingle();
      if (data) {
        applySavedPosition(data.last_position_seconds, data.completed);
      }
    };
    void load();
  }, [content.id, content.content_id, content.duration_seconds, courseProgress?.lessonId, user]);

  // ── Load note markers ─────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (!user || !content.id) return;
      const { data, error } = await supabase
        .from("study_notes")
        .select("timestamp_seconds")
        .eq("user_id", user.id)
        .eq("content_id", content.content_id ?? content.id)
        .not("timestamp_seconds", "is", null);
      if (!error && data) {
        setNoteMarkers(data.map((n) => n.timestamp_seconds as number));
      }
    };
    load();
  }, [content.id, user]);

  // ── External seek / return from mini player ────────────────────────────────
  useEffect(() => {
    if (seekToTime === null || seekToTime === undefined || !isSourceAttached) return;
    const media = mediaRef.current;
    if (!media) return;
    hasUserRequestedPlaybackRef.current = true;
    pendingResumePositionRef.current = seekToTime;
    if (media.readyState >= 1) media.currentTime = seekToTime;
    setCurrentTime(seekToTime);
    hlsRef.current?.startLoad(-1);
    void media.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }, [seekToTime, isSourceAttached]);

  // ── Media event listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const onLoadedMetadata = () => {
      const loadedDuration =
        Number.isFinite(media.duration) && media.duration > 0
          ? media.duration
          : content.duration_seconds || 0;
      setDuration(loadedDuration);

      if (pendingResumePositionRef.current !== null) {
        const resumePosition = resolveResumePosition({
          savedPosition: pendingResumePositionRef.current,
          duration: loadedDuration,
        });
        media.currentTime = resumePosition;
        setCurrentTime(resumePosition);
        pendingResumePositionRef.current = null;
      }
    };

    const onTimeUpdateEv = () => {
      const t = media.currentTime;
      setCurrentTime(t);
      onTimeUpdate?.(t);
      trackMetrics(t);
      trackCourseProgress(t);

      // Update buffered range
      if (media.buffered.length > 0) {
        setBuffered(media.buffered.end(media.buffered.length - 1));
      }
    };

    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);
    const onPlaying = () => setIsBuffering(false);

    const onEnded = async () => {
      setIsPlaying(false);
      if (courseProgress) {
        await completeLesson();
      } else {
        await flushProgress(media.currentTime, true);
      }
      onVideoEnded?.();
    };

    const onPause = () => {
      if (!media.ended) saveCurrentPosition(media.currentTime);
    };

    media.addEventListener("loadedmetadata", onLoadedMetadata);
    media.addEventListener("timeupdate", onTimeUpdateEv);
    media.addEventListener("waiting", onWaiting);
    media.addEventListener("canplay", onCanPlay);
    media.addEventListener("playing", onPlaying);
    media.addEventListener("ended", onEnded);
    media.addEventListener("pause", onPause);

    return () => {
      saveCurrentPosition(media.currentTime);
      media.removeEventListener("loadedmetadata", onLoadedMetadata);
      media.removeEventListener("timeupdate", onTimeUpdateEv);
      media.removeEventListener("waiting", onWaiting);
      media.removeEventListener("canplay", onCanPlay);
      media.removeEventListener("playing", onPlaying);
      media.removeEventListener("ended", onEnded);
      media.removeEventListener("pause", onPause);
    };
  }, [content.id, content.content_id, content.duration_seconds, user, duration, onTimeUpdate, onVideoEnded, trackMetrics, trackCourseProgress, courseProgress, completeLesson, flushProgress]);

  const saveCurrentPosition = useCallback(async (time: number) => {
    if (!user || !content.id || !time || time < 1 || duration <= 0) return;

    if (courseProgress) {
      await persistCourseProgress();
      return;
    }
    await flushProgress(time);
  }, [user, content.id, duration, courseProgress, persistCourseProgress, flushProgress]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (playback.loading || !playback.url || !isSourceAttached) return;
    hasUserRequestedPlaybackRef.current = true;
    if (isPlaying) {
      media.pause();
      setIsPlaying(false);
      triggerClickAnim("pause");
    } else {
      const knownDuration =
        Number.isFinite(media.duration) && media.duration > 0
          ? media.duration
          : duration;
      if (
        shouldRestartFromBeginning({
          currentTime,
          duration: knownDuration,
          ended: media.ended,
        })
      ) {
        media.currentTime = 0;
        setCurrentTime(0);
        pendingResumePositionRef.current = 0;
      }

      hlsRef.current?.startLoad(-1);
      const playPromise = media.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
            triggerClickAnim("play");
          })
          .catch(() => {
            // Browser blocked autoplay or media not ready — stay paused
            setIsPlaying(false);
          });
      } else {
        setIsPlaying(true);
        triggerClickAnim("play");
      }
    }
  }, [currentTime, duration, isPlaying, isSourceAttached, playback.loading, playback.url]);

  const skip = useCallback((seconds: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(0, Math.min(media.duration || 0, media.currentTime + seconds));
  }, []);

  const toggleMute = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const changeVolume = useCallback((val: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = val;
    setVolume(val);
    if (val === 0) {
      media.muted = true;
      setIsMuted(true);
    } else if (isMuted) {
      media.muted = false;
      setIsMuted(false);
    }
  }, [isMuted]);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, []);

  const getProgressPct = useCallback((clientX: number) => {
    if (!progressRef.current || duration === 0) return 0;
    const rect = progressRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, [duration]);

  // Drag handlers
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const pct = getProgressPct(e.clientX);
      setDragPct(pct);
      const media = mediaRef.current;
      if (media && duration > 0) {
        media.currentTime = pct * duration;
        setCurrentTime(pct * duration);
      }
    };
    const onUp = (e: MouseEvent) => {
      const pct = getProgressPct(e.clientX);
      const media = mediaRef.current;
      if (media && duration > 0) {
        media.currentTime = pct * duration;
        setCurrentTime(pct * duration);
      }
      setIsDragging(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, duration, getProgressPct]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const media = mediaRef.current;
    if (!media) return;
    const time = parseFloat(e.target.value);
    media.currentTime = time;
    setCurrentTime(time);
  };

  const changePlaybackRate = (rate: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.playbackRate = rate;
    setPlaybackRate(rate);
    setSettingsSubMenu("main");
  };

  const changeQuality = (index: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = index;
      setActiveQualityIndex(index);
      if (index === -1) {
        const currentLevel = hlsRef.current.currentLevel;
        const currentHeight = currentLevel !== -1 ? hlsRef.current.levels[currentLevel]?.height : null;
        setCurrentQualityLabel(currentHeight ? `Auto (${currentHeight}p)` : "Auto");
      } else {
        const selectedLevel = hlsRef.current.levels[index];
        setCurrentQualityLabel(selectedLevel ? `${selectedLevel.height}p` : "Custom");
      }
    }
    setSettingsSubMenu("main");
  };

  const triggerClickAnim = (type: "play" | "pause") => {
    setClickAnimation(type);
    if (clickAnimTimeoutRef.current) clearTimeout(clickAnimTimeoutRef.current);
    clickAnimTimeoutRef.current = setTimeout(() => setClickAnimation(null), 600);
  };

  // ── Controls visibility ───────────────────────────────────────────────────
  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  };

  const handleMouseLeave = () => {
    if (isPlaying) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 1000);
    }
  };

  // ── Progress bar hover ────────────────────────────────────────────────────
  const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || duration === 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    setHoverTime(pct * duration);
    setHoverX(x);
  };

  const handleProgressLeave = () => setHoverTime(null);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const media = mediaRef.current;
    if (!progressRef.current || !media || duration === 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const time = pct * duration;
    media.currentTime = time;
    setCurrentTime(time);
  };

  // ── Note ──────────────────────────────────────────────────────────────────
  const openNoteModal = () => {
    setNoteError("");
    setNoteTimestamp(Math.floor(currentTime));
    setNoteModalOpen(true);
    const media = mediaRef.current;
    if (media && isPlaying) { media.pause(); setIsPlaying(false); }
  };

  const handleSaveNote = async () => {
    if (noteSaving || !noteText.trim() || !user) return;
    setNoteSaving(true);
    setNoteError("");
    try {
      const { error } = await supabase.from("study_notes").insert({
        user_id: user.id,
        content_id: content.content_id ?? null,
        lesson_id: content.lesson_id ?? null,
        study_id: null,
        note_text: noteText.trim(),
        timestamp_seconds: noteTimestamp,
      });
      if (error) throw error;
      setNoteMarkers((prev) => [...prev, noteTimestamp]);
      toast.success("Nota salva!");
      setNoteModalOpen(false);
      setNoteText("");
      onNoteCreated?.();
      const media = mediaRef.current;
      if (media) { media.play(); setIsPlaying(true); }
    } catch {
      setNoteError("Não foi possível salvar. Seu texto foi mantido; tente novamente.");
    } finally {
      setNoteSaving(false);
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const displayPct = isDragging ? dragPct * 100 : (duration > 0 ? (currentTime / duration) * 100 : 0);
  const playedPct = displayPct;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const playbackUnavailable = !playback.loading && !playback.url;

  return (
    <>
      <div
        ref={containerRef}
        data-player-root
        className={cn(
          "relative overflow-hidden bg-black rounded-xl",
          compact && "rounded-none",
          theaterMode && "max-h-[calc(100vh-7rem)]",
          className
        )}
        onMouseMove={resetControlsTimeout}
        onMouseLeave={handleMouseLeave}
      >
        {isVideo ? (
          <video
            ref={videoRef}
            className={cn(
              "w-full",
              compact ? "h-full object-contain" : "aspect-video",
              theaterMode && "max-h-[calc(100vh-7rem)] object-contain"
            )}
            poster={content.thumbnail_url}
            onClick={togglePlay}
            onDoubleClick={toggleFullscreen}
            preload="none"
          />
        ) : (
          <>
            <div
              className="w-full aspect-video flex items-center justify-center relative cursor-pointer"
              style={
                content.thumbnail_url
                  ? { backgroundImage: `url(${content.thumbnail_url})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : { background: "linear-gradient(135deg, hsl(var(--primary)/0.2), hsl(var(--background)))" }
              }
              onClick={togglePlay}
            >
              {content.thumbnail_url && <div className="absolute inset-0 bg-black/50" />}
              <div className="text-center relative z-10 pointer-events-none">
                <Volume2 className="w-16 h-16 mx-auto mb-4 text-white drop-shadow-lg" />
                <h3 className="text-xl font-semibold text-white drop-shadow-lg">{content.title}</h3>
              </div>
            </div>
            <audio ref={audioRef} />
          </>
        )}

        {/* Toolbar overlay — topo, aparece com os controles */}
        {toolbarSlot && (
          <div
            className={cn(
              "absolute top-0 left-0 right-0 z-20 transition-opacity duration-300",
              showControls ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
          >
            <div className="bg-gradient-to-b from-black/80 to-transparent px-3 pt-3 pb-6">
              {toolbarSlot}
            </div>
          </div>
        )}

        {/* Source resolution / buffering spinner */}
        {(
          playback.loading ||
          (Boolean(playback.url) && !isSourceAttached) ||
          isBuffering
        ) && !playback.error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="w-12 h-12 text-white animate-spin opacity-80" />
          </div>
        )}

        {(playback.error || playbackUnavailable) && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 px-6 text-center">
            <div className="max-w-sm space-y-3">
              <p className="text-sm font-semibold text-white">
                Não foi possível carregar o vídeo
              </p>
              <p className="text-xs text-white/65">
                A reprodução não foi iniciada. Tente carregar a mídia novamente.
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={playback.retry}
                className="mx-auto gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Tentar novamente
              </Button>
            </div>
          </div>
        )}

        {/* Click animation (play/pause flash) */}
        {clickAnimation && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/40 rounded-full p-4 animate-ping-once">
              {clickAnimation === "play"
                ? <Play className="w-10 h-10 text-white fill-white" />
                : <Pause className="w-10 h-10 text-white fill-white" />
              }
            </div>
          </div>
        )}

        {/* Controls overlay */}
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 transition-opacity duration-300",
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          {/* Gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />

          <div className="relative px-3 pb-3 pt-8 space-y-2">
            {/* Progress bar */}
            <div
              ref={progressRef}
              className="relative w-full h-4 flex items-center cursor-pointer group"
              onMouseMove={handleProgressHover}
              onMouseLeave={handleProgressLeave}
              onClick={handleProgressClick}
              onMouseDown={(e) => {
                e.preventDefault();
                const pct = getProgressPct(e.clientX);
                setDragPct(pct);
                setIsDragging(true);
              }}
            >
              {/* Track */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 group-hover:h-1.5 transition-all duration-150 bg-white/20 rounded-full overflow-hidden">
                {/* Buffered */}
                <div
                  className="absolute inset-y-0 left-0 bg-white/30 rounded-full"
                  style={{ width: `${bufferedPct}%` }}
                />
                {/* Played */}
                <div
                  className="absolute inset-y-0 left-0 bg-red-500 rounded-full"
                  style={{ width: `${playedPct}%` }}
                />
              </div>

              {/* Thumb */}
              <div
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-red-500 rounded-full shadow-lg transition-opacity duration-150 pointer-events-none",
                  isDragging ? "opacity-100 scale-125" : "opacity-0 group-hover:opacity-100"
                )}
                style={{ left: `calc(${playedPct}% - 6px)` }}
              />

              {/* Note markers */}
              {duration > 0 && noteMarkers.map((ts, i) => {
                if (ts == null || ts < 0 || ts > duration) return null;
                return (
                  <div
                    key={`m-${ts}-${i}`}
                    className="absolute top-1/2 -translate-y-1/2 w-1.5 h-3 bg-red-500 rounded-sm z-10 hover:bg-red-400 transition-colors pointer-events-auto"
                    style={{ left: `${(ts / duration) * 100}%`, transform: "translateX(-50%) translateY(-50%)" }}
                    title={`Nota em ${formatTime(ts)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const media = mediaRef.current;
                      if (media) { media.currentTime = ts; setCurrentTime(ts); if (!isPlaying) { media.play(); setIsPlaying(true); } }
                    }}
                  />
                );
              })}

              {/* Hover time tooltip */}
              {hoverTime !== null && (
                <div
                  className="absolute -top-8 px-1.5 py-0.5 bg-black/80 text-white text-xs rounded pointer-events-none select-none"
                  style={{ left: hoverX, transform: "translateX(-50%)" }}
                >
                  {formatTime(hoverTime)}
                </div>
              )}
            </div>

            {/* Buttons row */}
            <div className="flex items-center justify-between gap-1">
              {/* Left side */}
              <div className="flex items-center gap-0.5 sm:gap-1">
                {/* Skip back */}
                <PlayerControl label="Voltar 10 segundos" shortcut="←"
                  size="icon"
                  variant="ghost"
                  onClick={() => skip(-10)}
                  className="text-white hover:bg-white/20 h-8 w-8 flex-shrink-0"
                >
                  <SkipBack className="w-4 h-4" />
                </PlayerControl>

                {/* Play/Pause */}
                <PlayerControl label={isPlaying ? "Pausar" : "Reproduzir"} shortcut="K"
                  size="icon"
                  variant="ghost"
                  onClick={togglePlay}
                  disabled={
                    playback.loading ||
                    !isSourceAttached ||
                    Boolean(playback.error) ||
                    playbackUnavailable
                  }
                  className="text-white hover:bg-white/20 h-8 w-8 sm:h-9 sm:w-9 flex-shrink-0"
                >
                  {isPlaying ? <Pause className="w-4 h-4 sm:w-5 sm:h-5" /> : <Play className="w-4 h-4 sm:w-5 sm:h-5" />}
                </PlayerControl>

                {/* Skip forward */}
                <PlayerControl label="Avançar 10 segundos" shortcut="→"
                  size="icon"
                  variant="ghost"
                  onClick={() => skip(10)}
                  className="text-white hover:bg-white/20 h-8 w-8 flex-shrink-0"
                >
                  <SkipForward className="w-4 h-4" />
                </PlayerControl>

                {/* Volume */}
                <div
                  className="flex items-center gap-1 group/vol"
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  onMouseLeave={() => {
                    if (volumeTimeoutRef.current) clearTimeout(volumeTimeoutRef.current);
                    volumeTimeoutRef.current = setTimeout(() => setShowVolumeSlider(false), 400);
                  }}
                >
                  <PlayerControl label={isMuted || volume === 0 ? "Ativar som" : "Silenciar"} shortcut="M"
                    size="icon"
                    variant="ghost"
                    onClick={toggleMute}
                    className="text-white hover:bg-white/20 h-8 w-8 flex-shrink-0"
                  >
                    {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </PlayerControl>

                  <div
                    className={cn(
                      "overflow-hidden transition-all duration-200",
                      showVolumeSlider ? "w-20 opacity-100" : "w-0 opacity-0"
                    )}
                  >
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={(e) => changeVolume(parseFloat(e.target.value))}
                      className="w-full h-1 appearance-none cursor-pointer rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-500 [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-red-500 [&::-moz-range-thumb]:border-0"
                      style={{
                        background: `linear-gradient(to right, rgb(239 68 68) 0%, rgb(239 68 68) ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.3) ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.3) 100%)`
                      }}
                    />
                  </div>
                </div>

                {/* Time */}
                <span className="text-white text-xs font-medium whitespace-nowrap ml-1 hidden sm:block">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              {/* Right side */}
              <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
                {/* Note button */}
                {showNoteButton && (
                  <PlayerControl label="Adicionar anotação"
                    size="icon"
                    variant="ghost"
                    onClick={openNoteModal}
                    className="text-white hover:bg-white/20 h-8 w-8"
                  >
                    <FileText className="w-4 h-4" />
                  </PlayerControl>
                )}

                {/* Settings Gear (YouTube style) */}
                <div className="relative">
                  <PlayerControl label="Configurações"
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setShowSettingsMenu(!showSettingsMenu);
                      setSettingsSubMenu("main");
                    }}
                    className="text-white hover:bg-white/20 h-8 w-8"
                  >
                    <Settings className="w-4 h-4" />
                  </PlayerControl>

                  {showSettingsMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl p-2 z-50 min-w-[245px] text-white animate-in fade-in slide-in-from-bottom-2 duration-200">
                      
                      {/* SUB-MENU: MAIN OPTIONS */}
                      {settingsSubMenu === "main" && (
                        <div className="space-y-1">
                          <button
                            onClick={() => setSettingsSubMenu("speed")}
                            className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg hover:bg-white/10 transition-colors text-left"
                          >
                            <span className="text-white/80 text-left">Velocidade da reprodução</span>
                            <span className="flex items-center text-white/50 text-xs font-semibold ml-2">
                              {playbackRate === 1 ? "Normal" : `${playbackRate}x`}
                              <ChevronRight className="w-3.5 h-3.5 ml-1" />
                            </span>
                          </button>

                          {availableQualities.length > 0 && (
                            <button
                              onClick={() => setSettingsSubMenu("quality")}
                              className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg hover:bg-white/10 transition-colors text-left"
                            >
                              <span className="text-white/80 text-left">Qualidade</span>
                              <span className="flex items-center text-white/50 text-xs font-semibold ml-2">
                                {currentQualityLabel}
                                <ChevronRight className="w-3.5 h-3.5 ml-1" />
                              </span>
                            </button>
                          )}
                        </div>
                      )}

                      {/* SUB-MENU: SPEED SELECTION */}
                      {settingsSubMenu === "speed" && (
                        <div className="space-y-1">
                          <button
                            onClick={() => setSettingsSubMenu("main")}
                            className="w-full flex items-center px-2 py-1.5 text-xs text-white/60 hover:text-white mb-1"
                          >
                            <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Voltar
                          </button>
                          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                            <button
                              key={rate}
                              onClick={() => changePlaybackRate(rate)}
                              className={cn(
                                "w-full text-left px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center justify-between",
                                playbackRate === rate ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-white/10 text-white/80"
                              )}
                            >
                              <span>{rate === 1 ? "Normal" : `${rate}x`}</span>
                              {playbackRate === rate && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* SUB-MENU: QUALITY SELECTION */}
                      {settingsSubMenu === "quality" && (
                        <div className="space-y-1">
                          <button
                            onClick={() => setSettingsSubMenu("main")}
                            className="w-full flex items-center px-2 py-1.5 text-xs text-white/60 hover:text-white mb-1"
                          >
                            <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Voltar
                          </button>

                          {/* Auto Quality */}
                          <button
                            onClick={() => changeQuality(-1)}
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center justify-between",
                              activeQualityIndex === -1 ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-white/10 text-white/80"
                            )}
                          >
                            <span>Auto</span>
                            {activeQualityIndex === -1 && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
                          </button>

                          {availableQualities.map((q) => (
                            <button
                              key={q.index}
                              onClick={() => changeQuality(q.index)}
                              className={cn(
                                "w-full text-left px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center justify-between",
                                activeQualityIndex === q.index ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-white/10 text-white/80"
                              )}
                            >
                              <span className="flex items-center">
                                {q.label}
                                {q.label === "720p" && (
                                  <span className="ml-2 px-1 py-0.2 text-[8px] font-extrabold bg-white/20 text-white rounded-[3px] tracking-wide leading-none">HD</span>
                                )}
                                {q.label === "1080p" && (
                                  <span className="ml-2 px-1 py-0.2 text-[8px] font-extrabold bg-white/20 text-white rounded-[3px] tracking-wide leading-none">FHD</span>
                                )}
                              </span>
                              {activeQualityIndex === q.index && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Theater Mode */}
                {isVideo && onTheaterModeToggle && (
                  <PlayerControl label={theaterMode ? "Sair do modo teatro" : "Modo teatro"}
                    size="icon"
                    variant="ghost"
                    onClick={onTheaterModeToggle}
                    className="text-white hover:bg-white/20 h-8 w-8 hidden md:flex"
                  >
                    {theaterMode ? <Minimize2 className="w-4 h-4" /> : <RectangleHorizontal className="w-4 h-4" />}
                  </PlayerControl>
                )}

                {/* Fullscreen */}
                {isVideo && (
                  <PlayerControl label={isFullscreen ? "Sair da tela cheia" : "Tela inteira"} shortcut="F"
                    size="icon"
                    variant="ghost"
                    onClick={toggleFullscreen}
                    className="text-white hover:bg-white/20 h-8 w-8"
                  >
                    {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                  </PlayerControl>
                )}
              </div>
            </div>
          </div>
          </div>
      </div>

      {/* Quick note uses the same visual language as the study tools. */}
      <Dialog open={noteModalOpen} onOpenChange={(open) => { if (!noteSaving) setNoteModalOpen(open); }}>
        <DialogContent portalContainer={isFullscreen ? containerRef.current : undefined}
          className="w-[calc(100%-32px)] max-w-[460px] max-h-[85dvh] overflow-y-auto rounded-[24px] sm:rounded-[24px] border-border/60 p-0 gap-0 shadow-2xl [&>button]:right-5 [&>button]:top-5 [&>button]:rounded-full [&>button]:bg-muted/60 [&>button]:p-2">
          <DialogHeader className="px-6 pt-6 pb-5 text-left sm:text-left">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10"><StickyNote className="h-5 w-5 text-red-500" aria-hidden="true" /></div>
            <DialogTitle className="text-xl font-semibold tracking-tight">Nova anotação</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">Guarde uma ideia para voltar a este momento.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6">
            <div className="mb-4 flex min-w-0 items-center gap-3">
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-500"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{formatTime(noteTimestamp)}</span>
              <span className="truncate text-xs text-muted-foreground">{content.title}</span>
            </div>
            <label htmlFor="player-quick-note" className="sr-only">Sua anotação</label>
            <Textarea id="player-quick-note" value={noteText} onChange={(e) => setNoteText(e.target.value)}
              placeholder="O que você quer guardar desta aula?" rows={5} autoFocus disabled={noteSaving}
              className="min-h-[156px] resize-none rounded-2xl border-border/70 bg-muted/25 p-4 text-sm leading-relaxed shadow-none focus-visible:border-red-500/40 focus-visible:ring-red-500/20 focus-visible:ring-offset-0" />
            <p className="mt-2 text-xs text-muted-foreground">Sua anotação fica salva com o horário do vídeo.</p>
            {noteError && <p role="alert" className="mt-3 rounded-xl bg-red-500/5 p-3 text-sm text-red-500">{noteError}</p>}
            <div className="mt-5 flex gap-3">
              <Button variant="ghost" disabled={noteSaving} onClick={() => setNoteModalOpen(false)} className="h-11 rounded-xl px-4 text-muted-foreground">Cancelar</Button>
              <Button onClick={handleSaveNote} disabled={noteSaving || !noteText.trim() || !user} className="h-11 flex-1 gap-2 rounded-xl bg-red-500 text-white shadow-none hover:bg-red-600">
                {noteSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {noteSaving ? "Salvando..." : "Salvar anotação"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

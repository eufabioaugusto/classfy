import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from "livekit-client";
import { Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { LiveDiagnosticMetrics, LiveDiagnosticReport } from "@/hooks/useLiveDiagnostics";
import { sampleLiveRtcStats } from "@/lib/liveRtcStats";

type Props = {
  liveId: string;
  creatorId: string;
  ending: boolean;
  standby: boolean;
  muted: boolean;
  compact?: boolean;
  onMutedChange: (muted: boolean) => void;
  onReady: () => void;
  onFallback: (reason: LiveDiagnosticReport["fallbackReason"]) => void;
  onComplete: () => void;
  onEvent: (type: string) => void;
  onMetrics: (metrics: LiveDiagnosticMetrics) => void;
  onQuality: (quality: LiveDiagnosticReport["quality"]) => void;
  onFirstFrame: () => void;
  onStall: () => void;
};

export function LiveRealtimePlayer({ liveId, creatorId, ending, standby, muted, compact = false, onMutedChange, onReady, onFallback, onComplete, onEvent, onMetrics, onQuality, onFirstFrame, onStall }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<Room | null>(null);
  const endingRef = useRef(ending);
  const standbyRef = useRef(standby);
  const mutedRef = useRef(muted);
  const callbacksRef = useRef({ onReady, onFallback, onComplete, onEvent, onMetrics, onQuality, onFirstFrame, onStall });
  const firstFrameRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => { endingRef.current = ending; }, [ending]);
  useEffect(() => {
    standbyRef.current = standby;
    mutedRef.current = muted;
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = standby || muted;
    if (!standby && !muted && ready) {
      void roomRef.current?.startAudio().then(() => audio.play()).catch(() => {
        setAudioBlocked(true);
        callbacksRef.current.onEvent("audio_blocked");
      });
    }
  }, [standby, muted, ready]);
  useEffect(() => { callbacksRef.current = { onReady, onFallback, onComplete, onEvent, onMetrics, onQuality, onFirstFrame, onStall }; }, [onReady, onFallback, onComplete, onEvent, onMetrics, onQuality, onFirstFrame, onStall]);

  useEffect(() => {
    let active = true;
    let departureTimer: number | undefined;
    let videoTrack: RemoteTrack | null = null;
    let audioTrack: RemoteTrack | null = null;
    let previousCounter: { bytes: number; at: number } | undefined;
    let previousAudioCounter: { bytes: number; at: number } | undefined;
    let reconnects = 0;
    let tokenReady = false;
    let connected = false;
    let initialFallbackSignaled = false;
    let playbackFallbackSignaled = false;
    const startedAt = performance.now();
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const fallback = (reason: LiveDiagnosticReport["fallbackReason"]) => {
      if (!active) return;
      if (firstFrameRef.current) {
        if (playbackFallbackSignaled) return;
        playbackFallbackSignaled = true;
      } else {
        if (initialFallbackSignaled) return;
        initialFallbackSignaled = true;
      }
      callbacksRef.current.onFallback(reason);
    };
    const attach = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (participant.identity !== creatorId) return;
      if (track.kind === Track.Kind.Video && videoRef.current) {
        track.attach(videoRef.current);
        videoTrack = track;
        setReady(true);
        callbacksRef.current.onEvent("rtc_track_subscribed");
        callbacksRef.current.onMetrics({ viewerTrackMs: Math.round(performance.now() - startedAt) });
        void videoRef.current.play().catch(() => undefined);
      }
      if (track.kind === Track.Kind.Audio && audioRef.current) {
        track.attach(audioRef.current);
        audioTrack = track;
        audioRef.current.muted = standbyRef.current || mutedRef.current;
        void audioRef.current.play().catch(() => { setAudioBlocked(true); callbacksRef.current.onEvent("audio_blocked"); });
      }
    };
    const finishOrFallback = () => {
      if (departureTimer) return;
      departureTimer = window.setTimeout(() => {
        if (!active) return;
        if (endingRef.current) callbacksRef.current.onComplete();
        else fallback("host_left");
      }, 1200);
    };
    const leave = (participant: RemoteParticipant) => {
      if (participant.identity !== creatorId) return;
      finishOrFallback();
    };
    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.ParticipantDisconnected, leave);
    room.on(RoomEvent.Disconnected, () => {
      if (!active) return;
      if (endingRef.current) finishOrFallback();
      else fallback("room_left");
    });
    room.on(RoomEvent.Reconnecting, () => {
      reconnects += 1;
      callbacksRef.current.onMetrics({ reconnects });
      callbacksRef.current.onEvent("reconnecting");
    });
    room.on(RoomEvent.Reconnected, () => callbacksRef.current.onEvent("reconnected"));
    room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (participant.identity === creatorId || participant.identity === room.localParticipant.identity) {
        callbacksRef.current.onQuality(String(quality).toLowerCase() as LiveDiagnosticReport["quality"]);
      }
    });
    const statsTimer = window.setInterval(() => {
      if (!videoTrack) return;
      void sampleLiveRtcStats(videoTrack, previousCounter).then(({ metrics, counter }) => {
        if (!active) return;
        previousCounter = counter;
        callbacksRef.current.onMetrics({ ...metrics, droppedFrames: videoRef.current?.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0 });
      }).catch(() => undefined);
      if (audioTrack) void sampleLiveRtcStats(audioTrack, previousAudioCounter, "audio").then(({ metrics, counter }) => {
        if (!active) return;
        previousAudioCounter = counter;
        callbacksRef.current.onMetrics(metrics);
      }).catch(() => undefined);
    }, 2000);
    // Open the backup promptly, but keep the direct connection alive. The SDK's
    // own connection timeout can exceed eight seconds, especially on mobile.
    const backupTimer = window.setTimeout(() => {
      if (!active || firstFrameRef.current) return;
      fallback(!tokenReady ? "token" : !connected ? "connect" : "timeout");
    }, 8000);
    callbacksRef.current.onEvent("viewer_token_requested");
    void supabase.functions.invoke("live-control", { body: { action: "viewer-connect", liveId } })
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error || !data?.url || !data?.token) {
          callbacksRef.current.onEvent("viewer_token_failed");
          fallback("token");
          return;
        }
        tokenReady = true;
        callbacksRef.current.onMetrics({ viewerTokenMs: Math.round(performance.now() - startedAt) });
        callbacksRef.current.onEvent("viewer_token_ready");
        const connectingAt = performance.now();
        callbacksRef.current.onEvent("rtc_connect_started");
        await room.connect(data.url, data.token);
        if (!active) return;
        connected = true;
        callbacksRef.current.onMetrics({ roomConnectMs: Math.round(performance.now() - connectingAt) });
        callbacksRef.current.onEvent("rtc_connected");
      })
      .catch(() => {
        if (!active) return;
        callbacksRef.current.onEvent("rtc_connect_failed");
        fallback("connect");
      });
    return () => {
      active = false;
      window.clearTimeout(backupTimer);
      window.clearInterval(statsTimer);
      window.clearTimeout(departureTimer);
      room.removeAllListeners();
      void room.disconnect();
      if (roomRef.current === room) roomRef.current = null;
    };
  }, [liveId, creatorId]);

  const toggleAudio = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (muted || audioBlocked) {
      try {
        await roomRef.current?.startAudio();
        audio.muted = false;
        await audio.play();
        onMutedChange(false);
        setAudioBlocked(false);
      } catch { setAudioBlocked(true); callbacksRef.current.onEvent("audio_blocked"); }
    } else {
      audio.muted = true;
      onMutedChange(true);
    }
  };

  return <>
    <video ref={videoRef} autoPlay playsInline muted onPlaying={() => { if (!firstFrameRef.current) { firstFrameRef.current = true; callbacksRef.current.onFirstFrame(); callbacksRef.current.onReady(); } }} onWaiting={() => { if (firstFrameRef.current) callbacksRef.current.onStall(); }} className="absolute inset-0 h-full w-full object-contain" aria-label="Transmissão ao vivo" />
    <audio ref={audioRef} autoPlay muted />
    {ready && !standby && <Button type="button" size="sm" aria-label={muted ? "Ativar som" : "Silenciar"} className={compact ? "absolute bottom-1 right-1 z-10 h-7 w-7 rounded-full bg-black/75 p-1 text-white" : "absolute right-3 top-3 z-10 bg-black/75 text-white hover:bg-black/90"} onPointerDown={(event) => event.stopPropagation()} onClick={() => void toggleAudio()}>
      {muted ? <VolumeX className={compact ? "h-4 w-4" : "mr-2 h-4 w-4"} /> : <Volume2 className={compact ? "h-4 w-4" : "mr-2 h-4 w-4"} />}{!compact && (muted ? "Ativar som" : "Silenciar")}
    </Button>}
    {ready && !standby && audioBlocked && !compact && <button type="button" onClick={() => void toggleAudio()} className="absolute inset-x-4 bottom-4 z-10 rounded-lg bg-black/80 p-3 text-sm text-white">Toque para ativar o som</button>}
  </>;
}

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from "livekit-client";
import { Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { LiveDiagnosticMetrics, LiveDiagnosticReport } from "@/hooks/useLiveDiagnostics";
import { sampleLiveRtcStats } from "@/lib/liveRtcStats";

type Props = {
  liveId: string;
  creatorId: string;
  ending: boolean;
  onReady: () => void;
  onFallback: (reason: LiveDiagnosticReport["fallbackReason"]) => void;
  onComplete: () => void;
  onEvent: (type: string) => void;
  onMetrics: (metrics: LiveDiagnosticMetrics) => void;
  onQuality: (quality: LiveDiagnosticReport["quality"]) => void;
  onFirstFrame: () => void;
  onStall: () => void;
};

export function LiveRealtimePlayer({ liveId, creatorId, ending, onReady, onFallback, onComplete, onEvent, onMetrics, onQuality, onFirstFrame, onStall }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<Room | null>(null);
  const endingRef = useRef(ending);
  const callbacksRef = useRef({ onReady, onFallback, onComplete, onEvent, onMetrics, onQuality, onFirstFrame, onStall });
  const firstFrameRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => { endingRef.current = ending; }, [ending]);
  useEffect(() => { callbacksRef.current = { onReady, onFallback, onComplete, onEvent, onMetrics, onQuality, onFirstFrame, onStall }; }, [onReady, onFallback, onComplete, onEvent, onMetrics, onQuality, onFirstFrame, onStall]);

  useEffect(() => {
    let active = true;
    let receivedVideo = false;
    let departureTimer: number | undefined;
    let videoTrack: RemoteTrack | null = null;
    let audioTrack: RemoteTrack | null = null;
    let previousCounter: { bytes: number; at: number } | undefined;
    let previousAudioCounter: { bytes: number; at: number } | undefined;
    let reconnects = 0;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const attach = (track: RemoteTrack, participant: RemoteParticipant) => {
      if (participant.identity !== creatorId) return;
      if (track.kind === Track.Kind.Video && videoRef.current) {
        track.attach(videoRef.current);
        videoTrack = track;
        receivedVideo = true;
        setReady(true);
        callbacksRef.current.onReady();
        void videoRef.current.play().catch(() => undefined);
      }
      if (track.kind === Track.Kind.Audio && audioRef.current) {
        track.attach(audioRef.current);
        audioTrack = track;
        audioRef.current.muted = true;
        void audioRef.current.play().catch(() => { setAudioBlocked(true); callbacksRef.current.onEvent("audio_blocked"); });
      }
    };
    const finishOrFallback = () => {
      if (departureTimer) return;
      departureTimer = window.setTimeout(() => {
        if (!active) return;
        if (endingRef.current) callbacksRef.current.onComplete();
        else callbacksRef.current.onFallback("host_left");
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
      else callbacksRef.current.onFallback("room_left");
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
    const timer = window.setTimeout(() => {
      if (active && !receivedVideo) callbacksRef.current.onFallback("timeout");
    }, 8000);
    void supabase.functions.invoke("live-control", { body: { action: "viewer-connect", liveId } })
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error || !data?.url || !data?.token) {
          callbacksRef.current.onFallback("token");
          return;
        }
        const connectingAt = performance.now();
        await room.connect(data.url, data.token);
        callbacksRef.current.onMetrics({ roomConnectMs: Math.round(performance.now() - connectingAt) });
        callbacksRef.current.onEvent("rtc_connected");
      })
      .catch(() => { if (active) callbacksRef.current.onFallback("connect"); });
    return () => {
      active = false;
      window.clearTimeout(timer);
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
    if (muted) {
      try {
        await roomRef.current?.startAudio();
        audio.muted = false;
        await audio.play();
        setMuted(false);
        setAudioBlocked(false);
      } catch { setAudioBlocked(true); callbacksRef.current.onEvent("audio_blocked"); }
    } else {
      audio.muted = true;
      setMuted(true);
    }
  };

  return <>
    <video ref={videoRef} autoPlay playsInline muted onPlaying={() => { if (!firstFrameRef.current) { firstFrameRef.current = true; callbacksRef.current.onFirstFrame(); } }} onWaiting={() => { if (firstFrameRef.current) callbacksRef.current.onStall(); }} className="absolute inset-0 h-full w-full object-contain" aria-label="Transmissão ao vivo" />
    <audio ref={audioRef} autoPlay muted />
    {ready && <Button type="button" size="sm" className="absolute right-3 top-3 z-10 bg-black/75 text-white hover:bg-black/90" onClick={() => void toggleAudio()}>
      {muted ? <VolumeX className="mr-2 h-4 w-4" /> : <Volume2 className="mr-2 h-4 w-4" />}{muted ? "Ativar som" : "Silenciar"}
    </Button>}
    {ready && audioBlocked && <button type="button" onClick={() => void toggleAudio()} className="absolute inset-x-4 bottom-4 z-10 rounded-lg bg-black/80 p-3 text-sm text-white">Toque para ativar o som</button>}
  </>;
}

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from "livekit-client";
import { Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Props = {
  liveId: string;
  creatorId: string;
  ending: boolean;
  onReady: () => void;
  onFallback: () => void;
  onComplete: () => void;
};

export function LiveRealtimePlayer({ liveId, creatorId, ending, onReady, onFallback, onComplete }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<Room | null>(null);
  const endingRef = useRef(ending);
  const callbacksRef = useRef({ onReady, onFallback, onComplete });
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => { endingRef.current = ending; }, [ending]);
  useEffect(() => { callbacksRef.current = { onReady, onFallback, onComplete }; }, [onReady, onFallback, onComplete]);

  useEffect(() => {
    let active = true;
    let receivedVideo = false;
    let departureTimer: number | undefined;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const attach = (track: RemoteTrack, participant: RemoteParticipant) => {
      if (participant.identity !== creatorId) return;
      if (track.kind === Track.Kind.Video && videoRef.current) {
        track.attach(videoRef.current);
        receivedVideo = true;
        setReady(true);
        callbacksRef.current.onReady();
        void videoRef.current.play().catch(() => undefined);
      }
      if (track.kind === Track.Kind.Audio && audioRef.current) {
        track.attach(audioRef.current);
        audioRef.current.muted = true;
        void audioRef.current.play().catch(() => setAudioBlocked(true));
      }
    };
    const finishOrFallback = () => {
      if (departureTimer) return;
      departureTimer = window.setTimeout(() => {
        if (!active) return;
        if (endingRef.current) callbacksRef.current.onComplete();
        else callbacksRef.current.onFallback();
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
      finishOrFallback();
    });
    const timer = window.setTimeout(() => {
      if (active && !receivedVideo) callbacksRef.current.onFallback();
    }, 8000);
    void supabase.functions.invoke("live-control", { body: { action: "viewer-connect", liveId } })
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error || !data?.url || !data?.token) throw new Error("Sala indisponível");
        await room.connect(data.url, data.token);
      })
      .catch(() => { if (active) callbacksRef.current.onFallback(); });
    return () => {
      active = false;
      window.clearTimeout(timer);
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
      } catch { setAudioBlocked(true); }
    } else {
      audio.muted = true;
      setMuted(true);
    }
  };

  return <>
    <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-contain" aria-label="Transmissão ao vivo" />
    <audio ref={audioRef} autoPlay muted />
    {ready && <Button type="button" size="sm" className="absolute right-3 top-3 z-10 bg-black/75 text-white hover:bg-black/90" onClick={() => void toggleAudio()}>
      {muted ? <VolumeX className="mr-2 h-4 w-4" /> : <Volume2 className="mr-2 h-4 w-4" />}{muted ? "Ativar som" : "Silenciar"}
    </Button>}
    {ready && audioBlocked && <button type="button" onClick={() => void toggleAudio()} className="absolute inset-x-4 bottom-4 z-10 rounded-lg bg-black/80 p-3 text-sm text-white">Toque para ativar o som</button>}
  </>;
}

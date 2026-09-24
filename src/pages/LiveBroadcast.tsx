import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Room, RoomEvent } from "livekit-client";
import { Camera, Copy, Loader2, Mic, MicOff, Radio, RotateCw, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useLiveChat } from "@/hooks/useLiveChat";
import { useLiveViewers } from "@/hooks/useLiveViewers";
import { LiveChat } from "@/components/live/LiveChat";
import { Button } from "@/components/ui/button";
import { LiveDiagnosticsPanel } from "@/components/live/LiveDiagnosticsPanel";
import { useLiveDiagnostics } from "@/hooks/useLiveDiagnostics";
import { sampleLiveRtcStats } from "@/lib/liveRtcStats";

type Live = { id: string; creator_id: string; title: string; status: "waiting" | "live" | "ended" | "cancelled"; started_at: string | null; mux_live_stream_id: string | null; livekit_egress_id: string | null };

export default function LiveBroadcast() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [live, setLive] = useState<Live | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null);
  const [signalWaitStartedAt, setSignalWaitStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const roomRef = useRef<Room | null>(null);
  const preparedRef = useRef<{ room: Room; url: string; token: string; at: number } | null>(null);
  const statsTimerRef = useRef<number | null>(null);
  const startClickedAtRef = useRef<number | null>(null);
  const publicLiveMarkedRef = useRef(false);
  const bridgeStallMarkedRef = useRef(false);
  const previewRef = useRef<HTMLVideoElement>(null);
  const requestedPreviewRef = useRef<string | null>(null);
  const { stream, cameras, microphones, selectedCamera, selectedMicrophone, isLoading: mediaLoading, error: mediaError,
    isCameraOn, isMicOn, startStream, stopStream, toggleCamera, toggleMic, selectCamera, selectMicrophone } = useMediaDevices();
  const diagnostics = useLiveDiagnostics(id, "host", user?.id);
  const { mark, setRoute, setMetrics, setQuality, flush, recordChat } = diagnostics;
  const { messages, pinnedMessage, isLoading: chatLoading, isSending, sendMessage, deleteMessage, pinMessage, unpinMessage } = useLiveChat(id || null, recordChat);
  const { viewerCount } = useLiveViewers(id || null);

  useEffect(() => {
    if (!id || !user) return;
    let active = true;
    void supabase.from("lives").select("id, creator_id, title, status, started_at, mux_live_stream_id, livekit_egress_id").eq("id", id).single().then(({ data, error }) => {
      if (!active) return;
      if (error || !data || data.creator_id !== user.id) {
        toast.error("Transmissão indisponível para esta conta.");
        navigate("/studio/live");
        return;
      }
      setLive(data as Live);
      setLoading(false);
    });
    const channel = supabase.channel(`broadcast-status-${id}`).on("postgres_changes", {
      event: "UPDATE", schema: "public", table: "lives", filter: `id=eq.${id}`,
    }, (payload) => setLive(payload.new as Live)).subscribe();
    return () => { active = false; void supabase.removeChannel(channel); roomRef.current?.disconnect(); if (statsTimerRef.current) window.clearInterval(statsTimerRef.current); };
  }, [id, user, navigate]);

  useEffect(() => {
    if (!previewRef.current) return;
    previewRef.current.srcObject = stream;
  }, [stream]);
  useEffect(() => {
    if (!live?.mux_live_stream_id || live.status === "ended" || live.status === "cancelled" || requestedPreviewRef.current === live.id) return;
    requestedPreviewRef.current = live.id;
    void startStream();
  }, [live?.id, live?.mux_live_stream_id, live?.status, startStream]);
  useEffect(() => {
    if (!id || !live?.mux_live_stream_id || !stream || preparedRef.current || roomRef.current) return;
    let active = true;
    void supabase.functions.invoke("live-control", { body: { action: "connect", liveId: id } })
      .then(async ({ data, error }) => {
        if (!active || error || !data?.url || !data?.token) return;
        const room = new Room({ adaptiveStream: false, dynacast: true });
        preparedRef.current = { room, url: data.url, token: data.token, at: Date.now() };
        await room.prepareConnection(data.url, data.token).catch(() => undefined);
      });
    return () => { active = false; if (preparedRef.current && !roomRef.current) { void preparedRef.current.room.disconnect(); preparedRef.current = null; } };
  }, [id, live?.mux_live_stream_id, stream]);
  useEffect(() => {
    if (stream) mark("preview_ready");
  }, [stream, mark]);
  useEffect(() => {
    if (live?.status !== "live" || publicLiveMarkedRef.current) return;
    publicLiveMarkedRef.current = true;
    mark("public_live");
    if (startClickedAtRef.current !== null) setMetrics({ firstFrameMs: Math.round(performance.now() - startClickedAtRef.current) });
    void flush();
  }, [live?.status, mark, setMetrics, flush]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (live?.status === "waiting" && signalWaitStartedAt && now - signalWaitStartedAt >= 15000 && !bridgeStallMarkedRef.current) {
      bridgeStallMarkedRef.current = true;
      mark("bridge_stalled");
      void flush();
    }
  }, [live?.status, signalWaitStartedAt, now, mark, flush]);
  useEffect(() => {
    if (!id || !publishing || live?.status !== "waiting") return;
    const timer = window.setInterval(() => {
      void supabase.functions.invoke("live-control", { body: { action: "sync", liveId: id } })
        .then(({ data, error }) => {
          if (error || data?.status !== "live") return;
          void supabase.from("lives").select("id, creator_id, title, status, started_at, mux_live_stream_id, livekit_egress_id").eq("id", id).single()
            .then(({ data: refreshed }) => { if (refreshed) setLive(refreshed as Live); });
        });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [id, publishing, live?.status]);

  const begin = async () => {
    if (!id || !stream || starting || !live) return;
    let connectingRoom: Room | null = null;
    setStarting(true);
    startClickedAtRef.current = performance.now();
    mark("start_clicked");
    setNow(Date.now());
    setCountdownEndsAt(live.status === "waiting" ? Date.now() + 5000 : null);
    try {
      const prepared = preparedRef.current && Date.now() - preparedRef.current.at < 60 * 60 * 1000 ? preparedRef.current : null;
      if (prepared) preparedRef.current = null;
      if (!prepared && preparedRef.current) { void preparedRef.current.room.disconnect(); preparedRef.current = null; }
      const connection = prepared ?? await (async () => {
        const { data, error } = await supabase.functions.invoke("live-control", { body: { action: "connect", liveId: id } });
        if (error || !data?.url || !data?.token) throw new Error("Não foi possível abrir a sala");
        return { room: new Room({ adaptiveStream: false, dynacast: true }), url: data.url as string, token: data.token as string, at: Date.now() };
      })();
      const room = connection.room;
      connectingRoom = room;
      const connectingAt = performance.now();
      await room.connect(connection.url, connection.token);
      setMetrics({ roomConnectMs: Math.round(performance.now() - connectingAt), reconnects: 0 });
      mark("room_connected");
      roomRef.current = room;
      connectingRoom = null;
      let reconnects = 0;
      room.on(RoomEvent.Reconnecting, () => { reconnects += 1; setMetrics({ reconnects }); mark("reconnecting"); });
      room.on(RoomEvent.Reconnected, () => mark("reconnected"));
      room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (participant.identity === room.localParticipant.identity) setQuality(String(quality).toLowerCase() as "excellent" | "good" | "poor" | "lost" | "unknown");
      });
      const tracks = stream.getTracks().filter((track) => track.readyState === "live");
      if (!tracks.some((track) => track.kind === "video") || !tracks.some((track) => track.kind === "audio")) throw new Error("Câmera e microfone são necessários");
      for (const track of tracks) await room.localParticipant.publishTrack(track);
      mark("tracks_published");
      setRoute("webrtc");
      let previousCounter: { bytes: number; at: number } | undefined;
      let previousAudioCounter: { bytes: number; at: number } | undefined;
      if (statsTimerRef.current) window.clearInterval(statsTimerRef.current);
      statsTimerRef.current = window.setInterval(() => {
        const track = [...room.localParticipant.videoTrackPublications.values()][0]?.track;
        if (track) void sampleLiveRtcStats(track, previousCounter).then(({ metrics, counter }) => {
          previousCounter = counter;
          setMetrics(metrics);
        }).catch(() => undefined);
        const audioTrack = [...room.localParticipant.audioTrackPublications.values()][0]?.track;
        if (audioTrack) void sampleLiveRtcStats(audioTrack, previousAudioCounter, "audio").then(({ metrics, counter }) => {
          previousAudioCounter = counter;
          setMetrics(metrics);
        }).catch(() => undefined);
      }, 2000);
      setPublishing(true);
      if (live.status === "waiting") {
        const result = await supabase.functions.invoke("live-control", { body: { action: live.livekit_egress_id ? "restart" : "start", liveId: id } });
        if (result.error) throw result.error;
        setLive(previous => previous ? { ...previous, livekit_egress_id: result.data?.egressId ?? previous.livekit_egress_id } : previous);
        setSignalWaitStartedAt(Date.now());
        bridgeStallMarkedRef.current = false;
        mark("bridge_started");
      }
    } catch {
      void connectingRoom?.disconnect();
      roomRef.current?.disconnect();
      roomRef.current = null;
      if (statsTimerRef.current) { window.clearInterval(statsTimerRef.current); statsTimerRef.current = null; }
      setPublishing(false);
      setCountdownEndsAt(null);
      setRoute("waiting", "connect");
      toast.error("Não foi possível iniciar a transmissão. Confira a conexão e tente novamente.");
    } finally { setStarting(false); }
  };

  const retrySignal = async () => {
    if (!id || starting || !publishing || live?.status !== "waiting") return;
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("live-control", { body: { action: "restart", liveId: id } });
      if (error) throw error;
      setLive(previous => previous ? { ...previous, livekit_egress_id: data?.egressId ?? previous.livekit_egress_id } : previous);
      setSignalWaitStartedAt(Date.now());
      bridgeStallMarkedRef.current = false;
      mark("bridge_restarted");
      toast.info("Reconectando o sinal da live.");
    } catch { toast.error("Não foi possível reconectar. Encerre esta tentativa e crie outra live."); }
    finally { setStarting(false); }
  };

  const end = async () => {
    if (!id || ending) return;
    if (!window.confirm("Encerrar a live agora? A gravação ficará disponível após o processamento.")) return;
    setEnding(true);
    mark("end_requested");
    try {
      const { error } = await supabase.functions.invoke("live-control", { body: { action: "end", liveId: id } });
      if (error) throw error;
      mark("end_confirmed");
      setRoute("ended");
      await flush();
      roomRef.current?.disconnect();
      if (statsTimerRef.current) window.clearInterval(statsTimerRef.current);
      stopStream();
      toast.success("Transmissão encerrada. Aguarde a gravação no Studio.");
      navigate("/studio/live");
    } catch { toast.error("Não foi possível encerrar a live. Tente novamente."); }
    finally { setEnding(false); }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/live/${id}`);
    toast.success("Link da transmissão copiado.");
  };

  if (loading) return <div className="min-h-screen grid place-items-center bg-black text-white"><Loader2 className="animate-spin" /></div>;
  if (!live) return null;
  if (!live.mux_live_stream_id) return <main className="min-h-screen grid place-items-center bg-[#0c0d0f] p-6 text-white"><div className="max-w-md text-center space-y-4"><Radio className="mx-auto h-10 w-10 text-white/50" /><h1 className="text-2xl font-semibold">Esta live antiga não tem sinal de vídeo</h1><p className="text-white/60">Ela foi criada antes da transmissão pelo navegador. Prepare uma nova live no Studio para usar câmera e microfone.</p><Button onClick={() => navigate("/studio/live")}>Criar nova live</Button></div></main>;
  if (live.status === "ended" || live.status === "cancelled") return <main className="min-h-screen grid place-items-center bg-[#0c0d0f] p-6 text-white"><div className="max-w-md text-center space-y-4"><Radio className="mx-auto h-10 w-10 text-white/50" /><h1 className="text-2xl font-semibold">Transmissão encerrada</h1><p className="text-white/60">Confira a gravação no Studio quando ela estiver pronta.</p><Button onClick={() => navigate("/studio/live")}>Voltar ao Studio</Button></div></main>;
  const elapsed = live.started_at ? Math.max(0, Math.floor((now - new Date(live.started_at).getTime()) / 1000)) : 0;
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const countdown = countdownEndsAt && live.status === "waiting" ? Math.max(0, Math.ceil((countdownEndsAt - now) / 1000)) : 0;
  const showLiveIntro = live.status === "live" && live.started_at && now - new Date(live.started_at).getTime() < 3000;

  return <main className="min-h-screen bg-[#0c0d0f] text-white p-4 lg:p-6">
    <div className="max-w-7xl mx-auto grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3"><div><Link to="/studio/live" className="text-sm text-white/60 hover:text-white">← Voltar ao Studio</Link><h1 className="text-xl font-semibold mt-2">{live.title}</h1></div><div className="flex items-center gap-3"><span className="rounded-full bg-white/10 px-3 py-1 text-sm">{live.status === "live" ? `AO VIVO · ${timer}` : live.status === "waiting" ? "Preparando transmissão" : "Encerrada"}</span><span className="text-sm text-white/60">{viewerCount} assistindo</span></div></header>
        <div className="relative aspect-video min-h-[280px] rounded-2xl overflow-hidden bg-[#090a0c] border border-white/10 grid place-items-center">
          {stream ? <video ref={previewRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" /> : <div className="flex max-w-sm flex-col items-center px-6 text-center" role="status" aria-live="polite">
            <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-white/15 bg-white/[0.07]">{mediaLoading ? <Loader2 className="h-8 w-8 animate-spin text-white" /> : <Camera className="h-8 w-8 text-white/80" />}</div>
            <h2 className="text-xl font-semibold text-white">{mediaLoading ? "Preparando sua prévia" : mediaError ? "Câmera e microfone não disponíveis" : "Prepare sua câmera e microfone"}</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{mediaLoading ? "Autorize o acesso na janela do navegador para ver e ouvir seus dispositivos antes de entrar ao vivo." : mediaError ? "Verifique a permissão de câmera e microfone deste site no navegador. Depois, tente novamente." : "A prévia é privada. Seus espectadores só verão a transmissão depois que você clicar em Iniciar live."}</p>
            {!mediaLoading && <Button className="mt-6 bg-white text-[#111] hover:bg-white/90" onClick={() => void startStream()}>{mediaError ? <RotateCw className="mr-2 h-4 w-4" /> : <Camera className="mr-2 h-4 w-4" />}{mediaError ? "Tentar novamente" : "Ativar câmera e microfone"}</Button>}
          </div>}
          {stream && live.status !== "live" && <span className="absolute left-4 top-4 rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">Prévia privada · ainda não está ao vivo</span>}
          {live.status === "live" && <span className="absolute top-4 left-4 rounded-full bg-red-600 px-3 py-1 text-xs font-bold tracking-wide">AO VIVO</span>}
          {stream && !isCameraOn && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 text-white/70"><VideoOff className="h-9 w-9" /><span>Câmera desligada</span></div>}
          {stream && countdown > 0 && <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/55" aria-live="polite"><span className="text-[clamp(5rem,18vw,10rem)] font-bold leading-none tabular-nums text-white">{countdown}</span><span className="mt-3 text-sm font-medium text-white/80">Preparando a transmissão</span></div>}
          {stream && countdown === 0 && live.status === "waiting" && (starting || publishing) && <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/45 px-5 text-center backdrop-blur-[2px]"><Loader2 className="h-9 w-9 animate-spin text-white" /><span className="text-lg font-semibold text-white">Preparando sua live</span><span className="max-w-sm text-sm text-white/80">Sua câmera está pronta. Estamos abrindo a transmissão para o público.</span></div>}
          {showLiveIntro && <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/35"><span className="rounded-2xl bg-red-600 px-7 py-4 text-3xl font-bold tracking-wide text-white shadow-xl">AO VIVO</span></div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stream && !publishing && <Button disabled={starting || !isCameraOn || !isMicOn} onClick={() => void begin()}><Radio className="w-4 h-4 mr-2" />{starting ? "Conectando..." : live.status === "live" ? "Retomar transmissão" : "Iniciar live"}</Button>}
          {publishing && <span className="text-sm text-white/70">{live.status === "live" ? "Seu sinal está no ar" : "Preparando a transmissão para o público..."}</span>}
          {publishing && live.status === "waiting" && signalWaitStartedAt && now - signalWaitStartedAt > 15000 && <Button variant="outline" disabled={starting} className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={() => void retrySignal()}>{starting ? "Reconectando..." : "Reconectar sinal"}</Button>}
          {stream && <Button variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={toggleCamera} aria-label={isCameraOn ? "Desligar câmera" : "Ligar câmera"}>{isCameraOn ? <Camera className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}</Button>}
          {stream && <Button variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={toggleMic} aria-label={isMicOn ? "Desligar microfone" : "Ligar microfone"}>{isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}</Button>}
          <Button variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={() => void copyLink()}><Copy className="w-4 h-4 mr-2" /> Copiar link</Button>
          <Button variant="destructive" disabled={ending} onClick={() => void end()}>{ending ? "Encerrando..." : "Encerrar live"}</Button>
        </div>
        <LiveDiagnosticsPanel report={diagnostics.report} lastSavedAt={diagnostics.lastSavedAt} saveError={diagnostics.saveError} dark />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm text-white/70">Câmera
            <select value={selectedCamera ?? ""} disabled={!cameras.length || publishing || mediaLoading} onChange={(event) => void selectCamera(event.target.value)} className="w-full rounded-lg border border-white/20 bg-[#1c1e22] px-3 py-2 text-white disabled:opacity-60">
              <option value="">{stream ? "Selecione uma câmera" : "Ative a câmera para listar dispositivos"}</option>
              {cameras.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Câmera ${index + 1}`}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm text-white/70">Microfone
            <select value={selectedMicrophone ?? ""} disabled={!microphones.length || publishing || mediaLoading} onChange={(event) => void selectMicrophone(event.target.value)} className="w-full rounded-lg border border-white/20 bg-[#1c1e22] px-3 py-2 text-white disabled:opacity-60">
              <option value="">{stream ? "Selecione um microfone" : "Ative o microfone para listar dispositivos"}</option>
              {microphones.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>)}
            </select>
          </label>
        </div>
        {mediaError && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">Não foi possível acessar câmera ou microfone: {mediaError}. Verifique a permissão do site no navegador e tente novamente.</p>}
        {publishing && <p className="text-xs text-white/50">Para trocar de dispositivo durante a transmissão, encerre esta live e crie outra.</p>}
        <p className="text-sm text-white/50">O indicador “Ao vivo” aparece quando o público já pode assistir. A gravação é enviada para revisão após o encerramento.</p>
      </div>
      <div className="h-[70vh] min-h-[420px] overflow-hidden"><LiveChat messages={messages} pinnedMessage={pinnedMessage} isLoading={chatLoading} isSending={isSending} onSendMessage={sendMessage} onDeleteMessage={deleteMessage} onPinMessage={pinMessage} onUnpinMessage={unpinMessage} isCreator className="h-full" /></div>
    </div>
  </main>;
}

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Room, RoomEvent } from "livekit-client";
import { ArrowLeft, Bell, Camera, Copy, Loader2, MessageCircle, Mic, MicOff, Radio, RotateCw, Users, VideoOff, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useLiveChat } from "@/hooks/useLiveChat";
import { useLiveViewers } from "@/hooks/useLiveViewers";
import { LiveChat } from "@/components/live/LiveChat";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { LiveDiagnosticsPanel } from "@/components/live/LiveDiagnosticsPanel";
import { LiveLoadingScreen } from "@/components/live/LiveLoadingScreen";
import { useLiveDiagnostics } from "@/hooks/useLiveDiagnostics";
import { sampleLiveRtcStats } from "@/lib/liveRtcStats";
import "@/styles/live-broadcast.css";

type Live = { id: string; creator_id: string; title: string; status: "waiting" | "live" | "ended" | "cancelled"; started_at: string | null; mux_live_stream_id: string | null; livekit_egress_id: string | null; chat_enabled: boolean | null; followers_notified_at: string | null };

export default function LiveBroadcast() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [live, setLive] = useState<Live | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [togglingChat, setTogglingChat] = useState(false);
  const [notifyingFollowers, setNotifyingFollowers] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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
    void supabase.from("lives").select("id, creator_id, title, status, started_at, mux_live_stream_id, livekit_egress_id, chat_enabled, followers_notified_at").eq("id", id).single().then(({ data, error }) => {
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
          void supabase.from("lives").select("id, creator_id, title, status, started_at, mux_live_stream_id, livekit_egress_id, chat_enabled, followers_notified_at").eq("id", id).single()
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

  const toggleChat = async () => {
    if (!id || !live || togglingChat) return;
    setTogglingChat(true);
    try {
      const enabled = live.chat_enabled === false;
      const { data, error } = await supabase.functions.invoke("live-control", { body: { action: "set-chat", liveId: id, enabled } });
      if (error || typeof data?.chatEnabled !== "boolean") throw error ?? new Error("Chat unavailable");
      setLive(previous => previous ? { ...previous, chat_enabled: data.chatEnabled } : previous);
      toast.success(data.chatEnabled ? "Chat ativado." : "Chat desativado.");
    } catch { toast.error("Não foi possível alterar o chat."); }
    finally { setTogglingChat(false); }
  };

  const notifyFollowers = async () => {
    if (!id || live?.status !== "live" || live.followers_notified_at || notifyingFollowers) return;
    setNotifyingFollowers(true);
    try {
      const { data, error } = await supabase.functions.invoke("live-control", { body: { action: "notify-followers", liveId: id } });
      if (error || typeof data?.notifiedCount !== "number") throw error ?? new Error("Notification unavailable");
      setLive(previous => previous ? { ...previous, followers_notified_at: new Date().toISOString() } : previous);
      toast.success(data.alreadyNotified ? "Seus seguidores já foram avisados." : data.notifiedCount ? `${data.notifiedCount} seguidores avisados.` : "Nenhum seguidor para avisar ainda.");
    } catch { toast.error("Não foi possível avisar seus seguidores. Tente novamente."); }
    finally { setNotifyingFollowers(false); }
  };

  if (loading) return <LiveLoadingScreen title="Abrindo a transmissão" description="Preparando seu espaço antes de entrar ao vivo." dark />;
  if (!live) return null;
  if (!live.mux_live_stream_id) return <main className="min-h-screen grid place-items-center bg-[#0c0d0f] p-6 text-white"><div className="max-w-md text-center space-y-4"><Radio className="mx-auto h-10 w-10 text-white/50" /><h1 className="text-2xl font-semibold">Esta live antiga não tem sinal de vídeo</h1><p className="text-white/60">Ela foi criada antes da transmissão pelo navegador. Prepare uma nova live no Studio para usar câmera e microfone.</p><Button onClick={() => navigate("/studio/live")}>Criar nova live</Button></div></main>;
  if (live.status === "ended" || live.status === "cancelled") return <main className="min-h-screen grid place-items-center bg-[#0c0d0f] p-6 text-white"><div className="max-w-md text-center space-y-4"><Radio className="mx-auto h-10 w-10 text-white/50" /><h1 className="text-2xl font-semibold">Transmissão encerrada</h1><p className="text-white/60">Confira a gravação no Studio quando ela estiver pronta.</p><Button onClick={() => navigate("/studio/live")}>Voltar ao Studio</Button></div></main>;
  const elapsed = live.started_at ? Math.max(0, Math.floor((now - new Date(live.started_at).getTime()) / 1000)) : 0;
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const countdown = countdownEndsAt && live.status === "waiting" ? Math.max(0, Math.ceil((countdownEndsAt - now) / 1000)) : 0;
  const showLiveIntro = live.status === "live" && live.started_at && now - new Date(live.started_at).getTime() < 3000;

  const isWaiting = live.status === "waiting";
  const isConnecting = isWaiting && (starting || publishing);
  const chat = <LiveChat messages={messages} pinnedMessage={pinnedMessage} isLoading={chatLoading} isSending={isSending} onSendMessage={sendMessage} onDeleteMessage={deleteMessage} onPinMessage={pinMessage} onUnpinMessage={unpinMessage} isCreator chatEnabled={live.chat_enabled !== false} isTogglingChat={togglingChat} onToggleChat={() => void toggleChat()} className="live-broadcast__chat-inner" />;

  return <main className="live-broadcast" data-chat-open={chatOpen}>
    <div className="live-broadcast__stage" aria-hidden="true">
      {stream && <video ref={previewRef} autoPlay muted playsInline className="live-broadcast__video" />}
      {(!stream || !isCameraOn) && <div className="live-broadcast__camera-off"><VideoOff aria-hidden="true" /><span>{mediaLoading ? "Preparando a câmera" : "Câmera desligada"}</span></div>}
    </div>
    <div className="live-broadcast__shade" aria-hidden="true" />

    <header className="live-broadcast__header">
      <div className="live-broadcast__identity">
        <Link to="/studio/live" className="live-broadcast__back"><ArrowLeft aria-hidden="true" /> Studio</Link>
        <div className="live-broadcast__title"><span className="live-broadcast__brand">CLASSFY LIVE</span><h1>{live.title}</h1></div>
      </div>
      <div className="live-broadcast__telemetry">
        <span className={`live-broadcast__chip ${live.status === "live" ? "live-broadcast__chip--live" : ""}`}><span className="live-broadcast__status-dot" />{live.status === "live" ? `AO VIVO · ${timer}` : "Preview"}</span>
        <span className="live-broadcast__chip"><Users aria-hidden="true" />{viewerCount} assistindo</span>
      </div>
    </header>

    <div className="live-broadcast__diagnostics"><LiveDiagnosticsPanel report={diagnostics.report} lastSavedAt={diagnostics.lastSavedAt} saveError={diagnostics.saveError} dark /></div>

    {isWaiting && !isConnecting && <section className="live-broadcast__setup" aria-labelledby="live-setup-title">
      <span className="live-broadcast__setup-eyebrow"><span className="live-broadcast__status-dot" /> ANTES DE ENTRAR AO VIVO</span>
      <h2 id="live-setup-title">Seu espaço está pronto.</h2>
      <p>Confira imagem e som. A prévia é só sua até você iniciar a transmissão.</p>
      {!stream && <div className="live-broadcast__permission" role="status" aria-live="polite">
        <Camera aria-hidden="true" />
        <span>{mediaLoading ? "Autorize câmera e microfone no navegador para ver sua prévia." : mediaError ? "Não conseguimos acessar seus dispositivos." : "Ative câmera e microfone para começar."}</span>
        {!mediaLoading && <button type="button" onClick={() => void startStream()}>{mediaError ? <RotateCw aria-hidden="true" /> : <Camera aria-hidden="true" />}{mediaError ? "Tentar novamente" : "Ativar dispositivos"}</button>}
      </div>}
      <div className="live-broadcast__devices">
        <label><span><Camera aria-hidden="true" /> Câmera</span>
          <select value={selectedCamera ?? ""} disabled={!cameras.length || publishing || mediaLoading} onChange={(event) => void selectCamera(event.target.value)}>
            <option value="">{stream ? "Selecione uma câmera" : "Aguardando câmera"}</option>
            {cameras.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Câmera ${index + 1}`}</option>)}
          </select>
        </label>
        <label><span><Mic aria-hidden="true" /> Microfone</span>
          <select value={selectedMicrophone ?? ""} disabled={!microphones.length || publishing || mediaLoading} onChange={(event) => void selectMicrophone(event.target.value)}>
            <option value="">{stream ? "Selecione um microfone" : "Aguardando microfone"}</option>
            {microphones.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>)}
          </select>
        </label>
      </div>
      {mediaError && <p role="alert" className="live-broadcast__device-error">Verifique a permissão de câmera e microfone deste site no navegador e tente novamente.</p>}
      <span className="live-broadcast__setup-note">A transmissão só aparece ao público quando o sinal estiver confirmado.</span>
    </section>}

    {stream && countdown > 0 && <div className="live-broadcast__transition" aria-live="polite"><strong>{countdown}</strong><span>Preparando sua transmissão</span></div>}
    {stream && countdown === 0 && isConnecting && <div className="live-broadcast__transition" role="status"><Loader2 className="live-broadcast__spinner" aria-hidden="true" /><strong>Estamos abrindo sua live</strong><span>Sua câmera está pronta. Em instantes o público poderá assistir.</span></div>}
    {showLiveIntro && <div className="live-broadcast__transition live-broadcast__transition--live"><strong>AO VIVO</strong></div>}

    <aside className="live-broadcast__chat" aria-label="Chat ao vivo">
      <button type="button" className="live-broadcast__chat-close" onClick={() => setChatOpen(false)} aria-label="Fechar chat"><X aria-hidden="true" /></button>
      {chat}
    </aside>

    <div className="live-broadcast__dock-wrap"><div className="live-broadcast__dock" role="toolbar" aria-label="Controles da transmissão">
      {stream && !publishing && <button type="button" className="live-broadcast__start" disabled={starting || !isCameraOn || !isMicOn} onClick={() => void begin()}><Radio aria-hidden="true" />{starting ? "Conectando..." : live.status === "live" ? "Retomar live" : "Iniciar live"}</button>}
      {publishing && <span className="live-broadcast__onair-note"><span className="live-broadcast__status-dot" />{live.status === "live" ? "Seu sinal está no ar" : "Preparando para o público"}</span>}
      {publishing && isWaiting && signalWaitStartedAt && now - signalWaitStartedAt > 15000 && <button type="button" className="live-broadcast__dock-action" disabled={starting} onClick={() => void retrySignal()}><RotateCw aria-hidden="true" />{starting ? "Reconectando" : "Reconectar"}</button>}
      {stream && <button type="button" className="live-broadcast__dock-action" data-off={!isCameraOn} onClick={toggleCamera} aria-label={isCameraOn ? "Desligar câmera" : "Ligar câmera"} title={isCameraOn ? "Desligar câmera" : "Ligar câmera"}>{isCameraOn ? <Camera aria-hidden="true" /> : <VideoOff aria-hidden="true" />}</button>}
      {stream && <button type="button" className="live-broadcast__dock-action" data-off={!isMicOn} onClick={toggleMic} aria-label={isMicOn ? "Desligar microfone" : "Ligar microfone"} title={isMicOn ? "Desligar microfone" : "Ligar microfone"}>{isMicOn ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}</button>}
      <button type="button" className="live-broadcast__dock-action live-broadcast__dock-copy" onClick={() => void copyLink()} aria-label="Copiar link da live" title="Copiar link"><Copy aria-hidden="true" /><span>Copiar link</span></button>
      <button type="button" className="live-broadcast__dock-action live-broadcast__dock-notify" disabled={live.status !== "live" || Boolean(live.followers_notified_at) || notifyingFollowers} onClick={() => void notifyFollowers()} aria-label={live.followers_notified_at ? "Seguidores avisados" : "Notificar seguidores"} title={live.status !== "live" ? "Disponível quando a live começar" : live.followers_notified_at ? "Seguidores avisados" : "Notificar seguidores"}><Bell aria-hidden="true" /><span>{live.followers_notified_at ? "Seguidores avisados" : notifyingFollowers ? "Avisando..." : "Notificar seguidores"}</span></button>
      <button type="button" className="live-broadcast__dock-action live-broadcast__dock-chat" onClick={() => setChatOpen((open) => !open)} aria-label={chatOpen ? "Fechar chat" : "Abrir chat"} aria-expanded={chatOpen}><MessageCircle aria-hidden="true" /></button>
      <span className="live-broadcast__dock-divider" aria-hidden="true" />
      <button type="button" className="live-broadcast__end" data-live={live.status === "live"} disabled={ending} onClick={() => setEndConfirmOpen(true)}>{ending ? "Encerrando..." : "Encerrar"}</button>
    </div></div>
    <AlertDialog open={endConfirmOpen} onOpenChange={(open) => { if (!ending) setEndConfirmOpen(open); }}>
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md rounded-2xl border-white/15 bg-[#15171e] p-7 text-white shadow-2xl" overlayClassName="bg-black/65 backdrop-blur-sm">
        <AlertDialogHeader className="text-left">
          <span className="mb-2 inline-flex w-fit items-center gap-2 rounded-full border border-[#e74660]/30 bg-[#e74660]/10 px-3 py-1 text-xs font-semibold text-[#ff8395]"><Radio className="h-3.5 w-3.5" /> CLASSFY LIVE</span>
          <AlertDialogTitle className="text-2xl tracking-tight text-white">Encerrar transmissão?</AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed text-white/60">A live terminará para todos. A gravação ficará disponível no Studio após o processamento.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4 gap-2 sm:gap-0">
          <AlertDialogCancel disabled={ending} className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white">Continuar ao vivo</AlertDialogCancel>
          <AlertDialogAction disabled={ending} onClick={(event) => { event.preventDefault(); void end(); }} className="rounded-full bg-[#e74660] text-white hover:bg-[#f45c72]">{ending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Encerrando...</> : "Encerrar live"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>;
}

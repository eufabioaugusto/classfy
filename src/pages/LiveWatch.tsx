import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveChat, LiveGift } from "@/hooks/useLiveChat";
import { useLiveViewers } from "@/hooks/useLiveViewers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Users, Radio, Loader2, Volume2, VolumeX, Play } from "lucide-react";
import { LiveChat } from "@/components/live/LiveChat";
import { LiveRealtimePlayer } from "@/components/live/LiveRealtimePlayer";
import { LiveDiagnosticsPanel } from "@/components/live/LiveDiagnosticsPanel";
import { LiveGiftPanel } from "@/components/live/LiveGiftPanel";
import { FollowButton } from "@/components/FollowButton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLiveDiagnostics } from "@/hooks/useLiveDiagnostics";

interface Live {
  id: string;
  title: string;
  description: string | null;
  status: string;
  started_at: string | null;
  viewer_count: number;
  creator_id: string;
  mux_live_stream_id?: string | null;
  replay_published_at?: string | null;
  creator?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export default function LiveWatch() {
  const { id } = useParams();
  const { user } = useAuth();
  const [live, setLive] = useState<Live | null>(null);
  const [gifts, setGifts] = useState<LiveGift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showGifts, setShowGifts] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState("");
  const [playbackError, setPlaybackError] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playBlocked, setPlayBlocked] = useState(false);
  const [realtimeState, setRealtimeState] = useState<"connecting" | "playing" | "failed">("connecting");
  const [playbackIsLive, setPlaybackIsLive] = useState(false);
  const [tailComplete, setTailComplete] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestedPlaybackRef = useRef("");
  const viewerLiveAtRef = useRef<number | null>(null);
  const firstFrameRef = useRef(false);
  const diagnostics = useLiveDiagnostics(id, "viewer", user?.id);
  const { mark, setRoute, setMetrics, setQuality, flush, recordChat, recordStall } = diagnostics;

  const { messages, pinnedMessage, isLoading: chatLoading, isSending, sendMessage } = useLiveChat(id || null, recordChat);
  const { viewerCount, joinLive, leaveLive } = useLiveViewers(id || null);

  // Fetch live data
  useEffect(() => {
    if (!id) return;

    const fetchLive = async () => {
      const { data, error } = await supabase
        .from("lives")
        .select(`*, creator:profiles!creator_id(id, display_name, avatar_url)`)
        .eq("id", id)
        .single();

      if (error || !data) {
        toast.error("Live não encontrada");
        setIsLoading(false);
        return;
      }

      setLive(data);
      setIsLoading(false);

      // Fetch gifts
      const { data: giftsData } = await supabase
        .from("live_gifts")
        .select("*")
        .eq("active", true)
        .order("order_index");

      setGifts(giftsData || []);
    };

    fetchLive();

    // Join as viewer
    if (user) {
      joinLive();
    }

    return () => {
      if (user) {
        leaveLive();
      }
    };
  }, [id, user]);

  // Subscribe to live status changes
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`live-status-${id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "lives",
        filter: `id=eq.${id}`,
      }, (payload) => {
        if (payload.new.status === "ended") {
          toast.info("A live foi encerrada");
        }
        setLive(prev => prev ? { ...prev, ...payload.new } : null);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  useEffect(() => {
    if (!id || (live?.status !== "waiting" && live?.status !== "live")) return;
    const timer = window.setInterval(() => {
      void supabase.from("lives").select("status, started_at, mux_live_stream_id, replay_published_at").eq("id", id).single()
        .then(({ data }) => { if (data) setLive(prev => prev ? { ...prev, ...data } : prev); });
    }, live.status === "waiting" ? 2000 : 5000);
    return () => window.clearInterval(timer);
  }, [id, live?.status]);

  useEffect(() => {
    if (live?.status === "live" && viewerLiveAtRef.current === null) {
      viewerLiveAtRef.current = performance.now();
      mark("viewer_live");
    }
    if ((live?.status === "ended" || live?.status === "cancelled") && !tailComplete) mark("ended");
  }, [live?.status, tailComplete, mark]);

  useEffect(() => {
    if (tailComplete && live?.status === "ended") {
      setRoute("ended");
      void flush();
    }
  }, [tailComplete, live?.status, setRoute, flush]);

  const markFirstFrame = (route: "webrtc" | "hls") => {
    if (firstFrameRef.current) return;
    firstFrameRef.current = true;
    setMetrics({ firstFrameMs: Math.round(performance.now() - (viewerLiveAtRef.current ?? performance.now())) });
    mark(route === "webrtc" ? "rtc_first_frame" : "hls_first_frame");
    void flush();
  };

  const handleSendGift = async (gift: LiveGift, quantity: number) => {
    toast.info("Presentes ainda não estão disponíveis. Nenhuma cobrança foi realizada.");
  };

  const draining = live?.status === "ended" && !tailComplete && (realtimeState === "playing" || (playbackIsLive && !!playbackUrl));
  useEffect(() => {
    if (draining) return;
    if (!live || !user || (live.status !== "live" && !live.replay_published_at) || (live.status === "live" && (realtimeState !== "failed" || !live.mux_live_stream_id))) {
      requestedPlaybackRef.current = "";
      setPlaybackUrl("");
      return;
    }
    const requestKey = `${live.id}:${live.status}:${live.replay_published_at ?? ""}:${playbackAttempt}`;
    if (requestedPlaybackRef.current === requestKey) return;
    requestedPlaybackRef.current = requestKey;
    setPlaybackError(false);
    void supabase.functions.invoke("live-control", { body: { action: "playback", liveId: live.id } })
      .then(({ data, error }) => {
        if (requestedPlaybackRef.current !== requestKey) return;
        if (error || !data?.url) { setPlaybackError(true); return; }
        setPlaybackIsLive(live.status === "live");
        setPlaybackUrl(data.url);
      });
  }, [live, user, playbackAttempt, realtimeState, draining]);

  useEffect(() => {
    if (!draining) return;
    // Leave room for buffered HLS segments if the viewer had to use the backup player.
    const timer = window.setTimeout(() => setTailComplete(true), realtimeState === "playing" ? 5000 : 18000);
    return () => window.clearTimeout(timer);
  }, [draining, realtimeState]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackUrl) return;
    let active = true;
    let hls: import("hls.js").default | null = null;
    const tryPlay = () => {
      if (!playbackIsLive) return;
      void video.play().then(() => setPlayBlocked(false)).catch(() => setPlayBlocked(true));
    };
    void import("hls.js").then(({ default: Hls }) => {
      if (!active) return;
      if (Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: true });
        hls.loadSource(playbackUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, tryPlay);
        hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) { setPlaybackError(true); setRoute("hls", "hls_error"); } });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.addEventListener("canplay", tryPlay);
        video.src = playbackUrl;
      } else setPlaybackError(true);
    });
    const statsTimer = window.setInterval(() => {
      const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : video.currentTime;
      setMetrics({
        bufferSeconds: Math.max(0, end - video.currentTime),
        playbackLatencySeconds: hls?.latency && Number.isFinite(hls.latency) ? hls.latency : undefined,
        droppedFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0,
      });
    }, 2000);
    return () => { active = false; window.clearInterval(statsTimer); hls?.destroy(); video.removeEventListener("canplay", tryPlay); video.removeAttribute("src"); video.load(); };
  }, [playbackUrl, playbackAttempt, playbackIsLive, setMetrics, setRoute]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!live) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 text-center">
          <Radio className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-bold mb-2">Live não encontrada</h2>
          <p className="text-muted-foreground mb-4">Esta transmissão pode ter sido encerrada.</p>
          <Button asChild>
            <Link to="/">Voltar ao início</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const isLegacyLive = live.status === "live" && !live.mux_live_stream_id;
  const isEnded = live.status === "ended" || live.status === "cancelled" || isLegacyLive;
  const showRealtime = realtimeState !== "failed" && (live.status === "live" || draining);

  return (
    <div className="min-h-screen w-full min-w-0 overflow-x-hidden bg-background pb-24 flex flex-col lg:flex-row lg:pb-0">
      {/* Main Content */}
      <div className="min-w-0 flex-1 flex flex-col">
        {/* Video Area */}
        <div className="relative flex aspect-video w-full min-w-0 items-center justify-center overflow-hidden bg-black">
          {showRealtime ? (
            <>
              <LiveRealtimePlayer liveId={live.id} creatorId={live.creator_id} ending={live.status === "ended"} onReady={() => { setRealtimeState("playing"); setRoute("webrtc"); }} onFallback={(reason) => { setRoute("hls", reason); mark("fallback"); void flush(); setRealtimeState("failed"); }} onComplete={() => setTailComplete(true)} onEvent={mark} onMetrics={setMetrics} onQuality={setQuality} onFirstFrame={() => markFirstFrame("webrtc")} onStall={recordStall} />
              {realtimeState === "connecting" && <div className="absolute inset-0 grid place-items-center bg-black text-center text-white"><div><Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin" /><p>Preparando o vídeo ao vivo...</p></div></div>}
              {draining && <span className="absolute bottom-3 left-3 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">Reproduzindo os últimos segundos...</span>}
            </>
          ) : playbackUrl ? (
            <>
              <video ref={videoRef} controls playsInline autoPlay={playbackIsLive} muted={playbackIsLive && isMuted} onEnded={() => setTailComplete(true)} onPlaying={() => { setIsPlaying(true); setPlayBlocked(false); setPlaybackError(false); if (playbackIsLive) markFirstFrame("hls"); }} onWaiting={() => { if (firstFrameRef.current && playbackIsLive) recordStall(); }} onPause={() => setIsPlaying(false)} className="absolute inset-0 h-full w-full object-contain" aria-label={playbackIsLive ? "Transmissão ao vivo" : "Gravação da live"} />
              {playbackIsLive && <Button type="button" size="sm" className="absolute right-3 top-3 z-10 bg-black/75 text-white hover:bg-black/90" onClick={() => { const video = videoRef.current; if (!video) return; video.muted = !isMuted; setIsMuted(!isMuted); if (video.paused) void video.play().catch(() => setPlayBlocked(true)); }}>{isMuted ? <VolumeX className="mr-2 h-4 w-4" /> : <Volume2 className="mr-2 h-4 w-4" />}{isMuted ? "Ativar som" : "Silenciar"}</Button>}
              {draining && <span className="absolute bottom-3 left-3 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">Reproduzindo os últimos segundos...</span>}
              {playbackError && !isPlaying && <button type="button" onClick={() => { setPlaybackError(false); setPlaybackAttempt(value => value + 1); }} className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/75 px-5 text-center text-white"><Radio className="h-9 w-9" /><span className="font-semibold">O sinal ainda não carregou</span><span className="text-sm text-white/70">Toque para tentar novamente</span></button>}
              {live.status === "live" && playBlocked && !isPlaying && <button type="button" onClick={() => { const video = videoRef.current; if (video) void video.play().then(() => setPlayBlocked(false)).catch(() => setPlayBlocked(true)); }} className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/70 text-white"><Play className="h-10 w-10 fill-white" /><span className="font-semibold">Toque para assistir ao vivo</span></button>}
            </>
          ) : isEnded ? (
            <div className="text-center text-white">
              <Radio className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <h2 className="text-xl font-bold">{isLegacyLive ? "Transmissão indisponível" : live.replay_published_at ? "Carregando gravação" : "Transmissão encerrada"}</h2>
              <p className="text-muted-foreground mt-2">{isLegacyLive ? "Esta live foi criada antes da integração de vídeo." : playbackError ? "Não foi possível carregar o vídeo." : live.replay_published_at ? "Preparando o replay..." : "O replay aguarda publicação."}</p>
            </div>
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-accent/20 to-background flex items-center justify-center">
                <div className="text-center">
                  <Radio className="w-20 h-20 mx-auto mb-4 text-accent animate-pulse" />
                  <p className="text-lg">{live.status === "live" ? "Transmissão em andamento" : "Aguardando o início da live"}</p>
                  <p className="text-sm text-muted-foreground mt-1">{playbackError ? "O sinal está indisponível. Tente atualizar a página." : "Aguardando sinal de vídeo..."}</p>
                  {playbackError && <Button className="mt-4" onClick={() => { setPlaybackError(false); setPlaybackAttempt(value => value + 1); }}>Tentar novamente</Button>}
                </div>
              </div>
              
              {/* Live Badge */}
              {live.status === "live" && <div className="absolute top-4 left-4 flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive rounded-full text-white">
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  <span className="text-sm font-medium">AO VIVO</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-black/60 rounded-full text-white">
                  <Users className="w-4 h-4" />
                  <span className="text-sm">{viewerCount}</span>
                </div>
              </div>}
            </>
          )}
        </div>

        <div className="px-4 pt-3"><LiveDiagnosticsPanel report={diagnostics.report} lastSavedAt={diagnostics.lastSavedAt} saveError={diagnostics.saveError} /></div>

        {/* Info */}
        <div className="min-w-0 border-b p-4">
          <h1 className="break-words text-xl font-bold">{live.title}</h1>
          {live.description && (
            <p className="text-muted-foreground mt-1">{live.description}</p>
          )}

          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-3 sm:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar className="shrink-0">
                <AvatarImage src={live.creator?.avatar_url || ""} />
                <AvatarFallback>{live.creator?.display_name?.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="break-words font-medium">{live.creator?.display_name}</p>
              </div>
            </div>

            <div className="min-w-0 shrink-0">
              {live.creator && <FollowButton creatorId={live.creator.id} />}
            </div>
          </div>
        </div>

        {/* Gift Panel (Mobile) */}
        {showGifts && (
          <div className="lg:hidden border-b">
            <LiveGiftPanel gifts={gifts} isLoading={false} onSendGift={handleSendGift} />
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="flex w-full min-w-0 flex-col border-l lg:w-96 lg:shrink-0">
        {/* Gift Panel (Desktop) */}
        <div className="hidden lg:block border-b">
          <LiveGiftPanel gifts={gifts} isLoading={false} onSendGift={handleSendGift} />
        </div>

        {/* Chat */}
        <div className="flex-1 min-h-[400px] lg:min-h-0">
          <LiveChat
            messages={messages}
            pinnedMessage={pinnedMessage}
            isLoading={chatLoading}
            isSending={isSending}
            onSendMessage={sendMessage}
            isCreator={false}
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
}

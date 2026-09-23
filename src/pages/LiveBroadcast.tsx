import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Room } from "livekit-client";
import { Camera, Copy, Loader2, Mic, MicOff, Radio, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useLiveChat } from "@/hooks/useLiveChat";
import { useLiveViewers } from "@/hooks/useLiveViewers";
import { LiveChat } from "@/components/live/LiveChat";
import { Button } from "@/components/ui/button";

type Live = { id: string; creator_id: string; title: string; status: "waiting" | "live" | "ended" | "cancelled"; started_at: string | null };

export default function LiveBroadcast() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [live, setLive] = useState<Live | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const roomRef = useRef<Room | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const { stream, isCameraOn, isMicOn, startStream, stopStream, toggleCamera, toggleMic } = useMediaDevices();
  const { messages, pinnedMessage, isLoading: chatLoading, isSending, sendMessage, deleteMessage, pinMessage, unpinMessage } = useLiveChat(id || null);
  const { viewerCount } = useLiveViewers(id || null);

  useEffect(() => {
    if (!id || !user) return;
    let active = true;
    void supabase.from("lives").select("id, creator_id, title, status, started_at").eq("id", id).single().then(({ data, error }) => {
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
    return () => { active = false; void supabase.removeChannel(channel); roomRef.current?.disconnect(); };
  }, [id, user, navigate]);

  useEffect(() => {
    if (!previewRef.current) return;
    previewRef.current.srcObject = stream;
  }, [stream]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);

  const begin = async () => {
    if (!id || !stream || starting || !live) return;
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("live-control", { body: { action: "connect", liveId: id } });
      if (error || !data?.url || !data?.token) throw new Error("Não foi possível abrir a sala");
      const room = new Room({ adaptiveStream: false, dynacast: false });
      await room.connect(data.url, data.token);
      roomRef.current = room;
      const tracks = stream.getTracks().filter((track) => track.readyState === "live");
      if (!tracks.some((track) => track.kind === "video") || !tracks.some((track) => track.kind === "audio")) throw new Error("Câmera e microfone são necessários");
      for (const track of tracks) await room.localParticipant.publishTrack(track);
      setPublishing(true);
      if (live.status === "waiting") {
        const result = await supabase.functions.invoke("live-control", { body: { action: "start", liveId: id } });
        if (result.error) throw result.error;
      }
    } catch {
      roomRef.current?.disconnect();
      roomRef.current = null;
      setPublishing(false);
      toast.error("Não foi possível iniciar a transmissão. Confira a conexão e tente novamente.");
    } finally { setStarting(false); }
  };

  const end = async () => {
    if (!id || ending) return;
    if (!window.confirm("Encerrar a live agora? A gravação ficará disponível após o processamento.")) return;
    setEnding(true);
    try {
      const { error } = await supabase.functions.invoke("live-control", { body: { action: "end", liveId: id } });
      if (error) throw error;
      roomRef.current?.disconnect();
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
  const elapsed = live.started_at ? Math.max(0, Math.floor((now - new Date(live.started_at).getTime()) / 1000)) : 0;
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return <main className="min-h-screen bg-[#0c0d0f] text-white p-4 lg:p-6">
    <div className="max-w-7xl mx-auto grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3"><div><Link to="/studio/live" className="text-sm text-white/60 hover:text-white">← Voltar ao Studio</Link><h1 className="text-xl font-semibold mt-2">{live.title}</h1></div><div className="flex items-center gap-3"><span className="rounded-full bg-white/10 px-3 py-1 text-sm">{live.status === "live" ? `AO VIVO · ${timer}` : live.status === "waiting" ? "Preparando transmissão" : "Encerrada"}</span><span className="text-sm text-white/60">{viewerCount} assistindo</span></div></header>
        <div className="relative aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 grid place-items-center">
          {stream ? <video ref={previewRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" /> : <div className="text-center text-white/60"><Camera className="w-10 h-10 mx-auto mb-3" /><p>Ative sua câmera para ver a prévia.</p></div>}
          {live.status === "live" && <span className="absolute top-4 left-4 rounded-full bg-red-600 px-3 py-1 text-xs font-bold tracking-wide">AO VIVO</span>}
          {stream && !isCameraOn && <div className="absolute inset-0 bg-black/90 grid place-items-center"><VideoOff /><span>Câmera desligada</span></div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!stream && <Button onClick={() => void startStream()}><Camera className="w-4 h-4 mr-2" /> Ativar câmera e microfone</Button>}
          {stream && !publishing && <Button disabled={starting || !isCameraOn || !isMicOn} onClick={() => void begin()}><Radio className="w-4 h-4 mr-2" />{starting ? "Conectando..." : live.status === "live" ? "Retomar transmissão" : "Iniciar live"}</Button>}
          {publishing && <span className="text-sm text-white/70">{live.status === "live" ? "Seu sinal está no ar" : "Enviando sinal; aguardando confirmação do Mux..."}</span>}
          {stream && <Button variant="outline" onClick={toggleCamera}>{isCameraOn ? <Camera className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}</Button>}
          {stream && <Button variant="outline" onClick={toggleMic}>{isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}</Button>}
          <Button variant="outline" onClick={() => void copyLink()}><Copy className="w-4 h-4 mr-2" /> Copiar link</Button>
          <Button variant="destructive" disabled={ending} onClick={() => void end()}>{ending ? "Encerrando..." : "Encerrar live"}</Button>
        </div>
        <p className="text-sm text-white/50">O indicador “Ao vivo” aparece somente depois que o Mux confirma o sinal. A gravação é enviada para revisão após o encerramento.</p>
      </div>
      <div className="h-[70vh] min-h-[420px] overflow-hidden"><LiveChat messages={messages} pinnedMessage={pinnedMessage} isLoading={chatLoading} isSending={isSending} onSendMessage={sendMessage} onDeleteMessage={deleteMessage} onPinMessage={pinMessage} onUnpinMessage={unpinMessage} isCreator className="h-full" /></div>
    </div>
  </main>;
}

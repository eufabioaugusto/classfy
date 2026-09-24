import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Radio, Video, CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/layout";
import { CreatorTemplate } from "@/components/templates";
import { StudioNavigation } from "@/components/studio/StudioNavigation";
import { V2Badge, V2Button, V2Card, V2CardContent, V2CardHeader } from "@/components/v2";
import "@/styles/studio-v2.css";
import "@/styles/live-beta.css";

type StudioLiveRow = {
  id: string;
  title: string;
  status: "waiting" | "live" | "ended" | "cancelled";
  mux_live_stream_id: string | null;
  created_at: string;
  recording_ready_at: string | null;
  replay_content_id: string | null;
};

export default function StudioLive() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [lives, setLives] = useState<StudioLiveRow[]>([]);

  const loadLives = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.from("lives").select("*")
      .eq("creator_id", user.id).order("created_at", { ascending: false }).limit(20);
    if (error) toast.error("Não foi possível carregar suas lives.");
    else setLives((data || []) as unknown as StudioLiveRow[]);
  }, [user]);
  useEffect(() => { void loadLives(); }, [loadLives]);
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(`studio-lives-${user.id}`).on("postgres_changes", {
      event: "*", schema: "public", table: "lives", filter: `creator_id=eq.${user.id}`,
    }, () => { void loadLives(); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user, loadLives]);

  const createLive = async () => {
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("live-control", {
        body: { action: "create", title: title.trim(), description: description.trim() },
      });
      if (error || !data?.liveId) throw error || new Error("Transmissão não criada");
      navigate(`/live/${data.liveId}/broadcast`);
    } catch {
      toast.error("Não foi possível preparar a live. Confira a configuração Mux/LiveKit e o plano Mux.");
    } finally { setCreating(false); }
  };

  const publishReplay = async (liveId: string) => {
    setPublishingId(liveId);
    try {
      const { data, error } = await supabase.functions.invoke("live-control", { body: { action: "publish", liveId } });
      if (error || !data?.contentId) throw error || new Error("Falha ao enviar replay");
      toast.success("Gravação enviada para revisão. Ela ficará pública após aprovação.");
      await loadLives();
    } catch { toast.error("A gravação ainda não está pronta para publicação."); }
    finally { setPublishingId(null); }
  };

  if (loading) return <div className="cf-v2 studio-publish-loading"><strong>Preparando o Studio...</strong></div>;
  if (!user || (role !== "creator" && role !== "admin")) return <Navigate to="/" replace />;
  const openLive = lives.find((live) => live.mux_live_stream_id && (live.status === "waiting" || live.status === "live"));

  return <AppShell variant="studio" title="Transmissões ao vivo" contentClassName="studio-page-shell">
    <CreatorTemplate className="studio-template" width="wide" density="comfortable"
      header={<PageHeader title="Transmissões ao vivo" description="Apresente, converse e publique a gravação depois da live." action={<V2Badge variant="neutral">Beta</V2Badge>} />}
      toolbar={<StudioNavigation />}>
      <div className="live-beta-layout">
        <V2Card elevation="raised"><V2CardHeader><div className="studio-publish-heading"><span className="studio-icon"><Radio /></span><div><h2>{openLive ? "Sua transmissão está pronta" : "Nova transmissão"}</h2><p>Câmera e microfone são ativados na próxima etapa.</p></div></div></V2CardHeader>
          <V2CardContent>{openLive ? <div className="live-beta-open"><strong>{openLive.title}</strong><span>{openLive.status === "live" ? "Ao vivo" : "Aguardando início"}</span><V2Button onClick={() => navigate(`/live/${openLive.id}/broadcast`)}>Entrar na transmissão</V2Button></div> :
            <div className="live-beta-form"><label htmlFor="live-title">Título da live</label><input id="live-title" value={title} maxLength={150} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Apresentação do meu negócio" />
              <label htmlFor="live-description">Descrição <span>(opcional)</span></label><textarea id="live-description" value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} placeholder="Sobre o que vamos conversar?" rows={3} />
              <V2Button disabled={creating || title.trim().length < 3} onClick={() => void createLive()}>{creating ? <Loader2 className="animate-spin" /> : <Video />} Preparar live</V2Button></div>}</V2CardContent></V2Card>
        <V2Card elevation="panel"><V2CardHeader><div className="studio-publish-heading"><span className="studio-icon"><Clock3 /></span><div><h2>Suas gravações</h2><p>O Mux finaliza o vídeo após o encerramento.</p></div></div></V2CardHeader>
          <V2CardContent>{lives.length ? <div className="live-beta-list">{lives.map((live) => <div className="live-beta-row" key={live.id}><div><strong>{live.title}</strong><small>{new Date(live.created_at).toLocaleDateString("pt-BR")} · {!live.mux_live_stream_id ? "Registro antigo · sem transmissão" : live.status === "live" ? "Ao vivo" : live.status === "waiting" ? "Aguardando" : live.status === "cancelled" ? "Cancelada" : live.recording_ready_at ? "Gravação pronta" : "Processando gravação"}</small></div>
            {live.replay_content_id ? <span className="live-beta-done"><CheckCircle2 /> Em revisão</span> : live.status === "ended" && live.recording_ready_at ? <V2Button disabled={publishingId === live.id} onClick={() => void publishReplay(live.id)}>{publishingId === live.id ? "Enviando..." : "Enviar para revisão"}</V2Button> : null}</div>)}</div> : <p className="live-beta-empty">Você ainda não fez nenhuma live.</p>}</V2CardContent></V2Card>
      </div>
    </CreatorTemplate>
  </AppShell>;
}

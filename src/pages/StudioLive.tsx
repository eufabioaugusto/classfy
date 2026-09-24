import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Radio, Video, CheckCircle2, Clock3, Loader2, ArrowRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/layout";
import { CreatorTemplate } from "@/components/templates";
import { StudioNavigation } from "@/components/studio/StudioNavigation";
import { V2Badge, V2Button, V2Card, V2CardContent, V2CardHeader, V2ConfirmDialog } from "@/components/v2";
import "@/styles/studio-v2.css";
import "@/styles/live-beta.css";

type StudioLiveRow = {
  id: string;
  title: string;
  status: "waiting" | "live" | "ended" | "cancelled";
  mux_live_stream_id: string | null;
  playback_url: string | null;
  recording_url: string | null;
  livekit_egress_id: string | null;
  created_at: string;
  started_at: string | null;
  recording_ready_at: string | null;
  replay_content_id: string | null;
  replay_published_at: string | null;
};

function statusFor(live: StudioLiveRow) {
  if (live.replay_published_at) return { label: "Publicada", tone: "success" as const };
  if (live.replay_content_id) return { label: "Em revisão", tone: "neutral" as const };
  if (!live.mux_live_stream_id) return { label: "Registro antigo", tone: "neutral" as const };
  if (live.status === "live") return { label: "Ao vivo", tone: "accent" as const };
  if (live.status === "waiting") return { label: "Pronta para iniciar", tone: "warning" as const };
  if (live.status === "cancelled") return { label: "Cancelada", tone: "neutral" as const };
  if (live.recording_ready_at) return { label: "Gravação pronta", tone: "success" as const };
  return { label: "Preparando gravação", tone: "warning" as const };
}

export default function StudioLive() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<StudioLiveRow | null>(null);
  const [loadingLives, setLoadingLives] = useState(true);
  const [lives, setLives] = useState<StudioLiveRow[]>([]);

  const loadLives = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.from("lives")
      .select("id,title,status,mux_live_stream_id,playback_url,recording_url,livekit_egress_id,created_at,started_at,recording_ready_at,replay_content_id,replay_published_at")
      .eq("creator_id", user.id).order("created_at", { ascending: false }).limit(100);
    if (error) toast.error("Não foi possível carregar suas lives.");
    else setLives((data || []) as StudioLiveRow[]);
    setLoadingLives(false);
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
      toast.error("Não foi possível preparar a live agora. Tente novamente em instantes.");
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

  const discardLive = async () => {
    if (!discardTarget || discardingId) return;
    const liveId = discardTarget.id;
    setDiscardingId(liveId);
    try {
      const { data, error } = await supabase.functions.invoke("live-control", { body: { action: "discard", liveId } });
      if (error || !data?.discarded) throw error || new Error("Falha ao descartar");
      setDiscardTarget(null);
      setLives((current) => current.filter((live) => live.id !== liveId));
      toast.success("Live descartada. A gravação foi removida.");
      await loadLives();
    } catch {
      toast.error("Não foi possível descartar agora. Se a gravação ainda estiver processando, aguarde um pouco e tente novamente.");
      await loadLives();
    } finally { setDiscardingId(null); }
  };

  if (loading) return <div className="cf-v2 studio-publish-loading"><strong>Preparando o Studio...</strong></div>;
  if (!user || (role !== "creator" && role !== "admin")) return <Navigate to="/" replace />;
  const openLive = lives.find((live) => live.mux_live_stream_id && (live.status === "waiting" || live.status === "live"));
  const history = lives.filter((live) => live.id !== openLive?.id);
  const readyCount = history.filter((live) => live.status === "ended" && live.recording_ready_at && !live.replay_content_id).length;

  return <AppShell variant="studio" title="Transmissões ao vivo" contentClassName="studio-page-shell">
    <CreatorTemplate className="studio-template" width="wide" density="comfortable"
      header={<PageHeader eyebrow="Studio · Lives" title="Transmissões ao vivo" description="Entre ao vivo, converse com o público e escolha o destino da gravação depois." action={<V2Badge variant="accent">Beta</V2Badge>} />}
      toolbar={<StudioNavigation />}>
      <div className="live-studio">
        <section className="live-studio-intro" aria-label="Como funcionam as lives">
          <span className="live-studio-intro__icon"><Radio aria-hidden="true" /></span>
          <div><strong>Da câmera para o público. Da gravação para você decidir.</strong><p>Depois de encerrar, envie a gravação para revisão ou descarte a live e o vídeo.</p></div>
        </section>
        <div className="live-studio-grid">
          <V2Card className="live-studio-card live-studio-create">
            <V2CardHeader className="live-studio-card__header">
              <span className="live-studio-card__icon"><Video aria-hidden="true" /></span>
              <span className="live-studio-card__eyebrow">Comece por aqui</span>
              <h2>{openLive ? "Continue sua live" : "Nova transmissão"}</h2>
              <p>{openLive ? "Você já tem uma transmissão preparada." : "Defina o assunto. A câmera e o microfone serão preparados na próxima etapa."}</p>
            </V2CardHeader>
            <V2CardContent className="live-studio-card__body">
              {openLive ? <div className="live-studio-open">
                <V2Badge variant={openLive.status === "live" ? "accent" : "warning"}>{openLive.status === "live" ? "Ao vivo" : "Aguardando início"}</V2Badge>
                <strong>{openLive.title}</strong>
                <V2Button onClick={() => navigate(`/live/${openLive.id}/broadcast`)} trailingIcon={<ArrowRight aria-hidden="true" />}>Entrar na transmissão</V2Button>
                {openLive.status === "waiting" && !openLive.livekit_egress_id && <V2Button variant="quiet" size="sm" leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => setDiscardTarget(openLive)}>Descartar preparação</V2Button>}
              </div> : <div className="live-beta-form">
                <label htmlFor="live-title">Título da live</label>
                <input id="live-title" value={title} maxLength={150} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Apresentação do meu negócio" />
                <label htmlFor="live-description">Descrição <span>(opcional)</span></label>
                <textarea id="live-description" value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} placeholder="O que o público vai encontrar nessa live?" rows={3} />
                <V2Button disabled={creating || title.trim().length < 3} leadingIcon={creating ? <Loader2 className="animate-spin" /> : <Radio />} onClick={() => void createLive()}>{creating ? "Preparando..." : "Preparar live"}</V2Button>
              </div>}
            </V2CardContent>
          </V2Card>

          <V2Card className="live-studio-card live-studio-history">
            <V2CardHeader className="live-studio-card__header live-studio-card__header--compact">
              <div><span className="live-studio-card__eyebrow">Depois da transmissão</span><h2>Gravações e histórico</h2><p>{readyCount ? `${readyCount} ${readyCount === 1 ? "gravação pronta" : "gravações prontas"} para decidir.` : "Acompanhe o processamento e decida o que publicar."}</p></div>
              <Clock3 aria-hidden="true" className="live-studio-history__clock" />
            </V2CardHeader>
            <V2CardContent className="live-studio-history__body">
              {loadingLives ? <div className="live-studio-empty"><Loader2 className="animate-spin" /><p>Carregando suas lives...</p></div> : history.length ?
                <div className="live-studio-list">{history.map((live) => {
                  const status = statusFor(live);
                  const legacyWithoutMedia = !live.mux_live_stream_id && !live.recording_url && !live.playback_url;
                  const canDiscard = !live.replay_content_id && !live.replay_published_at && (legacyWithoutMedia || (Boolean(live.mux_live_stream_id) && (live.status === "ended" || live.status === "cancelled" || (live.status === "waiting" && !live.livekit_egress_id))));
                  return <article className="live-studio-row" key={live.id}>
                    <div className="live-studio-row__main"><div className="live-studio-row__title"><strong>{live.title}</strong><V2Badge variant={status.tone}>{status.label}</V2Badge></div><span>{new Date(live.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
                    <div className="live-studio-row__actions">
                      {live.replay_content_id ? <span className="live-studio-row__complete"><CheckCircle2 aria-hidden="true" /> {live.replay_published_at ? "No catálogo" : "Enviada"}</span> : live.status === "ended" && live.recording_ready_at ? <V2Button size="sm" disabled={Boolean(publishingId) || Boolean(discardingId)} onClick={() => void publishReplay(live.id)}>{publishingId === live.id ? "Enviando..." : "Enviar para revisão"}</V2Button> : null}
                      {canDiscard && <V2Button variant="quiet" size="sm" disabled={Boolean(publishingId) || Boolean(discardingId)} leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => setDiscardTarget(live)}>Descartar</V2Button>}
                    </div>
                  </article>;
                })}</div> : <div className="live-studio-empty"><Video aria-hidden="true" /><strong>Seu histórico começa na primeira live</strong><p>Depois da transmissão, a gravação e as opções de publicação aparecerão aqui.</p></div>}
            </V2CardContent>
            <footer className="live-studio-history__footer">Gravações não publicadas permanecem armazenadas até você enviar ou descartar.</footer>
          </V2Card>
        </div>
      </div>
    </CreatorTemplate>
    <V2ConfirmDialog open={Boolean(discardTarget)} onOpenChange={(open) => { if (!open) setDiscardTarget(null); }}
      title="Descartar esta live?" description="A gravação, o chat e o histórico desta transmissão serão removidos permanentemente. Esta ação não pode ser desfeita."
      summary={discardTarget?.title} items={["Remover a gravação armazenada", "Encerrar e remover os recursos da transmissão", "Apagar o registro desta live na Classfy"]}
      confirmLabel="Descartar live" workingLabel="Removendo..." isWorking={Boolean(discardingId)} onConfirm={discardLive} />
  </AppShell>;
}

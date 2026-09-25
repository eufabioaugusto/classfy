import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Radio, Video, CheckCircle2, Clock3, Loader2, ArrowRight, Trash2, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/layout";
import { CreatorTemplate } from "@/components/templates";
import { StudioNavigation } from "@/components/studio/StudioNavigation";
import { LiveLoadingScreen } from "@/components/live/LiveLoadingScreen";
import { CoverImageCropper } from "@/components/CoverImageCropper";
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
  thumbnail_url: string | null;
  created_at: string;
  started_at: string | null;
  recording_ready_at: string | null;
  replay_content_id: string | null;
  replay_published_at: string | null;
};

const MAX_LIVE_COVER_BYTES = 2 * 1024 * 1024;

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
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropTargetId, setCropTargetId] = useState<string | null>(null);
  const [updatingCover, setUpdatingCover] = useState(false);
  const [coverDragActive, setCoverDragActive] = useState(false);
  const coverDragDepthRef = useRef(0);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<StudioLiveRow | null>(null);
  const [loadingLives, setLoadingLives] = useState(true);
  const [lives, setLives] = useState<StudioLiveRow[]>([]);

  const loadLives = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.from("lives")
      .select("id,title,status,mux_live_stream_id,playback_url,recording_url,livekit_egress_id,thumbnail_url,created_at,started_at,recording_ready_at,replay_content_id,replay_published_at")
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
  useEffect(() => {
    if (!coverFile) { setCoverPreview(""); return; }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const uploadCover = async (file: File) => {
    if (!user) throw new Error("Faça login para enviar a capa.");
    if (file.size > MAX_LIVE_COVER_BYTES) throw new Error("A capa deve ter até 2 MB.");
    const path = `thumbnails/${user.id}/lives/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from("contents").upload(path, file, {
      contentType: "image/jpeg", cacheControl: "31536000", upsert: false,
    });
    if (error) throw error;
    return { path, url: supabase.storage.from("contents").getPublicUrl(path).data.publicUrl };
  };

  const chooseCover = (file: File | undefined, liveId: string | null) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_LIVE_COVER_BYTES) {
      toast.error("Escolha uma imagem JPG, PNG ou WebP de até 2 MB.");
      return;
    }
    setCropTargetId(liveId);
    setCropFile(file);
  };

  const handleCoverDrop = (event: DragEvent<HTMLDivElement>, liveId: string | null) => {
    event.preventDefault();
    coverDragDepthRef.current = 0;
    setCoverDragActive(false);
    if (creating || updatingCover) return;
    chooseCover(event.dataTransfer.files[0], liveId);
  };

  const handleCoverDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleCoverDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    coverDragDepthRef.current += 1;
    setCoverDragActive(true);
  };

  const handleCoverDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    coverDragDepthRef.current = Math.max(0, coverDragDepthRef.current - 1);
    if (!coverDragDepthRef.current) setCoverDragActive(false);
  };

  const confirmCover = async (file: File) => {
    if (!cropTargetId) {
      setCoverFile(file);
      setCropFile(null);
      return;
    }
    setUpdatingCover(true);
    let uploadedPath: string | null = null;
    try {
      const uploaded = await uploadCover(file);
      uploadedPath = uploaded.path;
      const { data, error } = await supabase.from("lives")
        .update({ thumbnail_url: uploaded.url })
        .eq("id", cropTargetId).eq("creator_id", user!.id).eq("status", "waiting")
        .select("id").maybeSingle();
      if (error || !data) throw error || new Error("A live não aceita mais alterações.");
      setCropFile(null);
      toast.success("Capa da live atualizada.");
      await loadLives();
    } catch {
      if (uploadedPath) await supabase.storage.from("contents").remove([uploadedPath]);
      toast.error("Não foi possível atualizar a capa. Tente novamente.");
    } finally { setUpdatingCover(false); }
  };

  const createLive = async () => {
    if (!title.trim() || !coverFile || creating) return;
    setCreating(true);
    let uploadedPath: string | null = null;
    let uploadedUrl: string | null = null;
    try {
      const uploaded = await uploadCover(coverFile);
      uploadedPath = uploaded.path;
      uploadedUrl = uploaded.url;
      const { data, error } = await supabase.functions.invoke("live-control", {
        body: { action: "create", title: title.trim(), description: description.trim(), thumbnailUrl: uploaded.url },
      });
      if (error || !data?.liveId) throw error || new Error("Transmissão não criada");
      navigate(`/live/${data.liveId}/broadcast`);
    } catch {
      if (uploadedPath && uploadedUrl) {
        const { data: existing, error: lookupError } = await supabase.from("lives")
          .select("id").eq("creator_id", user!.id).eq("thumbnail_url", uploadedUrl).maybeSingle();
        if (existing?.id) { navigate(`/live/${existing.id}/broadcast`); return; }
        if (!lookupError) await supabase.storage.from("contents").remove([uploadedPath]);
      }
      toast.error("Não foi possível preparar a live agora. Tente novamente em instantes.");
    } finally { setCreating(false); }
  };

  const publishReplay = async (liveId: string) => {
    setPublishingId(liveId);
    try {
      const { data, error } = await supabase.functions.invoke("live-control", { body: { action: "publish", liveId } });
      if (error || !data?.contentId) throw error || new Error("Falha ao enviar replay");
      toast.success("Gravação enviada para publicação. Ela aparecerá no catálogo após aprovação.");
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

  if (loading) return <LiveLoadingScreen title="Carregando suas lives" />;
  if (!user || (role !== "creator" && role !== "admin")) return <Navigate to="/" replace />;
  const openLive = lives.find((live) => live.mux_live_stream_id && (live.status === "waiting" || live.status === "live"));
  const history = lives.filter((live) => live.id !== openLive?.id);
  const readyCount = history.filter((live) => live.status === "ended" && live.recording_ready_at && !live.replay_content_id).length;

  return <AppShell variant="studio" title="Lives" contentClassName="studio-page-shell">
    <CreatorTemplate className="studio-template" width="wide" density="comfortable"
      header={<PageHeader eyebrow="Studio · Lives" title="Suas lives" description="Crie uma live, converse com seu público e publique a gravação depois." action={<V2Badge variant="accent">Beta</V2Badge>} />}
      toolbar={<StudioNavigation />}>
      <div className="live-studio">
        <section className="live-studio-intro" aria-label="Crie sua próxima live">
          <span className="live-studio-intro__icon"><Radio aria-hidden="true" /></span>
          <div><strong>Sua próxima live começa aqui</strong><p>Escolha um título e uma capa. Antes de entrar ao vivo, você poderá conferir tudo com calma.</p></div>
        </section>
        <div className="live-studio-grid">
          <V2Card className="live-studio-card live-studio-create">
            <V2CardHeader className="live-studio-card__header">
              <span className="live-studio-card__icon"><Video aria-hidden="true" /></span>
              <span className="live-studio-card__eyebrow">Comece por aqui</span>
              <h2>{openLive ? "Continue sua live" : "Criar uma live"}</h2>
              <p>{openLive ? "Sua live está pronta. Entre para começar quando quiser." : "Dê um nome à live e escolha uma capa para apresentá-la ao público."}</p>
            </V2CardHeader>
            <V2CardContent className="live-studio-card__body">
              {openLive ? <div className="live-studio-open">
                <V2Badge variant={openLive.status === "live" ? "accent" : "warning"}>{openLive.status === "live" ? "Ao vivo" : "Aguardando início"}</V2Badge>
                <strong>{openLive.title}</strong>
                {openLive.status === "waiting" && <div className={`live-studio-cover live-studio-cover--open ${coverDragActive ? "live-studio-cover--dragging" : ""}`} onDragEnter={handleCoverDragEnter} onDragOver={handleCoverDragOver} onDragLeave={handleCoverDragLeave} onDrop={(event) => handleCoverDrop(event, openLive.id)}>
                  {openLive.thumbnail_url && <img src={openLive.thumbnail_url} alt="Capa da live preparada" />}
                  <div className="live-studio-cover__content">
                    {!openLive.thumbnail_url && <span className="live-studio-cover__empty"><ImagePlus aria-hidden="true" /> Arraste uma capa para cá</span>}
                    <button type="button" disabled={updatingCover} onClick={() => { setCropTargetId(openLive.id); coverInputRef.current?.click(); }}>{openLive.thumbnail_url ? "Trocar capa" : "Adicionar capa"}</button>
                  </div>
                  {updatingCover && <span className="live-studio-cover__loading" role="status"><Loader2 className="animate-spin" aria-hidden="true" /> Enviando capa...</span>}
                </div>}
                <V2Button onClick={() => navigate(`/live/${openLive.id}/broadcast`)} trailingIcon={<ArrowRight aria-hidden="true" />}>Entrar na transmissão</V2Button>
                {openLive.status === "waiting" && !openLive.livekit_egress_id && <V2Button variant="quiet" size="sm" leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => setDiscardTarget(openLive)}>Descartar preparação</V2Button>}
              </div> : <div className="live-beta-form">
                <label htmlFor="live-title">Título da live</label>
                <input id="live-title" value={title} maxLength={150} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Apresentação do meu negócio" />
                <label htmlFor="live-description">Descrição <span>(opcional)</span></label>
                <textarea id="live-description" value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} placeholder="O que o público vai encontrar nessa live?" rows={3} />
                <label>Capa da live <span>· obrigatória · 16:9</span></label>
                <div className={`live-studio-cover ${coverDragActive ? "live-studio-cover--dragging" : ""}`} onDragEnter={handleCoverDragEnter} onDragOver={handleCoverDragOver} onDragLeave={handleCoverDragLeave} onDrop={(event) => handleCoverDrop(event, null)}>
                  {coverPreview && <img src={coverPreview} alt="Prévia da capa da live" />}
                  <div className="live-studio-cover__content">
                    {!coverPreview && <span className="live-studio-cover__empty"><ImagePlus aria-hidden="true" /> Arraste sua capa para cá</span>}
                    <button type="button" disabled={creating} onClick={() => { setCropTargetId(null); coverInputRef.current?.click(); }}>{coverPreview ? "Trocar imagem" : "Escolher imagem"}</button>
                  </div>
                  {creating && <span className="live-studio-cover__loading" role="status"><Loader2 className="animate-spin" aria-hidden="true" /> Enviando capa...</span>}
                </div>
                <p className="live-studio-cover__hint">JPG, PNG ou WebP · até 2 MB · proporção 16:9.</p>
                <V2Button disabled={creating || title.trim().length < 3 || !coverFile} leadingIcon={creating ? <Loader2 className="animate-spin" /> : <Radio />} onClick={() => void createLive()}>{creating ? "Preparando..." : "Preparar live"}</V2Button>
              </div>}
            </V2CardContent>
          </V2Card>

          <V2Card className="live-studio-card live-studio-history">
            <V2CardHeader className="live-studio-card__header live-studio-card__header--compact">
              <div><span className="live-studio-card__eyebrow">Depois da transmissão</span><h2>Gravações e histórico</h2><p>{readyCount ? `${readyCount} ${readyCount === 1 ? "gravação pronta" : "gravações prontas"} para publicar.` : "Suas lives encerradas aparecem aqui."}</p></div>
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
                      {live.replay_content_id ? <span className="live-studio-row__complete"><CheckCircle2 aria-hidden="true" /> {live.replay_published_at ? "No catálogo" : "Enviada"}</span> : live.status === "ended" && live.recording_ready_at ? <V2Button size="sm" disabled={Boolean(publishingId) || Boolean(discardingId)} onClick={() => void publishReplay(live.id)}>{publishingId === live.id ? "Enviando..." : "Publicar"}</V2Button> : null}
                      {canDiscard && <V2Button variant="quiet" size="icon" aria-label={`Descartar ${live.title}`} title="Descartar live" disabled={Boolean(publishingId) || Boolean(discardingId)} leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => setDiscardTarget(live)} />}
                    </div>
                  </article>;
                })}</div> : <div className="live-studio-empty"><Video aria-hidden="true" /><strong>Seu histórico começa na primeira live</strong><p>Depois da transmissão, a gravação e as opções de publicação aparecerão aqui.</p></div>}
            </V2CardContent>
            <footer className="live-studio-history__footer">Gravações não publicadas permanecem armazenadas até você enviar ou descartar.</footer>
          </V2Card>
        </div>
      </div>
    </CreatorTemplate>
    <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="live-studio-cover__input" aria-label="Selecionar capa da live" onChange={(event) => { chooseCover(event.target.files?.[0], cropTargetId); event.target.value = ""; }} />
    {cropFile && <div className="live-studio-cover-editor" role="dialog" aria-modal="true" aria-label="Ajustar capa da live"><div className="live-studio-cover-editor__content"><CoverImageCropper file={cropFile} targetAspect={16 / 9} maxOutputBytes={MAX_LIVE_COVER_BYTES} onConfirm={confirmCover} onCancel={() => { if (!updatingCover) setCropFile(null); }} /></div></div>}
    <V2ConfirmDialog open={Boolean(discardTarget)} onOpenChange={(open) => { if (!open) setDiscardTarget(null); }}
      title="Descartar esta live?" description="A gravação, o chat e o histórico desta transmissão serão removidos permanentemente. Esta ação não pode ser desfeita."
      summary={discardTarget?.title} items={["Remover a gravação armazenada", "Encerrar e remover os recursos da transmissão", "Apagar o registro desta live na Classfy"]}
      confirmLabel="Descartar live" workingLabel="Removendo..." isWorking={Boolean(discardingId)} onConfirm={discardLive} />
  </AppShell>;
}

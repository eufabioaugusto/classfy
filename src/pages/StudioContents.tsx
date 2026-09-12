import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Edit,
  Eye,
  Library,
  MoreVertical,
  Plus,
  Podcast,
  Radio,
  Search,
  Trash2,
  Video,
  Zap,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useBoostContent } from "@/hooks/useBoostContent";
import type { BoostItemType } from "@/hooks/useBoostContent";
import {
  publicationDraftService,
  type StandalonePublicationDraft,
} from "@/lib/studio/publication";
import { AppShell, PageHeader } from "@/components/layout";
import { CreatorTemplate } from "@/components/templates";
import { StudioMetricCard } from "@/components/studio/StudioMetricCard";
import { StudioNavigation } from "@/components/studio/StudioNavigation";
import {
  V2Button,
  V2Card,
  V2EmptyState,
  V2SectionHeader,
  V2Table,
  V2TableWrap,
} from "@/components/v2";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import "@/styles/studio-v2.css";

const BoostModal = lazy(() =>
  import("@/components/BoostModal").then((module) => ({
    default: module.BoostModal,
  })),
);

interface Content {
  id: string;
  title: string;
  description: string | null;
  content_type: string;
  thumbnail_url: string | null;
  status: string | null;
  created_at: string;
  views_count: number | null;
  visibility: string | null;
  updated_at: string;
  record_type: "content" | "course" | "draft";
  draft_key?: string;
  source_id?: string | null;
  source_type?: string | null;
}

const typeLabels: Record<string, string> = {
  aula: "Aula",
  podcast: "Podcast",
  short: "Short",
  live: "Live",
  curso: "Curso",
};

const statusLabels: Record<string, string> = {
  approved: "Publicado",
  pending: "Em análise",
  rejected: "Revisão necessária",
  draft: "Rascunho",
};

const visibilityLabels: Record<string, string> = {
  free: "Público",
  pro: "Pro",
  premium: "Premium",
  paid: "Pago",
};

const typeIcons = {
  aula: Video,
  podcast: Podcast,
  short: Zap,
  live: Radio,
  curso: BookOpen,
};

export default function StudioContents() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [contents, setContents] = useState<Content[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const { isBoostModalOpen, selectedContent, openBoostModal, closeBoostModal } =
    useBoostContent();
  const contentRoute = (content: Content) =>
    `/watch/${content.id}${content.content_type === "curso" ? "?type=course" : ""}`;
  const boostItemType = (content: Content) =>
    content.content_type as BoostItemType;

  const fetchContents = useCallback(async () => {
    if (!user) return;
    try {
      const [contentsRes, coursesRes, draftsRes] = await Promise.all([
        supabase
          .from("contents")
          .select("*")
          .eq("creator_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("courses")
          .select("*")
          .eq("creator_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("publication_drafts")
          .select("*")
          .eq("owner_id", user.id)
          .eq("state", "draft")
          .order("updated_at", { ascending: false }),
      ]);
      if (contentsRes.error) throw contentsRes.error;
      if (coursesRes.error) throw coursesRes.error;
      if (draftsRes.error) throw draftsRes.error;

      const mappedContents = (contentsRes.data || []).map((content) => ({
        ...content,
        updated_at: content.updated_at || content.created_at,
        record_type: "content" as const,
      }));

      const mappedCourses = (coursesRes.data || []).map((course) => ({
        id: course.id,
        title: course.title,
        description: course.description,
        content_type: "curso",
        thumbnail_url: course.thumbnail_url,
        status: course.status,
        created_at: course.created_at,
        views_count: course.views_count,
        visibility: course.visibility,
        updated_at: course.updated_at || course.created_at,
        record_type: "course" as const,
      }));
      const mappedDrafts = (draftsRes.data || []).flatMap((record) => {
        const payload = (record.payload ||
          {}) as unknown as Partial<StandalonePublicationDraft>;
        if (
          !payload.title &&
          !payload.mediaAssetId &&
          !payload.fileUrl &&
          !payload.fileName
        )
          return [];
        return [
          {
            id: record.id,
            title:
              payload.title?.trim() ||
              `Novo ${typeLabels[record.kind]?.toLowerCase() || "conteúdo"}`,
            description: payload.description || null,
            content_type: record.kind,
            thumbnail_url: payload.thumbnailUrl || null,
            status: "draft",
            created_at: record.created_at,
            updated_at: record.updated_at,
            views_count: null,
            visibility: payload.visibility || "free",
            record_type: "draft" as const,
            draft_key: record.draft_key,
            source_id: record.source_id,
            source_type: record.source_type,
          },
        ];
      });
      setContents(
        [...mappedContents, ...mappedCourses, ...mappedDrafts].sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        ) as Content[],
      );
    } catch (error) {
      console.error("Error fetching contents:", error);
      toast({
        title: "Não foi possível carregar o catálogo",
        description: "Tente novamente em alguns instantes.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    if (!user) return;
    void fetchContents();
    const channel = supabase
      .channel("studio-contents")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contents",
          filter: `creator_id=eq.${user.id}`,
        },
        () => void fetchContents(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "courses",
          filter: `creator_id=eq.${user.id}`,
        },
        () => void fetchContents(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "publication_drafts",
          filter: `owner_id=eq.${user.id}`,
        },
        () => void fetchContents(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchContents, user]);

  const filteredContents = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
    return contents.filter((content) => {
      const matchesType =
        filterType === "all" || content.content_type === filterType;
      const matchesStatus =
        filterStatus === "all" || content.status === filterStatus;
      const matchesSearch =
        !normalizedSearch ||
        content.title.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
        content.description
          ?.toLocaleLowerCase("pt-BR")
          .includes(normalizedSearch);
      return matchesType && matchesStatus && matchesSearch;
    });
  }, [contents, filterStatus, filterType, search]);

  const summary = useMemo(
    () => ({
      approved: contents.filter((content) => content.status === "approved")
        .length,
      pending: contents.filter((content) => content.status === "pending")
        .length,
      drafts: contents.filter((content) => content.status === "draft").length,
      views: contents.reduce(
        (sum, content) => sum + Number(content.views_count || 0),
        0,
      ),
    }),
    [contents],
  );

  const handleDelete = async (contentId: string, contentType: string) => {
    if (
      !window.confirm("Excluir este conteúdo? Esta ação não pode ser desfeita.")
    )
      return;
    try {
      const table = contentType === "curso" ? "courses" : "contents";
      const { error } = await supabase.from(table).delete().eq("id", contentId);
      if (error) throw error;
      toast({
        title: "Conteúdo excluído",
        description: "O item foi removido do catálogo.",
      });
      await fetchContents();
    } catch (error) {
      console.error("Error deleting content:", error);
      toast({
        title: "Não foi possível excluir",
        description: "Revise o conteúdo e tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleDiscardDraft = async (content: Content) => {
    if (!user || !content.draft_key) return;
    if (
      !window.confirm(
        "Descartar este rascunho? A mídia temporária vinculada também será removida.",
      )
    )
      return;
    try {
      await publicationDraftService.discard(user.id, content.draft_key);
      toast({
        title: "Rascunho descartado",
        description: "O item foi removido do Studio.",
      });
      await fetchContents();
    } catch (error) {
      console.error("Error discarding draft:", error);
      toast({
        title: "Não foi possível descartar",
        description: "Tente novamente em alguns instantes.",
        variant: "destructive",
      });
    }
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  if (loading)
    return (
      <div className="cf-v2 min-h-screen grid place-items-center bg-[var(--cf2-canvas)]">
        <div className="cf2-state">
          <span className="cf2-state__spinner" />
          <strong>Carregando seu catálogo...</strong>
        </div>
      </div>
    );
  if (!user || (role !== "creator" && role !== "admin"))
    return <Navigate to="/" replace />;

  const renderActions = (content: Content) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Ações de ${content.title}`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {content.record_type !== "draft" && (
          <DropdownMenuItem onClick={() => navigate(contentRoute(content))}>
            <Eye className="mr-2 h-4 w-4" />
            Abrir
          </DropdownMenuItem>
        )}
        {content.status === "approved" && (
          <DropdownMenuItem
            onClick={() =>
              openBoostModal(content.id, content.title, boostItemType(content))
            }
          >
            <Zap className="mr-2 h-4 w-4" />
            Impulsionar
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() =>
            navigate(
              content.record_type === "draft"
                ? content.content_type === "curso"
                  ? content.source_id
                    ? `/studio/upload/curso?edit=${content.source_id}`
                    : "/studio/upload/curso"
                  : content.source_id
                    ? `/studio/upload?type=${content.content_type}&edit=${content.source_id}`
                    : `/studio/upload?type=${content.content_type}`
                : content.content_type === "curso"
                  ? `/studio/upload/curso?edit=${content.id}`
                  : `/studio/upload?type=${content.content_type}&edit=${content.id}`,
            )
          }
        >
          <Edit className="mr-2 h-4 w-4" />
          {content.record_type === "draft" ? "Continuar" : "Editar"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() =>
            content.record_type === "draft"
              ? void handleDiscardDraft(content)
              : void handleDelete(content.id, content.content_type)
          }
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {content.record_type === "draft" ? "Descartar" : "Excluir"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <AppShell
      variant="studio"
      title="Conteúdos"
      contentClassName="studio-page-shell"
    >
      <CreatorTemplate
        className="studio-template"
        width="wide"
        density="comfortable"
        header={
          <PageHeader
            eyebrow="Catálogo do Studio"
            title="Tudo o que você publicou."
            description="Acompanhe status, visibilidade e desempenho de cada aula, podcast, short, live ou curso."
            action={
              <V2Button
                variant="primary"
                leadingIcon={<Plus className="h-4 w-4" />}
                onClick={() => navigate("/studio/upload?type=aula")}
              >
                Publicar conteúdo
              </V2Button>
            }
          />
        }
        toolbar={
          <div className="studio-section">
            <StudioNavigation />
            <div className="studio-toolbar">
              <div className="studio-toolbar__filters">
                <label className="studio-search">
                  <Search aria-hidden="true" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar no catálogo"
                    aria-label="Buscar no catálogo"
                  />
                </label>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="studio-select-trigger">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os formatos</SelectItem>
                    <SelectItem value="aula">Aulas</SelectItem>
                    <SelectItem value="curso">Cursos</SelectItem>
                    <SelectItem value="podcast">Podcasts</SelectItem>
                    <SelectItem value="short">Shorts</SelectItem>
                    <SelectItem value="live">Lives</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="studio-select-trigger">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os status</SelectItem>
                    <SelectItem value="draft">Rascunhos</SelectItem>
                    <SelectItem value="approved">Publicados</SelectItem>
                    <SelectItem value="pending">Em análise</SelectItem>
                    <SelectItem value="rejected">Revisão necessária</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <span className="studio-toolbar__count">
                {filteredContents.length}{" "}
                {filteredContents.length === 1 ? "item" : "itens"}
              </span>
            </div>
          </div>
        }
      >
        <div className="studio-stack">
          <section className="studio-section">
            <V2SectionHeader
              eyebrow="Resumo"
              title="Seu catálogo em números"
              description="Uma leitura rápida do que já está publicado e do que ainda precisa de atenção."
            />
            <div className="studio-metrics">
              <StudioMetricCard
                icon={Library}
                label="Catálogo total"
                value={contents.length}
                detail={`${summary.drafts} ${summary.drafts === 1 ? "rascunho" : "rascunhos"}`}
                tone="accent"
              />
              <StudioMetricCard
                icon={Video}
                label="Publicados"
                value={summary.approved}
                detail="Disponíveis para a audiência"
                tone="success"
              />
              <StudioMetricCard
                icon={Zap}
                label="Em análise"
                value={summary.pending}
                detail="Aguardando aprovação"
                tone="warning"
              />
              <StudioMetricCard
                icon={Eye}
                label="Visualizações"
                value={summary.views.toLocaleString("pt-BR")}
                detail="Em todo o catálogo"
              />
            </div>
          </section>

          <section className="studio-section">
            <V2SectionHeader
              eyebrow="Publicações"
              title="Gerencie seu catálogo"
              description="Abra um conteúdo para revisar ou use o menu para editar, impulsionar e excluir."
            />
            {isLoading ? (
              <div className="cf2-state">
                <span className="cf2-state__spinner" />
                <strong>Atualizando catálogo...</strong>
              </div>
            ) : filteredContents.length === 0 ? (
              <V2EmptyState
                icon={<Library className="h-5 w-5" />}
                title={
                  contents.length === 0
                    ? "Seu catálogo ainda está vazio"
                    : "Nenhum conteúdo encontrado"
                }
                description={
                  contents.length === 0
                    ? "Publique o primeiro material para começar sua operação como creator."
                    : "Ajuste a busca ou os filtros para encontrar outra publicação."
                }
                action={
                  contents.length === 0 ? (
                    <V2Button
                      onClick={() => navigate("/studio/upload?type=aula")}
                    >
                      Publicar primeiro conteúdo
                    </V2Button>
                  ) : (
                    <V2Button
                      variant="secondary"
                      onClick={() => {
                        setSearch("");
                        setFilterType("all");
                        setFilterStatus("all");
                      }}
                    >
                      Limpar filtros
                    </V2Button>
                  )
                }
              />
            ) : (
              <>
                <V2TableWrap className="studio-table-wrap">
                  <V2Table>
                    <thead>
                      <tr>
                        <th>Conteúdo</th>
                        <th>Visibilidade</th>
                        <th>Status</th>
                        <th>Atualizado em</th>
                        <th>Views</th>
                        <th>
                          <span className="sr-only">Ações</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredContents.map((content) => {
                        const TypeIcon =
                          typeIcons[
                            content.content_type as keyof typeof typeIcons
                          ] || Video;
                        return (
                          <tr key={content.id}>
                            <td>
                              <div className="studio-content-cell">
                                {content.thumbnail_url ? (
                                  <img src={content.thumbnail_url} alt="" />
                                ) : (
                                  <span className="studio-content-cell__fallback">
                                    <TypeIcon />
                                  </span>
                                )}
                                <div className="studio-content-cell__copy">
                                  <strong>{content.title}</strong>
                                  <span>
                                    {typeLabels[content.content_type] ||
                                      content.content_type}
                                    {content.record_type === "draft"
                                      ? content.source_id
                                        ? " · revisão em rascunho"
                                        : " · rascunho"
                                      : ""}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td>
                              {visibilityLabels[content.visibility || "free"] ||
                                "Público"}
                            </td>
                            <td>
                              <span
                                className="studio-status"
                                data-status={content.status || "unknown"}
                              >
                                {statusLabels[content.status || ""] ||
                                  "Não informado"}
                              </span>
                            </td>
                            <td>{formatDate(content.updated_at)}</td>
                            <td>
                              {content.record_type === "draft"
                                ? "—"
                                : (content.views_count || 0).toLocaleString(
                                    "pt-BR",
                                  )}
                            </td>
                            <td>
                              <div className="studio-row-actions">
                                {content.status === "approved" && (
                                  <V2Button
                                    variant="quiet"
                                    size="sm"
                                    onClick={() =>
                                      openBoostModal(
                                        content.id,
                                        content.title,
                                        boostItemType(content),
                                      )
                                    }
                                  >
                                    Impulsionar
                                  </V2Button>
                                )}
                                {renderActions(content)}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </V2Table>
                </V2TableWrap>

                <div className="studio-mobile-list">
                  {filteredContents.map((content) => {
                    const TypeIcon =
                      typeIcons[
                        content.content_type as keyof typeof typeIcons
                      ] || Video;
                    return (
                      <V2Card className="studio-mobile-card" key={content.id}>
                        {content.thumbnail_url ? (
                          <img
                            className="studio-mobile-card__media"
                            src={content.thumbnail_url}
                            alt=""
                          />
                        ) : (
                          <div className="studio-mobile-card__media grid place-items-center">
                            <TypeIcon className="h-6 w-6 text-[var(--cf2-ink-subtle)]" />
                          </div>
                        )}
                        <div className="studio-mobile-card__content">
                          <div className="studio-mobile-card__meta">
                            <span>
                              {typeLabels[content.content_type] ||
                                content.content_type}
                            </span>
                            <span
                              className="studio-status"
                              data-status={content.status || "unknown"}
                            >
                              {statusLabels[content.status || ""] ||
                                "Não informado"}
                            </span>
                          </div>
                          <h3 className="studio-mobile-card__title">
                            {content.title}
                          </h3>
                          <div className="studio-mobile-card__meta">
                            <span>{formatDate(content.updated_at)}</span>
                            <span>
                              {content.record_type === "draft"
                                ? "Ainda não publicado"
                                : `${content.views_count || 0} views`}
                            </span>
                            {renderActions(content)}
                          </div>
                        </div>
                      </V2Card>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      </CreatorTemplate>

      {isBoostModalOpen && (
        <Suspense fallback={null}>
          <BoostModal
            open
            onOpenChange={closeBoostModal}
            contentId={selectedContent?.id}
            contentTitle={selectedContent?.title}
            itemType={selectedContent?.itemType}
          />
        </Suspense>
      )}
    </AppShell>
  );
}

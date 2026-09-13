import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  BookOpen,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Edit,
  Eye,
  Globe2,
  Library,
  LoaderCircle,
  MoreVertical,
  Plus,
  Podcast,
  Radio,
  Search,
  Trash2,
  Video,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useBoostContent } from "@/hooks/useBoostContent";
import type { BoostItemType } from "@/hooks/useBoostContent";
import {
  getBackgroundUploadsSnapshot,
  subscribeBackgroundUploads,
  type BackgroundUploadTask,
  type BackgroundUploadState,
} from "@/lib/studio/backgroundUploads";
import {
  publicationDraftService,
  type PublicationKind,
  type PublicationVisibility,
  type StandalonePublicationDraft,
} from "@/lib/studio/publication";
import { AppShell, PageHeader } from "@/components/layout";
import { CreatorTemplate } from "@/components/templates";
import { StudioMetricCard } from "@/components/studio/StudioMetricCard";
import { StudioNavigation } from "@/components/studio/StudioNavigation";
import {
  V2Button,
  V2Card,
  V2ConfirmDialog,
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
import { Checkbox } from "@/components/ui/checkbox";
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
  draft_payload?: Partial<StandalonePublicationDraft>;
  media_asset_status?: string | null;
}

interface DraftMediaPresentation {
  state: BackgroundUploadState;
  label: string;
  progress: number | null;
  active: boolean;
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

const mediaStatusPriority: Record<string, number> = {
  failed: 5,
  uploading: 4,
  processing: 3,
  created: 2,
  ready: 1,
};

function resolveDraftMedia(
  content: Content,
  uploads: BackgroundUploadTask[],
): DraftMediaPresentation | null {
  if (content.record_type !== "draft") return null;
  const live = uploads.find(
    (upload) =>
      upload.draftId === content.id ||
      (content.draft_payload?.mediaAssetId &&
        upload.mediaAssetId === content.draft_payload.mediaAssetId),
  );
  const persisted = content.media_asset_status;
  let state: BackgroundUploadState | null = null;
  let progress: number | null = null;

  if (live?.state === "failed") {
    state = "failed";
    progress = live.progress;
  } else if (persisted === "ready" || persisted === "failed") {
    state = persisted;
    progress = persisted === "ready" ? 100 : null;
  } else if (live) {
    state = live.state;
    progress = live.state === "uploading" ? live.progress : null;
  } else if (persisted) {
    state =
      persisted === "uploading"
        ? "uploading"
        : persisted === "processing"
          ? "processing"
          : persisted === "ready"
            ? "ready"
            : persisted === "failed"
              ? "failed"
              : "preparing";
  } else if (
    content.draft_payload?.uploadState &&
    content.draft_payload.uploadState !== "idle"
  ) {
    const draftState = content.draft_payload.uploadState;
    if (
      ["preparing", "uploading", "processing", "ready", "failed"].includes(
        draftState,
      )
    )
      state = draftState as BackgroundUploadState;
  }

  if (!state) return null;
  const label =
    state === "preparing"
      ? "Preparando"
      : state === "uploading"
        ? progress !== null
          ? `Enviando ${progress}%`
          : "Enviando"
        : state === "processing"
          ? "Processando"
          : state === "ready"
            ? "Mídia pronta"
            : "Falha no envio";
  return {
    state,
    label,
    progress,
    active: ["preparing", "uploading", "processing"].includes(state),
  };
}

function DraftMediaStatus({ media }: { media: DraftMediaPresentation }) {
  const Icon =
    media.state === "ready"
      ? CircleCheck
      : media.state === "failed"
        ? CircleAlert
        : LoaderCircle;
  return (
    <span className="studio-status" data-status={`media-${media.state}`}>
      <Icon className={media.active ? "animate-spin" : undefined} />
      {media.label}
    </span>
  );
}

function DraftMediaProgress({ media }: { media: DraftMediaPresentation }) {
  if (!media.active) return null;
  const determinate = media.state === "uploading" && media.progress !== null;
  return (
    <div
      className="studio-draft-progress"
      data-indeterminate={!determinate || undefined}
      aria-label={media.label}
    >
      <span style={{ width: determinate ? `${media.progress}%` : "38%" }} />
    </div>
  );
}

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

const selectionKey = (content: Content) =>
  `${content.record_type}:${content.id}`;

const editRoute = (content: Content) =>
  content.record_type === "draft"
    ? content.content_type === "curso"
      ? content.source_id
        ? `/studio/upload/curso?edit=${content.source_id}`
        : content.draft_key
          ? `/studio/upload/curso?draft=${encodeURIComponent(content.draft_key)}`
          : "/studio/upload/curso"
      : content.source_id
        ? `/studio/upload?type=${content.content_type}&edit=${content.source_id}`
        : content.draft_key
          ? `/studio/upload?type=${content.content_type}&draft=${encodeURIComponent(content.draft_key)}`
          : `/studio/upload?type=${content.content_type}`
    : content.content_type === "curso"
      ? `/studio/upload/curso?edit=${content.id}`
      : `/studio/upload?type=${content.content_type}&edit=${content.id}`;

export default function StudioContents() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [contents, setContents] = useState<Content[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [deleteSelectionOpen, setDeleteSelectionOpen] = useState(false);
  const [isBulkWorking, setIsBulkWorking] = useState(false);
  const backgroundUploads = useSyncExternalStore(
    subscribeBackgroundUploads,
    getBackgroundUploadsSnapshot,
    getBackgroundUploadsSnapshot,
  );
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

      const draftIds = (draftsRes.data || []).map((draft) => draft.id);
      const currentAssetByDraft = new Map<string, string>();
      const draftByCurrentAsset = new Map<string, string>();
      (draftsRes.data || []).forEach((draft) => {
        const payload = (draft.payload ||
          {}) as unknown as Partial<StandalonePublicationDraft>;
        if (payload.mediaAssetId) {
          currentAssetByDraft.set(draft.id, payload.mediaAssetId);
          draftByCurrentAsset.set(payload.mediaAssetId, draft.id);
        }
      });
      const draftAssetStatuses = new Map<string, string>();
      if (draftIds.length) {
        const linkedAssetByDraft = new Map<string, string>();
        const draftByLinkedAsset = new Map<string, string>();
        const { data: draftAssetLinks } = await (supabase as any)
          .from("publication_draft_assets")
          .select("draft_id, media_asset_id, created_at")
          .in("draft_id", draftIds)
          .order("created_at", { ascending: false });
        (draftAssetLinks || []).forEach(
          (link: { draft_id: string; media_asset_id: string }) => {
            if (linkedAssetByDraft.has(link.draft_id)) return;
            linkedAssetByDraft.set(link.draft_id, link.media_asset_id);
            draftByLinkedAsset.set(link.media_asset_id, link.draft_id);
          },
        );
        const assetIds = Array.from(
          new Set([
            ...currentAssetByDraft.values(),
            ...linkedAssetByDraft.values(),
          ]),
        );
        const queries = [
          (supabase as any)
            .from("media_assets")
            .select("id, publication_draft_id, status")
            .in("publication_draft_id", draftIds),
        ];
        if (assetIds.length)
          queries.push(
            (supabase as any)
              .from("media_assets")
              .select("id, publication_draft_id, status")
              .in("id", assetIds),
          );
        const assetResults = await Promise.all(queries);
        const assets = new Map<
          string,
          {
            id: string;
            publication_draft_id: string | null;
            status: string;
          }
        >();
        assetResults.forEach((result) =>
          (result.error ? [] : result.data || []).forEach(
            (asset: {
              id: string;
              publication_draft_id: string | null;
              status: string;
            }) => assets.set(asset.id, asset),
          ),
        );
        assets.forEach((asset) => {
          const matchingDraft =
            draftByCurrentAsset.get(asset.id) ||
            draftByLinkedAsset.get(asset.id) ||
            asset.publication_draft_id;
          if (!matchingDraft) return;
          const preferredAsset =
            currentAssetByDraft.get(matchingDraft) ||
            linkedAssetByDraft.get(matchingDraft);
          if (preferredAsset && preferredAsset !== asset.id) return;
          const current = draftAssetStatuses.get(matchingDraft);
          if (
            !current ||
            (mediaStatusPriority[asset.status] || 0) >
              (mediaStatusPriority[current] || 0)
          )
            draftAssetStatuses.set(matchingDraft, asset.status);
        });
      }

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
            draft_payload: payload,
            media_asset_status: draftAssetStatuses.get(record.id) || null,
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "media_assets",
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

  const selectedContents = useMemo(
    () => contents.filter((content) => selectedKeys.has(selectionKey(content))),
    [contents, selectedKeys],
  );
  const selectedVisibleCount = filteredContents.filter((content) =>
    selectedKeys.has(selectionKey(content)),
  ).length;
  const allVisibleSelected =
    filteredContents.length > 0 &&
    selectedVisibleCount === filteredContents.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  useEffect(() => {
    const availableKeys = new Set(contents.map(selectionKey));
    setSelectedKeys((current) => {
      const next = new Set(
        Array.from(current).filter((key) => availableKeys.has(key)),
      );
      return next.size === current.size ? current : next;
    });
  }, [contents]);

  const toggleSelection = (content: Content, checked: boolean) => {
    const key = selectionKey(content);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      filteredContents.forEach((content) => {
        const key = selectionKey(content);
        if (checked) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  };

  const requestDelete = (items: Content[]) => {
    setSelectedKeys(new Set(items.map(selectionKey)));
    setDeleteSelectionOpen(true);
  };

  const deleteOne = async (content: Content) => {
    if (content.record_type === "draft") {
      if (!user || !content.draft_key)
        throw new Error("Rascunho sem identificação");
      await publicationDraftService.discard(user.id, content.draft_key);
      return;
    }
    const request =
      content.record_type === "course"
        ? supabase.from("courses").delete().eq("id", content.id)
        : supabase.from("contents").delete().eq("id", content.id);
    const { error } = await request;
    if (error) throw error;
  };

  const confirmDeleteSelection = async () => {
    if (selectedContents.length === 0) return;
    setIsBulkWorking(true);
    const items = [...selectedContents];
    const results = await Promise.allSettled(items.map(deleteOne));
    const failedKeys = new Set<string>();
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failedKeys.add(selectionKey(items[index]));
        console.error("Error deleting catalog item:", result.reason);
      }
    });
    const removedCount = items.length - failedKeys.size;
    setSelectedKeys(failedKeys);
    setDeleteSelectionOpen(false);
    setIsBulkWorking(false);
    await fetchContents();

    if (removedCount > 0) {
      toast({
        title:
          removedCount === 1
            ? "1 item removido"
            : `${removedCount} itens removidos`,
        description:
          failedKeys.size > 0
            ? `${failedKeys.size} ${failedKeys.size === 1 ? "item não pôde" : "itens não puderam"} ser removido${failedKeys.size === 1 ? "" : "s"}.`
            : "O catálogo foi atualizado.",
      });
    } else {
      toast({
        title: "Não foi possível excluir",
        description: "Revise os itens selecionados e tente novamente.",
        variant: "destructive",
      });
    }
  };

  const updateOneVisibility = async (
    content: Content,
    visibility: PublicationVisibility,
  ) => {
    if (content.record_type === "draft") {
      if (!user || !content.draft_key)
        throw new Error("Rascunho sem identificação");
      const result = await publicationDraftService.save({
        ownerId: user.id,
        draftKey: content.draft_key,
        kind: content.content_type as PublicationKind,
        sourceType:
          content.source_type === "course" || content.source_type === "content"
            ? content.source_type
            : null,
        sourceId: content.source_id,
        payload: { ...content.draft_payload, visibility },
      });
      if (!result.remote) throw new Error("Alteração salva apenas localmente");
      return;
    }
    const request =
      content.record_type === "course"
        ? supabase.from("courses").update({ visibility }).eq("id", content.id)
        : supabase.from("contents").update({ visibility }).eq("id", content.id);
    const { error } = await request;
    if (error) throw error;
  };

  const changeSelectedVisibility = async (
    visibility: PublicationVisibility,
  ) => {
    if (selectedContents.length === 0) return;
    setIsBulkWorking(true);
    const selectionSize = selectedContents.length;
    const results = await Promise.allSettled(
      selectedContents.map((content) =>
        updateOneVisibility(content, visibility),
      ),
    );
    const failed = results.filter((result) => result.status === "rejected");
    setIsBulkWorking(false);
    await fetchContents();
    if (failed.length > 0) {
      toast({
        title: "Parte da alteração não foi concluída",
        description: `${selectionSize - failed.length} de ${selectionSize} itens foram atualizados.`,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Acesso atualizado",
      description: `${selectionSize} ${selectionSize === 1 ? "item foi atualizado" : "itens foram atualizados"} para ${visibilityLabels[visibility]}.`,
    });
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
        <DropdownMenuItem onClick={() => navigate(editRoute(content))}>
          <Edit className="mr-2 h-4 w-4" />
          {content.record_type === "draft" ? "Continuar" : "Editar"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => requestDelete([content])}
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
              description="Selecione um ou mais conteúdos para editar o acesso ou excluir tudo de uma vez."
            />
            {selectedContents.length > 0 && (
              <div
                className="studio-bulk-bar"
                role="toolbar"
                aria-label="Ações para conteúdos selecionados"
              >
                <div className="studio-bulk-bar__selection">
                  <strong>
                    {selectedContents.length}{" "}
                    {selectedContents.length === 1
                      ? "item selecionado"
                      : "itens selecionados"}
                  </strong>
                  <button
                    type="button"
                    className="studio-bulk-bar__clear"
                    onClick={() => setSelectedKeys(new Set())}
                  >
                    Limpar seleção
                  </button>
                </div>
                <div className="studio-bulk-bar__actions">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="studio-bulk-action"
                        disabled={
                          selectedContents.length !== 1 || isBulkWorking
                        }
                      >
                        <Edit />
                        Editar
                        <ChevronDown />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() => navigate(editRoute(selectedContents[0]))}
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        Abrir editor completo
                      </DropdownMenuItem>
                      {selectedContents[0]?.record_type !== "draft" && (
                        <DropdownMenuItem
                          onClick={() =>
                            navigate(contentRoute(selectedContents[0]))
                          }
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Ver como está publicado
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="studio-bulk-action"
                        disabled={isBulkWorking}
                      >
                        <Globe2 />
                        Alterar acesso
                        <ChevronDown />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {(["free", "pro", "premium"] as const).map(
                        (visibility) => (
                          <DropdownMenuItem
                            key={visibility}
                            onClick={() =>
                              void changeSelectedVisibility(visibility)
                            }
                          >
                            {visibilityLabels[visibility]}
                          </DropdownMenuItem>
                        ),
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="studio-bulk-action"
                        disabled={isBulkWorking}
                      >
                        Mais ações
                        <ChevronDown />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteSelectionOpen(true)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Excluir selecionados
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <button
                    type="button"
                    className="studio-bulk-bar__close"
                    aria-label="Fechar ações em lote"
                    onClick={() => setSelectedKeys(new Set())}
                  >
                    <X />
                  </button>
                </div>
              </div>
            )}
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
                        <th className="studio-table-select">
                          <Checkbox
                            checked={
                              allVisibleSelected
                                ? true
                                : someVisibleSelected
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={(checked) =>
                              toggleAllVisible(checked === true)
                            }
                            aria-label={
                              allVisibleSelected
                                ? "Desmarcar todos os itens visíveis"
                                : "Selecionar todos os itens visíveis"
                            }
                          />
                        </th>
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
                        const key = selectionKey(content);
                        const isSelected = selectedKeys.has(key);
                        const TypeIcon =
                          typeIcons[
                            content.content_type as keyof typeof typeIcons
                          ] || Video;
                        const draftMedia = resolveDraftMedia(
                          content,
                          backgroundUploads,
                        );
                        return (
                          <tr
                            key={key}
                            className="studio-content-row"
                            data-selected={isSelected || undefined}
                            data-media-active={draftMedia?.active || undefined}
                            data-media-state={draftMedia?.state}
                          >
                            <td className="studio-table-select">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) =>
                                  toggleSelection(content, checked === true)
                                }
                                aria-label={`Selecionar ${content.title}`}
                              />
                            </td>
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
                                  {draftMedia && (
                                    <DraftMediaProgress media={draftMedia} />
                                  )}
                                </div>
                              </div>
                            </td>
                            <td>
                              {visibilityLabels[content.visibility || "free"] ||
                                "Público"}
                            </td>
                            <td>
                              {draftMedia ? (
                                <DraftMediaStatus media={draftMedia} />
                              ) : (
                                <span
                                  className="studio-status"
                                  data-status={content.status || "unknown"}
                                >
                                  {statusLabels[content.status || ""] ||
                                    "Não informado"}
                                </span>
                              )}
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
                    const key = selectionKey(content);
                    const isSelected = selectedKeys.has(key);
                    const TypeIcon =
                      typeIcons[
                        content.content_type as keyof typeof typeIcons
                      ] || Video;
                    const draftMedia = resolveDraftMedia(
                      content,
                      backgroundUploads,
                    );
                    return (
                      <V2Card
                        className="studio-mobile-card"
                        key={key}
                        data-selected={isSelected || undefined}
                        data-media-active={draftMedia?.active || undefined}
                        data-media-state={draftMedia?.state}
                      >
                        <div className="studio-mobile-card__select">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) =>
                              toggleSelection(content, checked === true)
                            }
                            aria-label={`Selecionar ${content.title}`}
                          />
                        </div>
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
                            {draftMedia ? (
                              <DraftMediaStatus media={draftMedia} />
                            ) : (
                              <span
                                className="studio-status"
                                data-status={content.status || "unknown"}
                              >
                                {statusLabels[content.status || ""] ||
                                  "Não informado"}
                              </span>
                            )}
                          </div>
                          <h3 className="studio-mobile-card__title">
                            {content.title}
                          </h3>
                          {draftMedia && (
                            <DraftMediaProgress media={draftMedia} />
                          )}
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

      <V2ConfirmDialog
        open={deleteSelectionOpen}
        onOpenChange={setDeleteSelectionOpen}
        title={
          selectedContents.length === 1
            ? "Excluir este item?"
            : `Excluir ${selectedContents.length} itens?`
        }
        description="Os conteúdos selecionados sairão do seu catálogo. Essa ação não pode ser desfeita."
        summary={`${selectedContents.length} ${selectedContents.length === 1 ? "item será removido" : "itens serão removidos"}`}
        items={selectedContents.slice(0, 5).map((content) => content.title)}
        hiddenItemCount={Math.max(0, selectedContents.length - 5)}
        confirmLabel="Excluir definitivamente"
        workingLabel="Excluindo..."
        isWorking={isBulkWorking}
        confirmDisabled={selectedContents.length === 0}
        onConfirm={confirmDeleteSelection}
      />
    </AppShell>
  );
}

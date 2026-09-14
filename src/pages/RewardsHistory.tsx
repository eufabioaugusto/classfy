import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  BookOpen,
  Coins,
  Download,
  Eye,
  Filter,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { GlobalLoader } from "@/components/GlobalLoader";
import { AppShell, PageHeader } from "@/components/layout";
import { EconomyTemplate } from "@/components/templates";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  V2Badge,
  V2Button,
  V2Card,
  V2CardContent,
  V2CardHeader,
  V2EmptyState,
  V2Input,
  V2SectionHeader,
  V2Table,
  V2TableWrap,
} from "@/components/v2";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getRewardActionFilterLabel,
  getRewardActionLabel,
  getRewardPointTypeLabel,
  getRewardPointUnit,
} from "@/lib/rewards/historyPresentation";
import "@/styles/economy-v2.css";

type RewardEventRow = Database["public"]["Tables"]["reward_events"]["Row"];
type RewardEvent = RewardEventRow & { contents: { title: string } | null };

const ITEMS_PER_PAGE = 20;
type RewardPerspective = "all" | "user" | "creator";

const rewardOriginLabels: Record<string, string> = {
  DAILY_LOGIN: "Registro de login diário",
  WEEKLY_STREAK: "Bônus de 7 dias consecutivos",
  PROFILE_COMPLETE: "Perfil da conta",
  CREATOR_APPROVED: "Perfil de creator",
  REFERRAL_SIGNUP: "Programa de indicações",
  REFERRAL_PURCHASE: "Compra por indicação",
  SUBSCRIBE_CREATOR: "Perfil do creator seguido",
  FOLLOW_CREATOR: "Perfil do creator seguido",
};

const getRewardOrigin = (event: RewardEvent) =>
  event.contents?.title ||
  (event.metadata &&
  typeof event.metadata === "object" &&
  !Array.isArray(event.metadata) &&
  typeof event.metadata.milestone_title === "string"
    ? event.metadata.milestone_title
    : null) ||
  rewardOriginLabels[event.action_key] ||
  "Ação geral da plataforma";

const metadataLabels: Record<string, string> = {
  date: "Data de referência",
  plan: "Plano",
  title: "Título",
  course_id: "Curso",
  content_id: "Conteúdo",
  tracking_key: "Identificador do registro",
  canonical_name: "Nome da regra",
  economy_version: "Versão da economia",
  milestone_id: "Identificador da conquista",
  milestone_title: "Conquista",
  milestone_type: "Tipo de meta",
  milestone_value: "Valor alvo",
  source: "Origem técnica",
};

const hiddenMetadataKeys = new Set([
  "tracking_key",
  "economy_version",
  "canonical_name",
  "source",
  "as_creator",
  "activation",
]);

const formatMetadataValue = (value: unknown) => {
  if (value === null || value === undefined || value === "")
    return "Não informado";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return JSON.stringify(value) || "Não informado";
};

export default function RewardsHistory() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<RewardEvent[]>([]);
  const [actionFilter, setActionFilter] = useState("all");
  const [perspective, setPerspective] = useState<RewardPerspective>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState<RewardEvent | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const selectedMetadataEntries = useMemo(() => {
    const metadata = selectedEvent?.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      return [];

    return Object.entries(metadata).filter(
      ([key, value]) =>
        !hiddenMetadataKeys.has(key) &&
        value !== null &&
        value !== undefined &&
        value !== "",
    );
  }, [selectedEvent]);

  const fetchRewardEvents = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("reward_events")
        .select(`*, contents (title)`)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setEvents((data || []) as RewardEvent[]);
    } catch (error) {
      console.error("Error fetching reward events:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
      return;
    }
    if (user) void fetchRewardEvents();
  }, [authLoading, fetchRewardEvents, navigate, user]);

  const datedEvents = useMemo(
    () =>
      events.filter((event) => {
        if (actionFilter !== "all" && event.action_key !== actionFilter)
          return false;
        if (startDate && new Date(event.created_at) < new Date(startDate))
          return false;
        if (
          endDate &&
          new Date(event.created_at) > new Date(`${endDate}T23:59:59`)
        )
          return false;
        return true;
      }),
    [actionFilter, endDate, events, startDate],
  );

  const perspectiveCounts = useMemo(
    () => ({
      all: datedEvents.length,
      user: datedEvents.filter((event) => event.point_type !== "creator")
        .length,
      creator: datedEvents.filter((event) => event.point_type === "creator")
        .length,
    }),
    [datedEvents],
  );

  const filteredEvents = useMemo(
    () =>
      datedEvents.filter((event) => {
        if (perspective === "user") return event.point_type !== "creator";
        if (perspective === "creator") return event.point_type === "creator";
        return true;
      }),
    [datedEvents, perspective],
  );

  const stats = useMemo(
    () => ({
      userPoints: datedEvents
        .filter((event) => event.point_type !== "creator")
        .reduce((sum, event) => sum + Number(event.points || 0), 0),
      creatorPoints: datedEvents
        .filter((event) => event.point_type === "creator")
        .reduce((sum, event) => sum + Number(event.points || 0), 0),
      totalEvents: datedEvents.length,
    }),
    [datedEvents],
  );

  const uniqueActions = useMemo(
    () => Array.from(new Set(events.map((event) => event.action_key))).sort(),
    [events],
  );
  const totalPages = Math.ceil(filteredEvents.length / ITEMS_PER_PAGE);
  const paginatedEvents = useMemo(
    () =>
      filteredEvents.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE,
      ),
    [currentPage, filteredEvents],
  );

  const clearFilters = () => {
    setActionFilter("all");
    setPerspective("all");
    setStartDate("");
    setEndDate("");
    setCurrentPage(1);
  };

  const exportToCSV = () => {
    const headers = [
      "Data",
      "Como ganhou",
      "Origem",
      "Tipo",
      "Quantidade",
      "Unidade",
    ];
    const rows = filteredEvents.map((event) => [
      format(new Date(event.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR }),
      getRewardActionLabel(event),
      getRewardOrigin(event),
      getRewardPointTypeLabel(event),
      String(event.points),
      getRewardPointUnit(event),
    ]);
    const escapeCell = (cell: string) => `"${cell.replaceAll('"', '""')}"`;
    const csvContent = [headers, ...rows]
      .map((row) => row.map(escapeCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csvContent], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `historico-recompensas-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const showDetails = (event: RewardEvent) => {
    setSelectedEvent(event);
    setDetailsOpen(true);
  };

  if (authLoading || loading) return <GlobalLoader />;

  return (
    <AppShell
      title="Histórico de recompensas"
      contentClassName="economy-page-shell"
    >
      <EconomyTemplate
        className="economy-template"
        width="wide"
        header={
          <PageHeader
            eyebrow="Histórico de Points"
            title="Entenda cada Point recebido."
            description="Veja qual ação gerou a recompensa, quando ela foi registrada e se veio do seu estudo ou da sua criação."
            action={
              <div className="economy-page-actions">
                <V2Button
                  variant="secondary"
                  onClick={() => navigate("/recompensas")}
                >
                  Voltar para recompensas
                </V2Button>
                <V2Button
                  variant="secondary"
                  leadingIcon={<Download className="h-4 w-4" />}
                  onClick={exportToCSV}
                >
                  Exportar CSV
                </V2Button>
              </div>
            }
          />
        }
      >
        <section className="economy-metric-grid economy-history-metrics">
          {[
            {
              Icon: Coins,
              label: "Points de estudo e participação",
              value: stats.userPoints,
              detail: "Recebidos pelas suas ações na plataforma",
            },
            {
              Icon: TrendingUp,
              label: "Creator Points",
              value: stats.creatorPoints,
              detail: "Gerados pelos seus conteúdos",
            },
            {
              Icon: Activity,
              label: "Recompensas registradas",
              value: stats.totalEvents,
              detail: "No período selecionado",
            },
          ].map(({ Icon, label, value, detail }) => (
            <V2Card className="economy-metric" key={label}>
              <div className="economy-metric__top">
                <span className="economy-metric__label">{label}</span>
                <span className="economy-icon economy-icon--muted">
                  <Icon aria-hidden="true" />
                </span>
              </div>
              <strong className="economy-metric__value">
                {Math.floor(value).toLocaleString("pt-BR")}
              </strong>
              <span className="economy-metric__detail">{detail}</span>
            </V2Card>
          ))}
        </section>

        <V2Card className="economy-panel">
          <V2CardHeader>
            <div className="economy-panel-heading">
              <span className="economy-icon">
                <Filter aria-hidden="true" />
              </span>
              <div>
                <h2 className="economy-panel-title">Encontre uma recompensa</h2>
                <p className="economy-panel-copy">
                  Filtre por evento ou escolha um período.
                </p>
              </div>
            </div>
            {(actionFilter !== "all" ||
              perspective !== "all" ||
              startDate ||
              endDate) && (
              <V2Button variant="quiet" size="sm" onClick={clearFilters}>
                Limpar filtros
              </V2Button>
            )}
          </V2CardHeader>
          <V2CardContent>
            <div className="economy-filter-grid">
              <label className="cf2-field">
                <span className="cf2-field__label">Evento recompensado</span>
                <Select
                  value={actionFilter}
                  onValueChange={(value) => {
                    setActionFilter(value);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="economy-select-trigger">
                    <SelectValue placeholder="Todos os eventos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os eventos</SelectItem>
                    {uniqueActions.map((action) => (
                      <SelectItem key={action} value={action}>
                        {getRewardActionFilterLabel(action)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <V2Input
                type="date"
                label="De"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setCurrentPage(1);
                }}
              />
              <V2Input
                type="date"
                label="Até"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>
          </V2CardContent>
        </V2Card>

        <section className="economy-section">
          <V2SectionHeader
            eyebrow="Movimentações"
            title="Como seus Points foram gerados"
            description="Separe suas ações como aluno dos resultados recebidos como creator."
          />
          <Tabs
            value={perspective}
            onValueChange={(value) => {
              setPerspective(value as RewardPerspective);
              setCurrentPage(1);
            }}
            className="economy-history-perspective"
          >
            <TabsList className="economy-history-tabs">
              <TabsTrigger value="all">
                Tudo · {perspectiveCounts.all}
              </TabsTrigger>
              <TabsTrigger value="user">
                Como aluno · {perspectiveCounts.user}
              </TabsTrigger>
              <TabsTrigger value="creator">
                Como creator · {perspectiveCounts.creator}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="economy-history-count">
            Exibindo {paginatedEvents.length} de {filteredEvents.length}{" "}
            registros nesta visão.
          </p>
          <div className="economy-history-content">
            {paginatedEvents.length === 0 ? (
              <V2EmptyState
                icon={<BookOpen className="h-5 w-5" />}
                title="Nenhuma recompensa encontrada"
                description="Altere os filtros para procurar em outro período ou por outra ação."
                action={
                  actionFilter !== "all" ||
                  perspective !== "all" ||
                  startDate ||
                  endDate ? (
                    <V2Button variant="secondary" onClick={clearFilters}>
                      Limpar filtros
                    </V2Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <V2TableWrap className="economy-desktop-table">
                  <V2Table>
                    <thead>
                      <tr>
                        <th>Quando</th>
                        <th>Como você ganhou</th>
                        <th>Origem</th>
                        <th>Points</th>
                        <th>Tipo</th>
                        <th aria-label="Detalhes" />
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedEvents.map((event) => (
                        <tr key={event.id}>
                          <td className="economy-table-date">
                            {format(
                              new Date(event.created_at),
                              "dd/MM/yyyy, HH:mm",
                              { locale: ptBR },
                            )}
                          </td>
                          <td>
                            <div className="economy-action-cell">
                              <span className="economy-icon economy-icon--muted">
                                <Sparkles aria-hidden="true" />
                              </span>
                              <strong>{getRewardActionLabel(event)}</strong>
                            </div>
                          </td>
                          <td className="economy-origin-name">
                            {getRewardOrigin(event)}
                          </td>
                          <td>
                            <strong className="economy-table-points">
                              +{Math.floor(Number(event.points || 0))}{" "}
                              <small>{getRewardPointUnit(event)}</small>
                            </strong>
                          </td>
                          <td>
                            <V2Badge
                              variant={
                                event.point_type === "creator"
                                  ? "accent"
                                  : "neutral"
                              }
                            >
                              {getRewardPointTypeLabel(event)}
                            </V2Badge>
                          </td>
                          <td>
                            <V2Button
                              variant="quiet"
                              size="icon"
                              aria-label="Ver detalhes"
                              onClick={() => showDetails(event)}
                            >
                              <Eye className="h-4 w-4" />
                            </V2Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </V2Table>
                </V2TableWrap>

                <div className="economy-mobile-list">
                  {paginatedEvents.map((event) => (
                    <button
                      className="economy-history-mobile-button"
                      key={event.id}
                      type="button"
                      onClick={() => showDetails(event)}
                    >
                      <div className="economy-level__row">
                        <div className="economy-action-cell">
                          <span className="economy-icon economy-icon--muted">
                            <Sparkles aria-hidden="true" />
                          </span>
                          <strong>{getRewardActionLabel(event)}</strong>
                        </div>
                        <strong className="economy-table-points">
                          +{Math.floor(Number(event.points || 0))}{" "}
                          <small>{getRewardPointUnit(event)}</small>
                        </strong>
                      </div>
                      <p className="economy-panel-copy mt-3">
                        Origem · {getRewardOrigin(event)}
                      </p>
                      <div className="economy-history-mobile-meta">
                        <span>
                          {format(
                            new Date(event.created_at),
                            "dd/MM/yyyy 'às' HH:mm",
                            { locale: ptBR },
                          )}
                        </span>
                        <V2Badge
                          variant={
                            event.point_type === "creator"
                              ? "accent"
                              : "neutral"
                          }
                        >
                          {getRewardPointTypeLabel(event)}
                        </V2Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {totalPages > 1 && (
              <div className="economy-pagination">
                <span>
                  Página {currentPage} de {totalPages}
                </span>
                <div className="economy-page-actions">
                  <V2Button
                    variant="secondary"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() =>
                      setCurrentPage((page) => Math.max(1, page - 1))
                    }
                  >
                    Anterior
                  </V2Button>
                  <V2Button
                    variant="secondary"
                    size="sm"
                    disabled={currentPage === totalPages}
                    onClick={() =>
                      setCurrentPage((page) => Math.min(totalPages, page + 1))
                    }
                  >
                    Próxima
                  </V2Button>
                </div>
              </div>
            )}
          </div>
        </section>
      </EconomyTemplate>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="economy-reward-dialog w-[calc(100vw-2rem)] max-w-xl">
          <DialogHeader className="economy-reward-dialog__header">
            <DialogTitle>Detalhes da recompensa</DialogTitle>
            <DialogDescription>
              Confira o que gerou o crédito e em qual saldo ele foi registrado.
            </DialogDescription>
          </DialogHeader>
          {selectedEvent && (
            <div className="economy-reward-dialog__body">
              <span className="economy-detail-section-label">Resumo</span>
              <div className="economy-detail-table-wrap">
                <table className="economy-detail-table">
                  <tbody>
                    <tr>
                      <th scope="row">Quando</th>
                      <td>
                        {format(
                          new Date(selectedEvent.created_at),
                          "dd/MM/yyyy 'às' HH:mm",
                          { locale: ptBR },
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Como ganhou</th>
                      <td>{getRewardActionLabel(selectedEvent)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Crédito recebido</th>
                      <td>
                        <strong className="economy-detail-points">
                          +{Math.floor(Number(selectedEvent.points || 0))}{" "}
                          {getRewardPointUnit(selectedEvent)}
                        </strong>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Saldo</th>
                      <td>
                        <V2Badge
                          variant={
                            selectedEvent.point_type === "creator"
                              ? "accent"
                              : "neutral"
                          }
                        >
                          {getRewardPointTypeLabel(selectedEvent)}
                        </V2Badge>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Origem</th>
                      <td>{getRewardOrigin(selectedEvent)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {selectedMetadataEntries.length > 0 && (
                <div className="economy-detail-metadata">
                  <span className="economy-detail-section-label">
                    Dados do registro
                  </span>
                  <div className="economy-detail-table-wrap">
                    <table className="economy-detail-table">
                      <tbody>
                        {selectedMetadataEntries.map(([key, value]) => (
                          <tr key={key}>
                            <th scope="row">
                              {metadataLabels[key] || key.replaceAll("_", " ")}
                            </th>
                            <td>{formatMetadataValue(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Activity, BookOpen, Coins, Download, Eye, Filter, Sparkles, TrendingUp } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import "@/styles/economy-v2.css";

type RewardEventRow = Database["public"]["Tables"]["reward_events"]["Row"];
type RewardEvent = RewardEventRow & { contents: { title: string } | null };

const ITEMS_PER_PAGE = 20;

const actionLabels: Record<string, string> = {
  LIKE: "Curtiu um conteúdo",
  SAVE: "Salvou um conteúdo",
  FAVORITE: "Favoritou um conteúdo",
  COMMENT: "Comentou em um conteúdo",
  WATCH_50: "Assistiu à metade",
  WATCH_100: "Concluiu o conteúdo",
  VIEW_15S: "Assistiu aos primeiros 15 segundos",
  SHARE: "Compartilhou um conteúdo",
  COMPLETE_COURSE: "Concluiu um curso",
  DAILY_LOGIN: "Acessou a Classfy no dia",
  WEEKLY_STREAK: "Completou 7 dias seguidos",
  FIRST_CONTENT_WEEK: "Publicou o primeiro conteúdo da semana",
  BINGE_WATCH: "Completou uma maratona",
  PROFILE_COMPLETE: "Completou o perfil",
  SUBSCRIBE_CREATOR: "Começou a seguir um creator",
  FOLLOW_CREATOR: "Começou a seguir um creator",
  CREATOR_APPROVED: "Teve o perfil de creator aprovado",
  FIRST_UPLOAD: "Enviou o primeiro conteúdo",
  CONTENT_APPROVED: "Teve um conteúdo aprovado",
  CREATOR_MILESTONE: "Alcançou uma meta de creator",
  LIKE_CONTENT: "Curtiu um conteúdo (registro antigo)",
  SAVE_CONTENT: "Salvou um conteúdo (registro antigo)",
  FAVORITE_CONTENT: "Favoritou um conteúdo (registro antigo)",
  COMMENT_CONTENT: "Comentou em um conteúdo (registro antigo)",
  SHARE_CONTENT: "Compartilhou um conteúdo (registro antigo)",
  MILESTONE_100_VIEWS: "Alcançou 100 visualizações",
  MILESTONE_500_VIEWS: "Alcançou 500 visualizações",
  MILESTONE_1000_VIEWS: "Alcançou 1.000 visualizações",
  MILESTONE_5000_VIEWS: "Alcançou 5.000 visualizações",
  MILESTONE_10000_VIEWS: "Alcançou 10.000 visualizações",
};

const getActionLabel = (actionKey: string) => actionLabels[actionKey] || actionKey.replaceAll("_", " ");

const getPointTypeLabel = (pointType: RewardEventRow["point_type"]) =>
  pointType === "creator" ? "Criação" : "Estudo e participação";

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
  event.contents?.title
  || (event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
    && typeof event.metadata.milestone_title === "string" ? event.metadata.milestone_title : null)
  || rewardOriginLabels[event.action_key]
  || "Ação geral da plataforma";

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

const formatMetadataValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "Não informado";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) || "Não informado";
};

export default function RewardsHistory() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<RewardEvent[]>([]);
  const [actionFilter, setActionFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState<RewardEvent | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const selectedMetadataEntries = useMemo(() => {
    const metadata = selectedEvent?.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];

    return Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && value !== "");
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

  const filteredEvents = useMemo(() => events.filter((event) => {
    if (actionFilter !== "all" && event.action_key !== actionFilter) return false;
    if (startDate && new Date(event.created_at) < new Date(startDate)) return false;
    if (endDate && new Date(event.created_at) > new Date(`${endDate}T23:59:59`)) return false;
    return true;
  }), [actionFilter, endDate, events, startDate]);

  const stats = useMemo(() => ({
    userPoints: filteredEvents.filter((event) => event.point_type !== "creator").reduce((sum, event) => sum + Number(event.points || 0), 0),
    creatorPoints: filteredEvents.filter((event) => event.point_type === "creator").reduce((sum, event) => sum + Number(event.points || 0), 0),
    totalEvents: filteredEvents.length,
  }), [filteredEvents]);

  const uniqueActions = useMemo(() => Array.from(new Set(events.map((event) => event.action_key))).sort(), [events]);
  const totalPages = Math.ceil(filteredEvents.length / ITEMS_PER_PAGE);
  const paginatedEvents = useMemo(
    () => filteredEvents.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE),
    [currentPage, filteredEvents],
  );

  const clearFilters = () => {
    setActionFilter("all");
    setStartDate("");
    setEndDate("");
    setCurrentPage(1);
  };

  const exportToCSV = () => {
    const headers = ["Data", "Ação", "Origem", "Tipo", "Points"];
    const rows = filteredEvents.map((event) => [
      format(new Date(event.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR }),
      getActionLabel(event.action_key),
      getRewardOrigin(event),
      getPointTypeLabel(event.point_type),
      String(event.points),
    ]);
    const escapeCell = (cell: string) => `"${cell.replaceAll('"', '""')}"`;
    const csvContent = [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csvContent], { type: "text/csv;charset=utf-8;" }));
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
    <AppShell title="Histórico de recompensas" contentClassName="economy-page-shell">
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
                <V2Button variant="secondary" onClick={() => navigate("/recompensas")}>Voltar para recompensas</V2Button>
                <V2Button variant="secondary" leadingIcon={<Download className="h-4 w-4" />} onClick={exportToCSV}>Exportar CSV</V2Button>
              </div>
            }
          />
        }
      >
        <section className="economy-metric-grid economy-history-metrics">
          {[
            { Icon: Coins, label: "Points de estudo e participação", value: stats.userPoints, detail: "Recebidos pelas suas ações na plataforma" },
            { Icon: TrendingUp, label: "Creator Points", value: stats.creatorPoints, detail: "Gerados pelos seus conteúdos" },
            { Icon: Activity, label: "Recompensas registradas", value: stats.totalEvents, detail: "No período selecionado" },
          ].map(({ Icon, label, value, detail }) => (
            <V2Card className="economy-metric" key={label}>
              <div className="economy-metric__top">
                <span className="economy-metric__label">{label}</span>
                <span className="economy-icon economy-icon--muted"><Icon aria-hidden="true" /></span>
              </div>
              <strong className="economy-metric__value">{Math.floor(value).toLocaleString("pt-BR")}</strong>
              <span className="economy-metric__detail">{detail}</span>
            </V2Card>
          ))}
        </section>

        <V2Card className="economy-panel">
          <V2CardHeader>
            <div className="economy-panel-heading">
              <span className="economy-icon"><Filter aria-hidden="true" /></span>
              <div><h2 className="economy-panel-title">Encontre uma recompensa</h2><p className="economy-panel-copy">Filtre por ação ou escolha um período.</p></div>
            </div>
            {(actionFilter !== "all" || startDate || endDate) && <V2Button variant="quiet" size="sm" onClick={clearFilters}>Limpar filtros</V2Button>}
          </V2CardHeader>
          <V2CardContent>
            <div className="economy-filter-grid">
              <label className="cf2-field">
                <span className="cf2-field__label">Ação realizada</span>
                <Select value={actionFilter} onValueChange={(value) => { setActionFilter(value); setCurrentPage(1); }}>
                  <SelectTrigger className="economy-select-trigger"><SelectValue placeholder="Todas as ações" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as ações</SelectItem>
                    {uniqueActions.map((action) => <SelectItem key={action} value={action}>{getActionLabel(action)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <V2Input type="date" label="De" value={startDate} onChange={(event) => { setStartDate(event.target.value); setCurrentPage(1); }} />
              <V2Input type="date" label="Até" value={endDate} onChange={(event) => { setEndDate(event.target.value); setCurrentPage(1); }} />
            </div>
          </V2CardContent>
        </V2Card>

        <section className="economy-section">
          <V2SectionHeader eyebrow="Movimentações" title="Recompensas recebidas" description={`Exibindo ${paginatedEvents.length} de ${filteredEvents.length} registros encontrados.`} />
          <div className="economy-history-content">
            {paginatedEvents.length === 0 ? (
              <V2EmptyState
                icon={<BookOpen className="h-5 w-5" />}
                title="Nenhuma recompensa encontrada"
                description="Altere os filtros para procurar em outro período ou por outra ação."
                action={(actionFilter !== "all" || startDate || endDate) ? <V2Button variant="secondary" onClick={clearFilters}>Limpar filtros</V2Button> : undefined}
              />
            ) : (
              <>
                <V2TableWrap className="economy-desktop-table">
                  <V2Table>
                    <thead><tr><th>Quando</th><th>O que você fez</th><th>Origem</th><th>Points</th><th>Tipo</th><th aria-label="Detalhes" /></tr></thead>
                    <tbody>
                      {paginatedEvents.map((event) => (
                        <tr key={event.id}>
                          <td className="economy-table-date">{format(new Date(event.created_at), "dd/MM/yyyy, HH:mm", { locale: ptBR })}</td>
                          <td><div className="economy-action-cell"><span className="economy-icon economy-icon--muted"><Sparkles aria-hidden="true" /></span><strong>{getActionLabel(event.action_key)}</strong></div></td>
                          <td className="economy-origin-name">{getRewardOrigin(event)}</td>
                          <td><strong className="economy-table-points">+{Math.floor(Number(event.points || 0))}</strong></td>
                          <td><V2Badge variant={event.point_type === "creator" ? "accent" : "neutral"}>{getPointTypeLabel(event.point_type)}</V2Badge></td>
                          <td><V2Button variant="quiet" size="icon" aria-label="Ver detalhes" onClick={() => showDetails(event)}><Eye className="h-4 w-4" /></V2Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </V2Table>
                </V2TableWrap>

                <div className="economy-mobile-list">
                  {paginatedEvents.map((event) => (
                    <button className="economy-history-mobile-button" key={event.id} type="button" onClick={() => showDetails(event)}>
                      <div className="economy-level__row">
                        <div className="economy-action-cell"><span className="economy-icon economy-icon--muted"><Sparkles aria-hidden="true" /></span><strong>{getActionLabel(event.action_key)}</strong></div>
                        <strong className="economy-table-points">+{Math.floor(Number(event.points || 0))}</strong>
                      </div>
                      <p className="economy-panel-copy mt-3">Origem · {getRewardOrigin(event)}</p>
                      <div className="economy-history-mobile-meta">
                        <span>{format(new Date(event.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                        <V2Badge variant={event.point_type === "creator" ? "accent" : "neutral"}>{getPointTypeLabel(event.point_type)}</V2Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {totalPages > 1 && (
              <div className="economy-pagination">
                <span>Página {currentPage} de {totalPages}</span>
                <div className="economy-page-actions">
                  <V2Button variant="secondary" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>Anterior</V2Button>
                  <V2Button variant="secondary" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>Próxima</V2Button>
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
            <DialogDescription>Confira como e quando estes Points foram registrados.</DialogDescription>
          </DialogHeader>
          {selectedEvent && (
            <div className="economy-reward-dialog__body">
              <span className="economy-detail-section-label">Resumo</span>
              <div className="economy-detail-table-wrap">
                <table className="economy-detail-table">
                  <tbody>
                    <tr><th scope="row">Quando</th><td>{format(new Date(selectedEvent.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</td></tr>
                    <tr><th scope="row">Ação realizada</th><td>{getActionLabel(selectedEvent.action_key)}</td></tr>
                    <tr><th scope="row">Points recebidos</th><td><strong className="economy-detail-points">+{Math.floor(Number(selectedEvent.points || 0))} Points</strong></td></tr>
                    <tr><th scope="row">Tipo</th><td><V2Badge variant={selectedEvent.point_type === "creator" ? "accent" : "neutral"}>{getPointTypeLabel(selectedEvent.point_type)}</V2Badge></td></tr>
                    <tr><th scope="row">Origem</th><td>{getRewardOrigin(selectedEvent)}</td></tr>
                  </tbody>
                </table>
              </div>

              {selectedMetadataEntries.length > 0 && (
                <div className="economy-detail-metadata">
                  <span className="economy-detail-section-label">Dados do registro</span>
                  <div className="economy-detail-table-wrap">
                    <table className="economy-detail-table">
                      <tbody>
                        {selectedMetadataEntries.map(([key, value]) => (
                          <tr key={key}><th scope="row">{metadataLabels[key] || key.replaceAll("_", " ")}</th><td>{formatMetadataValue(value)}</td></tr>
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

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { GlobalLoader } from "@/components/GlobalLoader";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Coins, DollarSign, TrendingUp, Download, Filter, Eye } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RewardEvent {
  id: string;
  action_key: string;
  points: number;
  value: number;
  performance_points: number;
  content_id: string | null;
  created_at: string;
  metadata: any;
  contents: {
    title: string;
  } | null;
}

interface Stats {
  totalPoints: number;
  totalPP: number;
  totalEvents: number;
}

const ITEMS_PER_PAGE = 20;

export default function RewardsHistory() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<RewardEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<RewardEvent[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalPoints: 0,
    totalPP: 0,
    totalEvents: 0,
  });
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState<RewardEvent | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    } else if (user) {
      fetchRewardEvents();
    }
  }, [user, authLoading, navigate]);

  const fetchRewardEvents = async () => {
    try {
      const { data, error } = await supabase
        .from("reward_events")
        .select(
          `
          *,
          contents (
            title
          )
        `
        )
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setEvents(data || []);
      setFilteredEvents(data || []);
      
      // Calculate stats
      const totalPoints = data?.reduce((sum, event) => sum + event.points, 0) || 0;
      const totalPP = data?.reduce((sum, event) => sum + (event.performance_points || 0), 0) || 0;
      
      setStats({
        totalPoints,
        totalPP,
        totalEvents: data?.length || 0,
      });
    } catch (error) {
      console.error("Error fetching reward events:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let filtered = [...events];

    // Filter by action
    if (actionFilter !== "all") {
      filtered = filtered.filter((event) => event.action_key === actionFilter);
    }

    // Filter by date range
    if (startDate) {
      filtered = filtered.filter(
        (event) => new Date(event.created_at) >= new Date(startDate)
      );
    }
    if (endDate) {
      filtered = filtered.filter(
        (event) => new Date(event.created_at) <= new Date(endDate + "T23:59:59")
      );
    }

    setFilteredEvents(filtered);

    // Recalculate stats for filtered data
    const totalPoints = filtered.reduce((sum, event) => sum + event.points, 0);
    const totalPP = filtered.reduce((sum, event) => sum + (event.performance_points || 0), 0);
    
    setStats({
      totalPoints,
      totalPP,
      totalEvents: filtered.length,
    });
  }, [actionFilter, startDate, endDate, events]);

  const getActionLabel = (actionKey: string) => {
    const labels: Record<string, string> = {
      LIKE_CONTENT: "Curtir Conteúdo",
      SAVE_CONTENT: "Salvar Conteúdo",
      FAVORITE_CONTENT: "Favoritar Conteúdo",
      COMMENT_CONTENT: "Comentar Conteúdo",
      WATCH_50: "Assistir 50%",
      WATCH_100: "Assistir 100%",
      COMPLETE_COURSE: "Completar Curso",
      DAILY_LOGIN: "Login Diário",
      DAILY_LOGIN_STREAK: "Sequência de Login",
      PROFILE_COMPLETE: "Perfil Completo",
      SUBSCRIBE_CREATOR: "Seguir Criador",
      CONTENT_APPROVED: "Conteúdo Aprovado",
      MILESTONE_100_VIEWS: "Marco: 100 Views",
      MILESTONE_500_VIEWS: "Marco: 500 Views",
      MILESTONE_1000_VIEWS: "Marco: 1.000 Views",
      MILESTONE_5000_VIEWS: "Marco: 5.000 Views",
      MILESTONE_10000_VIEWS: "Marco: 10.000 Views",
      FOLLOW_CREATOR: "Seguir Criador",
    };
    return labels[actionKey] || actionKey;
  };

  const getActionColor = (actionKey: string) => {
    const colors: Record<string, string> = {
      LIKE_CONTENT: "bg-pink-500/10 text-pink-500 border-pink-500/20",
      SAVE_CONTENT: "bg-blue-500/10 text-blue-500 border-blue-500/20",
      FAVORITE_CONTENT: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
      COMMENT_CONTENT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
      WATCH_50: "bg-green-500/10 text-green-500 border-green-500/20",
      WATCH_100: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
      COMPLETE_COURSE: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
      DAILY_LOGIN: "bg-orange-500/10 text-orange-500 border-orange-500/20",
      DAILY_LOGIN_STREAK: "bg-amber-500/10 text-amber-500 border-amber-500/20",
      PROFILE_COMPLETE: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
      SUBSCRIBE_CREATOR: "bg-red-500/10 text-red-500 border-red-500/20",
      FOLLOW_CREATOR: "bg-rose-500/10 text-rose-500 border-rose-500/20",
      CONTENT_APPROVED: "bg-teal-500/10 text-teal-500 border-teal-500/20",
      MILESTONE_100_VIEWS: "bg-violet-500/10 text-violet-500 border-violet-500/20",
      MILESTONE_500_VIEWS: "bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/20",
      MILESTONE_1000_VIEWS: "bg-sky-500/10 text-sky-500 border-sky-500/20",
      MILESTONE_5000_VIEWS: "bg-lime-500/10 text-lime-500 border-lime-500/20",
      MILESTONE_10000_VIEWS: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    };
    return colors[actionKey] || "bg-muted text-muted-foreground";
  };

  const exportToCSV = () => {
    const headers = ["Data", "Ação", "Conteúdo", "Pontos", "Valor"];
    const rows = filteredEvents.map(event => [
      format(new Date(event.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR }),
      getActionLabel(event.action_key),
      event.contents?.title || "-",
      event.points.toString(),
      `R$ ${event.value.toFixed(2)}`
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `historico-recompensas-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
  };

  const clearFilters = () => {
    setActionFilter("all");
    setStartDate("");
    setEndDate("");
    setCurrentPage(1);
  };

  const uniqueActions = Array.from(new Set(events.map((e) => e.action_key))).sort();
  
  const totalPages = Math.ceil(filteredEvents.length / ITEMS_PER_PAGE);
  const paginatedEvents = filteredEvents.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleViewDetails = (event: RewardEvent) => {
    setSelectedEvent(event);
    setDetailsOpen(true);
  };

  if (authLoading || loading) {
    return <GlobalLoader />;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <Header variant="home" title="Histórico de Recompensas" />

          <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Pontos</CardTitle>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalPoints.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total em R$</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                R$ {stats.totalValue.toFixed(2)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Eventos</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalEvents}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Filter className="w-5 h-5" />
                Filtros
              </CardTitle>
              <CardDescription>Filtre o histórico por tipo de ação e período</CardDescription>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" size="sm" onClick={clearFilters} className="flex-1 sm:flex-none">
                Limpar
              </Button>
              <Button variant="outline" size="sm" onClick={exportToCSV} className="flex-1 sm:flex-none">
                <Download className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Exportar CSV</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tipo de Ação</label>
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todas as ações" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as ações</SelectItem>
                    {uniqueActions.map((action) => (
                      <SelectItem key={action} value={action}>
                        {getActionLabel(action)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Data Inicial</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setCurrentPage(1);
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Data Final</label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setCurrentPage(1);
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Events Table - Desktop */}
        <Card className="hidden md:block">
          <CardHeader>
            <CardTitle>Eventos de Recompensa</CardTitle>
            <CardDescription>
              Mostrando {paginatedEvents.length} de {filteredEvents.length} eventos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Conteúdo</TableHead>
                    <TableHead className="text-right">Pontos</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedEvents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Nenhum evento encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedEvents.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">
                              {format(new Date(event.created_at), "dd/MM/yyyy HH:mm", {
                                locale: ptBR,
                              })}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getActionColor(event.action_key)} variant="outline">
                            {getActionLabel(event.action_key)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {event.contents ? (
                            <span className="text-sm">{event.contents.title}</span>
                          ) : (
                            <span className="text-sm text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-semibold text-primary">
                            +{event.points}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-semibold text-green-600">
                            R$ {event.value.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewDetails(event)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Página {currentPage} de {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Events Cards - Mobile */}
        <Card className="md:hidden">
          <CardHeader>
            <CardTitle className="text-base">Eventos de Recompensa</CardTitle>
            <CardDescription>
              Mostrando {paginatedEvents.length} de {filteredEvents.length} eventos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-3">
            {paginatedEvents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Nenhum evento encontrado
              </div>
            ) : (
              paginatedEvents.map((event) => (
                <div 
                  key={event.id} 
                  className="border rounded-lg p-3 space-y-2"
                  onClick={() => handleViewDetails(event)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Badge className={`${getActionColor(event.action_key)} text-xs`} variant="outline">
                      {getActionLabel(event.action_key)}
                    </Badge>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(event.created_at), "dd/MM/yy", { locale: ptBR })}
                    </div>
                  </div>
                  
                  {event.contents && (
                    <p className="text-sm text-foreground line-clamp-1">
                      {event.contents.title}
                    </p>
                  )}
                  
                  <div className="flex items-center justify-between pt-1 border-t">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-primary">
                        +{event.points} pts
                      </span>
                      <span className="text-sm font-semibold text-green-600">
                        R$ {event.value.toFixed(2)}
                      </span>
                    </div>
                    <Eye className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              ))
            )}

            {/* Pagination - Mobile */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                  {currentPage}/{totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Details Dialog */}
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Detalhes do Evento</DialogTitle>
              <DialogDescription>
                Informações completas sobre esta recompensa
              </DialogDescription>
            </DialogHeader>
            {selectedEvent && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Data</p>
                    <p className="text-sm">
                      {format(new Date(selectedEvent.created_at), "dd/MM/yyyy 'às' HH:mm", {
                        locale: ptBR,
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Tipo de Ação</p>
                    <Badge className={getActionColor(selectedEvent.action_key)} variant="outline">
                      {getActionLabel(selectedEvent.action_key)}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Pontos Ganhos</p>
                    <p className="text-2xl font-bold text-primary">+{selectedEvent.points}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Valor Ganho</p>
                    <p className="text-2xl font-bold text-green-600">
                      R$ {selectedEvent.value.toFixed(2)}
                    </p>
                  </div>
                </div>

                {selectedEvent.contents && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Conteúdo Relacionado</p>
                    <p className="text-sm mt-1">{selectedEvent.contents.title}</p>
                  </div>
                )}

                {selectedEvent.metadata && Object.keys(selectedEvent.metadata).length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Informações Adicionais</p>
                    <div className="rounded-lg bg-muted p-3 space-y-1">
                      {Object.entries(selectedEvent.metadata).map(([key, value]) => (
                        <div key={key} className="flex justify-between text-sm">
                          <span className="text-muted-foreground capitalize">{key}:</span>
                          <span className="font-medium">{JSON.stringify(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

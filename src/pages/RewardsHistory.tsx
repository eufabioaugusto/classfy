import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { GlobalLoader } from "@/components/GlobalLoader";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Coins, DollarSign, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface RewardEvent {
  id: string;
  action_key: string;
  points: number;
  value: number;
  content_id: string | null;
  created_at: string;
  metadata: any;
  contents: {
    title: string;
  } | null;
}

interface Stats {
  totalPoints: number;
  totalValue: number;
  totalEvents: number;
}

export default function RewardsHistory() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<RewardEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<RewardEvent[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalPoints: 0,
    totalValue: 0,
    totalEvents: 0,
  });
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

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
      const totalValue = data?.reduce((sum, event) => sum + event.value, 0) || 0;
      
      setStats({
        totalPoints,
        totalValue,
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
    const totalValue = filtered.reduce((sum, event) => sum + event.value, 0);
    
    setStats({
      totalPoints,
      totalValue,
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
      PROFILE_COMPLETE: "Perfil Completo",
      SUBSCRIBE_CREATOR: "Seguir Criador",
      CONTENT_APPROVED: "Conteúdo Aprovado",
    };
    return labels[actionKey] || actionKey;
  };

  const getActionColor = (actionKey: string) => {
    const colors: Record<string, string> = {
      LIKE_CONTENT: "bg-pink-500/10 text-pink-500",
      SAVE_CONTENT: "bg-blue-500/10 text-blue-500",
      FAVORITE_CONTENT: "bg-yellow-500/10 text-yellow-500",
      COMMENT_CONTENT: "bg-purple-500/10 text-purple-500",
      WATCH_50: "bg-green-500/10 text-green-500",
      WATCH_100: "bg-emerald-500/10 text-emerald-500",
      COMPLETE_COURSE: "bg-indigo-500/10 text-indigo-500",
      DAILY_LOGIN: "bg-orange-500/10 text-orange-500",
      PROFILE_COMPLETE: "bg-cyan-500/10 text-cyan-500",
      SUBSCRIBE_CREATOR: "bg-red-500/10 text-red-500",
      CONTENT_APPROVED: "bg-teal-500/10 text-teal-500",
    };
    return colors[actionKey] || "bg-muted text-muted-foreground";
  };

  const uniqueActions = Array.from(new Set(events.map((e) => e.action_key)));

  if (authLoading || loading) {
    return <GlobalLoader />;
  }

  return (
    <div className="min-h-screen bg-background">
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
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
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
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Data Final</label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Events Table */}
        <Card>
          <CardHeader>
            <CardTitle>Eventos de Recompensa</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Conteúdo</TableHead>
                  <TableHead className="text-right">Pontos</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Nenhum evento encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEvents.map((event) => (
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
                        <Badge className={getActionColor(event.action_key)}>
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
                        <span className="font-medium text-primary">
                          +{event.points}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-medium text-green-500">
                          R$ {event.value.toFixed(2)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

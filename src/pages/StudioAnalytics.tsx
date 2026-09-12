import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Clock, Eye, Heart, MessageSquare, Plus, Target, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/layout";
import { CreatorTemplate } from "@/components/templates";
import { StudioMetricCard } from "@/components/studio/StudioMetricCard";
import { StudioNavigation } from "@/components/studio/StudioNavigation";
import {
  V2Button,
  V2Card,
  V2CardContent,
  V2CardHeader,
  V2EmptyState,
  V2SectionHeader,
  V2Table,
  V2TableWrap,
} from "@/components/v2";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "@/styles/studio-v2.css";

interface ContentMetrics {
  id: string;
  title: string;
  views: number;
  uniqueViewers: number;
  likes: number;
  saves: number;
  favorites: number;
  comments: number;
  completionRate: number;
  avgWatchTime: number;
  totalWatchTime: number;
}

interface ContentOption {
  id: string;
  title: string;
}

interface ViewsOverTime {
  date: string;
  views: number;
  uniqueViewers: number;
}

const emptyStats = {
  totalViews: 0,
  uniqueViewers: 0,
  totalLikes: 0,
  totalSaves: 0,
  totalFavorites: 0,
  totalComments: 0,
  avgCompletionRate: 0,
  totalWatchTimeHours: 0,
};

const formatWatchTime = (seconds: number) => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
};

export default function StudioAnalytics() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [selectedContent, setSelectedContent] = useState("all");
  const [selectedPeriod, setSelectedPeriod] = useState("30");
  const [contentOptions, setContentOptions] = useState<ContentOption[]>([]);
  const [contents, setContents] = useState<ContentMetrics[]>([]);
  const [viewsOverTime, setViewsOverTime] = useState<ViewsOverTime[]>([]);
  const [totalStats, setTotalStats] = useState(emptyStats);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchAnalytics = async () => {
      setLoadingData(true);
      try {
        const daysAgo = Number.parseInt(selectedPeriod, 10);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysAgo);
        const startDateLabel = startDate.toISOString().split("T")[0];
        const startTimestamp = startDate.toISOString();
        const { data: creatorContents, error: contentsError } = await supabase
          .from("contents")
          .select("id, title, views_count")
          .eq("creator_id", user.id)
          .eq("status", "approved");

        if (contentsError) throw contentsError;
        setContentOptions((creatorContents || []).map(({ id, title }) => ({ id, title })));

        if (!creatorContents?.length) {
          setContents([]);
          setViewsOverTime([]);
          setTotalStats(emptyStats);
          return;
        }

        const metricsData = await Promise.all(creatorContents.map(async (content) => {
          const [viewsRes, likesRes, savesRes, favoritesRes, commentsRes, completionsRes] = await Promise.all([
            supabase.from("content_views").select("user_id, view_count, total_watch_time_seconds").eq("content_id", content.id).neq("user_id", user.id).gte("view_date", startDateLabel),
            supabase.from("actions").select("id", { count: "exact", head: true }).eq("content_id", content.id).eq("type", "LIKE").neq("user_id", user.id).gte("created_at", startTimestamp),
            supabase.from("saved_contents").select("id", { count: "exact", head: true }).eq("content_id", content.id).neq("user_id", user.id).gte("created_at", startTimestamp),
            supabase.from("favorites").select("id", { count: "exact", head: true }).eq("content_id", content.id).neq("user_id", user.id).gte("created_at", startTimestamp),
            supabase.from("comments").select("id", { count: "exact", head: true }).eq("content_id", content.id).neq("user_id", user.id).gte("created_at", startTimestamp),
            supabase.from("user_progress").select("id", { count: "exact", head: true }).eq("content_id", content.id).eq("completed", true).neq("user_id", user.id).gte("completed_at", startTimestamp),
          ]);
          const viewRows = viewsRes.data || [];
          const views = viewRows.reduce((sum, view) => sum + Number(view.view_count || 0), 0);
          const uniqueViewers = new Set(viewRows.map((view) => view.user_id)).size;
          const totalWatchTime = viewRows.reduce((sum, view) => sum + Number(view.total_watch_time_seconds || 0), 0);
          const completionRate = uniqueViewers > 0 ? ((completionsRes.count || 0) / uniqueViewers) * 100 : 0;

          return {
            id: content.id,
            title: content.title,
            views,
            uniqueViewers,
            likes: likesRes.count || 0,
            saves: savesRes.count || 0,
            favorites: favoritesRes.count || 0,
            comments: commentsRes.count || 0,
            completionRate: Math.min(completionRate, 100),
            avgWatchTime: uniqueViewers > 0 ? totalWatchTime / uniqueViewers : 0,
            totalWatchTime,
          };
        }));

        const filteredMetrics = selectedContent === "all"
          ? metricsData
          : metricsData.filter((metric) => metric.id === selectedContent);
        setContents(filteredMetrics);

        const totals = filteredMetrics.reduce((acc, current) => ({
          totalViews: acc.totalViews + current.views,
          uniqueViewers: acc.uniqueViewers + current.uniqueViewers,
          totalLikes: acc.totalLikes + current.likes,
          totalSaves: acc.totalSaves + current.saves,
          totalFavorites: acc.totalFavorites + current.favorites,
          totalComments: acc.totalComments + current.comments,
          avgCompletionRate: acc.avgCompletionRate + current.completionRate,
          totalWatchTimeHours: acc.totalWatchTimeHours + current.totalWatchTime,
        }), { ...emptyStats });
        totals.avgCompletionRate = filteredMetrics.length > 0 ? totals.avgCompletionRate / filteredMetrics.length : 0;
        totals.totalWatchTimeHours /= 3600;
        const contentIds = selectedContent === "all" ? creatorContents.map((content) => content.id) : [selectedContent];
        const { data: viewsData, error: viewsError } = await supabase
          .from("content_views")
          .select("view_date, user_id, view_count")
          .in("content_id", contentIds)
          .neq("user_id", user.id)
          .gte("view_date", startDateLabel)
          .order("view_date", { ascending: true });
        if (viewsError) throw viewsError;

        totals.uniqueViewers = new Set((viewsData || []).map((view) => view.user_id)).size;
        setTotalStats(totals);

        const viewsByDate = (viewsData || []).reduce<Record<string, { views: number; viewers: Set<string> }>>((acc, view) => {
          const date = view.view_date;
          if (!acc[date]) acc[date] = { views: 0, viewers: new Set<string>() };
          acc[date].views += Number(view.view_count || 0);
          acc[date].viewers.add(view.user_id);
          return acc;
        }, {});
        setViewsOverTime(Object.entries(viewsByDate).map(([date, value]) => ({
          date: new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
          views: value.views,
          uniqueViewers: value.viewers.size,
        })));
      } catch (error) {
        console.error("Error fetching analytics:", error);
      } finally {
        setLoadingData(false);
      }
    };

    void fetchAnalytics();
  }, [selectedContent, selectedPeriod, user]);

  if (loading) return <div className="cf-v2 min-h-screen grid place-items-center bg-[var(--cf2-canvas)]"><div className="cf2-state"><span className="cf2-state__spinner" /><strong>Carregando Analytics...</strong></div></div>;
  if (!user || (role !== "creator" && role !== "admin")) return <Navigate to="/" replace />;

  const totalInteractions = totalStats.totalLikes + totalStats.totalSaves + totalStats.totalFavorites + totalStats.totalComments;
  const watchTimeLabel = totalStats.totalWatchTimeHours >= 1
    ? `${totalStats.totalWatchTimeHours.toFixed(1)}h`
    : `${Math.round(totalStats.totalWatchTimeHours * 60)}min`;

  return (
    <AppShell variant="studio" title="Analytics" contentClassName="studio-page-shell">
      <CreatorTemplate
        className="studio-template"
        width="wide"
        density="comfortable"
        header={
          <PageHeader
            eyebrow="Analytics do Studio"
            title="Entenda o que prende a atenção."
            description="Compare alcance, retenção e interações para decidir com mais segurança o que publicar depois."
            action={<V2Button variant="primary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => navigate("/studio/upload?type=aula")}>Publicar conteúdo</V2Button>}
          />
        }
        toolbar={
          <div className="studio-section">
            <StudioNavigation />
            <div className="studio-toolbar">
              <div className="studio-toolbar__filters">
                <Select value={selectedContent} onValueChange={setSelectedContent}>
                  <SelectTrigger className="studio-select-trigger"><SelectValue placeholder="Selecionar conteúdo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todo o catálogo</SelectItem>
                    {contentOptions.map((content) => <SelectItem key={content.id} value={content.id}>{content.title}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                  <SelectTrigger className="studio-select-trigger"><SelectValue placeholder="Período" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Últimos 7 dias</SelectItem>
                    <SelectItem value="30">Últimos 30 dias</SelectItem>
                    <SelectItem value="90">Últimos 90 dias</SelectItem>
                    <SelectItem value="365">Último ano</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <span className="studio-toolbar__count">{selectedContent === "all" ? "Visão consolidada" : "Conteúdo selecionado"}</span>
            </div>
          </div>
        }
      >
        <div className="studio-stack" aria-busy={loadingData}>
          <section className="studio-section">
            <V2SectionHeader eyebrow="Resumo" title="Desempenho no período" description="Visualizações e tempo assistido respeitam o intervalo selecionado." />
            <div className="studio-metrics">
              <StudioMetricCard icon={Eye} label="Visualizações" value={totalStats.totalViews.toLocaleString("pt-BR")} detail={`${totalStats.uniqueViewers.toLocaleString("pt-BR")} pessoas alcançadas`} tone="accent" />
              <StudioMetricCard icon={Clock} label="Tempo assistido" value={watchTimeLabel} detail="Tempo total consumido" tone="success" />
              <StudioMetricCard icon={Target} label="Conclusão média" value={`${totalStats.avgCompletionRate.toFixed(1)}%`} detail="Pessoas que chegaram ao final" />
              <StudioMetricCard icon={Heart} label="Interações" value={totalInteractions.toLocaleString("pt-BR")} detail="Curtidas, salvos, favoritos e comentários" tone="warning" />
            </div>
          </section>

          <section className="studio-section">
            <V2SectionHeader eyebrow="Leitura" title="Como a audiência respondeu" description="Alterne a visão para comparar alcance, interação e desempenho entre publicações." />
            <Tabs defaultValue="views" className="studio-tabs">
              <TabsList>
                <TabsTrigger value="views">Audiência</TabsTrigger>
                <TabsTrigger value="engagement">Interações</TabsTrigger>
                <TabsTrigger value="performance">Publicações</TabsTrigger>
              </TabsList>

              <TabsContent value="views">
                <V2Card className="studio-chart-card studio-panel">
                  <V2CardHeader><div className="studio-panel-heading"><span className="studio-icon" data-tone="accent"><BarChart3 /></span><div><h3>Visualizações ao longo do tempo</h3><p>Total de reproduções e pessoas diferentes por dia.</p></div></div></V2CardHeader>
                  <V2CardContent>
                    {loadingData ? <div className="studio-chart-empty">Atualizando dados...</div> : viewsOverTime.length > 0 ? (
                      <div className="studio-chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={viewsOverTime} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
                            <CartesianGrid vertical={false} stroke="var(--cf2-border)" />
                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "var(--cf2-ink-subtle)", fontSize: 11 }} />
                            <YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fill: "var(--cf2-ink-subtle)", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "var(--cf2-surface-raised)", borderColor: "var(--cf2-border)" }} />
                            <Line type="monotone" dataKey="views" stroke="var(--cf2-accent)" strokeWidth={2.5} dot={false} name="Visualizações" />
                            <Line type="monotone" dataKey="uniqueViewers" stroke="var(--cf2-ink-secondary)" strokeWidth={1.5} dot={false} name="Pessoas" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : <div className="studio-chart-empty">Ainda não há visualizações neste período.</div>}
                  </V2CardContent>
                </V2Card>
              </TabsContent>

              <TabsContent value="engagement">
                <div className="studio-workspace-grid">
                  <V2Card className="studio-chart-card studio-panel">
                    <V2CardHeader><div className="studio-panel-heading"><span className="studio-icon" data-tone="warning"><Heart /></span><div><h3>Interações por tipo</h3><p>Como as pessoas reagiram às publicações.</p></div></div></V2CardHeader>
                    <V2CardContent>
                      {totalInteractions > 0 ? (
                        <div className="studio-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: "Curtidas", value: totalStats.totalLikes }, { name: "Salvos", value: totalStats.totalSaves }, { name: "Favoritos", value: totalStats.totalFavorites }, { name: "Comentários", value: totalStats.totalComments }]} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--cf2-border)" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "var(--cf2-ink-subtle)", fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fill: "var(--cf2-ink-subtle)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--cf2-surface-raised)", borderColor: "var(--cf2-border)" }} /><Bar dataKey="value" fill="var(--cf2-accent)" radius={[6, 6, 0, 0]} name="Interações" /></BarChart></ResponsiveContainer></div>
                      ) : <div className="studio-chart-empty">Ainda não há interações para comparar.</div>}
                    </V2CardContent>
                  </V2Card>
                  <V2Card className="studio-panel">
                    <V2CardHeader><div className="studio-panel-heading"><span className="studio-icon"><Users /></span><div><h3>Resumo das interações</h3><p>Totais dentro do período selecionado.</p></div></div></V2CardHeader>
                    <V2CardContent>
                      <div className="studio-list">
                        <div className="studio-list__item"><Heart className="h-4 w-4" /><div className="studio-list__copy"><strong>Curtidas</strong><p>Sinal rápido de interesse</p></div><span className="studio-list__value">{totalStats.totalLikes}</span></div>
                        <div className="studio-list__item"><Target className="h-4 w-4" /><div className="studio-list__copy"><strong>Salvos</strong><p>Conteúdo guardado para rever</p></div><span className="studio-list__value">{totalStats.totalSaves}</span></div>
                        <div className="studio-list__item"><Heart className="h-4 w-4" /><div className="studio-list__copy"><strong>Favoritos</strong><p>Conteúdo marcado como preferido</p></div><span className="studio-list__value">{totalStats.totalFavorites}</span></div>
                        <div className="studio-list__item"><MessageSquare className="h-4 w-4" /><div className="studio-list__copy"><strong>Comentários</strong><p>Conversas iniciadas</p></div><span className="studio-list__value">{totalStats.totalComments}</span></div>
                      </div>
                    </V2CardContent>
                  </V2Card>
                </div>
              </TabsContent>

              <TabsContent value="performance">
                <V2Card className="studio-chart-card studio-panel">
                  <V2CardHeader><div className="studio-panel-heading"><span className="studio-icon" data-tone="success"><BarChart3 /></span><div><h3>Visualizações por publicação</h3><p>Compare quais conteúdos atraíram mais reproduções no período.</p></div></div></V2CardHeader>
                  <V2CardContent>
                    {contents.length > 0 ? (
                      <div className="studio-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={contents} margin={{ top: 10, right: 10, left: -20, bottom: 45 }}><CartesianGrid vertical={false} stroke="var(--cf2-border)" /><XAxis dataKey="title" axisLine={false} tickLine={false} angle={-20} textAnchor="end" height={70} interval={0} tick={{ fill: "var(--cf2-ink-subtle)", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fill: "var(--cf2-ink-subtle)", fontSize: 11 }} /><Tooltip contentStyle={{ background: "var(--cf2-surface-raised)", borderColor: "var(--cf2-border)" }} /><Bar dataKey="views" fill="var(--cf2-accent)" radius={[6, 6, 0, 0]} name="Visualizações" /></BarChart></ResponsiveContainer></div>
                    ) : <div className="studio-chart-empty">Publique um conteúdo para começar a comparar.</div>}
                  </V2CardContent>
                </V2Card>
              </TabsContent>
            </Tabs>
          </section>

          <section className="studio-section">
            <V2SectionHeader eyebrow="Detalhamento" title="Resultado por publicação" description="Compare audiência, retenção e interação em uma única leitura." />
            {contents.length > 0 ? (
              <V2TableWrap className="studio-table-wrap">
                <V2Table>
                  <thead><tr><th>Publicação</th><th>Views</th><th>Pessoas</th><th>Conclusão</th><th>Tempo médio</th><th>Interações</th></tr></thead>
                  <tbody>
                    {contents.map((content) => (
                      <tr key={content.id}><td className="studio-table-title">{content.title}</td><td>{content.views}</td><td>{content.uniqueViewers}</td><td>{content.completionRate.toFixed(1)}%</td><td>{formatWatchTime(content.avgWatchTime)}</td><td>{content.likes + content.saves + content.favorites + content.comments}</td></tr>
                    ))}
                  </tbody>
                </V2Table>
              </V2TableWrap>
            ) : (
              <V2EmptyState icon={<BarChart3 className="h-5 w-5" />} title="Ainda não há dados para analisar" description="Publique um conteúdo ou altere os filtros para encontrar resultados." action={<V2Button onClick={() => navigate("/studio/upload?type=aula")}>Publicar conteúdo</V2Button>} />
            )}
          </section>
        </div>
      </CreatorTemplate>
    </AppShell>
  );
}

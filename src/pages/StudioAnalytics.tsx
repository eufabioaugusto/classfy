import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { Card } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { 
  Eye, 
  Heart, 
  Bookmark, 
  Star, 
  MessageSquare, 
  TrendingUp,
  Clock,
  Users,
  Video
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

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

interface ViewsOverTime {
  date: string;
  views: number;
  uniqueViewers: number;
}

export default function StudioAnalytics() {
  const { user, role, loading } = useAuth();
  const [selectedContent, setSelectedContent] = useState<string>("all");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("30");
  const [contents, setContents] = useState<ContentMetrics[]>([]);
  const [viewsOverTime, setViewsOverTime] = useState<ViewsOverTime[]>([]);
  const [totalStats, setTotalStats] = useState({
    totalViews: 0,
    uniqueViewers: 0,
    totalLikes: 0,
    totalSaves: 0,
    totalComments: 0,
    avgCompletionRate: 0,
    totalWatchTimeHours: 0
  });
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (user) {
      fetchAnalytics();
    }
  }, [user, selectedContent, selectedPeriod]);

  const fetchAnalytics = async () => {
    if (!user) return;
    
    setLoadingData(true);
    try {
      const daysAgo = parseInt(selectedPeriod);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysAgo);

      // Fetch creator's contents
      const { data: creatorContents } = await supabase
        .from('contents')
        .select('id, title, views_count')
        .eq('creator_id', user.id)
        .eq('status', 'approved');

      if (!creatorContents) return;

      // Fetch metrics for each content
      const metricsPromises = creatorContents.map(async (content) => {
        // Views unique (excluding creator's own views)
        const { count: uniqueViewers } = await supabase
          .from('content_views')
          .select('*', { count: 'exact', head: true })
          .eq('content_id', content.id)
          .neq('user_id', user.id)
          .gte('view_date', startDate.toISOString().split('T')[0]);

        // Total watch time
        const { data: watchTime } = await supabase
          .from('content_views')
          .select('total_watch_time_seconds')
          .eq('content_id', content.id)
          .neq('user_id', user.id)
          .gte('view_date', startDate.toISOString().split('T')[0]);

        const totalWatchTime = watchTime?.reduce((sum, v) => sum + (v.total_watch_time_seconds || 0), 0) || 0;

        // Likes (excluding creator's own)
        const { count: likes } = await supabase
          .from('actions')
          .select('*', { count: 'exact', head: true })
          .eq('content_id', content.id)
          .eq('type', 'LIKE')
          .neq('user_id', user.id)
          .gte('created_at', startDate.toISOString());

        // Saves (excluding creator's own)
        const { count: saves } = await supabase
          .from('saved_contents')
          .select('*', { count: 'exact', head: true })
          .eq('content_id', content.id)
          .neq('user_id', user.id)
          .gte('created_at', startDate.toISOString());

        // Favorites (excluding creator's own)
        const { count: favorites } = await supabase
          .from('favorites')
          .select('*', { count: 'exact', head: true })
          .eq('content_id', content.id)
          .neq('user_id', user.id)
          .gte('created_at', startDate.toISOString());

        // Comments (excluding creator's own)
        const { count: comments } = await supabase
          .from('comments')
          .select('*', { count: 'exact', head: true })
          .eq('content_id', content.id)
          .neq('user_id', user.id)
          .gte('created_at', startDate.toISOString());

        // Completion rate
        const { count: completions } = await supabase
          .from('user_progress')
          .select('*', { count: 'exact', head: true })
          .eq('content_id', content.id)
          .eq('completed', true)
          .neq('user_id', user.id)
          .gte('updated_at', startDate.toISOString());

        const completionRate = uniqueViewers && uniqueViewers > 0 ? ((completions || 0) / uniqueViewers) * 100 : 0;

        return {
          id: content.id,
          title: content.title,
          views: content.views_count || 0,
          uniqueViewers: uniqueViewers || 0,
          likes: likes || 0,
          saves: saves || 0,
          favorites: favorites || 0,
          comments: comments || 0,
          completionRate,
          avgWatchTime: uniqueViewers && uniqueViewers > 0 ? totalWatchTime / uniqueViewers : 0,
          totalWatchTime
        };
      });

      const metricsData = await Promise.all(metricsPromises);
      
      // Filter by selected content if needed
      const filteredMetrics = selectedContent === "all" 
        ? metricsData 
        : metricsData.filter(m => m.id === selectedContent);

      setContents(filteredMetrics);

      // Calculate total stats
      const totals = filteredMetrics.reduce((acc, curr) => ({
        totalViews: acc.totalViews + curr.views,
        uniqueViewers: acc.uniqueViewers + curr.uniqueViewers,
        totalLikes: acc.totalLikes + curr.likes,
        totalSaves: acc.totalSaves + curr.saves,
        totalComments: acc.totalComments + curr.comments,
        avgCompletionRate: acc.avgCompletionRate + curr.completionRate,
        totalWatchTimeHours: acc.totalWatchTimeHours + curr.totalWatchTime
      }), {
        totalViews: 0,
        uniqueViewers: 0,
        totalLikes: 0,
        totalSaves: 0,
        totalComments: 0,
        avgCompletionRate: 0,
        totalWatchTimeHours: 0
      });

      totals.avgCompletionRate = filteredMetrics.length > 0 
        ? totals.avgCompletionRate / filteredMetrics.length 
        : 0;
      totals.totalWatchTimeHours = totals.totalWatchTimeHours / 3600;

      setTotalStats(totals);

      // Fetch views over time
      const contentIds = selectedContent === "all" 
        ? creatorContents.map(c => c.id) 
        : [selectedContent];

      const { data: viewsData } = await supabase
        .from('content_views')
        .select('view_date, user_id')
        .in('content_id', contentIds)
        .neq('user_id', user.id)
        .gte('view_date', startDate.toISOString().split('T')[0])
        .order('view_date', { ascending: true });

      // Group by date
      const viewsByDate = viewsData?.reduce((acc: any, view) => {
        const date = view.view_date;
        if (!acc[date]) {
          acc[date] = { date, views: 0, uniqueViewers: new Set() };
        }
        acc[date].views++;
        acc[date].uniqueViewers.add(view.user_id);
        return acc;
      }, {});

      const timelineData = Object.values(viewsByDate || {}).map((d: any) => ({
        date: new Date(d.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        views: d.views,
        uniqueViewers: d.uniqueViewers.size
      }));

      setViewsOverTime(timelineData);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoadingData(false);
    }
  };

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cinematic-accent mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando analytics...</p>
        </div>
      </div>
    );
  }

  if (!user || (role !== 'creator' && role !== 'admin')) {
    return <Navigate to="/" replace />;
  }

  const COLORS = ['hsl(var(--cinematic-accent))', 'hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--muted))'];

  const engagementData = [
    { name: 'Likes', value: totalStats.totalLikes, color: COLORS[0] },
    { name: 'Salvos', value: totalStats.totalSaves, color: COLORS[1] },
    { name: 'Comentários', value: totalStats.totalComments, color: COLORS[2] }
  ];

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          <Header variant="studio" title="Analytics" />

          <main className="flex-1 p-6 md:p-12">
            <div className="max-w-7xl mx-auto space-y-8">
              {/* Header with filters */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className="text-3xl font-bold text-foreground mb-2">Analytics dos Conteúdos</h2>
                  <p className="text-muted-foreground">
                    Métricas detalhadas e insights sobre o desempenho dos seus conteúdos
                  </p>
                </div>
                
                <div className="flex gap-3">
                  <Select value={selectedContent} onValueChange={setSelectedContent}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Selecionar conteúdo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os conteúdos</SelectItem>
                      {contents.map(content => (
                        <SelectItem key={content.id} value={content.id}>
                          {content.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue placeholder="Período" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">Últimos 7 dias</SelectItem>
                      <SelectItem value="30">Últimos 30 dias</SelectItem>
                      <SelectItem value="90">Últimos 90 dias</SelectItem>
                      <SelectItem value="365">Último ano</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Overview Stats */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card className="p-6 bg-card border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Visualizações</p>
                      <p className="text-2xl font-bold text-foreground">{totalStats.totalViews}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {totalStats.uniqueViewers} únicos
                      </p>
                    </div>
                    <Eye className="w-8 h-8 text-blue-500" />
                  </div>
                </Card>

                <Card className="p-6 bg-card border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Tempo Assistido</p>
                      <p className="text-2xl font-bold text-foreground">
                        {totalStats.totalWatchTimeHours.toFixed(1)}h
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Total acumulado</p>
                    </div>
                    <Clock className="w-8 h-8 text-green-500" />
                  </div>
                </Card>

                <Card className="p-6 bg-card border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Taxa de Conclusão</p>
                      <p className="text-2xl font-bold text-foreground">
                        {totalStats.avgCompletionRate.toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Média geral</p>
                    </div>
                    <TrendingUp className="w-8 h-8 text-cinematic-accent" />
                  </div>
                </Card>

                <Card className="p-6 bg-card border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Engajamento</p>
                      <p className="text-2xl font-bold text-foreground">
                        {totalStats.totalLikes + totalStats.totalSaves + totalStats.totalComments}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Total de interações</p>
                    </div>
                    <Heart className="w-8 h-8 text-red-500" />
                  </div>
                </Card>
              </div>

              {/* Charts */}
              <Tabs defaultValue="views" className="space-y-6">
                <TabsList>
                  <TabsTrigger value="views">Visualizações</TabsTrigger>
                  <TabsTrigger value="engagement">Engajamento</TabsTrigger>
                  <TabsTrigger value="performance">Performance</TabsTrigger>
                </TabsList>

                <TabsContent value="views" className="space-y-6">
                  <Card className="p-6 bg-card border-border">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Visualizações ao Longo do Tempo</h3>
                    {viewsOverTime.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={viewsOverTime}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" stroke="hsl(var(--foreground))" />
                          <YAxis stroke="hsl(var(--foreground))" />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'hsl(var(--card))', 
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '8px'
                            }}
                          />
                          <Legend />
                          <Line 
                            type="monotone" 
                            dataKey="views" 
                            stroke="hsl(var(--cinematic-accent))" 
                            strokeWidth={2}
                            name="Views Totais"
                          />
                          <Line 
                            type="monotone" 
                            dataKey="uniqueViewers" 
                            stroke="hsl(var(--primary))" 
                            strokeWidth={2}
                            name="Viewers Únicos"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                        Nenhum dado disponível para o período selecionado
                      </div>
                    )}
                  </Card>
                </TabsContent>

                <TabsContent value="engagement" className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="p-6 bg-card border-border">
                      <h3 className="text-lg font-semibold text-foreground mb-4">Distribuição de Engajamento</h3>
                      {engagementData.some(d => d.value > 0) ? (
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie
                              data={engagementData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                              outerRadius={80}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {engagementData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: 'hsl(var(--card))', 
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px'
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                          Nenhuma interação registrada
                        </div>
                      )}
                    </Card>

                    <Card className="p-6 bg-card border-border">
                      <h3 className="text-lg font-semibold text-foreground mb-4">Métricas de Engajamento</h3>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <Heart className="w-5 h-5 text-red-500" />
                            <span className="text-foreground">Likes</span>
                          </div>
                          <Badge variant="secondary">{totalStats.totalLikes}</Badge>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <Bookmark className="w-5 h-5 text-blue-500" />
                            <span className="text-foreground">Salvos</span>
                          </div>
                          <Badge variant="secondary">{totalStats.totalSaves}</Badge>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <MessageSquare className="w-5 h-5 text-green-500" />
                            <span className="text-foreground">Comentários</span>
                          </div>
                          <Badge variant="secondary">{totalStats.totalComments}</Badge>
                        </div>
                      </div>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="performance" className="space-y-6">
                  <Card className="p-6 bg-card border-border">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Performance por Conteúdo</h3>
                    {contents.length > 0 ? (
                      <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={contents}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis 
                            dataKey="title" 
                            stroke="hsl(var(--foreground))"
                            angle={-45}
                            textAnchor="end"
                            height={100}
                          />
                          <YAxis stroke="hsl(var(--foreground))" />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'hsl(var(--card))', 
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '8px'
                            }}
                          />
                          <Legend />
                          <Bar dataKey="uniqueViewers" fill="hsl(var(--cinematic-accent))" name="Viewers Únicos" />
                          <Bar dataKey="likes" fill="hsl(var(--primary))" name="Likes" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                        Nenhum conteúdo disponível
                      </div>
                    )}
                  </Card>

                  {/* Detailed content table */}
                  <Card className="p-6 bg-card border-border">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Detalhamento por Conteúdo</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Título</th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Views</th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Únicos</th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Taxa Conclusão</th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Tempo Médio</th>
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Engajamento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {contents.map((content) => (
                            <tr key={content.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                              <td className="py-3 px-4 text-sm text-foreground max-w-xs truncate">
                                {content.title}
                              </td>
                              <td className="py-3 px-4 text-sm text-foreground">{content.views}</td>
                              <td className="py-3 px-4 text-sm text-foreground">{content.uniqueViewers}</td>
                              <td className="py-3 px-4 text-sm text-foreground">
                                {content.completionRate.toFixed(1)}%
                              </td>
                              <td className="py-3 px-4 text-sm text-foreground">
                                {Math.floor(content.avgWatchTime / 60)}m {Math.floor(content.avgWatchTime % 60)}s
                              </td>
                              <td className="py-3 px-4 text-sm text-foreground">
                                {content.likes + content.saves + content.comments}
                              </td>
                            </tr>
                          ))}
                          {contents.length === 0 && (
                            <tr>
                              <td colSpan={6} className="py-8 text-center text-muted-foreground">
                                Nenhum conteúdo encontrado
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

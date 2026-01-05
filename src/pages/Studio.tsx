import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { 
  Video, 
  Eye, 
  Users, 
  TrendingUp, 
  MessageSquare, 
  DollarSign, 
  Clock, 
  Zap,
  Heart,
  ArrowRight,
  TrendingDown,
  ArrowUpRight
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CreatorMilestonesCard } from "@/components/CreatorMilestonesCard";

export default function Studio() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  const [stats, setStats] = useState({
    totalContents: 0,
    totalViews: 0,
    followers: 0,
    earnings: 0,
    points: 0,
    pendingContents: 0,
    totalComments: 0,
    activeBoosts: 0,
    last7DaysViews: 0,
    viewsTrend: 0
  });

  const [recentContents, setRecentContents] = useState<any[]>([]);
  const [recentComments, setRecentComments] = useState<any[]>([]);
  const [recentRewards, setRecentRewards] = useState<any[]>([]);
  const [activeBoosts, setActiveBoosts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchDashboardData();
    }
  }, [user]);

  const fetchDashboardData = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      // Total de conteúdos
      const { count: contentsCount } = await supabase
        .from('contents')
        .select('*', { count: 'exact', head: true })
        .eq('creator_id', user.id);

      // Conteúdos pendentes
      const { count: pendingCount } = await supabase
        .from('contents')
        .select('*', { count: 'exact', head: true })
        .eq('creator_id', user.id)
        .eq('status', 'pending');

      // Total de visualizações
      const { data: contents } = await supabase
        .from('contents')
        .select('views_count, created_at')
        .eq('creator_id', user.id);

      const totalViews = contents?.reduce((sum, c) => sum + (c.views_count || 0), 0) || 0;

      // Views dos últimos 7 dias
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const { data: recentViews } = await supabase
        .from('content_views')
        .select('content_id, contents!inner(creator_id)')
        .eq('contents.creator_id', user.id)
        .gte('view_date', sevenDaysAgo.toISOString().split('T')[0]);

      const last7DaysViews = recentViews?.length || 0;

      // Views dos 7 dias anteriores para calcular trend
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      
      const { data: previousViews } = await supabase
        .from('content_views')
        .select('content_id, contents!inner(creator_id)')
        .eq('contents.creator_id', user.id)
        .gte('view_date', fourteenDaysAgo.toISOString().split('T')[0])
        .lt('view_date', sevenDaysAgo.toISOString().split('T')[0]);

      const previous7DaysViews = previousViews?.length || 0;
      const viewsTrend = previous7DaysViews > 0 
        ? ((last7DaysViews - previous7DaysViews) / previous7DaysViews) * 100 
        : 0;

      // Total de seguidores
      const { count: followersCount } = await supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', user.id);

      // Total ganhos
      const { data: wallet } = await supabase
        .from('wallets')
        .select('total_earned, balance')
        .eq('user_id', user.id)
        .single();

      // Total de comentários
      const { count: commentsCount } = await supabase
        .from('comments')
        .select('*, contents!inner(creator_id)', { count: 'exact', head: true })
        .eq('contents.creator_id', user.id);

      // Boosts ativos
      const { count: boostsCount, data: boostsData } = await supabase
        .from('boosts')
        .select('*, contents(title)', { count: 'exact' })
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(3);

      setActiveBoosts(boostsData || []);

      // Conteúdos recentes
      const { data: recentContentsData } = await supabase
        .from('contents')
        .select('id, title, status, created_at, views_count, thumbnail_url')
        .eq('creator_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      setRecentContents(recentContentsData || []);

      // Comentários recentes
      const { data: recentCommentsData } = await supabase
        .from('comments')
        .select(`
          id,
          text,
          created_at,
          profiles:user_id (display_name, avatar_url),
          contents!inner(id, title, creator_id)
        `)
        .eq('contents.creator_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      setRecentComments(recentCommentsData || []);

      // Recompensas recentes
      const { data: recentRewardsData } = await supabase
        .from('reward_events')
        .select('id, action_key, points, value, created_at, metadata')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      setRecentRewards(recentRewardsData || []);

      setStats({
        totalContents: contentsCount || 0,
        totalViews,
        followers: followersCount || 0,
        earnings: wallet?.total_earned || 0,
        points: 0,
        pendingContents: pendingCount || 0,
        totalComments: commentsCount || 0,
        activeBoosts: boostsCount || 0,
        last7DaysViews,
        viewsTrend
      });
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (loading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  if (!user || (role !== 'creator' && role !== 'admin')) {
    return <Navigate to="/" replace />;
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Aprovado</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Pendente</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Rejeitado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRewardLabel = (actionKey: string) => {
    const labels: Record<string, string> = {
      'CONTENT_UPLOAD': 'Upload de Conteúdo',
      'CONTENT_VIEW': 'Visualização',
      'MILESTONE_100_VIEWS': '100 Visualizações',
      'MILESTONE_500_VIEWS': '500 Visualizações',
      'MILESTONE_1000_VIEWS': '1.000 Visualizações',
      'LIKE': 'Like Recebido',
      'COMMENT': 'Comentário Recebido',
      'FOLLOW': 'Novo Seguidor'
    };
    return labels[actionKey] || actionKey;
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          <Header variant="studio" title="Studio Classfy" />

          <main className="flex-1 p-4 md:p-8">
            <div className="max-w-[1600px] mx-auto space-y-6">
              {/* Welcome Section */}
              <div>
                <h2 className="text-3xl font-bold text-foreground mb-2">Bem-vindo ao Studio!</h2>
                <p className="text-muted-foreground">
                  Gerencie seus conteúdos, acompanhe métricas e publique novos materiais.
                </p>
              </div>

              {/* Main Stats Grid - 4 columns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Total Contents */}
                <Card className="p-5 bg-card/50 backdrop-blur-sm border-border/50 hover:border-border transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                      <Video className="w-5 h-5 text-blue-500" />
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 text-xs"
                      onClick={() => navigate('/studio/contents')}
                    >
                      Ver todos
                    </Button>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Total de Conteúdos</p>
                    <p className="text-3xl font-bold text-foreground">{stats.totalContents}</p>
                    {stats.pendingContents > 0 && (
                      <p className="text-xs text-yellow-500 mt-1">
                        {stats.pendingContents} pendente{stats.pendingContents > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                </Card>

                {/* Views - Last 7 days with trend */}
                <Card className="p-5 bg-card/50 backdrop-blur-sm border-border/50 hover:border-border transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 rounded-lg bg-green-500/10">
                      <Eye className="w-5 h-5 text-green-500" />
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 text-xs"
                      onClick={() => navigate('/studio/analytics')}
                    >
                      Analytics
                    </Button>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Últimos 7 dias</p>
                    <div className="flex items-baseline gap-2">
                      <p className="text-3xl font-bold text-foreground">{stats.last7DaysViews}</p>
                      {stats.viewsTrend !== 0 && (
                        <span className={`text-xs font-medium flex items-center gap-0.5 ${
                          stats.viewsTrend > 0 ? 'text-green-500' : 'text-red-500'
                        }`}>
                          {stats.viewsTrend > 0 ? <ArrowUpRight className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {Math.abs(stats.viewsTrend).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {stats.totalViews.toLocaleString()} total
                    </p>
                  </div>
                </Card>

                {/* Followers */}
                <Card className="p-5 bg-card/50 backdrop-blur-sm border-border/50 hover:border-border transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                      <Users className="w-5 h-5 text-purple-500" />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Seguidores</p>
                    <p className="text-3xl font-bold text-foreground">{stats.followers}</p>
                  </div>
                </Card>

                {/* Earnings */}
                <Card className="p-5 bg-card/50 backdrop-blur-sm border-border/50 hover:border-border transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 rounded-lg bg-accent/10">
                      <DollarSign className="w-5 h-5 text-accent" />
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 text-xs"
                      onClick={() => navigate('/carteira')}
                    >
                      Ver carteira
                    </Button>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Ganhos (em dobro)</p>
                    <p className="text-3xl font-bold text-foreground">
                      R$ {(stats.earnings * 2).toFixed(2)}
                    </p>
                  </div>
                </Card>
              </div>

              {/* Secondary Stats - 3 columns */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Comments */}
                <Card className="p-4 bg-card/50 backdrop-blur-sm border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-orange-500/10">
                        <MessageSquare className="w-4 h-4 text-orange-500" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Comentários</p>
                        <p className="text-xl font-bold text-foreground">{stats.totalComments}</p>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Active Boosts */}
                <Card className="p-4 bg-card/50 backdrop-blur-sm border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-yellow-500/10">
                        <Zap className="w-4 h-4 text-yellow-500" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Boosts Ativos</p>
                        <p className="text-xl font-bold text-foreground">{stats.activeBoosts}</p>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 text-xs"
                      onClick={() => navigate('/studio/boosts')}
                    >
                      Ver
                    </Button>
                  </div>
                </Card>

                {/* Engagement Rate */}
                <Card className="p-4 bg-card/50 backdrop-blur-sm border-border/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-red-500/10">
                      <Heart className="w-4 h-4 text-red-500" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Taxa de Engajamento</p>
                      <p className="text-xl font-bold text-foreground">
                        {stats.totalViews > 0 
                          ? ((stats.totalComments / stats.totalViews) * 100).toFixed(1)
                          : '0'}%
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Creator Milestones Section */}
              <CreatorMilestonesCard creatorId={user.id} compact />

              {/* Content Cards Grid - 2 columns */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Recent Contents */}
                <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-foreground">Conteúdos Recentes</h3>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => navigate('/studio/contents')}
                    >
                      Ver todos
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {recentContents.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Video className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">Nenhum conteúdo ainda</p>
                      </div>
                    ) : (
                      recentContents.map((content) => (
                        <div 
                          key={content.id}
                          className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => navigate(`/watch/${content.id}`, isMobile ? { state: { backgroundLocation: location } } : undefined)}
                        >
                          <img 
                            src={content.thumbnail_url || '/placeholder.svg'} 
                            alt={content.title}
                            className="w-20 h-12 object-cover rounded"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {content.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              {getStatusBadge(content.status)}
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Eye className="w-3 h-3" />
                                {content.views_count || 0}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(content.created_at), { 
                              addSuffix: true, 
                              locale: ptBR 
                            })}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </Card>

                {/* Recent Comments */}
                <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-foreground">Comentários Recentes</h3>
                  </div>
                  <div className="space-y-3">
                    {recentComments.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">Nenhum comentário ainda</p>
                      </div>
                    ) : (
                      recentComments.map((comment: any) => (
                        <div 
                          key={comment.id}
                          className="p-3 rounded-lg hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-start gap-3">
                            <img 
                              src={comment.profiles?.avatar_url || '/placeholder.svg'} 
                              alt={comment.profiles?.display_name}
                              className="w-8 h-8 rounded-full"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="text-sm font-medium text-foreground">
                                  {comment.profiles?.display_name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDistanceToNow(new Date(comment.created_at), { 
                                    addSuffix: true, 
                                    locale: ptBR 
                                  })}
                                </p>
                              </div>
                              <p className="text-sm text-foreground/80 line-clamp-2">
                                {comment.text}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Em: {comment.contents?.title}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </div>

              {/* Bottom Row - Full Width Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Active Boosts Details */}
                {activeBoosts.length > 0 && (
                  <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <Zap className="w-5 h-5 text-yellow-500" />
                        Boosts Ativos
                      </h3>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => navigate('/studio/boosts')}
                      >
                        Ver todos
                        <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {activeBoosts.map((boost: any) => (
                        <div 
                          key={boost.id}
                          className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium text-foreground">
                              {boost.contents?.title || 'Boost do Perfil'}
                            </p>
                            <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                              Ativo
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Eye className="w-3 h-3" />
                              {boost.impressions_count || 0} impressões
                            </span>
                            <span className="flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />
                              R$ {boost.daily_budget}/dia
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Recent Rewards */}
                <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-foreground">Recompensas Recentes</h3>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => navigate('/recompensas')}
                    >
                      Ver histórico
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {recentRewards.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">Nenhuma recompensa ainda</p>
                      </div>
                    ) : (
                      recentRewards.map((reward) => (
                        <div 
                          key={reward.id}
                          className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">
                              {getRewardLabel(reward.action_key)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(reward.created_at), { 
                                addSuffix: true, 
                                locale: ptBR 
                              })}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-accent">
                              +R$ {reward.value.toFixed(2)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {reward.points} pts
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </div>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

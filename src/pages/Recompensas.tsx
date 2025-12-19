import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { GlobalLoader } from "@/components/GlobalLoader";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { 
  Trophy, 
  Zap, 
  Flame, 
  Target, 
  TrendingUp, 
  DollarSign,
  Award,
  Star,
  Heart,
  Bookmark,
  MessageSquare,
  Eye,
  Users,
  Video,
  BarChart3
} from "lucide-react";

interface UserStats {
  level: number;
  totalPoints: number;
  pointsToNextLevel: number;
  progressPercent: number;
  totalEarned: number;
  balance: number;
  currentStreak: number;
  longestStreak: number;
  badges: any[];
  engagementStats: {
    likes: number;
    saves: number;
    comments: number;
    completedContents: number;
  };
  creatorStats?: {
    totalContents: number;
    totalViews: number;
    totalLikes: number;
    avgEngagement: number;
    nextMilestone: {
      target: number;
      current: number;
      reward: string;
    };
  };
}

export default function Recompensas() {
  const { user, loading: authLoading, role } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<UserStats | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    } else if (user) {
      fetchStats();
    }
  }, [user, authLoading, navigate]);

  const fetchStats = async () => {
    try {
      // Fetch all data in parallel
      const [
        rewardEventsRes,
        walletRes,
        streaksRes,
        badgesRes,
        engagementRes
      ] = await Promise.all([
        supabase.from("reward_events").select("points").eq("user_id", user!.id),
        supabase.from("wallets").select("balance, total_earned").eq("user_id", user!.id).single(),
        supabase.from("user_login_streaks").select("current_streak, longest_streak").eq("user_id", user!.id).maybeSingle(),
        supabase.from("user_badges").select("*, badges(*)").eq("user_id", user!.id),
        // Engagement stats from reward events
        supabase.from("reward_events").select("action_key").eq("user_id", user!.id)
      ]);

      // Calculate level and points
      const totalPoints = rewardEventsRes.data?.reduce((sum, e) => sum + e.points, 0) || 0;
      const level = Math.floor(totalPoints / 1000) + 1;
      const pointsInCurrentLevel = totalPoints % 1000;
      const pointsToNextLevel = 1000 - pointsInCurrentLevel;
      const progressPercent = (pointsInCurrentLevel / 1000) * 100;

      // Calculate engagement stats
      const actions = engagementRes.data || [];
      const engagementStats = {
        likes: actions.filter(a => a.action_key === 'LIKE_CONTENT').length,
        saves: actions.filter(a => a.action_key === 'SAVE_CONTENT').length,
        comments: actions.filter(a => a.action_key === 'COMMENT_CONTENT').length,
        completedContents: actions.filter(a => a.action_key === 'WATCH_100').length,
      };

      let creatorStats = undefined;

      // If user is creator, fetch creator stats
      if (role === 'creator' || role === 'admin') {
        const [contentsRes] = await Promise.all([
          supabase.from("contents")
            .select("views_count, likes_count")
            .eq("creator_id", user!.id)
            .eq("status", "approved")
        ]);

        const contents = contentsRes.data || [];
        const totalViews = contents.reduce((sum, c) => sum + (c.views_count || 0), 0);
        const totalLikes = contents.reduce((sum, c) => sum + (c.likes_count || 0), 0);
        const avgEngagement = contents.length > 0 ? (totalLikes / totalViews) * 100 : 0;

        // Determine next milestone
        let nextMilestone = { target: 100, current: totalViews, reward: "+50 pontos, +R$ 5,00" };
        if (totalViews >= 1000) {
          nextMilestone = { target: 5000, current: totalViews, reward: "+500 pontos, +R$ 50,00" };
        } else if (totalViews >= 500) {
          nextMilestone = { target: 1000, current: totalViews, reward: "+200 pontos, +R$ 20,00" };
        } else if (totalViews >= 100) {
          nextMilestone = { target: 500, current: totalViews, reward: "+100 pontos, +R$ 10,00" };
        }

        creatorStats = {
          totalContents: contents.length,
          totalViews,
          totalLikes,
          avgEngagement,
          nextMilestone
        };
      }

      setStats({
        level,
        totalPoints,
        pointsToNextLevel,
        progressPercent,
        totalEarned: walletRes.data?.total_earned || 0,
        balance: walletRes.data?.balance || 0,
        currentStreak: streaksRes.data?.current_streak || 0,
        longestStreak: streaksRes.data?.longest_streak || 0,
        badges: badgesRes.data || [],
        engagementStats,
        creatorStats
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading || !stats) {
    return <GlobalLoader />;
  }

  const isCreator = role === 'creator' || role === 'admin';

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <Header variant="home" title="Minhas Recompensas" />

          <main className="container mx-auto px-4 py-8 pb-24 md:pb-8 space-y-6">
            {/* Hero Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Level Card */}
              <Card className="col-span-1 md:col-span-2 bg-gradient-to-br from-primary/10 to-accent/10 border-primary/20">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardDescription className="text-sm">Seu Nível</CardDescription>
                      <CardTitle className="text-5xl font-bold flex items-center gap-2">
                        <Trophy className="w-10 h-10 text-accent" />
                        {stats.level}
                      </CardTitle>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Pontos Totais</p>
                      <p className="text-3xl font-bold text-primary">{stats.totalPoints.toLocaleString()}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Progresso para Nível {stats.level + 1}</span>
                      <span className="font-semibold">{stats.pointsToNextLevel} pontos restantes</span>
                    </div>
                    <Progress value={stats.progressPercent} className="h-3" indicatorClassName="bg-gradient-to-r from-primary to-accent" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Continue engajando com conteúdos para ganhar mais pontos e subir de nível!
                  </p>
                </CardContent>
              </Card>

              {/* Balance Card */}
              <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/20">
                <CardHeader>
                  <CardDescription className="text-sm">Saldo Disponível</CardDescription>
                  <CardTitle className="text-4xl font-bold text-green-500 flex items-center gap-2">
                    <DollarSign className="w-8 h-8" />
                    R$ {stats.balance.toFixed(2)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Separator className="my-3" />
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Ganho</span>
                      <span className="font-semibold">R$ {stats.totalEarned.toFixed(2)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Streak & Badges */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Streak Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Flame className="w-6 h-6 text-orange-500" />
                    <CardTitle>Sequência de Login</CardTitle>
                  </div>
                  <CardDescription>Continue sua sequência diária para ganhar bônus</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Sequência Atual</p>
                      <p className="text-3xl font-bold text-orange-500">{stats.currentStreak} dias</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Melhor Sequência</p>
                      <p className="text-3xl font-bold">{stats.longestStreak} dias</p>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                    <p className="text-sm flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      <span>Próxima recompensa em <strong>{Math.max(0, 7 - (stats.currentStreak % 7))} dias</strong></span>
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Badges Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Award className="w-6 h-6 text-accent" />
                    <CardTitle>Conquistas</CardTitle>
                  </div>
                  <CardDescription>Badges conquistadas</CardDescription>
                </CardHeader>
                <CardContent>
                  {stats.badges.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Award className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Nenhuma badge conquistada ainda</p>
                      <p className="text-xs">Continue engajando para desbloquear conquistas!</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {stats.badges.map((badge: any) => (
                        <div key={badge.id} className="flex flex-col items-center gap-2 p-3 rounded-lg bg-accent/10 border border-accent/20">
                          <Award className="w-8 h-8 text-accent" />
                          <span className="text-xs font-medium text-center">{badge.badges.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Engagement Stats */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Zap className="w-6 h-6 text-primary" />
                  <CardTitle>Estatísticas de Engajamento</CardTitle>
                </div>
                <CardDescription>Suas atividades na plataforma</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-pink-500">
                      <Heart className="w-5 h-5" />
                      <span className="text-sm font-medium">Curtidas</span>
                    </div>
                    <p className="text-3xl font-bold">{stats.engagementStats.likes}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-blue-500">
                      <Bookmark className="w-5 h-5" />
                      <span className="text-sm font-medium">Salvos</span>
                    </div>
                    <p className="text-3xl font-bold">{stats.engagementStats.saves}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-purple-500">
                      <MessageSquare className="w-5 h-5" />
                      <span className="text-sm font-medium">Comentários</span>
                    </div>
                    <p className="text-3xl font-bold">{stats.engagementStats.comments}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-green-500">
                      <Target className="w-5 h-5" />
                      <span className="text-sm font-medium">Completados</span>
                    </div>
                    <p className="text-3xl font-bold">{stats.engagementStats.completedContents}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Creator Stats */}
            {isCreator && stats.creatorStats && (
              <>
                <div className="pt-6">
                  <div className="flex items-center gap-2 mb-6">
                    <Star className="w-6 h-6 text-accent" />
                    <h2 className="text-2xl font-bold">Estatísticas de Creator</h2>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Video className="w-4 h-4" />
                        <CardDescription>Conteúdos</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-3xl font-bold">{stats.creatorStats.totalContents}</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Eye className="w-4 h-4" />
                        <CardDescription>Visualizações</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-3xl font-bold">{stats.creatorStats.totalViews.toLocaleString()}</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Heart className="w-4 h-4" />
                        <CardDescription>Curtidas</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-3xl font-bold">{stats.creatorStats.totalLikes.toLocaleString()}</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <BarChart3 className="w-4 h-4" />
                        <CardDescription>Engajamento</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-3xl font-bold">{stats.creatorStats.avgEngagement.toFixed(1)}%</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Next Milestone */}
                <Card className="bg-gradient-to-br from-accent/10 to-primary/10 border-accent/20">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-6 h-6 text-accent" />
                      <CardTitle>Próximo Milestone</CardTitle>
                    </div>
                    <CardDescription>Continue criando para alcançar a próxima recompensa</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-sm text-muted-foreground">Meta</p>
                        <p className="text-2xl font-bold">{stats.creatorStats.nextMilestone.target.toLocaleString()} views</p>
                      </div>
                      <Badge variant="secondary" className="text-lg px-4 py-2">
                        {stats.creatorStats.nextMilestone.reward}
                      </Badge>
                    </div>
                    <Progress 
                      value={(stats.creatorStats.nextMilestone.current / stats.creatorStats.nextMilestone.target) * 100} 
                      className="h-3"
                      indicatorClassName="bg-gradient-to-r from-accent to-primary"
                    />
                    <p className="text-sm text-muted-foreground">
                      Faltam <strong>{(stats.creatorStats.nextMilestone.target - stats.creatorStats.nextMilestone.current).toLocaleString()} views</strong> para alcançar este milestone
                    </p>
                  </CardContent>
                </Card>
              </>
            )}

            {/* Link to Detailed History */}
            <Card className="mt-6">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Histórico Detalhado</h3>
                    <p className="text-sm text-muted-foreground">
                      Veja todas as suas recompensas com filtros avançados
                    </p>
                  </div>
                  <Button onClick={() => navigate('/rewards-history')}>
                    Ver Histórico Completo
                  </Button>
                </div>
              </CardContent>
            </Card>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

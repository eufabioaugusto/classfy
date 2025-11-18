import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { Video, Eye, Users, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function Studio() {
  const { user, role, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }

  if (!user || (role !== 'creator' && role !== 'admin')) {
    return <Navigate to="/" replace />;
  }

  const [stats, setStats] = useState({
    totalContents: 0,
    totalViews: 0,
    followers: 0,
    earnings: 0,
    points: 0
  });

  useEffect(() => {
    if (user) {
      fetchStats();
    }
  }, [user]);

  const fetchStats = async () => {
    if (!user) return;

    try {
      // Total de conteúdos aprovados
      const { count: contentsCount } = await supabase
        .from('contents')
        .select('*', { count: 'exact', head: true })
        .eq('creator_id', user.id);

      // Total de visualizações
      const { data: contents } = await supabase
        .from('contents')
        .select('views_count')
        .eq('creator_id', user.id);

      const totalViews = contents?.reduce((sum, c) => sum + (c.views_count || 0), 0) || 0;

      // Total de seguidores
      const { count: followersCount } = await supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', user.id);

      // Total ganhos
      const { data: wallet } = await supabase
        .from('wallets')
        .select('total_earned')
        .eq('user_id', user.id)
        .single();

      // Total de pontos
      const { data: rewardEvents } = await supabase
        .from('reward_events')
        .select('points')
        .eq('user_id', user.id);

      const totalPoints = rewardEvents?.reduce((sum, event) => sum + (event.points || 0), 0) || 0;

      setStats({
        totalContents: contentsCount || 0,
        totalViews,
        followers: followersCount || 0,
        earnings: wallet?.total_earned || 0,
        points: totalPoints
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const statsDisplay = [
    { label: "Total de Conteúdos", value: stats.totalContents.toString(), icon: Video, color: "text-blue-500" },
    { label: "Visualizações Totais", value: stats.totalViews.toString(), icon: Eye, color: "text-green-500" },
    { label: "Seguidores", value: stats.followers.toString(), icon: Users, color: "text-purple-500" },
    { label: "Ganhos (em dobro)", value: `R$ ${(stats.earnings * 2).toFixed(2)}`, icon: TrendingUp, color: "text-cinematic-accent" },
  ];

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          <Header variant="studio" title="Studio Classfy" />

          <main className="flex-1 p-6 md:p-12">
            <div className="max-w-7xl mx-auto space-y-8">
              <div>
                <h2 className="text-3xl font-bold text-foreground mb-2">Bem-vindo ao Studio!</h2>
                <p className="text-muted-foreground">
                  Gerencie seus conteúdos, acompanhe métricas e publique novos materiais.
                </p>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {statsDisplay.map((stat) => (
                  <Card key={stat.label} className="p-6 bg-card border-border">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
                        <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                      </div>
                      <stat.icon className={`w-8 h-8 ${stat.color}`} />
                    </div>
                  </Card>
                ))}
              </div>

              {/* Empty State */}
              <Card className="p-12 text-center bg-card border-border border-dashed">
                <Video className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-xl font-bold text-foreground mb-2">
                  Nenhum conteúdo publicado ainda
                </h3>
                <p className="text-muted-foreground mb-6">
                  Comece criando seu primeiro conteúdo na Classfy
                </p>
              </Card>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

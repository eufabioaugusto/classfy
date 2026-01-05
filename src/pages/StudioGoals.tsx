import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Header } from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { CreatorMilestoneItem } from '@/components/CreatorMilestoneItem';
import { useCreatorMilestones } from '@/hooks/useCreatorMilestones';
import { useIsMobile } from '@/hooks/use-mobile';
import { 
  Trophy, 
  Video, 
  Users, 
  Wallet, 
  Eye, 
  Heart,
  TrendingUp,
  Target,
  Medal,
  ArrowLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function StudioGoals() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('all');

  const {
    milestones,
    milestonesByType,
    stats,
    loading,
    claiming,
    claimMilestone,
    totals
  } = useCreatorMilestones(user?.id);

  if (authLoading || loading) {
    return (
      <SidebarProvider>
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col">
            <Header />
            <main className="flex-1 p-4 md:p-6 space-y-6">
              <Skeleton className="h-8 w-64" />
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-24" />
                ))}
              </div>
              <Skeleton className="h-32" />
              <Skeleton className="h-64" />
            </main>
          </div>
        </div>
      </SidebarProvider>
    );
  }

  if (!user) {
    navigate('/auth');
    return null;
  }

  const overallProgress = totals.total > 0 
    ? Math.round((totals.claimed / totals.total) * 100) 
    : 0;

  const tabs = [
    { id: 'all', label: 'Todas', icon: Trophy, count: milestones.length },
    { id: 'contents', label: 'Produção', icon: Video, count: milestonesByType.contents.length },
    { id: 'followers', label: 'Audiência', icon: Users, count: milestonesByType.followers.length },
    { id: 'earnings', label: 'Monetização', icon: Wallet, count: milestonesByType.earnings.length },
    { id: 'views', label: 'Alcance', icon: Eye, count: milestonesByType.views.length },
    { id: 'engagement', label: 'Engajamento', icon: Heart, count: milestonesByType.engagement.length },
  ];

  const getFilteredMilestones = () => {
    if (activeTab === 'all') return milestones;
    return milestonesByType[activeTab as keyof typeof milestonesByType] || [];
  };

  const filteredMilestones = getFilteredMilestones();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <Header />
          <main className="flex-1 p-4 md:p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => navigate('/studio')}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Target className="w-6 h-6 text-primary" />
                  Metas do Creator
                </h1>
                <p className="text-muted-foreground">
                  Alcance metas e ganhe recompensas exclusivas
                </p>
              </div>
            </div>

            {/* Stats Grid */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard
                  icon={Video}
                  label="Conteúdos Publicados"
                  value={stats.totalContents}
                  color="text-blue-500"
                  bgColor="bg-blue-500/10"
                />
                <StatCard
                  icon={Users}
                  label="Seguidores"
                  value={stats.totalFollowers.toLocaleString('pt-BR')}
                  color="text-purple-500"
                  bgColor="bg-purple-500/10"
                />
                <StatCard
                  icon={Wallet}
                  label="Ganhos Totais"
                  value={`R$ ${stats.totalEarnings.toLocaleString('pt-BR')}`}
                  color="text-green-500"
                  bgColor="bg-green-500/10"
                />
                <StatCard
                  icon={Eye}
                  label="Visualizações"
                  value={stats.totalViews.toLocaleString('pt-BR')}
                  color="text-orange-500"
                  bgColor="bg-orange-500/10"
                />
                <StatCard
                  icon={Heart}
                  label="Taxa de Engajamento"
                  value={`${stats.engagementRate}%`}
                  color="text-red-500"
                  bgColor="bg-red-500/10"
                />
              </div>
            )}

            {/* Progress Overview */}
            <Card className="bg-gradient-to-r from-primary/10 via-primary/5 to-background border-primary/20">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-center gap-6">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center shrink-0">
                      <Medal className="w-10 h-10 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold mb-1">Seu Progresso Geral</h3>
                      <p className="text-muted-foreground text-sm mb-3">
                        Continue alcançando metas para desbloquear mais recompensas!
                      </p>
                      <Progress value={overallProgress} className="h-3" />
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-4 md:gap-6">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-primary">{totals.claimed}</p>
                      <p className="text-xs text-muted-foreground">Resgatadas</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold text-orange-500">{totals.pendingClaims}</p>
                      <p className="text-xs text-muted-foreground">Para Resgatar</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold">{totals.total - totals.completed}</p>
                      <p className="text-xs text-muted-foreground">Restantes</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className={cn(
                "w-full justify-start gap-1 bg-muted/50 p-1",
                isMobile ? "flex-wrap h-auto" : ""
              )}>
                {tabs.map((tab) => (
                  <TabsTrigger 
                    key={tab.id} 
                    value={tab.id}
                    className="gap-1.5 data-[state=active]:bg-background"
                  >
                    <tab.icon className="w-4 h-4" />
                    {!isMobile && tab.label}
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">
                      {tab.count}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value={activeTab} className="mt-6">
                <div className="space-y-4">
                  {filteredMilestones.length > 0 ? (
                    filteredMilestones.map((milestone) => (
                      <CreatorMilestoneItem
                        key={milestone.id}
                        milestone={milestone}
                        onClaim={claimMilestone}
                        claiming={claiming === milestone.id}
                      />
                    ))
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Trophy className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>Nenhuma meta encontrada nesta categoria.</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function StatCard({ 
  icon: Icon, 
  label, 
  value, 
  color,
  bgColor
}: { 
  icon: any; 
  label: string; 
  value: string | number; 
  color: string;
  bgColor: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center mb-3", bgColor)}>
          <Icon className={cn("w-5 h-5", color)} />
        </div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </CardContent>
    </Card>
  );
}

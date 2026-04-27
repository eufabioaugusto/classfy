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
import { CreatorAchievementBadge } from '@/components/CreatorAchievementBadge';
import { useCreatorMilestones } from '@/hooks/useCreatorMilestones';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Trophy,
  Video,
  Users,
  Wallet,
  Eye,
  Heart,
  Target,
  ArrowLeft,
  Award
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function ProgressIllustration() {
  return (
    <svg width="72" height="72" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <defs>
        <linearGradient id="pg-bg" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(347,77%,50%)" stopOpacity="0.18"/>
          <stop offset="1" stopColor="hsl(347,77%,60%)" stopOpacity="0.05"/>
        </linearGradient>
        <linearGradient id="pg-fig" x1="57" y1="18" x2="57" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(347,77%,58%)"/>
          <stop offset="1" stopColor="hsl(347,77%,42%)"/>
        </linearGradient>
      </defs>
      {/* Background */}
      <rect width="80" height="80" rx="18" fill="url(#pg-bg)"/>
      {/* Stairs */}
      <rect x="6" y="60" width="10" height="14" rx="2" fill="hsl(347,77%,50%)" fillOpacity="0.15"/>
      <rect x="19" y="50" width="10" height="24" rx="2" fill="hsl(347,77%,50%)" fillOpacity="0.2"/>
      <rect x="32" y="40" width="10" height="34" rx="2" fill="hsl(347,77%,50%)" fillOpacity="0.22"/>
      {/* Head */}
      <circle cx="57" cy="24" r="6" fill="url(#pg-fig)"/>
      {/* Body */}
      <rect x="52" y="30" width="10" height="11" rx="4" fill="url(#pg-fig)"/>
      {/* Left arm raised */}
      <path d="M53 32L44 23" stroke="hsl(347,77%,50%)" strokeWidth="3.5" strokeLinecap="round"/>
      {/* Right arm raised */}
      <path d="M62 32L71 23" stroke="hsl(347,77%,50%)" strokeWidth="3.5" strokeLinecap="round"/>
      {/* Legs */}
      <path d="M55 41L53 53" stroke="hsl(347,77%,46%)" strokeWidth="3" strokeLinecap="round"/>
      <path d="M59 41L61 53" stroke="hsl(347,77%,46%)" strokeWidth="3" strokeLinecap="round"/>
      {/* Star */}
      <path d="M57 6L58.8 11.8H64.8L60 15.3L61.8 21.1L57 17.7L52.2 21.1L54 15.3L49.2 11.8H55.2L57 6Z" fill="hsl(45,93%,47%)"/>
      {/* Sparkles */}
      <circle cx="20" cy="28" r="2.5" fill="hsl(45,93%,47%)" fillOpacity="0.7"/>
      <circle cx="13" cy="44" r="1.5" fill="hsl(347,77%,50%)" fillOpacity="0.45"/>
      <circle cx="74" cy="44" r="1.5" fill="hsl(45,93%,47%)" fillOpacity="0.6"/>
      <circle cx="70" cy="32" r="2" fill="hsl(347,77%,50%)" fillOpacity="0.3"/>
    </svg>
  );
}

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
              <CardContent className="p-5">
                <div className="flex flex-col md:flex-row md:items-center gap-5">
                  <div className="flex items-center gap-4 flex-1">
                    <ProgressIllustration />
                    <div className="flex-1">
                      <h3 className="text-base font-bold mb-0.5">Seu Progresso Geral</h3>
                      <p className="text-muted-foreground text-xs mb-2.5">
                        Continue alcançando metas para desbloquear mais recompensas!
                      </p>
                      <Progress value={overallProgress} className="h-2" />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4 md:gap-6">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-primary">{totals.claimed}</p>
                      <p className="text-xs text-muted-foreground">Resgatadas</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-orange-500">{totals.pendingClaims}</p>
                      <p className="text-xs text-muted-foreground">Para Resgatar</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold">{totals.total - totals.completed}</p>
                      <p className="text-xs text-muted-foreground">Restantes</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Achievement Badges Section */}
            <Card className="overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Award className="w-5 h-5 text-primary" />
                  Suas Conquistas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="unlocked">
                  <TabsList className="w-full grid grid-cols-2 mb-4">
                    <TabsTrigger value="unlocked" className="gap-1.5">
                      Desbloqueadas
                      <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded-full text-xs">
                        {milestones.filter(m => m.isClaimed).length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="locked" className="gap-1.5">
                      Bloqueadas
                      <span className="bg-muted px-1.5 py-0.5 rounded-full text-xs">
                        {milestones.filter(m => !m.isClaimed).length}
                      </span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="unlocked" className="mt-0">
                    {milestones.filter(m => m.isClaimed).length > 0 ? (
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                        {milestones.filter(m => m.isClaimed).map((milestone) => (
                          <CreatorAchievementBadge
                            key={milestone.id}
                            milestone={milestone}
                            size="md"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">Nenhuma conquista desbloqueada ainda</p>
                        <p className="text-xs mt-1">Complete metas para ganhar selos!</p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="locked" className="mt-0">
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                      {milestones.filter(m => !m.isClaimed).map((milestone) => (
                        <CreatorAchievementBadge
                          key={milestone.id}
                          milestone={milestone}
                          size="md"
                        />
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Milestones List Tabs */}
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

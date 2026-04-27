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
    <svg width="100" height="100" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <defs>
        <linearGradient id="sf" x1="60" y1="18" x2="60" y2="96" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F0546C"/>
          <stop offset="1" stopColor="#B01C38"/>
        </linearGradient>
      </defs>

      {/* Soft halo behind star */}
      <ellipse cx="61" cy="62" rx="44" ry="40" fill="#E8395A" fillOpacity="0.12"/>

      {/* Star body */}
      <path
        d="M60,18 L70,46 L100,46 L78,64 L86,93 L60,76 L34,93 L42,64 L20,46 L50,46 Z"
        fill="url(#sf)"
        stroke="#7C1428"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Highlight on top-left of star */}
      <path d="M44,30 Q54,20 65,29 Q60,38 54,36 Q48,38 44,30 Z" fill="white" fillOpacity="0.16"/>

      {/* Left eye */}
      <ellipse cx="49" cy="55" rx="4" ry="4.5" fill="#1E0509"/>
      <circle cx="47.5" cy="53" r="1.6" fill="white"/>

      {/* Right eye */}
      <ellipse cx="71" cy="55" rx="4" ry="4.5" fill="#1E0509"/>
      <circle cx="69.5" cy="53" r="1.6" fill="white"/>

      {/* Smile */}
      <path d="M49 65 Q60 76 71 65" stroke="#1E0509" strokeWidth="2.5" strokeLinecap="round" fill="none"/>

      {/* Cheek blush */}
      <ellipse cx="41" cy="65" rx="6" ry="3.5" fill="#FFB3C0" fillOpacity="0.55"/>
      <ellipse cx="79" cy="65" rx="6" ry="3.5" fill="#FFB3C0" fillOpacity="0.55"/>

      {/* Gold 4-point star — top right */}
      <path d="M97 17 L99 23 L105 25 L99 27 L97 33 L95 27 L89 25 L95 23 Z" fill="#FFD700"/>

      {/* Gold 4-point star — bottom left */}
      <path d="M14 72 L15.5 76.5 L20 78 L15.5 79.5 L14 84 L12.5 79.5 L8 78 L12.5 76.5 Z" fill="#FFD700" fillOpacity="0.9"/>

      {/* Small accent star — bottom right */}
      <path d="M105 82 L106.2 85.5 L110 87 L106.2 88.5 L105 92 L103.8 88.5 L100 87 L103.8 85.5 Z" fill="#F0546C" fillOpacity="0.8"/>

      {/* Dots */}
      <circle cx="108" cy="47" r="3" fill="#FFD700" fillOpacity="0.9"/>
      <circle cx="10" cy="38" r="2.5" fill="#FFD700" fillOpacity="0.75"/>
      <circle cx="15" cy="94" r="2" fill="#F0546C" fillOpacity="0.65"/>
      <circle cx="105" cy="97" r="2" fill="#FFD700" fillOpacity="0.7"/>

      {/* Squiggly right */}
      <path d="M111 61 C114 57 117 64 114 68" stroke="#F0546C" strokeWidth="2" strokeLinecap="round" fill="none" fillOpacity="0.6"/>

      {/* Squiggly left */}
      <path d="M5 55 C2 51 5 45 8 49" stroke="#FFD700" strokeWidth="1.8" strokeLinecap="round" fill="none" fillOpacity="0.75"/>
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
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Award className="w-5 h-5 text-primary" />
                  Suas Conquistas
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
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
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-5 pt-2">
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
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-5 pt-2">
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

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
    <svg width="110" height="106" viewBox="0 0 220 212" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <defs>
        <radialGradient id="pg-blob" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFBCC8"/>
          <stop offset="55%" stopColor="#FFD6DF"/>
          <stop offset="100%" stopColor="#FFF0F3" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="pg-star" x1="110" y1="32" x2="110" y2="166" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF3D55"/>
          <stop offset="1" stopColor="#C41030"/>
        </linearGradient>
      </defs>

      {/* Organic blob */}
      <path d="M30,102 C16,70 36,20 76,13 C96,8 118,16 142,12 C167,7 190,30 200,58
               C210,84 205,110 197,134 C188,162 170,182 145,193
               C120,204 92,205 68,193 C42,179 20,155 16,128 C13,110 20,108 30,102 Z"
            fill="url(#pg-blob)"/>

      {/* Drip at bottom */}
      <ellipse cx="110" cy="200" rx="11" ry="9" fill="#FFCCD6" fillOpacity="0.55"/>

      {/* Star body */}
      <path d="M110,32 L127,85 L181,86 L138,114 L153,166 L110,138 L67,166 L82,114 L39,86 L93,85 Z"
            fill="url(#pg-star)" stroke="#1C0007" strokeWidth="3.5" strokeLinejoin="round"/>

      {/* Left eye — dot */}
      <circle cx="96" cy="107" r="4.5" fill="#1C0007"/>

      {/* Right eye — wink ">" */}
      <path d="M117,102 L125,108 L117,114" stroke="#1C0007" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>

      {/* Open mouth smile */}
      <path d="M97,122 Q110,136 123,122" stroke="#1C0007" strokeWidth="3" strokeLinecap="round" fill="none"/>
      {/* Mouth fill (subtle) */}
      <path d="M97,122 Q110,136 123,122 Z" fill="#1C0007" fillOpacity="0.1"/>

      {/* Top-left looping squiggle */}
      <path d="M56,56 C43,38 18,36 13,50 C8,66 24,76 37,66
               C50,56 43,37 30,40 C22,43 19,52 24,58"
            stroke="#1C0007" strokeWidth="2.5" strokeLinecap="round" fill="none"/>

      {/* Top-right: exclamation mark */}
      <line x1="163" y1="28" x2="163" y2="41" stroke="#1C0007" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="163" cy="47" r="2" fill="#1C0007"/>
      {/* Top-right: small stroke + dot */}
      <line x1="173" y1="26" x2="175" y2="34" stroke="#1C0007" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="176" cy="38" r="1.5" fill="#1C0007" fillOpacity="0.7"/>
      {/* Top-right: curved arc */}
      <path d="M178,47 Q187,40 192,49" stroke="#1C0007" strokeWidth="2" strokeLinecap="round" fill="none"/>
      {/* Top-right: small confetti rect */}
      <rect x="154" y="20" width="9" height="6" rx="2" fill="#C41030" opacity="0.85" transform="rotate(14,158,23)"/>

      {/* Left: outlined star */}
      <path d="M24,142 L27,151 L36.5,151 L29.5,157 L32.5,166 L24,161 L15.5,166 L18.5,157 L11.5,151 L21,151 Z"
            stroke="#1C0007" strokeWidth="2" strokeLinejoin="round" fill="white"/>

      {/* Bottom-right: spiral squiggle */}
      <path d="M168,163 C179,150 194,154 191,169 C188,184 171,189 163,177
               C157,167 164,157 175,162 C183,167 179,180 168,181"
            stroke="#1C0007" strokeWidth="2.5" strokeLinecap="round" fill="none"/>

      {/* Bottom: small arc */}
      <path d="M80,192 Q92,200 104,195" stroke="#1C0007" strokeWidth="2" strokeLinecap="round" fill="none"/>

      {/* Small confetti bottom-left */}
      <rect x="50" y="177" width="8" height="5" rx="1.5" fill="#FF3D55" opacity="0.7" transform="rotate(-22,54,180)"/>

      {/* Dot top-left corner */}
      <circle cx="42" cy="26" r="2.5" fill="#1C0007" fillOpacity="0.35"/>
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
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-5 pt-2 pb-6">
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
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-5 pt-2 pb-6">
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

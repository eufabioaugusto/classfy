import { Trophy, TrendingUp, ChevronRight, Video, Users, Wallet, Eye, Heart } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreatorMilestoneItem } from '@/components/CreatorMilestoneItem';
import { useCreatorMilestones, type MilestoneWithProgress } from '@/hooks/useCreatorMilestones';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface CreatorMilestonesCardProps {
  creatorId: string;
  compact?: boolean;
  showHeader?: boolean;
  maxItems?: number;
}

export function CreatorMilestonesCard({ 
  creatorId, 
  compact = false,
  showHeader = true,
  maxItems = 3
}: CreatorMilestonesCardProps) {
  const { 
    nextMilestones, 
    stats, 
    loading, 
    claiming, 
    claimMilestone,
    totals 
  } = useCreatorMilestones(creatorId);
  const navigate = useNavigate();

  if (loading) {
    return (
      <Card>
        {showHeader && (
          <CardHeader className="pb-3">
            <Skeleton className="h-6 w-40" />
          </CardHeader>
        )}
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  const displayedMilestones = nextMilestones.slice(0, maxItems);
  const overallProgress = totals.total > 0 
    ? Math.round((totals.claimed / totals.total) * 100) 
    : 0;

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'contents': return Video;
      case 'followers': return Users;
      case 'earnings': return Wallet;
      case 'views': return Eye;
      case 'engagement': return Heart;
      default: return Trophy;
    }
  };

  if (compact) {
    return (
      <Card>
        {showHeader && (
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Trophy className="w-5 h-5 text-primary" />
                Metas do Creator
              </CardTitle>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => navigate('/studio/goals')}
                className="text-xs"
              >
                Ver todas
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardHeader>
        )}
        <CardContent className="space-y-2">
          {/* Progress summary */}
          <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50 mb-3">
            <div className="flex-1">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-muted-foreground">Progresso geral</span>
                <span className="font-medium">{totals.claimed}/{totals.total}</span>
              </div>
              <Progress value={overallProgress} className="h-1.5" />
            </div>
            {totals.pendingClaims > 0 && (
              <div className="shrink-0 px-2 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                {totals.pendingClaims} para resgatar
              </div>
            )}
          </div>

          {displayedMilestones.map((milestone) => (
            <CreatorMilestoneItem
              key={milestone.id}
              milestone={milestone}
              onClaim={claimMilestone}
              claiming={claiming === milestone.id}
              compact
            />
          ))}

          {displayedMilestones.length === 0 && (
            <div className="text-center py-4 text-muted-foreground">
              <Trophy className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Todas as metas foram alcançadas!</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {showHeader && (
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-primary" />
              Metas do Creator
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => navigate('/studio/goals')}
            >
              Ver todas as metas
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </CardHeader>
      )}
      <CardContent>
        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <StatCard
              icon={Video}
              label="Conteúdos"
              value={stats.totalContents}
              color="text-blue-500"
            />
            <StatCard
              icon={Users}
              label="Seguidores"
              value={stats.totalFollowers}
              color="text-purple-500"
            />
            <StatCard
              icon={Wallet}
              label="Ganhos"
              value={`R$ ${stats.totalEarnings.toLocaleString('pt-BR')}`}
              color="text-green-500"
            />
            <StatCard
              icon={Eye}
              label="Views"
              value={stats.totalViews.toLocaleString('pt-BR')}
              color="text-orange-500"
            />
            <StatCard
              icon={Heart}
              label="Engajamento"
              value={`${stats.engagementRate}%`}
              color="text-red-500"
            />
          </div>
        )}

        {/* Progress summary */}
        <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 mb-6">
          <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">Seu Progresso</h3>
            <p className="text-sm text-muted-foreground">
              {totals.claimed} de {totals.total} metas alcançadas
              {totals.pendingClaims > 0 && (
                <span className="text-primary font-medium ml-1">
                  • {totals.pendingClaims} aguardando resgate!
                </span>
              )}
            </p>
            <Progress value={overallProgress} className="h-2 mt-2" />
          </div>
          <div className="text-right">
            <span className="text-3xl font-bold text-primary">{overallProgress}%</span>
          </div>
        </div>

        {/* Next milestones */}
        <div className="space-y-4">
          <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
            Próximas Metas
          </h4>
          {displayedMilestones.map((milestone) => (
            <CreatorMilestoneItem
              key={milestone.id}
              milestone={milestone}
              onClaim={claimMilestone}
              claiming={claiming === milestone.id}
            />
          ))}
          
          {displayedMilestones.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Trophy className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Parabéns! Você alcançou todas as metas!</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ 
  icon: Icon, 
  label, 
  value, 
  color 
}: { 
  icon: any; 
  label: string; 
  value: string | number; 
  color: string;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/50 text-center">
      <Icon className={cn("w-5 h-5 mx-auto mb-1", color)} />
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

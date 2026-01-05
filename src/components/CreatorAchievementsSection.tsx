import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreatorAchievementBadge } from './CreatorAchievementBadge';
import { Trophy, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MilestoneWithProgress } from '@/hooks/useCreatorMilestones';
import { useNavigate } from 'react-router-dom';

interface CreatorAchievementsSectionProps {
  milestones: MilestoneWithProgress[];
  className?: string;
}

export function CreatorAchievementsSection({ milestones, className }: CreatorAchievementsSectionProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'unlocked' | 'locked'>('unlocked');

  const unlockedMilestones = milestones.filter(m => m.isClaimed);
  const lockedMilestones = milestones.filter(m => !m.isClaimed);

  const displayedMilestones = activeTab === 'unlocked' ? unlockedMilestones : lockedMilestones;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="w-5 h-5 text-primary" />
            Suas Conquistas
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => navigate('/studio/goals')}
            className="text-xs gap-1"
          >
            Ver Todas
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'unlocked' | 'locked')}>
          <TabsList className="w-full grid grid-cols-2 mb-4">
            <TabsTrigger value="unlocked" className="gap-1.5">
              Conquistadas
              <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded-full text-xs">
                {unlockedMilestones.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="locked" className="gap-1.5">
              Bloqueadas
              <span className="bg-muted px-1.5 py-0.5 rounded-full text-xs">
                {lockedMilestones.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-0">
            {displayedMilestones.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                {displayedMilestones.map((milestone) => (
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
                <p className="text-sm">
                  {activeTab === 'unlocked' 
                    ? 'Nenhuma conquista desbloqueada ainda'
                    : 'Todas as conquistas foram desbloqueadas! 🎉'
                  }
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

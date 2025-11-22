import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Award } from "lucide-react";

interface UserStats {
  level: number;
  totalPoints: number;
}

interface BadgeData {
  id: string;
  name: string;
  description: string;
  icon_url: string | null;
  earned_at: string;
}

interface UserBadgesProps {
  userId: string;
}

export function UserBadges({ userId }: UserBadgesProps) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [badges, setBadges] = useState<BadgeData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUserData();
  }, [userId]);

  const fetchUserData = async () => {
    try {
      // Fetch points from reward_events (source of truth)
      const { data: rewardEvents } = await supabase
        .from('reward_events')
        .select('points')
        .eq('user_id', userId);

      const totalPoints = rewardEvents?.reduce((sum, event) => sum + event.points, 0) || 0;
      const level = Math.floor(totalPoints / 1000) + 1;

      setStats({ level, totalPoints });

      // Fetch user badges
      const { data: badgesData } = await supabase
        .from('user_badges')
        .select(`
          earned_at,
          badges (
            id,
            name,
            description,
            icon_url
          )
        `)
        .eq('user_id', userId);

      if (badgesData) {
        const formattedBadges = badgesData.map((item: any) => ({
          id: item.badges.id,
          name: item.badges.name,
          description: item.badges.description,
          icon_url: item.badges.icon_url,
          earned_at: item.earned_at,
        }));
        setBadges(formattedBadges);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">Carregando...</p>
      </Card>
    );
  }

  const currentPoints = stats?.totalPoints || 0;
  const currentLevel = stats?.level || 1;
  const pointsInCurrentLevel = currentPoints % 1000;
  const pointsToNextLevel = 1000 - pointsInCurrentLevel;
  const progressPercent = (pointsInCurrentLevel / 1000) * 100;

  return (
    <div className="space-y-6">
      {/* Level Card */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-primary/10 rounded-lg">
            <Trophy className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="text-xl font-bold">Nível {currentLevel}</h3>
            <p className="text-sm text-muted-foreground">
              {currentPoints.toLocaleString('pt-BR')} pontos totais
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Progresso para o Nível {currentLevel + 1}</span>
            <span>{Math.floor(progressPercent)}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-primary to-primary/60 h-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-right">
            {pointsToNextLevel} pontos para o próximo nível
          </p>
        </div>
      </Card>

      {/* Badges Card */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Award className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-bold">Conquistas</h3>
          <Badge variant="secondary">{badges.length}</Badge>
        </div>

        {badges.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {badges.map((badge) => (
              <div
                key={badge.id}
                className="flex flex-col items-center p-4 bg-muted/30 rounded-lg text-center"
              >
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                  {badge.icon_url ? (
                    <img src={badge.icon_url} alt={badge.name} className="w-10 h-10" />
                  ) : (
                    <Award className="w-8 h-8 text-primary" />
                  )}
                </div>
                <h4 className="font-semibold text-sm">{badge.name}</h4>
                <p className="text-xs text-muted-foreground mt-1">{badge.description}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {new Date(badge.earned_at).toLocaleDateString('pt-BR')}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Award className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Nenhuma conquista ainda</p>
            <p className="text-sm">Continue interagindo para ganhar badges!</p>
          </div>
        )}
      </Card>
    </div>
  );
}

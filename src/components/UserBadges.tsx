import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Award } from "lucide-react";

interface UserLevel {
  current_level: number;
  total_points: number;
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
  const [level, setLevel] = useState<UserLevel | null>(null);
  const [badges, setBadges] = useState<BadgeData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUserData();
  }, [userId]);

  const fetchUserData = async () => {
    try {
      // Fetch user level
      const { data: levelData } = await supabase
        .from('user_levels')
        .select('current_level, total_points')
        .eq('user_id', userId)
        .maybeSingle();

      setLevel(levelData);

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

  const getNextLevelPoints = (currentLevel: number) => {
    // Define thresholds for levels
    const thresholds = [0, 1000, 2500, 5000, 10000, 20000, 50000];
    return thresholds[currentLevel] || thresholds[thresholds.length - 1] * 2;
  };

  if (loading) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">Carregando...</p>
      </Card>
    );
  }

  const currentPoints = level?.total_points || 0;
  const currentLevel = level?.current_level || 1;
  const nextLevelPoints = getNextLevelPoints(currentLevel);
  const progressPercent = Math.min((currentPoints / nextLevelPoints) * 100, 100);

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
            {nextLevelPoints - currentPoints} pontos para o próximo nível
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

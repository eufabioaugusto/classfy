import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Play, Wallet, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";

interface CreatorStatsCardProps {
  userId: string;
  collapsed?: boolean;
}

interface WalletData {
  balance: number;
  total_earned: number;
}

interface StatsData {
  totalPoints: number;
  level: number;
  contentCount: number;
  performancePoints: number;
}

export const CreatorStatsCard = ({ userId, collapsed }: CreatorStatsCardProps) => {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [stats, setStats] = useState<StatsData>({ totalPoints: 0, level: 1, contentCount: 0, performancePoints: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: walletData } = await supabase
          .from("wallets")
          .select("balance, total_earned")
          .eq("user_id", userId)
          .single();

        if (walletData) {
          setWallet(walletData);
        }

        const { data: rewardEventsData } = await supabase.from("reward_events").select("points, performance_points").eq("user_id", userId);
        const totalPoints = rewardEventsData?.reduce((sum, event) => sum + event.points, 0) || 0;
        const performancePoints = rewardEventsData?.reduce((sum, event) => sum + (Number(event.performance_points) || 0), 0) || 0;

        const { count: contentCount } = await supabase
          .from("contents")
          .select("*", { count: "exact", head: true })
          .eq("creator_id", userId);

        const getPointsForLevel = (n: number) => 500 * n * (n - 1) / 2;
        let level = 1;
        while (getPointsForLevel(level + 1) <= totalPoints) level++;

        setStats({
          totalPoints,
          level,
          contentCount: contentCount || 0,
          performancePoints,
        });
      } catch (error) {
        console.error("Erro ao buscar estatísticas:", error);
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      fetchData();
    }
  }, [userId]);

  const getPointsForLevel = (n: number) => 500 * n * (n - 1) / 2;
  const pointsAtCurrentLevel = getPointsForLevel(stats.level);
  const pointsNeededForNext = getPointsForLevel(stats.level + 1) - pointsAtCurrentLevel;
  const pointsInCurrentLevel = stats.totalPoints - pointsAtCurrentLevel;
  const progressToNextLevel = (pointsInCurrentLevel / pointsNeededForNext) * 100;

  if (loading) {
    return (
      <Card className="p-4 animate-pulse border-border/50">
        <div className="h-20 bg-muted rounded" />
      </Card>
    );
  }

  if (collapsed) {
    return (
      <div className="flex flex-col gap-2 px-2">
        <div className="flex items-center justify-center p-2 rounded-md bg-primary/10 border border-primary/20">
          <Zap className="h-4 w-4 text-primary" />
        </div>
        <div className="flex items-center justify-center p-2 rounded-md bg-muted border border-border">
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    );
  }

  const nextLevel = stats.level + 1;
  const remaining = Math.ceil(pointsNeededForNext - pointsInCurrentLevel);

  return (
    <Card className="border-border/50 bg-card overflow-hidden">
      {/* Level + Progress */}
      <div className="p-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-foreground">Nível {stats.level}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {stats.totalPoints.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} pts
              </span>
            </div>
            <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progressToNextLevel}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
              {remaining.toLocaleString('pt-BR')} pts para nível {nextLevel}
            </p>
          </div>
        </div>
      </div>

      {/* Stats List */}
      <div className="divide-y divide-border/50 border-t border-border/50">
        {/* Earnings */}
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Saldo</span>
          </div>
          <span className="text-sm font-semibold text-foreground tabular-nums">
            R$ {(wallet?.balance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
        </div>

        {/* Contents */}
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Play className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Conteúdos</span>
          </div>
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {stats.contentCount}
          </span>
        </div>
      </div>
    </Card>
  );
};

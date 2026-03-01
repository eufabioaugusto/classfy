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
  const [stats, setStats] = useState<StatsData>({ totalPoints: 0, level: 1, contentCount: 0 });
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

        const { data: rewardEventsData } = await supabase.from("reward_events").select("points").eq("user_id", userId);
        const totalPoints = rewardEventsData?.reduce((sum, event) => sum + event.points, 0) || 0;

        const { count: contentCount } = await supabase
          .from("contents")
          .select("*", { count: "exact", head: true })
          .eq("creator_id", userId);

        const level = Math.floor(totalPoints / 1000) + 1;

        setStats({
          totalPoints,
          level,
          contentCount: contentCount || 0,
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

  const pointsInCurrentLevel = stats.totalPoints % 1000;
  const progressToNextLevel = (pointsInCurrentLevel / 1000) * 100;

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

  return (
    <Card className="border-border/50 bg-card overflow-hidden">
      {/* Level Section */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nível</span>
          </div>
          <span className="text-2xl font-bold text-foreground">{stats.level}</span>
        </div>
        
        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progressToNextLevel}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{stats.totalPoints.toLocaleString()} XP</span>
            <span>{1000 - pointsInCurrentLevel} para próximo</span>
          </div>
        </div>
      </div>

      {/* Stats List */}
      <div className="divide-y divide-border/50">
        {/* Earnings */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Wallet className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Ganhos</span>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-sm font-semibold text-foreground whitespace-nowrap">
              R$ {(wallet?.total_earned || 0).toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground whitespace-nowrap">
              Saldo: R$ {(wallet?.balance || 0).toFixed(2)}
            </div>
          </div>
        </div>

        {/* Contents */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Play className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Conteúdos</span>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-sm font-semibold text-foreground">
              {stats.contentCount}
            </div>
            <div className="text-[10px] text-muted-foreground">
              publicados
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

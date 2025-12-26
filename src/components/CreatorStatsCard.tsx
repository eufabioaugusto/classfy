import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Play, Wallet, Flame, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

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
}

export const CreatorStatsCard = ({ userId, collapsed }: CreatorStatsCardProps) => {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [stats, setStats] = useState<StatsData>({ totalPoints: 0, level: 1, contentCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Busca wallet
        const { data: walletData } = await supabase
          .from("wallets")
          .select("balance, total_earned")
          .eq("user_id", userId)
          .single();

        if (walletData) {
          setWallet(walletData);
        }

        // Busca pontos totais
        const { data: rewardEventsData } = await supabase.from("reward_events").select("points").eq("user_id", userId);

        const totalPoints = rewardEventsData?.reduce((sum, event) => sum + event.points, 0) || 0;

        // Busca conteúdos criados
        const { count: contentCount } = await supabase
          .from("contents")
          .select("*", { count: "exact", head: true })
          .eq("creator_id", userId);

        // Calcula nível baseado em pontos (a cada 1000 pontos = 1 nível)
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

  // Calculate progress to next level (0-100%)
  const pointsInCurrentLevel = stats.totalPoints % 1000;
  const progressToNextLevel = (pointsInCurrentLevel / 1000) * 100;

  if (loading) {
    return (
      <Card className="p-3 animate-pulse">
        <div className="h-24 bg-muted rounded" />
      </Card>
    );
  }

  if (collapsed) {
    return (
      <div className="flex flex-col gap-2 px-2">
        <div className="flex items-center justify-center p-2 rounded-lg bg-gradient-to-br from-orange-500/20 to-red-500/20">
          <Flame className="h-4 w-4 text-orange-500" />
        </div>
        <div className="flex items-center justify-center p-2 rounded-lg bg-gradient-to-br from-emerald-500/20 to-green-500/20">
          <Wallet className="h-4 w-4 text-emerald-500" />
        </div>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden border-0 bg-gradient-to-br from-background via-background to-muted/30 shadow-lg">
      {/* Level Header with gradient */}
      <div className="relative px-4 py-3 bg-gradient-to-r from-orange-500/10 via-red-500/10 to-pink-500/10">
        <div className="absolute inset-0 bg-gradient-to-r from-orange-500/5 to-transparent" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl blur-sm opacity-50" />
              <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 shadow-lg">
                <Flame className="h-5 w-5 text-white" />
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nível</div>
              <div className="text-2xl font-black bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
                {stats.level}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">XP Total</div>
            <div className="text-lg font-bold text-foreground">{stats.totalPoints.toLocaleString()}</div>
          </div>
        </div>
        
        {/* Progress bar to next level */}
        <div className="mt-3 space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{pointsInCurrentLevel} / 1000 XP</span>
            <span>Próximo nível</span>
          </div>
          <div className="relative h-2 rounded-full bg-muted/50 overflow-hidden">
            <div 
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange-500 to-red-500 rounded-full transition-all duration-500"
              style={{ width: `${progressToNextLevel}%` }}
            />
            <div 
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-white/30 to-transparent rounded-full transition-all duration-500"
              style={{ width: `${progressToNextLevel}%` }}
            />
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="p-3 space-y-2">
        {/* Earnings Card */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-emerald-500/10 to-green-500/10 border border-emerald-500/20">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-green-500 shadow-md">
            <Wallet className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Ganhos Totais</div>
            <div className="text-lg font-bold text-emerald-500">
              R$ {wallet?.total_earned.toFixed(2) || "0.00"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground">Disponível</div>
            <div className="text-sm font-semibold text-foreground">
              R$ {wallet?.balance.toFixed(2) || "0.00"}
            </div>
          </div>
        </div>

        {/* Content Count */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 shadow-md">
            <Play className="h-4 w-4 text-white fill-white" />
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Conteúdos</div>
            <div className="text-lg font-bold text-violet-500">{stats.contentCount}</div>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            <span className="text-xs">vídeos publicados</span>
          </div>
        </div>
      </div>
    </Card>
  );
};

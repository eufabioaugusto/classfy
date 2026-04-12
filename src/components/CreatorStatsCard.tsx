import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Play, Wallet, Zap, TrendingUp } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface CreatorStatsCardProps {
  userId: string;
  collapsed?: boolean;
}

interface StatsData {
  totalPoints: number;
  performancePoints: number;
  level: number;
  contentCount: number;
  balance: number;
}

const getPointsForLevel = (n: number) => 500 * n * (n - 1) / 2;

export const CreatorStatsCard = ({ userId, collapsed }: CreatorStatsCardProps) => {
  const [stats, setStats] = useState<StatsData | null>(null);

  useEffect(() => {
    if (!userId) return;

    (async () => {
      const [walletRes, eventsRes, contentsRes] = await Promise.all([
        supabase.from("wallets").select("balance").eq("user_id", userId).single(),
        supabase.from("reward_events").select("points, performance_points").eq("user_id", userId),
        supabase.from("contents").select("*", { count: "exact", head: true }).eq("creator_id", userId),
      ]);

      const totalPoints = eventsRes.data?.reduce((s, e) => s + (e.points || 0), 0) || 0;
      const performancePoints = eventsRes.data?.reduce((s, e) => s + (Number(e.performance_points) || 0), 0) || 0;

      let level = 1;
      while (getPointsForLevel(level + 1) <= totalPoints) level++;

      setStats({
        totalPoints,
        performancePoints,
        level,
        contentCount: contentsRes.count || 0,
        balance: walletRes.data?.balance || 0,
      });
    })();
  }, [userId]);

  if (!stats) return (
    <div className="mx-0.5 rounded-xl bg-muted/30 animate-pulse h-[108px]" />
  );

  const pointsAtCurrentLevel = getPointsForLevel(stats.level);
  const pointsNeededForNext = getPointsForLevel(stats.level + 1) - pointsAtCurrentLevel;
  const pointsInCurrentLevel = stats.totalPoints - pointsAtCurrentLevel;
  const progress = Math.min((pointsInCurrentLevel / pointsNeededForNext) * 100, 100);
  const remaining = Math.ceil(pointsNeededForNext - pointsInCurrentLevel);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-1">
        <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
          <span className="text-[11px] font-bold text-red-500">N{stats.level}</span>
        </div>
        <div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center">
          <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-muted/30 border border-border/30 overflow-hidden">
      {/* Level row */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
              <span className="text-[11px] font-bold text-red-500 leading-none">N{stats.level}</span>
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground leading-none">Nível {stats.level}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                {remaining.toLocaleString("pt-BR")} pts para N{stats.level + 1}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
            {stats.totalPoints.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} pts
          </span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-red-500 rounded-full transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 divide-x divide-border/30 border-t border-border/30">
        {/* PP */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Zap className="h-3 w-3 text-red-500" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">PP</span>
          </div>
          <span className="text-sm font-bold text-foreground tabular-nums">
            {stats.performancePoints.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
          </span>
        </div>

        {/* Saldo */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Wallet className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Saldo</span>
          </div>
          <span className="text-sm font-bold text-foreground tabular-nums">
            R$ {stats.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Conteúdos — linha fina abaixo */}
      <div className="px-3 py-2 border-t border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Play className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Conteúdos</span>
        </div>
        <span className="text-xs font-semibold text-foreground tabular-nums">{stats.contentCount}</span>
      </div>
    </div>
  );
};

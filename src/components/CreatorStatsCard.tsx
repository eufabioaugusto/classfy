import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Play, Wallet, Zap } from "lucide-react";
import { subscribeToRewardEarned } from "@/lib/rewards/events";

interface CreatorStatsCardProps {
  userId: string;
  collapsed?: boolean;
}

interface StatsData {
  totalPoints: number;
  creatorPoints: number;
  level: number;
  contentCount: number;
  balance: number;
}

const getPointsForLevel = (n: number) => 500 * n * (n - 1) / 2;

export const CreatorStatsCard = ({ userId, collapsed }: CreatorStatsCardProps) => {
  const [stats, setStats] = useState<StatsData | null>(null);

  const loadStats = useCallback(async () => {
      if (!userId) return;
      const [walletRes, eventsRes, contentsRes] = await Promise.all([
        supabase.from("wallets").select("balance").eq("user_id", userId).single(),
        supabase.from("reward_events").select("points, point_type").eq("user_id", userId),
        supabase.from("contents").select("*", { count: "exact", head: true }).eq("creator_id", userId),
      ]);

      const totalPoints = eventsRes.data
        ?.filter((event: any) => event.point_type === 'user')
        .reduce((sum, event) => sum + (event.points || 0), 0) || 0;
      const creatorPoints = eventsRes.data
        ?.filter((event: any) => event.point_type === 'creator')
        .reduce((sum, event) => sum + (event.points || 0), 0) || 0;

      let level = 1;
      while (getPointsForLevel(level + 1) <= totalPoints) level++;

      setStats({
        totalPoints,
        creatorPoints,
        level,
        contentCount: contentsRes.count || 0,
        balance: walletRes.data?.balance || 0,
      });
  }, [userId]);

  useEffect(() => {
    void loadStats();

    const unsubscribe = subscribeToRewardEarned((reward) => {
      if (reward.userId !== userId) return;
      setStats((current) => current ? {
        ...current,
        totalPoints: reward.pointType === "creator"
          ? current.totalPoints
          : current.totalPoints + reward.points,
        creatorPoints: reward.pointType === "creator"
          ? current.creatorPoints + reward.points
          : current.creatorPoints,
      } : current);
      window.setTimeout(() => void loadStats(), 250);
    });

    const channel = supabase
      .channel(`sidebar-rewards-${userId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "reward_events",
        filter: `user_id=eq.${userId}`,
      }, () => void loadStats())
      .subscribe();

    return () => {
      unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [loadStats, userId]);

  if (!stats) return (
    <div className="cf-v2 mx-0.5 h-[148px] animate-pulse rounded-[var(--cf2-radius-card)] bg-[var(--cf2-surface)]" />
  );

  const pointsAtCurrentLevel = getPointsForLevel(stats.level);
  const pointsNeededForNext = getPointsForLevel(stats.level + 1) - pointsAtCurrentLevel;
  const pointsInCurrentLevel = stats.totalPoints - pointsAtCurrentLevel;
  const progress = Math.min((pointsInCurrentLevel / pointsNeededForNext) * 100, 100);
  const remaining = Math.ceil(pointsNeededForNext - pointsInCurrentLevel);

  if (collapsed) {
    return (
      <div className="cf-v2 flex flex-col items-center gap-1.5 px-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cf2-accent-soft)]">
          <span className="text-[11px] font-bold text-[var(--cf2-accent)]">N{stats.level}</span>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cf2-surface-raised)]">
          <Wallet className="h-3.5 w-3.5 text-[var(--cf2-ink-muted)]" />
        </div>
      </div>
    );
  }

  return (
    <section className="cf-v2 cf2-sidebar-progress" aria-label={`Nível ${stats.level}, evolução e saldo`}>
      <div className="cf2-sidebar-progress__level">
        <span className="cf2-sidebar-progress__badge">N{stats.level}</span>
        <div className="cf2-sidebar-progress__level-copy">
          <strong>Nível {stats.level}</strong>
          <span>{remaining.toLocaleString("pt-BR")} para N{stats.level + 1}</span>
        </div>
        <strong className="cf2-sidebar-progress__points">
          {stats.totalPoints.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
          <small>Points</small>
        </strong>
      </div>

      <div className="cf2-sidebar-progress__track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="cf2-sidebar-progress__metrics">
        <div>
          <span><Zap aria-hidden="true" /> Creator Points</span>
          <strong>{stats.creatorPoints.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</strong>
        </div>
        <div>
          <span><Wallet aria-hidden="true" /> Saldo</span>
          <strong>
            R$&nbsp;{stats.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
        </div>
        <div>
          <span><Play aria-hidden="true" /> Publicações</span>
          <strong>{stats.contentCount}</strong>
        </div>
      </div>
    </section>
  );
};

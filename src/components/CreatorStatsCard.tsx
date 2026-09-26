import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Play, Wallet, Zap } from "lucide-react";
import { subscribeToRewardEarned } from "@/lib/rewards/events";

interface CreatorStatsCardProps {
  userId: string;
  collapsed?: boolean;
  showCreatorStats?: boolean;
}

interface StatsData {
  totalPoints: number;
  creatorPoints: number;
  level: number;
  contentCount: number;
  balance: number;
}

const getPointsForLevel = (n: number) => 500 * n * (n - 1) / 2;

export const CreatorStatsCard = ({ userId, collapsed, showCreatorStats = true }: CreatorStatsCardProps) => {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [highlight, setHighlight] = useState<"user" | "creator" | null>(null);
  const requestVersion = useRef(0);
  const statsRef = useRef<StatsData | null>(null);
  const highlightTimer = useRef<number>();
  const reconcileTimer = useRef<number>();

  const loadStats = useCallback(async () => {
      if (!userId) return;
      const version = ++requestVersion.current;
      const [walletRes, eventsRes, contentsRes] = await Promise.all([
        supabase.from("wallets").select("balance").eq("user_id", userId).single(),
        supabase.from("reward_events").select("points, point_type").eq("user_id", userId),
        supabase.from("contents").select("*", { count: "exact", head: true }).eq("creator_id", userId),
      ]);

      const totalPoints = eventsRes.data
        ?.filter((event) => event.point_type === 'user')
        .reduce((sum, event) => sum + (event.points || 0), 0) || 0;
      const creatorPoints = eventsRes.data
        ?.filter((event) => event.point_type === 'creator')
        .reduce((sum, event) => sum + (event.points || 0), 0) || 0;

      let level = 1;
      while (getPointsForLevel(level + 1) <= totalPoints) level++;

      if (version !== requestVersion.current || eventsRes.error) return;
      const nextStats = {
        totalPoints,
        creatorPoints,
        level,
        contentCount: contentsRes.count || 0,
        balance: walletRes.data?.balance || 0,
      };
      statsRef.current = nextStats;
      setStats(nextStats);
  }, [userId]);

  useEffect(() => {
    const versionRef = requestVersion;
    statsRef.current = null;
    setStats(null);
    void loadStats();

    const unsubscribe = subscribeToRewardEarned((reward) => {
      if (reward.userId !== userId) return;
      // Invalidar leituras iniciadas antes do evento: elas podem conter o saldo antigo.
      versionRef.current++;
      const current = statsRef.current;
      if (current) {
        const totalPoints = reward.pointType === "creator" ? current.totalPoints : current.totalPoints + reward.points;
        let level = 1;
        while (getPointsForLevel(level + 1) <= totalPoints) level++;
        const nextStats = {
          ...current,
          level,
          totalPoints,
          creatorPoints: reward.pointType === "creator" ? current.creatorPoints + reward.points : current.creatorPoints,
        };
        statsRef.current = nextStats;
        setStats(nextStats);
      }
      if (reward.points > 0) {
        setHighlight(reward.pointType === "creator" ? "creator" : "user");
        window.clearTimeout(highlightTimer.current);
        highlightTimer.current = window.setTimeout(() => setHighlight(null), 1100);
      }
      window.clearTimeout(reconcileTimer.current);
      reconcileTimer.current = window.setTimeout(() => void loadStats(), 900);
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
      versionRef.current++;
      window.clearTimeout(highlightTimer.current);
      window.clearTimeout(reconcileTimer.current);
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
        <Link to="/recompensas#nivel" aria-label={`Ver nível ${stats.level} e progresso`} title={`Nível ${stats.level} · Ver progresso`} className={`flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cf2-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cf2-accent)] ${highlight === "user" ? "cf2-reward-card__pulse" : ""}`}>
          <span className="text-[11px] font-bold text-[var(--cf2-accent)]">N{stats.level}</span>
        </Link>
        <Link to="/carteira" aria-label="Ver saldo na carteira" title="Ver carteira" className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cf2-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cf2-accent)]">
          <Wallet className="h-3.5 w-3.5 text-[var(--cf2-ink-muted)]" />
        </Link>
      </div>
    );
  }

  return (
    <section className="cf-v2 cf2-sidebar-progress" aria-label={`Nível ${stats.level}, evolução e saldo`}>
      <Link to="/recompensas#nivel" className="cf2-sidebar-progress__level-link" aria-label={`Ver nível ${stats.level}, ${remaining.toLocaleString("pt-BR")} Points para o próximo nível`}>
        <div className={`cf2-sidebar-progress__level ${highlight === "user" ? "cf2-reward-card__pulse" : ""}`}>
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
      </Link>

      <div className="cf2-sidebar-progress__metrics">
        {showCreatorStats && <Link to="/recompensas" className={highlight === "creator" ? "cf2-reward-card__pulse" : ""} aria-label="Ver Creator Points em recompensas">
          <span><Zap aria-hidden="true" /> Creator Points</span>
          <strong>{stats.creatorPoints.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</strong>
        </Link>}
        <Link to="/carteira" aria-label="Ver saldo na carteira">
          <span><Wallet aria-hidden="true" /> Saldo</span>
          <strong>
            R$&nbsp;{stats.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
        </Link>
        {showCreatorStats && <Link to="/studio/contents" aria-label="Ver publicações no Studio">
          <span><Play aria-hidden="true" /> Publicações</span>
          <strong>{stats.contentCount}</strong>
        </Link>}
      </div>
    </section>
  );
};

import { useEffect, useState } from "react";
import { Crown, Medal, Trophy, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { V2Badge, V2Card, V2CardContent, V2CardHeader, V2Skeleton } from "@/components/v2";

interface LeaderboardEntry {
  user_id: string;
  cycle_points: number;
  display_name: string;
  avatar_url: string | null;
  rank?: number;
}

interface LeaderboardSectionProps {
  userId: string;
}

export function LeaderboardSection({ userId }: LeaderboardSectionProps) {
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [userOutsideTop, setUserOutsideTop] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const now = new Date();
        const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const { data: cycle } = await supabase
          .from("economic_cycles")
          .select("id")
          .eq("year_month", yearMonth)
          .maybeSingle();

        if (!cycle) return;

        const { data: cycleUsers } = await supabase
          .from("economic_cycle_users")
          .select("user_id, cycle_points")
          .eq("cycle_id", cycle.id)
          .order("cycle_points", { ascending: false })
          .limit(100);

        if (!cycleUsers?.length) return;

        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", cycleUsers.map((entry) => entry.user_id));

        const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
        const leaderboard = cycleUsers.map((entry) => ({
          user_id: entry.user_id,
          cycle_points: Number(entry.cycle_points || 0),
          display_name: profileMap.get(entry.user_id)?.display_name || "Usuário",
          avatar_url: profileMap.get(entry.user_id)?.avatar_url || null,
        }));

        setLeaders(leaderboard);

        const rankedEntry = cycleUsers
          .map((entry, index) => ({ ...entry, rank: index + 1 }))
          .find((entry) => entry.user_id === userId);

        setUserRank(rankedEntry?.rank ?? null);

        if (rankedEntry && rankedEntry.rank > 10) {
          const profile = profileMap.get(userId);
          setUserOutsideTop({
            user_id: userId,
            cycle_points: Number(rankedEntry.cycle_points || 0),
            display_name: profile?.display_name || "Você",
            avatar_url: profile?.avatar_url || null,
            rank: rankedEntry.rank,
          });
        } else {
          setUserOutsideTop(null);
        }
      } catch (error) {
        console.error("Error fetching leaderboard:", error);
      } finally {
        setLoading(false);
      }
    };

    void fetchLeaderboard();
  }, [userId]);

  const getRankIcon = (index: number) => {
    if (index === 0) return <Crown aria-hidden="true" />;
    if (index === 1 || index === 2) return <Medal aria-hidden="true" />;
    return <span>{index + 1}</span>;
  };

  const renderPerson = (entry: LeaderboardEntry, position: number, current: boolean) => (
    <div
      key={entry.user_id}
      className={`economy-ranking-row${current ? " economy-ranking-row--current" : ""}`}
    >
      <div className="economy-ranking-person">
        <span className="economy-ranking-index">{getRankIcon(position)}</span>
        {entry.avatar_url ? (
          <img src={entry.avatar_url} alt="" className="economy-ranking-avatar" />
        ) : (
          <span className="economy-ranking-avatar grid place-items-center"><User className="h-4 w-4" /></span>
        )}
        <p className="economy-ranking-name">
          {entry.display_name}{current && <span> · você</span>}
        </p>
      </div>
      <span className="economy-ranking-points">
        {Math.floor(entry.cycle_points).toLocaleString("pt-BR")} pts
      </span>
    </div>
  );

  return (
    <V2Card className="economy-panel economy-leaderboard">
      <V2CardHeader>
        <div className="economy-panel-heading">
          <span className="economy-icon"><Trophy aria-hidden="true" /></span>
          <div>
            <h2 className="economy-panel-title">Ranking mensal</h2>
            <p className="economy-panel-copy">Sua posição no ciclo atual</p>
          </div>
        </div>
        {userRank && <V2Badge variant="accent">Você · #{userRank}</V2Badge>}
      </V2CardHeader>
      <V2CardContent>
        {loading ? (
          <div className="economy-ranking-list" aria-label="Carregando ranking mensal">
            {[0, 1, 2].map((item) => <V2Skeleton key={item} className="h-14 mb-2" />)}
          </div>
        ) : leaders.length === 0 ? (
          <div className="py-10 text-center">
            <p className="economy-panel-title">O ranking começa com os primeiros Points</p>
            <p className="economy-panel-copy">Suas atividades elegíveis aparecem aqui durante o ciclo.</p>
          </div>
        ) : (
          <div className="economy-ranking-list">
            {leaders.slice(0, 10).map((entry, index) => renderPerson(entry, index, entry.user_id === userId))}
            {userOutsideTop && (
              <>
                <div className="py-2 text-center text-xs text-muted-foreground" aria-hidden="true">•••</div>
                {renderPerson(userOutsideTop, Math.max(0, (userOutsideTop.rank ?? 1) - 1), true)}
              </>
            )}
          </div>
        )}
      </V2CardContent>
    </V2Card>
  );
}

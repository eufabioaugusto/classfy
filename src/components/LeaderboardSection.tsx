import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Crown, Medal, Trophy, User } from "lucide-react";

interface LeaderboardEntry {
  user_id: string;
  performance_points: number;
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
  }, [userId]);

  const fetchLeaderboard = async () => {
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const { data: cycle } = await supabase
        .from('economic_cycles')
        .select('id')
        .eq('year_month', yearMonth)
        .maybeSingle();

      if (!cycle) {
        setLoading(false);
        return;
      }

      // Fetch all users to find current user's rank even if outside top 10
      const { data: cycleUsers } = await supabase
        .from('economic_cycle_users')
        .select('user_id, performance_points')
        .eq('cycle_id', cycle.id)
        .order('performance_points', { ascending: false })
        .limit(100);

      if (!cycleUsers || cycleUsers.length === 0) {
        setLoading(false);
        return;
      }

      // Fetch profile names
      const userIds = cycleUsers.map(u => u.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const leaderboard: LeaderboardEntry[] = cycleUsers.map(u => ({
        user_id: u.user_id,
        performance_points: parseFloat(String(u.performance_points)),
        display_name: profileMap.get(u.user_id)?.display_name || 'Usuário',
        avatar_url: profileMap.get(u.user_id)?.avatar_url || null,
      }));

      setLeaders(leaderboard);

      // Find user's rank (across all fetched users, not just top 10)
      const allRanked = cycleUsers.map((u, idx) => ({ ...u, rank: idx + 1 }));
      const userEntry = allRanked.find(l => l.user_id === userId);
      setUserRank(userEntry ? userEntry.rank : null);

      // If user is outside top 10, store their entry separately
      if (userEntry && userEntry.rank > 10) {
        const profile = profileMap.get(userId);
        setUserOutsideTop({
          user_id: userId,
          performance_points: parseFloat(String(userEntry.performance_points)),
          display_name: profile?.display_name || 'Você',
          avatar_url: profile?.avatar_url || null,
          rank: userEntry.rank,
        });
      } else {
        setUserOutsideTop(null);
      }
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRankIcon = (index: number) => {
    if (index === 0) return <Crown className="w-5 h-5 text-yellow-500" />;
    if (index === 1) return <Medal className="w-5 h-5 text-gray-400" />;
    if (index === 2) return <Medal className="w-5 h-5 text-amber-600" />;
    return <span className="w-5 text-center text-sm font-bold text-muted-foreground">{index + 1}</span>;
  };

  if (loading) return null;
  if (leaders.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-6 h-6 text-accent" />
            <CardTitle>Ranking Mensal</CardTitle>
          </div>
          {userRank && (
            <Badge variant="secondary" className="text-sm">
              Você: #{userRank}
            </Badge>
          )}
        </div>
        <CardDescription>Top performers por Performance Points este mês</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {leaders.slice(0, 10).map((entry, index) => {
            const isCurrentUser = entry.user_id === userId;
            return (
              <div
                key={entry.user_id}
                className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                  isCurrentUser 
                    ? 'bg-accent/10 border border-accent/20' 
                    : 'bg-muted/30 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-center w-8">
                  {getRankIcon(index)}
                </div>
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {entry.avatar_url ? (
                    <img src={entry.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isCurrentUser ? 'text-accent' : ''}`}>
                    {entry.display_name}
                    {isCurrentUser && <span className="text-xs ml-1">(você)</span>}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold">{Math.floor(entry.performance_points).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">PP</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

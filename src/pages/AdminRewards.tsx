import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  TrendingUp, 
  DollarSign, 
  Users, 
  Award,
  Trophy,
  Coins,
  ArrowLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface RewardStats {
  totalPoints: number;
  totalValue: number;
  totalEvents: number;
}

interface TopCreator {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_earned: number;
  events_count: number;
}

interface TopUser {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_points: number;
  events_count: number;
}

interface ActionStats {
  action_key: string;
  total_points: number;
  total_value: number;
  count: number;
}

export default function AdminRewards() {
  const { role, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<RewardStats | null>(null);
  const [topCreators, setTopCreators] = useState<TopCreator[]>([]);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [actionStats, setActionStats] = useState<ActionStats[]>([]);

  useEffect(() => {
    if (!authLoading && role !== 'admin') {
      navigate("/");
    } else if (role === 'admin') {
      fetchDashboardData();
    }
  }, [role, authLoading, navigate]);

  const fetchDashboardData = async () => {
    try {
      // Total stats
      const { data: rewardEvents } = await supabase
        .from('reward_events')
        .select('points, value');

      const totalStats = rewardEvents?.reduce(
        (acc, event) => ({
          totalPoints: acc.totalPoints + (event.points || 0),
          totalValue: acc.totalValue + (event.value || 0),
          totalEvents: acc.totalEvents + 1,
        }),
        { totalPoints: 0, totalValue: 0, totalEvents: 0 }
      );

      setStats(totalStats || { totalPoints: 0, totalValue: 0, totalEvents: 0 });

      // Top creators by earnings
      const { data: creatorsData } = await supabase
        .from('reward_events')
        .select(`
          user_id,
          value,
          profiles!reward_events_user_id_fkey(display_name, avatar_url)
        `)
        .not('user_id', 'in', '(select user_id from user_roles where role != \'creator\')');

      const creatorsMap = new Map<string, { total_earned: number; events_count: number; display_name: string; avatar_url: string | null }>();
      
      creatorsData?.forEach((event: any) => {
        const existing = creatorsMap.get(event.user_id);
        if (existing) {
          existing.total_earned += event.value || 0;
          existing.events_count += 1;
        } else {
          creatorsMap.set(event.user_id, {
            total_earned: event.value || 0,
            events_count: 1,
            display_name: event.profiles?.display_name || 'Unknown',
            avatar_url: event.profiles?.avatar_url || null,
          });
        }
      });

      const topCreatorsArray = Array.from(creatorsMap.entries())
        .map(([user_id, data]) => ({ user_id, ...data }))
        .sort((a, b) => b.total_earned - a.total_earned)
        .slice(0, 10);

      setTopCreators(topCreatorsArray);

      // Top users by points
      const { data: usersData } = await supabase
        .from('reward_events')
        .select(`
          user_id,
          points,
          profiles!reward_events_user_id_fkey(display_name, avatar_url)
        `);

      const usersMap = new Map<string, { total_points: number; events_count: number; display_name: string; avatar_url: string | null }>();
      
      usersData?.forEach((event: any) => {
        const existing = usersMap.get(event.user_id);
        if (existing) {
          existing.total_points += event.points || 0;
          existing.events_count += 1;
        } else {
          usersMap.set(event.user_id, {
            total_points: event.points || 0,
            events_count: 1,
            display_name: event.profiles?.display_name || 'Unknown',
            avatar_url: event.profiles?.avatar_url || null,
          });
        }
      });

      const topUsersArray = Array.from(usersMap.entries())
        .map(([user_id, data]) => ({ user_id, ...data }))
        .sort((a, b) => b.total_points - a.total_points)
        .slice(0, 10);

      setTopUsers(topUsersArray);

      // Action stats
      const actionsMap = new Map<string, { total_points: number; total_value: number; count: number }>();
      
      rewardEvents?.forEach((event: any) => {
        const existing = actionsMap.get(event.action_key);
        if (existing) {
          existing.total_points += event.points || 0;
          existing.total_value += event.value || 0;
          existing.count += 1;
        } else {
          actionsMap.set(event.action_key, {
            total_points: event.points || 0,
            total_value: event.value || 0,
            count: 1,
          });
        }
      });

      const actionsArray = Array.from(actionsMap.entries())
        .map(([action_key, data]) => ({ action_key, ...data }))
        .sort((a, b) => b.total_value - a.total_value);

      setActionStats(actionsArray);

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="container mx-auto p-6">
        <p>Carregando...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Dashboard de Recompensas</h1>
            <p className="text-muted-foreground">Controle da economia da plataforma</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 rounded-lg">
              <Coins className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total de Pontos</p>
              <h3 className="text-2xl font-bold">{stats?.totalPoints.toLocaleString('pt-BR')}</h3>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-500/10 rounded-lg">
              <DollarSign className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Distribuído</p>
              <h3 className="text-2xl font-bold">
                R$ {stats?.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </h3>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/10 rounded-lg">
              <TrendingUp className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total de Eventos</p>
              <h3 className="text-2xl font-bold">{stats?.totalEvents.toLocaleString('pt-BR')}</h3>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Top Creators */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">Top Creators por Ganhos</h2>
          </div>
          <div className="space-y-3">
            {topCreators.map((creator, index) => (
              <div key={creator.user_id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="w-8 h-8 flex items-center justify-center">
                    {index + 1}
                  </Badge>
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={creator.avatar_url || ''} />
                    <AvatarFallback>{creator.display_name[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{creator.display_name}</p>
                    <p className="text-xs text-muted-foreground">{creator.events_count} eventos</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-600">
                    R$ {creator.total_earned.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Top Users */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">Top Usuários por Pontos</h2>
          </div>
          <div className="space-y-3">
            {topUsers.map((user, index) => (
              <div key={user.user_id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="w-8 h-8 flex items-center justify-center">
                    {index + 1}
                  </Badge>
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={user.avatar_url || ''} />
                    <AvatarFallback>{user.display_name[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{user.display_name}</p>
                    <p className="text-xs text-muted-foreground">{user.events_count} eventos</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-primary">
                    {user.total_points.toLocaleString('pt-BR')} pts
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Actions Stats */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Award className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">Estatísticas por Ação</h2>
        </div>
        <div className="space-y-3">
          {actionStats.map((action) => (
            <div key={action.action_key} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <p className="font-medium">{action.action_key}</p>
                <p className="text-xs text-muted-foreground">{action.count} execuções</p>
              </div>
              <div className="text-right">
                <p className="font-bold">{action.total_points.toLocaleString('pt-BR')} pts</p>
                <p className="text-xs text-green-600">
                  R$ {action.total_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

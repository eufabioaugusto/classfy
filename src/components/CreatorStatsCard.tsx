import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, DollarSign, Trophy, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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

  if (loading) {
    return (
      <Card className="p-3 animate-pulse">
        <div className="h-20 bg-muted rounded" />
      </Card>
    );
  }

  if (collapsed) {
    return (
      <div className="flex flex-col gap-2 px-2">
        <div className="flex items-center justify-center p-2 rounded-md bg-accent/10">
          <Trophy className="h-4 w-4 text-accent" />
        </div>
        <div className="flex items-center justify-center p-2 rounded-md bg-primary/10">
          <DollarSign className="h-4 w-4 text-primary" />
        </div>
      </div>
    );
  }

  return (
    <Card className="p-4 bg-gradient-to-br from-background to-muted/20 border-border/50">
      <div className="space-y-3">
        {/* Nível */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-accent/10">
              <Trophy className="h-4 w-4 text-accent" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Nível</span>
              <span className="text-sm font-bold">{stats.level}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Pontos</div>
            <div className="text-sm font-semibold text-accent">{stats.totalPoints}</div>
          </div>
        </div>

        <Separator className="bg-border/50" />

        {/* Ganhos */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10">
              <DollarSign className="h-4 w-4 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Ganhos</span>
              <span className="text-xs font-bold text-primary">R$ {wallet?.total_earned.toFixed(2) || "0.00"}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Saldo</div>
            <div className="text-xs font-semibold">R$ {wallet?.balance.toFixed(2) || "0.00"}</div>
          </div>
        </div>

        <Separator className="bg-border/50" />

        {/* Conteúdos */}
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-secondary/50">
            <Star className="h-4 w-4 text-secondary-foreground" />
          </div>
          <div className="flex-1">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Conteúdos</span>
              <span className="text-lg font-bold">{stats.contentCount}</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

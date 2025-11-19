import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GlobalLoader } from "@/components/GlobalLoader";
import { toast } from "sonner";
import { 
  ArrowLeft, 
  Pencil, 
  Search,
  TrendingUp,
  Activity,
  DollarSign,
  Coins
} from "lucide-react";

interface RewardConfig {
  id: string;
  action_key: string;
  points_user: number;
  points_creator: number;
  value_user: number;
  value_creator: number;
  active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface RewardStats {
  action_key: string;
  total_events: number;
  total_points: number;
  total_value: number;
  last_used: string | null;
}

export default function AdminRewards() {
  const { role, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rewards, setRewards] = useState<RewardConfig[]>([]);
  const [rewardStats, setRewardStats] = useState<Map<string, RewardStats>>(new Map());
  const [searchTerm, setSearchTerm] = useState("");
  const [editingReward, setEditingReward] = useState<RewardConfig | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Global stats
  const [globalStats, setGlobalStats] = useState({
    totalRewards: 0,
    activeRewards: 0,
    totalPointsDistributed: 0,
    totalValueDistributed: 0,
  });

  useEffect(() => {
    if (!authLoading && role !== 'admin') {
      navigate("/");
    } else if (role === 'admin') {
      fetchData();
    }
  }, [role, authLoading, navigate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch reward configurations
      const { data: rewardsData, error: rewardsError } = await supabase
        .from('reward_actions_config')
        .select('*')
        .order('action_key', { ascending: true });

      if (rewardsError) throw rewardsError;
      setRewards(rewardsData || []);

      // Fetch statistics for each reward
      const { data: eventsData, error: eventsError } = await supabase
        .from('reward_events')
        .select('action_key, points, value, created_at');

      if (eventsError) throw eventsError;

      // Calculate stats per action
      const statsMap = new Map<string, RewardStats>();
      let totalPoints = 0;
      let totalValue = 0;

      eventsData?.forEach((event) => {
        const existing = statsMap.get(event.action_key);
        totalPoints += event.points || 0;
        totalValue += event.value || 0;

        if (existing) {
          existing.total_events += 1;
          existing.total_points += event.points || 0;
          existing.total_value += event.value || 0;
          if (!existing.last_used || event.created_at > existing.last_used) {
            existing.last_used = event.created_at;
          }
        } else {
          statsMap.set(event.action_key, {
            action_key: event.action_key,
            total_events: 1,
            total_points: event.points || 0,
            total_value: event.value || 0,
            last_used: event.created_at,
          });
        }
      });

      setRewardStats(statsMap);

      // Set global stats
      setGlobalStats({
        totalRewards: rewardsData?.length || 0,
        activeRewards: rewardsData?.filter(r => r.active).length || 0,
        totalPointsDistributed: totalPoints,
        totalValueDistributed: totalValue,
      });

    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateReward = async () => {
    if (!editingReward) return;

    try {
      const { error } = await supabase
        .from('reward_actions_config')
        .update({
          points_user: editingReward.points_user,
          points_creator: editingReward.points_creator,
          value_user: editingReward.value_user,
          value_creator: editingReward.value_creator,
          active: editingReward.active,
          description: editingReward.description,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingReward.id);

      if (error) throw error;

      toast.success('Recompensa atualizada com sucesso!');
      setIsDialogOpen(false);
      setEditingReward(null);
      fetchData();
    } catch (error) {
      console.error('Error updating reward:', error);
      toast.error('Erro ao atualizar recompensa');
    }
  };

  const handleToggleActive = async (reward: RewardConfig) => {
    try {
      const { error } = await supabase
        .from('reward_actions_config')
        .update({ 
          active: !reward.active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reward.id);

      if (error) throw error;

      toast.success(`Recompensa ${!reward.active ? 'ativada' : 'desativada'} com sucesso!`);
      fetchData();
    } catch (error) {
      console.error('Error toggling reward:', error);
      toast.error('Erro ao atualizar status');
    }
  };

  const openEditDialog = (reward: RewardConfig) => {
    setEditingReward({ ...reward });
    setIsDialogOpen(true);
  };

  const filteredRewards = rewards.filter(reward =>
    reward.action_key.toLowerCase().includes(searchTerm.toLowerCase()) ||
    reward.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (authLoading || loading) {
    return <GlobalLoader />;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Gerenciamento de Recompensas</h1>
            <p className="text-muted-foreground">Configure valores e controle a economia da plataforma</p>
          </div>
        </div>
      </div>

      {/* Global Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 rounded-lg">
              <Activity className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total de Recompensas</p>
              <h3 className="text-2xl font-bold">{globalStats.totalRewards}</h3>
              <p className="text-xs text-green-600">{globalStats.activeRewards} ativas</p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/10 rounded-lg">
              <TrendingUp className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Eventos Totais</p>
              <h3 className="text-2xl font-bold">
                {Array.from(rewardStats.values()).reduce((sum, stat) => sum + stat.total_events, 0).toLocaleString('pt-BR')}
              </h3>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-500/10 rounded-lg">
              <Coins className="h-6 w-6 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Pontos Distribuídos</p>
              <h3 className="text-2xl font-bold">{globalStats.totalPointsDistributed.toLocaleString('pt-BR')}</h3>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-500/10 rounded-lg">
              <DollarSign className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Valor Distribuído</p>
              <h3 className="text-2xl font-bold">
                R$ {globalStats.totalValueDistributed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </h3>
            </div>
          </div>
        </Card>
      </div>

      {/* Search */}
      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por ação ou descrição..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </Card>

      {/* Rewards Table */}
      <Card className="p-6">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ação</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Pontos Usuário</TableHead>
                <TableHead className="text-center">Pontos Criador</TableHead>
                <TableHead className="text-center">Valor Usuário</TableHead>
                <TableHead className="text-center">Valor Criador</TableHead>
                <TableHead className="text-center">Uso Total</TableHead>
                <TableHead className="text-center">Último Uso</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRewards.map((reward) => {
                const stats = rewardStats.get(reward.action_key);
                return (
                  <TableRow key={reward.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{reward.action_key}</p>
                        {reward.description && (
                          <p className="text-xs text-muted-foreground">{reward.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={reward.active}
                        onCheckedChange={() => handleToggleActive(reward)}
                      />
                    </TableCell>
                    <TableCell className="text-center">{reward.points_user}</TableCell>
                    <TableCell className="text-center">{reward.points_creator}</TableCell>
                    <TableCell className="text-center">
                      R$ {reward.value_user.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-center">
                      R$ {reward.value_creator.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-center">
                      {stats ? (
                        <div>
                          <p className="font-medium">{stats.total_events.toLocaleString('pt-BR')}</p>
                          <p className="text-xs text-muted-foreground">
                            {stats.total_points} pts / R$ {stats.total_value.toFixed(2)}
                          </p>
                        </div>
                      ) : (
                        <Badge variant="outline">Sem uso</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {stats?.last_used ? (
                        <span className="text-xs text-muted-foreground">
                          {new Date(stats.last_used).toLocaleDateString('pt-BR')}
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(reward)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Recompensa</DialogTitle>
            <DialogDescription>
              Ajuste os valores de pontos e recompensas para esta ação
            </DialogDescription>
          </DialogHeader>

          {editingReward && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Ação</label>
                <Input value={editingReward.action_key} disabled />
              </div>

              <div>
                <label className="text-sm font-medium">Descrição</label>
                <Textarea
                  value={editingReward.description || ''}
                  onChange={(e) =>
                    setEditingReward({ ...editingReward, description: e.target.value })
                  }
                  placeholder="Descrição da recompensa..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Pontos Usuário</label>
                  <Input
                    type="number"
                    value={editingReward.points_user}
                    onChange={(e) =>
                      setEditingReward({ ...editingReward, points_user: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Pontos Criador</label>
                  <Input
                    type="number"
                    value={editingReward.points_creator}
                    onChange={(e) =>
                      setEditingReward({ ...editingReward, points_creator: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Valor Usuário (R$)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editingReward.value_user}
                    onChange={(e) =>
                      setEditingReward({ ...editingReward, value_user: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Valor Criador (R$)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editingReward.value_creator}
                    onChange={(e) =>
                      setEditingReward({ ...editingReward, value_creator: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={editingReward.active}
                  onCheckedChange={(checked) =>
                    setEditingReward({ ...editingReward, active: checked })
                  }
                />
                <label className="text-sm font-medium">
                  {editingReward.active ? 'Ativa' : 'Inativa'}
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleUpdateReward}>
                  Salvar Alterações
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

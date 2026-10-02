import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/AdminLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
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
  Pencil,
  Search,
  TrendingUp,
  Activity,
  DollarSign,
  Coins,
  Target,
  Trophy,
  Video,
  Users,
  Wallet,
  Eye,
  Heart,
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
  canonical_name?: string | null;
  dedupe_scope?: string | null;
  daily_limit?: number | null;
  monthly_creator_limit?: number | null;
  requires_evidence?: boolean;
}

interface RewardStats {
  action_key: string;
  total_events: number;
  total_points: number;
  last_used: string | null;
}

interface CreatorMilestone {
  id: string;
  milestone_type: string;
  milestone_value: number;
  reward_points: number;
  reward_enabled: boolean;
  title: string;
  description: string | null;
  icon: string;
  active: boolean;
  order_index: number;
  created_at: string;
}

interface MilestoneStats {
  milestone_id: string;
  completed_count: number;
  claimed_count: number;
}

export default function AdminRewards() {
  const { role, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rewards, setRewards] = useState<RewardConfig[]>([]);
  const [rewardStats, setRewardStats] = useState<Map<string, RewardStats>>(new Map());
  const [searchTerm, setSearchTerm] = useState("");
  const [editingReward, setEditingReward] = useState<RewardConfig | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("rewards");

  // Creator Milestones state
  const [milestones, setMilestones] = useState<CreatorMilestone[]>([]);
  const [milestoneStats, setMilestoneStats] = useState<Map<string, MilestoneStats>>(new Map());
  const [editingMilestone, setEditingMilestone] = useState<CreatorMilestone | null>(null);
  const [isMilestoneDialogOpen, setIsMilestoneDialogOpen] = useState(false);
  const [milestoneSearchTerm, setMilestoneSearchTerm] = useState("");
  const [milestoneEditReason, setMilestoneEditReason] = useState("");

  const [rewardEditReason, setRewardEditReason] = useState("");

  // Global stats
  const [globalStats, setGlobalStats] = useState({
    totalRewards: 0,
    activeRewards: 0,
    totalPointsDistributed: 0,
  });

  const [milestoneGlobalStats, setMilestoneGlobalStats] = useState({
    totalMilestones: 0,
    activeMilestones: 0,
    totalCompleted: 0,
    totalClaimed: 0,
  });

  useEffect(() => {
    if (role === 'admin') {
      fetchData();
      fetchMilestones();
    }
  }, [role, authLoading]);

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
        .select('action_key, points, created_at');

      if (eventsError) throw eventsError;

      // Calculate stats per action
      const statsMap = new Map<string, RewardStats>();
      let totalPoints = 0;

      eventsData?.forEach((event) => {
        const existing = statsMap.get(event.action_key);
        totalPoints += event.points || 0;

        if (existing) {
          existing.total_events += 1;
          existing.total_points += event.points || 0;
          if (!existing.last_used || event.created_at > existing.last_used) {
            existing.last_used = event.created_at;
          }
        } else {
          statsMap.set(event.action_key, {
            action_key: event.action_key,
            total_events: 1,
            total_points: event.points || 0,
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
      });

    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const fetchMilestones = async () => {
    try {
      // Fetch milestones
      const { data: milestonesData, error: milestonesError } = await supabase
        .from('creator_milestones')
        .select('*')
        .order('order_index', { ascending: true });

      if (milestonesError) throw milestonesError;
      setMilestones(milestonesData || []);

      // Fetch milestone progress stats
      const { data: progressData, error: progressError } = await supabase
        .from('creator_milestone_progress')
        .select('milestone_id, completed_at, claimed');

      if (progressError) throw progressError;

      // Calculate stats per milestone
      const statsMap = new Map<string, MilestoneStats>();
      let totalCompleted = 0;
      let totalClaimed = 0;

      progressData?.forEach((progress) => {
        const existing = statsMap.get(progress.milestone_id);
        const isCompleted = progress.completed_at !== null;
        const isClaimed = progress.claimed;

        if (isCompleted) totalCompleted++;
        if (isClaimed) totalClaimed++;

        if (existing) {
          if (isCompleted) existing.completed_count++;
          if (isClaimed) existing.claimed_count++;
        } else {
          statsMap.set(progress.milestone_id, {
            milestone_id: progress.milestone_id,
            completed_count: isCompleted ? 1 : 0,
            claimed_count: isClaimed ? 1 : 0,
          });
        }
      });

      setMilestoneStats(statsMap);

      setMilestoneGlobalStats({
        totalMilestones: milestonesData?.length || 0,
        activeMilestones: milestonesData?.filter(m => m.active).length || 0,
        totalCompleted,
        totalClaimed,
      });

    } catch (error) {
      console.error('Error fetching milestones:', error);
    }
  };

  const handleUpdateReward = async () => {
    if (!editingReward || !rewardEditReason.trim()) {
      toast.error('Informe o motivo da alteração');
      return;
    }

    try {
      const { error } = await supabase.rpc('update_reward_action_config_v1' as any, {
        p_action_key: editingReward.action_key,
        p_points_user: editingReward.points_user,
        p_points_creator: editingReward.points_creator,
        p_active: editingReward.active,
        p_daily_limit: editingReward.daily_limit ?? null,
        p_monthly_creator_limit: editingReward.monthly_creator_limit ?? null,
        p_description: editingReward.description,
        p_reason: rewardEditReason.trim(),
      } as any);

      if (error) throw error;

      toast.success('Recompensa atualizada com sucesso!');
      setIsDialogOpen(false);
      setEditingReward(null);
      setRewardEditReason("");
      fetchData();
    } catch (error) {
      console.error('Error updating reward:', error);
      toast.error('Erro ao atualizar recompensa');
    }
  };

  const handleUpdateMilestone = async () => {
    if (!editingMilestone) return;
    if (!milestoneEditReason.trim()) {
      toast.error('Informe o motivo da alteração');
      return;
    }

    try {
      const { error } = await supabase.rpc('update_creator_milestone_v1' as any, {
        p_milestone_id: editingMilestone.id,
        p_title: editingMilestone.title,
        p_description: editingMilestone.description || '',
        p_reward_points: editingMilestone.reward_points,
        p_reward_enabled: editingMilestone.reward_enabled,
        p_active: editingMilestone.active,
        p_reason: milestoneEditReason.trim(),
      } as any);

      if (error) throw error;

      toast.success('Meta atualizada com sucesso!');
      setIsMilestoneDialogOpen(false);
      setEditingMilestone(null);
      setMilestoneEditReason("");
      fetchMilestones();
    } catch (error) {
      console.error('Error updating milestone:', error);
      toast.error('Erro ao atualizar meta');
    }
  };

  const handleToggleActive = async (reward: RewardConfig) => {
    setEditingReward({ ...reward, active: !reward.active });
    setRewardEditReason("");
    setIsDialogOpen(true);
  };

  const handleToggleMilestoneActive = (milestone: CreatorMilestone) => {
    setEditingMilestone({ ...milestone, active: !milestone.active });
    setMilestoneEditReason("");
    setIsMilestoneDialogOpen(true);
  };

  const openEditDialog = (reward: RewardConfig) => {
    setEditingReward({ ...reward });
    setRewardEditReason("");
    setIsDialogOpen(true);
  };

  const openMilestoneEditDialog = (milestone: CreatorMilestone) => {
    setEditingMilestone({ ...milestone });
    setMilestoneEditReason("");
    setIsMilestoneDialogOpen(true);
  };

  const filteredRewards = rewards.filter(reward =>
    reward.action_key.toLowerCase().includes(searchTerm.toLowerCase()) ||
    reward.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredMilestones = milestones.filter(milestone =>
    milestone.title.toLowerCase().includes(milestoneSearchTerm.toLowerCase()) ||
    milestone.milestone_type.toLowerCase().includes(milestoneSearchTerm.toLowerCase())
  );

  const getMilestoneTypeIcon = (type: string) => {
    switch (type) {
      case 'contents': return Video;
      case 'followers': return Users;
      case 'earnings': return Wallet;
      case 'views': return Eye;
      case 'engagement': return Heart;
      default: return Trophy;
    }
  };

  const getMilestoneTypeLabel = (type: string) => {
    switch (type) {
      case 'contents': return 'Produção';
      case 'followers': return 'Audiência';
      case 'earnings': return 'Monetização';
      case 'views': return 'Alcance';
      case 'engagement': return 'Engajamento';
      default: return type;
    }
  };

  if (!authLoading && role !== 'admin') return <Navigate to="/" replace />;

  if (authLoading || loading) {
    return <GlobalLoader />;
  }

  return (
    <AdminLayout title="Recompensas">
      <div className="container mx-auto p-6 space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="rewards" className="gap-2">
              <Coins className="w-4 h-4" />
              Recompensas
            </TabsTrigger>
            <TabsTrigger value="milestones" className="gap-2">
              <Target className="w-4 h-4" />
              Metas Creators
            </TabsTrigger>
          </TabsList>

          {/* User Rewards Tab */}
          <TabsContent value="rewards" className="space-y-6">
            {/* Global Stats */}
            <div className="grid gap-4 md:grid-cols-3">
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
                    <p className="text-sm text-muted-foreground">Points Distribuídos</p>
                    <h3 className="text-2xl font-bold">{globalStats.totalPointsDistributed.toLocaleString('pt-BR')}</h3>
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
                       <TableHead className="text-center">Points (origem usuário)</TableHead>
                       <TableHead className="text-center">Points (origem Creator)</TableHead>
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
                          <TableCell className="text-center">{Number(reward.points_user) % 1 === 0 ? reward.points_user : Number(reward.points_user).toFixed(2)}</TableCell>
                          <TableCell className="text-center">{Number(reward.points_creator) % 1 === 0 ? reward.points_creator : Number(reward.points_creator).toFixed(2)}</TableCell>
                          <TableCell className="text-center">
                            {stats ? (
                              <div>
                                <p className="font-medium">{stats.total_events.toLocaleString('pt-BR')}</p>
                                <p className="text-xs text-muted-foreground">
                                  {stats.total_points} Points
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
          </TabsContent>

          {/* Creator Milestones Tab */}
          <TabsContent value="milestones" className="space-y-6">
            {/* Milestone Global Stats */}
            <div className="grid gap-4 md:grid-cols-4">
              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <Target className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total de Metas</p>
                    <h3 className="text-2xl font-bold">{milestoneGlobalStats.totalMilestones}</h3>
                    <p className="text-xs text-green-600">{milestoneGlobalStats.activeMilestones} ativas</p>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-500/10 rounded-lg">
                    <Trophy className="h-6 w-6 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Metas Completadas</p>
                    <h3 className="text-2xl font-bold">{milestoneGlobalStats.totalCompleted}</h3>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-green-500/10 rounded-lg">
                    <DollarSign className="h-6 w-6 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Reconhecimentos vistos</p>
                    <h3 className="text-2xl font-bold">{milestoneGlobalStats.totalClaimed}</h3>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-orange-500/10 rounded-lg">
                    <Activity className="h-6 w-6 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Taxa de Resgate</p>
                    <h3 className="text-2xl font-bold">
                      {milestoneGlobalStats.totalCompleted > 0 
                        ? Math.round((milestoneGlobalStats.totalClaimed / milestoneGlobalStats.totalCompleted) * 100)
                        : 0}%
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
                  placeholder="Buscar por título ou tipo..."
                  value={milestoneSearchTerm}
                  onChange={(e) => setMilestoneSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </Card>

            {/* Milestones Table */}
            <Card className="p-6">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Meta</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-center">Valor Alvo</TableHead>
                      <TableHead className="text-center">Prêmio</TableHead>
                      <TableHead className="text-center">Completaram</TableHead>
                      <TableHead className="text-center">Reconhecidos</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMilestones.map((milestone) => {
                      const stats = milestoneStats.get(milestone.id);
                      const TypeIcon = getMilestoneTypeIcon(milestone.milestone_type);
                      return (
                        <TableRow key={milestone.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-lg bg-muted">
                                <TypeIcon className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="font-medium">{milestone.title}</p>
                                {milestone.description && (
                                  <p className="text-xs text-muted-foreground line-clamp-1">{milestone.description}</p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {getMilestoneTypeLabel(milestone.milestone_type)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center font-medium">
                            {milestone.milestone_type === 'earnings' 
                              ? `R$ ${milestone.milestone_value.toLocaleString('pt-BR')}`
                              : milestone.milestone_type === 'engagement'
                                ? `${milestone.milestone_value}%`
                                : milestone.milestone_value.toLocaleString('pt-BR')}
                          </TableCell>
                          <TableCell className="text-center font-medium">
                            {milestone.reward_enabled
                              ? `+${milestone.reward_points.toLocaleString('pt-BR')} Creator Points`
                              : 'Desativado'}
                          </TableCell>
                          <TableCell className="text-center">
                            {stats?.completed_count || 0}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-2">
                              <span>{stats?.claimed_count || 0}</span>
                              {stats && stats.completed_count > 0 && (
                                <Progress 
                                  value={(stats.claimed_count / stats.completed_count) * 100} 
                                  className="w-12 h-1.5" 
                                />
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={milestone.active}
                              onCheckedChange={() => handleToggleMilestoneActive(milestone)}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openMilestoneEditDialog(milestone)}
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
          </TabsContent>

        </Tabs>

        {/* Edit Reward Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Editar Recompensa</DialogTitle>
              <DialogDescription>
                Ajuste os valores de Points e os limites para esta ação
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
                    <label className="text-sm font-medium">User Points</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="1"
                      value={editingReward.points_user}
                      onChange={(e) =>
                        setEditingReward({ ...editingReward, points_user: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Creator Points</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="1"
                      value={editingReward.points_creator}
                      onChange={(e) =>
                        setEditingReward({ ...editingReward, points_creator: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                  💡 Os Points definem o peso de performance. O valor em R$ é calculado proporcionalmente ao pool no fechamento mensal do ciclo econômico.
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Limite diário</label>
                    <Input
                      type="number"
                      min="0"
                      value={editingReward.daily_limit ?? ''}
                      onChange={(e) => setEditingReward({
                        ...editingReward,
                        daily_limit: e.target.value === '' ? null : Number(e.target.value),
                      })}
                      placeholder="Sem limite"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Limite mensal Creator</label>
                    {editingReward.action_key === 'CONTENT_APPROVED' ? (
                      <p className="text-sm text-muted-foreground pt-2">
                        Sem teto mensal. Cada conteúdo aprovado pela curadoria gera 4 Creator Points uma única vez.
                      </p>
                    ) : (
                      <Input
                        type="number"
                        min="0"
                        value={editingReward.monthly_creator_limit ?? ''}
                        onChange={(e) => setEditingReward({
                          ...editingReward,
                          monthly_creator_limit: e.target.value === '' ? null : Number(e.target.value),
                        })}
                        placeholder="Sem limite"
                      />
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Motivo da alteração</label>
                  <Textarea
                    value={rewardEditReason}
                    onChange={(e) => setRewardEditReason(e.target.value)}
                    placeholder="Obrigatório para o histórico de auditoria"
                    rows={2}
                  />
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

        {/* Edit Milestone Dialog */}
        <Dialog open={isMilestoneDialogOpen} onOpenChange={setIsMilestoneDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Editar Meta de Creator</DialogTitle>
              <DialogDescription>
                Defina os Creator Points pagos uma única vez pelo motor oficial da Economia V1.
              </DialogDescription>
            </DialogHeader>

            {editingMilestone && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Tipo</label>
                    <Input value={getMilestoneTypeLabel(editingMilestone.milestone_type)} disabled />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Valor Alvo</label>
                    <Input value={editingMilestone.milestone_value} disabled />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Título</label>
                  <Input
                    value={editingMilestone.title}
                    onChange={(e) =>
                      setEditingMilestone({ ...editingMilestone, title: e.target.value })
                    }
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Descrição</label>
                  <Textarea
                    value={editingMilestone.description || ''}
                    onChange={(e) =>
                      setEditingMilestone({ ...editingMilestone, description: e.target.value })
                    }
                    placeholder="Descrição da meta..."
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Creator Points do prêmio</label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={editingMilestone.reward_points}
                      onChange={(e) => setEditingMilestone({
                        ...editingMilestone,
                        reward_points: Math.max(0, Number(e.target.value) || 0),
                      })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      O valor alvo acima mede a meta. Este campo define o pagamento.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <Switch
                      checked={editingMilestone.reward_enabled}
                      onCheckedChange={(checked) =>
                        setEditingMilestone({ ...editingMilestone, reward_enabled: checked })
                      }
                    />
                    <label className="text-sm font-medium">
                      {editingMilestone.reward_enabled ? 'Prêmio ativo' : 'Prêmio desativado'}
                    </label>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Motivo da alteração</label>
                  <Textarea
                    value={milestoneEditReason}
                    onChange={(e) => setMilestoneEditReason(e.target.value)}
                    placeholder="Explique por que esta regra foi alterada..."
                    rows={2}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Obrigatório para registrar a mudança na auditoria econômica.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={editingMilestone.active}
                    onCheckedChange={(checked) =>
                      setEditingMilestone({ ...editingMilestone, active: checked })
                    }
                  />
                  <label className="text-sm font-medium">
                    {editingMilestone.active ? 'Ativa' : 'Inativa'}
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setIsMilestoneDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleUpdateMilestone}
                    disabled={!milestoneEditReason.trim() || (editingMilestone.reward_enabled && editingMilestone.reward_points <= 0)}
                  >
                    Salvar Alterações
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

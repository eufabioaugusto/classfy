import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
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
  ShieldCheck,
  AlertTriangle,
  XCircle,
  RefreshCw,
  CheckCircle2,
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

interface CreatorMilestone {
  id: string;
  milestone_type: string;
  milestone_value: number;
  points_reward: number;
  value_reward: number;
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

interface ReconciliationRun {
  id: string;
  run_at: string;
  period: string | null;
  wallets_ok: number;
  wallets_drift: number;
  total_drift: number;
  cycles_ok: number;
  cycles_drift: number;
  status: 'ok' | 'warning' | 'error';
  details: {
    wallet_issues?: Array<{
      user_id: string;
      wallet_id: string;
      balance_stored: number;
      balance_ledger: number;
      drift: number;
    }>;
    cycle_issues?: Array<{
      cycle_id: string;
      year_month: string;
      distributed_stored: number;
      distributed_from_txs: number;
      drift: number;
    }>;
  };
}

interface WalletLedgerEntry {
  user_id: string;
  wallet_id: string;
  balance_stored: number;
  balance_from_ledger: number;
  drift: number;
  tx_count: number;
  credit_count: number;
  debit_count: number;
  total_credited: number;
  total_debited: number;
  last_tx_at: string | null;
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
  const [activeTab, setActiveTab] = useState("rewards");

  // Creator Milestones state
  const [milestones, setMilestones] = useState<CreatorMilestone[]>([]);
  const [milestoneStats, setMilestoneStats] = useState<Map<string, MilestoneStats>>(new Map());
  const [editingMilestone, setEditingMilestone] = useState<CreatorMilestone | null>(null);
  const [isMilestoneDialogOpen, setIsMilestoneDialogOpen] = useState(false);
  const [milestoneSearchTerm, setMilestoneSearchTerm] = useState("");

  // Economy state
  const [poolPercentage, setPoolPercentage] = useState(40);
  const [rbm, setRbm] = useState(0);
  const [prm, setPrm] = useState(0);
  const [totalPP, setTotalPP] = useState(0);
  const [cycleUsersCount, setCycleUsersCount] = useState(0);
  const [savingPool, setSavingPool] = useState(false);
  const [manualBonus, setManualBonus] = useState("");
  const [bonusDescription, setBonusDescription] = useState("");
  const [addingBonus, setAddingBonus] = useState(false);
  const [revenueHistory, setRevenueHistory] = useState<any[]>([]);

  // Audit state
  const [reconciliationRuns, setReconciliationRuns] = useState<ReconciliationRun[]>([]);
  const [walletLedger, setWalletLedger] = useState<WalletLedgerEntry[]>([]);
  const [runningReconciliation, setRunningReconciliation] = useState(false);

  // Qualification state
  const [qualificationUsers, setQualificationUsers] = useState<any[]>([]);
  const [planConfig, setPlanConfig] = useState<any>(null);
  const [checkpoints, setCheckpoints] = useState<any>(null);
  const [savingQualConfig, setSavingQualConfig] = useState(false);

  // Global stats
  const [globalStats, setGlobalStats] = useState({
    totalRewards: 0,
    activeRewards: 0,
    totalPointsDistributed: 0,
    totalValueDistributed: 0,
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
      fetchEconomyData();
      fetchAuditData();
      fetchQualificationData();

      // Realtime: alerta quando nova reconciliação detectar divergência
      const channel = supabase
        .channel('reconciliation-alerts')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'reconciliation_runs',
          filter: 'status=neq.ok',
        }, (payload) => {
          const run = payload.new as any;
          if (run.status !== 'ok') {
            toast.error(
              `Reconciliação detectou divergência (${run.status}): R$ ${Number(run.total_drift).toFixed(2)} em ${run.wallets_drift} wallet(s)`,
              { duration: 10000 }
            );
            fetchAuditData();
          }
        })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
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

  const fetchEconomyData = async () => {
    try {
      // Get pool percentage from platform_settings
      const { data: settings } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'economic')
        .single();

      if (settings?.value) {
        const pct = (settings.value as any).pool_percentage;
        if (pct) setPoolPercentage(pct);
      }

      // Get current month's revenue
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const { data: revenueData } = await supabase
        .from('revenue_entries')
        .select('*')
        .eq('year_month', yearMonth)
        .order('created_at', { ascending: false });

      setRevenueHistory(revenueData || []);
      const currentRbm = revenueData?.reduce((sum, e) => sum + parseFloat(String(e.amount)), 0) || 0;
      setRbm(currentRbm);
      setPrm(currentRbm * (poolPercentage / 100));

      // Get current cycle users
      const { data: cycle } = await supabase
        .from('economic_cycles')
        .select('id')
        .eq('year_month', yearMonth)
        .maybeSingle();

      if (cycle) {
        const { data: cycleUsers } = await supabase
          .from('economic_cycle_users')
          .select('performance_points')
          .eq('cycle_id', cycle.id);

        const total = cycleUsers?.reduce((sum, u) => sum + parseFloat(String(u.performance_points)), 0) || 0;
        setTotalPP(total);
        setCycleUsersCount(cycleUsers?.length || 0);
      }
    } catch (error) {
      console.error('Error fetching economy data:', error);
    }
  };

  const fetchQualificationData = async () => {
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const [settingsRes, cycleRes] = await Promise.all([
        supabase.from('platform_settings').select('value').eq('key', 'economic').single(),
        supabase.from('economic_cycles').select('id').eq('year_month', yearMonth).maybeSingle(),
      ]);
      const settings = settingsRes.data?.value as any;
      setPlanConfig(settings?.plan_config || null);
      setCheckpoints(settings?.checkpoints || null);

      if (cycleRes.data?.id) {
        const { data: qualUsers } = await supabase
          .from('economic_cycle_users')
          .select('user_id, performance_points, qualified_for_pool, qualification_points, qualification_details, qualification_evaluated_at')
          .eq('cycle_id', cycleRes.data.id)
          .order('qualification_points', { ascending: false });
        setQualificationUsers(qualUsers || []);
      }
    } catch (error) {
      console.error('Error fetching qualification data:', error);
    }
  };

  const handleSaveQualConfig = async (newPlanConfig: any, newCheckpoints: any) => {
    setSavingQualConfig(true);
    try {
      const { data: current } = await supabase.from('platform_settings').select('value').eq('key', 'economic').single();
      const updated = { ...(current?.value as any), plan_config: newPlanConfig, checkpoints: newCheckpoints };
      const { error } = await supabase.from('platform_settings').update({ value: updated }).eq('key', 'economic');
      if (error) throw error;
      setPlanConfig(newPlanConfig);
      setCheckpoints(newCheckpoints);
      toast.success('Configurações de qualificação salvas!');
    } catch (error: any) {
      toast.error('Erro ao salvar: ' + error.message);
    } finally {
      setSavingQualConfig(false);
    }
  };

  const fetchAuditData = async () => {
    try {
      const [runsRes, ledgerRes] = await Promise.all([
        supabase
          .from('reconciliation_runs')
          .select('*')
          .order('run_at', { ascending: false })
          .limit(10),
        supabase
          .from('v_wallet_ledger')
          .select('*')
          .order('drift', { ascending: false }),
      ]);
      setReconciliationRuns((runsRes.data as ReconciliationRun[]) || []);
      setWalletLedger((ledgerRes.data as WalletLedgerEntry[]) || []);
    } catch (error) {
      console.error('Error fetching audit data:', error);
    }
  };

  const handleRunReconciliation = async () => {
    setRunningReconciliation(true);
    try {
      const { data, error } = await supabase.rpc('run_reconciliation');
      if (error) throw error;
      toast.success(`Reconciliação concluída: ${data.status === 'ok' ? '✅ OK' : data.status === 'warning' ? '⚠️ Warning' : '🔴 Erro'}`);
      await fetchAuditData();
    } catch (error: any) {
      toast.error('Erro ao executar reconciliação: ' + error.message);
    } finally {
      setRunningReconciliation(false);
    }
  };

  const handleSavePoolPercentage = async () => {
    setSavingPool(true);
    try {
      const { error } = await supabase
        .from('platform_settings')
        .update({ value: { pool_percentage: poolPercentage } })
        .eq('key', 'economic');

      if (error) throw error;
      setPrm(rbm * (poolPercentage / 100));
      toast.success('Pool atualizado com sucesso!');
    } catch (error) {
      console.error('Error saving pool:', error);
      toast.error('Erro ao salvar pool');
    } finally {
      setSavingPool(false);
    }
  };

  const handleAddManualBonus = async () => {
    const amount = parseFloat(manualBonus);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Insira um valor válido maior que zero');
      return;
    }
    setAddingBonus(true);
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const { error } = await supabase
        .from('revenue_entries')
        .insert({
          year_month: yearMonth,
          revenue_type: 'other',
          amount,
          metadata: { description: bonusDescription || 'Aporte manual no pool' },
        });

      if (error) throw error;

      toast.success(`R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} adicionado ao pool!`);
      setManualBonus("");
      setBonusDescription("");
      fetchEconomyData();
    } catch (error) {
      console.error('Error adding manual bonus:', error);
      toast.error('Erro ao adicionar aporte');
    } finally {
      setAddingBonus(false);
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

  const handleUpdateMilestone = async () => {
    if (!editingMilestone) return;

    try {
      const { error } = await supabase
        .from('creator_milestones')
        .update({
          points_reward: editingMilestone.points_reward,
          value_reward: editingMilestone.value_reward,
          title: editingMilestone.title,
          description: editingMilestone.description,
          active: editingMilestone.active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingMilestone.id);

      if (error) throw error;

      toast.success('Meta atualizada com sucesso!');
      setIsMilestoneDialogOpen(false);
      setEditingMilestone(null);
      fetchMilestones();
    } catch (error) {
      console.error('Error updating milestone:', error);
      toast.error('Erro ao atualizar meta');
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

  const handleToggleMilestoneActive = async (milestone: CreatorMilestone) => {
    try {
      const { error } = await supabase
        .from('creator_milestones')
        .update({ 
          active: !milestone.active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', milestone.id);

      if (error) throw error;

      toast.success(`Meta ${!milestone.active ? 'ativada' : 'desativada'} com sucesso!`);
      fetchMilestones();
    } catch (error) {
      console.error('Error toggling milestone:', error);
      toast.error('Erro ao atualizar status');
    }
  };

  const openEditDialog = (reward: RewardConfig) => {
    setEditingReward({ ...reward });
    setIsDialogOpen(true);
  };

  const openMilestoneEditDialog = (milestone: CreatorMilestone) => {
    setEditingMilestone({ ...milestone });
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
            <TabsTrigger value="economy" className="gap-2">
              <DollarSign className="w-4 h-4" />
              Economia
            </TabsTrigger>
            <TabsTrigger value="qualificacao" className="gap-2">
              <Target className="w-4 h-4" />
              Qualificação
            </TabsTrigger>
            <TabsTrigger value="auditoria" className="gap-2">
              <ShieldCheck className="w-4 h-4" />
              Auditoria
              {reconciliationRuns[0]?.status === 'error' && (
                <span className="ml-1 w-2 h-2 rounded-full bg-red-500 inline-block" />
              )}
              {reconciliationRuns[0]?.status === 'warning' && (
                <span className="ml-1 w-2 h-2 rounded-full bg-yellow-500 inline-block" />
              )}
            </TabsTrigger>
          </TabsList>

          {/* User Rewards Tab */}
          <TabsContent value="rewards" className="space-y-6">
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
                    <p className="text-sm text-muted-foreground">Resgatadas</p>
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
                      <TableHead className="text-center">Pontos Bônus</TableHead>
                      <TableHead className="text-center">Completaram</TableHead>
                      <TableHead className="text-center">Resgataram</TableHead>
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
                          <TableCell className="text-center">
                            <span className="text-primary font-medium">+{milestone.points_reward} PP</span>
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

          {/* Economy Tab */}
          <TabsContent value="economy" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <DollarSign className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">RBM (Receita Bruta)</p>
                    <h3 className="text-2xl font-bold">
                      R$ {rbm.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </h3>
                    <p className="text-xs text-muted-foreground">Mês atual</p>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-accent/10 rounded-lg">
                    <Coins className="h-6 w-6 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">PRM (Pool)</p>
                    <h3 className="text-2xl font-bold">
                      R$ {prm.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </h3>
                    <p className="text-xs text-muted-foreground">{poolPercentage}% da receita</p>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-muted rounded-lg">
                    <Activity className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Performance Points</p>
                    <h3 className="text-2xl font-bold">{totalPP.toLocaleString('pt-BR')}</h3>
                    <p className="text-xs text-muted-foreground">Total no ciclo</p>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-muted rounded-lg">
                    <Users className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Usuários no Pool</p>
                    <h3 className="text-2xl font-bold">{cycleUsersCount}</h3>
                    <p className="text-xs text-muted-foreground">Com pontos este mês</p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Pool Configuration */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Configuração do Pool</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm font-medium">Percentual do Pool (%)</label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={poolPercentage}
                    onChange={(e) => setPoolPercentage(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    % da receita distribuída como recompensa
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">PRM Estimado</label>
                  <p className="text-2xl font-bold mt-1">
                    R$ {(rbm * (poolPercentage / 100)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">Payout Médio Estimado</label>
                  <p className="text-2xl font-bold mt-1">
                    R$ {cycleUsersCount > 0 
                      ? ((rbm * (poolPercentage / 100)) / cycleUsersCount).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) 
                      : '0,00'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Por usuário (média simples)
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <Button onClick={handleSavePoolPercentage} disabled={savingPool}>
                  {savingPool ? 'Salvando...' : 'Salvar Configuração'}
                </Button>
              </div>
            </Card>

            {/* Manual Bonus Injection */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-2">Aporte Manual no Pool</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Adicione um valor extra ao pool do mês atual. Esse valor será somado à receita bruta (RBM) para o cálculo do PRM.
              </p>
              <div className="grid gap-4 md:grid-cols-3 items-end">
                <div>
                  <label className="text-sm font-medium">Valor (R$)</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Ex: 50000"
                    value={manualBonus}
                    onChange={(e) => setManualBonus(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Descrição (opcional)</label>
                  <Input
                    placeholder="Ex: Ação de marketing março"
                    value={bonusDescription}
                    onChange={(e) => setBonusDescription(e.target.value)}
                  />
                </div>
                <div>
                  <Button onClick={handleAddManualBonus} disabled={addingBonus || !manualBonus}>
                    {addingBonus ? 'Adicionando...' : 'Adicionar ao Pool'}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Revenue History */}
            {revenueHistory.length > 0 && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Histórico de Receitas do Mês</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueHistory.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-muted-foreground">
                          {new Date(entry.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {entry.revenue_type === 'other' ? 'Aporte Manual' : entry.revenue_type?.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {(entry.metadata as any)?.description || '—'}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          R$ {parseFloat(entry.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}

            {/* Simulator */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Simulador de Distribuição</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Receita Bruta Mensal</span>
                  <span className="font-semibold">R$ {rbm.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Pool ({poolPercentage}%)</span>
                  <span className="font-semibold text-primary">R$ {(rbm * (poolPercentage / 100)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Plataforma ({100 - poolPercentage}%)</span>
                  <span className="font-semibold">R$ {(rbm * ((100 - poolPercentage) / 100)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Total Performance Points</span>
                  <span className="font-semibold">{totalPP.toLocaleString('pt-BR')}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Valor por Ponto</span>
                  <span className="font-semibold">
                    R$ {totalPP > 0 
                      ? ((rbm * (poolPercentage / 100)) / totalPP).toLocaleString('pt-BR', { minimumFractionDigits: 4 }) 
                      : '—'}
                  </span>
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* ── QUALIFICAÇÃO ────────────────────────────────────── */}
          <TabsContent value="qualificacao" className="space-y-6">

            {/* Config por plano */}
            {planConfig && (
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">Configuração por Plano</h3>
                    <p className="text-sm text-muted-foreground">Multiplier de PP, dias de maturação e pontos mínimos para qualificação</p>
                  </div>
                  <Button size="sm" disabled={savingQualConfig} onClick={() => handleSaveQualConfig(planConfig, checkpoints)}>
                    {savingQualConfig ? 'Salvando...' : 'Salvar'}
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {(['free', 'pro', 'premium'] as const).map((plan) => {
                    const cfg = planConfig[plan] || {};
                    const colors = { free: 'border-gray-200', pro: 'border-blue-200 bg-blue-50/30', premium: 'border-yellow-200 bg-yellow-50/30' };
                    return (
                      <div key={plan} className={`p-4 border-2 rounded-lg ${colors[plan]} space-y-3`}>
                        <h4 className="font-semibold capitalize text-base">{plan}</h4>
                        <div>
                          <label className="text-xs text-muted-foreground">Multiplier de PP</label>
                          <Input type="number" step="0.1" min="0" max="10"
                            defaultValue={cfg.multiplier ?? 1}
                            onChange={(e) => { planConfig[plan].multiplier = parseFloat(e.target.value); setPlanConfig({...planConfig}); }}
                            className="mt-1 h-8 text-sm" />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Dias de maturação</label>
                          <Input type="number" min="0" max="365"
                            defaultValue={cfg.maturation_days ?? 30}
                            onChange={(e) => { planConfig[plan].maturation_days = parseInt(e.target.value); setPlanConfig({...planConfig}); }}
                            className="mt-1 h-8 text-sm" />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Mín. QP para qualificar</label>
                          <Input type="number" min="0" max="200"
                            defaultValue={cfg.qualification_threshold ?? 60}
                            onChange={(e) => { planConfig[plan].qualification_threshold = parseInt(e.target.value); setPlanConfig({...planConfig}); }}
                            className="mt-1 h-8 text-sm" />
                        </div>
                        <div className="text-xs text-muted-foreground pt-1 border-t">
                          {plan === 'free' && 'Ganha pouco, matura devagar, precisa se esforçar'}
                          {plan === 'pro' && 'Ganha normal, matura médio, qualificação acessível'}
                          {plan === 'premium' && 'Ganha mais, matura rápido, qualifica automaticamente'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Config de checkpoints */}
            {checkpoints && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-1">Checkpoints de Qualificação</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Pontos de qualificação (QP) concedidos por ação. Premium qualifica com apenas subscription_paid.
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    { key: 'referral_signup',   label: 'Indicação cadastrada',      tip: 'QP por cada novo indicado que se cadastrar' },
                    { key: 'referral_upgrade',  label: 'Indicação convertida',       tip: 'QP por cada indicado que fez upgrade pago' },
                    { key: 'share_content',     label: 'Compartilhou conteúdo',      tip: 'QP por share (com máximo mensal)' },
                    { key: 'subscription_paid', label: 'Plano pago ativo',           tip: 'QP fixo para quem tem Pro ou Premium' },
                    { key: 'boost_purchased',   label: 'Comprou boost no mês',       tip: 'QP fixo por ter comprado boost' },
                    { key: 'content_purchased', label: 'Comprou conteúdo pago',      tip: 'QP fixo por ter comprado conteúdo' },
                    { key: 'active_days',       label: 'Dias ativos (≥ min)',         tip: 'QP fixo ao atingir mínimo de dias ativos' },
                    { key: 'content_completed', label: 'Conteúdos completados (≥ min)',tip: 'QP fixo ao atingir mínimo de WATCH_100' },
                    { key: 'engagement',        label: 'Engajamento (≥ min)',         tip: 'QP fixo ao atingir mínimo de likes/saves/comments' },
                  ].map(({ key, label, tip }) => {
                    const cp = checkpoints[key] || {};
                    return (
                      <div key={key} className="p-3 bg-muted/30 rounded-lg space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-medium">{label}</p>
                            <p className="text-xs text-muted-foreground">{tip}</p>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {cp.qp !== undefined && (
                            <div className="flex-1 min-w-[80px]">
                              <label className="text-xs text-muted-foreground">QP</label>
                              <Input type="number" min="0" defaultValue={cp.qp}
                                onChange={(e) => { checkpoints[key].qp = parseInt(e.target.value); setCheckpoints({...checkpoints}); }}
                                className="h-7 text-xs mt-0.5" />
                            </div>
                          )}
                          {cp.qp_per_action !== undefined && (
                            <div className="flex-1 min-w-[80px]">
                              <label className="text-xs text-muted-foreground">QP/ação</label>
                              <Input type="number" min="0" defaultValue={cp.qp_per_action}
                                onChange={(e) => { checkpoints[key].qp_per_action = parseInt(e.target.value); setCheckpoints({...checkpoints}); }}
                                className="h-7 text-xs mt-0.5" />
                            </div>
                          )}
                          {cp.max_qp !== undefined && (
                            <div className="flex-1 min-w-[80px]">
                              <label className="text-xs text-muted-foreground">Máx QP</label>
                              <Input type="number" min="0" defaultValue={cp.max_qp}
                                onChange={(e) => { checkpoints[key].max_qp = parseInt(e.target.value); setCheckpoints({...checkpoints}); }}
                                className="h-7 text-xs mt-0.5" />
                            </div>
                          )}
                          {cp.required_days !== undefined && (
                            <div className="flex-1 min-w-[80px]">
                              <label className="text-xs text-muted-foreground">Dias mín.</label>
                              <Input type="number" min="1" max="31" defaultValue={cp.required_days}
                                onChange={(e) => { checkpoints[key].required_days = parseInt(e.target.value); setCheckpoints({...checkpoints}); }}
                                className="h-7 text-xs mt-0.5" />
                            </div>
                          )}
                          {cp.required_count !== undefined && (
                            <div className="flex-1 min-w-[80px]">
                              <label className="text-xs text-muted-foreground">Qtd mín.</label>
                              <Input type="number" min="1" defaultValue={cp.required_count}
                                onChange={(e) => { checkpoints[key].required_count = parseInt(e.target.value); setCheckpoints({...checkpoints}); }}
                                className="h-7 text-xs mt-0.5" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end">
                  <Button disabled={savingQualConfig} onClick={() => handleSaveQualConfig(planConfig, checkpoints)}>
                    {savingQualConfig ? 'Salvando...' : 'Salvar Checkpoints'}
                  </Button>
                </div>
              </Card>
            )}

            {/* Status de qualificação do ciclo atual */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">Status do Ciclo Atual</h3>
                  <p className="text-sm text-muted-foreground">
                    {qualificationUsers.filter(u => u.qualified_for_pool).length} qualificados ·{' '}
                    {qualificationUsers.filter(u => !u.qualified_for_pool).length} não qualificados ·{' '}
                    {qualificationUsers.length} total
                  </p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead className="text-right">PP Acumulados</TableHead>
                    <TableHead className="text-right">QP</TableHead>
                    <TableHead>Top checkpoints</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Avaliado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {qualificationUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Nenhum usuário no ciclo atual ainda
                      </TableCell>
                    </TableRow>
                  ) : (
                    qualificationUsers.map((u) => {
                      const details = u.qualification_details || {};
                      const threshold = details.threshold || 60;
                      const topCheckpoints = Object.entries(details)
                        .filter(([k, v]: [string, any]) => v?.qp > 0 && k !== 'threshold' && k !== 'plan')
                        .sort(([, a]: any, [, b]: any) => b.qp - a.qp)
                        .slice(0, 3)
                        .map(([k, v]: any) => `${k.replace(/_/g, ' ')} +${v.qp}`);
                      return (
                        <TableRow key={u.user_id}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {u.user_id.slice(0, 8)}…
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {Number(u.performance_points).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={`font-semibold ${Number(u.qualification_points) >= threshold ? 'text-green-600' : 'text-muted-foreground'}`}>
                              {Number(u.qualification_points).toFixed(0)}
                              <span className="text-xs text-muted-foreground font-normal">/{threshold}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {topCheckpoints.join(' · ') || '—'}
                          </TableCell>
                          <TableCell>
                            {u.qualified_for_pool ? (
                              <Badge variant="outline" className="text-green-700 border-green-300 gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Qualificado
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground gap-1">
                                <XCircle className="w-3 h-3" /> Não qualificado
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {u.qualification_evaluated_at
                              ? new Date(u.qualification_evaluated_at).toLocaleDateString('pt-BR')
                              : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Card>

          </TabsContent>

          {/* ── AUDITORIA ──────────────────────────────────────── */}
          <TabsContent value="auditoria" className="space-y-6">

            {/* Status da última reconciliação */}
            {(() => {
              const last = reconciliationRuns[0];
              const statusConfig = {
                ok:      { icon: CheckCircle2, color: 'text-green-600',  bg: 'bg-green-50 border-green-200',  label: 'Sistema Íntegro' },
                warning: { icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200', label: 'Atenção' },
                error:   { icon: XCircle,       color: 'text-red-600',    bg: 'bg-red-50 border-red-200',       label: 'Divergência Detectada' },
              };
              const cfg = last ? statusConfig[last.status] : null;
              const Icon = cfg?.icon ?? ShieldCheck;
              return (
                <Card className={`p-6 border-2 ${cfg ? cfg.bg : 'bg-muted/30'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-full ${cfg ? cfg.bg : 'bg-muted'}`}>
                        <Icon className={`h-8 w-8 ${cfg ? cfg.color : 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <h3 className={`text-xl font-bold ${cfg ? cfg.color : 'text-muted-foreground'}`}>
                          {cfg ? cfg.label : 'Nenhuma reconciliação executada'}
                        </h3>
                        {last && (
                          <p className="text-sm text-muted-foreground mt-0.5">
                            Última verificação: {new Date(last.run_at).toLocaleString('pt-BR')}
                            {' · '}{last.wallets_ok + last.wallets_drift} wallets verificadas
                            {' · '}{last.cycles_ok + last.cycles_drift} ciclos verificados
                          </p>
                        )}
                        {last?.wallets_drift > 0 && (
                          <p className="text-sm text-red-600 font-medium mt-1">
                            {last.wallets_drift} wallet(s) com drift · Total: R$ {Number(last.total_drift).toFixed(2)}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      onClick={handleRunReconciliation}
                      disabled={runningReconciliation}
                      variant="outline"
                      className="gap-2"
                    >
                      <RefreshCw className={`h-4 w-4 ${runningReconciliation ? 'animate-spin' : ''}`} />
                      {runningReconciliation ? 'Verificando...' : 'Rodar Agora'}
                    </Button>
                  </div>

                  {/* Issues detalhadas se houver */}
                  {last?.details?.wallet_issues && last.details.wallet_issues.length > 0 && (
                    <div className="mt-4 p-4 rounded-lg bg-red-100 border border-red-200">
                      <p className="text-sm font-semibold text-red-700 mb-2">Wallets com divergência:</p>
                      {last.details.wallet_issues.map((issue, i) => (
                        <div key={i} className="text-xs text-red-600 font-mono">
                          user {issue.user_id.slice(0, 8)}… · stored: R${Number(issue.balance_stored).toFixed(2)} · ledger: R${Number(issue.balance_ledger).toFixed(2)} · drift: R${Number(issue.drift).toFixed(2)}
                        </div>
                      ))}
                    </div>
                  )}
                  {last?.details?.cycle_issues && last.details.cycle_issues.length > 0 && (
                    <div className="mt-4 p-4 rounded-lg bg-yellow-100 border border-yellow-200">
                      <p className="text-sm font-semibold text-yellow-700 mb-2">Ciclos com divergência:</p>
                      {last.details.cycle_issues.map((issue, i) => (
                        <div key={i} className="text-xs text-yellow-700 font-mono">
                          {issue.year_month} · distribuído: R${Number(issue.distributed_stored).toFixed(2)} · txs: R${Number(issue.distributed_from_txs).toFixed(2)} · drift: R${Number(issue.drift).toFixed(2)}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })()}

            {/* Ledger — estado de todas as wallets */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">Ledger — Integridade de Saldos</h3>
                  <p className="text-sm text-muted-foreground">
                    Drift = balance armazenado − soma das transações. Deve ser sempre R$0,00.
                  </p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead className="text-right">Saldo Armazenado</TableHead>
                    <TableHead className="text-right">Saldo pelo Ledger</TableHead>
                    <TableHead className="text-right">Drift</TableHead>
                    <TableHead className="text-right">Txs</TableHead>
                    <TableHead className="text-right">Última Tx</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {walletLedger.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        Nenhuma wallet encontrada
                      </TableCell>
                    </TableRow>
                  ) : (
                    walletLedger.map((entry) => {
                      const hasDrift = Math.abs(Number(entry.drift)) > 0.01;
                      return (
                        <TableRow key={entry.wallet_id} className={hasDrift ? 'bg-red-50' : ''}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {entry.user_id.slice(0, 8)}…
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            R$ {Number(entry.balance_stored).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            R$ {Number(entry.balance_from_ledger).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className={`text-right font-semibold ${hasDrift ? 'text-red-600' : 'text-green-600'}`}>
                            {hasDrift ? `R$ ${Number(entry.drift).toFixed(4)}` : '—'}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground text-sm">
                            {entry.tx_count}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground text-sm">
                            {entry.last_tx_at
                              ? new Date(entry.last_tx_at).toLocaleDateString('pt-BR')
                              : '—'}
                          </TableCell>
                          <TableCell>
                            {hasDrift ? (
                              <Badge variant="destructive" className="gap-1">
                                <XCircle className="w-3 h-3" /> Divergente
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 text-green-700 border-green-300">
                                <CheckCircle2 className="w-3 h-3" /> OK
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Card>

            {/* Histórico de execuções */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Histórico de Reconciliações</h3>
              {reconciliationRuns.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Nenhuma execução ainda. Clique em "Rodar Agora" para começar.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data / Hora</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead className="text-right">Wallets OK</TableHead>
                      <TableHead className="text-right">Wallets c/ drift</TableHead>
                      <TableHead className="text-right">Ciclos OK</TableHead>
                      <TableHead className="text-right">Drift Total</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconciliationRuns.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="text-sm">
                          {new Date(run.run_at).toLocaleString('pt-BR')}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {run.period ?? 'Completo'}
                        </TableCell>
                        <TableCell className="text-right text-green-700">
                          {run.wallets_ok}
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${run.wallets_drift > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {run.wallets_drift}
                        </TableCell>
                        <TableCell className="text-right text-green-700">
                          {run.cycles_ok}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm ${Number(run.total_drift) > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {Number(run.total_drift) > 0 ? `R$ ${Number(run.total_drift).toFixed(4)}` : '—'}
                        </TableCell>
                        <TableCell>
                          {run.status === 'ok' && (
                            <Badge variant="outline" className="text-green-700 border-green-300 gap-1">
                              <CheckCircle2 className="w-3 h-3" /> OK
                            </Badge>
                          )}
                          {run.status === 'warning' && (
                            <Badge variant="outline" className="text-yellow-700 border-yellow-400 gap-1">
                              <AlertTriangle className="w-3 h-3" /> Warning
                            </Badge>
                          )}
                          {run.status === 'error' && (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="w-3 h-3" /> Erro
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

          </TabsContent>
        </Tabs>

        {/* Edit Reward Dialog */}
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
                      step="0.01"
                      min="0"
                      value={editingReward.points_user}
                      onChange={(e) =>
                        setEditingReward({ ...editingReward, points_user: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Pontos Criador</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editingReward.points_creator}
                      onChange={(e) =>
                        setEditingReward({ ...editingReward, points_creator: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                  💡 Os pontos definem o peso de performance. O valor em R$ é calculado proporcionalmente ao pool no fechamento mensal do ciclo econômico.
                </p>

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
                Ajuste os valores de recompensa para esta meta
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

                <div>
                  <label className="text-sm font-medium">Pontos Bônus</label>
                  <Input
                    type="number"
                    value={editingMilestone.points_reward}
                    onChange={(e) =>
                      setEditingMilestone({ ...editingMilestone, points_reward: Number(e.target.value) })
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    PP acumulados no pool mensal. O valor em R$ será calculado proporcionalmente no fechamento do ciclo.
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
                  <Button onClick={handleUpdateMilestone}>
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

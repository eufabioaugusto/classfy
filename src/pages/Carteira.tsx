import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Wallet, 
  TrendingUp, 
  DollarSign, 
  History, 
  CheckCircle, 
  Clock, 
  XCircle, 
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Calendar
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function Carteira() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<any>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [minWithdrawalAmount, setMinWithdrawalAmount] = useState(10);
  const [withdrawHistory, setWithdrawHistory] = useState<any[]>([]);
  const [rewardHistory, setRewardHistory] = useState<any[]>([]);
  const [stats, setStats] = useState({
    last7Days: 0,
    last30Days: 0,
    thisMonth: 0,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    } else if (user) {
      fetchData();
    }
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    try {
      const [walletRes, configRes, withdrawalsRes, rewardsRes] = await Promise.all([
        supabase.from("wallets").select("*").eq("user_id", user?.id).single(),
        supabase
          .from("system_config")
          .select("*")
          .eq("config_key", "minimum_withdrawal_amount")
          .maybeSingle(),
        supabase
          .from("withdraw_requests")
          .select("*")
          .eq("user_id", user?.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("reward_events")
          .select("*")
          .eq("user_id", user?.id)
          .order("created_at", { ascending: false })
          .limit(50)
      ]);

      if (walletRes.error) throw walletRes.error;

      setWallet(walletRes.data);

      if (configRes.data) {
        const configValue = configRes.data.config_value as { amount: number };
        setMinWithdrawalAmount(configValue.amount);
      }

      if (withdrawalsRes.data) {
        setWithdrawHistory(withdrawalsRes.data);
      }

      if (rewardsRes.data) {
        setRewardHistory(rewardsRes.data);
        
        // Calculate stats
        const now = new Date();
        const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const last7DaysSum = rewardsRes.data
          .filter((r: any) => new Date(r.created_at) >= last7Days)
          .reduce((acc: number, r: any) => acc + Number(r.performance_points || 0), 0);

        const last30DaysSum = rewardsRes.data
          .filter((r: any) => new Date(r.created_at) >= last30Days)
          .reduce((acc: number, r: any) => acc + Number(r.performance_points || 0), 0);

        const thisMonthSum = rewardsRes.data
          .filter((r: any) => new Date(r.created_at) >= monthStart)
          .reduce((acc: number, r: any) => acc + Number(r.performance_points || 0), 0);

        setStats({
          last7Days: last7DaysSum,
          last30Days: last30DaysSum,
          thisMonth: thisMonthSum,
        });
      }
    } catch (error: any) {
      toast({
        title: "Erro ao carregar dados",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const amount = parseFloat(withdrawAmount);
    
    if (!amount || amount <= 0) {
      toast({
        title: "Valor inválido",
        description: "Por favor, insira um valor válido",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    if (amount < minWithdrawalAmount) {
      toast({
        title: "Valor mínimo não atingido",
        description: `O valor mínimo para saque é R$ ${minWithdrawalAmount.toFixed(2)}`,
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    if (amount > wallet.balance) {
      toast({
        title: "Saldo insuficiente",
        description: "Você não possui saldo suficiente para este saque",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    if (!pixKey) {
      toast({
        title: "Chave PIX obrigatória",
        description: "Por favor, insira sua chave PIX",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    try {
      const { error } = await supabase.from("withdraw_requests").insert({
        user_id: user?.id,
        wallet_id: wallet.id,
        amount,
        pix_key: pixKey,
        status: "pending",
      });

      if (error) throw error;

      toast({
        title: "Solicitação enviada",
        description: "Seu pedido de saque está em análise",
      });

      setWithdrawAmount("");
      setPixKey("");
      await fetchData();
    } catch (error: any) {
      toast({
        title: "Erro ao solicitar saque",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case "rejected":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "approved":
        return "Aprovado";
      case "pending":
        return "Pendente";
      case "rejected":
        return "Rejeitado";
      default:
        return status;
    }
  };

  const getActionLabel = (actionKey: string) => {
    const labels: Record<string, string> = {
      VIEW_15S: "Visualização (15s)",
      LIKE_CONTENT: "Curtida",
      COMMENT_CONTENT: "Comentário",
      SAVE_CONTENT: "Salvamento",
      SHARE_CONTENT: "Compartilhamento",
      WATCH_50: "Assistiu 50%",
      WATCH_100: "Assistiu 100%",
      DAILY_LOGIN: "Login Diário",
      FIRST_CONTENT_WEEK: "Primeiro conteúdo da semana",
      BINGE_WATCH: "Maratona",
      PROFILE_COMPLETE: "Perfil Completo",
      REFERRAL_SIGNUP: "Indicação",
      REFERRAL_PURCHASE: "Compra por indicação",
      MILESTONE_100_VIEWS: "Marco: 100 views",
      MILESTONE_500_VIEWS: "Marco: 500 views",
      MILESTONE_1000_VIEWS: "Marco: 1000 views",
      STREAK_7: "Sequência de 7 dias",
      STREAK_30: "Sequência de 30 dias",
    };
    return labels[actionKey] || actionKey;
  };

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <AdminLayout title="Carteira">
      <div className="container mx-auto p-4 sm:p-6 max-w-7xl space-y-6">
        
        {/* Withdraw Card - Hero Section */}
        <Card className="bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 text-white border-0 overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-red-600/5 via-transparent to-transparent pointer-events-none" />
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl sm:text-2xl text-white flex items-center gap-2">
                  <Wallet className="h-5 w-5 sm:h-6 sm:w-6 text-red-500" />
                  Solicitar Saque
                </CardTitle>
                <CardDescription className="text-zinc-400 mt-1">
                  Valor mínimo: R$ {minWithdrawalAmount.toFixed(2)}
                </CardDescription>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-400">Saldo disponível</p>
                <p className="text-2xl sm:text-3xl font-bold text-green-400">
                  R$ {wallet?.balance?.toFixed(2) || "0.00"}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="relative">
            <form onSubmit={handleWithdraw} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="amount" className="text-zinc-300">Valor do Saque (R$)</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="0.00"
                    disabled={submitting}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-red-500 focus:ring-red-500/20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pixKey" className="text-zinc-300">Chave PIX</Label>
                  <Input
                    id="pixKey"
                    type="text"
                    value={pixKey}
                    onChange={(e) => setPixKey(e.target.value)}
                    placeholder="CPF, CNPJ, Email, Telefone ou Chave Aleatória"
                    disabled={submitting}
                    className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-red-500 focus:ring-red-500/20"
                  />
                </div>
              </div>

              <Button 
                type="submit" 
                disabled={submitting} 
                className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-8"
              >
                {submitting ? "Processando..." : "Solicitar Saque"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-6 sm:pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">Saldo Disponível</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
              <div className="text-lg sm:text-2xl font-bold text-green-600">
                R$ {wallet?.balance?.toFixed(2) || "0.00"}
              </div>
              <p className="text-xs text-muted-foreground mt-1 hidden sm:block">
                Disponível para saque
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-6 sm:pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">Total Ganho</CardTitle>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
              <div className="text-lg sm:text-2xl font-bold">
                R$ {wallet?.total_earned?.toFixed(2) || "0.00"}
              </div>
              <p className="text-xs text-muted-foreground mt-1 hidden sm:block">
                Histórico completo
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-6 sm:pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">Total Sacado</CardTitle>
              <ArrowDownRight className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
              <div className="text-lg sm:text-2xl font-bold">
                R$ {wallet?.total_withdrawn?.toFixed(2) || "0.00"}
              </div>
              <p className="text-xs text-muted-foreground mt-1 hidden sm:block">
                Saques realizados
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-6 sm:pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">Este Mês</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
              <div className="text-lg sm:text-2xl font-bold text-blue-600">
                {Math.floor(stats.thisMonth)} PP
              </div>
              <p className="text-xs text-muted-foreground mt-1 hidden sm:block">
                Ganhos do mês atual
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3 sm:gap-6">
          <Card>
            <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-2">
              <CardTitle className="text-sm sm:text-base">Últimos 7 dias</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
              <div className="text-xl sm:text-3xl font-bold text-primary">
                {Math.floor(stats.last7Days)} PP
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 sm:mt-2">
                Ganhos na última semana
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-2">
              <CardTitle className="text-sm sm:text-base">Últimos 30 dias</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
              <div className="text-xl sm:text-3xl font-bold text-primary">
                {Math.floor(stats.last30Days)} PP
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 sm:mt-2">
                Ganhos no último mês
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs for History */}
        <Tabs defaultValue="saques" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 h-auto p-1">
            <TabsTrigger value="saques" className="py-2 text-xs sm:text-sm">
              <History className="h-4 w-4 mr-1 sm:mr-2" />
              <span>Histórico de Saques</span>
            </TabsTrigger>
            <TabsTrigger value="ganhos" className="py-2 text-xs sm:text-sm">
              <TrendingUp className="h-4 w-4 mr-1 sm:mr-2" />
              <span>Histórico de Ganhos</span>
            </TabsTrigger>
          </TabsList>

          {/* Withdrawal History Tab */}
          <TabsContent value="saques">
            <Card>
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="text-base sm:text-lg">Histórico de Saques</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Acompanhe suas solicitações de saque
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 sm:p-6 pt-0">
                {withdrawHistory.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhuma solicitação de saque ainda
                  </div>
                ) : (
                  <>
                    {/* Desktop Table */}
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Valor</TableHead>
                            <TableHead>Chave PIX</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {withdrawHistory.map((withdrawal) => (
                            <TableRow key={withdrawal.id}>
                              <TableCell>
                                {format(new Date(withdrawal.created_at), "dd/MM/yyyy HH:mm", {
                                  locale: ptBR,
                                })}
                              </TableCell>
                              <TableCell className="font-medium">
                                R$ {withdrawal.amount.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {withdrawal.pix_key}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {getStatusIcon(withdrawal.status)}
                                  <span className="capitalize">{getStatusText(withdrawal.status)}</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    
                    {/* Mobile Cards */}
                    <div className="md:hidden space-y-3">
                      {withdrawHistory.map((withdrawal) => (
                        <div 
                          key={withdrawal.id}
                          className="border rounded-lg p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-lg font-semibold">
                              R$ {withdrawal.amount.toFixed(2)}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {getStatusIcon(withdrawal.status)}
                              <span className="text-sm capitalize">{getStatusText(withdrawal.status)}</span>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p className="truncate">PIX: {withdrawal.pix_key}</p>
                            <p>
                              {format(new Date(withdrawal.created_at), "dd/MM/yyyy 'às' HH:mm", {
                                locale: ptBR,
                              })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Earnings History Tab */}
          <TabsContent value="ganhos">
            <Card>
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="text-base sm:text-lg">Histórico de Ganhos</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Suas recompensas e ganhos registrados
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 sm:p-6 pt-0">
                {rewardHistory.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhum ganho registrado ainda
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[600px] overflow-y-auto">
                    {rewardHistory.map((reward) => (
                      <div
                        key={reward.id}
                        className="flex items-center justify-between p-3 sm:p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          <div className="p-1.5 sm:p-2 rounded-full bg-primary/10 flex-shrink-0">
                            <DollarSign className="h-3 w-3 sm:h-4 sm:w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm sm:text-base truncate">{getActionLabel(reward.action_key)}</p>
                            <p className="text-xs sm:text-sm text-muted-foreground">
                              {format(new Date(reward.created_at), "dd/MM/yy HH:mm", {
                                locale: ptBR,
                              })}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-2">
                          <p className="font-bold text-green-600 text-sm sm:text-base">
                            + {Math.floor(Number(reward.performance_points || 0))} PP
                          </p>
                          <p className="text-xs sm:text-sm text-muted-foreground">
                            {reward.points} pts
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}

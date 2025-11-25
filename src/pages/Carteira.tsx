import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
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
          .reduce((acc: number, r: any) => acc + Number(r.value), 0);

        const last30DaysSum = rewardsRes.data
          .filter((r: any) => new Date(r.created_at) >= last30Days)
          .reduce((acc: number, r: any) => acc + Number(r.value), 0);

        const thisMonthSum = rewardsRes.data
          .filter((r: any) => new Date(r.created_at) >= monthStart)
          .reduce((acc: number, r: any) => acc + Number(r.value), 0);

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
      view: "Visualização",
      like: "Curtida",
      comment: "Comentário",
      save: "Salvamento",
      share: "Compartilhamento",
      complete_video: "Vídeo Completo",
      quiz_complete: "Quiz Completo",
      first_content: "Primeiro Conteúdo",
      profile_complete: "Perfil Completo",
      referral_signup: "Indicação",
      daily_login: "Login Diário",
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
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Carteira</h1>
        <p className="text-muted-foreground">
          Gerencie seus ganhos, solicite saques e acompanhe seu histórico financeiro
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Disponível</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              R$ {wallet?.balance?.toFixed(2) || "0.00"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Disponível para saque
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Ganho</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              R$ {wallet?.total_earned?.toFixed(2) || "0.00"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Histórico completo
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sacado</CardTitle>
            <ArrowDownRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              R$ {wallet?.total_withdrawn?.toFixed(2) || "0.00"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Saques realizados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Este Mês</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              R$ {stats.thisMonth.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Ganhos do mês atual
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos 7 dias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              R$ {stats.last7Days.toFixed(2)}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Ganhos na última semana
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos 30 dias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              R$ {stats.last30Days.toFixed(2)}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Ganhos no último mês
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="saque" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="saque">Solicitar Saque</TabsTrigger>
          <TabsTrigger value="saques">Histórico de Saques</TabsTrigger>
          <TabsTrigger value="ganhos">Histórico de Ganhos</TabsTrigger>
        </TabsList>

        {/* Withdraw Tab */}
        <TabsContent value="saque">
          <Card>
            <CardHeader>
              <CardTitle>Solicitar Saque</CardTitle>
              <CardDescription>
                Valor mínimo para saque: R$ {minWithdrawalAmount.toFixed(2)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleWithdraw} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">Valor do Saque (R$)</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="0.00"
                    disabled={submitting}
                  />
                  <p className="text-sm text-muted-foreground">
                    Saldo disponível: R$ {wallet?.balance?.toFixed(2) || "0.00"}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pixKey">Chave PIX</Label>
                  <Input
                    id="pixKey"
                    type="text"
                    value={pixKey}
                    onChange={(e) => setPixKey(e.target.value)}
                    placeholder="CPF, CNPJ, Email, Telefone ou Chave Aleatória"
                    disabled={submitting}
                  />
                </div>

                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? "Processando..." : "Solicitar Saque"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Withdrawal History Tab */}
        <TabsContent value="saques">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Saques</CardTitle>
              <CardDescription>
                Acompanhe todas as suas solicitações de saque
              </CardDescription>
            </CardHeader>
            <CardContent>
              {withdrawHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhuma solicitação de saque ainda
                </div>
              ) : (
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
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Earnings History Tab */}
        <TabsContent value="ganhos">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Ganhos</CardTitle>
              <CardDescription>
                Todas as suas recompensas e ganhos registrados
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rewardHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhum ganho registrado ainda
                </div>
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {rewardHistory.map((reward) => (
                    <div
                      key={reward.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-primary/10">
                          <DollarSign className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{getActionLabel(reward.action_key)}</p>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(reward.created_at), "dd/MM/yyyy 'às' HH:mm", {
                              locale: ptBR,
                            })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-green-600">
                          + R$ {Number(reward.value).toFixed(2)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {reward.points} pontos
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
  );
}

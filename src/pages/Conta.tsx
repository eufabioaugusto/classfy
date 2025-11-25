import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Wallet, TrendingUp, DollarSign, Trophy, Sparkles, CheckCircle, Clock, XCircle, AlertCircle, History } from "lucide-react";
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
import { BecomeCreatorModal } from "@/components/BecomeCreatorModal";
import { EditableAvatar } from "@/components/EditableAvatar";
import { UserBadges } from "@/components/UserBadges";
import { useProfileComplete } from "@/hooks/useProfileComplete";

export default function Conta() {
  const { user, loading: authLoading, role, profile: userProfile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [creatorModalOpen, setCreatorModalOpen] = useState(false);
  const [minWithdrawalAmount, setMinWithdrawalAmount] = useState(10);
  const [withdrawHistory, setWithdrawHistory] = useState<any[]>([]);

  // Check if profile is complete and reward user
  useProfileComplete(user?.id, profile);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    } else if (user) {
      fetchData();
    }
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    try {
      const [walletRes, profileRes, configRes, withdrawalsRes] = await Promise.all([
        supabase.from("wallets").select("*").eq("user_id", user?.id).single(),
        supabase.from("profiles").select("*").eq("id", user?.id).single(),
        supabase
          .from("system_config")
          .select("*")
          .eq("config_key", "minimum_withdrawal_amount")
          .maybeSingle(),
        supabase
          .from("withdraw_requests")
          .select("*")
          .eq("user_id", user?.id)
          .order("created_at", { ascending: false })
      ]);

      if (walletRes.error) throw walletRes.error;
      if (profileRes.error) throw profileRes.error;

      setWallet(walletRes.data);
      setProfile(profileRes.data);

      if (configRes.data) {
        const configValue = configRes.data.config_value as { amount: number };
        setMinWithdrawalAmount(configValue.amount);
      }

      if (withdrawalsRes.data) {
        setWithdrawHistory(withdrawalsRes.data);
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
        description: "Insira um valor válido para saque.",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    if (amount < minWithdrawalAmount) {
      toast({
        title: "Valor abaixo do mínimo",
        description: `O valor mínimo para saque é R$ ${minWithdrawalAmount.toFixed(2)}.`,
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    if (amount > wallet.balance) {
      toast({
        title: "Saldo insuficiente",
        description: "Você não tem saldo suficiente para este saque.",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    if (!pixKey.trim()) {
      toast({
        title: "Chave PIX obrigatória",
        description: "Insira sua chave PIX para receber o pagamento.",
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
        title: "Solicitação enviada!",
        description: "Seu saque será analisado pela equipe.",
      });

      setWithdrawAmount("");
      setPixKey("");
      fetchData(); // Refresh data including withdrawal history
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

  if (authLoading || loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin">
          <Wallet className="w-12 h-12 text-accent" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="space-y-8">
          {/* Profile Header */}
          <Card className="p-8">
            <div className="flex flex-col md:flex-row items-center gap-8">
              <EditableAvatar 
                userId={user?.id || ""} 
                avatarUrl={profile?.avatar_url}
                displayName={profile?.display_name || ""}
                size="xl"
                editable={true}
              />
              <div className="space-y-2 text-center md:text-left">
                <h1 className="text-4xl font-bold">{profile?.display_name}</h1>
                <div className="flex gap-2 justify-center md:justify-start">
                  <Badge variant="secondary" className="uppercase">
                    {profile?.plan || "free"}
                  </Badge>
                </div>
              </div>
            </div>
          </Card>

          {/* Carteira Section */}
          <Card className="p-8">
            <div className="flex items-center gap-3 mb-6">
              <Wallet className="w-8 h-8 text-accent" />
              <h2 className="text-3xl font-bold">Carteira</h2>
            </div>

            <Tabs defaultValue="overview" className="space-y-6">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="overview">Visão Geral</TabsTrigger>
                <TabsTrigger value="withdraw">Sacar</TabsTrigger>
                <TabsTrigger value="history">Histórico</TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="p-6 space-y-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Wallet className="w-5 h-5" />
                      <span className="text-sm font-medium">Saldo Disponível</span>
                    </div>
                    <p className="text-3xl font-bold text-accent">
                      R$ {wallet?.balance?.toFixed(2) || "0.00"}
                    </p>
                  </Card>

                  <Card className="p-6 space-y-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <TrendingUp className="w-5 h-5" />
                      <span className="text-sm font-medium">Total Ganho</span>
                    </div>
                    <p className="text-3xl font-bold">
                      R$ {wallet?.total_earned?.toFixed(2) || "0.00"}
                    </p>
                  </Card>

                  <Card className="p-6 space-y-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <DollarSign className="w-5 h-5" />
                      <span className="text-sm font-medium">Total Sacado</span>
                    </div>
                    <p className="text-3xl font-bold">
                      R$ {wallet?.total_withdrawn?.toFixed(2) || "0.00"}
                    </p>
                  </Card>
                </div>

                {/* Recent Withdrawals */}
                {withdrawHistory.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-4">Últimas Solicitações</h3>
                    <div className="space-y-3">
                      {withdrawHistory.slice(0, 3).map((withdrawal) => (
                        <div
                          key={withdrawal.id}
                          className="flex items-center justify-between p-4 rounded-lg border border-border/50 bg-card/50"
                        >
                          <div className="flex items-center gap-3">
                            {withdrawal.status === "pending" && <Clock className="w-5 h-5 text-yellow-500" />}
                            {withdrawal.status === "approved" && <CheckCircle className="w-5 h-5 text-green-500" />}
                            {withdrawal.status === "rejected" && <XCircle className="w-5 h-5 text-red-500" />}
                            <div>
                              <p className="font-medium">R$ {withdrawal.amount.toFixed(2)}</p>
                              <p className="text-sm text-muted-foreground">
                                {new Date(withdrawal.created_at).toLocaleDateString("pt-BR")}
                              </p>
                            </div>
                          </div>
                          <Badge
                            variant={
                              withdrawal.status === "approved"
                                ? "default"
                                : withdrawal.status === "rejected"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {withdrawal.status === "pending" && "Pendente"}
                            {withdrawal.status === "approved" && "Aprovado"}
                            {withdrawal.status === "rejected" && "Recusado"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Withdraw Tab */}
              <TabsContent value="withdraw">
                <form onSubmit={handleWithdraw} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="amount">Valor do Saque (R$)</Label>
                    <Input
                      id="amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      required
                      disabled={submitting}
                    />
                    <p className="text-sm text-muted-foreground">
                      Saldo disponível: R$ {wallet?.balance?.toFixed(2) || "0.00"}
                      <br />
                      Valor mínimo: R$ {minWithdrawalAmount.toFixed(2)}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pix">Chave PIX</Label>
                    <Input
                      id="pix"
                      type="text"
                      placeholder="Sua chave PIX (CPF, email, telefone...)"
                      value={pixKey}
                      onChange={(e) => setPixKey(e.target.value)}
                      required
                      disabled={submitting}
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={submitting || !wallet?.balance || wallet.balance <= 0}
                  >
                    {submitting ? "Processando..." : "Solicitar Saque"}
                  </Button>
                </form>
              </TabsContent>

              {/* History Tab */}
              <TabsContent value="history">
                {withdrawHistory.length === 0 ? (
                  <div className="text-center py-12">
                    <History className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">Nenhum saque solicitado ainda</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Chave PIX</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Observações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {withdrawHistory.map((withdrawal) => (
                        <TableRow key={withdrawal.id}>
                          <TableCell>
                            {new Date(withdrawal.created_at).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </TableCell>
                          <TableCell className="font-medium">
                            R$ {withdrawal.amount.toFixed(2)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {withdrawal.pix_key}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                withdrawal.status === "approved"
                                  ? "default"
                                  : withdrawal.status === "rejected"
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="flex items-center gap-1 w-fit"
                            >
                              {withdrawal.status === "pending" && (
                                <>
                                  <Clock className="w-3 h-3" />
                                  Pendente
                                </>
                              )}
                              {withdrawal.status === "approved" && (
                                <>
                                  <CheckCircle className="w-3 h-3" />
                                  Aprovado
                                </>
                              )}
                              {withdrawal.status === "rejected" && (
                                <>
                                  <XCircle className="w-3 h-3" />
                                  Recusado
                                </>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {withdrawal.admin_notes ? (
                              <span className="text-sm text-muted-foreground">
                                {withdrawal.admin_notes}
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            </Tabs>
          </Card>

          {/* Plan Info */}
          <Card className="p-8">
            <h2 className="text-2xl font-bold mb-6">Gerenciar Plano</h2>
            
            {/* Current Plan */}
            <div className="mb-6 p-4 rounded-lg bg-accent/10 border border-accent/20">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-lg">
                    Plano {profile?.plan?.toUpperCase() || "FREE"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {profile?.plan === "free" && "Monetização padrão"}
                    {profile?.plan === "pro" && "R$ 29,90/mês • +10% de bônus"}
                    {profile?.plan === "premium" && "R$ 49,90/mês • +25% de bônus"}
                  </p>
                  {profile?.plan_expires_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Renova em: {new Date(profile.plan_expires_at).toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </div>
                <Trophy className="w-8 h-8 text-accent" />
              </div>
            </div>

            {/* Plan Actions */}
            <div className="space-y-3">
              {profile?.plan === "free" && (
                <>
                  <Button 
                    className="w-full bg-gradient-to-r from-yellow-500 to-amber-600 hover:opacity-90"
                    onClick={async () => {
                      try {
                        const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
                          body: { plan: 'pro' }
                        });
                        if (error) throw error;
                        if (data?.url) window.open(data.url, '_blank');
                      } catch (error: any) {
                        toast({
                          title: "Erro",
                          description: error.message,
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    Assinar Pro - R$ 29,90/mês
                  </Button>
                  <Button 
                    className="w-full bg-gradient-to-r from-red-500 to-rose-600 hover:opacity-90"
                    onClick={async () => {
                      try {
                        const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
                          body: { plan: 'premium' }
                        });
                        if (error) throw error;
                        if (data?.url) window.open(data.url, '_blank');
                      } catch (error: any) {
                        toast({
                          title: "Erro",
                          description: error.message,
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    Assinar Premium - R$ 49,90/mês
                  </Button>
                </>
              )}

              {profile?.plan === "pro" && (
                <>
                  <Button 
                    className="w-full bg-gradient-to-r from-red-500 to-rose-600 hover:opacity-90"
                    onClick={async () => {
                      try {
                        setSubmitting(true);
                        const { data, error } = await supabase.functions.invoke('manage-subscription', {
                          body: { action: 'upgrade', newPlan: 'premium' }
                        });
                        if (error) throw error;
                        toast({
                          title: "Sucesso!",
                          description: data.message || "Plano atualizado!",
                        });
                        await fetchData();
                      } catch (error: any) {
                        toast({
                          title: "Erro",
                          description: error.message,
                          variant: "destructive",
                        });
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    disabled={submitting}
                  >
                    Fazer Upgrade para Premium
                  </Button>
                  <div className="grid grid-cols-2 gap-3">
                    <Button 
                      variant="outline"
                      onClick={async () => {
                        try {
                          const { data, error } = await supabase.functions.invoke('customer-portal');
                          if (error) throw error;
                          if (data?.url) window.open(data.url, '_blank');
                        } catch (error: any) {
                          toast({
                            title: "Erro",
                            description: error.message,
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      Gerenciar Pagamento
                    </Button>
                    <Button 
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={async () => {
                        if (!confirm("Tem certeza que deseja cancelar? Você perderá acesso ao plano Pro ao final do período.")) return;
                        try {
                          setSubmitting(true);
                          const { data, error } = await supabase.functions.invoke('manage-subscription', {
                            body: { action: 'cancel' }
                          });
                          if (error) throw error;
                          toast({
                            title: "Assinatura Cancelada",
                            description: data.message,
                          });
                          await fetchData();
                        } catch (error: any) {
                          toast({
                            title: "Erro",
                            description: error.message,
                            variant: "destructive",
                          });
                        } finally {
                          setSubmitting(false);
                        }
                      }}
                      disabled={submitting}
                    >
                      Cancelar Plano
                    </Button>
                  </div>
                </>
              )}

              {profile?.plan === "premium" && (
                <>
                  <Button 
                    variant="outline"
                    className="w-full"
                    onClick={async () => {
                      if (!confirm("Deseja fazer downgrade para o plano Pro? O ajuste será feito na próxima cobrança.")) return;
                      try {
                        setSubmitting(true);
                        const { data, error } = await supabase.functions.invoke('manage-subscription', {
                          body: { action: 'downgrade', newPlan: 'pro' }
                        });
                        if (error) throw error;
                        toast({
                          title: "Sucesso!",
                          description: data.message || "Plano alterado!",
                        });
                        await fetchData();
                      } catch (error: any) {
                        toast({
                          title: "Erro",
                          description: error.message,
                          variant: "destructive",
                        });
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    disabled={submitting}
                  >
                    Fazer Downgrade para Pro
                  </Button>
                  <div className="grid grid-cols-2 gap-3">
                    <Button 
                      variant="outline"
                      onClick={async () => {
                        try {
                          const { data, error } = await supabase.functions.invoke('customer-portal');
                          if (error) throw error;
                          if (data?.url) window.open(data.url, '_blank');
                        } catch (error: any) {
                          toast({
                            title: "Erro",
                            description: error.message,
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      Gerenciar Pagamento
                    </Button>
                    <Button 
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={async () => {
                        if (!confirm("Tem certeza que deseja cancelar? Você perderá acesso ao plano Premium ao final do período.")) return;
                        try {
                          setSubmitting(true);
                          const { data, error } = await supabase.functions.invoke('manage-subscription', {
                            body: { action: 'cancel' }
                          });
                          if (error) throw error;
                          toast({
                            title: "Assinatura Cancelada",
                            description: data.message,
                          });
                          await fetchData();
                        } catch (error: any) {
                          toast({
                            title: "Erro",
                            description: error.message,
                            variant: "destructive",
                          });
                        } finally {
                          setSubmitting(false);
                        }
                      }}
                      disabled={submitting}
                    >
                      Cancelar Plano
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Creator Section */}
          {role !== 'creator' && role !== 'admin' && (
            <Card className="p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
                    <Sparkles className="w-6 h-6 text-cinematic-accent" />
                    Torne-se Creator
                  </h2>
                  <p className="text-muted-foreground mb-4">
                    Publique seus conteúdos, ganhe seguidores e monetize seu conhecimento na Classfy
                  </p>
                  
                  {userProfile?.creator_status === 'pending' && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 mb-4">
                      <Clock className="w-5 h-5 text-yellow-500" />
                      <span className="text-sm font-medium text-yellow-500">
                        Aguardando análise do admin...
                      </span>
                    </div>
                  )}

                  {userProfile?.creator_status === 'rejected' && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
                      <XCircle className="w-5 h-5 text-red-500" />
                      <span className="text-sm font-medium text-red-500">
                        Sua solicitação não foi aprovada
                      </span>
                    </div>
                  )}
                </div>
                
                {userProfile?.creator_status !== 'pending' && userProfile?.creator_status !== 'approved' && (
                  <Button
                    onClick={() => setCreatorModalOpen(true)}
                    className="bg-cinematic-accent hover:bg-cinematic-accent/90 text-white"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Solicitar Acesso
                  </Button>
                )}
              </div>
            </Card>
          )}

          {/* User Badges and Level */}
          {user && <UserBadges userId={user.id} />}

          {(role === 'creator' || role === 'admin') && (
            <Card className="p-8 border-green-500/20 bg-green-500/5">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-6 h-6 text-green-500 mt-0.5" />
                <div>
                  <h3 className="text-xl font-bold mb-1">
                    Você é um Creator!
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    Acesse o Studio Classfy no menu lateral para gerenciar seus conteúdos
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => navigate("/studio")}
                    className="border-green-500/20 hover:bg-green-500/10"
                  >
                    Ir para o Studio
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
      
      <BecomeCreatorModal open={creatorModalOpen} onOpenChange={setCreatorModalOpen} />
    </div>
  );
}
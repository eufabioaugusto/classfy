import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Wallet, TrendingUp, DollarSign, Trophy, Sparkles, CheckCircle, Clock, XCircle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BecomeCreatorModal } from "@/components/BecomeCreatorModal";

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

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    } else if (user) {
      fetchData();
    }
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    try {
      const [walletRes, profileRes] = await Promise.all([
        supabase.from("wallets").select("*").eq("user_id", user?.id).single(),
        supabase.from("profiles").select("*").eq("id", user?.id).single(),
      ]);

      if (walletRes.error) throw walletRes.error;
      if (profileRes.error) throw profileRes.error;

      setWallet(walletRes.data);
      setProfile(profileRes.data);
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
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 rounded-full bg-accent flex items-center justify-center text-4xl font-bold text-accent-foreground">
              {profile?.display_name?.[0]?.toUpperCase()}
            </div>
            <div className="space-y-2">
              <h1 className="text-4xl font-bold">{profile?.display_name}</h1>
              <div className="flex gap-2">
                <Badge variant="secondary" className="uppercase">
                  {profile?.plan || "free"}
                </Badge>
              </div>
            </div>
          </div>

          {/* Wallet Stats */}
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

          {/* Withdraw Form */}
          <Card className="p-8">
            <h2 className="text-2xl font-bold mb-6">Solicitar Saque</h2>
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
          </Card>

          {/* Plan Info */}
          <Card className="p-8">
            <h2 className="text-2xl font-bold mb-6">Seu Plano</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-lg">
                    Plano {profile?.plan?.toUpperCase() || "FREE"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {profile?.plan === "free" && "Monetização padrão"}
                    {profile?.plan === "pro" && "+10% de bônus em todas ações"}
                    {profile?.plan === "premium" && "+25% de bônus em todas ações"}
                  </p>
                </div>
                <Trophy className="w-8 h-8 text-accent" />
              </div>
              
              <Button variant="outline" className="w-full" onClick={() => {
                toast({
                  title: "Em breve",
                  description: "A funcionalidade de upgrade estará disponível em breve!",
                });
              }}>
                Fazer Upgrade
              </Button>
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
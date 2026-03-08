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
  Trophy, 
  Sparkles, 
  CheckCircle, 
  Clock, 
  XCircle, 
  History,
  User,
  Video,
  CreditCard,
  Settings as SettingsIcon,
  Loader2,
  Check,
  X,
  Crown
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
import { BecomeCreatorModal } from "@/components/BecomeCreatorModal";
import { EditableAvatar } from "@/components/EditableAvatar";
import { useProfileComplete } from "@/hooks/useProfileComplete";
import { CoverUpload } from "@/components/CoverUpload";
import { AdminLayout } from "@/components/AdminLayout";
import { Separator } from "@/components/ui/separator";
import { MessagePrivacySettings } from "@/components/settings/MessagePrivacySettings";
import { useCreatorMilestones } from "@/hooks/useCreatorMilestones";
import { CreatorAchievementBadge } from "@/components/CreatorAchievementBadge";

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
  const [isEditingChannel, setIsEditingChannel] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [savingChannel, setSavingChannel] = useState(false);
  
  // Editable profile fields
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

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
          .from("platform_settings")
          .select("*")
          .eq("key", "minimum_withdrawal_amount")
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

      if (configRes.data?.value) {
        const configValue = configRes.data.value as { amount?: number };
        if (configValue.amount) {
          setMinWithdrawalAmount(configValue.amount);
        }
      }

      if (withdrawalsRes.data) {
        setWithdrawHistory(withdrawalsRes.data);
      }

      if (profileRes.data?.creator_channel_name) {
        setChannelName(profileRes.data.creator_channel_name);
      }
      // Initialize editable profile fields
      if (profileRes.data) {
        setEditDisplayName(profileRes.data.display_name || "");
        setEditBio(profileRes.data.bio || "");
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

  const handleSaveProfile = async () => {
    if (!editDisplayName.trim()) {
      toast({ title: "Nome obrigatório", description: "Digite seu nome de exibição.", variant: "destructive" });
      return;
    }
    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: editDisplayName.trim(), bio: editBio.trim() || null })
        .eq("id", user?.id);
      if (error) throw error;
      setProfile({ ...profile, display_name: editDisplayName.trim(), bio: editBio.trim() || null });
      setIsEditingProfile(false);
      toast({ title: "Perfil atualizado!" });
      await refreshProfile();
    } catch (error: any) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveChannelName = async () => {
    if (!channelName.trim()) {
      toast({
        title: "Nome obrigatório",
        description: "Digite um nome para o seu canal.",
        variant: "destructive",
      });
      return;
    }

    const validFormat = /^[a-z0-9_-]+$/;
    if (!validFormat.test(channelName)) {
      toast({
        title: "Formato inválido",
        description: "Use apenas letras minúsculas, números, traços (-) e underscores (_).",
        variant: "destructive",
      });
      return;
    }

    if (channelName.length < 3) {
      toast({
        title: "Nome muito curto",
        description: "O nome do canal deve ter no mínimo 3 caracteres.",
        variant: "destructive",
      });
      return;
    }

    setSavingChannel(true);

    try {
      const { data: existingChannel } = await supabase
        .from("profiles")
        .select("id")
        .eq("creator_channel_name", channelName)
        .neq("id", user?.id)
        .maybeSingle();

      if (existingChannel) {
        toast({
          title: "Nome indisponível",
          description: "Este nome de canal já está em uso. Escolha outro.",
          variant: "destructive",
        });
        setSavingChannel(false);
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update({ creator_channel_name: channelName })
        .eq("id", user?.id);

      if (error) throw error;

      setProfile({ ...profile, creator_channel_name: channelName });
      setIsEditingChannel(false);
      
      toast({
        title: "Sucesso!",
        description: "Nome do canal atualizado.",
      });

      await refreshProfile();
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível atualizar o nome do canal.",
        variant: "destructive",
      });
    } finally {
      setSavingChannel(false);
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
      fetchData();
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
      <AdminLayout title="Configurações">
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  const isCreator = profile?.creator_status === "approved";

  return (
    <AdminLayout title="Configurações">
      <div className="container mx-auto p-6 max-w-7xl space-y-6">
        {/* Page Header */}
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
          <p className="text-muted-foreground">
            Gerencie suas preferências, perfil e informações da conta
          </p>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid bg-muted/50 p-1">
            <TabsTrigger value="profile" className="gap-2">
              <User className="w-4 h-4" />
              <span className="hidden sm:inline">Perfil</span>
            </TabsTrigger>
            {isCreator && (
              <TabsTrigger value="channel" className="gap-2">
                <Video className="w-4 h-4" />
                <span className="hidden sm:inline">Canal</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="wallet" className="gap-2">
              <Wallet className="w-4 h-4" />
              <span className="hidden sm:inline">Carteira</span>
            </TabsTrigger>
            <TabsTrigger value="plan" className="gap-2">
              <Trophy className="w-4 h-4" />
              <span className="hidden sm:inline">Plano</span>
            </TabsTrigger>
            <TabsTrigger value="account" className="gap-2">
              <SettingsIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Conta</span>
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Informações do Perfil</CardTitle>
                <CardDescription>
                  Gerencie como você aparece na plataforma
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col sm:flex-row items-start gap-6">
                  <div className="flex flex-col items-center gap-4">
                    <EditableAvatar 
                      userId={user?.id || ""} 
                      avatarUrl={profile?.avatar_url}
                      displayName={profile?.display_name || ""}
                      size="xl"
                      editable={true}
                    />
                    <div className="text-center">
                      <p className="font-semibold text-lg">{profile?.display_name}</p>
                      <Badge variant="secondary" className="mt-1 uppercase text-xs">
                        {profile?.plan || "free"}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex-1 space-y-4 w-full">
                    <div className="space-y-2">
                      <Label>Conquistas & Badges</Label>
                      <AchievementsSection userId={user?.id} />
                    </div>

                    <Separator />

                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="email">Email</Label>
                        <Input 
                          id="email" 
                          type="email" 
                          value={user?.email || ""} 
                          disabled 
                          className="bg-muted"
                        />
                        <p className="text-xs text-muted-foreground">
                          Email não pode ser alterado
                        </p>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="displayName">Nome de Exibição</Label>
                        <Input 
                          id="displayName" 
                          value={profile?.display_name || ""} 
                          disabled 
                          className="bg-muted"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Channel Tab (Creator Only) */}
          {isCreator && (
            <TabsContent value="channel" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Configurações do Canal</CardTitle>
                  <CardDescription>
                    Personalize seu canal de creator
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Channel Name */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="channelName">Nome do Canal</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
                            @
                          </span>
                          <Input
                            id="channelName"
                            value={channelName}
                            onChange={(e) => {
                              const newName = e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '');
                              setChannelName(newName);
                            }}
                            placeholder="nomedocanal"
                            className="font-mono pl-8"
                            disabled={!isEditingChannel || savingChannel}
                            maxLength={30}
                          />
                        </div>
                        {!isEditingChannel ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsEditingChannel(true)}
                            disabled={savingChannel}
                          >
                            Editar
                          </Button>
                        ) : (
                          <>
                            <Button
                              type="button"
                              onClick={handleSaveChannelName}
                              disabled={savingChannel || !channelName.trim()}
                            >
                              {savingChannel ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Salvando...
                                </>
                              ) : (
                                "Salvar"
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => {
                                setChannelName(profile?.creator_channel_name || "");
                                setIsEditingChannel(false);
                              }}
                              disabled={savingChannel}
                            >
                              Cancelar
                            </Button>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Use apenas letras minúsculas, números, traços (-) e underscores (_). Mínimo 3 caracteres.
                      </p>
                    </div>

                    {profile?.creator_channel_name && !isEditingChannel && (
                      <div className="flex items-center gap-2 p-4 rounded-lg bg-primary/5 border border-primary/20">
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground mb-1">
                            Seu perfil público está disponível em:
                          </p>
                          <Button
                            variant="link"
                            className="h-auto p-0 text-sm font-mono text-primary hover:text-primary/80"
                            onClick={() => navigate(`/@${profile.creator_channel_name}`)}
                          >
                            /@{profile.creator_channel_name}
                          </Button>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/@${profile.creator_channel_name}`)}
                        >
                          Ver Perfil
                        </Button>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Cover Image */}
                  <div className="space-y-2">
                    <Label>Capa do Canal</Label>
                    <CoverUpload 
                      userId={user?.id || ""} 
                      currentCoverUrl={profile?.cover_image_url}
                      onUploadComplete={(url) => {
                        setProfile({ ...profile, cover_image_url: url });
                        refreshProfile();
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Wallet Tab */}
          <TabsContent value="wallet" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="w-5 h-5" />
                  Carteira
                </CardTitle>
                <CardDescription>
                  Gerencie seus ganhos e solicitações de saque
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="overview" className="space-y-6">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="overview">Visão Geral</TabsTrigger>
                    <TabsTrigger value="withdraw">Sacar</TabsTrigger>
                    <TabsTrigger value="history">Histórico</TabsTrigger>
                  </TabsList>

                  {/* Overview Tab */}
                  <TabsContent value="overview" className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
                        <CardContent className="p-6 space-y-2">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Wallet className="w-4 h-4" />
                            <span className="text-xs font-medium uppercase tracking-wider">Saldo Disponível</span>
                          </div>
                          <p className="text-3xl font-bold text-primary">
                            R$ {wallet?.balance?.toFixed(2) || "0.00"}
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
                        <CardContent className="p-6 space-y-2">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <TrendingUp className="w-4 h-4" />
                            <span className="text-xs font-medium uppercase tracking-wider">Total Ganho</span>
                          </div>
                          <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                            R$ {wallet?.total_earned?.toFixed(2) || "0.00"}
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border-orange-500/20">
                        <CardContent className="p-6 space-y-2">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <DollarSign className="w-4 h-4" />
                            <span className="text-xs font-medium uppercase tracking-wider">Total Sacado</span>
                          </div>
                          <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                            R$ {wallet?.total_withdrawn?.toFixed(2) || "0.00"}
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Recent Withdrawals */}
                    {withdrawHistory.length > 0 && (
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Últimas Solicitações</h3>
                        <div className="space-y-2">
                          {withdrawHistory.slice(0, 3).map((withdrawal) => (
                            <div
                              key={withdrawal.id}
                              className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                {withdrawal.status === "pending" && <Clock className="w-5 h-5 text-yellow-500" />}
                                {withdrawal.status === "approved" && <CheckCircle className="w-5 h-5 text-green-500" />}
                                {withdrawal.status === "rejected" && <XCircle className="w-5 h-5 text-red-500" />}
                                <div>
                                  <p className="font-semibold">R$ {withdrawal.amount.toFixed(2)}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {new Date(withdrawal.created_at).toLocaleDateString("pt-BR", {
                                      day: "2-digit",
                                      month: "short",
                                      year: "numeric"
                                    })}
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
                      <div className="p-4 rounded-lg bg-muted/50 border">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-muted-foreground">Saldo disponível</span>
                          <span className="text-lg font-bold text-primary">
                            R$ {wallet?.balance?.toFixed(2) || "0.00"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Valor mínimo para saque: R$ {minWithdrawalAmount.toFixed(2)}
                        </p>
                      </div>

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
                          className="text-lg"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="pix">Chave PIX</Label>
                        <Input
                          id="pix"
                          type="text"
                          placeholder="CPF, email, telefone ou chave aleatória"
                          value={pixKey}
                          onChange={(e) => setPixKey(e.target.value)}
                          required
                          disabled={submitting}
                        />
                        <p className="text-xs text-muted-foreground">
                          Insira a chave PIX onde deseja receber o pagamento
                        </p>
                      </div>

                      <Button
                        type="submit"
                        className="w-full"
                        size="lg"
                        disabled={submitting || !wallet?.balance || wallet.balance <= 0}
                      >
                        {submitting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Processando...
                          </>
                        ) : (
                          "Solicitar Saque"
                        )}
                      </Button>
                    </form>
                  </TabsContent>

                  {/* History Tab */}
                  <TabsContent value="history">
                    {withdrawHistory.length === 0 ? (
                      <div className="text-center py-16">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                          <History className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">Nenhum histórico ainda</h3>
                        <p className="text-sm text-muted-foreground">
                          Suas solicitações de saque aparecerão aqui
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg border">
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
                              <TableRow key={withdrawal.id} className="hover:bg-muted/50">
                                <TableCell className="font-medium">
                                  {new Date(withdrawal.created_at).toLocaleDateString("pt-BR", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </TableCell>
                                <TableCell className="font-semibold">
                                  R$ {withdrawal.amount.toFixed(2)}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
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
                                <TableCell className="max-w-xs">
                                  {withdrawal.admin_notes ? (
                                    <span className="text-sm text-muted-foreground truncate block">
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
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Plan Tab */}
          <TabsContent value="plan" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="w-5 h-5 text-primary" />
                  Plano de Assinatura
                </CardTitle>
                <CardDescription>
                  Gerencie sua assinatura e benefícios
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Current Plan Badge */}
                <div className="p-4 rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold">
                          Plano {profile?.plan?.toUpperCase() || "FREE"}
                        </h3>
                        <Badge className="bg-primary text-primary-foreground text-xs">
                          Atual
                        </Badge>
                      </div>
                      {profile?.plan_expires_at && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Renova em: {new Date(profile.plan_expires_at).toLocaleDateString("pt-BR")}
                        </p>
                      )}
                    </div>
                    {(profile?.plan === "pro" || profile?.plan === "premium") && (
                      <div className="flex gap-2">
                        <Button 
                          variant="outline"
                          size="sm"
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
                          <CreditCard className="w-4 h-4 mr-1" />
                          Gerenciar
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Plan Cards Comparison */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Free Plan */}
                  <div className={`p-4 rounded-lg border-2 transition-all ${
                    profile?.plan === "free" 
                      ? "border-primary bg-primary/5" 
                      : "border-border hover:border-muted-foreground/30"
                  }`}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-semibold">Gratuito</h4>
                        <p className="text-2xl font-bold">R$ 0</p>
                      </div>
                      {profile?.plan === "free" && (
                        <Badge variant="outline" className="border-primary text-primary">Seu Plano</Badge>
                      )}
                    </div>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        Acesso ao Classy Chat
                      </li>
                      <li className="flex items-center gap-2 text-muted-foreground">
                        <X className="w-4 h-4" />
                        Vídeos sem anúncios
                      </li>
                      <li className="flex items-center gap-2 text-muted-foreground">
                        <X className="w-4 h-4" />
                        Downloads
                      </li>
                    </ul>
                  </div>

                  {/* Pro Plan */}
                  <div className={`p-4 rounded-lg border-2 transition-all ${
                    profile?.plan === "pro" 
                      ? "border-primary bg-primary/5" 
                      : "border-border hover:border-yellow-500/50"
                  }`}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-semibold flex items-center gap-1">
                          <User className="w-4 h-4" />
                          Pro
                        </h4>
                        <p className="text-2xl font-bold">R$ 29,90<span className="text-sm font-normal text-muted-foreground">/mês</span></p>
                      </div>
                      {profile?.plan === "pro" && (
                        <Badge variant="outline" className="border-primary text-primary">Seu Plano</Badge>
                      )}
                    </div>
                    <ul className="space-y-2 text-sm mb-4">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        Sem anúncios
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        Classy Chat (IA)
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        Downloads ilimitados
                      </li>
                      <li className="flex items-center gap-2 text-muted-foreground">
                        <X className="w-4 h-4" />
                        Cursos completos
                      </li>
                    </ul>
                    {profile?.plan === "free" && (
                      <Button 
                        size="sm"
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
                        <Sparkles className="w-4 h-4 mr-1" />
                        Assinar Pro
                      </Button>
                    )}
                    {profile?.plan === "premium" && (
                      <Button 
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={submitting}
                        onClick={async () => {
                          if (!confirm("Deseja fazer downgrade para o plano Pro?")) return;
                          try {
                            setSubmitting(true);
                            const { data, error } = await supabase.functions.invoke('manage-subscription', {
                              body: { action: 'downgrade', newPlan: 'pro' }
                            });
                            if (error) throw error;
                            toast({ title: "Sucesso!", description: data.message });
                            await fetchData();
                          } catch (error: any) {
                            toast({ title: "Erro", description: error.message, variant: "destructive" });
                          } finally {
                            setSubmitting(false);
                          }
                        }}
                      >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Downgrade"}
                      </Button>
                    )}
                  </div>

                  {/* Premium Plan */}
                  <div className={`p-4 rounded-lg border-2 transition-all relative ${
                    profile?.plan === "premium" 
                      ? "border-primary bg-primary/5" 
                      : "border-red-500/50 hover:border-red-500"
                  }`}>
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-red-500">
                      Recomendado
                    </Badge>
                    <div className="flex items-center justify-between mb-3 pt-1">
                      <div>
                        <h4 className="font-semibold flex items-center gap-1">
                          <Sparkles className="w-4 h-4" />
                          Premium
                        </h4>
                        <p className="text-2xl font-bold">R$ 49,90<span className="text-sm font-normal text-muted-foreground">/mês</span></p>
                      </div>
                      {profile?.plan === "premium" && (
                        <Badge variant="outline" className="border-primary text-primary">Seu Plano</Badge>
                      )}
                    </div>
                    <ul className="space-y-2 text-sm mb-4">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        Tudo do Pro
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        Cursos completos
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        Reprodução offline
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        Segundo plano
                      </li>
                    </ul>
                    {(profile?.plan === "free" || profile?.plan === "pro") && (
                      <Button 
                        size="sm"
                        className="w-full bg-gradient-to-r from-red-500 to-rose-600 hover:opacity-90"
                        disabled={submitting}
                        onClick={async () => {
                          try {
                            if (profile?.plan === "pro") {
                              setSubmitting(true);
                              const { data, error } = await supabase.functions.invoke('manage-subscription', {
                                body: { action: 'upgrade', newPlan: 'premium' }
                              });
                              if (error) throw error;
                              toast({ title: "Sucesso!", description: data.message });
                              await fetchData();
                            } else {
                              const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
                                body: { plan: 'premium' }
                              });
                              if (error) throw error;
                              if (data?.url) window.open(data.url, '_blank');
                            }
                          } catch (error: any) {
                            toast({ title: "Erro", description: error.message, variant: "destructive" });
                          } finally {
                            setSubmitting(false);
                          }
                        }}
                      >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                          <>
                            <Trophy className="w-4 h-4 mr-1" />
                            {profile?.plan === "pro" ? "Upgrade" : "Assinar Premium"}
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Comparison Table */}
                <div className="mt-6">
                  <h4 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">
                    Comparar recursos
                  </h4>
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="font-semibold">Recurso</TableHead>
                          <TableHead className="text-center font-semibold">Free</TableHead>
                          <TableHead className="text-center font-semibold">Pro</TableHead>
                          <TableHead className="text-center font-semibold">Premium</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell>Acesso ao Classy Chat</TableCell>
                          <TableCell className="text-center"><Check className="w-4 h-4 text-primary mx-auto" /></TableCell>
                          <TableCell className="text-center"><Check className="w-4 h-4 text-primary mx-auto" /></TableCell>
                          <TableCell className="text-center"><Check className="w-4 h-4 text-primary mx-auto" /></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Vídeos sem anúncios</TableCell>
                          <TableCell className="text-center"><X className="w-4 h-4 text-muted-foreground mx-auto" /></TableCell>
                          <TableCell className="text-center"><Check className="w-4 h-4 text-primary mx-auto" /></TableCell>
                          <TableCell className="text-center"><Check className="w-4 h-4 text-primary mx-auto" /></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Downloads ilimitados</TableCell>
                          <TableCell className="text-center"><X className="w-4 h-4 text-muted-foreground mx-auto" /></TableCell>
                          <TableCell className="text-center"><Check className="w-4 h-4 text-primary mx-auto" /></TableCell>
                          <TableCell className="text-center"><Check className="w-4 h-4 text-primary mx-auto" /></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Cursos completos</TableCell>
                          <TableCell className="text-center"><X className="w-4 h-4 text-muted-foreground mx-auto" /></TableCell>
                          <TableCell className="text-center"><X className="w-4 h-4 text-muted-foreground mx-auto" /></TableCell>
                          <TableCell className="text-center"><Check className="w-4 h-4 text-primary mx-auto" /></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Reprodução offline</TableCell>
                          <TableCell className="text-center"><X className="w-4 h-4 text-muted-foreground mx-auto" /></TableCell>
                          <TableCell className="text-center"><X className="w-4 h-4 text-muted-foreground mx-auto" /></TableCell>
                          <TableCell className="text-center"><Check className="w-4 h-4 text-primary mx-auto" /></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Segundo plano</TableCell>
                          <TableCell className="text-center"><X className="w-4 h-4 text-muted-foreground mx-auto" /></TableCell>
                          <TableCell className="text-center"><X className="w-4 h-4 text-muted-foreground mx-auto" /></TableCell>
                          <TableCell className="text-center"><Check className="w-4 h-4 text-primary mx-auto" /></TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Cancel subscription for paid users */}
                {(profile?.plan === "pro" || profile?.plan === "premium") && (
                  <div className="pt-4 border-t">
                    <Button 
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={submitting}
                      onClick={async () => {
                        if (!confirm(`Tem certeza que deseja cancelar? Você perderá acesso ao plano ${profile?.plan?.toUpperCase()} ao final do período.`)) return;
                        try {
                          setSubmitting(true);
                          const { data, error } = await supabase.functions.invoke('manage-subscription', {
                            body: { action: 'cancel' }
                          });
                          if (error) throw error;
                          toast({ title: "Assinatura Cancelada", description: data.message });
                          await fetchData();
                        } catch (error: any) {
                          toast({ title: "Erro", description: error.message, variant: "destructive" });
                        } finally {
                          setSubmitting(false);
                        }
                      }}
                    >
                      {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Cancelar assinatura
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Account Tab */}
          <TabsContent value="account" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Configurações da Conta</CardTitle>
                <CardDescription>
                  Gerencie suas preferências e opções de conta
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                    <div className="space-y-1">
                      <p className="font-medium">Email da Conta</p>
                      <p className="text-sm text-muted-foreground">{user?.email}</p>
                    </div>
                    <Badge variant="secondary">Verificado</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Message Privacy Settings */}
            <MessagePrivacySettings />

            {role !== 'creator' && role !== 'admin' && (
              <Card>
                <CardContent className="space-y-4 pt-6">
                  <Separator />
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Tornar-se Creator</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Crie e monetize conteúdo na plataforma. Compartilhe seu conhecimento e ganhe dinheiro!
                      </p>
                      <Button 
                        onClick={() => setCreatorModalOpen(true)}
                        className="w-full sm:w-auto"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Solicitar Acesso de Creator
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <BecomeCreatorModal 
        open={creatorModalOpen} 
        onOpenChange={setCreatorModalOpen} 
      />
    </AdminLayout>
  );
}

// Achievements Section Component
function AchievementsSection({ userId }: { userId?: string }) {
  const { milestones, loading } = useCreatorMilestones(userId);
  
  const unlockedMilestones = milestones.filter(m => m.isClaimed);
  const lockedMilestones = milestones.filter(m => !m.isClaimed);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card className="p-4">
      <Tabs defaultValue="unlocked">
        <TabsList className="w-full grid grid-cols-2 mb-4">
          <TabsTrigger value="unlocked" className="gap-1.5">
            Desbloqueadas
            <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded-full text-xs">
              {unlockedMilestones.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="locked" className="gap-1.5">
            Bloqueadas
            <span className="bg-muted px-1.5 py-0.5 rounded-full text-xs">
              {lockedMilestones.length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="unlocked" className="mt-0">
          {unlockedMilestones.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
              {unlockedMilestones.map((milestone) => (
                <CreatorAchievementBadge
                  key={milestone.id}
                  milestone={milestone}
                  size="sm"
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Nenhuma conquista desbloqueada ainda</p>
              <p className="text-xs mt-1">Complete metas para ganhar selos!</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="locked" className="mt-0">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
            {lockedMilestones.slice(0, 8).map((milestone) => (
              <CreatorAchievementBadge
                key={milestone.id}
                milestone={milestone}
                size="sm"
              />
            ))}
          </div>
          {lockedMilestones.length > 8 && (
            <p className="text-center text-xs text-muted-foreground mt-4">
              +{lockedMilestones.length - 8} conquistas restantes
            </p>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}

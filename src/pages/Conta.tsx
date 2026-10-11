import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Play,
  Award,
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
  ArrowUpRight,
  ChevronRight,
  ReceiptText,
  ShieldCheck
} from "lucide-react";
import { PlanCrown } from "@/components/plans/PlanCrown";
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
import { AppShell } from "@/components/layout";
import { V2Badge, V2Card, V2CardContent, V2CardHeader } from "@/components/v2";
import { PlanOfferCard } from "@/components/plans/PlanOfferCard";
import type { PaidPlan } from "@/config/planOffers";
import { useSubscriptionCheckout } from "@/components/billing/SubscriptionCheckoutProvider";
import { hasCurrentPaidPlan } from "@/lib/billing/subscriptionCheckout";
import { SubscriptionBillingPanel } from "@/components/billing/SubscriptionBillingPanel";
import type { Tables } from "@/integrations/supabase/types";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { MessagePrivacySettings } from "@/components/settings/MessagePrivacySettings";
import { useCreatorMilestones } from "@/hooks/useCreatorMilestones";
import { CreatorAchievementBadge } from "@/components/CreatorAchievementBadge";
import { UserAchievementsCard } from "@/components/rewards/UserAchievementsCard";
import "@/styles/economy-v2.css";
import "@/styles/account-v2.css";

type AccountSection = "profile" | "channel" | "plan" | "billing" | "wallet" | "account";
const ACCOUNT_SECTIONS = [
  { id: "profile", label: "Perfil", copy: "Sua identidade", icon: User },
  { id: "channel", label: "Canal", copy: "Presença como creator", icon: Video },
  { id: "plan", label: "Plano", copy: "Acesso e benefícios", icon: Sparkles },
  { id: "billing", label: "Cobranças", copy: "Pagamentos da assinatura", icon: ReceiptText },
  { id: "wallet", label: "Carteira", copy: "Ganhos e saques", icon: Wallet },
  { id: "account", label: "Preferências", copy: "Privacidade e conta", icon: SettingsIcon },
] as const;
const SECTION_ALIASES: Record<string, AccountSection> = { plano: "plan", perfil: "profile", canal: "channel", cobrancas: "billing", carteira: "wallet", preferences: "account" };
function accountError(error: unknown, fallback: string) {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : fallback;
}

export default function Conta() {
  const { user, loading: authLoading, role, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { startSubscription } = useSubscriptionCheckout();
  const [downgradeOpen, setDowngradeOpen] = useState(false);
  const [cancelSubscriptionOpen, setCancelSubscriptionOpen] = useState(false);
  const [billingActionOwner, setBillingActionOwner] = useState<string | null>(null);
  useEffect(() => { setDowngradeOpen(false); setCancelSubscriptionOpen(false); setBillingActionOwner(null); }, [user?.id]);
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<Tables<"wallets"> | null>(null);
  const [profile, setProfile] = useState<Tables<"profiles"> | null>(null);
  const [dataOwner, setDataOwner] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [creatorModalOpen, setCreatorModalOpen] = useState(false);
  const [minWithdrawalAmount, setMinWithdrawalAmount] = useState(10);
  const [withdrawHistory, setWithdrawHistory] = useState<Tables<"withdraw_requests">[]>([]);
  const [isEditingChannel, setIsEditingChannel] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [savingChannel, setSavingChannel] = useState(false);
  
  // Editable profile fields
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const busy = submitting || savingProfile || savingChannel;

  const mounted = useRef(false);
  const ownerScope = useRef({ id: user?.id, epoch: 0 });
  const requestSequence = useRef(0);
  const actionBusy = useRef(false);
  if (ownerScope.current.id !== user?.id) {
    ownerScope.current = { id: user?.id, epoch: ownerScope.current.epoch + 1 };
    actionBusy.current = false;
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ownerScope.current.epoch++; };
  }, []);
  const isCurrent = useCallback((owner: string, epoch: number) => mounted.current && ownerScope.current.id === owner && ownerScope.current.epoch === epoch, []);
  useProfileComplete(user?.id, dataOwner === user?.id ? profile : null);

  const fetchData = useCallback(async (owner = ownerScope.current.id) => {
    if (!owner || !mounted.current || ownerScope.current.id !== owner) return;
    const epoch = ownerScope.current.epoch;
    const sequence = ++requestSequence.current;
    const current = () => isCurrent(owner, epoch) && requestSequence.current === sequence;
    try {
      const [walletRes, profileRes, configRes, withdrawalsRes] = await Promise.all([
        supabase.from("wallets").select("*").eq("user_id", owner).single(),
        supabase.from("profiles").select("*").eq("id", owner).single(),
        supabase.from("platform_settings").select("*").eq("key", "economic_v1").maybeSingle(),
        supabase.from("withdraw_requests").select("*").eq("user_id", owner).order("created_at", { ascending: false }),
      ]);
      if (!current()) return;
      if (profileRes.error) throw profileRes.error;
      setWalletError(walletRes.error || withdrawalsRes.error ? "Não foi possível carregar sua carteira. Tente novamente para consultar o saldo e os saques." : null);
      setWallet(walletRes.data);
      setProfile(profileRes.data);
      setDataOwner(owner);
      setLoadError(null);
      const config = configRes.data?.value as { minimum_withdrawal_amount?: number } | undefined;
      if (typeof config?.minimum_withdrawal_amount === "number") setMinWithdrawalAmount(config.minimum_withdrawal_amount);
      setWithdrawHistory(withdrawalsRes.data ?? []);
      setChannelName(profileRes.data?.creator_channel_name ?? "");
      setEditDisplayName(profileRes.data?.display_name ?? "");
      setEditBio(profileRes.data?.bio ?? "");
    } catch (error) {
      if (current()) { setDataOwner(owner); setLoadError(accountError(error, "Não foi possível carregar sua conta.")); }
    } finally {
      if (current()) setLoading(false);
    }
  }, [isCurrent]);

  useEffect(() => {
    setProfile(null); setWallet(null); setDataOwner(null); setLoadError(null); setWalletError(null);
    setWithdrawHistory([]); setWithdrawAmount(""); setPixKey("");
    setIsEditingProfile(false); setIsEditingChannel(false);
    setSavingProfile(false); setSavingChannel(false); setSubmitting(false); setCreatorModalOpen(false);
    setMinWithdrawalAmount(10); setLoading(true);
    if (!authLoading && !user?.id) navigate("/auth", { replace: true });
    else if (user?.id && !authLoading) void fetchData(user.id);
  }, [user?.id, authLoading, navigate, fetchData]);

  const isCreator = dataOwner === user?.id && profile?.creator_status === "approved";
  const requestedSection = new URLSearchParams(location.search).get("tab") ?? "profile";
  const resolvedSection = SECTION_ALIASES[requestedSection] ?? requestedSection;
  const activeSection: AccountSection = ACCOUNT_SECTIONS.some(section => section.id === resolvedSection && (section.id !== "channel" || isCreator)) ? resolvedSection as AccountSection : "profile";
  const sections = ACCOUNT_SECTIONS.filter(section => section.id !== "channel" || isCreator);
  const changeSection = (section: string) => {
    if (!sections.some(item => item.id === section) || section === activeSection) return;
    const params = new URLSearchParams(location.search);
    params.set("tab", section);
    navigate({ pathname: location.pathname, search: `?${params.toString()}`, hash: location.hash }, { state: location.state });
  };
  const paidPlanActive = hasCurrentPaidPlan(profile);
  const storeProvider = paidPlanActive && (profile?.entitlement_source === 'apple' || profile?.entitlement_source === 'google') ? profile.entitlement_source : null;
  const storeLabel = storeProvider === 'apple' ? 'App Store' : 'Google Play';
  const showStoreManagement = () => toast({ title: `Assinatura pela ${storeLabel}`, description: `Abra as assinaturas da ${storeLabel} para alterar ou cancelar o plano. Seu acesso é compartilhado com a web.` });
  const effectivePlan = paidPlanActive && (profile?.plan === "premium" || profile?.plan === "pro") ? profile.plan : "free";
  const planLabel = effectivePlan === "premium" ? "Premium" : effectivePlan === "pro" ? "Pro" : "Free";

  const verifyOwner = async (owner: string, epoch: number) => {
    const session = await supabase.auth.getSession();
    if (!isCurrent(owner, epoch)) return false;
    if (session.data.session?.user.id !== owner) throw new Error("Sua sessão mudou. Entre novamente.");
    return true;
  };

  const handleSaveProfile = async () => {
    const owner = user?.id;
    const epoch = ownerScope.current.epoch;
    const displayName = editDisplayName.trim();
    const bio = editBio.trim() || null;
    if (!owner || !isCurrent(owner, epoch) || actionBusy.current) return;
    if (!displayName) { toast({ title: "Nome obrigatório", description: "Digite seu nome de exibição.", variant: "destructive" }); return; }
    actionBusy.current = true; setSavingProfile(true);
    try {
      if (!await verifyOwner(owner, epoch)) return;
      const { error } = await supabase.from("profiles").update({ display_name: displayName, bio }).eq("id", owner);
      if (!isCurrent(owner, epoch)) return;
      if (error) throw error;
      setProfile(current => current && ({ ...current, display_name: displayName, bio }));
      setIsEditingProfile(false);
      toast({ title: "Perfil atualizado!" });
      await refreshProfile();
    } catch (error) {
      if (isCurrent(owner, epoch)) toast({ title: "Erro ao salvar perfil", description: accountError(error, "Tente novamente."), variant: "destructive" });
    } finally {
      if (isCurrent(owner, epoch)) { actionBusy.current = false; setSavingProfile(false); }
    }
  };

  const handleSaveChannelName = async () => {
    const owner = user?.id;
    const epoch = ownerScope.current.epoch;
    const name = channelName.trim();
    if (!owner || !isCurrent(owner, epoch) || actionBusy.current) return;
    if (!name) { toast({ title: "Nome obrigatório", description: "Digite um nome para o seu canal.", variant: "destructive" }); return; }
    if (!/^[a-z0-9_-]+$/.test(name)) { toast({ title: "Formato inválido", description: "Use apenas letras minúsculas, números, traços (-) e underscores (_).", variant: "destructive" }); return; }
    if (name.length < 3) { toast({ title: "Nome muito curto", description: "O nome do canal deve ter no mínimo 3 caracteres.", variant: "destructive" }); return; }
    actionBusy.current = true; setSavingChannel(true);
    try {
      if (!await verifyOwner(owner, epoch)) return;
      const { data: existingChannel, error: availabilityError } = await supabase.from("profiles").select("id").eq("creator_channel_name", name).neq("id", owner).maybeSingle();
      if (!isCurrent(owner, epoch)) return;
      if (availabilityError) throw availabilityError;
      if (existingChannel) { toast({ title: "Nome indisponível", description: "Este nome de canal já está em uso. Escolha outro.", variant: "destructive" }); return; }
      if (!await verifyOwner(owner, epoch)) return;
      const { error } = await supabase.from("profiles").update({ creator_channel_name: name }).eq("id", owner);
      if (!isCurrent(owner, epoch)) return;
      if (error) throw error;
      setProfile(current => current && ({ ...current, creator_channel_name: name }));
      setIsEditingChannel(false);
      toast({ title: "Canal atualizado", description: "Seu endereço público está pronto." });
      await refreshProfile();
    } catch (error) {
      if (isCurrent(owner, epoch)) toast({ title: "Erro ao salvar canal", description: accountError(error, "Não foi possível atualizar o nome do canal."), variant: "destructive" });
    } finally {
      if (isCurrent(owner, epoch)) { actionBusy.current = false; setSavingChannel(false); }
    }
  };

  const handleWithdraw = async (event: React.FormEvent) => {
    event.preventDefault();
    const owner = user?.id;
    const epoch = ownerScope.current.epoch;
    if (!owner || !isCurrent(owner, epoch) || actionBusy.current) return;
    const amount = Number(withdrawAmount);
    const key = pixKey.trim();
    const available = Number(wallet?.balance || 0) - Number(wallet?.reserved_balance || 0);
    if (!Number.isFinite(amount) || amount <= 0) { toast({ title: "Valor inválido", description: "Insira um valor válido para saque.", variant: "destructive" }); return; }
    if (amount < minWithdrawalAmount) { toast({ title: "Valor abaixo do mínimo", description: `O valor mínimo para saque é R$ ${minWithdrawalAmount.toFixed(2)}.`, variant: "destructive" }); return; }
    if (amount > available) { toast({ title: "Saldo insuficiente", description: "Você não tem saldo suficiente para este saque.", variant: "destructive" }); return; }
    if (!key) { toast({ title: "Chave PIX obrigatória", description: "Insira sua chave PIX para receber o pagamento.", variant: "destructive" }); return; }
    actionBusy.current = true; setSubmitting(true);
    try {
      if (!await verifyOwner(owner, epoch)) return;
      const { error } = await supabase.rpc("request_withdrawal", { p_amount: amount, p_pix_key: key });
      if (!isCurrent(owner, epoch)) return;
      if (error) throw error;
      toast({ title: "Solicitação enviada!", description: "Seu saque será analisado pela equipe." });
      setWithdrawAmount(""); setPixKey("");
      await fetchData(owner);
    } catch (error) {
      if (isCurrent(owner, epoch)) toast({ title: "Erro ao solicitar saque", description: accountError(error, "Tente novamente."), variant: "destructive" });
    } finally {
      if (isCurrent(owner, epoch)) { actionBusy.current = false; setSubmitting(false); }
    }
  };

  const handlePaidPlanAction = (plan: PaidPlan) => {
    const owner = user?.id;
    const epoch = ownerScope.current.epoch;
    if (!owner || !isCurrent(owner, epoch) || actionBusy.current) return;
    if (storeProvider) { showStoreManagement(); return; }
    if (plan === "pro" && profile?.plan === "premium" && hasCurrentPaidPlan(profile)) { setBillingActionOwner(owner); setDowngradeOpen(true); return; }
    startSubscription(plan, async () => { if (isCurrent(owner, epoch)) await fetchData(owner); });
  };

  const manageSubscription = async (action: "downgrade" | "cancel") => {
    const owner = billingActionOwner;
    const epoch = ownerScope.current.epoch;
    if (!owner || !isCurrent(owner, epoch) || actionBusy.current) return;
    actionBusy.current = true; setSubmitting(true);
    try {
      if (!await verifyOwner(owner, epoch)) return;
      const body = action === "downgrade" ? { action, newPlan: "pro" } : { action };
      const { data, error } = await supabase.functions.invoke("manage-subscription", { body });
      if (!isCurrent(owner, epoch)) return;
      if (error) throw error;
      if (!await verifyOwner(owner, epoch)) return;
      toast({ title: action === "cancel" ? "Renovação cancelada" : "Solicitação recebida", description: data.message });
      await refreshProfile();
      if (!isCurrent(owner, epoch)) return;
      await fetchData(owner);
      if (!isCurrent(owner, epoch)) return;
      setDowngradeOpen(false); setCancelSubscriptionOpen(false);
    } catch (error) {
      if (isCurrent(owner, epoch)) toast({ title: action === "cancel" ? "Não foi possível cancelar" : "Não foi possível mudar o plano", description: accountError(error, "Tente novamente."), variant: "destructive" });
    } finally {
      if (isCurrent(owner, epoch)) { actionBusy.current = false; setSubmitting(false); }
    }
  };

  const openBillingPortal = async () => {
    const owner = user?.id;
    const epoch = ownerScope.current.epoch;
    if (!owner || !isCurrent(owner, epoch) || actionBusy.current) return;
    actionBusy.current = true; setSubmitting(true);
    try {
      if (!await verifyOwner(owner, epoch)) return;
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (!isCurrent(owner, epoch)) return;
      if (error) throw error;
      if (!await verifyOwner(owner, epoch)) return;
      const url = new URL(data?.url ?? "");
      if (url.origin !== "https://billing.stripe.com") throw new Error("Não foi possível abrir o gerenciamento seguro da assinatura.");
      window.location.assign(url.href);
    } catch (error) {
      if (isCurrent(owner, epoch)) toast({ title: "Não foi possível abrir a Stripe", description: accountError(error, "Tente novamente."), variant: "destructive" });
    } finally {
      if (isCurrent(owner, epoch)) { actionBusy.current = false; setSubmitting(false); }
    }
  };

  if (authLoading || loading || !user || dataOwner !== user.id) {
    return (
      <AppShell title="Conta">
        <div className="account-v2__loading" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>Carregando sua conta…</span>
        </div>
      </AppShell>
    );
  }

  if (loadError) return (
    <AppShell title="Conta">
      <div className="account-v2__load-error" role="alert">
        <User className="h-6 w-6" aria-hidden="true" />
        <h1>Não foi possível abrir sua conta</h1>
        <p>{loadError}</p>
        <Button onClick={() => { setLoading(true); void fetchData(user.id); }}>Tentar novamente</Button>
      </div>
    </AppShell>
  );
  const renderOwner = user.id;
  const renderEpoch = ownerScope.current.epoch;

  return (
    <AppShell title="Conta">
      <AlertDialog open={downgradeOpen && billingActionOwner === user?.id} onOpenChange={setDowngradeOpen}>
        <AlertDialogContent className="rounded-2xl border-border bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Mudar para o Pro?</AlertDialogTitle>
            <AlertDialogDescription>Seu Premium permanece disponível até o fim do período atual. Depois, a assinatura passa a R$ 29,90 por mês.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Manter Premium</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); void manageSubscription("downgrade"); }}>{submitting ? "Confirmando…" : "Confirmar mudança"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={cancelSubscriptionOpen && billingActionOwner === user?.id} onOpenChange={setCancelSubscriptionOpen}>
        <AlertDialogContent className="rounded-2xl border-border bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a renovação?</AlertDialogTitle>
            <AlertDialogDescription>Você mantém o acesso ao {profile?.plan === "premium" ? "Premium" : "Pro"} até o fim do período já pago. Não haverá uma nova cobrança mensal.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Manter assinatura</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); void manageSubscription("cancel"); }}>{submitting ? "Confirmando…" : "Cancelar renovação"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="account-v2">
        <header className="account-v2__page-heading">
          <div>
            <p className="account-v2__eyebrow">SEU ESPAÇO NA CLASSFY</p>
            <h1>Conta</h1>
            <p>Seu perfil, seu plano e tudo o que você precisa gerenciar.</p>
          </div>
          <div className="account-v2__account-summary">
            <span className="account-v2__avatar" aria-hidden="true">{(profile?.display_name || user.email || "C").slice(0, 1).toUpperCase()}</span>
            <div><strong>{profile?.display_name || "Sua conta"}</strong><span>{planLabel}{isCreator ? " · Creator" : ""}</span></div>
          </div>
        </header>
        <Tabs value={activeSection} onValueChange={changeSection} orientation="vertical" className="account-v2__layout">
          <aside className="account-v2__sidebar">
            <p className="account-v2__nav-heading">CONFIGURAÇÕES</p>
            <TabsList className="account-v2__nav" aria-label="Seções da conta">
              {sections.map(({ id, icon: Icon, label, copy }) => (
                <TabsTrigger key={id} value={id} aria-label={label} className="account-v2__nav-item">
                  <Icon className="account-v2__nav-icon" aria-hidden="true" />
                  <span><strong>{label}</strong><small>{copy}</small></span>
                  <ChevronRight className="account-v2__nav-chevron" aria-hidden="true" />
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="account-v2__mobile-nav">
              <Label htmlFor="account-section">Seção da conta</Label>
              <select id="account-section" value={activeSection} onChange={event => changeSection(event.target.value)}>
                {sections.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </div>
            <button type="button" className="account-v2__onboarding" onClick={() => navigate("/onboarding")}>
              <Play aria-hidden="true" /><span>Conheça a Classfy<small>Aprendizado e Points</small></span><ArrowUpRight aria-hidden="true" />
            </button>
          </aside>
          <div className="account-v2__content">
          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6">
            <Card className="account-v2__profile-card">
              <CardHeader>
                <CardTitle>Seu perfil</CardTitle>
                <CardDescription>
                  Estas informações aparecem para outras pessoas na Classfy.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="account-v2__profile-layout">
                  <div className="account-v2__identity">
                    <EditableAvatar 
                      userId={user?.id || ""} 
                      avatarUrl={profile?.avatar_url}
                      displayName={profile?.display_name || ""}
                      size="xl"
                      editable={true}
                      key={renderOwner}
                      onUploadSuccess={(avatarUrl) => {
                        if (isCurrent(renderOwner, renderEpoch)) setProfile(current => current && ({ ...current, avatar_url: avatarUrl }));
                      }}
                    />
                    <div className="account-v2__identity-copy">
                      <p className="account-v2__identity-name">{profile?.display_name}</p>
                      <V2Badge variant={effectivePlan === "premium" ? "premium" : effectivePlan === "pro" ? "accent" : "neutral"}>
                        {effectivePlan !== "free" && <PlanCrown plan={effectivePlan} className="h-3 w-3" />}
                        {planLabel}
                      </V2Badge>
                    </div>
                  </div>

                  <div className="account-v2__profile-fields">
                    <div className="account-v2__field-grid">
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
                          value={isEditingProfile ? editDisplayName : (profile?.display_name || "")} 
                          onChange={(e) => setEditDisplayName(e.target.value)}
                          disabled={!isEditingProfile || busy}
                          className={!isEditingProfile ? "bg-muted" : ""}
                          maxLength={50}
                        />
                      </div>

                      <div className="grid gap-2 account-v2__field-wide">
                        <Label htmlFor="bio">Bio</Label>
                        <Input 
                          id="bio" 
                          value={isEditingProfile ? editBio : (profile?.bio || "")} 
                          onChange={(e) => setEditBio(e.target.value)}
                          disabled={!isEditingProfile || busy}
                          className={!isEditingProfile ? "bg-muted" : ""}
                          placeholder="Conte um pouco sobre você..."
                          maxLength={200}
                        />
                      </div>

                      <div className="account-v2__field-wide flex flex-wrap gap-2 pt-2">
                        {!isEditingProfile ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setEditDisplayName(profile?.display_name || "");
                              setEditBio(profile?.bio || "");
                              setIsEditingProfile(true);
                            }}
                          >
                            Editar Perfil
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={handleSaveProfile}
                              disabled={busy || !editDisplayName.trim()}
                            >
                              {savingProfile ? (
                                <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Salvando...</>
                              ) : "Salvar"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setIsEditingProfile(false)}
                              disabled={savingProfile}
                            >
                              Cancelar
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <section className="account-v2__achievements" aria-labelledby="account-achievements-title">
              <div className="account-v2__section-heading">
                <div>
                  <h2 id="account-achievements-title">Metas e conquistas</h2>
                  <p>Complete metas para desbloquear conquistas e acompanhar tudo o que já alcançou.</p>
                </div>
                <Trophy className="h-5 w-5" aria-hidden="true" />
              </div>
              {isCreator
                ? <AchievementsSection userId={user?.id} />
                : user && <UserAchievementsCard userId={user.id} />}
            </section>
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
                            disabled={!isEditingChannel || busy}
                            maxLength={30}
                          />
                        </div>
                        {!isEditingChannel ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsEditingChannel(true)}
                            disabled={busy}
                          >
                            Editar
                          </Button>
                        ) : (
                          <>
                            <Button
                              type="button"
                              onClick={handleSaveChannelName}
                              disabled={busy || !channelName.trim()}
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
                      key={renderOwner}
                      onUploadComplete={(url) => {
                        if (!isCurrent(renderOwner, renderEpoch)) return;
                        setProfile(current => current && ({ ...current, cover_image_url: url }));
                        void refreshProfile();
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
                  Consulte seus ganhos e acompanhe os pedidos de saque.
                </CardDescription>
                <Button variant="outline" size="sm" className="account-v2__wallet-link" onClick={() => navigate("/carteira")}>
                  Abrir Carteira <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </CardHeader>
              <CardContent>
                {walletError ? <div className="account-v2__inline-error" role="alert"><p>{walletError}</p><Button variant="outline" onClick={() => void fetchData(user.id)}>Tentar novamente</Button></div> : (
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
                            R$ {(Number(wallet?.balance || 0) - Number(wallet?.reserved_balance || 0)).toFixed(2)}
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
                                {withdrawal.status === "paid" && <CheckCircle className="w-5 h-5 text-green-500" />}
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
                                  withdrawal.status === "paid"
                                    ? "default"
                                    : withdrawal.status === "rejected"
                                    ? "destructive"
                                    : "secondary"
                                }
                              >
                                {withdrawal.status === "pending" && "Pendente"}
                                {withdrawal.status === "paid" && "Pago"}
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
                            R$ {(Number(wallet?.balance || 0) - Number(wallet?.reserved_balance || 0)).toFixed(2)}
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
                          disabled={busy}
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
                          disabled={busy}
                        />
                        <p className="text-xs text-muted-foreground">
                          Insira a chave PIX onde deseja receber o pagamento
                        </p>
                      </div>

                      <Button
                        type="submit"
                        className="w-full"
                        size="lg"
                        disabled={busy || (Number(wallet?.balance || 0) - Number(wallet?.reserved_balance || 0)) <= 0}
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
                                      withdrawal.status === "paid"
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
                                    {withdrawal.status === "paid" && (
                                      <>
                                        <CheckCircle className="w-3 h-3" />
                                        Pago
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
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="billing" className="account-v2__billing">
            <SubscriptionBillingPanel key={user.id} ownerId={user.id} onViewPlan={() => changeSection("plan")} />
          </TabsContent>

          {/* Plan Tab */}
          <TabsContent value="plan" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Plano
                </CardTitle>
                <CardDescription>
                  Seus benefícios, mudanças de plano e opções de assinatura.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="account-v2__current-plan">
                  <span className="account-v2__plan-emblem" aria-hidden="true">{effectivePlan === "free" ? <User /> : <PlanCrown plan={effectivePlan} size={28} />}</span>
                  <div className="account-v2__current-plan-copy">
                    <p className="account-v2__eyebrow">SEU PLANO</p>
                    <div className="account-v2__plan-title"><h3>{planLabel}</h3><V2Badge variant={paidPlanActive ? "success" : "neutral"}>{paidPlanActive ? "Ativo" : "Gratuito"}</V2Badge></div>
                    {paidPlanActive && profile?.plan_expires_at && <p className="account-v2__plan-validity"><Clock aria-hidden="true" />Acesso até {new Date(profile.plan_expires_at).toLocaleDateString("pt-BR")}</p>}
                    {!paidPlanActive && profile?.plan && profile.plan !== "free" && <p className="account-v2__plan-validity">O período do {profile.plan === "premium" ? "Premium" : "Pro"} terminou.</p>}
                    {effectivePlan === "free" && profile?.plan === "free" && <p className="account-v2__plan-validity">Explore conteúdos gratuitos e comece a aprender.</p>}
                  </div>
                  <div className="account-v2__plan-management">
                    {(profile?.plan === "pro" || profile?.plan === "premium") && <Button variant="outline" size="sm" disabled={busy} onClick={() => storeProvider ? showStoreManagement() : void openBillingPortal()}><CreditCard className="h-4 w-4" aria-hidden="true" />{storeProvider ? `Gerenciar na ${storeLabel}` : 'Gerenciar na Stripe'}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Button>}
                    <Button variant="ghost" size="sm" onClick={() => changeSection("billing")}><ReceiptText className="h-4 w-4" aria-hidden="true" />Ver cobranças</Button>
                  </div>
                </div>
                <div className="account-v2__plan-options-heading"><h3>Encontre seu próximo passo</h3><p>Escolha o plano que acompanha seu jeito de aprender e criar.</p></div>

                {/* Plan Cards Comparison */}
                <div className="account-v2__plan-grid">
                  <article className="plans-price-card plan-offer-card plan-offer-card--compact plan-offer-card--free" data-current={effectivePlan === "free"}>
                    <div className="plans-price-card__topline"><span className="plans-price-card__icon"><User className="w-5 h-5" /></span><span>{effectivePlan === "free" ? "SEU PLANO" : "PONTO DE PARTIDA"}</span></div>
                    <div className="plans-price-card__head"><div><h3>Free</h3><p>Explore a Classfy no seu ritmo.</p></div></div>
                    <div className="plans-price-card__price"><span>R$</span><strong>0</strong><span>/ mês</span></div>
                    <div className="plans-price-card__divider" />
                    <p className="plans-price-card__includes">O que está incluído</p>
                    <ul><li><Check size={16} /> Conteúdos gratuitos</li><li><Check size={16} /> Até 5 estudos com a Classy</li><li><Check size={16} /> 5 mensagens por estudo</li></ul>
                  </article>
                  {(["pro", "premium"] as const).map((plan) => (
                    <PlanOfferCard
                      key={plan}
                      plan={plan}
                      compact
                      current={effectivePlan === plan}
                      action={effectivePlan === plan ? null : <Button className="plans-button account-v2__plan-action" disabled={busy} onClick={() => handlePaidPlanAction(plan)}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : effectivePlan === "premium" ? "Mudar para Pro" : effectivePlan === "pro" ? "Mudar para Premium" : `Escolher ${plan === "pro" ? "Pro" : "Premium"}`}</Button>}
                    />
                  ))}
                </div>

                {/* Comparison Table */}
                <details className="account-v2__comparison">
                  <summary>Comparar todos os recursos <ChevronRight aria-hidden="true" /></summary>
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
                          <TableCell>Estudos com a Classy</TableCell>
                          <TableCell className="text-center">Até 5</TableCell>
                          <TableCell className="text-center">Até 50</TableCell>
                          <TableCell className="text-center">Ilimitados</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Mensagens por estudo</TableCell>
                          <TableCell className="text-center">Até 5</TableCell>
                          <TableCell className="text-center">Até 30</TableCell>
                          <TableCell className="text-center">Ilimitadas</TableCell>
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
                </details>

                {/* Cancel subscription for paid users */}
                {(profile?.plan === "pro" || profile?.plan === "premium") && !storeProvider && (
                  <div className="account-v2__cancel-renewal">
                    <div><h3>Renovação da assinatura</h3><p>Ao cancelar, você mantém o acesso até o fim do período já pago.</p></div>
                    <Button 
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      onClick={() => { setBillingActionOwner(user.id); setCancelSubscriptionOpen(true); }}
                    >
                      {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Cancelar renovação
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
                <CardTitle>Preferências</CardTitle>
                <CardDescription>
                  Escolha como você se conecta e compartilha na Classfy.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="account-v2__email-row">
                    <div className="space-y-1">
                      <p className="font-medium">Email da Conta</p>
                      <p className="text-sm text-muted-foreground">{user?.email}</p>
                    </div>
                    <Badge variant="secondary" className="account-v2__email-status">{user.email_confirmed_at ? <><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verificado</> : "Não verificado"}</Badge>
                  </div>
                  <Button variant="ghost" className="account-v2__preferences-guide" onClick={() => navigate("/onboarding")}><Play className="h-4 w-4" aria-hidden="true" />Conheça a Classfy e seus Points<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Button>
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
          </div>
        </Tabs>
      </div>

      <BecomeCreatorModal 
        open={creatorModalOpen} 
        onOpenChange={setCreatorModalOpen} 
      />
    </AppShell>
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
    <V2Card className="economy-panel account-v2__achievements-panel">
      <V2CardHeader>
        <div className="economy-panel-heading">
          <span className="economy-icon"><Award aria-hidden="true" /></span>
          <div>
            <h3 className="economy-panel-title">Conquistas</h3>
            <p className="economy-panel-copy">{unlockedMilestones.length} desbloqueadas de {milestones.length}</p>
          </div>
        </div>
      </V2CardHeader>
      <V2CardContent>
        <Tabs defaultValue={unlockedMilestones.length > 0 ? "unlocked" : "locked"}>
          <TabsList className="economy-tabs-list">
            <TabsTrigger value="unlocked">
              Desbloqueadas · {unlockedMilestones.length}
            </TabsTrigger>
            <TabsTrigger value="locked">
              Em progresso · {lockedMilestones.length}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="unlocked" className="mt-5">
            {unlockedMilestones.length > 0 ? (
              <div className="economy-achievement-grid">
                {unlockedMilestones.map((milestone) => (
                  <CreatorAchievementBadge
                    key={milestone.id}
                    milestone={milestone}
                    size="sm"
                    variant="economy"
                  />
                ))}
              </div>
            ) : (
              <div className="py-10 text-center">
                <p className="economy-panel-title">Sua primeira conquista está próxima</p>
                <p className="economy-panel-copy">Complete metas para marcar o início da sua coleção.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="locked" className="mt-5">
            <div className="economy-achievement-grid">
              {lockedMilestones.slice(0, 8).map((milestone) => (
                <CreatorAchievementBadge
                  key={milestone.id}
                  milestone={milestone}
                  size="sm"
                  variant="economy"
                />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </V2CardContent>
    </V2Card>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  CheckCircle,
  Clock,
  History,
  Landmark,
  ShieldCheck,
  TrendingUp,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { GlobalLoader } from "@/components/GlobalLoader";
import { AppShell, PageHeader } from "@/components/layout";
import { EconomyTemplate } from "@/components/templates";
import {
  V2Badge,
  V2Button,
  V2Card,
  V2CardContent,
  V2CardHeader,
  V2EmptyState,
  V2Input,
  V2SectionHeader,
  V2Table,
  V2TableWrap,
} from "@/components/v2";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "@/styles/economy-v2.css";

type WalletRow = Database["public"]["Tables"]["wallets"]["Row"];
type WithdrawalRow = Database["public"]["Tables"]["withdraw_requests"]["Row"];
type RewardEventRow = Database["public"]["Tables"]["reward_events"]["Row"];

const formatMoney = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const actionLabels: Record<string, string> = {
  VIEW_15S: "Primeiros 15 segundos",
  LIKE: "Curtida",
  COMMENT: "Comentário",
  SAVE: "Salvamento",
  FAVORITE: "Favorito",
  SHARE: "Compartilhamento",
  WATCH_50: "Assistiu 50%",
  WATCH_100: "Conteúdo concluído",
  DAILY_LOGIN: "Login diário",
  FIRST_CONTENT_WEEK: "Primeiro conteúdo da semana",
  WEEKLY_STREAK: "Sequência semanal",
  PROFILE_COMPLETE: "Perfil completo",
  REFERRAL_SIGNUP: "Indicação",
  REFERRAL_PURCHASE: "Compra por indicação",
  SUBSCRIBE_CREATOR: "Inscrição em creator",
  COMPLETE_COURSE: "Curso concluído",
  CREATOR_APPROVED: "Creator aprovado",
  FIRST_UPLOAD: "Primeiro upload",
  CONTENT_APPROVED: "Conteúdo aprovado",
};

export default function Carteira() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [minWithdrawalAmount, setMinWithdrawalAmount] = useState(10);
  const [withdrawHistory, setWithdrawHistory] = useState<WithdrawalRow[]>([]);
  const [rewardHistory, setRewardHistory] = useState<RewardEventRow[]>([]);
  const [stats, setStats] = useState({ last7Days: 0, last30Days: 0, thisMonth: 0 });

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const [walletRes, configRes, withdrawalsRes, rewardsRes] = await Promise.all([
        supabase.from("wallets").select("*").eq("user_id", user.id).single(),
        supabase.from("platform_settings").select("value").eq("key", "economic_v1").maybeSingle(),
        supabase.from("withdraw_requests").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("reward_events").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
      ]);

      if (walletRes.error) throw walletRes.error;
      setWallet(walletRes.data);

      if (configRes.data?.value && typeof configRes.data.value === "object" && !Array.isArray(configRes.data.value)) {
        const configuredMinimum = (configRes.data.value as Record<string, unknown>).minimum_withdrawal_amount;
        if (typeof configuredMinimum === "number") setMinWithdrawalAmount(configuredMinimum);
      }

      setWithdrawHistory(withdrawalsRes.data || []);
      const rewards = rewardsRes.data || [];
      setRewardHistory(rewards);

      const now = new Date();
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const sumSince = (date: Date) =>
        rewards
          .filter((reward) => new Date(reward.created_at) >= date)
          .reduce((sum, reward) => sum + Number(reward.points || 0), 0);

      setStats({
        last7Days: sumSince(last7Days),
        last30Days: sumSince(last30Days),
        thisMonth: sumSince(monthStart),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível carregar sua carteira.";
      toast({ title: "Erro ao carregar dados", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
      return;
    }
    if (user) void fetchData();
  }, [authLoading, fetchData, navigate, user]);

  const availableBalance = useMemo(
    () => Number(wallet?.balance || 0) - Number(wallet?.reserved_balance || 0),
    [wallet],
  );

  const handleWithdraw = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    const amount = Number.parseFloat(withdrawAmount);

    if (!amount || amount <= 0) {
      toast({ title: "Valor inválido", description: "Informe um valor válido.", variant: "destructive" });
      setSubmitting(false);
      return;
    }
    if (amount < minWithdrawalAmount) {
      toast({
        title: "Valor mínimo não atingido",
        description: `O valor mínimo para saque é ${formatMoney(minWithdrawalAmount)}.`,
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }
    if (amount > availableBalance) {
      toast({ title: "Saldo insuficiente", description: "Você não possui saldo disponível para este saque.", variant: "destructive" });
      setSubmitting(false);
      return;
    }
    if (!pixKey.trim()) {
      toast({ title: "Chave PIX obrigatória", description: "Informe a chave que receberá o saque.", variant: "destructive" });
      setSubmitting(false);
      return;
    }

    try {
      const { error } = await supabase.rpc("request_withdrawal", { p_amount: amount, p_pix_key: pixKey.trim() });
      if (error) throw error;
      toast({ title: "Solicitação enviada", description: "Seu pedido de saque está em análise." });
      setWithdrawAmount("");
      setPixKey("");
      await fetchData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível solicitar o saque.";
      toast({ title: "Erro ao solicitar saque", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatus = (status: WithdrawalRow["status"]) => {
    if (status === "paid") return { label: "Pago", className: "economy-status--success", Icon: CheckCircle };
    if (status === "pending") return { label: "Em análise", className: "economy-status--warning", Icon: Clock };
    if (status === "rejected") return { label: "Rejeitado", className: "economy-status--danger", Icon: XCircle };
    return { label: status, className: "", Icon: AlertCircle };
  };

  if (loading || authLoading || !wallet) return <GlobalLoader />;

  return (
    <AppShell title="Carteira" contentClassName="economy-page-shell">
      <EconomyTemplate
        className="economy-template"
        width="wide"
        header={
          <PageHeader
            eyebrow="Carteira Classfy"
            title="Seu valor, com clareza."
            description="Acompanhe valores disponíveis, períodos de maturação e cada movimentação da sua carteira."
            action={<V2Badge variant="success">Carteira ativa</V2Badge>}
          />
        }
      >
        <section className="economy-hero-grid">
          <V2Card elevation="panel" className="economy-balance-hero">
            <div className="economy-balance-hero__top">
              <span className="economy-kicker">Saldo disponível</span>
              <h2 className="economy-balance-hero__headline">O valor gerado por você, pronto para acompanhar.</h2>
              <span className="economy-balance-hero__label">Disponível para saque</span>
              <div className="economy-balance-hero__value">
                <small>R$</small> {availableBalance.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="economy-balance-hero__meta">
                <span><span className="economy-status-dot" />Disponível</span>
                <span>+ {formatMoney(Number(wallet.pending_balance || 0))} em maturação</span>
              </div>
            </div>
            <div className="economy-balance-hero__bottom economy-level">
              <div className="economy-level__row">
                <span className="economy-panel-copy">Total gerado na plataforma</span>
                <strong className="economy-level__value">{formatMoney(Number(wallet.total_earned || 0))}</strong>
              </div>
              <div className="economy-level__row mt-3">
                <span className="economy-panel-copy">Saldo reservado</span>
                <strong className="economy-level__value">{formatMoney(Number(wallet.reserved_balance || 0))}</strong>
              </div>
            </div>
          </V2Card>

          <V2Card className="economy-panel">
            <V2CardHeader>
              <div className="economy-panel-heading">
                <span className="economy-icon"><Landmark aria-hidden="true" /></span>
                <div>
                  <h2 className="economy-panel-title">Solicitar saque</h2>
                  <p className="economy-panel-copy">Mínimo de {formatMoney(minWithdrawalAmount)}</p>
                </div>
              </div>
              <V2Badge variant="neutral">PIX</V2Badge>
            </V2CardHeader>
            <V2CardContent>
              <form onSubmit={handleWithdraw} className="economy-withdraw-form">
                <V2Input
                  id="withdraw-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  label="Valor do saque"
                  hint={`Você possui ${formatMoney(availableBalance)} disponível.`}
                  value={withdrawAmount}
                  onChange={(event) => setWithdrawAmount(event.target.value)}
                  placeholder="0,00"
                  disabled={submitting}
                />
                <V2Input
                  id="withdraw-pix"
                  label="Chave PIX"
                  hint="CPF, CNPJ, e-mail, telefone ou chave aleatória."
                  value={pixKey}
                  onChange={(event) => setPixKey(event.target.value)}
                  placeholder="Digite sua chave"
                  disabled={submitting}
                />
                <div className="economy-form-actions">
                  <span className="economy-form-note">A solicitação passa por análise antes da liberação.</span>
                  <V2Button type="submit" disabled={submitting}>
                    {submitting ? "Enviando..." : "Solicitar saque"}
                  </V2Button>
                </div>
              </form>
            </V2CardContent>
          </V2Card>
        </section>

        <section className="economy-section">
          <V2SectionHeader
            eyebrow="Visão financeira"
            title="O que está acontecendo agora"
            description="Disponibilidade e histórico apresentados sem misturar Points com valores em reais."
          />
          <div className="economy-metric-grid">
            {[
              { Icon: Clock, label: "Em maturação", value: formatMoney(Number(wallet.pending_balance || 0)), detail: "Aguardando liberação" },
              { Icon: ArrowUpRight, label: "Total gerado", value: formatMoney(Number(wallet.total_earned || 0)), detail: "Histórico completo" },
              { Icon: ArrowDownRight, label: "Total sacado", value: formatMoney(Number(wallet.total_withdrawn || 0)), detail: "Saques concluídos" },
              { Icon: Calendar, label: "Points neste mês", value: Math.floor(stats.thisMonth).toLocaleString("pt-BR"), detail: "Ciclo em andamento" },
            ].map(({ Icon, label, value, detail }) => (
              <V2Card key={label} className="economy-metric">
                <div className="economy-metric__top">
                  <span className="economy-metric__label">{label}</span>
                  <span className="economy-icon economy-icon--muted"><Icon aria-hidden="true" /></span>
                </div>
                <strong className="economy-metric__value">{value}</strong>
                <span className="economy-metric__detail">{detail}</span>
              </V2Card>
            ))}
          </div>
        </section>

        <section className="economy-section">
          <V2SectionHeader
            eyebrow="Movimentações"
            title="Tudo registrado, sem surpresas"
            description={`Últimos 7 dias: ${Math.floor(stats.last7Days).toLocaleString("pt-BR")} Points · últimos 30 dias: ${Math.floor(stats.last30Days).toLocaleString("pt-BR")} Points`}
          />
          <Tabs defaultValue="ganhos">
            <TabsList className="economy-tabs-list mb-4">
              <TabsTrigger value="ganhos"><TrendingUp className="mr-2 h-4 w-4" />Ganhos</TabsTrigger>
              <TabsTrigger value="saques"><History className="mr-2 h-4 w-4" />Saques</TabsTrigger>
            </TabsList>

            <TabsContent value="ganhos">
              <V2Card className="economy-panel economy-history-card">
                <V2CardHeader>
                  <div className="economy-panel-heading">
                    <span className="economy-icon economy-icon--success"><Zap aria-hidden="true" /></span>
                    <div><h2 className="economy-panel-title">Histórico de ganhos</h2><p className="economy-panel-copy">Últimos 50 eventos registrados</p></div>
                  </div>
                </V2CardHeader>
                <V2CardContent>
                  {rewardHistory.length === 0 ? (
                    <V2EmptyState
                      icon={<TrendingUp className="h-5 w-5" />}
                      title="Nenhum ganho registrado"
                      description="Quando uma ação elegível gerar Points, ela aparecerá aqui."
                    />
                  ) : (
                    <div className="economy-activity-list">
                      {rewardHistory.map((reward) => (
                        <div className="economy-activity-row" key={reward.id}>
                          <div className="economy-activity-copy">
                            <span className="economy-icon economy-icon--muted"><Zap aria-hidden="true" /></span>
                            <div className="min-w-0">
                              <p className="economy-activity-title">{actionLabels[reward.action_key] || reward.action_key}</p>
                              <p className="economy-activity-date">
                                {format(new Date(reward.created_at), "d 'de' MMM, HH:mm", { locale: ptBR })}
                                {" · "}{reward.point_type === "creator" ? "Creator Points" : "Points"}
                              </p>
                            </div>
                          </div>
                          <strong className="economy-activity-points">+{Math.floor(Number(reward.points || 0))} pts</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </V2CardContent>
              </V2Card>
            </TabsContent>

            <TabsContent value="saques">
              <V2Card className="economy-panel economy-history-card">
                <V2CardHeader>
                  <div className="economy-panel-heading">
                    <span className="economy-icon economy-icon--muted"><ShieldCheck aria-hidden="true" /></span>
                    <div><h2 className="economy-panel-title">Histórico de saques</h2><p className="economy-panel-copy">Acompanhe cada solicitação e seu status</p></div>
                  </div>
                </V2CardHeader>
                <V2CardContent>
                  {withdrawHistory.length === 0 ? (
                    <V2EmptyState
                      icon={<Wallet className="h-5 w-5" />}
                      title="Nenhum saque solicitado"
                      description="Suas solicitações e atualizações de status aparecerão aqui."
                    />
                  ) : (
                    <>
                      <V2TableWrap className="economy-desktop-table">
                        <V2Table>
                          <thead><tr><th>Data</th><th>Valor</th><th>Chave PIX</th><th>Status</th></tr></thead>
                          <tbody>
                            {withdrawHistory.map((withdrawal) => {
                              const status = getStatus(withdrawal.status);
                              return (
                                <tr key={withdrawal.id}>
                                  <td>{format(new Date(withdrawal.created_at), "dd/MM/yyyy, HH:mm", { locale: ptBR })}</td>
                                  <td><strong>{formatMoney(withdrawal.amount)}</strong></td>
                                  <td>{withdrawal.pix_key}</td>
                                  <td><span className={`economy-status ${status.className}`}><status.Icon />{status.label}</span></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </V2Table>
                      </V2TableWrap>
                      <div className="economy-mobile-list">
                        {withdrawHistory.map((withdrawal) => {
                          const status = getStatus(withdrawal.status);
                          return (
                            <div className="economy-mobile-item" key={withdrawal.id}>
                              <div className="economy-level__row">
                                <strong className="economy-level__value">{formatMoney(withdrawal.amount)}</strong>
                                <span className={`economy-status ${status.className}`}><status.Icon />{status.label}</span>
                              </div>
                              <p className="economy-panel-copy mt-3 truncate">PIX · {withdrawal.pix_key}</p>
                              <p className="economy-panel-copy">{format(new Date(withdrawal.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </V2CardContent>
              </V2Card>
            </TabsContent>
          </Tabs>
        </section>
      </EconomyTemplate>
    </AppShell>
  );
}

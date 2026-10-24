import { LoadingPlaceholder } from '@/components/LoadingPlaceholder';
import { NavigationHeader } from '@/components/NavigationHeader';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { ArrowUpRight, CheckCircle, Clock, XCircle, AlertCircle, Activity, Wallet } from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { parseMoneyInput } from '@/features/wallet/moneyInput';
import { DataAction, DataCard, DataIcon, DataMetric, DataRow, DataSection } from '@/components/data/DataUI';
import { dataStyles, dataTheme as t } from '@/theme/data';
import { spacing } from '@/theme/spacing';

export default function CarteiraScreen() {
  const { user } = useAuth();
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 380 || fontScale > 1.15;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [wallet, setWallet] = useState<any>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [minWithdrawalAmount, setMinWithdrawalAmount] = useState(10);
  const [withdrawHistory, setWithdrawHistory] = useState<any[]>([]);
  const [rewardHistory, setRewardHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'saques' | 'ganhos'>('saques');
  const [stats, setStats] = useState({
    last7Days: 0,
    last30Days: 0,
    thisMonth: 0,
  });

  useEffect(() => {
    if (user) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [user]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [walletRes, configRes, withdrawalsRes, rewardsRes] = await Promise.all([
        supabase.from('wallets').select('*').eq('user_id', user?.id).single(),
        supabase
          .from('platform_settings')
          .select('value')
          .eq('key', 'economic_v1')
          .maybeSingle(),
        supabase
          .from('withdraw_requests')
          .select('*')
          .eq('user_id', user?.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('reward_events')
          .select('*')
          .eq('user_id', user?.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (walletRes.error) throw walletRes.error;
      setWallet(walletRes.data);

      if (configRes.data?.value) {
        const economicSettings = configRes.data.value as Record<string, any>;
        if (typeof economicSettings.minimum_withdrawal_amount === 'number') {
          setMinWithdrawalAmount(economicSettings.minimum_withdrawal_amount);
        }
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
          .reduce((acc: number, r: any) => acc + Number(r.points || 0), 0);

        const last30DaysSum = rewardsRes.data
          .filter((r: any) => new Date(r.created_at) >= last30Days)
          .reduce((acc: number, r: any) => acc + Number(r.points || 0), 0);

        const thisMonthSum = rewardsRes.data
          .filter((r: any) => new Date(r.created_at) >= monthStart)
          .reduce((acc: number, r: any) => acc + Number(r.points || 0), 0);

        setStats({
          last7Days: last7DaysSum,
          last30Days: last30DaysSum,
          thisMonth: thisMonthSum,
        });
      }
    } catch (error: any) {
      console.error('Error fetching wallet data:', error);
      setLoadError('Não foi possível carregar os dados da carteira.');
      Alert.alert('Erro', 'Não foi possível carregar os dados da carteira.');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    setSubmitting(true);
    const amount = parseMoneyInput(withdrawAmount);

    if (!amount || amount <= 0) {
      Alert.alert('Erro', 'Por favor, insira um valor de saque válido.');
      setSubmitting(false);
      return;
    }

    if (amount < minWithdrawalAmount) {
      Alert.alert('Erro', `O valor mínimo para saque é R$ ${minWithdrawalAmount.toFixed(2)}`);
      setSubmitting(false);
      return;
    }

    if (amount > Number(wallet.balance || 0) - Number(wallet.reserved_balance || 0)) {
      Alert.alert('Erro', 'Você não possui saldo suficiente para este saque.');
      setSubmitting(false);
      return;
    }

    if (!pixKey.trim()) {
      Alert.alert('Erro', 'Por favor, insira sua chave PIX.');
      setSubmitting(false);
      return;
    }

    try {
      const { error } = await supabase.rpc('request_withdrawal', {
        p_amount: amount,
        p_pix_key: pixKey.trim(),
      });

      if (error) throw error;

      Alert.alert('Sucesso', 'Sua solicitação de saque foi enviada e está em análise!');
      setWithdrawAmount('');
      setPixKey('');
      setWithdrawOpen(false);
      await fetchData();
    } catch (error: any) {
      console.error('Error requesting withdrawal:', error);
      Alert.alert('Erro', error.message || 'Falha ao solicitar saque.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
      case 'approved':
        return <CheckCircle size={14} strokeWidth={t.stroke} color={t.secondary} />;
      case 'pending':
        return <Clock size={14} strokeWidth={t.stroke} color={t.secondary} />;
      case 'rejected':
        return <XCircle size={14} strokeWidth={t.stroke} color={t.danger} />;
      default:
        return <AlertCircle size={14} strokeWidth={t.stroke} color={t.muted} />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'paid':
        return 'Pago';
      case 'approved':
        return 'Aprovado';
      case 'pending':
        return 'Em análise';
      case 'rejected':
        return 'Rejeitado';
      default:
        return status;
    }
  };

  const getActionLabel = (actionKey: string) => {
    const labels: Record<string, string> = {
      VIEW_15S: 'Visualização (15s)',
      LIKE: 'Curtida',
      COMMENT: 'Comentário',
      SAVE: 'Salvamento',
      FAVORITE: 'Favorito',
      SHARE: 'Compartilhamento',
      // Alias historicos preservados somente para leitura do extrato antigo.
      LIKE_CONTENT: 'Curtida',
      COMMENT_CONTENT: 'Comentário',
      SAVE_CONTENT: 'Salvamento',
      SHARE_CONTENT: 'Compartilhamento',
      WATCH_50: 'Assistiu 50%',
      WATCH_100: 'Assistiu 100%',
      DAILY_LOGIN: 'Login Diário',
      FIRST_CONTENT_WEEK: 'Primeiro conteúdo da semana',
      BINGE_WATCH: 'Maratona',
      PROFILE_COMPLETE: 'Perfil Completo',
      REFERRAL_SIGNUP: 'Indicação',
      REFERRAL_PURCHASE: 'Compra por indicação',
      MILESTONE_100_VIEWS: 'Marco: 100 views',
      MILESTONE_500_VIEWS: 'Marco: 500 views',
      MILESTONE_1000_VIEWS: 'Marco: 1000 views',
      STREAK_7: 'Sequência de 7 dias',
      STREAK_30: 'Sequência de 30 dias',
    };
    return labels[actionKey] || actionKey;
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()} às ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch {
      return dateStr;
    }
  };

  const formatMoney = (value: unknown) => Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const formatPoints = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const availableBalance = Number(wallet?.balance || 0) - Number(wallet?.reserved_balance || 0);

  return (
    <AppScreen edgeToEdge scroll={false} backgroundColor={t.canvas}>
      <NavigationHeader title="Carteira" back />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={dataStyles.screen}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <LoadingPlaceholder variant="dashboard" inset={false} />
        ) : loadError ? (
          <DataCard style={styles.stateCard}>
            <DataIcon icon={AlertCircle} />
            <Text accessibilityRole="header" style={dataStyles.sectionTitle}>Carteira indisponível</Text>
            <Text accessibilityRole="alert" style={dataStyles.body}>{loadError}</Text>
            <DataAction label="Tentar novamente" variant="secondary" onPress={() => void fetchData()} />
          </DataCard>
        ) : !user || !wallet ? (
          <DataCard style={styles.stateCard}>
            <DataIcon icon={Wallet} />
            <Text style={dataStyles.sectionTitle}>Sua carteira</Text>
            <Text style={dataStyles.body}>Entre na sua conta para consultar seu saldo e suas movimentações.</Text>
          </DataCard>
        ) : (
          <>
            <DataCard style={styles.balanceCard}>
              <View style={styles.balanceHeading}>
                <Text style={styles.balanceLabel}>Saldo disponível</Text>
                <Text style={styles.currencyLabel}>BRL</Text>
              </View>
              <Text style={[styles.balanceValue, compact && styles.balanceValueCompact]}>{formatMoney(availableBalance)}</Text>
              <Text style={dataStyles.label}>Disponível para solicitar saque</Text>
              <DataAction
                label={withdrawOpen ? 'Fechar solicitação' : 'Solicitar saque'}
                icon={withdrawOpen ? undefined : ArrowUpRight}
                variant={withdrawOpen ? 'secondary' : 'primary'}
                disabled={submitting}
                onPress={() => setWithdrawOpen(!withdrawOpen)}
              />

              {withdrawOpen ? (
                <View style={styles.withdrawForm}>
                  <View style={styles.formHeading}>
                    <Text style={styles.formTitle}>Saque via Pix</Text>
                    <Text style={dataStyles.label}>Mínimo de {formatMoney(minWithdrawalAmount)}</Text>
                  </View>
                  <View style={styles.formGroup}>
                    <Text style={styles.fieldLabel}>Valor do saque (R$)</Text>
                    <TextInput
                      accessibilityLabel="Valor do saque em reais"
                      style={dataStyles.input}
                      placeholder="0,00"
                      placeholderTextColor={t.subtle}
                      keyboardType="decimal-pad"
                      value={withdrawAmount}
                      editable={!submitting}
                      onChangeText={setWithdrawAmount}
                    />
                  </View>
                  <View style={styles.formGroup}>
                    <Text style={styles.fieldLabel}>Chave Pix</Text>
                    <TextInput
                      accessibilityLabel="Chave Pix"
                      style={dataStyles.input}
                      placeholder="CPF, e-mail, telefone ou chave aleatória"
                      placeholderTextColor={t.subtle}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!submitting}
                      value={pixKey}
                      onChangeText={setPixKey}
                    />
                  </View>
                  <DataAction label="Enviar solicitação" busy={submitting} onPress={() => void handleWithdraw()} />
                  <Text style={dataStyles.label}>O pedido será analisado antes do pagamento.</Text>
                </View>
              ) : null}
            </DataCard>

            <View style={[styles.balanceDetails, compact && styles.stack]}>
              <DataCard style={styles.balanceDetail}>
                <DataMetric label="Aguardando liberação" value={formatMoney(wallet.pending_balance)} hint="Ainda indisponível para saque" />
              </DataCard>
              <DataCard style={styles.balanceDetail}>
                <DataMetric label="Reservado" value={formatMoney(wallet.reserved_balance)} hint="Em solicitações de saque" />
              </DataCard>
            </View>

            <DataSection title="Resumo financeiro">
              <DataCard style={styles.ledgerCard}>
                <DataRow title="Total gerado na carteira" value={formatMoney(wallet.total_earned)} />
                <DataRow title="Total sacado" value={formatMoney(wallet.total_withdrawn)} last />
              </DataCard>
            </DataSection>

            <DataSection title="Extrato">
              <View accessibilityRole="tablist" style={styles.tabs}>
                {(['saques', 'ganhos'] as const).map((tab) => (
                  <Pressable
                    key={tab}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: activeTab === tab }}
                    onPress={() => setActiveTab(tab)}
                    style={[styles.tab, activeTab === tab && styles.tabActive]}
                  >
                    <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab === 'saques' ? 'Saques' : 'Points'}</Text>
                  </Pressable>
                ))}
              </View>

              {activeTab === 'saques' ? (
                <DataCard style={styles.ledgerCard}>
                  {withdrawHistory.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyTitle}>Nenhum saque solicitado</Text>
                      <Text style={dataStyles.label}>Seus pedidos e o status de cada pagamento aparecerão aqui.</Text>
                    </View>
                  ) : withdrawHistory.map((item, index) => (
                    <View key={item.id} style={[styles.ledgerItem, index < withdrawHistory.length - 1 && styles.ledgerDivider]}>
                      <View style={[styles.ledgerHeading, compact && styles.stack]}>
                        <Text style={styles.ledgerAmount}>{formatMoney(item.amount)}</Text>
                        <View style={styles.status}>
                          {getStatusIcon(item.status)}
                          <Text style={[styles.statusText, item.status === 'rejected' && styles.rejected]}>{getStatusText(item.status)}</Text>
                        </View>
                      </View>
                      <Text style={dataStyles.label}>Pix · {item.pix_key}</Text>
                      <Text style={styles.date}>{formatDate(item.created_at)}</Text>
                    </View>
                  ))}
                </DataCard>
              ) : (
                <View style={styles.pointsContent}>
                  <Text style={dataStyles.label}>Points são recompensas de participação. Este extrato não representa valores em reais.</Text>
                  <DataCard style={styles.pointsSummary}>
                    <View style={styles.pointsHeading}>
                      <DataIcon icon={Activity} />
                      <View style={styles.flexCopy}>
                        <Text style={styles.emptyTitle}>Points neste mês</Text>
                        <Text style={styles.pointsValue}>{formatPoints(Math.floor(stats.thisMonth))}</Text>
                      </View>
                    </View>
                    <View style={dataStyles.divider} />
                    <View style={[styles.pointsPeriods, compact && styles.stack]}>
                      <DataMetric label="Últimos 7 dias" value={formatPoints(Math.floor(stats.last7Days))} style={styles.period} />
                      <DataMetric label="Últimos 30 dias" value={formatPoints(Math.floor(stats.last30Days))} style={styles.period} />
                    </View>
                    <Text style={dataStyles.label}>Resumo dos últimos {rewardHistory.length} registros disponíveis.</Text>
                  </DataCard>
                  <DataCard style={styles.ledgerCard}>
                    {rewardHistory.length === 0 ? (
                      <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>Nenhum Point registrado</Text>
                        <Text style={dataStyles.label}>Suas recompensas de participação aparecerão aqui.</Text>
                      </View>
                    ) : rewardHistory.map((item, index) => (
                      <View key={item.id} style={[styles.ledgerItem, index < rewardHistory.length - 1 && styles.ledgerDivider]}>
                        <View style={[styles.ledgerHeading, compact && styles.stack]}>
                          <Text style={styles.rewardTitle}>{getActionLabel(item.action_key)}</Text>
                          <Text style={styles.rewardValue}>{Number(item.points || 0) > 0 ? '+' : ''}{Number(item.points || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Points</Text>
                        </View>
                        <Text style={styles.date}>{formatDate(item.created_at)}</Text>
                      </View>
                    ))}
                  </DataCard>
                </View>
              )}
            </DataSection>
          </>
        )}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  stateCard: { gap: spacing.md },
  balanceCard: { padding: spacing.xl, borderRadius: t.panelRadius, gap: spacing.md },
  balanceHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  balanceLabel: { color: t.secondary, fontSize: 14, fontWeight: '500', flex: 1 },
  currencyLabel: { color: t.muted, fontSize: 11, letterSpacing: 1, fontWeight: '600' },
  balanceValue: { color: t.ink, fontSize: 36, fontWeight: '600', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  balanceValueCompact: { fontSize: 30 },
  balanceDetails: { flexDirection: 'row', gap: spacing.md },
  balanceDetail: { flex: 1, minWidth: 0 },
  stack: { flexDirection: 'column', alignItems: 'stretch' },
  withdrawForm: { gap: spacing.lg, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
  formHeading: { gap: spacing.xs },
  formTitle: { color: t.ink, fontSize: 16, fontWeight: '600' },
  formGroup: { gap: spacing.sm },
  fieldLabel: { color: t.secondary, fontSize: 13, fontWeight: '500' },
  ledgerCard: { paddingVertical: 0 },
  ledgerItem: { paddingVertical: spacing.lg, gap: spacing.sm },
  ledgerDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
  ledgerHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  ledgerAmount: { color: t.ink, fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'], flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  statusText: { color: t.secondary, fontSize: 12, fontWeight: '500', flexShrink: 1 },
  rejected: { color: t.danger },
  date: { color: t.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  tabs: { flexDirection: 'row', borderRadius: t.controlRadius, padding: spacing.xs, backgroundColor: t.raised, gap: spacing.xs },
  tab: { flex: 1, minHeight: 44, borderRadius: t.controlRadius - 2, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  tabActive: { backgroundColor: t.strong },
  tabText: { color: t.muted, fontSize: 14, fontWeight: '500' },
  tabTextActive: { color: t.ink },
  emptyState: { paddingVertical: spacing.xl, gap: spacing.sm },
  emptyTitle: { color: t.ink, fontSize: 14, fontWeight: '500' },
  pointsContent: { gap: spacing.md },
  pointsSummary: { gap: spacing.lg },
  pointsHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flexCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  pointsValue: { color: t.ink, fontSize: 28, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pointsPeriods: { flexDirection: 'row', gap: spacing.lg },
  period: { flex: 1, minWidth: 0 },
  rewardTitle: { color: t.ink, fontSize: 14, fontWeight: '500', flex: 1, minWidth: 0 },
  rewardValue: { color: t.secondary, fontSize: 13, fontVariant: ['tabular-nums'], flexShrink: 1 },
});

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
  Calendar,
  ArrowLeft,
} from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export default function CarteiraScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
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
      const [walletRes, configRes, withdrawalsRes, rewardsRes] = await Promise.all([
        supabase.from('wallets').select('*').eq('user_id', user?.id).single(),
        supabase
          .from('platform_settings')
          .select('value')
          .eq('key', 'economic')
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
        if (economicSettings.minimum_withdrawal_amount) {
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
      console.error('Error fetching wallet data:', error);
      Alert.alert('Erro', 'Não foi possível carregar os dados da carteira.');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    setSubmitting(true);
    const amount = parseFloat(withdrawAmount);

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

    if (amount > wallet.balance) {
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
      const { error } = await supabase.from('withdraw_requests').insert({
        user_id: user?.id,
        wallet_id: wallet.id,
        amount,
        pix_key: pixKey.trim(),
        status: 'pending',
      });

      if (error) throw error;

      Alert.alert('Sucesso', 'Sua solicitação de saque foi enviada e está em análise!');
      setWithdrawAmount('');
      setPixKey('');
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
      case 'approved':
        return <CheckCircle size={14} color="#22c55e" />;
      case 'pending':
        return <Clock size={14} color="#eab308" />;
      case 'rejected':
        return <XCircle size={14} color="#ef4444" />;
      default:
        return <AlertCircle size={14} color={colors.muted} />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'approved':
        return 'Aprovado';
      case 'pending':
        return 'Pendente';
      case 'rejected':
        return 'Rejeitado';
      default:
        return status;
    }
  };

  const getActionLabel = (actionKey: string) => {
    const labels: Record<string, string> = {
      VIEW_15S: 'Visualização (15s)',
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

  return (
    <AppScreen edgeToEdge={true} scroll={false}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Carteira</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : (
          <>
            {/* Solicitar Saque Card */}
            <View style={styles.withdrawCard}>
              <View style={styles.withdrawHeader}>
                <View style={styles.withdrawTitleBlock}>
                  <Wallet size={20} color="#ef4444" style={{ marginRight: 8 }} />
                  <Text style={styles.withdrawTitle}>Solicitar Saque</Text>
                </View>
                <Text style={styles.withdrawMin}>Mínimo: R$ {minWithdrawalAmount.toFixed(2)}</Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Valor do Saque (R$)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0,00"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="numeric"
                  value={withdrawAmount}
                  onChangeText={setWithdrawAmount}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Chave PIX</Text>
                <TextInput
                  style={styles.input}
                  placeholder="CPF, E-mail ou Telefone"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={pixKey}
                  onChangeText={setPixKey}
                />
              </View>

              <Pressable
                onPress={handleWithdraw}
                disabled={submitting}
                style={[styles.withdrawBtn, submitting && styles.btnDisabled]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.withdrawBtnText}>Solicitar Saque</Text>
                )}
              </Pressable>
            </View>

            {/* Balances Row */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.balancesContainer}>
              <View style={[styles.balanceItem, { borderColor: 'rgba(34,197,94,0.3)' }]}>
                <Text style={styles.balanceLabel}>Saldo Disponível</Text>
                <Text style={[styles.balanceValue, { color: '#22c55e' }]}>
                  R$ {wallet?.balance?.toFixed(2) || '0.00'}
                </Text>
                <Text style={styles.balanceSub}>Para saque</Text>
              </View>

              <View style={[styles.balanceItem, { borderColor: 'rgba(234,179,8,0.3)' }]}>
                <Text style={[styles.balanceLabel, { color: '#eab308' }]}>Em Maturação</Text>
                <Text style={[styles.balanceValue, { color: '#eab308' }]}>
                  R$ {Number(wallet?.pending_balance || 0).toFixed(2)}
                </Text>
                <Text style={styles.balanceSub}>Sendo liberado</Text>
              </View>

              <View style={styles.balanceItem}>
                <Text style={styles.balanceLabel}>Total Ganho</Text>
                <Text style={styles.balanceValue}>
                  R$ {wallet?.total_earned?.toFixed(2) || '0.00'}
                </Text>
                <Text style={styles.balanceSub}>Acumulado</Text>
              </View>

              <View style={styles.balanceItem}>
                <Text style={styles.balanceLabel}>Total Sacado</Text>
                <Text style={styles.balanceValue}>
                  R$ {wallet?.total_withdrawn?.toFixed(2) || '0.00'}
                </Text>
                <Text style={styles.balanceSub}>Saques feitos</Text>
              </View>

              <View style={styles.balanceItem}>
                <Text style={styles.balanceLabel}>Este Mês</Text>
                <Text style={[styles.balanceValue, { color: colors.accent }]}>
                  {Math.floor(stats.thisMonth)} pts
                </Text>
                <Text style={styles.balanceSub}>Pontos de pool</Text>
              </View>
            </ScrollView>

            {/* Stats Cards */}
            <View style={styles.statsContainer}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Últimos 7 dias</Text>
                <Text style={styles.statValue}>{Math.floor(stats.last7Days)} pts</Text>
                <Text style={styles.statSub}>Na última semana</Text>
              </View>

              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Últimos 30 dias</Text>
                <Text style={styles.statValue}>{Math.floor(stats.last30Days)} pts</Text>
                <Text style={styles.statSub}>No último mês</Text>
              </View>
            </View>

            {/* History Tabs */}
            <View style={styles.tabsContainer}>
              <Pressable
                onPress={() => setActiveTab('saques')}
                style={[styles.tabBtn, activeTab === 'saques' && styles.tabBtnActive]}
              >
                <History size={16} color={activeTab === 'saques' ? colors.accent : colors.muted} style={{ marginRight: 6 }} />
                <Text style={[styles.tabText, activeTab === 'saques' && styles.tabTextActive]}>Saques</Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('ganhos')}
                style={[styles.tabBtn, activeTab === 'ganhos' && styles.tabBtnActive]}
              >
                <TrendingUp size={16} color={activeTab === 'ganhos' ? colors.accent : colors.muted} style={{ marginRight: 6 }} />
                <Text style={[styles.tabText, activeTab === 'ganhos' && styles.tabTextActive]}>Ganhos</Text>
              </Pressable>
            </View>

            {/* Tab Contents */}
            {activeTab === 'saques' ? (
              <View style={styles.listContainer}>
                {withdrawHistory.length === 0 ? (
                  <Text style={styles.emptyText}>Nenhuma solicitação de saque ainda</Text>
                ) : (
                  withdrawHistory.map((item) => (
                    <View key={item.id} style={styles.historyItem}>
                      <View style={styles.historyRow}>
                        <Text style={styles.historyAmount}>R$ {item.amount.toFixed(2)}</Text>
                        <View style={styles.statusBlock}>
                          {getStatusIcon(item.status)}
                          <Text style={[styles.statusText, { marginLeft: 4 }]}>
                            {getStatusText(item.status)}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.historyPix} numberOfLines={1}>PIX: {item.pix_key}</Text>
                      <Text style={styles.historyDate}>{formatDate(item.created_at)}</Text>
                    </View>
                  ))
                )}
              </View>
            ) : (
              <View style={styles.listContainer}>
                {rewardHistory.length === 0 ? (
                  <Text style={styles.emptyText}>Nenhum ganho registrado ainda</Text>
                ) : (
                  rewardHistory.map((item) => (
                    <View key={item.id} style={styles.earningItem}>
                      <View style={styles.earningLeft}>
                        <View style={styles.earningIconBg}>
                          <DollarSign size={14} color={colors.accent} />
                        </View>
                        <View style={styles.earningCopy}>
                          <Text style={styles.earningTitle} numberOfLines={1}>
                            {getActionLabel(item.action_key)}
                          </Text>
                          <Text style={styles.earningDate}>{formatDate(item.created_at)}</Text>
                        </View>
                      </View>
                      <View style={styles.earningRight}>
                        <Text style={styles.earningPoints}>+{Math.floor(item.performance_points || 0)} pts</Text>
                        <Text style={styles.earningXp}>{item.points} XP</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backBtn: {
    padding: spacing.xs,
  },
  headerTitle: {
    color: colors.text,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBlack,
  },
  scrollContainer: {
    padding: spacing.lg,
    paddingBottom: spacing.section * 2,
  },
  loader: {
    marginVertical: spacing.xxl,
    alignItems: 'center',
  },
  withdrawCard: {
    backgroundColor: '#18181b',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  withdrawHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  withdrawTitleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  withdrawTitle: {
    color: colors.text,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBlack,
  },
  withdrawMin: {
    color: colors.muted,
    fontSize: 12,
  },
  formGroup: {
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#27272a',
    borderRadius: radius.md,
    color: colors.text,
    fontSize: typography.bodySmall,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
  },
  withdrawBtn: {
    backgroundColor: '#ef4444',
    borderRadius: radius.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  withdrawBtnText: {
    color: '#fff',
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBlack,
  },
  balancesContainer: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
    paddingRight: spacing.lg,
  },
  balanceItem: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    minWidth: 130,
  },
  balanceLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  balanceValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: typography.weightBlack,
  },
  balanceSub: {
    color: colors.mutedDim,
    fontSize: 10,
    marginTop: 2,
  },
  statsContainer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  statValue: {
    color: colors.accent,
    fontSize: 22,
    fontWeight: typography.weightBlack,
  },
  statSub: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.md,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  tabText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  tabTextActive: {
    color: colors.accent,
  },
  listContainer: {
    gap: spacing.sm,
  },
  emptyText: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  historyItem: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyAmount: {
    color: colors.text,
    fontSize: 16,
    fontWeight: typography.weightBlack,
  },
  statusBlock: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  historyPix: {
    color: colors.muted,
    fontSize: 11,
  },
  historyDate: {
    color: colors.mutedDim,
    fontSize: 10,
  },
  earningItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  earningLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  earningIconBg: {
    padding: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginRight: spacing.md,
  },
  earningCopy: {
    flex: 1,
    minWidth: 0,
  },
  earningTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  earningDate: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  earningRight: {
    alignItems: 'flex-end',
    marginLeft: spacing.sm,
  },
  earningPoints: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: typography.weightBlack,
  },
  earningXp: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
});

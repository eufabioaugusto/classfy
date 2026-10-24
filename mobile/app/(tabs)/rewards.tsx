import React, { useState, useCallback } from 'react';
import { DeviceEventEmitter, Pressable, StyleSheet, Text, View, Image } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Award, Heart, Bookmark, MessageSquare, TrendingUp, Play, User, Video, Eye, BarChart3, BookOpen, Wallet, CalendarDays, LockKeyhole, Check, Users } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { HomeHeader } from '@/components/HomeHeader';
import { LoadingPlaceholder } from '@/components/LoadingPlaceholder';
import { DataAction, DataCard, DataIcon, DataMetric, DataRow, DataSection } from '@/components/data/DataUI';
import { REWARDS_CHANGED } from '@/features/rewards/events';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { dataStyles, dataTheme as t } from '@/theme/data';
import { spacing } from '@/theme/spacing';

interface LeaderboardEntry {
  user_id: string;
  cycle_points: number;
  display_name: string;
  avatar_url: string | null;
  rank?: number;
}

interface MilestoneWithProgress {
  id: string;
  milestone_type: 'contents' | 'followers' | 'earnings' | 'engagement' | 'views';
  milestone_value: number;
  points_reward: number;
  value_reward: number;
  badge_id: string | null;
  title: string;
  description: string | null;
  icon: string;
  percentComplete: number;
  isCompleted: boolean;
  isClaimed: boolean;
  currentValue: number;
}

interface RewardStats {
  level: number;
  totalPoints: number;
  pointsToNextLevel: number;
  progressPercent: number;
  balance: number;
  totalEarned: number;
  currentStreak: number;
  longestStreak: number;
  engagementStats: {
    likes: number;
    saves: number;
    comments: number;
    completedContents: number;
  };
  cyclePoints: number;
}

export default function RewardsScreen() {
  const { user, profile } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<RewardStats | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [userOutsideTop, setUserOutsideTop] = useState<LeaderboardEntry | null>(null);
  const [milestones, setMilestones] = useState<MilestoneWithProgress[]>([]);
  const [badgesTab, setBadgesTab] = useState<'unlocked' | 'locked'>('unlocked');

  useFocusEffect(useCallback(() => {
    if (user) void fetchData(); else setLoading(false);
    const subscription = DeviceEventEmitter.addListener(REWARDS_CHANGED, event => {
      if (event.userId === user?.id) void fetchData();
    });
    return () => subscription.remove();
  }, [user?.id]));

  const fetchData = async () => {
    try {
      setLoading(true);

      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // 1. Parallel Fetch basic stats
      const [rewardEventsRes, walletRes, streaksRes, cycleRes] = await Promise.all([
        supabase.from('reward_events').select('points, point_type, action_key').eq('user_id', user!.id),
        supabase.from('wallets').select('balance, total_earned').eq('user_id', user!.id).single(),
        supabase.from('user_login_streaks').select('current_streak, longest_streak').eq('user_id', user!.id).maybeSingle(),
        supabase.from('economic_cycles').select('id').eq('year_month', yearMonth).maybeSingle(),
      ]);

      const events = rewardEventsRes.data || [];
      const totalPoints = events.reduce((sum, e) => sum + (e.point_type === 'creator' ? 0 : Number(e.points || 0)), 0);

      // Level logic
      const getPointsForLevel = (n: number) => (500 * n * (n - 1)) / 2;
      let level = 1;
      while (getPointsForLevel(level + 1) <= totalPoints) {
        level++;
      }
      const pointsAtCurrentLevel = getPointsForLevel(level);
      const pointsAtNextLevel = getPointsForLevel(level + 1);
      const pointsNeededForNext = pointsAtNextLevel - pointsAtCurrentLevel;
      const pointsInCurrentLevel = totalPoints - pointsAtCurrentLevel;
      const pointsToNextLevel = Math.ceil(pointsNeededForNext - pointsInCurrentLevel);
      const progressPercent = Math.min((pointsInCurrentLevel / pointsNeededForNext) * 100, 100);

      const engagementStats = {
        likes: events.filter(e => e.action_key === 'LIKE').length,
        saves: events.filter(e => e.action_key === 'SAVE').length,
        comments: events.filter(e => e.action_key === 'COMMENT').length,
        completedContents: events.filter(e => e.action_key === 'WATCH_100').length,
      };

      let cyclePoints = 0;

      if (cycleRes.data) {
        const [userCycleRes, allUsersRes] = await Promise.all([
          supabase.from('economic_cycle_users').select('cycle_points').eq('cycle_id', cycleRes.data.id).eq('user_id', user!.id).maybeSingle(),
          supabase.from('economic_cycle_users').select('user_id, cycle_points').eq('cycle_id', cycleRes.data.id).order('cycle_points', { ascending: false }).limit(100),
        ]);

        cyclePoints = userCycleRes.data ? parseFloat(String(userCycleRes.data.cycle_points)) : 0;

        // Leaderboard calculation
        const cycleUsers = allUsersRes.data || [];
        if (cycleUsers.length > 0) {
          const userIds = cycleUsers.map(u => u.user_id);
          const { data: profiles } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', userIds);
          const profileMap = new Map((profiles || []).map(p => [p.id, p]));

          const leaderboard: LeaderboardEntry[] = cycleUsers.map(u => ({
            user_id: u.user_id,
            cycle_points: parseFloat(String(u.cycle_points)),
            display_name: profileMap.get(u.user_id)?.display_name || 'Usuário',
            avatar_url: profileMap.get(u.user_id)?.avatar_url || null,
          }));

          setLeaders(leaderboard);

          const allRanked = cycleUsers.map((u, idx) => ({ ...u, rank: idx + 1 }));
          const userEntry = allRanked.find(l => l.user_id === user!.id);
          setUserRank(userEntry ? userEntry.rank : null);

          if (userEntry && userEntry.rank > 10) {
            const profile = profileMap.get(user!.id);
            setUserOutsideTop({
              user_id: user!.id,
              cycle_points: parseFloat(String(userEntry.cycle_points)),
              display_name: profile?.display_name || 'Você',
              avatar_url: profile?.avatar_url || null,
              rank: userEntry.rank,
            });
          } else {
            setUserOutsideTop(null);
          }
        }
      }

      setStats({
        level,
        totalPoints,
        pointsToNextLevel,
        progressPercent,
        balance: walletRes.data?.balance || 0,
        totalEarned: walletRes.data?.total_earned || 0,
        currentStreak: streaksRes.data?.current_streak || 0,
        longestStreak: streaksRes.data?.longest_streak || 0,
        engagementStats,
        cyclePoints,
      });

      // 2. Fetch Creator Milestones / Achievements
      const [milestonesRes, progressRes, contentsCountRes, followersCountRes, contentsDataRes, likesDataRes] = await Promise.all([
        supabase.from('creator_milestones').select('*').eq('active', true).order('order_index'),
        supabase.from('creator_milestone_progress').select('*').eq('creator_id', user!.id),
        supabase.from('contents').select('*', { count: 'exact', head: true }).eq('creator_id', user!.id).eq('status', 'approved'),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', user!.id),
        supabase.from('contents').select('views_count').eq('creator_id', user!.id),
        supabase.from('contents').select('likes_count').eq('creator_id', user!.id),
      ]);

      const totalContents = contentsCountRes.count || 0;
      const totalFollowers = followersCountRes.count || 0;
      const totalViews = contentsDataRes.data?.reduce((sum, c) => sum + (c.views_count || 0), 0) || 0;
      const totalLikes = likesDataRes.data?.reduce((sum, c) => sum + (c.likes_count || 0), 0) || 0;
      const engagementRate = totalViews > 0 ? Math.round((totalLikes / totalViews) * 100) : 0;

      const mappedMilestones: MilestoneWithProgress[] = (milestonesRes.data || []).map((m) => {
        const progress = progressRes.data?.find(p => p.milestone_id === m.id) || null;
        let currentValue = 0;
        switch (m.milestone_type) {
          case 'contents':
            currentValue = totalContents;
            break;
          case 'followers':
            currentValue = totalFollowers;
            break;
          case 'earnings':
            currentValue = walletRes.data?.total_earned || 0;
            break;
          case 'views':
            currentValue = totalViews;
            break;
          case 'engagement':
            currentValue = engagementRate;
            break;
        }

        const percentComplete = Math.min(100, Math.round((currentValue / m.milestone_value) * 100));
        const isCompleted = currentValue >= m.milestone_value;
        const isClaimed = progress?.claimed || false;

        return {
          id: m.id,
          milestone_type: m.milestone_type,
          milestone_value: m.milestone_value,
          points_reward: m.points_reward,
          value_reward: m.value_reward,
          badge_id: m.badge_id,
          title: m.title,
          description: m.description,
          icon: m.icon || 'trophy',
          percentComplete,
          isCompleted,
          isClaimed,
          currentValue,
        };
      });

      setMilestones(mappedMilestones);

    } catch (e) {
      console.error('Error fetching rewards statistics data:', e);
    } finally {
      setLoading(false);
    }
  };

  const unlockedMilestones = milestones.filter(m => m.isClaimed);
  const lockedMilestones = milestones.filter(m => !m.isClaimed);
  const shownMilestones = badgesTab === 'unlocked' ? unlockedMilestones : lockedMilestones;
  const isCreator = profile?.creator_status === 'approved';
  const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const month = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const renderLeader = (entry: LeaderboardEntry, rank: number, last: boolean) => {
    const isCurrentUser = entry.user_id === user?.id;
    return (
      <View key={entry.user_id} style={[styles.leaderRow, !last && styles.rowDivider, isCurrentUser && styles.leaderRowCurrent]}>
        <Text style={[styles.rank, isCurrentUser && styles.activeText]}>{rank}</Text>
        <View style={styles.avatar}>
          {entry.avatar_url ? <Image source={{ uri: entry.avatar_url }} style={styles.avatarImage} /> : <User size={16} strokeWidth={t.stroke} color={t.muted} />}
        </View>
        <View style={styles.leaderCopy}>
          <Text style={styles.leaderName} numberOfLines={2}>{entry.display_name}</Text>
          {isCurrentUser ? <Text style={styles.youLabel}>Você</Text> : null}
        </View>
        <View style={styles.leaderPoints}>
          <Text style={styles.leaderValue}>{Math.floor(entry.cycle_points).toLocaleString('pt-BR')}</Text>
          <Text style={styles.smallLabel}>Points</Text>
        </View>
      </View>
    );
  };

  return (
    <AppScreen header={<HomeHeader />}>
      <View style={styles.page}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>Progresso</Text>
          <Text style={dataStyles.body}>Seu aprendizado, Points e conquistas.</Text>
        </View>
        {!user ? (
          <DataCard style={styles.emptyCard}>
            <DataIcon icon={TrendingUp} size={24} />
            <Text style={styles.cardTitle}>Acompanhe sua evolução</Text>
            <Text style={dataStyles.body}>Entre para visualizar seus estudos, conquistas e recompensas.</Text>
            <DataAction label="Entrar na Classfy" onPress={() => router.push('/auth/sign-in')} />
          </DataCard>
        ) : loading ? (
          <LoadingPlaceholder variant="dashboard" inset={false} />
        ) : stats ? (
          <>
            <DataCard style={styles.cycleCard}>
              <View style={styles.cardHeading}>
                <Text style={dataStyles.label}>Ciclo mensal</Text>
                <Text style={styles.month}>{month}</Text>
              </View>
              <DataMetric label="Seus Points neste ciclo" value={stats.cyclePoints.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} large />
              <Text style={dataStyles.label}>Sua participação no mês. O valor em reais é confirmado no fechamento do ciclo.</Text>
              <View style={styles.levelBlock}>
                <View style={styles.cardHeading}>
                  <Text style={styles.cardTitle}>Nível {stats.level}</Text>
                  <Text style={styles.accumulated}>{stats.totalPoints.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} Points acumulados</Text>
                </View>
                <View accessibilityRole="progressbar" accessibilityLabel={`Progresso para o nível ${stats.level + 1}`} accessibilityValue={{ min: 0, max: 100, now: Math.round(stats.progressPercent) }} style={styles.progressTrack}><View style={[styles.progressFill, { width: `${stats.progressPercent}%` }]} /></View>
                <Text style={dataStyles.label}>Faltam {stats.pointsToNextLevel.toLocaleString('pt-BR')} Points para o nível {stats.level + 1}.</Text>
              </View>
            </DataCard>

            <DataCard style={styles.shortcutCard}>
              <DataRow icon={BookOpen} title="Meu aprendizado" subtitle="Retome seus estudos e acompanhe suas conquistas" onPress={() => router.push('/profile-progress')} />
              <DataRow icon={Wallet} title="Minha carteira" subtitle={`Total gerado: ${money(stats.totalEarned)}`} value={<Text style={styles.balance}>{money(stats.balance)}</Text>} onPress={() => router.push('/carteira')} last />
            </DataCard>

            <DataSection title="Ranking do mês" subtitle="Points acumulados neste ciclo" action={userRank ? <Text style={styles.rankLabel}>Você: #{userRank}</Text> : undefined}>
              <DataCard style={styles.rankingCard}>
                {leaders.length > 0 ? leaders.slice(0, 5).map((entry, index, list) => renderLeader(entry, index + 1, index === list.length - 1 && !userOutsideTop)) : <Text style={styles.emptyText}>O ranking aparece quando o ciclo recebe as primeiras participações.</Text>}
                {userOutsideTop ? <><Text style={styles.rankingEllipsis}>···</Text>{renderLeader(userOutsideTop, userOutsideTop.rank!, true)}</> : null}
              </DataCard>
            </DataSection>

            <DataSection title="Sua constância">
              <DataCard style={styles.streakCard}>
                <View style={styles.metricsRow}>
                  <DataMetric label="Sequência atual" value={`${stats.currentStreak} dias`} style={styles.metric} />
                  <DataMetric label="Melhor sequência" value={`${stats.longestStreak} dias`} style={styles.metric} />
                </View>
                <View style={styles.streakFooter}>
                  <CalendarDays size={17} strokeWidth={t.stroke} color={t.muted} />
                  <Text style={styles.streakText}>Próxima recompensa em {Math.max(0, 7 - (stats.currentStreak % 7))} dias.</Text>
                </View>
              </DataCard>
            </DataSection>

            <DataSection title="Conquistas" subtitle={`${unlockedMilestones.length} de ${milestones.length} alcançadas`}>
              <View style={styles.tabs} accessibilityRole="tablist">
                {([{ key: 'unlocked', label: `Alcançadas (${unlockedMilestones.length})` }, { key: 'locked', label: `Em andamento (${lockedMilestones.length})` }] as const).map((tab) => (
                  <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: badgesTab === tab.key }} onPress={() => setBadgesTab(tab.key)} style={[styles.tab, badgesTab === tab.key && styles.tabActive]}>
                    <Text style={[styles.tabText, badgesTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
                  </Pressable>
                ))}
              </View>
              <DataCard style={styles.achievementsCard}>
                {shownMilestones.length === 0 ? <Text style={styles.emptyText}>{badgesTab === 'unlocked' ? 'Suas conquistas alcançadas aparecerão aqui.' : 'Todas as conquistas foram alcançadas.'}</Text> : shownMilestones.map((milestone, index) => (
                  <View key={milestone.id} style={[styles.achievementRow, index < shownMilestones.length - 1 && styles.rowDivider]}>
                    <DataIcon icon={milestone.isClaimed ? Award : LockKeyhole} />
                    <View style={styles.achievementCopy}>
                      <Text style={styles.cardTitle}>{milestone.title}</Text>
                      {milestone.description ? <Text style={dataStyles.label}>{milestone.description}</Text> : null}
                      <View style={styles.achievementStatus}>
                        {milestone.isClaimed ? <Check size={14} strokeWidth={t.stroke} color={t.secondary} /> : null}
                        <Text style={styles.smallLabel}>{milestone.isClaimed ? 'Meta atingida' : `${milestone.percentComplete}% da meta`}</Text>
                      </View>
                      {!milestone.isClaimed ? <View accessibilityRole="progressbar" accessibilityLabel={`Progresso de ${milestone.title}`} accessibilityValue={{ min: 0, max: 100, now: milestone.percentComplete }} style={styles.smallProgressTrack}><View style={[styles.progressFill, { width: `${milestone.percentComplete}%` }]} /></View> : null}
                    </View>
                  </View>
                ))}
              </DataCard>
            </DataSection>

            <DataSection title="Sua atividade">
              <DataCard style={styles.activityCard}>
                <DataRow icon={Heart} title="Curtidas" value={stats.engagementStats.likes.toLocaleString('pt-BR')} />
                <DataRow icon={Bookmark} title="Conteúdos salvos" value={stats.engagementStats.saves.toLocaleString('pt-BR')} />
                <DataRow icon={MessageSquare} title="Comentários" value={stats.engagementStats.comments.toLocaleString('pt-BR')} />
                <DataRow icon={Play} title="Conteúdos concluídos" value={stats.engagementStats.completedContents.toLocaleString('pt-BR')} last />
              </DataCard>
            </DataSection>
            {isCreator ? (
              <DataSection title="Como criador">
                <DataCard style={styles.activityCard}>
                  <DataRow icon={Video} title="Conteúdos" value={(milestones.find(m => m.milestone_type === 'contents')?.currentValue || 0).toLocaleString('pt-BR')} />
                  <DataRow icon={Eye} title="Visualizações" value={(milestones.find(m => m.milestone_type === 'views')?.currentValue || 0).toLocaleString('pt-BR')} />
                  <DataRow icon={Users} title="Seguidores" value={(milestones.find(m => m.milestone_type === 'followers')?.currentValue || 0).toLocaleString('pt-BR')} />
                  <DataRow icon={BarChart3} title="Engajamento" value={`${milestones.find(m => m.milestone_type === 'engagement')?.currentValue || 0}%`} last />
                </DataCard>
              </DataSection>
            ) : null}
          </>
        ) : (
          <DataCard><Text style={dataStyles.body}>Nenhum dado de recompensa disponível.</Text></DataCard>
        )}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing.xxl, paddingBottom: spacing.xxl },
  heading: { gap: spacing.sm, paddingTop: spacing.sm },
  title: { color: t.ink, fontSize: 28, fontWeight: '600', letterSpacing: -0.7 },
  cycleCard: { gap: spacing.lg },
  cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm },
  month: { color: t.secondary, fontSize: 12 },
  cardTitle: { color: t.ink, fontSize: 14, lineHeight: 20, fontWeight: '500', flexShrink: 1 },
  accumulated: { color: t.muted, fontSize: 12, fontVariant: ['tabular-nums'], flexShrink: 1 },
  levelBlock: { gap: spacing.md, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: t.strong, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: t.accent, borderRadius: 3 },
  shortcutCard: { paddingVertical: 0 },
  balance: { color: t.positive, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right', maxWidth: '45%' },
  rankingCard: { paddingVertical: 0, overflow: 'hidden' },
  rankLabel: { color: t.secondary, fontSize: 12, fontVariant: ['tabular-nums'], flexShrink: 1 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg, minHeight: 68 },
  leaderRowCurrent: { backgroundColor: t.raised },
  rank: { color: t.muted, minWidth: 20, textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
  activeText: { color: t.accent },
  avatar: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', backgroundColor: t.raised, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%' },
  leaderCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  leaderName: { color: t.ink, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  youLabel: { color: t.muted, fontSize: 11 },
  leaderPoints: { alignItems: 'flex-end', flexShrink: 1, maxWidth: '35%', minWidth: 0, gap: 2 },
  leaderValue: { color: t.ink, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'right' },
  smallLabel: { color: t.muted, fontSize: 12, lineHeight: 18 },
  rankingEllipsis: { color: t.subtle, textAlign: 'center', paddingVertical: spacing.sm },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  metric: { flex: 1, flexBasis: 108 },
  streakCard: { gap: spacing.lg },
  streakFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, paddingTop: spacing.lg },
  streakText: { color: t.muted, fontSize: 13, lineHeight: 19, flex: 1 },
  tabs: { flexDirection: 'row', gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs, paddingVertical: spacing.md, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: t.accent },
  tabText: { color: t.muted, fontSize: 13, lineHeight: 18, fontWeight: '500', textAlign: 'center' },
  tabTextActive: { color: t.ink },
  achievementsCard: { paddingVertical: 0 },
  achievementRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.lg },
  achievementCopy: { flex: 1, minWidth: 0, gap: spacing.sm },
  achievementStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  smallProgressTrack: { height: 4, borderRadius: 2, backgroundColor: t.strong, overflow: 'hidden' },
  activityCard: { paddingVertical: 0 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
  emptyCard: { gap: spacing.lg },
  emptyText: { color: t.muted, fontSize: 14, lineHeight: 21, paddingVertical: spacing.lg },
});

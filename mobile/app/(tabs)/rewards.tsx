import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Alert,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Trophy,
  Zap,
  Flame,
  Target,
  DollarSign,
  Award,
  Heart,
  Bookmark,
  MessageSquare,
  TrendingUp,
  AlertTriangle,
  Play,
  Crown,
  Medal,
  User,
  Star,
  Video,
  Eye,
  BarChart3,
  ChevronRight,
} from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { HomeHeader } from '@/components/HomeHeader';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface LeaderboardEntry {
  user_id: string;
  performance_points: number;
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
  performancePoints: number;
  estimatedPoolShare: number;
  prm: number;
  totalPP: number;
}

export default function RewardsScreen() {
  const { user, role } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<RewardStats | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [userOutsideTop, setUserOutsideTop] = useState<LeaderboardEntry | null>(null);
  const [milestones, setMilestones] = useState<MilestoneWithProgress[]>([]);
  const [badgesTab, setBadgesTab] = useState<'unlocked' | 'locked'>('unlocked');

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

      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // 1. Parallel Fetch basic stats
      const [rewardEventsRes, walletRes, streaksRes, platformSettingsRes, revenueRes, cycleRes] = await Promise.all([
        supabase.from('reward_events').select('points, action_key').eq('user_id', user!.id),
        supabase.from('wallets').select('balance, total_earned').eq('user_id', user!.id).single(),
        supabase.from('user_login_streaks').select('current_streak, longest_streak').eq('user_id', user!.id).maybeSingle(),
        supabase.from('platform_settings').select('value').eq('key', 'economic').single(),
        supabase.from('revenue_entries').select('amount').eq('year_month', yearMonth),
        supabase.from('economic_cycles').select('id').eq('year_month', yearMonth).maybeSingle(),
      ]);

      const events = rewardEventsRes.data || [];
      const totalPoints = events.reduce((sum, e) => sum + (e.points || 0), 0);

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
        likes: events.filter(e => e.action_key === 'LIKE_CONTENT').length,
        saves: events.filter(e => e.action_key === 'SAVE_CONTENT').length,
        comments: events.filter(e => e.action_key === 'COMMENT_CONTENT').length,
        completedContents: events.filter(e => e.action_key === 'WATCH_100').length,
      };

      // Pool calculation
      let poolPct = 40;
      if (platformSettingsRes.data?.value) {
        poolPct = (platformSettingsRes.data.value as any).pool_percentage || 40;
      }
      const currentRbm = revenueRes.data?.reduce((sum, e) => sum + parseFloat(String(e.amount)), 0) || 0;
      const prm = currentRbm * (poolPct / 100);

      let performancePoints = 0;
      let totalPP = 0;
      let estimatedPoolShare = 0;

      if (cycleRes.data) {
        const [userCycleRes, allUsersRes, cycleUsersRes] = await Promise.all([
          supabase.from('economic_cycle_users').select('performance_points').eq('cycle_id', cycleRes.data.id).eq('user_id', user!.id).maybeSingle(),
          supabase.from('economic_cycle_users').select('user_id, performance_points').eq('cycle_id', cycleRes.data.id).order('performance_points', { ascending: false }).limit(100),
          supabase.from('economic_cycle_users').select('performance_points').eq('cycle_id', cycleRes.data.id),
        ]);

        performancePoints = userCycleRes.data ? parseFloat(String(userCycleRes.data.performance_points)) : 0;
        totalPP = cycleUsersRes.data?.reduce((sum, u) => sum + parseFloat(String(u.performance_points)), 0) || 0;
        estimatedPoolShare = totalPP > 0 ? (performancePoints / totalPP) * prm : 0;

        // Leaderboard calculation
        const cycleUsers = allUsersRes.data || [];
        if (cycleUsers.length > 0) {
          const userIds = cycleUsers.map(u => u.user_id);
          const { data: profiles } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', userIds);
          const profileMap = new Map((profiles || []).map(p => [p.id, p]));

          const leaderboard: LeaderboardEntry[] = cycleUsers.map(u => ({
            user_id: u.user_id,
            performance_points: parseFloat(String(u.performance_points)),
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
              performance_points: parseFloat(String(userEntry.performance_points)),
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
        performancePoints,
        estimatedPoolShare,
        prm,
        totalPP,
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

  const getRankIcon = (index: number) => {
    if (index === 0) return <Crown size={16} color={colors.accent} />;
    if (index === 1) return <Medal size={16} color={colors.muted} />;
    if (index === 2) return <Medal size={16} color="#c5a059" />;
    return <Text style={styles.rankNum}>{index + 1}</Text>;
  };

  const unlockedMilestones = milestones.filter(m => m.isClaimed);
  const lockedMilestones = milestones.filter(m => !m.isClaimed);
  const isCreator = role === 'creator' || role === 'admin';

  return (
    <AppScreen>
      <HomeHeader />
      {/* Title Section */}
      <View style={styles.welcomeBlock}>
        <Text style={styles.kicker}>Classfy Diferencial</Text>
        <Text style={styles.welcomeTitle}>Minhas Recompensas</Text>
        <Text style={styles.welcomeSubtitle}>
          Acompanhe seu nível de engajamento, conquistas de XP e saldo econômico.
        </Text>
      </View>

      {user ? (
          loading ? (
            <View style={styles.loadingWrapper}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : stats ? (
            <>
              {/* Pool Est Share + performance points */}
              <View style={styles.poolCard}>
                <View style={styles.poolHeader}>
                  <Zap size={16} color={colors.accent} />
                  <Text style={styles.poolLabel}>Pool de Participação Mensal</Text>
                </View>
                <Text style={styles.poolShare}>
                  R$ {stats.estimatedPoolShare.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
                <Text style={styles.poolDescription}>
                  Sua fatia estimada do faturamento da plataforma com base em {stats.performancePoints.toFixed(1)} PP acumulados neste mês.
                </Text>
              </View>

              {/* Monthly Leaderboard / Ranking Section */}
              <View style={styles.metricCard}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.cardHeaderLeft}>
                    <Trophy size={18} color={colors.accent} style={{ marginRight: 8 }} />
                    <Text style={styles.cardTitle}>Ranking Mensal</Text>
                  </View>
                  {userRank && (
                    <View style={styles.userRankBadge}>
                      <Text style={styles.userRankText}>Você: #{userRank}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.leadersList}>
                  {leaders.slice(0, 5).map((entry, index) => {
                    const isCurrentUser = entry.user_id === user.id;
                    return (
                      <View
                        key={entry.user_id}
                        style={[styles.leaderRow, isCurrentUser && styles.leaderRowCurrent]}
                      >
                        <View style={styles.leaderLeft}>
                          <View style={styles.rankIconBg}>{getRankIcon(index)}</View>
                          <View style={styles.leaderAvatar}>
                            {entry.avatar_url ? (
                              <Image source={{ uri: entry.avatar_url }} style={styles.avatarImg} />
                            ) : (
                              <User size={14} color={colors.muted} />
                            )}
                          </View>
                          <Text
                            numberOfLines={1}
                            style={[styles.leaderName, isCurrentUser && styles.leaderNameCurrent]}
                          >
                            {entry.display_name}
                            {isCurrentUser && ' (você)'}
                          </Text>
                        </View>
                        <View style={styles.leaderRight}>
                          <Text style={styles.leaderPoints}>{Math.floor(entry.performance_points)}</Text>
                          <Text style={styles.leaderPointsUnit}>pts</Text>
                        </View>
                      </View>
                    );
                  })}

                  {userOutsideTop && (
                    <>
                      <Text style={styles.dividerText}>•••</Text>
                      <View style={[styles.leaderRow, styles.leaderRowCurrent]}>
                        <View style={styles.leaderLeft}>
                          <View style={styles.rankIconBg}>
                            <Text style={styles.rankNumActive}>{userOutsideTop.rank}</Text>
                          </View>
                          <View style={styles.leaderAvatar}>
                            {userOutsideTop.avatar_url ? (
                              <Image source={{ uri: userOutsideTop.avatar_url }} style={styles.avatarImg} />
                            ) : (
                              <User size={14} color={colors.muted} />
                            )}
                          </View>
                          <Text numberOfLines={1} style={[styles.leaderName, styles.leaderNameCurrent]}>
                            {userOutsideTop.display_name} (você)
                          </Text>
                        </View>
                        <View style={styles.leaderRight}>
                          <Text style={styles.leaderPoints}>{Math.floor(userOutsideTop.performance_points)}</Text>
                          <Text style={styles.leaderPointsUnit}>pts</Text>
                        </View>
                      </View>
                    </>
                  )}
                </View>
              </View>

              {/* Level & XP progression */}
              <View style={styles.metricCard}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.cardHeaderLeft}>
                    <Trophy size={18} color={colors.accent} style={{ marginRight: 8 }} />
                    <Text style={styles.cardTitle}>Nível {stats.level}</Text>
                  </View>
                  <Text style={styles.xpLabel}>
                    {stats.totalPoints.toLocaleString()} XP Total
                  </Text>
                </View>

                <View style={styles.xpProgressBg}>
                  <View style={[styles.xpProgressFill, { width: `${stats.progressPercent}%` }]} />
                </View>
                <Text style={styles.xpSubtext}>
                  Faltam {stats.pointsToNextLevel.toLocaleString('pt-BR')} XP para o Nível {stats.level + 1}
                </Text>
              </View>

              {/* Cash Available & Lifetime balance */}
              <Pressable style={styles.balanceCard} onPress={() => router.push('/carteira')}>
                <View style={styles.balanceHeader}>
                  <View>
                    <Text style={styles.balanceTitle}>Saldo Disponível</Text>
                    <Text style={styles.balanceAmount}>
                      R$ {stats.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <ChevronRight size={20} color="#22c55e" />
                </View>
                <View style={styles.balanceFooter}>
                  <Text style={styles.lifetimeText}>Total ganho acumulado:</Text>
                  <Text style={styles.lifetimeAmount}>
                    R$ {stats.totalEarned.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              </Pressable>

              {/* Streak Card */}
              <View style={styles.metricCard}>
                <View style={styles.streakHeader}>
                  <Flame size={18} color="#f97316" style={{ marginRight: 8 }} />
                  <Text style={styles.cardTitle}>Sequência de Login</Text>
                </View>
                <View style={styles.streakGrid}>
                  <View style={styles.streakCol}>
                    <Text style={styles.streakVal}>{stats.currentStreak} dias</Text>
                    <Text style={styles.streakLbl}>Sequência Atual</Text>
                  </View>
                  <View style={styles.streakCol}>
                    <Text style={styles.streakVal}>{stats.longestStreak} dias</Text>
                    <Text style={styles.streakLbl}>Melhor Sequência</Text>
                  </View>
                </View>
                <View style={styles.streakReminder}>
                  <Target size={14} color="#f97316" style={{ marginRight: 6 }} />
                  <Text style={styles.streakReminderText}>
                    Próxima recompensa em <Text style={{ fontWeight: 'bold' }}>{Math.max(0, 7 - (stats.currentStreak % 7))} dias</Text>
                  </Text>
                </View>
              </View>

              {/* Badges / Conquistas Card */}
              <View style={styles.metricCard}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.cardHeaderLeft}>
                    <Award size={18} color={colors.accent} style={{ marginRight: 8 }} />
                    <Text style={styles.cardTitle}>Conquistas</Text>
                  </View>
                </View>

                {/* Sub Tabs unlocked vs locked */}
                <View style={styles.badgesTabRow}>
                  <Pressable
                    onPress={() => setBadgesTab('unlocked')}
                    style={[styles.badgeTabBtn, badgesTab === 'unlocked' && styles.badgeTabBtnActive]}
                  >
                    <Text style={[styles.badgeTabText, badgesTab === 'unlocked' && styles.badgeTabTextActive]}>
                      Desbloqueadas ({unlockedMilestones.length})
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setBadgesTab('locked')}
                    style={[styles.badgeTabBtn, badgesTab === 'locked' && styles.badgeTabBtnActive]}
                  >
                    <Text style={[styles.badgeTabText, badgesTab === 'locked' && styles.badgeTabTextActive]}>
                      Bloqueadas ({lockedMilestones.length})
                    </Text>
                  </Pressable>
                </View>

                {/* Grid list of badges */}
                <View style={styles.badgesGrid}>
                  {badgesTab === 'unlocked' ? (
                    unlockedMilestones.length === 0 ? (
                      <Text style={styles.emptyBadgesText}>Nenhuma conquista desbloqueada ainda</Text>
                    ) : (
                      unlockedMilestones.map((m) => (
                        <View key={m.id} style={styles.badgeItem}>
                          <View style={styles.badgeIconBg}>
                            <Award size={24} color={colors.accent} />
                          </View>
                          <Text style={styles.badgeLabel} numberOfLines={1}>{m.title}</Text>
                          <Text style={styles.badgeValueText}>Meta atingida</Text>
                        </View>
                      ))
                    )
                  ) : (
                    lockedMilestones.length === 0 ? (
                      <Text style={styles.emptyBadgesText}>Todas as conquistas foram desbloqueadas!</Text>
                    ) : (
                      lockedMilestones.slice(0, 8).map((m) => (
                        <View key={m.id} style={[styles.badgeItem, styles.badgeItemLocked]}>
                          <View style={styles.badgeIconBgLocked}>
                            <Award size={24} color={colors.mutedDim} />
                          </View>
                          <Text style={styles.badgeLabelLocked} numberOfLines={1}>{m.title}</Text>
                          <Text style={styles.badgeValueTextLocked}>{m.percentComplete}%</Text>
                        </View>
                      ))
                    )
                  )}
                </View>
              </View>

              {/* Engagement Stats Grid */}
              <View style={styles.engagementSection}>
                <Text style={styles.engagementTitle}>Engajamento e Atividade</Text>
                <View style={styles.gridContainer}>
                  <View style={styles.gridItem}>
                    <Heart size={16} color="#ec4899" style={{ marginBottom: 6 }} />
                    <Text style={styles.gridValText}>{stats.engagementStats.likes}</Text>
                    <Text style={styles.gridLabelText}>Curtidas</Text>
                  </View>
                  <View style={styles.gridItem}>
                    <Bookmark size={16} color="#3b82f6" style={{ marginBottom: 6 }} />
                    <Text style={styles.gridValText}>{stats.engagementStats.saves}</Text>
                    <Text style={styles.gridLabelText}>Salvos</Text>
                  </View>
                  <View style={styles.gridItem}>
                    <MessageSquare size={16} color="#a855f7" style={{ marginBottom: 6 }} />
                    <Text style={styles.gridValText}>{stats.engagementStats.comments}</Text>
                    <Text style={styles.gridLabelText}>Comentários</Text>
                  </View>
                  <View style={styles.gridItem}>
                    <Play size={16} color="#22c55e" style={{ marginBottom: 6 }} />
                    <Text style={styles.gridValText}>{stats.engagementStats.completedContents}</Text>
                    <Text style={styles.gridLabelText}>Aulas 100%</Text>
                  </View>
                </View>
              </View>

              {/* Creator Section */}
              {isCreator && (
                <View style={styles.engagementSection}>
                  <Text style={styles.engagementTitle}>Dados do Criador</Text>
                  <View style={styles.gridContainer}>
                    <View style={styles.gridItem}>
                      <Video size={16} color={colors.accent} style={{ marginBottom: 6 }} />
                      <Text style={styles.gridValText}>{milestones.find(m => m.milestone_type === 'contents')?.currentValue || 0}</Text>
                      <Text style={styles.gridLabelText}>Conteúdos</Text>
                    </View>
                    <View style={styles.gridItem}>
                      <Eye size={16} color={colors.textSecondary} style={{ marginBottom: 6 }} />
                      <Text style={styles.gridValText}>{milestones.find(m => m.milestone_type === 'views')?.currentValue || 0}</Text>
                      <Text style={styles.gridLabelText}>Visualizações</Text>
                    </View>
                    <View style={styles.gridItem}>
                      <Star size={16} color="#eab308" style={{ marginBottom: 6 }} />
                      <Text style={styles.gridValText}>{milestones.find(m => m.milestone_type === 'followers')?.currentValue || 0}</Text>
                      <Text style={styles.gridLabelText}>Seguidores</Text>
                    </View>
                    <View style={styles.gridItem}>
                      <BarChart3 size={16} color="#06b6d4" style={{ marginBottom: 6 }} />
                      <Text style={styles.gridValText}>{milestones.find(m => m.milestone_type === 'engagement')?.currentValue || 0}%</Text>
                      <Text style={styles.gridLabelText}>Engajamento</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* History Button CTA */}
              <Pressable
                style={({ pressed }) => [
                  styles.historyBtn,
                  pressed && styles.historyBtnPressed
                ]}
                onPress={() => router.push('/carteira')}
              >
                <Award size={16} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.historyBtnText}>Ir para Minha Carteira</Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Nenhum dado de recompensa disponível.</Text>
            </View>
          )
        ) : (
          // Auth Notice
          <View style={styles.authNotice}>
            <AlertTriangle size={32} color={colors.accent} style={{ marginBottom: spacing.sm }} />
            <Text style={styles.authNoticeTitle}>Recompensas Bloqueadas</Text>
            <Text style={styles.authNoticeBody}>
              Faça login no aplicativo para visualizar seu nível de engajamento, login streaks e saldo da carteira econômica.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.authBtnBanner, pressed && styles.authBtnPressed]}
              onPress={() => router.push('/auth/sign-in')}
            >
              <Text style={styles.authBtnText}>Fazer Login</Text>
            </Pressable>
          </View>
        )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
  },
  welcomeBlock: {
    marginVertical: spacing.md,
  },
  kicker: {
    color: colors.lime,
    fontSize: 11,
    fontWeight: typography.weightBold,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  welcomeTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: typography.weightBold,
    marginBottom: 6,
  },
  welcomeSubtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  loadingWrapper: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  poolCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    borderColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  poolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 6,
  },
  poolLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weightBold,
    textTransform: 'uppercase',
  },
  poolShare: {
    color: colors.text,
    fontSize: 32,
    fontWeight: typography.weightBold,
    marginBottom: 4,
  },
  poolDescription: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  metricCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weightBold,
  },
  xpLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: typography.weightBold,
  },
  xpProgressBg: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radius.pill,
    height: 8,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  xpProgressFill: {
    backgroundColor: colors.accent,
    height: '100%',
  },
  xpSubtext: {
    color: colors.muted,
    fontSize: 11,
  },
  balanceCard: {
    backgroundColor: 'rgba(34, 197, 94, 0.05)',
    borderColor: 'rgba(34, 197, 94, 0.15)',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  balanceTitle: {
    color: colors.muted,
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: typography.weightBold,
  },
  balanceAmount: {
    color: '#22c55e',
    fontSize: 28,
    fontWeight: typography.weightBold,
    marginTop: 2,
  },
  balanceFooter: {
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  lifetimeText: {
    color: colors.muted,
    fontSize: 11,
  },
  lifetimeAmount: {
    color: colors.text,
    fontSize: 11,
    fontWeight: typography.weightBold,
  },
  streakHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  streakGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  streakCol: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  streakVal: {
    color: '#f97316',
    fontSize: 16,
    fontWeight: typography.weightBold,
    marginBottom: 2,
  },
  streakLbl: {
    color: colors.muted,
    fontSize: 10,
  },
  streakReminder: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    borderColor: 'rgba(249, 115, 22, 0.18)',
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  streakReminderText: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  engagementSection: {
    marginVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  engagementTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weightBold,
    marginBottom: spacing.md,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minWidth: '44%',
    padding: spacing.md,
  },
  gridValText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: typography.weightBold,
    marginBottom: 2,
  },
  gridLabelText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: typography.weightMedium,
  },
  historyBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    marginBottom: spacing.xxl * 1.5,
  },
  historyBtnPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  historyBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  emptyCard: {
    padding: spacing.xxl,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
  },
  authNotice: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    marginTop: spacing.xl,
  },
  authNoticeTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weightBold,
    marginBottom: spacing.xs,
  },
  authNoticeBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  authBtnBanner: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  authBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  authBtnPressed: {
    opacity: 0.8,
  },
  userRankBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  userRankText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: 'bold',
  },
  leadersList: {
    gap: spacing.xs,
  },
  leaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  leaderRowCurrent: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: colors.accent,
    borderWidth: 1,
  },
  leaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  rankIconBg: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankNum: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: 'bold',
  },
  rankNumActive: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: 'bold',
  },
  leaderAvatar: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.sm,
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  leaderName: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
  },
  leaderNameCurrent: {
    color: colors.accent,
  },
  leaderRight: {
    alignItems: 'flex-end',
  },
  leaderPoints: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  leaderPointsUnit: {
    color: colors.muted,
    fontSize: 9,
  },
  dividerText: {
    color: colors.mutedDim,
    textAlign: 'center',
    marginVertical: spacing.xs,
    fontSize: 12,
  },
  badgesTabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    marginBottom: spacing.md,
  },
  badgeTabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  badgeTabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  badgeTabText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  badgeTabTextActive: {
    color: colors.accent,
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'flex-start',
  },
  badgeItem: {
    width: '28%',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  badgeItemLocked: {
    opacity: 0.5,
  },
  badgeIconBg: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  badgeIconBgLocked: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  badgeLabel: {
    color: colors.text,
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  badgeLabelLocked: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  badgeValueText: {
    color: '#22c55e',
    fontSize: 9,
    marginTop: 2,
  },
  badgeValueTextLocked: {
    color: colors.mutedDim,
    fontSize: 9,
    marginTop: 2,
  },
  emptyBadgesText: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    width: '100%',
    paddingVertical: spacing.md,
  },
});

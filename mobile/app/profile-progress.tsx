import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Settings as GearIcon, BookOpen, Play, Users, DollarSign, Eye, Award, Heart, Bookmark, Clock, TrendingUp, Check, LockKeyhole, ChevronRight } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { LoadingPlaceholder } from '@/components/LoadingPlaceholder';
import { NavigationHeader } from '@/components/NavigationHeader';
import { PlanCrown } from '@/components/PlanCrown';
import { DataAction, DataCard, DataIcon, DataMetric, DataRow, DataSection } from '@/components/data/DataUI';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { dataStyles, dataTheme as t } from '@/theme/data';
import { spacing } from '@/theme/spacing';

interface BadgeData {
  id: string;
  name: string;
  description: string;
  milestone_type: 'contents' | 'followers' | 'earnings' | 'views' | 'engagement';
  milestone_value: number;
  earned_at: string | null;
}

interface CreatorStats {
  totalContents: number;
  totalFollowers: number;
  totalEarnings: number;
  totalViews: number;
  engagementRate: number;
}

interface StudyProgressItem {
  content_id: string;
  progress_percent: number;
  contents: {
    id: string;
    title: string;
    thumbnail_url: string | null;
    content_type: string | null;
    profiles: {
      display_name: string | null;
      creator_channel_name: string | null;
    } | null;
  } | null;
}

function milestoneIcon(type: string) {
  switch (type) {
    case 'contents': return Play;
    case 'followers': return Users;
    case 'earnings': return DollarSign;
    case 'views': return Eye;
    case 'engagement': return TrendingUp;
    default: return Award;
  }
}

export default function ProfileScreen() {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [loadingData, setLoadingData] = useState(true);
  const [achievementTab, setAchievementTab] = useState<'progress' | 'earned'>('progress');
  const [level, setLevel] = useState(1);
  const [totalPoints, setTotalPoints] = useState(0);
  const [badges, setBadges] = useState<BadgeData[]>([]);
  const [progressItems, setProgressItems] = useState<StudyProgressItem[]>([]);

  // Real-time creator statistics to show progress (FOMO)
  const [stats, setStats] = useState<CreatorStats>({
    totalContents: 0,
    totalFollowers: 0,
    totalEarnings: 0,
    totalViews: 0,
    engagementRate: 0
  });

  useEffect(() => {
    if (user) {
      fetchUserData();
    } else {
      setLoadingData(false);
    }
  }, [user, profile]);

  const fetchUserData = async () => {
    try {
      setLoadingData(true);

      // 1. Fetch points from reward_events
      const { data: eventsData } = await supabase
        .from('reward_events')
        .select('points, point_type')
        .eq('user_id', user!.id);

      const points = Math.round(eventsData?.reduce(
        (sum, e) => sum + (e.point_type === 'creator' ? 0 : Number(e.points || 0)),
        0,
      ) || 0);
      setTotalPoints(points);

      // 2. Fetch Creator Stats for FOMO progress trackers
      const [contentsCountRes, followersCountRes, contentsDataRes, walletDataRes, likesDataRes] = await Promise.all([
        supabase.from('contents').select('*', { count: 'exact', head: true }).eq('creator_id', user!.id).eq('status', 'approved'),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', user!.id),
        supabase.from('contents').select('views_count').eq('creator_id', user!.id),
        supabase.from('wallets').select('total_earned').eq('user_id', user!.id).maybeSingle(),
        supabase.from('contents').select('likes_count').eq('creator_id', user!.id),
      ]);

      const totalViews = contentsDataRes.data?.reduce((sum, c) => sum + (c.views_count || 0), 0) || 0;
      const totalLikes = likesDataRes.data?.reduce((sum, c) => sum + (c.likes_count || 0), 0) || 0;
      const engagementRate = totalViews > 0 ? Math.round((totalLikes / totalViews) * 100) : 0;

      const currentStats: CreatorStats = {
        totalContents: contentsCountRes.count || 0,
        totalFollowers: followersCountRes.count || 0,
        totalEarnings: walletDataRes.data?.total_earned || 0,
        totalViews,
        engagementRate
      };
      setStats(currentStats);

      // Calculate level using cumulative progressive curve to match web stats
      const getPointsForLevel = (n: number) => 500 * n * (n - 1) / 2;
      let calculatedLevel = 1;
      while (getPointsForLevel(calculatedLevel + 1) <= points) {
        calculatedLevel++;
      }
      setLevel(calculatedLevel);

      // 3. Fetch Creator Milestones (Achievements parity with Web)
      const [milestonesRes, progressRes] = await Promise.all([
        supabase.from('creator_milestones').select('*').eq('active', true).order('order_index'),
        supabase.from('creator_milestone_progress').select('milestone_id, claimed').eq('creator_id', user!.id),
      ]);

      if (milestonesRes.data) {
        const progressMap = new Map(
          (progressRes.data || []).map((p) => [p.milestone_id, p.claimed])
        );

        // Map and deduplicate milestones by Title to resolve double entry DB issues,
        // prioritizing claimed ones when duplicates exist.
        const badgeMap = new Map<string, BadgeData>();

        milestonesRes.data.forEach((m) => {
          const isClaimed = progressMap.get(m.id) || false;
          const existing = badgeMap.get(m.title);

          if (!existing || (isClaimed && !existing.earned_at)) {
            badgeMap.set(m.title, {
              id: m.id,
              name: m.title,
              description: m.description || '',
              milestone_type: m.milestone_type as any,
              milestone_value: m.milestone_value,
              earned_at: isClaimed ? 'earned' : null,
            });
          }
        });

        setBadges(Array.from(badgeMap.values()));
      }

      // 4. Fetch study progress history
      const { data: progressData } = await supabase
        .from('user_progress')
        .select(`
          content_id,
          progress_percent,
          contents:content_id (
            id,
            title,
            thumbnail_url,
            content_type,
            profiles:creator_id (
              display_name,
              creator_channel_name
            )
          )
        `)
        .eq('user_id', user!.id)
        .gt('progress_percent', 0)
        .order('updated_at', { ascending: false })
        .limit(6);

      if (progressData) {
        setProgressItems(progressData as any);
      }
    } catch (e) {
      console.error('Error fetching dashboard profile info:', e);
    } finally {
      setLoadingData(false);
    }
  };

  const getPointsForLevel = (n: number) => (500 * n * (n - 1)) / 2;
  const pointsAtCurrentLevel = getPointsForLevel(level);
  const pointsAtNextLevel = getPointsForLevel(level + 1);
  const pointsNeededForNext = pointsAtNextLevel - pointsAtCurrentLevel;
  const pointsInCurrentLevel = Math.max(0, totalPoints - pointsAtCurrentLevel);

  const progressPercent = Math.min(100, Math.max(0, (pointsInCurrentLevel / pointsNeededForNext) * 100));
  const pointsToNextLevel = Math.max(0, Math.round(pointsNeededForNext - pointsInCurrentLevel));
  const unlockedBadgesCount = badges.filter((b) => b.earned_at !== null).length;

  // Retrieve current user score for the specific milestone type (for FOMO)
  const getMilestoneCurrentValue = (type: string) => {
    switch (type) {
      case 'contents':
        return stats.totalContents;
      case 'followers':
        return stats.totalFollowers;
      case 'earnings':
        return stats.totalEarnings;
      case 'views':
        return stats.totalViews;
      case 'engagement':
        return stats.engagementRate;
      default:
        return 0;
    }
  };

  const visibleBadges = badges.filter((badge) => achievementTab === 'earned' ? badge.earned_at !== null : badge.earned_at === null);
  const plan = profile?.plan === 'premium' || profile?.plan === 'pro' ? profile.plan : null;

  return (
    <AppScreen edgeToEdge scroll={false}>
      <NavigationHeader title="Meu aprendizado" back />
      {!user ? (
        <View style={styles.authContainer}>
          <DataIcon icon={BookOpen} size={24} />
          <Text style={styles.authTitle}>Seu aprendizado, em um lugar</Text>
          <Text style={styles.authSubtitle}>Entre para acompanhar seus estudos, nível e conquistas.</Text>
          <DataAction label="Entrar ou criar conta" onPress={() => router.push('/auth/sign-in')} />
        </View>
      ) : loadingData || authLoading ? (
        <LoadingPlaceholder variant="dashboard" />
      ) : (
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.accountSection}>
          <View style={styles.userHeader}>
            <View style={styles.avatarContainer}>
              {profile?.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{profile?.display_name?.[0]?.toUpperCase() || 'C'}</Text>}
            </View>
            <View style={styles.userMeta}>
              <View style={styles.nameRow}>
                <Text style={styles.displayName}>{profile?.display_name || 'Conta Classfy'}</Text>
                <View style={styles.planBadge}>
                  {plan ? <PlanCrown plan={plan} size={12} /> : null}
                  <Text style={styles.planText}>{plan === 'premium' ? 'Premium' : plan === 'pro' ? 'Pro' : 'Free'}</Text>
                </View>
              </View>
              {profile?.creator_channel_name ? <Text style={dataStyles.label}>@{profile.creator_channel_name}</Text> : null}
            </View>
          </View>
          {profile?.bio ? <Text style={styles.bioText}>{profile.bio}</Text> : null}
          <View style={styles.profileActions}>
            <DataAction label="Editar perfil" variant="quiet" onPress={() => router.push('/edit-profile')} />
            <Pressable accessibilityRole="button" accessibilityLabel="Configurações" onPress={() => router.push('/settings')} style={styles.settingsAction}>
              <GearIcon size={20} strokeWidth={t.stroke} color={t.secondary} />
            </Pressable>
          </View>
          </View>

          <DataCard style={styles.levelCard}>
            <View style={styles.levelHeading}>
              <DataMetric label="Seu nível" value={String(level)} large />
              <View style={styles.pointsMeta}>
                <Text style={styles.pointsTotal}>{totalPoints.toLocaleString('pt-BR')}</Text>
                <Text style={dataStyles.label}>Points acumulados</Text>
              </View>
            </View>
            <View accessibilityRole="progressbar" accessibilityLabel={`Progresso para o nível ${level + 1}`} accessibilityValue={{ min: 0, max: 100, now: Math.round(progressPercent) }} style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
            <Text style={dataStyles.label}>Faltam {pointsToNextLevel.toLocaleString('pt-BR')} Points para o nível {level + 1}.</Text>
          </DataCard>

          <DataSection title="Continue aprendendo" action={progressItems.length > 0 ? <DataAction label="Ver tudo" variant="quiet" onPress={() => router.push('/study')} /> : undefined}>
            {progressItems.length > 0 ? (
              <DataCard style={styles.studyList}>
                {progressItems.map((item, index) => {
                  if (!item.contents) return null;
                  const creatorName = item.contents.profiles?.creator_channel_name || item.contents.profiles?.display_name || 'Creator Classfy';
                  const progress = Math.max(0, Math.min(100, item.progress_percent));
                  return (
                    <Pressable key={item.content_id} accessibilityRole="button" accessibilityLabel={`${item.contents.title}, ${Math.round(progress)}% concluído`} style={({ pressed }) => [styles.historyRow, index < progressItems.length - 1 && styles.rowDivider, pressed && styles.pressed]} onPress={() => router.push(`/watch/${item.content_id}`)}>
                      {item.contents.thumbnail_url ? <Image source={{ uri: item.contents.thumbnail_url }} style={styles.historyThumb} /> : <View style={[styles.historyThumb, styles.historyThumbEmpty]}><Play size={20} strokeWidth={t.stroke} color={t.muted} /></View>}
                      <View style={styles.historyMeta}>
                        <Text style={styles.historyTitle} numberOfLines={2}>{item.contents.title}</Text>
                        <Text style={dataStyles.label} numberOfLines={1}>{creatorName}</Text>
                        <View style={styles.progressRow}>
                          <View style={styles.historyProgressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
                          <Text style={styles.progressCaption}>{Math.round(progress)}%</Text>
                        </View>
                      </View>
                      <ChevronRight size={16} strokeWidth={t.stroke} color={t.subtle} />
                    </Pressable>
                  );
                })}
              </DataCard>
            ) : (
              <DataCard style={styles.emptyCard}>
                <DataIcon icon={BookOpen} />
                <Text style={styles.historyTitle}>Seu próximo aprendizado começa aqui</Text>
                <Text style={dataStyles.label}>Os conteúdos que você assistir aparecerão nesta lista.</Text>
                <DataAction label="Explorar conteúdos" variant="secondary" onPress={() => router.push('/explore')} />
              </DataCard>
            )}
          </DataSection>

          <DataSection title="Conquistas" subtitle={`${unlockedBadgesCount} de ${badges.length} alcançadas`}>
            <View style={styles.tabs} accessibilityRole="tablist">
              {([{ key: 'progress', label: `Em andamento (${badges.length - unlockedBadgesCount})` }, { key: 'earned', label: `Alcançadas (${unlockedBadgesCount})` }] as const).map((tab) => (
                <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: achievementTab === tab.key }} onPress={() => setAchievementTab(tab.key)} style={[styles.tab, achievementTab === tab.key && styles.tabActive]}>
                  <Text style={[styles.tabText, achievementTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
                </Pressable>
              ))}
            </View>
            <DataCard style={styles.achievementList}>
              {visibleBadges.length === 0 ? <Text style={styles.emptyText}>{achievementTab === 'earned' ? 'Suas conquistas alcançadas aparecerão aqui.' : 'Nenhuma conquista em andamento.'}</Text> : visibleBadges.map((item, index) => {
                const unlocked = item.earned_at !== null;
                const current = getMilestoneCurrentValue(item.milestone_type);
                const format = (value: number) => item.milestone_type === 'earnings' ? `R$ ${Math.round(value).toLocaleString('pt-BR')}` : `${Math.round(value).toLocaleString('pt-BR')}${item.milestone_type === 'engagement' ? '%' : ''}`;
                const percent = Math.max(0, Math.min(100, (current / Math.max(1, item.milestone_value)) * 100));
                return (
                  <View key={item.id} style={[styles.achievementRow, index < visibleBadges.length - 1 && styles.rowDivider]}>
                    <DataIcon icon={milestoneIcon(item.milestone_type)} />
                    <View style={styles.achievementCopy}>
                      <View style={styles.achievementTitleRow}>
                        <Text style={styles.historyTitle}>{item.name}</Text>
                        {unlocked ? <Check size={16} strokeWidth={t.stroke} color={t.secondary} /> : <LockKeyhole size={14} strokeWidth={t.stroke} color={t.subtle} />}
                      </View>
                      {item.description ? <Text style={dataStyles.label}>{item.description}</Text> : null}
                      <Text style={styles.achievementStatus}>{unlocked ? 'Alcançada' : `Em andamento · ${format(current)} de ${format(item.milestone_value)}`}</Text>
                      {!unlocked ? <View accessibilityRole="progressbar" accessibilityLabel={`Progresso de ${item.name}`} accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }} style={styles.smallProgressTrack}><View style={[styles.progressFill, { width: `${percent}%` }]} /></View> : null}
                    </View>
                  </View>
                );
              })}
            </DataCard>
          </DataSection>

          <DataSection title="Sua biblioteca">
            <DataCard style={styles.libraryCard}>
              <DataRow icon={Clock} title="Histórico" subtitle="Conteúdos que você assistiu" onPress={() => router.push('/library/history')} />
              <DataRow icon={Heart} title="Favoritos" subtitle="Seus conteúdos favoritos" onPress={() => router.push('/library/favorites')} />
              <DataRow icon={Bookmark} title="Salvos" subtitle="Para assistir depois" onPress={() => router.push('/library/saved')} last />
            </DataCard>
          </DataSection>
        </ScrollView>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 48, gap: spacing.xxl },
  authContainer: { flex: 1, justifyContent: 'center', padding: spacing.xxl, gap: spacing.lg },
  authTitle: { color: t.ink, fontSize: 22, fontWeight: '600', lineHeight: 28 },
  authSubtitle: { color: t.muted, fontSize: 14, lineHeight: 21 },
  accountSection: { gap: spacing.sm },
  userHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatarContainer: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.raised, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { color: t.ink, fontSize: 20, fontWeight: '600' },
  userMeta: { flex: 1, minWidth: 0, gap: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  displayName: { color: t.ink, fontSize: 17, fontWeight: '600', flexShrink: 1 },
  planBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  planText: { color: t.muted, fontSize: 12 },
  bioText: { color: t.secondary, fontSize: 14, lineHeight: 21 },
  profileActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.xs },
  settingsAction: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  levelCard: { gap: spacing.lg },
  levelHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' },
  pointsMeta: { minWidth: 0, gap: spacing.xs },
  pointsTotal: { color: t.ink, fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  progressTrack: { height: 6, backgroundColor: t.strong, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: t.accent, borderRadius: 3 },
  studyList: { paddingVertical: 0 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  historyThumb: { width: 72, aspectRatio: 16 / 9, borderRadius: t.controlRadius },
  historyThumbEmpty: { backgroundColor: t.raised, alignItems: 'center', justifyContent: 'center' },
  historyMeta: { flex: 1, minWidth: 0, gap: spacing.xs },
  historyTitle: { color: t.ink, fontSize: 14, fontWeight: '500', lineHeight: 20, flexShrink: 1 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  historyProgressTrack: { flex: 1, height: 4, backgroundColor: t.strong, borderRadius: 2, overflow: 'hidden' },
  smallProgressTrack: { height: 4, backgroundColor: t.strong, borderRadius: 2, overflow: 'hidden' },
  progressCaption: { color: t.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  emptyCard: { gap: spacing.md },
  emptyText: { color: t.muted, fontSize: 14, lineHeight: 21, paddingVertical: spacing.lg },
  tabs: { flexDirection: 'row', gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
  tab: { flex: 1, minHeight: 48, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: t.accent },
  tabText: { color: t.muted, fontSize: 13, fontWeight: '500', textAlign: 'center', lineHeight: 18 },
  tabTextActive: { color: t.ink },
  achievementList: { paddingVertical: 0 },
  achievementRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.lg, alignItems: 'flex-start' },
  achievementCopy: { flex: 1, minWidth: 0, gap: spacing.sm },
  achievementTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  achievementStatus: { color: t.secondary, fontSize: 12, lineHeight: 18 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
  libraryCard: { paddingVertical: 0 },
  pressed: { opacity: 0.7 },
});

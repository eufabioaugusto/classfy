import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Settings as GearIcon,
  BookOpen,
  Trophy,
  Crown,
  Play,
  Users,
  DollarSign,
  Eye,
  Flame,
  Star,
  Award,
  ArrowLeft,
  Heart,
  Bookmark,
  Clock,
  FolderOpen,
} from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

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

// Custom Premium Vector Badge Component
function BadgeVisual({ type, value, unlocked }: { type: string; value: number; unlocked: boolean }) {
  // Determine Category Icon & Accent Color
  let IconComponent = Star;
  let categoryColor = '#e21d48'; // Default red

  switch (type) {
    case 'contents':
      IconComponent = Play;
      categoryColor = '#f43f5e'; // Pink/Rose
      break;
    case 'followers':
      IconComponent = Users;
      categoryColor = '#a855f7'; // Purple
      break;
    case 'earnings':
      IconComponent = DollarSign;
      categoryColor = '#10b981'; // Green/Emerald
      break;
    case 'views':
      IconComponent = Eye;
      categoryColor = '#f97316'; // Orange
      break;
    case 'engagement':
      IconComponent = Flame;
      categoryColor = '#3b82f6'; // Blue
      break;
  }

  // Determine Border Tier color based on milestone value
  let tierColor = '#e21d48'; // Default Rose/Red (Iniciante)
  let tierGlow = 'rgba(226, 29, 72, 0.2)';
  let labelText = 'INICIANTE';

  if (value >= 1000000 || value === 500) {
    tierColor = '#06b6d4'; // Cyan (Diamante)
    tierGlow = 'rgba(6, 182, 212, 0.4)';
    labelText = 'DIAMANTE';
  } else if (value === 200 || value === 5000 || value === 50000 || value === 100000) {
    tierColor = '#fbbf24'; // Gold (Ouro)
    tierGlow = 'rgba(251, 191, 36, 0.4)';
    labelText = 'OURO';
  } else if (value === 100 || value === 1000 || value === 10000) {
    tierColor = '#cbd5e1'; // Silver (Prata)
    tierGlow = 'rgba(203, 213, 225, 0.3)';
    labelText = 'PRATA';
  } else if (value === 50 || value === 500 || value === 2000 || value === 80) {
    tierColor = '#b45309'; // Bronze (Bronze)
    tierGlow = 'rgba(180, 83, 9, 0.3)';
    labelText = 'BRONZE';
  }

  return (
    <View style={[styles.badgeContainer, { shadowColor: tierColor, shadowOpacity: unlocked ? 0.35 : 0 }]}>
      {/* Outer shield frame */}
      <View style={[
        styles.badgeShield, 
        { borderColor: unlocked ? tierColor : '#333', backgroundColor: unlocked ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.01)' }
      ]}>
        
        {/* Core glowing ring */}
        <View style={[
          styles.badgeCoreRing, 
          { borderColor: unlocked ? categoryColor : '#222' }
        ]}>
          <IconComponent size={20} color={unlocked ? '#FFF' : '#444'} />
        </View>

        {/* Small tier tag at bottom */}
        {unlocked && (
          <View style={[styles.tierTag, { backgroundColor: tierColor }]}>
            <Text style={styles.tierTagText}>{labelText}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loadingData, setLoadingData] = useState(true);
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
        .select('points')
        .eq('user_id', user!.id);

      const points = Math.round(eventsData?.reduce((sum, e) => sum + (e.points || 0), 0) || 0);
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

  const renderDashboard = () => {
    if (!user) {
      return (
        <View style={styles.authContainer}>
          <Trophy size={48} color={colors.accent} style={{ marginBottom: spacing.md }} />
          <Text style={styles.authTitle}>Seja bem-vindo!</Text>
          <Text style={styles.authSubtitle}>
            Entre na Classfy para acompanhar suas conquistas de estudo, nível de experiência e carteira de finanças.
          </Text>
          <Pressable style={styles.authBtn} onPress={() => router.push('/auth/sign-in')}>
            <Text style={styles.authBtnText}>Criar Conta ou Login</Text>
          </Pressable>
        </View>
      );
    }

    if (loadingData || authLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingText}>Carregando dados de progresso...</Text>
        </View>
      );
    }

    return (
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        
        {/* User Info Header Block */}
        <View style={styles.userHeader}>
          <View style={styles.avatarContainer}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{profile?.display_name?.[0]?.toUpperCase() || 'C'}</Text>
            )}
          </View>
          <View style={styles.userMeta}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName}>{profile?.display_name || 'Conta Classfy'}</Text>
              <View style={styles.planBadge}>
                <Text style={styles.planBadgeText}>{(profile?.plan || 'free').toUpperCase()}</Text>
              </View>
            </View>
            {profile?.creator_channel_name && (
              <Text style={styles.channelHandle}>@{profile.creator_channel_name}</Text>
            )}
            {profile?.bio ? (
              <Text style={styles.bioText} numberOfLines={2}>{profile.bio}</Text>
            ) : (
              <Text style={styles.bioPlaceholder}>Nenhuma bio definida...</Text>
            )}
          </View>
        </View>

        {/* Dashboard Shortcut Buttons */}
        <View style={styles.actionsRow}>
          <Pressable style={styles.primaryActionBtn} onPress={() => router.push('/edit-profile')}>
            <Text style={styles.primaryActionText}>Editar Perfil</Text>
          </Pressable>
          <Pressable style={styles.secondaryActionBtn} onPress={() => router.push('/settings')}>
            <GearIcon size={18} color={colors.text} />
          </Pressable>
        </View>

        {/* Level & XP Progress Card */}
        <View style={styles.xpCard}>
          <View style={styles.xpCardHeader}>
            <View style={styles.levelBadge}>
              <Trophy size={18} color="#000" />
              <Text style={styles.levelText}>Nível {level}</Text>
            </View>
            <Text style={styles.xpTotalPoints}>{totalPoints.toLocaleString('pt-BR')} XP Total</Text>
          </View>
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
          </View>
          <View style={styles.progressFooter}>
            <Text style={styles.progressFooterText}>XP para nível {level + 1}</Text>
            <Text style={styles.progressFooterVal}>{pointsToNextLevel} XP restantes</Text>
          </View>
        </View>

        {/* Achievements / Conquistas Horizontal Carousel */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderTitleRow}>
            <Award size={18} color={colors.text} style={{ marginRight: 6 }} />
            <Text style={styles.sectionTitle}>Minhas Conquistas</Text>
          </View>
          <Text style={styles.sectionBadge}>{unlockedBadgesCount} / {badges.length}</Text>
        </View>

        <FlatList
          horizontal
          data={badges}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.badgeCarousel}
          renderItem={({ item }) => {
            const unlocked = item.earned_at !== null;
            const currentVal = getMilestoneCurrentValue(item.milestone_type);
            const targetVal = item.milestone_value;
            
            // Format currency for earnings
            const currentFormatted = item.milestone_type === 'earnings' 
              ? `R$ ${Math.round(currentVal)}` 
              : Math.round(currentVal).toString();
            const targetFormatted = item.milestone_type === 'earnings' 
              ? `R$ ${targetVal}` 
              : targetVal.toString();

            return (
              <View style={[styles.badgeCard, !unlocked && styles.badgeCardLocked]}>
                <BadgeVisual type={item.milestone_type} value={item.milestone_value} unlocked={unlocked} />
                
                <Text style={[styles.badgeName, !unlocked && styles.badgeNameLocked]} numberOfLines={1}>
                  {item.name}
                </Text>
                
                <Text style={styles.badgeDesc} numberOfLines={2}>
                  {item.description}
                </Text>

                {/* FOMO Progress Tracker */}
                <View style={styles.fomoTracker}>
                  <Text style={[styles.fomoText, unlocked && styles.fomoTextUnlocked]}>
                    {unlocked ? 'Concluída!' : `${currentFormatted} / ${targetFormatted}`}
                  </Text>
                  {!unlocked && (
                    <View style={styles.fomoProgressBg}>
                      <View style={[
                        styles.fomoProgressFill, 
                        { width: `${Math.min(100, (currentVal / targetVal) * 100)}%` }
                      ]} />
                    </View>
                  )}
                </View>
              </View>
            );
          }}
        />

        {/* Biblioteca Section */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderTitleRow}>
            <FolderOpen size={18} color={colors.text} style={{ marginRight: 6 }} />
            <Text style={styles.sectionTitle}>Minha Biblioteca</Text>
          </View>
        </View>

        <View style={styles.libraryGrid}>
          <Pressable style={styles.libraryItem} onPress={() => router.push('/library/history')}>
            <View style={[styles.libraryIconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.08)' }]}>
              <Clock size={20} color="#ef4444" />
            </View>
            <Text style={styles.libraryItemTitle}>Histórico</Text>
            <Text style={styles.libraryItemSubtitle}>Aulas assistidas</Text>
          </Pressable>

          <Pressable style={styles.libraryItem} onPress={() => router.push('/library/favorites')}>
            <View style={[styles.libraryIconWrap, { backgroundColor: 'rgba(236, 72, 153, 0.08)' }]}>
              <Heart size={20} color="#ec4899" />
            </View>
            <Text style={styles.libraryItemTitle}>Favoritos</Text>
            <Text style={styles.libraryItemSubtitle}>Aulas curtidas</Text>
          </Pressable>

          <Pressable style={styles.libraryItem} onPress={() => router.push('/library/saved')}>
            <View style={[styles.libraryIconWrap, { backgroundColor: 'rgba(59, 130, 246, 0.08)' }]}>
              <Bookmark size={20} color="#3b82f6" />
            </View>
            <Text style={styles.libraryItemTitle}>Salvos</Text>
            <Text style={styles.libraryItemSubtitle}>Assistir depois</Text>
          </Pressable>
        </View>

        {/* Study Progress History */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderTitleRow}>
            <BookOpen size={18} color={colors.text} style={{ marginRight: 6 }} />
            <Text style={styles.sectionTitle}>Histórico de Estudos</Text>
          </View>
          {progressItems.length > 0 && (
            <Pressable onPress={() => router.push('/study')}>
              <Text style={styles.sectionActionText}>Ver tudo</Text>
            </Pressable>
          )}
        </View>

        {progressItems.length > 0 ? (
          <View style={styles.historyList}>
            {progressItems.map((item) => {
              if (!item.contents) return null;
              const creatorName =
                item.contents.profiles?.creator_channel_name ||
                item.contents.profiles?.display_name ||
                'Creator Classfy';
              
              return (
                <Pressable
                  key={item.content_id}
                  style={styles.historyCard}
                  onPress={() => router.push(`/watch/${item.content_id}`)}
                >
                  {item.contents.thumbnail_url ? (
                    <Image source={{ uri: item.contents.thumbnail_url }} style={styles.historyThumb} />
                  ) : (
                    <View style={styles.historyThumbPlaceholder} />
                  )}
                  <View style={styles.historyMeta}>
                    <Text style={styles.historyTitle} numberOfLines={1}>{item.contents.title}</Text>
                    <Text style={styles.historyCreator} numberOfLines={1}>@{creatorName}</Text>
                    <View style={styles.progressRow}>
                      <View style={styles.progressTrackMini}>
                        <View style={[styles.progressFillMini, { width: `${item.progress_percent}%` }]} />
                      </View>
                      <Text style={styles.progressPercentVal}>{item.progress_percent}%</Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyHistoryCard}>
            <BookOpen size={28} color={colors.muted} style={{ marginBottom: spacing.sm, opacity: 0.5 }} />
            <Text style={styles.emptyHistoryText}>Nenhum conteúdo estudado ainda.</Text>
            <Pressable style={styles.exploreBtn} onPress={() => router.push('/explore')}>
              <Text style={styles.exploreBtnText}>Começar a Explorar</Text>
            </Pressable>
          </View>
        )}

      </ScrollView>
    );
  };

  return (
    <AppScreen edgeToEdge={true} scroll={false}>
      {/* Page Title Floating */}
      <View style={[styles.pageHeader, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.pageTitle}>Painel de Estudos</Text>
      </View>

      {renderDashboard()}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backBtn: {
    padding: 4,
    marginLeft: -4,
  },
  pageTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: typography.weightBold,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.sm,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.section * 2,
  },
  authContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl * 2,
  },
  authTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: typography.weightBold,
    marginBottom: spacing.xs,
  },
  authSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  authBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl * 1.5,
  },
  authBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  userHeader: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    alignItems: 'center',
    gap: spacing.lg,
  },
  avatarContainer: {
    width: 68,
    height: 68,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: 'bold',
  },
  userMeta: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  displayName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: typography.weightBold,
  },
  planBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  planBadgeText: {
    color: colors.text,
    fontSize: 8,
    fontWeight: 'bold',
  },
  channelHandle: {
    color: colors.muted,
    fontSize: 11,
  },
  bioText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  bioPlaceholder: {
    color: colors.mutedDim,
    fontSize: 12,
    fontStyle: 'italic',
  },
  actionsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  primaryActionBtn: {
    flex: 1,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  secondaryActionBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  xpCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  xpCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  levelText: {
    color: '#000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  xpTotalPoints: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: 'bold',
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  progressFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  progressFooterText: {
    color: colors.muted,
    fontSize: 10,
  },
  progressFooterVal: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: 'bold',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weightBold,
  },
  sectionBadge: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: 'bold',
  },
  sectionActionText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: 'bold',
  },
  badgeCarousel: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  badgeCard: {
    width: 140,
    backgroundColor: '#111',
    borderColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  badgeCardLocked: {
    opacity: 0.55,
  },
  badgeName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  badgeNameLocked: {
    color: colors.muted,
  },
  badgeDesc: {
    color: colors.mutedDim,
    fontSize: 9,
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 12,
    height: 24, // Fix height to align elements nicely
  },
  badgeContainer: {
    width: 58,
    height: 58,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 3,
  },
  badgeShield: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badgeCoreRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierTag: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  tierTagText: {
    color: '#000',
    fontSize: 6,
    fontWeight: '900',
  },
  fomoTracker: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  fomoText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  fomoTextUnlocked: {
    color: '#10b981', // Emerald green
  },
  fomoProgressBg: {
    width: '80%',
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fomoProgressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  historyList: {
    gap: spacing.md,
  },
  historyCard: {
    flexDirection: 'row',
    backgroundColor: '#111',
    borderColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.md,
  },
  historyThumb: {
    width: 90,
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
  },
  historyThumbPlaceholder: {
    width: 90,
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  historyMeta: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
  },
  historyTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weightBold,
  },
  historyCreator: {
    color: colors.muted,
    fontSize: 10,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  progressTrackMini: {
    flex: 1,
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressFillMini: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  progressPercentVal: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: 'bold',
    width: 24,
    textAlign: 'right',
  },
  emptyHistoryCard: {
    backgroundColor: 'rgba(255,255,255,0.01)',
    borderColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHistoryText: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: spacing.md,
  },
  exploreBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  exploreBtnText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: 'bold',
  },
  // Biblioteca Section
  libraryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  libraryItem: {
    flex: 1,
    backgroundColor: '#111',
    borderColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  libraryIconWrap: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  libraryItemTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weightBold,
    textAlign: 'center',
  },
  libraryItemSubtitle: {
    color: colors.muted,
    fontSize: 9,
    textAlign: 'center',
  },
});

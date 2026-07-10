import { useRouter, Href } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Home,
  Zap,
  Clock,
  Star,
  Bookmark,
  Trophy,
  DollarSign,
  Crown,
  Settings,
  LogOut,
  LogIn,
  X,
  AlertTriangle,
  Wallet,
  Play,
  BookOpen,
  User,
} from 'lucide-react-native';

import { useSidebar } from '@/contexts/SidebarContext';
import { useAuth } from '@/features/auth/authContext';
import { toShortTitle } from '@/lib/study/getStudyJourneySummary';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.8, 320);

type MenuItem = {
  title: string;
  icon: React.ComponentType<any>;
  action: () => void;
  badge?: string;
  highlight?: boolean;
};

interface StatsData {
  totalPoints: number;
  performancePoints: number;
  level: number;
  contentCount: number;
  balance: number;
  progress: number;
  remaining: number;
}

export function AppSidebar() {
  const { isOpen, closeSidebar } = useSidebar();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [shouldRender, setShouldRender] = useState(isOpen);
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Real-time fetched state
  const [profileData, setProfileData] = useState<{
    displayName: string;
    avatarUrl: string | null;
    plan: string;
  } | null>(null);

  const [stats, setStats] = useState<StatsData | null>(null);
  const [activeStudies, setActiveStudies] = useState<{ id: string; title: string }[]>([]);
  const [studiesLimit, setStudiesLimit] = useState(5);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0.6,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();

      // Trigger real-time stats/profile fetch when drawer slides open
      if (user) {
        fetchUserData();
      }
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -DRAWER_WIDTH,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start((result) => {
        if (result.finished) {
          setShouldRender(false);
        }
      });
    }
  }, [isOpen, user]);

  const fetchUserData = async () => {
    if (!user) return;
    try {
      setLoadingData(true);
      
      // Parallel fetch for profile, stats tables, active studies
      const [profileRes, walletRes, eventsRes, contentsRes, studiesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('display_name, creator_channel_name, avatar_url, plan')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('wallets')
          .select('balance')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('reward_events')
          .select('points, performance_points')
          .eq('user_id', user.id),
        supabase
          .from('contents')
          .select('id', { count: 'exact', head: true })
          .eq('creator_id', user.id),
        supabase
          .from('studies')
          .select('id, title')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('last_activity_at', { ascending: false })
          .limit(5)
      ]);

      // 1. Process profile
      let finalPlan = 'free';
      if (profileRes.data) {
        const p = profileRes.data;
        finalPlan = p.plan || 'free';
        setProfileData({
          displayName: p.creator_channel_name || p.display_name || user.email || 'Visitante',
          avatarUrl: p.avatar_url,
          plan: finalPlan,
        });
      }

      // 2. Fetch study limits from RPC to match Web limits
      let limit = 5;
      try {
        const { data: limitsData } = await supabase.rpc('get_study_limits', {
          p_plan: finalPlan,
        });
        if (limitsData && limitsData.max_studies !== null && limitsData.max_studies !== undefined) {
          limit = Number(limitsData.max_studies);
        } else {
          limit = finalPlan === 'pro' ? 50 : finalPlan === 'premium' ? 9999 : 5;
        }
      } catch (err) {
        console.error('Error loading study limits RPC:', err);
        limit = finalPlan === 'pro' ? 50 : finalPlan === 'premium' ? 9999 : 5;
      }
      setStudiesLimit(limit);

      // 3. Process gamification points & levels
      const totalPoints = eventsRes.data?.reduce((s, e) => s + (e.points || 0), 0) || 0;
      const performancePoints = eventsRes.data?.reduce((s, e) => s + (Number(e.performance_points) || 0), 0) || 0;

      let level = 1;
      const getPointsForLevel = (n: number) => (500 * n * (n - 1)) / 2;
      while (getPointsForLevel(level + 1) <= totalPoints) level++;

      const pointsAtCurrentLevel = getPointsForLevel(level);
      const pointsNeededForNext = getPointsForLevel(level + 1) - pointsAtCurrentLevel;
      const pointsInCurrentLevel = totalPoints - pointsAtCurrentLevel;
      const progress = Math.min((pointsInCurrentLevel / pointsNeededForNext) * 100, 100);
      const remaining = Math.ceil(pointsNeededForNext - pointsInCurrentLevel);

      setStats({
        totalPoints,
        performancePoints,
        level,
        contentCount: contentsRes.count || 0,
        balance: walletRes.data?.balance || 0,
        progress,
        remaining,
      });

      // 4. Process active studies
      if (studiesRes.data) {
        setActiveStudies(studiesRes.data as any);
      }

    } catch (e) {
      console.error('Error loading drawer real-time stats:', e);
    } finally {
      setLoadingData(false);
    }
  };

  if (!shouldRender) return null;

  const navigateTo = (path: Href) => {
    closeSidebar();
    router.push(path);
  };

  const showPlaceholder = (title: string) => {
    closeSidebar();
    Alert.alert('Recurso em desenvolvimento', `A tela de ${title} estará disponível em breve!`);
  };

  const handleSignOut = async () => {
    closeSidebar();
    await signOut();
  };

  // Exact Web Sequence menu items using Lucide icons
  const mainGroup: MenuItem[] = [
    { title: 'Início', icon: Home, action: () => navigateTo('/') },
    { title: 'Shorts', icon: Zap, action: () => navigateTo('/shorts') },
    { title: 'Histórico', icon: Clock, action: () => navigateTo('/library/history') },
    { title: 'Favoritos', icon: Star, action: () => navigateTo('/library/favorites') },
    { title: 'Salvos', icon: Bookmark, action: () => navigateTo('/library/saved') },
    { title: 'Recompensas', icon: Trophy, action: () => navigateTo('/rewards') },
    { title: 'Carteira', icon: DollarSign, action: () => navigateTo('/carteira') },
    {
      title: 'Classfy Premium',
      icon: Crown,
      action: () => navigateTo('/premium'),
      highlight: true,
    },
  ];

  const renderGroup = (items: MenuItem[]) => (
    <View style={styles.group}>
      {items.map((item, idx) => {
        const IconComponent = item.icon;
        return (
          <Pressable
            key={idx}
            style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
            onPress={item.action}
          >
            <IconComponent
              size={18}
              color={item.highlight ? colors.accent : colors.text}
              style={styles.menuIcon}
            />
            <Text style={[styles.menuText, item.highlight && styles.menuTextHighlight]}>
              {item.title}
            </Text>
            {item.badge && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.badge}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );

  const finalDisplayName = profileData?.displayName || user?.email || 'Visitante';
  const finalPlan = profileData?.plan || 'free';

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlayContainer]}>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSidebar} />
      </Animated.View>

      {/* Drawer Body */}
      <Animated.View
        style={[
          styles.drawer,
          {
            transform: [{ translateX: slideAnim }],
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.md,
          },
        ]}
      >
        {/* Header & User Profile */}
        <View style={styles.drawerHeader}>
          <View style={styles.logoRow}>
            <Text style={styles.logoText}>Classfy</Text>
            <Pressable onPress={closeSidebar} style={styles.closeBtn}>
              <X size={20} color={colors.text} />
            </Pressable>
          </View>

          <Pressable style={styles.profileSection} onPress={() => navigateTo('/profile')}>
            <View style={styles.avatar}>
              {profileData?.avatarUrl ? (
                <Image source={{ uri: profileData.avatarUrl }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{finalDisplayName[0]?.toUpperCase()}</Text>
              )}
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName} numberOfLines={1}>
                {finalDisplayName}
              </Text>
              <Text style={styles.profilePlan}>
                {user ? `Plano ${finalPlan}` : 'Faça login para salvar progresso'}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Real-time Gamification Stats Card (Web Parity) */}
        {user && stats ? (
          <View style={styles.statsCard}>
            {/* Level Row */}
            <View style={styles.statsHeader}>
              <View style={styles.levelBadgeContainer}>
                <View style={styles.levelBadge}>
                  <Text style={styles.levelBadgeText}>N{stats.level}</Text>
                </View>
                <View>
                  <Text style={styles.levelTitle}>Nível {stats.level}</Text>
                  <Text style={styles.levelRemaining}>
                    {stats.remaining.toLocaleString('pt-BR')} XP para N{stats.level + 1}
                  </Text>
                </View>
              </View>
              <Text style={styles.levelPoints}>
                {Math.round(stats.totalPoints).toLocaleString('pt-BR')} XP
              </Text>
            </View>
            
            {/* Progress line */}
            <View style={styles.progressLineBg}>
              <View style={[styles.progressLineFill, { width: `${stats.progress}%` }]} />
            </View>

            {/* Stats Grid */}
            <View style={styles.statsGrid}>
              <View style={styles.gridItem}>
                <View style={styles.gridHeader}>
                  <Zap size={11} color={colors.accent} />
                  <Text style={styles.gridLabel}>Foco</Text>
                </View>
                <Text style={styles.gridValue}>
                  {stats.performancePoints.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                </Text>
              </View>
              <View style={styles.gridItem}>
                <View style={styles.gridHeader}>
                  <Wallet size={11} color={colors.muted} />
                  <Text style={styles.gridLabel}>Saldo</Text>
                </View>
                <Text style={styles.gridValue}>
                  R$ {stats.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </View>
            </View>

            {/* Contents thin row */}
            <View style={styles.contentsRow}>
              <View style={styles.contentsLeft}>
                <Play size={11} color={colors.muted} />
                <Text style={styles.contentsLabel}>Conteúdos</Text>
              </View>
              <Text style={styles.contentsValue}>{stats.contentCount}</Text>
            </View>
          </View>
        ) : user && loadingData ? (
          <View style={styles.statsCardPlaceholder}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : null}

        {/* Scrollable Navigation Items */}
        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          {/* Main items sequence */}
          {renderGroup(mainGroup)}
          <View style={styles.separator} />
          
          {/* Active Studies Shortcuts (Web parity) */}
          {user && activeStudies.length > 0 ? (
            <View style={styles.group}>
              <View style={styles.studiesHeaderRow}>
                <View style={styles.studiesLeftHeader}>
                  <BookOpen size={16} color={colors.text} style={{ marginRight: 6 }} />
                  <Text style={styles.studiesTitle}>Estudos</Text>
                </View>
                <Pressable onPress={() => navigateTo('/study')}>
                  <Text style={styles.studiesProgressText}>{activeStudies.length}/{studiesLimit} &gt;</Text>
                </Pressable>
              </View>
              {activeStudies.map((study) => (
                <Pressable
                  key={study.id}
                  style={({ pressed }) => [styles.studyShortcut, pressed && styles.menuItemPressed]}
                  onPress={() => navigateTo({ pathname: '/study', params: { studyId: study.id } } as any)}
                >
                  <BookOpen size={14} color={colors.muted} />
                  <Text style={styles.studyShortcutText} numberOfLines={1}>
                    {toShortTitle(study.title)}
                  </Text>
                </Pressable>
              ))}

              {/* Limite Atingido Card */}
              {activeStudies.length >= studiesLimit && (
                <View style={styles.limitCard}>
                  <AlertTriangle size={18} color="#ef4444" style={{ marginTop: 2 }} />
                  <View style={styles.limitContent}>
                    <View style={styles.limitTitleRow}>
                      <Zap size={12} color="#ef4444" />
                      <Text style={styles.limitTitle}>Limite atingido!</Text>
                    </View>
                    <Text style={styles.limitSubtitle}>
                      Arquive estudos ou{' '}
                      <Text style={styles.upgradeLink} onPress={() => showPlaceholder('Upgrade')}>
                        faça upgrade
                      </Text>{' '}
                      para continuar.
                    </Text>
                  </View>
                </View>
              )}
            </View>
          ) : null}

          {/* Divider if studies exist */}
          {user && activeStudies.length > 0 && <View style={[styles.separator, { marginTop: spacing.xs }]} />}

          {/* Fazer Upgrade Banner Card */}
          {user && finalPlan !== 'premium' && (
            <Pressable
              style={({ pressed }) => [
                styles.upgradeCard,
                pressed && styles.upgradeCardPressed,
              ]}
              onPress={() => showPlaceholder('Upgrade')}
            >
              <View style={styles.upgradeTextContainer}>
                <Text style={styles.upgradeTitle}>Fazer upgrade</Text>
                <Text style={styles.upgradeSubtitle}>Desbloquear benefícios</Text>
              </View>
              <View style={styles.upgradeIconContainer}>
                <Zap size={14} color="#ef4444" />
              </View>
            </Pressable>
          )}

          {/* Divider if upgrade was shown */}
          {user && finalPlan !== 'premium' && <View style={styles.separator} />}

          {/* Settings & Logout */}
          <View style={styles.optionsSection}>
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              onPress={() => navigateTo('/profile')}
            >
              <User size={18} color={colors.text} style={styles.menuIcon} />
              <Text style={styles.menuText}>Minha Conta</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              onPress={() => navigateTo('/settings')}
            >
              <Settings size={18} color={colors.text} style={styles.menuIcon} />
              <Text style={styles.menuText}>Configurações</Text>
            </Pressable>

            {user ? (
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                onPress={handleSignOut}
              >
                <LogOut size={18} color="#ef4444" style={styles.menuIcon} />
                <Text style={[styles.menuText, { color: '#ef4444' }]}>Sair da Conta</Text>
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                onPress={() => navigateTo('/auth/sign-in')}
              >
                <LogIn size={18} color={colors.accent} style={styles.menuIcon} />
                <Text style={[styles.menuText, { color: colors.accent }]}>Entrar no App</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    zIndex: 9999,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  drawer: {
    backgroundColor: colors.background,
    borderRightColor: 'rgba(255, 255, 255, 0.08)',
    borderRightWidth: 1,
    height: '100%',
    position: 'absolute',
    width: DRAWER_WIDTH,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 20,
  },
  drawerHeader: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  logoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  logoText: {
    color: colors.text,
    fontSize: typography.titleLarge,
    fontWeight: typography.weightBold,
    letterSpacing: -0.5,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  profileSection: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 44,
    justifyContent: 'center',
    width: 44,
    overflow: 'hidden',
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarText: {
    color: colors.background,
    fontSize: 20,
    fontWeight: typography.weightBold,
  },
  profileInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  profileName: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: typography.weightBold,
  },
  profilePlan: {
    color: colors.muted,
    fontSize: typography.caption,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  statsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: radius.md,
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  statsCardPlaceholder: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: radius.md,
    borderWidth: 1,
    height: 108,
    justifyContent: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  levelBadgeContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  levelBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: radius.sm,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  levelBadgeText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: typography.weightBold,
  },
  levelTitle: {
    color: colors.text,
    fontSize: 11,
    fontWeight: typography.weightBold,
    lineHeight: 14,
  },
  levelRemaining: {
    color: colors.muted,
    fontSize: 9,
    marginTop: 1,
  },
  levelPoints: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: typography.weightBold,
  },
  progressLineBg: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radius.pill,
    height: 3,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  progressLineFill: {
    backgroundColor: colors.accent,
    height: '100%',
  },
  statsGrid: {
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  gridItem: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRightColor: 'rgba(255, 255, 255, 0.05)',
    borderRightWidth: 1,
  },
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  gridLabel: {
    color: colors.muted,
    fontSize: 9,
    textTransform: 'uppercase',
    fontWeight: typography.weightBold,
  },
  gridValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weightBold,
  },
  contentsRow: {
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  contentsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  contentsLabel: {
    color: colors.muted,
    fontSize: 9,
    textTransform: 'uppercase',
    fontWeight: typography.weightBold,
  },
  contentsValue: {
    color: colors.text,
    fontSize: 11,
    fontWeight: typography.weightBold,
  },
  scrollContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  group: {
    marginBottom: spacing.lg,
  },
  groupLabel: {
    color: colors.muted,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  menuItem: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flexDirection: 'row',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  menuItemPressed: {
    backgroundColor: colors.surface,
  },
  menuIcon: {
    marginRight: spacing.md,
  },
  menuText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
  },
  menuTextHighlight: {
    color: colors.accent,
    fontWeight: typography.weightBold,
  },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.background,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
  },
  separator: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    height: 1,
    marginBottom: spacing.lg,
  },
  studiesHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  studiesLeftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  studiesTitle: {
    color: colors.muted,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
    textTransform: 'uppercase',
  },
  studiesProgressText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: typography.weightBold,
  },
  studyShortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  studyShortcutText: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    fontWeight: '500',
    flex: 1,
  },
  limitCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  limitContent: {
    flex: 1,
  },
  limitTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 4,
  },
  limitTitle: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: typography.weightBold,
  },
  limitSubtitle: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 14,
  },
  upgradeLink: {
    color: '#ef4444',
    fontWeight: typography.weightBold,
    textDecorationLine: 'underline',
  },
  upgradeCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  upgradeCardPressed: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  upgradeTextContainer: {
    flex: 1,
  },
  upgradeTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weightBold,
    marginBottom: 2,
  },
  upgradeSubtitle: {
    color: colors.muted,
    fontSize: 10,
  },
  upgradeIconContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: radius.full,
    padding: 6,
  },
  optionsSection: {
    marginBottom: spacing.xxl,
  },
});

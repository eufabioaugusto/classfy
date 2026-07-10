import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Alert,
  Share,
  Animated,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Users,
  Eye,
  Video,
  Headphones,
  Zap,
  GraduationCap,
  Share2,
  MessageCircle,
  Trophy,
  CheckCircle2,
  Plus,
  Minus,
} from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { ContentCard } from '@/components/ContentCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface CreatorProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  creator_channel_name: string | null;
  creator_bio: string | null;
  cover_image_url: string | null;
  created_at: string;
}

interface CreatorStats {
  totalPoints: number;
  level: number;
  followersCount: number;
  contentCount: number;
  totalViews: number;
}

interface Particle {
  id: number;
  x: Animated.Value;
  y: Animated.Value;
  scale: Animated.Value;
  opacity: Animated.Value;
  size: number;
  color: string;
}

export default function CreatorProfileScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [contents, setContents] = useState<any[]>([]);
  const [filteredContents, setFilteredContents] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'videos' | 'podcasts' | 'shorts' | 'courses'>('all');
  const [isFollowing, setIsFollowing] = useState(false);
  const [togglingFollow, setTogglingFollow] = useState(false);

  // Animations
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  const contentFadeAnim = useRef(new Animated.Value(0)).current;
  const followScale = useRef(new Animated.Value(1)).current;

  // Particle Burst state
  const [particles, setParticles] = useState<Particle[]>([]);

  // Configure navigation options imperatively to prevent infinite state updates
  useEffect(() => {
    navigation.setOptions({
      presentation: 'fullScreenModal',
      headerShown: false,
    });
  }, [navigation]);

  // Shimmer/Pulse loop for skeletons
  useEffect(() => {
    if (loading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.8,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [loading]);

  useEffect(() => {
    if (rawId) {
      loadCreatorProfile();
    }
  }, [rawId, user]);

  useEffect(() => {
    filterContents();
  }, [activeTab, contents]);

  const loadCreatorProfile = async () => {
    try {
      setLoading(true);
      contentFadeAnim.setValue(0);

      let query = supabase.from('profiles').select('*');
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId);
      
      if (isUuid) {
        query = query.eq('id', rawId);
      } else {
        const cleanName = rawId.startsWith('@') ? rawId.slice(1) : rawId;
        query = query.eq('creator_channel_name', cleanName);
      }

      const { data: profileData, error: profileError } = await query.maybeSingle();

      if (profileError) throw profileError;

      if (!profileData) {
        Alert.alert('Erro', 'Creator não encontrado.');
        router.back();
        return;
      }

      setCreator(profileData);

      // Check follow status
      if (user && user.id !== profileData.id) {
        const { data: followData } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', user.id)
          .eq('following_id', profileData.id)
          .maybeSingle();
        
        setIsFollowing(!!followData);
      }

      // Fetch stats & content
      const [pointsRes, followersRes, contentsRes, coursesRes, viewsRes] = await Promise.all([
        supabase.from('reward_events').select('points').eq('user_id', profileData.id),
        supabase.from('follows').select('id', { count: 'exact' }).eq('following_id', profileData.id),
        supabase.from('contents').select('*').eq('creator_id', profileData.id).eq('status', 'approved').order('published_at', { ascending: false }),
        supabase.from('courses').select('*').eq('creator_id', profileData.id).eq('status', 'approved').order('created_at', { ascending: false }),
        supabase.from('contents').select('views_count').eq('creator_id', profileData.id).eq('status', 'approved'),
      ]);

      const totalPoints = pointsRes.data?.reduce((sum, e) => sum + (e.points || 0), 0) || 0;
      const level = Math.floor(totalPoints / 1000) + 1;
      const totalViews = viewsRes.data?.reduce((sum, c) => sum + (c.views_count || 0), 0) || 0;

      const coursesAsContents = (coursesRes.data || []).map((course: any) => ({
        ...course,
        content_type: 'curso',
      }));

      const allContents = [...(contentsRes.data || []), ...coursesAsContents];

      setStats({
        totalPoints,
        level,
        followersCount: followersRes.count || 0,
        contentCount: allContents.length,
        totalViews,
      });

      setContents(allContents);
      setLoading(false);

      // Fade in actual contents smoothly
      Animated.timing(contentFadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();

    } catch (err) {
      console.error('Error loading creator details:', err);
      Alert.alert('Erro', 'Não foi possível obter dados do criador.');
      setLoading(false);
    }
  };

  const filterContents = () => {
    if (activeTab === 'all') {
      setFilteredContents(contents);
    } else {
      const filtered = contents.filter((c) => {
        switch (activeTab) {
          case 'videos':
            return c.content_type === 'aula';
          case 'podcasts':
            return c.content_type === 'podcast';
          case 'shorts':
            return c.content_type === 'short';
          case 'courses':
            return c.content_type === 'curso';
          default:
            return true;
        }
      });
      setFilteredContents(filtered);
    }
  };

  // Trigger like-burst like animation on follow button
  const triggerFollowBurst = () => {
    const particleCount = 10;
    const newParticles: Particle[] = Array.from({ length: particleCount }, (_, i) => {
      const angle = (360 / particleCount) * i + Math.random() * 30 - 15;
      const distance = 40 + Math.random() * 25;
      const radians = (angle * Math.PI) / 180;
      const targetX = Math.cos(radians) * distance;
      const targetY = Math.sin(radians) * distance;

      const x = new Animated.Value(0);
      const y = new Animated.Value(0);
      const scale = new Animated.Value(0);
      const opacity = new Animated.Value(1);

      // Run translation animations
      Animated.parallel([
        Animated.timing(x, {
          toValue: targetX,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(y, {
          toValue: targetY,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.2,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.6,
            duration: 350,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start();

      return {
        id: Math.random() + i,
        x,
        y,
        scale,
        opacity,
        size: 5 + Math.random() * 4,
        color: i % 2 === 0 ? colors.accent : '#f43f5e', // secondary burst color
      };
    });

    setParticles(newParticles);

    // Clear particles after animation
    setTimeout(() => {
      setParticles([]);
    }, 550);
  };

  const handleToggleFollow = async () => {
    if (!user) {
      Alert.alert('Login Necessário', 'Faça login para poder seguir os creators.');
      router.push('/auth/sign-in');
      return;
    }

    if (!creator || togglingFollow) return;

    // Trigger fast and discrete button scaling animation
    Animated.sequence([
      Animated.timing(followScale, {
        toValue: 0.95,
        duration: 70,
        useNativeDriver: true,
      }),
      Animated.timing(followScale, {
        toValue: 1.05,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.timing(followScale, {
        toValue: 1.0,
        duration: 70,
        useNativeDriver: true,
      }),
    ]).start();

    // Optimistic UI updates
    const previousFollowingState = isFollowing;
    setIsFollowing(!previousFollowingState);
    if (stats) {
      setStats({
        ...stats,
        followersCount: !previousFollowingState ? stats.followersCount + 1 : Math.max(0, stats.followersCount - 1),
      });
    }

    if (!previousFollowingState) {
      triggerFollowBurst();
    }

    setTogglingFollow(true);
    try {
      if (previousFollowingState) {
        // Unfollow request
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', creator.id);
        
        if (error) throw error;
      } else {
        // Follow request
        const { error } = await supabase
          .from('follows')
          .insert({
            follower_id: user.id,
            following_id: creator.id,
          });
        
        if (error) throw error;

        try {
          await supabase.functions.invoke('handle-follow-reward', {
            body: { followerId: user.id, followingId: creator.id }
          });
        } catch (e) {
          // Ignore silently
          console.log('Follow reward function error:', e);
        }
      }
    } catch (err: any) {
      console.error('Error toggling follow:', err);
      // Revert optimistic state
      setIsFollowing(previousFollowingState);
      if (stats) {
        setStats({
          ...stats,
          followersCount: previousFollowingState ? stats.followersCount + 1 : Math.max(0, stats.followersCount - 1),
        });
      }
      Alert.alert('Erro', 'Não foi possível salvar o estado de seguir. Verifique sua conexão.');
    } finally {
      setTogglingFollow(false);
    }
  };

  const handleShare = async () => {
    if (!creator) return;
    try {
      const shareUrl = `https://classfy.com.br/@${creator.creator_channel_name}`;
      await Share.share({
        message: `Confira o canal do ${creator.display_name} no Classfy: ${shareUrl}`,
        url: shareUrl,
      });
    } catch (err) {
      console.error('Error sharing creator profile:', err);
    }
  };

  const renderSkeleton = () => {
    return (
      <View style={styles.skeletonContainer}>
        {/* Banner Skeleton */}
        <Animated.View style={[styles.skeletonBanner, { opacity: pulseAnim }]} />
        <View style={[styles.backButton, { top: insets.top + spacing.xs }]}>
          <ArrowLeft size={20} color="#fff" />
        </View>

        {/* Profile Info Block Skeleton */}
        <View style={styles.headerInfoBlock}>
          {/* Avatar Skeleton */}
          <Animated.View style={[styles.skeletonAvatar, { opacity: pulseAnim }]} />

          {/* Name & Handle Skeleton */}
          <Animated.View style={[styles.skeletonTextLine, { width: 180, height: 22, marginTop: spacing.sm, opacity: pulseAnim }]} />
          <Animated.View style={[styles.skeletonTextLine, { width: 120, height: 14, marginTop: spacing.xs, opacity: pulseAnim }]} />
          
          {/* Bio Skeleton */}
          <Animated.View style={[styles.skeletonTextLine, { width: '85%', height: 12, marginTop: spacing.md, opacity: pulseAnim }]} />
          <Animated.View style={[styles.skeletonTextLine, { width: '60%', height: 12, marginTop: spacing.xs, opacity: pulseAnim }]} />

          {/* Stats Bar Skeleton */}
          <View style={[styles.statsBar, { borderColor: 'rgba(255,255,255,0.03)', marginTop: spacing.lg }]}>
            <Animated.View style={[styles.skeletonTextLine, { width: 80, height: 14, opacity: pulseAnim }]} />
            <View style={styles.statDivider} />
            <Animated.View style={[styles.skeletonTextLine, { width: 80, height: 14, opacity: pulseAnim }]} />
            <View style={styles.statDivider} />
            <Animated.View style={[styles.skeletonTextLine, { width: 80, height: 14, opacity: pulseAnim }]} />
          </View>

          {/* Buttons Skeleton */}
          <View style={styles.actionsRow}>
            <Animated.View style={[styles.skeletonBtn, { opacity: pulseAnim }]} />
            <Animated.View style={[styles.skeletonBtn, { opacity: pulseAnim }]} />
            <Animated.View style={[styles.skeletonBtnCircle, { opacity: pulseAnim }]} />
          </View>
        </View>

        {/* Content List Skeleton */}
        <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg, gap: spacing.md }}>
          <Animated.View style={[styles.skeletonContentCard, { opacity: pulseAnim }]} />
          <Animated.View style={[styles.skeletonContentCard, { opacity: pulseAnim }]} />
        </View>
      </View>
    );
  };

  return (
    <AppScreen edgeToEdge={true} scroll={false}>
      {loading ? (
        renderSkeleton()
      ) : creator ? (
        <Animated.View style={{ flex: 1, opacity: contentFadeAnim }}>
          <ScrollView style={styles.mainScrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Banner placed inside ScrollView so overlapping doesn't get clipped */}
            <View style={styles.bannerContainer}>
              {creator.cover_image_url ? (
                <Image source={{ uri: creator.cover_image_url }} style={styles.bannerImage} />
              ) : (
                <View style={styles.bannerPlaceholder} />
              )}
              {/* Back Button positioned inside the banner, so it scrolls along with the page */}
              <Pressable onPress={() => router.back()} style={[styles.backButton, { top: insets.top + spacing.xs }]}>
                <ArrowLeft size={20} color="#fff" />
              </Pressable>
            </View>

            {/* Creator Info Header Block */}
            <View style={styles.headerInfoBlock}>
              
              {/* Instagram/YouTube Hybrid row: Avatar left, stats right */}
              <View style={styles.avatarStatsRow}>
                <View style={styles.avatarContainer}>
                  {creator.avatar_url ? (
                    <Image source={{ uri: creator.avatar_url }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarPlaceholderText}>
                      {creator.display_name[0]?.toUpperCase()}
                    </Text>
                  )}
                </View>

                {stats && (
                  <View style={styles.statsContainerRight}>
                    <View style={styles.miniStatItem}>
                      <Text style={styles.miniStatVal}>{stats.followersCount.toLocaleString('pt-BR')}</Text>
                      <Text style={styles.miniStatLbl}>seguidores</Text>
                    </View>
                    <View style={styles.miniStatItem}>
                      <Text style={styles.miniStatVal}>{stats.totalViews.toLocaleString('pt-BR')}</Text>
                      <Text style={styles.miniStatLbl}>views</Text>
                    </View>
                    <View style={styles.miniStatItem}>
                      <Text style={styles.miniStatVal}>{stats.contentCount}</Text>
                      <Text style={styles.miniStatLbl}>aulas</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Name, Handle & Bio details */}
              <View style={styles.detailsBlock}>
                <View style={styles.nameRow}>
                  <Text style={styles.displayName}>{creator.display_name}</Text>
                  <CheckCircle2 size={16} color={colors.accent} style={{ marginLeft: 6 }} />
                </View>
                
                <View style={styles.handleAndLevelRow}>
                  <Text style={styles.channelName}>@{creator.creator_channel_name}</Text>
                  {stats && (
                    <View style={styles.levelBadge}>
                      <Trophy size={10} color="#fff" style={{ marginRight: 4 }} />
                      <Text style={styles.levelText}>Nível {stats.level}</Text>
                    </View>
                  )}
                </View>

                {creator.creator_bio && (
                  <Text style={styles.bioText}>{creator.creator_bio}</Text>
                )}
              </View>

              {/* Action Buttons Row */}
              <View style={styles.actionsRow}>
                {user?.id !== creator.id && (
                  <>
                    <View style={{ flex: 1, position: 'relative' }}>
                      <Animated.View style={{ transform: [{ scale: followScale }] }}>
                        <Pressable
                          onPress={handleToggleFollow}
                          style={[
                            styles.followBtn,
                            isFollowing ? styles.followBtnActive : styles.followBtnInactive,
                          ]}
                        >
                          {isFollowing ? (
                            <>
                              <Minus size={14} color="#fff" style={{ marginRight: 6 }} />
                              <Text style={styles.followBtnText}>Seguindo</Text>
                            </>
                          ) : (
                            <>
                              <Plus size={14} color="#000" style={{ marginRight: 6 }} />
                              <Text style={[styles.followBtnText, { color: '#000' }]}>Seguir</Text>
                            </>
                          )}
                        </Pressable>
                      </Animated.View>

                      {/* Render absolute particle burst over button */}
                      {particles.map((p) => (
                        <Animated.View
                          key={p.id}
                          style={[
                            styles.particle,
                            {
                              width: p.size,
                              height: p.size,
                              backgroundColor: p.color,
                              transform: [
                                { translateX: p.x },
                                { translateY: p.y },
                                { scale: p.scale },
                              ],
                              opacity: p.opacity,
                            },
                          ]}
                        />
                      ))}
                    </View>

                    <Pressable
                      onPress={() => {
                        router.push({
                          pathname: '/messages',
                          params: { recipientId: creator.id },
                        });
                      }}
                      style={styles.messageBtn}
                    >
                      <MessageCircle size={16} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={styles.messageBtnText}>Mensagem</Text>
                    </Pressable>
                  </>
                )}

                <Pressable onPress={handleShare} style={styles.shareBtn}>
                  <Share2 size={16} color="#fff" />
                </Pressable>
              </View>
            </View>

            {/* Dynamic Content Tabs - Evenly distributed full-width tabs */}
            <View style={styles.tabsRow}>
              <View style={styles.tabsContainerFullWidth}>
                <Pressable
                  onPress={() => setActiveTab('all')}
                  style={[styles.tabItemFull, activeTab === 'all' && styles.tabItemActive]}
                >
                  <Text style={[styles.tabItemText, activeTab === 'all' && styles.tabItemTextActive]}>
                    Todos
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setActiveTab('videos')}
                  style={[styles.tabItemFull, activeTab === 'videos' && styles.tabItemActive]}
                >
                  <Text style={[styles.tabItemText, activeTab === 'videos' && styles.tabItemTextActive]}>
                    Aulas
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setActiveTab('podcasts')}
                  style={[styles.tabItemFull, activeTab === 'podcasts' && styles.tabItemActive]}
                >
                  <Text style={[styles.tabItemText, activeTab === 'podcasts' && styles.tabItemTextActive]}>
                    Podcasts
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setActiveTab('shorts')}
                  style={[styles.tabItemFull, activeTab === 'shorts' && styles.tabItemActive]}
                >
                  <Text style={[styles.tabItemText, activeTab === 'shorts' && styles.tabItemTextActive]}>
                    Shorts
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setActiveTab('courses')}
                  style={[styles.tabItemFull, activeTab === 'courses' && styles.tabItemActive]}
                >
                  <Text style={[styles.tabItemText, activeTab === 'courses' && styles.tabItemTextActive]}>
                    Cursos
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Content List Grid */}
            <View style={styles.gridContainer}>
              {filteredContents.length > 0 ? (
                filteredContents.map((content) => (
                  <ContentCard key={content.id} content={content} />
                ))
              ) : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>
                    Nenhum conteúdo deste tipo encontrado.
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        </Animated.View>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  skeletonContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  skeletonBanner: {
    width: '100%',
    height: 140,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  skeletonAvatar: {
    width: 86,
    height: 86,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 3,
    borderColor: colors.background,
    marginTop: -23, // Adjusted to match margin shift
  },
  skeletonTextLine: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.sm,
  },
  skeletonBtn: {
    flex: 1,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  skeletonBtnCircle: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  skeletonContentCard: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  bannerContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    position: 'relative',
    backgroundColor: '#1c1917',
    zIndex: 1,
  },
  bannerImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  bannerPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  backButton: {
    position: 'absolute',
    left: spacing.lg,
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    zIndex: 50, // Higher zIndex so it floats above banner contents
  },
  mainScrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.section * 2,
  },
  headerInfoBlock: {
    paddingHorizontal: spacing.lg,
    marginTop: -23, // Decreased shift so content sits 20px lower, giving breathing room
    marginBottom: spacing.md,
    zIndex: 10, // Ensure header info draws on top of banner
    elevation: 10,
  },
  avatarStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  avatarContainer: {
    width: 86,
    height: 86,
    borderRadius: radius.full,
    borderWidth: 3,
    borderColor: colors.background,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholderText: {
    color: '#000',
    fontSize: 32,
    fontWeight: 'bold',
  },
  statsContainerRight: {
    flexDirection: 'row',
    flex: 1,
    justifyContent: 'space-around',
    marginLeft: spacing.lg,
    paddingTop: 10, // adjusted downward offset
  },
  miniStatItem: {
    alignItems: 'center',
  },
  miniStatVal: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  miniStatLbl: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 2,
  },
  detailsBlock: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  displayName: {
    color: colors.text,
    fontSize: 20,
    fontWeight: typography.weightBold,
  },
  handleAndLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  channelName: {
    color: colors.muted,
    fontSize: 13,
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  levelText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  bioText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  statDivider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  followBtn: {
    width: '100%',
    height: 38,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtnInactive: {
    backgroundColor: colors.accent,
  },
  followBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
  },
  followBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  messageBtn: {
    flex: 1,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  shareBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    borderRadius: radius.full,
    alignSelf: 'center',
    top: '30%',
    pointerEvents: 'none',
  },
  tabsRow: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    marginBottom: spacing.md,
  },
  tabsContainerFullWidth: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  tabItemFull: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: colors.accent,
  },
  tabItemText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: 'bold',
  },
  tabItemTextActive: {
    color: colors.accent,
  },
  gridContainer: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  emptyCard: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
  },
});

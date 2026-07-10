import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface Skill {
  image_url: string;
  title: string;
  description: string;
}

interface FeaturedCreatorData {
  id: string;
  creator_id: string;
  background_image_url: string;
  hero_image_url: string | null;
  badge_text: string;
  featured_image_url: string;
  description: string;
  link_url: string;
  slug: string;
  short_bio: string | null;
  total_videos: number;
  total_duration_seconds: number;
  commission_link: string | null;
  skills: Skill[];
  trailer_url: string | null;
  creator_name: string;
  avatar_url: string | null;
}

export default function FeaturedCreatorLandingScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [creator, setCreator] = useState<FeaturedCreatorData | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const [containerOffsetY, setContainerOffsetY] = useState(650);
  const [isTrailerPlaying, setIsTrailerPlaying] = useState(false);

  // Animations configuration
  const footerTranslateY = scrollY.interpolate({
    inputRange: [0, 200, 280],
    outputRange: [120, 120, 0],
    extrapolate: 'clamp',
  });

  // Configure navigation options
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  useEffect(() => {
    if (slug) {
      fetchCreator();
    }
  }, [slug]);

  const fetchCreator = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('featured_creators')
        .select(`
          *,
          profiles:creator_id (
            display_name,
            creator_channel_name,
            avatar_url
          )
        `)
        .eq('slug', slug)
        .single();

      if (error || !data) {
        console.error('Creator not found:', error);
        Alert.alert('Erro', 'Criador em destaque não encontrado.');
        router.back();
        return;
      }

      setCreator({
        ...data,
        creator_name: data.profiles?.creator_channel_name || data.profiles?.display_name || 'Creator',
        avatar_url: data.profiles?.avatar_url || null,
        skills: Array.isArray(data.skills) ? (data.skills as unknown as Skill[]) : [],
      });
    } catch (error) {
      console.error('Error fetching creator:', error);
      Alert.alert('Erro', 'Ocorreu um erro ao carregar os dados.');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    if (creator?.commission_link) {
      try {
        await WebBrowser.openBrowserAsync(creator.commission_link);
      } catch (e) {
        console.error('Error opening commission link:', e);
      }
    } else {
      router.push('/premium');
    }
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  if (loading) {
    return (
      <AppScreen scroll={false}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </AppScreen>
    );
  }

  if (!creator) return null;

  return (
    <AppScreen scroll={false} edgeToEdge={true}>
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        {/* Full-bleed Hero Visual Cover with seamless gradient fade */}
        <View style={styles.heroWrapper}>
          <Image
            source={{ uri: creator.hero_image_url || creator.background_image_url }}
            style={styles.heroImage}
            contentFit="cover"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.35)', '#000000']}
            style={StyleSheet.absoluteFillObject}
          />
          {/* Header Back Button inside Hero (scrolls with page) */}
          <Pressable 
            onPress={() => router.back()} 
            style={[styles.backBtnCircle, { top: insets.top + spacing.xs }]}
          >
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </Pressable>
        </View>

        <View style={styles.heroOverlayContent}>
          {creator.featured_image_url ? (
            <Image
              source={{ uri: creator.featured_image_url }}
              style={styles.creatorLogo}
              contentFit="contain"
            />
          ) : (
            <Text style={styles.creatorName}>@{creator.creator_name}</Text>
          )}

          <Text style={styles.creatorTagline}>{creator.description}</Text>

          {creator.short_bio ? (
            <Text style={styles.creatorShortBio} numberOfLines={3}>
              {creator.short_bio}
            </Text>
          ) : null}
        </View>

        {/* Dynamic Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Ionicons name="videocam-outline" size={18} color={colors.accent} />
            <Text style={styles.statValue}>{creator.total_videos}</Text>
            <Text style={styles.statLabel}>Aulas</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="time-outline" size={18} color={colors.accent} />
            <Text style={styles.statValue}>{formatDuration(creator.total_duration_seconds)}</Text>
            <Text style={styles.statLabel}>Conteúdo</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="ribbon-outline" size={18} color={colors.accent} />
            <Text style={styles.statValue}>100%</Text>
            <Text style={styles.statLabel}>Completo</Text>
          </View>
        </View>

        {/* Subscription Box - Mobile */}
        <View style={styles.subCardContainer}>
          <View style={styles.subCardHeader}>
            <View style={styles.avatarOverlapContainer}>
              {[
                "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=face",
                "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face",
                "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=100&h=100&fit=crop&crop=face",
                "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face"
              ].map((src, i) => (
                <Image
                  key={i}
                  source={{ uri: src }}
                  style={[styles.overlapAvatar, { marginLeft: i > 0 ? -12 : 0 }]}
                />
              ))}
            </View>
            <Text style={styles.subCardStudentsText}>+200 alunos já assinaram</Text>
          </View>

          <Text style={styles.subCardTitle}>
            Assine e tenha acesso completo aos conteúdos de {creator.creator_name} e todos os outros creators.
          </Text>

          <Text style={styles.subCardSubtitle}>
            Acesso ilimitado a todas as aulas, materiais exclusivos e certificado de conclusão.
          </Text>

          <Pressable
            onPress={handleSubscribe}
            style={({ pressed }) => [
              styles.subCardButton,
              pressed && { opacity: 0.85 }
            ]}
          >
            <Text style={styles.subCardButtonText}>Assinar Agora</Text>
          </Pressable>

          <Text style={styles.subCardPriceNote}>
            A partir de <Text style={{ textDecorationLine: 'line-through' }}>R$ 59</Text> R$ 29 por mês para aulas do plano Pro
          </Text>
        </View>

        {/* Masterclass editorial details */}
        <View style={styles.contentBody}>
          <Text style={styles.sectionTitle}>Sobre o Instrutor</Text>
          <Text style={styles.editorialDescription}>
            {creator.description}
          </Text>

          {/* Trailer Section */}
          {creator.trailer_url ? (
            <View style={styles.trailerSection}>
              <Text style={styles.sectionTitle}>Assista ao Trailer</Text>
              <View style={styles.playerContainer}>
                {isTrailerPlaying ? (
                  <Video
                    source={{ uri: creator.trailer_url }}
                    rate={1.0}
                    volume={1.0}
                    isMuted={false}
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay={true}
                    useNativeControls
                    style={styles.videoPlayer}
                  />
                ) : (
                  <Pressable
                    onPress={() => setIsTrailerPlaying(true)}
                    style={styles.videoPosterContainer}
                  >
                    <Image
                      source={{ uri: creator.hero_image_url || creator.background_image_url }}
                      style={styles.videoPoster}
                      contentFit="cover"
                    />
                    <View style={styles.playOverlay}>
                      <Ionicons name="play" size={32} color="#FFF" />
                    </View>
                    <View style={styles.trailerBadge}>
                      <Text style={styles.trailerBadgeText}>Trailer</Text>
                    </View>
                  </Pressable>
                )}
              </View>
            </View>
          ) : null}
        </View>

        {/* Skills list with cascading sticky stack effect */}
        {creator.skills.length > 0 ? (
          <View
            onLayout={(e) => setContainerOffsetY(e.nativeEvent.layout.y)}
            style={styles.skillsSection}
          >
            <Text style={styles.sectionTitleSticky}>
              O que você vai aprender
            </Text>

            <View style={styles.skillsAnimatedContainer}>
              {creator.skills.map((skill, idx) => {
                const CARD_HEIGHT = 280;
                const HEADER_HEIGHT = 60;
                const MARGIN_BOTTOM = 12;
                const TITLE_HEIGHT = 48;
                const DOCK_SCROLL = containerOffsetY - insets.top + TITLE_HEIGHT + idx * (CARD_HEIGHT + MARGIN_BOTTOM - HEADER_HEIGHT);
                const safeDock = Math.max(1, DOCK_SCROLL);
                const fadeStart = safeDock - 60;
                const fadeEnd = safeDock;

                const cardTranslateY = scrollY.interpolate({
                  inputRange: [0, safeDock, safeDock + 1],
                  outputRange: [0, 0, 1],
                });

                const bottomOpacity = scrollY.interpolate({
                  inputRange: [0, Math.max(0.5, fadeStart), Math.max(1, fadeEnd)],
                  outputRange: [1, 1, 0],
                  extrapolate: 'clamp',
                });

                const topOpacity = scrollY.interpolate({
                  inputRange: [0, Math.max(0.5, fadeStart), Math.max(1, fadeEnd)],
                  outputRange: [0, 0, 1],
                  extrapolate: 'clamp',
                });

                return (
                  <Animated.View
                    key={idx}
                    style={[
                      styles.animatedCard,
                      {
                        height: CARD_HEIGHT,
                        zIndex: idx,
                        transform: [{ translateY: cardTranslateY }],
                      },
                    ]}
                  >
                    {skill.image_url ? (
                      <Image source={{ uri: skill.image_url }} style={styles.skillCardBg} contentFit="cover" />
                    ) : (
                      <View style={styles.skillImagePlaceholder}>
                        <Ionicons name="book-outline" size={24} color={colors.muted} />
                      </View>
                    )}

                    <LinearGradient
                      colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.85)']}
                      style={StyleSheet.absoluteFillObject}
                    />

                    {/* Header Strip with Circle Number & Top Title (fades in when docked) */}
                    <View style={styles.skillHeaderStrip}>
                      <View style={styles.numberCircle}>
                        <Text style={styles.numberCircleText}>{idx + 1}</Text>
                      </View>
                      <Animated.Text style={[styles.skillTopTitle, { opacity: topOpacity }]} numberOfLines={1}>
                        {skill.title}
                      </Animated.Text>
                    </View>

                    {/* Bottom Center Content (fades out when docked) */}
                    <Animated.View style={[styles.skillBottomContainer, { opacity: bottomOpacity }]}>
                      <Text style={styles.skillBottomTitle} numberOfLines={2}>
                        {skill.title}
                      </Text>
                      {skill.description ? (
                        <Text style={styles.skillBottomDesc} numberOfLines={2}>
                          {skill.description}
                        </Text>
                      ) : null}
                    </Animated.View>
                  </Animated.View>
                );
              })}
            </View>
          </View>
        ) : null}
      </Animated.ScrollView>

      {/* Pinned conversion Sticky Footer */}
      <Animated.View style={[styles.stickyFooter, { transform: [{ translateY: footerTranslateY }], paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.footerLeft}>
          <Text style={styles.footerPriceLabel}>ACESSO ILIMITADO</Text>
          <View style={styles.footerPriceRow}>
            <Text style={styles.footerPrice}>R$ 39,90</Text>
            <Text style={styles.footerPeriod}>/mês</Text>
          </View>
        </View>
        <Pressable
          onPress={handleSubscribe}
          style={({ pressed }) => [
            styles.footerBtn,
            pressed && { opacity: 0.85 }
          ]}
        >
          <Text style={styles.footerBtnText}>Começar agora</Text>
        </Pressable>
      </Animated.View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  backBtnCircle: {
    position: 'absolute',
    left: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    zIndex: 100,
  },
  scrollContent: {
    paddingBottom: 130, // Extra space to clear sticky footer
  },
  heroWrapper: {
    width: '100%',
    aspectRatio: 16 / 9,
    position: 'relative',
    backgroundColor: '#000',
    justifyContent: 'flex-end',
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  heroOverlayContent: {
    paddingHorizontal: spacing.lg,
    marginTop: -52,
    marginBottom: spacing.md,
    zIndex: 10,
    gap: spacing.sm,
    alignItems: 'center',
  },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 4,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  creatorLogo: {
    width: '80%',
    height: 128,
  },
  creatorName: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: typography.weightBold,
    textAlign: 'center',
  },
  creatorTagline: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  creatorShortBio: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
  },
  subCardContainer: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  subCardHeader: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  avatarOverlapContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overlapAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#000',
  },
  subCardStudentsText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
  },
  subCardTitle: {
    color: '#FFF',
    fontSize: 14.5,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 6,
  },
  subCardSubtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 15,
    marginBottom: spacing.md,
  },
  subCardButton: {
    backgroundColor: colors.accent,
    width: '100%',
    height: 44,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  subCardButtonText: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  subCardPriceNote: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.05)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: spacing.md,
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  statItem: {
    alignItems: 'center',
    gap: 3,
  },
  statValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weightBold,
  },
  statLabel: {
    color: colors.muted,
    fontSize: 10.5,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  contentBody: {
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weightBold,
    marginBottom: spacing.sm,
  },
  sectionTitleSticky: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    marginBottom: spacing.md,
    backgroundColor: '#000',
    paddingVertical: 10,
    zIndex: 30,
  },
  editorialDescription: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  trailerSection: {
    marginBottom: spacing.xl,
  },
  playerContainer: {
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    position: 'relative',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
  },
  trailerBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 10,
  },
  trailerBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
  },
  skillsSection: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  skillsAnimatedContainer: {
    position: 'relative',
    width: '100%',
  },
  animatedCard: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    marginBottom: 12,
  },
  skillCardBg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  skillImagePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skillHeaderStrip: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    zIndex: 20,
    position: 'relative',
  },
  numberCircle: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberCircleText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900',
  },
  skillTopTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    marginLeft: spacing.sm,
    flex: 1,
  },
  skillBottomContainer: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 15,
  },
  skillBottomTitle: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },
  skillBottomDesc: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },
  stickyFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(9,9,11,0.94)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 14,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLeft: {
    flex: 1,
  },
  footerPriceLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 2,
  },
  footerPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  footerPrice: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: typography.weightBlack,
  },
  footerPeriod: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginLeft: 2,
    fontWeight: '600',
  },
  footerBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  videoPosterContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPoster: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(226,29,72,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
    zIndex: 5,
  },
});

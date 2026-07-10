import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { AVPlaybackStatus } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];

import { ClassfyVideoPlayer, ClassfyVideoPlayerRef } from '@/components/ClassfyVideoPlayer';
import { WatchCommentsSheet } from '@/components/WatchCommentsSheet';
import { WatchDescriptionSheet } from '@/components/WatchDescriptionSheet';
import { WatchRewardBar } from '@/components/WatchRewardBar';
import { WatchStudySheet } from '@/components/WatchStudySheet';
import { useAuth } from '@/features/auth/authContext';
import { useMiniPlayer } from '@/features/watch/miniPlayerContext';
import { useCourseLessons } from '@/features/watch/useCourseLessons';
import { useWatchActions } from '@/features/watch/useWatchActions';
import { useWatchContent } from '@/features/watch/useWatchContent';
import { useWatchProgress } from '@/features/watch/useWatchProgress';
import { useWatchRelated, type WatchRelatedItem } from '@/features/watch/useWatchRelated';
import { useBottomSheetScroll } from '@/hooks/useBottomSheetScroll';
import { trackUserInteraction } from '@/lib/interests';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

function formatCount(value?: number | null) {
  if (!value) return '0';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

function formatDuration(seconds?: number | null) {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatType(type?: string | null, isCourse?: boolean) {
  if (isCourse) return 'Curso';
  if (type === 'podcast') return 'Podcast';
  if (type === 'short') return 'Short';
  if (type === 'live') return 'Live';
  return 'Aula';
}

function blockCopy(reason: string | null, requiredPlan: string) {
  if (reason === 'purchase') return 'Compre este conteudo para assistir no mobile.';
  if (reason === 'login') return `Entre com uma conta ${requiredPlan.toUpperCase()} ou superior para assistir.`;
  if (reason === 'plan') return `Este conteudo exige plano ${requiredPlan.toUpperCase()}.`;
  return 'Acesso indisponivel.';
}

export default function WatchScreen() {
  const { id, studyId } = useLocalSearchParams<{ id: string; studyId?: string }>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [studySheetOpen, setStudySheetOpen] = useState(false);
  const [studyInitialTab, setStudyInitialTab] = useState<'notes' | 'transcript' | 'quiz' | 'suggestions' | 'classy' | 'modules'>('notes');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const playerRef = useRef<ClassfyVideoPlayerRef>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  const handleFullscreenToggle = async (fullscreen: boolean) => {
    setIsFullscreen(fullscreen);
    if (fullscreen) {
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
      StatusBar.setHidden(true, 'fade');
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } else {
      StatusBar.setHidden(false, 'fade');
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    }
  };

  useEffect(() => {
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => { });
      StatusBar.setHidden(false, 'fade');
    };
  }, []);
  const dragY = useRef(new Animated.Value(0)).current;
  const currentPositionMillisRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const { startMiniPlayer } = useMiniPlayer();
  const { content, access, followersCount, loading, error } = useWatchContent(id);
  const courseLessons = useCourseLessons({
    courseId: content?.isCourse ? content.id : undefined,
    enabled: Boolean(content?.isCourse && access.hasAccess),
  });
  const related = useWatchRelated({
    contentId: content?.id,
    categoryId: content?.category_id,
    contentType: content?.content_type,
    tags: content?.tags,
  });
  const actions = useWatchActions({
    contentId: content?.id,
    isCourse: content?.isCourse,
    initialLikes: content?.likes_count,
    hasAccess: access.hasAccess,
  });
  const progress = useWatchProgress({
    contentId: content?.isCourse && courseLessons.currentLesson
      ? courseLessons.currentLesson.content_id || courseLessons.currentLesson.id
      : content?.id,
    durationSeconds: content?.isCourse && courseLessons.currentLesson
      ? courseLessons.currentLesson.duration_seconds
      : content?.duration_seconds,
    enabled: Boolean(
      access.hasAccess &&
      (content?.isCourse
        ? courseLessons.currentLesson?.video_url
        : content?.file_url)
    ),
  });

  const { user } = useAuth();

  const [isFollowing, setIsFollowing] = useState(false);
  const [togglingFollow, setTogglingFollow] = useState(false);
  const [watchFollowers, setWatchFollowers] = useState(followersCount || 0);

  const followScale = useRef(new Animated.Value(1)).current;
  const [followParticles, setFollowParticles] = useState<any[]>([]);

  // Study summary is now handled internally by WatchRewardBar

  useEffect(() => {
    setWatchFollowers(followersCount || 0);
  }, [followersCount]);

  useEffect(() => {
    async function checkFollow() {
      if (user && content?.creator?.id) {
        const { data } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', user.id)
          .eq('following_id', content.creator.id)
          .maybeSingle();
        setIsFollowing(!!data);
      }
    }
    checkFollow();
  }, [content, user]);

  useEffect(() => {
    if (content?.isCourse && courseLessons.currentLesson && progress.watchPercent >= 90) {
      courseLessons.markLessonComplete(courseLessons.currentLesson.id);
    }
  }, [content?.isCourse, courseLessons.currentLesson?.id, progress.watchPercent, courseLessons]);

  useEffect(() => {
    if (content?.isCourse) {
      setStudyInitialTab('modules');
    }
  }, [content?.isCourse]);

  const handleToggleFollow = async () => {
    if (!user) {
      Alert.alert('Login necessário', 'Entre na Classfy para seguir os creators.');
      return;
    }
    if (!content?.creator?.id || togglingFollow) return;

    // Trigger fast discrete pulse
    Animated.sequence([
      Animated.timing(followScale, { toValue: 0.95, duration: 70, useNativeDriver: true }),
      Animated.timing(followScale, { toValue: 1.05, duration: 90, useNativeDriver: true }),
      Animated.timing(followScale, { toValue: 1.0, duration: 70, useNativeDriver: true }),
    ]).start();

    // Optimistic UI updates
    const previousFollowingState = isFollowing;
    setIsFollowing(!previousFollowingState);
    setWatchFollowers((f) => !previousFollowingState ? f + 1 : Math.max(0, f - 1));

    if (!previousFollowingState) {
      // Trigger burst
      const particleCount = 10;
      const newParticles = Array.from({ length: particleCount }, (_, i) => {
        const angle = (360 / particleCount) * i + Math.random() * 30 - 15;
        const distance = 40 + Math.random() * 25;
        const radians = (angle * Math.PI) / 180;
        const targetX = Math.cos(radians) * distance;
        const targetY = Math.sin(radians) * distance;

        const x = new Animated.Value(0);
        const y = new Animated.Value(0);
        const scale = new Animated.Value(0);
        const opacity = new Animated.Value(1);

        Animated.parallel([
          Animated.timing(x, { toValue: targetX, duration: 500, useNativeDriver: true }),
          Animated.timing(y, { toValue: targetY, duration: 500, useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(scale, { toValue: 1.2, duration: 150, useNativeDriver: true }),
            Animated.timing(scale, { toValue: 0.6, duration: 350, useNativeDriver: true }),
          ]),
          Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        ]).start();

        return {
          id: Math.random() + i,
          x,
          y,
          scale,
          opacity,
          size: 5 + Math.random() * 4,
          color: i % 2 === 0 ? colors.accent : '#f43f5e',
        };
      });

      setFollowParticles(newParticles);
      setTimeout(() => setFollowParticles([]), 550);
    }

    setTogglingFollow(true);
    try {
      if (previousFollowingState) {
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', content.creator.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('follows')
          .insert({
            follower_id: user.id,
            following_id: content.creator.id,
          });
        if (error) throw error;

        try {
          await supabase.functions.invoke('handle-follow-reward', {
            body: { followerId: user.id, followingId: content.creator.id }
          });
        } catch (e) { }
      }
    } catch (err) {
      console.error('Error toggling follow:', err);
      setIsFollowing(previousFollowingState);
      setWatchFollowers((f) => previousFollowingState ? f + 1 : Math.max(0, f - 1));
      Alert.alert('Erro', 'Não foi possível atualizar o estado de seguir. Verifique sua conexão.');
    } finally {
      setTogglingFollow(false);
    }
  };

  // Track view click interaction
  useEffect(() => {
    if (content) {
      trackUserInteraction(user?.id, 'click', content.tags, content.category_id);
    }
  }, [content?.id, user?.id]);

  // Track like action
  useEffect(() => {
    if (actions.isLiked && content) {
      trackUserInteraction(user?.id, 'like', content.tags, content.category_id);
    }
  }, [actions.isLiked, user?.id]);

  // Track save action
  useEffect(() => {
    if (actions.isSaved && content) {
      trackUserInteraction(user?.id, 'save', content.tags, content.category_id);
    }
  }, [actions.isSaved, user?.id]);

  const hasSoughtRef = useRef(false);

  // Reset sought flag when content ID changes
  useEffect(() => {
    hasSoughtRef.current = false;
  }, [content?.id]);

  // Redirect paid content to dedicated purchase screen if they lack access
  useEffect(() => {
    if (access && !access.hasAccess && access.reason === 'purchase' && id) {
      router.replace(`/purchase/${id}`);
    }
  }, [access, id]);

  const handlePlayerStatus = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    currentPositionMillisRef.current = status.positionMillis;
    wasPlayingRef.current = status.isPlaying;

    if (
      !hasSoughtRef.current &&
      status.isLoaded &&
      progress.savedPositionSeconds !== null &&
      progress.savedPositionSeconds > 0
    ) {
      hasSoughtRef.current = true;
      playerRef.current?.seekTo(progress.savedPositionSeconds);
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) dragY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          const minimizeThreshold = Dimensions.get('window').height * 0.42;
          const shouldMinimize = gesture.dy > minimizeThreshold || gesture.vy > 1.2;

          if (shouldMinimize && content) {
            startMiniPlayer({
              id: content.id,
              title: content.title,
              fileUrl: content.file_url,
              thumbnailUrl: content.thumbnail_url,
              creatorName:
                content.creator?.creator_channel_name ||
                content.creator?.display_name ||
                'Creator Classfy',
              durationSeconds: content.duration_seconds,
              startPositionMillis: currentPositionMillisRef.current,
              shouldPlay: wasPlayingRef.current,
            });
            dragY.setValue(0);
            if (router.canGoBack()) router.back();
            else router.replace('/');
            return;
          }

          Animated.spring(dragY, {
            toValue: 0,
            friction: 8,
            tension: 80,
            useNativeDriver: true,
          }).start();
        },
      }),
    [content, dragY, startMiniPlayer],
  );

  if (loading) {
    return (
      <View style={styles.stateScreen}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.centerText}>Carregando Watch...</Text>
        </View>
      </View>
    );
  }

  if (error || !content) {
    return (
      <View style={styles.stateScreen}>
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>Conteudo indisponivel</Text>
          <Text style={styles.centerText}>{error || 'Nao foi possivel carregar este conteudo.'}</Text>
          <Pressable style={styles.primaryButton} onPress={() => router.back()}>
            <Text style={styles.primaryButtonText}>Voltar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const activeVideoUrl = content.isCourse
    ? courseLessons.currentLesson?.video_url
    : content.file_url;
  const showPlayableVideo = Boolean(access.hasAccess && activeVideoUrl);
  const creatorName = content.creator?.creator_channel_name || content.creator?.display_name || 'Creator Classfy';
  const minimizeThreshold = Dimensions.get('window').height * 0.42;
  const overlayStyle = {
    borderRadius: isFullscreen
      ? 0
      : dragY.interpolate({
        inputRange: [0, 140],
        outputRange: [0, 24],
        extrapolate: 'clamp',
      }),
    transform: isFullscreen
      ? [{ translateY: 0 }, { scale: 1 }]
      : [
        { translateY: dragY },
        {
          scale: dragY.interpolate({
            inputRange: [0, minimizeThreshold],
            outputRange: [1, 0.86],
            extrapolate: 'clamp',
          }),
        },
      ],
  };
  const contentOpacity = dragY.interpolate({
    inputRange: [0, 24, minimizeThreshold * 0.62],
    outputRange: [1, 0.12, 0],
    extrapolate: 'clamp',
  });
  const contentLift = dragY.interpolate({
    inputRange: [0, 18],
    outputRange: [0, -(insets.top + spacing.sm)],
    extrapolate: 'clamp',
  });


  return (
    <View style={styles.modalRoot}>
      <Animated.View style={[styles.overlaySurface, overlayStyle, isFullscreen && { backgroundColor: '#000' }]}>
        <ScrollView
          ref={scrollViewRef}
          bounces={false}
          scrollEnabled={!isFullscreen}
          style={isFullscreen ? { flex: 1, height: '100%', width: '100%', backgroundColor: '#000' } : undefined}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: isFullscreen ? 0 : insets.top + spacing.sm,
              paddingBottom: isFullscreen ? 0 : insets.bottom + spacing.section,
            },
            isFullscreen && { flex: 1, height: '100%', width: '100%', paddingBottom: 0 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              { transform: [{ translateY: isFullscreen ? 0 : contentLift }] },
              isFullscreen && { height: windowHeight, width: '100%', justifyContent: 'center', backgroundColor: '#000' },
            ]}
          >
            <View
              style={[
                styles.playerShell,
                isFullscreen && { height: windowHeight, aspectRatio: 16 / 9, width: undefined, alignSelf: 'center' },
              ]}
              {...(isFullscreen ? {} : panResponder.panHandlers)}
            >
              <View
                style={[
                  styles.player,
                  isFullscreen && { height: windowHeight, aspectRatio: 16 / 9, width: undefined, alignSelf: 'center' },
                ]}
              >
                {showPlayableVideo ? (
                  <ClassfyVideoPlayer
                    ref={playerRef}
                    src={activeVideoUrl!}
                    poster={content.thumbnail_url}
                    title={content.isCourse && courseLessons.currentLesson ? courseLessons.currentLesson.title : content.title}
                    creatorName={creatorName}
                    onMinimize={() => {
                      startMiniPlayer({
                        id: content.id,
                        title: content.isCourse && courseLessons.currentLesson ? courseLessons.currentLesson.title : content.title,
                        fileUrl: activeVideoUrl,
                        thumbnailUrl: content.thumbnail_url,
                        creatorName,
                        durationSeconds: content.isCourse && courseLessons.currentLesson ? courseLessons.currentLesson.duration_seconds : content.duration_seconds,
                        startPositionMillis: currentPositionMillisRef.current,
                        shouldPlay: wasPlayingRef.current,
                      });
                      if (router.canGoBack()) router.back();
                      else router.replace('/');
                    }}
                    onNotesPress={() => {
                      setStudyInitialTab('notes');
                      setStudySheetOpen(true);
                    }}
                    onPlaybackPosition={progress.handlePlaybackPosition}
                    onStatusUpdate={handlePlayerStatus}
                    isFullscreen={isFullscreen}
                    onFullscreenToggle={handleFullscreenToggle}
                    playbackRate={playbackRate}
                    onControlsPress={() => setSettingsOpen(true)}
                    isLiked={actions.isLiked}
                    likesCount={actions.likesCount}
                    onLikePress={actions.toggleLike}
                    isSaved={actions.isSaved}
                    onSavePress={actions.toggleSave}
                    isFavorited={actions.isFavorited}
                    onFavoritePress={actions.toggleFavorite}
                    onCommentsPress={() => setCommentsOpen(true)}
                    onSharePress={() => { }}
                    onStudyPress={(tab) => {
                      setStudyInitialTab(tab);
                      setStudySheetOpen(true);
                    }}
                  />
                ) : (
                  <>
                    {content.thumbnail_url ? <Image source={{ uri: content.thumbnail_url }} style={styles.poster} /> : null}
                    <View style={styles.posterOverlay} />
                    <View style={styles.playBadge}>
                      <Ionicons name={access.hasAccess ? 'play' : 'lock-closed'} color={colors.background} size={36} />
                    </View>
                    <Text style={styles.playerBadge}>{formatType(content.content_type, content.isCourse)}</Text>
                  </>
                )}
                {!isFullscreen && (
                  <View style={styles.dragCapture} pointerEvents="box-none" {...panResponder.panHandlers}>
                    <View style={styles.dragHandle} />
                  </View>
                )}
              </View>
            </View>

            {!isFullscreen && (
              <Animated.View style={[styles.body, { opacity: contentOpacity }]}>
                <WatchRewardBar
                  contentId={content.id}
                  studyId={studyId}
                  studyTitle={content.title}
                  liveStates={{
                    isLiked: actions.isLiked,
                    isSaved: actions.isSaved,
                    isFavorited: actions.isFavorited,
                  }}
                  milestones={progress.milestones}
                  watchPercent={progress.watchPercent}
                />
                {!access.hasAccess ? (
                  <View style={styles.accessPanel}>
                    <Text style={styles.accessTitle}>Acesso bloqueado</Text>
                    <Text style={styles.accessBody}>{blockCopy(access.reason, access.requiredPlan)}</Text>
                    <Pressable
                      onPress={() => router.push('/premium')}
                      style={({ pressed }) => [
                        styles.upgradeBtn,
                        pressed && { opacity: 0.8 }
                      ]}
                    >
                      <Text style={styles.upgradeBtnText}>Fazer Upgrade de Plano</Text>
                    </Pressable>
                  </View>
                ) : null}

                <View style={styles.titleBlock}>
                  {content.isCourse && (
                    <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>
                      CURSO: {content.title.toUpperCase()}
                    </Text>
                  )}
                  <Text style={styles.title}>
                    {content.isCourse && courseLessons.currentLesson
                      ? courseLessons.currentLesson.title
                      : content.title}
                  </Text>
                  <View style={styles.typeRow}>
                    <View style={styles.typeBadge}>
                      <Text style={styles.typeBadgeText}>
                        {formatType(content.content_type, content.isCourse).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.visibilityBadge}>
                      <Text style={styles.visibilityBadgeText}>
                        {content.visibility.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.viewsMeta}>
                      {formatCount(content.views_count)} views
                    </Text>
                  </View>
                </View>

                <View style={styles.creatorRow}>
                  <Pressable
                    onPress={() => {
                      if (content?.creator?.creator_channel_name) {
                        router.push(`/creator/@${content.creator.creator_channel_name}`);
                      } else if (content?.creator_id) {
                        router.push(`/creator/${content.creator_id}`);
                      }
                    }}
                    style={styles.creatorLeft}
                  >
                    <View style={styles.avatar}>
                      {content.creator?.avatar_url ? (
                        <Image source={{ uri: content.creator.avatar_url }} style={styles.avatarImage} />
                      ) : (
                        <Text style={styles.avatarText}>{creatorName[0] || 'C'}</Text>
                      )}
                    </View>
                    <View style={styles.creatorCopy}>
                      <View style={styles.creatorNameRow}>
                        <Text numberOfLines={1} style={styles.creatorName}>
                          {creatorName}
                        </Text>
                        <Ionicons name="checkmark-circle" color="#3B82F6" size={17} />
                      </View>
                      <Text style={styles.creatorMeta}>{formatCount(watchFollowers)} seguidores</Text>
                    </View>
                  </Pressable>

                  {user && content?.creator?.id && user.id !== content.creator.id && (
                    <View style={{ position: 'relative' }}>
                      <Animated.View style={{ transform: [{ scale: followScale }] }}>
                        <Pressable
                          onPress={handleToggleFollow}
                          style={[
                            styles.followButton,
                            isFollowing ? styles.followButtonActive : styles.followButtonInactive,
                          ]}
                        >
                          <Ionicons
                            name={isFollowing ? 'person-remove-outline' : 'person-add-outline'}
                            size={14}
                            color={isFollowing ? colors.text : '#FFF'}
                            style={{ marginRight: 6 }}
                          />
                          <Text style={[styles.followButtonText, isFollowing && styles.followButtonTextActive]}>
                            {isFollowing ? 'Seguindo' : 'Seguir'}
                          </Text>
                        </Pressable>
                      </Animated.View>

                      {/* Follow Particles */}
                      {followParticles.map((p) => (
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
                  )}
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
                  <ActionButton
                    icon={actions.isLiked ? 'thumbs-up' : 'thumbs-up-outline'}
                    label={formatCount(actions.likesCount)}
                    active={actions.isLiked}
                    onPress={actions.toggleLike}
                  />
                  <ActionButton
                    icon={actions.isSaved ? 'bookmark' : 'bookmark-outline'}
                    label="Salvar"
                    active={actions.isSaved}
                    onPress={actions.toggleSave}
                  />
                  <ActionButton
                    icon={actions.isFavorited ? 'star' : 'star-outline'}
                    label="Favorito"
                    active={actions.isFavorited}
                    onPress={actions.toggleFavorite}
                  />
                  <ActionButton icon="chatbubble-outline" label="Comentarios" onPress={() => setCommentsOpen(true)} />
                  <ActionButton icon="share-social-outline" label="Compartilhar" onPress={() => { }} />
                </ScrollView>

                <Pressable style={styles.descriptionCard} onPress={() => setDescriptionOpen(true)}>
                  <Text style={styles.descriptionMeta}>
                    {formatCount(content.views_count)} views
                    {content.tags?.length ? `  ${content.tags.slice(0, 3).map((tag) => `#${tag}`).join(' ')}` : ''}
                  </Text>
                  <Text numberOfLines={2} style={styles.descriptionText}>
                    {(content.isCourse && courseLessons.currentLesson
                      ? courseLessons.currentLesson.description
                      : content.description) || 'Sem descrição disponível.'}
                  </Text>
                  <View style={styles.moreRow}>
                    <Text style={styles.moreText}>...mais</Text>
                    <Ionicons name="chevron-down" color={colors.muted} size={16} />
                  </View>
                </Pressable>

                <WatchStudyTools
                  isCourse={content.isCourse}
                  studyId={studyId}
                  onToolPress={(tab) => {
                    setStudyInitialTab(tab);
                    setStudySheetOpen(true);
                  }}
                />



                <Pressable style={styles.commentsRow} onPress={() => setCommentsOpen(true)}>
                  <View style={styles.rowTitle}>
                    <Ionicons name="chatbubble-outline" color={colors.muted} size={23} />
                    <Text style={styles.rowTitleText}>Comentarios</Text>
                  </View>
                  <Ionicons name="chevron-down" color={colors.muted} size={22} />
                </Pressable>

                <WatchRelatedList items={related.items} loading={related.loading} />
              </Animated.View>
            )}
          </Animated.View>
        </ScrollView>
      </Animated.View>

      <WatchDescriptionSheet
        visible={descriptionOpen}
        title={content.title}
        description={content.description}
        viewsCount={content.views_count}
        likesCount={actions.likesCount}
        createdAt={content.created_at}
        creatorName={creatorName}
        tags={content.tags}
        onClose={() => setDescriptionOpen(false)}
      />
      <WatchCommentsSheet visible={commentsOpen} contentId={content.id} onClose={() => setCommentsOpen(false)} />
      <WatchStudySheet
        visible={studySheetOpen}
        contentId={content.id}
        contentTitle={content.title}
        isCourse={content.isCourse}
        lessonId={content.isCourse && courseLessons.currentLesson ? courseLessons.currentLesson.id : null}
        initialTab={studyInitialTab}
        studyId={studyId}
        courseModules={courseLessons.modules}
        completedLessons={courseLessons.completedLessons}
        onSelectLesson={(lesson) => {
          courseLessons.selectLesson(lesson);
          setStudySheetOpen(false);
        }}
        progressPercent={courseLessons.progressPercent}
        getCurrentPosition={() => {
          if (playerRef.current) {
            return playerRef.current.getCurrentPosition();
          }
          return 0;
        }}
        onSeekTo={(seconds) => {
          if (playerRef.current) {
            playerRef.current.seekTo(seconds);
          }
        }}
        onStudyIdCreated={(newStudyId) => {
          router.setParams({ studyId: newStudyId });
        }}
        onClose={() => setStudySheetOpen(false)}
      />
      <SettingsSheet
        visible={settingsOpen}
        playbackRate={playbackRate}
        creatorName={creatorName}
        onClose={() => setSettingsOpen(false)}
        onRateSelect={(rate) => {
          setPlaybackRate(rate);
          setSettingsOpen(false);
        }}
      />
    </View>
  );
}

type ActionButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
};

function ActionButton({ icon, label, active, onPress }: ActionButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const [particles, setParticles] = useState<any[]>([]);

  useEffect(() => {
    // Fast discrete pulse on active change
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 0.95,
        duration: 70,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1.05,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1.0,
        duration: 70,
        useNativeDriver: true,
      }),
    ]).start();

    if (active) {
      // Trigger burst
      const particleCount = 8;
      const newParticles = Array.from({ length: particleCount }, (_, i) => {
        const angle = (360 / particleCount) * i + Math.random() * 30 - 15;
        const distance = 30 + Math.random() * 20;
        const radians = (angle * Math.PI) / 180;
        const targetX = Math.cos(radians) * distance;
        const targetY = Math.sin(radians) * distance;

        const x = new Animated.Value(0);
        const y = new Animated.Value(0);
        const pScale = new Animated.Value(0);
        const opacity = new Animated.Value(1);

        Animated.parallel([
          Animated.timing(x, { toValue: targetX, duration: 400, useNativeDriver: true }),
          Animated.timing(y, { toValue: targetY, duration: 400, useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(pScale, { toValue: 1.2, duration: 100, useNativeDriver: true }),
            Animated.timing(pScale, { toValue: 0.5, duration: 300, useNativeDriver: true }),
          ]),
          Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]).start();

        return {
          id: Math.random() + i,
          x,
          y,
          scale: pScale,
          opacity,
          size: 4 + Math.random() * 3,
        };
      });

      setParticles(newParticles);
      setTimeout(() => setParticles([]), 450);
    }
  }, [active]);

  return (
    <View style={{ position: 'relative' }}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable style={[styles.actionButton, active && styles.actionButtonActive]} onPress={onPress}>
          <Ionicons name={icon} color={active ? colors.accent : colors.textSecondary} size={15} style={{ marginRight: 2 }} />
          <Text style={[styles.actionText, active && { color: colors.accent }]}>{label}</Text>
        </Pressable>
      </Animated.View>

      {/* Render Action particles */}
      {particles.map((p) => (
        <Animated.View
          key={p.id}
          style={[
            styles.particle,
            {
              width: p.size,
              height: p.size,
              backgroundColor: colors.accent,
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
  );
}

const SHADER_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <style>
    html, body {
      margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #31000b;
    }
    canvas {
      width: 100%; height: 100%; display: block; border-radius: 9999px;
    }
  </style>
</head>
<body>
  <canvas id="c"></canvas>
  <script>
    const canvas = document.getElementById('c');
    const gl = canvas.getContext('webgl');
    if (!gl) {
      document.body.innerHTML = 'WebGL not supported';
    }

    const vs = \`
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        vUv = (position + 1.0) / 2.0;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    \`;

    const fs = \`
      precision mediump float;
      varying vec2 vUv;
      uniform vec2 iResolution;
      uniform float iTime;

      mat2 m(float a) {
        float c = cos(a), s = sin(a);
        return mat2(c, -s, s, c);
      }

      float map(vec3 p) {
        p.xz *= m(iTime * 0.45);
        p.xy *= m(iTime * 0.35);
        vec3 q = p * 2.0 + iTime;
        return length(p + vec3(sin(iTime * 0.7))) * log(length(p) + 1.0)
             + sin(q.x + sin(q.z + sin(q.y))) * 0.5 - 1.0;
      }

      void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.xy;
        vec3 col = vec3(0.0);
        float d = 2.5;

        for (int i = 0; i <= 5; i++) {
          vec3 p = vec3(0.0, 0.0, 5.0) + normalize(vec3(uv, -1.0)) * d;
          float rz = map(p);
          float f = clamp((rz - map(p + 0.1)) * 0.5, -0.1, 1.0);

          // Deep wine red base and ultra-vibrant crimson neon gas highlights
          vec3 base = vec3(0.18, 0.02, 0.05) + vec3(6.5, 1.6, 2.8) * f;

          col = col * base + smoothstep(2.5, 0.0, rz) * 0.75 * base;
          d += min(rz, 1.0);
        }

        gl_FragColor = vec4(col, 1.0);
      }
    \`;

    function createShader(gl, type, source) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        gl.deleteShader(s);
        return null;
      }
      return s;
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vs);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fs);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1
    ]), gl.STATIC_DRAW);

    const pos = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const iTimeLoc = gl.getUniformLocation(program, 'iTime');
    const iResolutionLoc = gl.getUniformLocation(program, 'iResolution');

    function resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    window.addEventListener('resize', resize);
    resize();

    function render(time) {
      gl.uniform1f(iTimeLoc, time * 0.001);
      gl.uniform2f(iResolutionLoc, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  </script>
</body>
</html>
`;

type WatchStudyToolsProps = {
  isCourse: boolean;
  onToolPress: (tab: 'notes' | 'transcript' | 'quiz' | 'suggestions' | 'classy' | 'modules') => void;
  studyId?: string | null;
};

function WatchStudyTools({ isCourse, onToolPress, studyId = null }: WatchStudyToolsProps) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const anim1 = useRef(new Animated.Value(0)).current;
  const anim2 = useRef(new Animated.Value(0)).current;

  // Progress loops for 5 floating particles
  const p1 = useRef(new Animated.Value(0)).current;
  const p2 = useRef(new Animated.Value(0)).current;
  const p3 = useRef(new Animated.Value(0)).current;
  const p4 = useRef(new Animated.Value(0)).current;
  const p5 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Liquid background shifting
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim1, { toValue: 1, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim1, { toValue: 0, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(anim2, { toValue: 1, duration: 5000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim2, { toValue: 0, duration: 5000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    // Particle loops (different durations to keep orbits organic)
    const runLoop = (val: Animated.Value, duration: number) => {
      Animated.loop(
        Animated.timing(val, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    };

    runLoop(p1, 3800);
    runLoop(p2, 4800);
    runLoop(p3, 3000);
    runLoop(p4, 5800);
    runLoop(p5, 4200);
  }, [anim1, anim2, p1, p2, p3, p4, p5]);

  // Gaseous shifting
  const transX1 = anim1.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] });
  const transY1 = anim2.interpolate({ inputRange: [0, 1], outputRange: [-6, 6] });
  const scale1 = anim1.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.2] });

  const transX2 = anim2.interpolate({ inputRange: [0, 1], outputRange: [8, -8] });
  const transY2 = anim1.interpolate({ inputRange: [0, 1], outputRange: [6, -6] });
  const scale2 = anim2.interpolate({ inputRange: [0, 1], outputRange: [1.15, 0.85] });

  // Orbit Interpolations for the 5 particles (simulated Z-depth via scale and opacity)

  // Particle 1 (wide horizontal ellipse)
  const p1X = p1.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [-12, 0, 12, 0, -12] });
  const p1Y = p1.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [-4, 6, -4, -6, -4] });
  const p1S = p1.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.55, 1.25, 0.75, 0.45, 0.55] });
  const p1O = p1.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.5, 1.0, 0.7, 0.25, 0.5] });

  // Particle 2 (vertical figure-8 shape)
  const p2X = p2.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 8, -8, 0, 0] });
  const p2Y = p2.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [-10, 0, 10, 0, -10] });
  const p2S = p2.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.75, 0.45, 1.15, 0.65, 0.75] });
  const p2O = p2.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.7, 0.35, 1.0, 0.55, 0.7] });

  // Particle 3 (diagonal float)
  const p3X = p3.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [-10, 10, 5, -5, -10] });
  const p3Y = p3.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [10, -10, 6, -5, 10] });
  const p3S = p3.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1.1, 0.4, 0.85, 0.55, 1.1] });
  const p3O = p3.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.95, 0.2, 0.75, 0.45, 0.95] });

  // Particle 4 (slow central orbit)
  const p4X = p4.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [5, -5, 6, -6, 5] });
  const p4Y = p4.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [-6, 6, -3, 3, -6] });
  const p4S = p4.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.45, 0.85, 1.2, 0.55, 0.45] });
  const p4O = p4.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.3, 0.75, 1.0, 0.5, 0.3] });

  // Particle 5 (quick perimeter sweep)
  const p5X = p5.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [12, -12, 12, -12, 12] });
  const p5Y = p5.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [12, 12, -12, -12, 12] });
  const p5S = p5.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.85, 0.55, 1.25, 0.45, 0.85] });
  const p5O = p5.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.75, 0.35, 1.0, 0.25, 0.75] });

  const otherTools: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    description: string;
    tab: 'notes' | 'transcript' | 'quiz' | 'suggestions' | 'modules';
  }> = [
      ...(isCourse ? [{ icon: 'list-outline' as const, label: 'Aulas', description: 'Estrutura do curso', tab: 'modules' as const }] : []),
      { icon: 'document-text-outline', label: 'Transcrição', description: 'Ler texto do vídeo', tab: 'transcript' },
      { icon: 'bulb-outline', label: 'Quiz de IA', description: 'Testar aprendizado', tab: 'quiz' },
      { icon: 'reader-outline', label: 'Anotações', description: 'Suas notas salvas', tab: 'notes' },
      { icon: 'compass-outline', label: 'Sugestões', description: 'Aulas recomendadas', tab: 'suggestions' },
    ];

  return (
    <View style={styles.toolsBlock} key={isLandscape ? 'landscape' : 'portrait'}>
      <View style={styles.sectionTitleRow}>
        <Ionicons name="sparkles" color={colors.accent} size={20} />
        <Text style={styles.sectionTitle}>Ferramentas de Estudo</Text>
      </View>

      {/* Classy IA Highlight Hero Card */}
      <Pressable
        onPress={() => onToolPress('classy')}
        style={({ pressed }) => [
          styles.classyHeroCard,
          pressed && { opacity: 0.9 }
        ]}
      >
        <LinearGradient
          colors={['rgba(225, 29, 72, 0.16)', 'rgba(179, 39, 79, 0.28)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.classyHeroGradient}
        >
          <View style={styles.classyHeroLeft}>
            <View style={styles.classyHeroBadge}>
              <MaterialCommunityIcons name="crown" color={colors.accent} size={13} style={{ marginRight: 4 }} />
              <Text style={styles.classyHeroBadgeText}>RECURSO PREMIUM</Text>
            </View>
            <Text style={styles.classyHeroTitle}>Estudar com Classy IA</Text>
            <Text style={styles.classyHeroSubtitle} numberOfLines={2}>
              Tire dúvidas da aula em tempo real, crie resumos e faça perguntas inteligentes.
            </Text>
          </View>
          <View style={styles.classyHeroRight}>
            <View style={styles.shaderCtaButton}>
              <WebView
                originWhitelist={['*']}
                source={{ html: SHADER_HTML }}
                style={styles.shaderCtaWebView}
                scrollEnabled={false}
                overScrollMode="never"
                domStorageEnabled={true}
                javaScriptEnabled={true}
                androidLayerType="hardware"
              />
              <View style={styles.shaderCtaOverlay} pointerEvents="none">
                <Text style={styles.shaderCtaText}>Começar estudo</Text>
                <Ionicons name="chevron-forward" color="#FFF" size={11} style={{ marginLeft: 4 }} />
              </View>
            </View>
          </View>
        </LinearGradient>
      </Pressable>

      {/* Grid containing other tools */}
      <View style={styles.toolsGrid}>
        {otherTools.map((tool) => (
          <Pressable
            key={tool.label}
            style={({ pressed }) => [
              styles.utilityToolCard,
              pressed && { backgroundColor: 'rgba(255, 255, 255, 0.05)' }
            ]}
            onPress={() => onToolPress(tool.tab)}
          >
            <View style={styles.utilityIconWrapper}>
              <Ionicons name={tool.icon} color={colors.text} size={18} />
            </View>
            <View style={styles.utilityTextContainer}>
              <Text style={styles.utilityToolLabel}>{tool.label}</Text>
              <Text style={styles.utilityToolDesc} numberOfLines={1}>{tool.description}</Text>
            </View>
            <Ionicons name="chevron-forward" color="rgba(255, 255, 255, 0.25)" size={14} style={{ marginLeft: 4 }} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}



function WatchRelatedList({ items, loading }: { items: WatchRelatedItem[]; loading: boolean }) {
  if (loading) {
    return (
      <View style={styles.relatedBlock}>
        <Text style={styles.relatedTitle}>A seguir</Text>
        <Text style={styles.relatedLoading}>Carregando proximos conteudos...</Text>
      </View>
    );
  }

  if (!items.length) return null;

  return (
    <View style={styles.relatedBlock}>
      <Text style={styles.relatedTitle}>A seguir</Text>
      <View style={styles.relatedList}>
        {items.slice(0, 8).map((item) => (
          <Pressable key={item.id} style={styles.relatedItem} onPress={() => router.push(`/watch/${item.id}`)}>
            <View style={styles.relatedThumb}>
              {item.thumbnail_url ? <Image source={{ uri: item.thumbnail_url }} style={styles.relatedImage} /> : null}
              <View style={styles.relatedOverlay} />
              <Text style={styles.durationBadge}>{formatDuration(item.duration_seconds)}</Text>
            </View>
            <View style={styles.relatedCopy}>
              <Text numberOfLines={2} style={styles.relatedItemTitle}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={styles.relatedCreator}>
                {item.creator?.display_name || 'Creator Classfy'}
              </Text>
              <Text style={styles.relatedMeta}>{formatCount(item.views_count)} views</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stateScreen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  modalRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  overlaySurface: {
    backgroundColor: colors.background,
    flex: 1,
    overflow: 'hidden',
  },
  scrollContent: {
    backgroundColor: 'transparent',
    minHeight: '100%',
    paddingBottom: spacing.section,
  },
  playerShell: {
    backgroundColor: colors.background,
  },
  player: {
    aspectRatio: 16 / 9,
    backgroundColor: '#050505',
    overflow: 'hidden',
    width: '100%',
  },
  video: {
    height: '100%',
    width: '100%',
  },
  poster: {
    height: '100%',
    width: '100%',
  },
  posterOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlaySoft,
  },
  dragCapture: {
    alignItems: 'center',
    height: 72,
    left: 0,
    paddingTop: spacing.sm,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  dragHandle: {
    backgroundColor: 'rgba(255,255,255,0.32)',
    borderRadius: radius.pill,
    height: 4,
    width: 46,
  },
  playBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: radius.pill,
    height: 76,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -38,
    marginTop: -38,
    position: 'absolute',
    top: '50%',
    width: 76,
  },
  playerBadge: {
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    bottom: spacing.md,
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: typography.weightBlack,
    left: spacing.md,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    position: 'absolute',
    textTransform: 'uppercase',
  },
  body: {
    backgroundColor: colors.background,
    paddingBottom: spacing.section,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  accessPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  accessTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
  },
  accessBody: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    lineHeight: 19,
  },
  upgradeBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  upgradeBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  titleBlock: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  typeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  typeBadge: {
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 2,
  },
  typeBadgeText: {
    color: colors.accent,
    fontSize: 9.5,
    fontWeight: '800',
  },
  visibilityBadge: {
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderRadius: radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 2,
  },
  visibilityBadgeText: {
    color: colors.muted,
    fontSize: 9.5,
    fontWeight: '800',
  },
  viewsMeta: {
    color: colors.muted,
    fontSize: 11.5,
    fontWeight: '600',
    marginLeft: 4,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: typography.weightBlack,
    lineHeight: 28,
  },
  creatorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  creatorLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minWidth: 0,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 46,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 46,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarText: {
    color: colors.text,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBlack,
  },
  creatorCopy: {
    flex: 1,
    minWidth: 0,
  },
  creatorNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  creatorName: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBlack,
  },
  creatorMeta: {
    color: colors.muted,
    fontSize: typography.caption,
    marginTop: spacing.xxs,
  },
  followButton: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  followButtonInactive: {
    backgroundColor: colors.text,
  },
  followButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
  },
  followButtonText: {
    fontSize: typography.caption,
    fontWeight: typography.weightBlack,
  },
  followButtonTextActive: {
    color: colors.text,
  },
  particle: {
    position: 'absolute',
    borderRadius: radius.full,
    alignSelf: 'center',
    top: '30%',
    pointerEvents: 'none',
  },
  actions: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 38,
    paddingHorizontal: spacing.md,
  },
  actionButtonActive: {
    backgroundColor: 'rgba(225, 29, 72, 0.1)',
    borderColor: colors.accent,
  },
  actionText: {
    color: colors.textSecondary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  actionTextActive: {
    color: colors.accent,
  },
  descriptionCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderRadius: radius.lg,
    gap: spacing.xs,
    marginBottom: spacing.xl,
    padding: spacing.md,
  },
  descriptionMeta: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBold,
  },
  descriptionText: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 20,
  },
  moreRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  moreText: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBold,
  },
  toolsBlock: {
    marginBottom: spacing.xl,
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.titleSmall,
    fontWeight: typography.weightBlack,
  },
  toolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  classyHeroCard: {
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  classyHeroGradient: {
    flexDirection: 'row',
    padding: spacing.lg,
    alignItems: 'stretch',
    gap: spacing.md,
  },
  classyHeroLeft: {
    flex: 1,
  },
  classyHeroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(225, 29, 72, 0.12)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginBottom: spacing.xs,
  },
  classyHeroBadgeText: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  classyHeroTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 4,
  },
  classyHeroSubtitle: {
    color: colors.textSecondary,
    fontSize: 11.5,
    lineHeight: 16,
  },
  classyHeroRight: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 135,
  },
  shaderCtaButton: {
    width: 135,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: '#31000b',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(225, 29, 72, 0.55)',
    shadowColor: '#E11D48',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 8,
    elevation: 4,
    position: 'relative',
  },
  shaderCtaWebView: {
    width: 135,
    height: 42,
    backgroundColor: '#31000b',
  },
  shaderCtaOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    zIndex: 10,
  },
  shaderCtaText: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '800',
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  utilityToolCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderRadius: radius.lg,
    flexBasis: '47.8%',
    gap: spacing.sm,
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  utilityIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  utilityTextContainer: {
    flex: 1,
  },
  utilityToolLabel: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '800',
    marginBottom: 2,
  },
  utilityToolDesc: {
    color: colors.mutedDim,
    fontSize: 10,
  },
  commentsRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderRadius: radius.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  rowTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowTitleText: {
    color: colors.text,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBlack,
  },
  relatedBlock: {
    paddingBottom: spacing.section,
  },
  relatedTitle: {
    color: colors.muted,
    fontSize: typography.titleSmall,
    fontWeight: typography.weightBlack,
    marginBottom: spacing.md,
  },
  relatedLoading: {
    color: colors.muted,
    fontSize: typography.bodySmall,
  },
  relatedList: {
    gap: spacing.md,
  },
  relatedItem: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  relatedThumb: {
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    width: 156,
  },
  relatedImage: {
    height: '100%',
    width: '100%',
  },
  relatedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  durationBadge: {
    backgroundColor: colors.overlay,
    borderRadius: radius.xs,
    bottom: spacing.xs,
    color: colors.text,
    fontSize: typography.label,
    fontWeight: typography.weightBlack,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    position: 'absolute',
    right: spacing.xs,
  },
  relatedCopy: {
    flex: 1,
    minWidth: 0,
    paddingTop: spacing.xs,
  },
  relatedItemTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
    lineHeight: 20,
  },
  relatedCreator: {
    color: colors.muted,
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  relatedMeta: {
    color: colors.mutedDim,
    fontSize: typography.caption,
    marginTop: spacing.xxs,
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  centerText: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    textAlign: 'center',
  },
  errorTitle: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: typography.weightBlack,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
  },
  sheetBackdrop: {
    backgroundColor: 'transparent',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#202020',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 5,
    marginBottom: spacing.lg,
    marginTop: spacing.md,
    width: 52,
  },
  sheetSectionTitle: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: typography.weightBlack,
    letterSpacing: 0,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },
  sheetRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 58,
  },
  sheetRowLocked: {
    opacity: 0.58,
  },
  sheetLabel: {
    color: colors.text,
    flex: 1,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBold,
  },
  sheetValue: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: typography.body,
  },
  premiumBadge: {
    backgroundColor: colors.accent,
    borderRadius: radius.xs,
    color: colors.text,
    fontSize: typography.label,
    fontWeight: typography.weightBlack,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  speedBlock: {
    paddingVertical: spacing.sm,
  },
  speedHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  speedOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingLeft: 42,
  },
  speedChip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  speedChipActive: {
    backgroundColor: colors.text,
  },
  speedText: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
  },
  speedTextActive: {
    color: colors.background,
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    marginBottom: spacing.xs,
  },
  sheetTitle: {
    color: colors.text,
    flex: 1,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBlack,
    marginRight: spacing.md,
  },
  sheetCloseBtn: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
});

function SettingsSheet({
  visible,
  playbackRate,
  creatorName,
  onClose,
  onRateSelect,
}: {
  visible: boolean;
  playbackRate: number;
  creatorName?: string | null;
  onClose: () => void;
  onRateSelect: (rate: number) => void;
}) {
  const {
    scrollEnabled,
    handleScroll,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    isScrollAtTop,
    setIsScrollAtTop,
  } = useBottomSheetScroll();

  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const playerHeight = isLandscape ? 0 : windowWidth * (9 / 16);
  const playerBottom = isLandscape ? 20 : insets.top + 12 + playerHeight; // 12 is spacing.sm
  const maxSheetHeight = windowHeight - playerBottom;

  useEffect(() => {
    if (visible) {
      sheetTranslateY.setValue(0);
      setIsScrollAtTop(true);
    }
  }, [visible, setIsScrollAtTop]);

  const settingsPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          isScrollAtTop && gesture.dy > 5 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          isScrollAtTop && gesture.dy > 5 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) sheetTranslateY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 120 || gesture.vy > 0.5) {
            Animated.timing(sheetTranslateY, {
              toValue: Dimensions.get('window').height,
              duration: 200,
              useNativeDriver: true,
            }).start(() => {
              onClose();
            });
          } else {
            Animated.spring(sheetTranslateY, {
              toValue: 0,
              friction: 8,
              tension: 80,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [onClose, sheetTranslateY, isScrollAtTop]
  );

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View
        style={styles.sheetBackdrop}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight: maxSheetHeight,
              transform: [{ translateY: sheetTranslateY }]
            }
          ]}
          {...settingsPanResponder.panHandlers}
        >
          <View
            style={[
              { width: '100%' },
              isLandscape && {
                width: Math.min(windowWidth, windowHeight * (16 / 9)),
                alignSelf: 'center',
              }
            ]}
          >
            <View onStartShouldSetResponder={() => true}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle} numberOfLines={1}>Controles</Text>
                <Pressable style={styles.sheetCloseBtn} hitSlop={12} onPress={onClose}>
                  <Ionicons name="close" color={colors.text} size={20} />
                </Pressable>
              </View>
            </View>
            <ScrollView
              scrollEnabled={scrollEnabled}
              onScroll={handleScroll}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchCancel}
              bounces={false}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: spacing.xxl }}
            >
              <SheetRow icon="options-outline" label="Qualidade" value="Automatica (720p)" />
              <View style={styles.speedBlock}>
                <View style={styles.speedHeader}>
                  <Ionicons name="play-circle-outline" color={colors.text} size={28} />
                  <Text style={styles.sheetLabel}>Velocidade da reproducao</Text>
                </View>
                <View style={styles.speedOptions}>
                  {speedOptions.map((rate) => (
                    <Pressable
                      key={rate}
                      style={[styles.speedChip, playbackRate === rate && styles.speedChipActive]}
                      onPress={() => onRateSelect(rate)}
                    >
                      <Text style={[styles.speedText, playbackRate === rate && styles.speedTextActive]}>
                        {rate}x
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <SheetRow icon="text-outline" label="Legendas" value="Desativadas" />
              <SheetRow icon="lock-closed-outline" label="Tela de bloqueio" />
              <SheetRow icon="person-circle-outline" label="Criador" value={creatorName || 'Classfy'} />
              <Text style={styles.sheetSectionTitle}>Controles Premium</Text>
              <SheetRow icon="language-outline" label="Legendas traduzidas" value="Bloqueado" premium locked />
              <SheetRow icon="sparkles-outline" label="Resumo inteligente" value="Bloqueado" premium locked />
              <SheetRow icon="star-outline" label="Recompensas avancadas" value="Bloqueado" premium locked />
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function SheetRow({
  icon,
  label,
  value,
  premium,
  locked,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  premium?: boolean;
  locked?: boolean;
}) {
  return (
    <View style={[styles.sheetRow, locked && styles.sheetRowLocked]}>
      <Ionicons name={icon} color={locked ? colors.muted : colors.text} size={29} />
      <Text style={styles.sheetLabel}>{label}</Text>
      {premium ? <Text style={styles.premiumBadge}>PRO</Text> : null}
      {value ? <Text numberOfLines={1} style={styles.sheetValue}>{value}</Text> : null}
      <Ionicons name={locked ? 'lock-closed-outline' : 'chevron-forward'} color={colors.muted} size={22} />
    </View>
  );
}

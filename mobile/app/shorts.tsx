import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  Dimensions,
  Share,
  Platform,
  Alert,
  Image,
  Animated,
} from 'react-native';
import { Video, ResizeMode, Audio } from 'expo-av';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  Volume2,
  VolumeX,
  ArrowLeft,
  Play,
  House,
  BookOpenCheck,
  SendHorizontal,
  BadgeDollarSign,
} from 'lucide-react-native';
import { BlurView } from 'expo-blur';

import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { WatchCommentsSheet } from '@/components/WatchCommentsSheet';

import { LinearGradient } from 'expo-linear-gradient';

const { width: WINDOW_WIDTH, height: WINDOW_HEIGHT } = Dimensions.get('window');

interface ShortItem {
  id: string;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string | null;
  likes_count: number;
  creator_id: string;
  is_curated: boolean;
  published_at: string;
  profiles?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    creator_channel_name: string | null;
  } | null;
}

// Sub-component for each video cell to manage local play/pause states and animations cleanly
function ShortVideoCell({
  item,
  index,
  activeIndex,
  isScreenFocused,
  isMuted,
  onToggleMute,
  likedDict,
  savedDict,
  likesCountDict,
  followingDict,
  handleLikePress,
  handleSavePress,
  handleFollowPress,
  handleSharePress,
  onOpenComments,
  user,
  router,
}: {
  item: ShortItem;
  index: number;
  activeIndex: number;
  isScreenFocused: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  likedDict: Record<string, boolean>;
  savedDict: Record<string, boolean>;
  likesCountDict: Record<string, number>;
  followingDict: Record<string, boolean>;
  handleLikePress: (id: string) => void;
  handleSavePress: (id: string) => void;
  handleFollowPress: (id: string) => void;
  handleSharePress: (item: ShortItem) => void;
  onOpenComments: (id: string) => void;
  user: any;
  router: any;
}) {
  const videoRef = useRef<Video>(null);
  const [localPaused, setLocalPaused] = useState(false);
  const [showCenterIcon, setShowCenterIcon] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [isSpeedingUp, setIsSpeedingUp] = useState(false);
  const iconScaleAnim = useRef(new Animated.Value(0.5)).current;
  const iconOpacityAnim = useRef(new Animated.Value(0)).current;

  // Crucial Optimization: Render video player ONLY for active index and 1 adjacent item in each direction
  const shouldRenderVideo = Math.abs(index - activeIndex) <= 1;
  const isCurrent = index === activeIndex && isScreenFocused && !localPaused;

  // Sync video play/pause with changes to active index
  useEffect(() => {
    if (index !== activeIndex) {
      setLocalPaused(false);
      setVideoProgress(0);
      setIsSpeedingUp(false);
    }
  }, [activeIndex]);

  // Imperative video control for zero latency playback state transitions
  useEffect(() => {
    if (videoRef.current) {
      if (isCurrent) {
        videoRef.current.playAsync().catch(() => {});
      } else {
        videoRef.current.pauseAsync().catch(() => {});
      }
    }
  }, [isCurrent]);

  const handleVideoPress = async () => {
    const nextPaused = !localPaused;
    setLocalPaused(nextPaused);
    
    if (videoRef.current) {
      if (nextPaused) {
        await videoRef.current.pauseAsync().catch(() => {});
      } else {
        await videoRef.current.playAsync().catch(() => {});
      }
    }
    
    // Trigger big center play icon animation
    setShowCenterIcon(true);
    iconScaleAnim.setValue(0.5);
    iconOpacityAnim.setValue(0.9);

    Animated.parallel([
      Animated.spring(iconScaleAnim, {
        toValue: 1.2,
        friction: 4,
        useNativeDriver: true,
      }),
      Animated.timing(iconOpacityAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setShowCenterIcon(false);
      }
    });
  };

  const handleSpeedUpIn = async () => {
    if (videoRef.current && isCurrent) {
      setIsSpeedingUp(true);
      await videoRef.current.setRateAsync(2.0, true).catch(() => {});
    }
  };

  const handleSpeedUpOut = async () => {
    if (videoRef.current) {
      setIsSpeedingUp(false);
      await videoRef.current.setRateAsync(1.0, true).catch(() => {});
    }
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status?.isLoaded && status?.durationMillis) {
      setVideoProgress(status.positionMillis / status.durationMillis);
    }
  };

  const isLiked = likedDict[item.id] || false;
  const isSaved = savedDict[item.id] || false;
  const isFollowing = followingDict[item.creator_id] || false;

  const creatorName = item.profiles?.display_name || 'Creator Classfy';
  const channelName = item.profiles?.creator_channel_name
    ? `@${item.profiles.creator_channel_name}`
    : '@creator';

  return (
    <View style={styles.cellContainer}>
      {shouldRenderVideo ? (
        <Video
          ref={videoRef}
          source={{ uri: item.video_url }}
          style={StyleSheet.absoluteFillObject}
          resizeMode={ResizeMode.COVER}
          shouldPlay={isCurrent}
          isLooping
          isMuted={isMuted}
          progressUpdateIntervalMillis={300}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
        />
      ) : item.thumbnail_url ? (
        <Image
          source={{ uri: item.thumbnail_url }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#050505' }]} />
      )}

      {/* Screen action tap overlay */}
      <Pressable style={StyleSheet.absoluteFillObject} onPress={handleVideoPress} />

      {/* Left/Right margins hold zones for 2x playback speed */}
      <View
        style={styles.speedTriggerLeft}
        onStartShouldSetResponder={() => true}
        onResponderGrant={handleSpeedUpIn}
        onResponderRelease={handleSpeedUpOut}
        onResponderTerminate={handleSpeedUpOut}
      />
      <View
        style={styles.speedTriggerRight}
        onStartShouldSetResponder={() => true}
        onResponderGrant={handleSpeedUpIn}
        onResponderRelease={handleSpeedUpOut}
        onResponderTerminate={handleSpeedUpOut}
      />

      {/* Speed up overlay indicator */}
      {isSpeedingUp && (
        <View style={styles.speedIndicatorOverlay} pointerEvents="none">
          <Play size={20} color="#FFF" fill="#FFF" />
          <Text style={styles.speedIndicatorText}>2x Reproduzindo</Text>
        </View>
      )}

      {/* Smooth gradient overlay at bottom for maximum text contrast */}
      <LinearGradient 
        colors={['transparent', 'rgba(0, 0, 0, 0.35)', 'rgba(0, 0, 0, 0.85)']} 
        style={styles.bottomGradient} 
        pointerEvents="none" 
      />

      {/* Big center play icon indicator animation */}
      {showCenterIcon && (
        <View style={styles.centerIconOverlay} pointerEvents="none">
          <Animated.View
            style={[
              styles.centerPlayIcon,
              {
                opacity: iconOpacityAnim,
                transform: [{ scale: iconScaleAnim }],
              },
            ]}
          >
            <Play size={42} color="#FFF" fill="#FFF" />
          </Animated.View>
        </View>
      )}

      {/* Right Side Buttons overlay */}
      <View style={styles.sideControls}>
        {/* Like */}
        <View style={styles.actionColumn}>
          <Pressable
            onPress={() => handleLikePress(item.id)}
            style={({ pressed }) => [styles.iconCircle, pressed && styles.btnPressed]}
          >
            <Heart
              size={28}
              color={isLiked ? colors.accent : '#FAFAFA'}
              fill={isLiked ? colors.accent : 'none'}
              strokeWidth={1.8}
            />
          </Pressable>
          <Text style={styles.actionCountText}>Curtidas</Text>
        </View>

        {/* Comments */}
        <View style={styles.actionColumn}>
          <Pressable
            onPress={() => onOpenComments(item.id)}
            style={({ pressed }) => [styles.iconCircle, pressed && styles.btnPressed]}
          >
            <MessageCircle size={28} color="#FAFAFA" strokeWidth={1.8} />
          </Pressable>
          <Text style={styles.actionCountText}>Comentar</Text>
        </View>

        {/* Save/Bookmark */}
        <View style={styles.actionColumn}>
          <Pressable
            onPress={() => handleSavePress(item.id)}
            style={({ pressed }) => [styles.iconCircle, pressed && styles.btnPressed]}
          >
            <Bookmark
              size={28}
              color={isSaved ? '#EAB308' : '#FAFAFA'}
              fill={isSaved ? '#EAB308' : 'none'}
              strokeWidth={1.8}
            />
          </Pressable>
          <Text style={styles.actionCountText}>{isSaved ? 'Salvo' : 'Salvar'}</Text>
        </View>

        {/* Share */}
        <View style={styles.actionColumn}>
          <Pressable
            onPress={() => handleSharePress(item)}
            style={({ pressed }) => [styles.iconCircle, pressed && styles.btnPressed]}
          >
            <Send size={26} color="#FAFAFA" strokeWidth={1.8} />
          </Pressable>
          <Text style={styles.actionCountText}>Enviar</Text>
        </View>

        {/* Mute toggle button */}
        <Pressable onPress={onToggleMute} style={styles.iconCircleMute}>
          {isMuted ? (
            <VolumeX size={22} color="#FAFAFA" strokeWidth={1.8} />
          ) : (
            <Volume2 size={22} color="#FAFAFA" strokeWidth={1.8} />
          )}
        </Pressable>
      </View>

      {/* Bottom Metadata info */}
      <View style={styles.bottomOverlay}>
        <View style={styles.creatorMetaRow}>
          {/* Creator Avatar moved here next to the name */}
          <Pressable
            style={styles.avatarContainerLeft}
            onPress={() => router.push(`/creator/${item.creator_id}` as any)}
          >
            {item.profiles?.avatar_url ? (
              <Image source={{ uri: item.profiles.avatar_url }} style={styles.avatarImageLeft} />
            ) : (
              <View style={styles.avatarPlaceholderLeft}>
                <Text style={styles.avatarPlaceholderTextLeft}>{creatorName[0]?.toUpperCase()}</Text>
              </View>
            )}
          </Pressable>

          <Pressable onPress={() => router.push(`/creator/${item.creator_id}` as any)}>
            <Text style={styles.creatorNameText} numberOfLines={1}>
              {channelName}
            </Text>
          </Pressable>

          {(!user || item.creator_id !== user.id) && (
            <Pressable
              onPress={() => handleFollowPress(item.creator_id)}
              style={[styles.followBtn, isFollowing && styles.followBtnActive]}
            >
              <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextActive]}>
                {isFollowing ? 'Seguindo' : 'Seguir'}
              </Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.videoTitleText} numberOfLines={2}>
          {item.title}
        </Text>

        {item.description ? (
          <Text style={styles.videoDescText} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
      </View>

      {/* Video Progress Line at the very bottom of the cell */}
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${videoProgress * 100}%` }]} />
      </View>
    </View>
  );
}

export default function ShortsScreen() {
  const { id: initialShortId, videoUrl: initialVideoUrl, thumbnailUrl: initialThumbnailUrl } = useLocalSearchParams<{ id: string; videoUrl?: string; thumbnailUrl?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isScreenFocused = useIsFocused();

  const [shorts, setShorts] = useState<ShortItem[]>(
    initialShortId && initialVideoUrl
      ? [
          {
            id: initialShortId,
            title: 'Carregando...',
            description: '',
            video_url: initialVideoUrl,
            thumbnail_url: initialThumbnailUrl || null,
            likes_count: 0,
            creator_id: '',
            is_curated: false,
            published_at: new Date().toISOString(),
            profiles: null,
          },
        ]
      : []
  );
  const [loading, setLoading] = useState(!initialShortId || !initialVideoUrl);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  
  // Action state dictionaries to prevent reloading cells
  const [likedDict, setLikedDict] = useState<Record<string, boolean>>({});
  const [savedDict, setSavedDict] = useState<Record<string, boolean>>({});
  const [likesCountDict, setLikesCountDict] = useState<Record<string, number>>({});
  
  // Comments modal state
  const [showComments, setShowComments] = useState(false);
  const [commentingShortId, setCommentingShortId] = useState<string | null>(null);

  // Follow states
  const [followingDict, setFollowingDict] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Enable audio playback in silent mode on iOS
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
    }).catch(() => {});
    
    loadShortsFeed();
  }, [user]);

  const loadShortsFeed = async () => {
    try {
      // 1. Fetch user interests for matching
      let userInterests: string[] = [];
      if (user) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('interests')
          .eq('id', user.id)
          .maybeSingle();
        if (profileData?.interests) {
          userInterests = profileData.interests.map((interest: string) => interest.toLowerCase());
        }
      }

      // 2. Fetch all approved/published shorts
      const { data, error } = await supabase
        .from('contents')
        .select(`
          *,
          profiles:creator_id (
            id,
            display_name,
            avatar_url,
            creator_channel_name
          )
        `)
        .eq('content_type', 'short')
        .in('status', ['approved', 'published']);

      if (error) throw error;
      if (!data) {
        setShorts([]);
        setLoading(false);
        return;
      }

      // 3. Score and sort by interest overlap + curated status
      let items: ShortItem[] = data.map((item: any) => {
        let score = 0;
        
        // Boost if tags overlap with interests
        if (item.tags && Array.isArray(item.tags) && userInterests.length > 0) {
          item.tags.forEach((tag: string) => {
            if (userInterests.includes(tag.toLowerCase())) score += 10;
          });
        }
        
        // Boost if is curated
        if (item.is_curated) score += 5;

        // Map database columns to support file_url as backup
        const videoUrl = item.file_url || item.video_url || '';

        return { 
          ...item, 
          video_url: videoUrl,
          score 
        };
      });

      // Sort descending by score, then date
      items.sort((a: any, b: any) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
      });

      // 4. If opened from a preview short, rotate the list so that short is first
      if (initialShortId) {
        const targetIndex = items.findIndex((item) => item.id === initialShortId);
        if (targetIndex !== -1) {
          const clickedItem = items[targetIndex];
          const remainingItems = items.filter((_, idx) => idx !== targetIndex);
          items = [clickedItem, ...remainingItems];
        }
      }

      setShorts(items);

      // Initialize dictionary counts and user states
      const initialLikes: Record<string, number> = {};
      items.forEach((item) => {
        initialLikes[item.id] = item.likes_count || 0;
      });
      setLikesCountDict(initialLikes);

      if (user) {
        // Fetch like/save interactions of current user for these items
        const itemIds = items.map((item) => item.id);
        const creatorIds = Array.from(new Set(items.map((item) => item.creator_id)));

        const [likesRes, savedRes, followsRes] = await Promise.all([
          supabase.from('actions').select('content_id').eq('user_id', user.id).eq('type', 'LIKE').in('content_id', itemIds),
          supabase.from('saved_contents').select('content_id').eq('user_id', user.id).in('content_id', itemIds),
          supabase.from('follows').select('following_id').eq('follower_id', user.id).in('following_id', creatorIds),
        ]);

        const likedMap: Record<string, boolean> = {};
        likesRes.data?.forEach((row: any) => {
          likedMap[row.content_id] = true;
        });

        const savedMap: Record<string, boolean> = {};
        savedRes.data?.forEach((row: any) => {
          savedMap[row.content_id] = true;
        });

        const followingMap: Record<string, boolean> = {};
        followsRes.data?.forEach((row: any) => {
          followingMap[row.following_id] = true;
        });

        setLikedDict(likedMap);
        setSavedDict(savedMap);
        setFollowingDict(followingMap);
      }
    } catch (e) {
      console.error('Error loading shorts feed:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleLikePress = async (itemId: string) => {
    if (!user) {
      Alert.alert('Login necessário', 'Entre na Classfy para curtir este conteúdo.');
      return;
    }

    const isLiked = likedDict[itemId];
    
    // UI update instantly for high response
    setLikedDict((prev) => ({ ...prev, [itemId]: !isLiked }));
    setLikesCountDict((prev) => ({
      ...prev,
      [itemId]: isLiked ? Math.max(0, (prev[itemId] || 0) - 1) : (prev[itemId] || 0) + 1,
    }));

    try {
      if (isLiked) {
        await supabase.from('actions').delete().eq('user_id', user.id).eq('type', 'LIKE').eq('content_id', itemId);
      } else {
        await supabase.from('actions').insert({
          user_id: user.id,
          type: 'LIKE',
          content_id: itemId,
        });

        // Trigger reward function
        supabase.functions.invoke('process-reward', {
          body: { actionKey: 'LIKE_CONTENT', userId: user.id, contentId: itemId },
        }).then(() => {});
      }
    } catch (e) {
      console.error('Error toggling like:', e);
    }
  };

  const handleSavePress = async (itemId: string) => {
    if (!user) {
      Alert.alert('Login necessário', 'Entre na Classfy para salvar este conteúdo.');
      return;
    }

    const isSaved = savedDict[itemId];
    setSavedDict((prev) => ({ ...prev, [itemId]: !isSaved }));

    try {
      if (isSaved) {
        await supabase.from('saved_contents').delete().eq('user_id', user.id).eq('content_id', itemId);
      } else {
        await supabase.from('saved_contents').insert({
          user_id: user.id,
          content_id: itemId,
        });
      }
    } catch (e) {
      console.error('Error toggling save:', e);
    }
  };

  const handleFollowPress = async (creatorId: string) => {
    if (!user) return;
    const isFollowing = followingDict[creatorId];
    setFollowingDict((prev) => ({ ...prev, [creatorId]: !isFollowing }));

    try {
      if (isFollowing) {
        await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', creatorId);
      } else {
        await supabase.from('follows').insert({
          follower_id: user.id,
          following_id: creatorId,
        });
      }
    } catch (e) {
      console.error('Error toggling follow:', e);
    }
  };

  const handleSharePress = async (item: ShortItem) => {
    try {
      const shareUrl = `https://classfy.app/shorts/${item.id}`;
      await Share.share({
        title: item.title,
        message: `Olhe este short na Classfy: "${item.title}"\n${shareUrl}`,
      });
    } catch (e) {
      console.error('Error sharing:', e);
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80, // Trigger visible state if cell takes 80%+ height of view
  }).current;

  const handleOpenComments = (id: string) => {
    setCommentingShortId(id);
    setShowComments(true);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      {/* Floating immersive Back Button */}
      <Pressable 
        onPress={() => router.back()} 
        style={[styles.backButtonFloating, { top: insets.top + 10 }]}
      >
        <ArrowLeft size={24} color="#FFF" />
      </Pressable>

      <FlatList
        data={shorts}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <ShortVideoCell
            item={item}
            index={index}
            activeIndex={activeIndex}
            isScreenFocused={isScreenFocused}
            isMuted={isMuted}
            onToggleMute={() => setIsMuted(!isMuted)}
            likedDict={likedDict}
            savedDict={savedDict}
            likesCountDict={likesCountDict}
            followingDict={followingDict}
            handleLikePress={handleLikePress}
            handleSavePress={handleSavePress}
            handleFollowPress={handleFollowPress}
            handleSharePress={handleSharePress}
            onOpenComments={handleOpenComments}
            user={user}
            router={router}
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews={Platform.OS === 'android'}
      />

      {/* Floating Comments Bottom Sheet Modal */}
      {commentingShortId && (
        <WatchCommentsSheet
          visible={showComments}
          contentId={commentingShortId}
          onClose={() => {
            setShowComments(false);
            setCommentingShortId(null);
          }}
        />
      )}

      {/* Simulated Replica of the floating bottom TabBar */}
      <View style={styles.floatingTabBar}>
        <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFillObject} />
        
        <Pressable onPress={() => router.push('/(tabs)' as any)} style={styles.tabItem}>
          <House color="#FFF" size={22} strokeWidth={2.2} />
          <Text style={styles.tabItemTextActive}>Explorar</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/(tabs)/study' as any)} style={styles.tabItem}>
          <BookOpenCheck color="#8E9AA6" size={22} strokeWidth={1.8} />
          <Text style={styles.tabItemText}>Estudo</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/(tabs)/messages' as any)} style={styles.tabItem}>
          <SendHorizontal color="#8E9AA6" size={22} strokeWidth={1.8} />
          <Text style={styles.tabItemText}>Mensagens</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/(tabs)/rewards' as any)} style={styles.tabItem}>
          <BadgeDollarSign color="#8E9AA6" size={22} strokeWidth={1.8} />
          <Text style={styles.tabItemText}>Recompensas</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonFloating: {
    position: 'absolute',
    left: 16,
    zIndex: 99,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellContainer: {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    backgroundColor: '#050505',
    position: 'relative',
  },
  bottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: WINDOW_HEIGHT * 0.35,
  },
  centerIconOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  centerPlayIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideControls: {
    position: 'absolute',
    right: 12,
    bottom: WINDOW_HEIGHT * 0.15,
    alignItems: 'center',
    gap: 18,
    zIndex: 10,
  },
  creatorAvatarButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    position: 'relative',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
  },
  fallbackAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackAvatarText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
  },
  avatarFollowPlus: {
    position: 'absolute',
    bottom: -6,
    backgroundColor: colors.accent,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlusText: {
    color: '#000',
    fontSize: 12,
    fontWeight: 'bold',
    lineHeight: 14,
  },
  actionColumn: {
    alignItems: 'center',
    gap: 4,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
  },
  iconCircleMute: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  actionCountText: {
    color: '#FAFAFA',
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  btnPressed: {
    opacity: 0.7,
  },
  bottomOverlay: {
    position: 'absolute',
    left: 16,
    bottom: 110, // Sits perfectly above the progress bar and floating tab bar
    right: 76,
    gap: 6,
    zIndex: 10,
  },
  creatorMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  avatarContainerLeft: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FFF',
    marginRight: 8,
    overflow: 'hidden',
  },
  avatarImageLeft: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholderLeft: {
    width: '100%',
    height: '100%',
    backgroundColor: '#8E9AA6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderTextLeft: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  creatorNameText: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 3,
  },
  followBtn: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.75)',
    borderWidth: 0.8,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginLeft: 10,
    alignSelf: 'center',
  },
  followBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderColor: 'transparent',
  },
  followBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'normal',
  },
  followBtnTextActive: {
    color: '#CCC',
  },
  videoTitleText: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 3,
  },
  videoDescText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    lineHeight: 15,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 3,
  },
  progressBarBg: {
    position: 'absolute',
    bottom: 92, // Right under the description, above the tab bar
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FFF',
  },
  floatingTabBar: {
    position: 'absolute',
    bottom: 16,
    left: 10,
    right: 10,
    height: 66,
    borderRadius: 33,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    flexDirection: 'row',
    padding: 6,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 0,
    zIndex: 99,
  },
  tabItem: {
    flex: 1,
    borderRadius: 27,
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    backgroundColor: 'transparent',
  },
  tabItemText: {
    color: '#8E9AA6',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 3,
  },
  tabItemTextActive: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
    marginTop: 3,
  },
  speedTriggerLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 180,
    width: 35,
    zIndex: 40,
  },
  speedTriggerRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 380, // Stop above action buttons on the right side
    width: 35,
    zIndex: 40,
  },
  speedIndicatorOverlay: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 50,
  },
  speedIndicatorText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
});

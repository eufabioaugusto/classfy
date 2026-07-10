import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export type FeaturedCreator = {
  id: string;
  creator_id: string;
  background_image_url: string;
  badge_text: string;
  featured_image_url: string;
  description: string;
  link_url: string;
  order_index: number;
  creator_name: string;
  total_duration: string;
  slug?: string | null;
};

type FeaturedCreatorsProps = {
  creators: FeaturedCreator[];
};

export function FeaturedCreators({ creators }: FeaturedCreatorsProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [followedIds, setFollowedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!user) {
      setFollowedIds([]);
      return;
    }
    fetchFollows();
  }, [user]);

  const fetchFollows = async () => {
    try {
      const { data, error } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user?.id);

      if (!error && data) {
        setFollowedIds(data.map((f: any) => f.following_id));
      }
    } catch (e) {
      console.error('Error fetching follows:', e);
    }
  };

  const handleFollowToggle = async (creatorId: string) => {
    if (!user) {
      router.push('/auth/sign-in' as any);
      return;
    }

    const isFollowing = followedIds.includes(creatorId);
    if (isFollowing) {
      // Optimistic state update
      setFollowedIds((prev) => prev.filter((id) => id !== creatorId));
      try {
        await supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', creatorId);
      } catch (e) {
        console.error('Failed to unfollow:', e);
      }
    } else {
      // Optimistic state update
      setFollowedIds((prev) => [...prev, creatorId]);
      try {
        await supabase
          .from('follows')
          .insert({
            follower_id: user.id,
            following_id: creatorId,
          });
      } catch (e) {
        console.error('Failed to follow:', e);
      }
    }
  };

  const handlePress = (creator: FeaturedCreator) => {
    if (creator.slug) {
      router.push(`/creator/featured/${creator.slug}` as any);
    } else if (creator.creator_id) {
      router.push(`/creator/${creator.creator_id}` as any);
    } else if (creator.link_url) {
      router.push(creator.link_url as any);
    }
  };

  if (!creators || creators.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Creators em Destaque</Text>
      <FlatList
        horizontal
        data={creators}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        snapToInterval={200 + spacing.md} // matches width + gap for clean pagination snapping
        decelerationRate="fast"
        renderItem={({ item }) => {
          const isFollowing = followedIds.includes(item.creator_id);

          return (
            <Pressable onPress={() => handlePress(item)} style={styles.card}>
              {/* Background Cover Image */}
              {item.background_image_url ? (
                <Image source={{ uri: item.background_image_url }} style={styles.backgroundImage} />
              ) : (
                <View style={styles.fallbackBackground} />
              )}

              {/* Dark Cinematic Gradient Overlay (transparent at top, dark at bottom/footer) */}
              <LinearGradient
                colors={['transparent', 'rgba(0, 0, 0, 0.25)', 'rgba(0, 0, 0, 0.7)']}
                locations={[0.0, 0.45, 0.75]}
                style={StyleSheet.absoluteFillObject}
              />

              {/* Top Left Badge */}
              {item.badge_text ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.badge_text}</Text>
                </View>
              ) : null}

              {/* Top Right Follow Button */}
              {item.creator_id ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    handleFollowToggle(item.creator_id);
                  }}
                  style={[
                    styles.followBadge,
                    isFollowing && styles.followBadgeActive
                  ]}
                >
                  <Ionicons
                    name={isFollowing ? 'checkmark-sharp' : 'add-sharp'}
                    size={10}
                    color="#fff"
                  />
                  <Text style={[styles.followBadgeText, isFollowing && styles.followBadgeTextActive]}>
                    {isFollowing ? 'Seguindo' : 'Seguir'}
                  </Text>
                </Pressable>
              ) : null}

              {/* Main Center Content */}
              <View style={styles.contentContainer}>
                {/* Creator Logo or Name */}
                {item.featured_image_url ? (
                  <Image
                    source={{ uri: item.featured_image_url }}
                    style={styles.logoImage}
                    resizeMode="contain"
                  />
                ) : (
                  <Text style={styles.creatorName}>{item.creator_name}</Text>
                )}

                {/* Minimalist divider */}
                <View style={styles.divider} />

                {/* Description */}
                <Text numberOfLines={2} style={styles.description}>
                  {item.description}
                </Text>

                {/* Duration with Clock Icon */}
                <View style={styles.durationRow}>
                  <Ionicons name="time-outline" size={14} color="rgba(255, 255, 255, 0.8)" />
                  <Text style={styles.durationText}>{item.total_duration}</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.titleSmall,
    fontWeight: typography.weightBold, // 700 bold weight matching web
    marginBottom: spacing.md,
    paddingHorizontal: 0, // Align exactly at 0 margin inside AppScreen
  },
  listContent: {
    gap: spacing.md,
    paddingHorizontal: 0, // Align exactly at 0 margin inside AppScreen
  },
  card: {
    backgroundColor: '#18181b',
    borderRadius: radius.md,
    height: 380,
    overflow: 'hidden',
    position: 'relative',
    width: 200,
  },
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
    height: '100%',
    width: '100%',
  },
  fallbackBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface,
  },
  badge: {
    backgroundColor: 'rgba(24, 24, 27, 0.9)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: radius.pill,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    position: 'absolute',
    top: spacing.sm,
    zIndex: 10,
  },
  badgeText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: typography.weightBold,
  },
  followBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(24, 24, 27, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.45)', // Premium white outline
    borderWidth: 1,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    zIndex: 10,
  },
  followBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  followBadgeText: {
    color: '#fff', // White text
    fontSize: 9,
    fontWeight: typography.weightBold,
  },
  followBadgeTextActive: {
    color: 'rgba(255, 255, 255, 0.75)', // Slightly translucent when active
  },
  contentContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    padding: spacing.md,
    zIndex: 2,
  },
  logoImage: {
    height: 80, // Increased by 30% (from 50)
    width: '100%', // Increased by ~12% (from 80%)
  },
  creatorName: {
    color: colors.text,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBold, // 700 bold weight matching web
    textAlign: 'center',
  },
  divider: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    height: 1,
    marginVertical: spacing.sm,
    width: 32,
  },
  description: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weightSemibold,
    lineHeight: 16,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  durationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
  },
  durationText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 10,
    fontWeight: typography.weightMedium,
  },
});

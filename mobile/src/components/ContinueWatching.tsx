import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface ContinueWatchingItem {
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

interface ContinueWatchingProps {
  userId: string;
}

export function ContinueWatching({ userId }: ContinueWatchingProps) {
  const router = useRouter();
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    fetchProgress();
  }, [userId]);

  const fetchProgress = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
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
        .eq('user_id', userId)
        .eq('completed', false)
        .gt('progress_percent', 0)
        .order('updated_at', { ascending: false })
        .limit(6);

      if (error) throw error;
      setItems((data || []) as any);
    } catch (e) {
      console.error('Error fetching continue watching progress:', e);
    } finally {
      setLoading(false);
    }
  };

  const handlePress = (contentId: string) => {
    router.push(`/watch/${contentId}` as any);
  };

  if (loading || items.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="time-outline" size={18} color={colors.text} />
          <Text style={styles.title}>Continue estudando</Text>
        </View>
        <Pressable onPress={() => router.push('/study' as any)}>
          <Text style={styles.actionLabel}>Ver tudo</Text>
        </Pressable>
      </View>

      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.content_id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          if (!item.contents) return null;

          const profile = Array.isArray(item.contents.profiles)
            ? item.contents.profiles[0]
            : item.contents.profiles;
          const creatorName =
            profile?.creator_channel_name || profile?.display_name || 'Creator Classfy';

          return (
            <Pressable onPress={() => handlePress(item.content_id)} style={styles.card}>
              {/* Card Thumbnail */}
              <View style={styles.thumbnailContainer}>
                {item.contents.thumbnail_url ? (
                  <Image
                    source={{ uri: item.contents.thumbnail_url }}
                    style={styles.thumbnail}
                  />
                ) : (
                  <View style={styles.fallbackThumbnail} />
                )}
                {/* Subtle dark tint */}
                <View style={styles.shade} />
              </View>

              {/* Meta information */}
              <View style={styles.meta}>
                <Text style={styles.videoTitle} numberOfLines={1}>
                  {item.contents.title}
                </Text>
                <Text style={styles.creatorName} numberOfLines={1}>
                  {creatorName}
                </Text>

                {/* Progress bar and percent label */}
                <View style={styles.progressRow}>
                  <View style={styles.progressBarBg}>
                    <View
                      style={[styles.progressBarFill, { width: `${item.progress_percent}%` }]}
                    />
                  </View>
                  <Text style={styles.percentText}>{item.progress_percent}%</Text>
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
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    paddingHorizontal: 0, // Align exactly at 0 margin inside AppScreen
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: typography.titleSmall,
    fontWeight: typography.weightBold, // 700 bold weight matching web
  },
  actionLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: typography.weightBold,
  },
  listContent: {
    gap: spacing.md,
    paddingHorizontal: 0, // Align exactly at 0 margin inside AppScreen
  },
  card: {
    backgroundColor: '#111',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    width: 220,
  },
  thumbnailContainer: {
    aspectRatio: 16 / 9,
    position: 'relative',
    width: '100%',
  },
  thumbnail: {
    height: '100%',
    width: '100%',
  },
  fallbackThumbnail: {
    backgroundColor: colors.surface,
    height: '100%',
    width: '100%',
  },
  shade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  meta: {
    padding: spacing.sm,
  },
  videoTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weightBold,
    marginBottom: 2,
  },
  creatorName: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: typography.weightMedium,
    marginBottom: spacing.xs,
  },
  progressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: 2,
  },
  progressBarBg: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: radius.pill,
    flex: 1,
    height: 3, // Thinner progress bar
    overflow: 'hidden',
  },
  progressBarFill: {
    backgroundColor: colors.accent, // Classfy Red accent
    height: '100%',
  },
  percentText: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: typography.weightBold,
    width: 24,
    textAlign: 'right',
  },
});

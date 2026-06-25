import { Href, Link } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '@/theme/tokens';
import { ContentSummary } from '@/types/content';

type ContentCardProps = {
  content: ContentSummary;
};

function creatorName(content: ContentSummary) {
  const profile = Array.isArray(content.profiles) ? content.profiles[0] : content.profiles;
  return profile?.display_name || 'Creator Classfy';
}

function formatViews(value?: number | null) {
  if (!value) return '0 views';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M views`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K views`;
  return `${value} views`;
}

export function ContentCard({ content }: ContentCardProps) {
  return (
    <Link href={`/watch/${content.id}` as Href} asChild>
      <Pressable style={styles.card}>
        <View style={styles.thumbnail}>
          {content.thumbnail_url ? (
            <Image source={{ uri: content.thumbnail_url }} style={styles.image} />
          ) : (
            <Text style={styles.thumbnailText}>{content.content_type || 'video'}</Text>
          )}
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{content.visibility || 'free'}</Text>
          </View>
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={2} style={styles.title}>
            {content.title}
          </Text>
          <Text numberOfLines={1} style={styles.meta}>
            {creatorName(content)} · {formatViews(content.views_count)}
          </Text>
          {content.description ? (
            <Text numberOfLines={2} style={styles.description}>
              {content.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  thumbnail: {
    alignItems: 'center',
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    height: '100%',
    width: '100%',
  },
  thumbnailText: {
    color: colors.accent,
    fontSize: type.md,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  badge: {
    backgroundColor: 'rgba(9, 11, 16, 0.82)',
    borderRadius: radius.sm,
    bottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    position: 'absolute',
    right: spacing.sm,
  },
  badgeText: {
    color: colors.text,
    fontSize: type.xs,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  copy: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: type.lg,
    fontWeight: '900',
    lineHeight: 24,
  },
  meta: {
    color: colors.muted,
    fontSize: type.sm,
  },
  description: {
    color: colors.muted,
    fontSize: type.sm,
    lineHeight: 19,
  },
});

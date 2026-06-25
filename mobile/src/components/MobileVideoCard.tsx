import { Href, Link } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { HomeContent } from '@/features/home/homeData';

type MobileVideoCardProps = {
  content: HomeContent;
  featured?: boolean;
};

const accessColor = {
  free: colors.free,
  pro: colors.pro,
  premium: colors.premium,
  paid: colors.hot,
};

export function MobileVideoCard({ content, featured = false }: MobileVideoCardProps) {
  return (
    <Link href={`/watch/${content.id}` as Href} asChild>
      <Pressable style={styles.container}>
        <View style={[styles.thumbnail, { backgroundColor: content.tone }]}>
          {content.thumbnailUrl ? (
            <Image source={{ uri: content.thumbnailUrl }} style={styles.thumbnailImage} />
          ) : null}
          <View style={styles.thumbnailShade} />
          <View style={styles.playCircle}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
          <View style={styles.durationPill}>
            <Text style={styles.durationText}>{content.duration}</Text>
          </View>
          <View style={[styles.accessPill, { backgroundColor: accessColor[content.access] }]}>
            <Text style={styles.accessText}>{content.access}</Text>
          </View>
        </View>
        <View style={styles.metaRow}>
          <View style={styles.avatar}>
            {content.creatorAvatarUrl ? (
              <Image source={{ uri: content.creatorAvatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{content.creator[0]}</Text>
            )}
          </View>
          <View style={styles.copy}>
            <Text numberOfLines={featured ? 2 : 2} style={[styles.title, featured && styles.featuredTitle]}>
              {content.title}
            </Text>
            <Text numberOfLines={1} style={styles.meta}>
              {content.creator} · {content.views}
            </Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  thumbnail: {
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  thumbnailImage: {
    height: '100%',
    width: '100%',
  },
  thumbnailShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlaySoft,
  },
  playCircle: {
    alignItems: 'center',
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    height: 48,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -24,
    marginTop: -24,
    position: 'absolute',
    top: '50%',
    width: 48,
  },
  playIcon: {
    color: colors.text,
    fontSize: 18,
    marginLeft: 2,
  },
  durationPill: {
    backgroundColor: colors.overlay,
    borderRadius: radius.xs,
    bottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    position: 'absolute',
    right: spacing.sm,
  },
  durationText: {
    color: colors.text,
    fontSize: typography.label,
    fontWeight: typography.weightBold,
  },
  accessPill: {
    borderRadius: radius.xs,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    position: 'absolute',
    top: spacing.sm,
  },
  accessText: {
    color: colors.background,
    fontSize: typography.label,
    fontWeight: typography.weightBlack,
    textTransform: 'uppercase',
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 38,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 38,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBold,
    lineHeight: 21,
  },
  featuredTitle: {
    fontSize: typography.titleSmall,
    lineHeight: 24,
  },
  meta: {
    color: colors.muted,
    fontSize: typography.caption,
    fontWeight: typography.weightMedium,
  },
});

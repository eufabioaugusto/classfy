import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { HomeContent } from '@/features/home/homeData';
import { useAuth } from '@/features/auth/authContext';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type MobileVideoCardProps = {
  content: HomeContent;
  featured?: boolean;
  layout?: 'horizontal' | 'vertical' | 'square';
};

const accessColor = {
  free: colors.free || '#3b82f6',
  pro: '#f59e0b', // Pro is always Yellow
  premium: '#ef4444', // Premium is always Red
  paid: '#10b981', // Paid green
};

export function MobileVideoCard({ content, featured = false, layout = 'horizontal' }: MobileVideoCardProps) {
  const { user } = useAuth();
  const router = useRouter();
  // Watch resolves actual access, including confirmed purchases and authorship.
  const openContent = () => router.push(user
    ? { pathname: '/watch/[id]', params: { id: content.id } }
    : { pathname: '/auth/sign-in', params: { contentId: content.id } });

  const getAspectRatio = () => {
    if (layout === 'square') return 1;
    if (layout === 'vertical') return 9 / 16;
    return 16 / 9;
  };

  const discount = content.discount || 0;
  const price = content.price || 0;
  const finalPrice = price * (1 - discount / 100);

  return (
      <Pressable onPress={openContent} accessibilityRole="button" accessibilityLabel={`${content.title}, ${content.creator}`} style={({ pressed }) => [styles.container, pressed && { opacity: 0.8 }]}>
        <View style={[styles.thumbnail, { backgroundColor: content.tone, aspectRatio: getAspectRatio() }]}>
          {content.thumbnailUrl ? (
            <Image source={{ uri: content.thumbnailUrl }} style={styles.thumbnailImage} contentFit="cover" recyclingKey={content.id} transition={180} />
          ) : null}

          {content.duration ? <View style={styles.durationPill}><Text style={styles.durationText}>{content.duration}</Text></View> : null}
          <View style={[styles.accessPill, { backgroundColor: accessColor[content.access] || '#111' }]}>
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
            <Text numberOfLines={2} style={[styles.title, featured && styles.featuredTitle]}>
              {content.title}
            </Text>
            <Text numberOfLines={1} style={styles.meta}>
              {content.creator} · {content.views}
            </Text>

            {/* Informational price; Watch resolves ownership before purchase. */}
            {content.access === 'paid' && price > 0 ? (
              <View style={styles.priceTagRow}>
                <Ionicons name="cart-outline" size={13} color="#ef4444" />
                <Text style={styles.priceTagText}>
                  R$ {finalPrice.toFixed(2).replace('.', ',')}
                </Text>
                {discount > 0 && (
                  <Text style={styles.strikethroughPrice}>
                    R$ {price.toFixed(2).replace('.', ',')}
                  </Text>
                )}

              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    marginBottom: spacing.xxl,
    marginHorizontal: 0,
  },
  thumbnail: {
    borderRadius: 0,
    overflow: 'hidden',
  },
  thumbnailImage: {
    height: '100%',
    width: '100%',
  },
  durationPill: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.xs,
    bottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    position: 'absolute',
    right: spacing.sm,
  },
  durationText: {
    color: colors.text || '#FFF',
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
    color: '#000',
    fontSize: typography.label,
    fontWeight: typography.weightBlack,
    textTransform: 'uppercase',
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: 16,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#222',
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
    color: colors.text || '#FFF',
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    color: colors.text || '#FFF',
    fontSize: 15,
    fontWeight: typography.weightBold,
    lineHeight: 21,
  },
  featuredTitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  meta: {
    color: colors.muted || '#888',
    fontSize: typography.caption,
    fontWeight: typography.weightMedium,
  },
  priceTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 4,
  },
  priceTagText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '900',
  },
  strikethroughPrice: {
    color: '#888',
    textDecorationLine: 'line-through',
    fontSize: 10,
    marginLeft: 2,
  },
});

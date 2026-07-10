import { Href, Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Crown } from 'lucide-react-native';
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
  const { profile } = useAuth();
  const userPlan = (profile?.plan || 'free') as 'free' | 'pro' | 'premium';

  // Access check to decide the target route directly on card click
  let targetHref: string = `/watch/${content.id}`;

  if (content.access === 'paid') {
    targetHref = `/purchase/${content.id}`;
  } else if (content.access === 'pro' && userPlan === 'free') {
    targetHref = '/premium';
  } else if (content.access === 'premium' && userPlan !== 'premium') {
    targetHref = '/premium';
  }

  const getAspectRatio = () => {
    if (layout === 'square') return 1;
    if (layout === 'vertical') return 9 / 16;
    return 16 / 9;
  };

  const discount = content.discount || 0;
  const price = content.price || 0;
  const finalPrice = price * (1 - discount / 100);

  return (
    <Link href={targetHref as Href} asChild>
      <Pressable style={styles.container}>
        <View style={[styles.thumbnail, { backgroundColor: content.tone, aspectRatio: getAspectRatio() }]}>
          {content.thumbnailUrl ? (
            <Image source={{ uri: content.thumbnailUrl }} style={styles.thumbnailImage} />
          ) : null}
          <View style={styles.thumbnailShade} />

          {/* Top-Right Crown Tier badges */}
          {content.access === 'premium' && (
            <View style={styles.crownBadge}>
              <Crown size={16} color="#ef4444" fill="#ef4444" />
            </View>
          )}
          {content.access === 'pro' && (
            <View style={styles.crownBadge}>
              <Crown size={16} color="#f59e0b" fill="#f59e0b" />
            </View>
          )}

          <View style={styles.durationPill}>
            <Text style={styles.durationText}>{content.duration}</Text>
          </View>
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
            <Text numberOfLines={featured ? 2 : 2} style={[styles.title, featured && styles.featuredTitle]}>
              {content.title}
            </Text>
            <Text numberOfLines={1} style={styles.meta}>
              {content.creator} · {content.views}
            </Text>

            {/* Display Price and Buy Options for Paid Content */}
            {content.access === 'paid' && price > 0 ? (
              <View style={styles.priceTagRow}>
                <Ionicons name="cart-outline" size={13} color="#ef4444" />
                <Text style={styles.priceTagText}>
                  R$ {finalPrice.toFixed(2)}
                </Text>
                {discount > 0 && (
                  <Text style={styles.strikethroughPrice}>
                    R$ {price.toFixed(2)}
                  </Text>
                )}
                <View style={styles.buyBadge}>
                  <Text style={styles.buyBadgeText}>COMPRAR</Text>
                </View>
              </View>
            ) : null}
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
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  thumbnailImage: {
    height: '100%',
    width: '100%',
  },
  thumbnailShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9, 11, 16, 0.25)',
  },
  crownBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
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
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBold,
    lineHeight: 21,
  },
  featuredTitle: {
    fontSize: typography.titleSmall,
    lineHeight: 24,
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
  buyBadge: {
    backgroundColor: 'rgba(226, 29, 72, 0.08)',
    borderColor: 'rgba(226, 29, 72, 0.15)',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
  },
  buyBadgeText: {
    color: '#ef4444',
    fontSize: 9,
    fontWeight: '900',
  },
});

import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { SectionHeader } from '@/components/SectionHeader';
import { useWatchActions } from '@/features/watch/useWatchActions';
import { useWatchContent } from '@/features/watch/useWatchContent';
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

function blockCopy(reason: string | null, requiredPlan: string) {
  if (reason === 'purchase') return 'Compre este conteudo para assistir no mobile.';
  if (reason === 'login') return `Entre com uma conta ${requiredPlan.toUpperCase()} ou superior para assistir.`;
  if (reason === 'plan') return `Este conteudo exige plano ${requiredPlan.toUpperCase()}.`;
  return 'Acesso indisponivel.';
}

export default function WatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { content, access, followersCount, loading, error } = useWatchContent(id);
  const actions = useWatchActions({
    contentId: content?.id,
    isCourse: content?.isCourse,
    initialLikes: content?.likes_count,
    hasAccess: access.hasAccess,
  });

  if (loading) {
    return (
      <AppScreen>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.centerText}>Carregando Watch...</Text>
        </View>
      </AppScreen>
    );
  }

  if (error || !content) {
    return (
      <AppScreen>
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>Conteudo indisponivel</Text>
          <Text style={styles.centerText}>{error || 'Nao foi possivel carregar este conteudo.'}</Text>
          <Pressable style={styles.primaryButton} onPress={() => router.back()}>
            <Text style={styles.primaryButtonText}>Voltar</Text>
          </Pressable>
        </View>
      </AppScreen>
    );
  }

  const showPlayableVideo = access.hasAccess && content.file_url && !content.isCourse;

  return (
    <AppScreen>
      <View style={styles.player}>
        {showPlayableVideo ? (
          <Video
            source={{ uri: content.file_url! }}
            style={styles.video}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            posterSource={content.thumbnail_url ? { uri: content.thumbnail_url } : undefined}
            posterStyle={styles.video}
          />
        ) : (
          <>
            {content.thumbnail_url ? <Image source={{ uri: content.thumbnail_url }} style={styles.poster} /> : null}
            <View style={styles.posterOverlay} />
            <View style={styles.playBadge}>
              <Ionicons
                name={access.hasAccess ? 'play' : 'lock-closed'}
                color={colors.text}
                size={34}
              />
            </View>
          </>
        )}
      </View>

      {!access.hasAccess ? (
        <View style={styles.accessPanel}>
          <Text style={styles.accessTitle}>Acesso bloqueado</Text>
          <Text style={styles.accessBody}>{blockCopy(access.reason, access.requiredPlan)}</Text>
        </View>
      ) : null}

      <View style={styles.titleBlock}>
        <Text style={styles.type}>{content.isCourse ? 'Curso' : content.content_type}</Text>
        <Text style={styles.title}>{content.title}</Text>
        <Text style={styles.meta}>
          {formatCount(content.views_count)} views · {content.visibility.toUpperCase()}
          {access.isPurchased ? ' · comprado' : ''}
        </Text>
      </View>

      <View style={styles.creatorRow}>
        <View style={styles.avatar}>
          {content.creator?.avatar_url ? (
            <Image source={{ uri: content.creator.avatar_url }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{content.creator?.display_name?.[0] || 'C'}</Text>
          )}
        </View>
        <View style={styles.creatorCopy}>
          <Text numberOfLines={1} style={styles.creatorName}>
            {content.creator?.creator_channel_name || content.creator?.display_name || 'Creator Classfy'}
          </Text>
          <Text style={styles.creatorMeta}>{formatCount(followersCount)} seguidores</Text>
        </View>
      </View>

      <View style={styles.actions}>
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
        <ActionButton icon="school-outline" label="Estudo" onPress={() => {}} />
      </View>

      {content.description ? (
        <View style={styles.description}>
          <Text style={styles.descriptionText}>{content.description}</Text>
        </View>
      ) : null}

      {content.tags?.length ? (
        <>
          <SectionHeader title="Tags" />
          <View style={styles.tags}>
            {content.tags.slice(0, 8).map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>#{tag}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </AppScreen>
  );
}

type ActionButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
};

function ActionButton({ icon, label, active, onPress }: ActionButtonProps) {
  return (
    <Pressable style={[styles.actionButton, active && styles.actionButtonActive]} onPress={onPress}>
      <Ionicons name={icon} color={active ? colors.background : colors.text} size={18} />
      <Text style={[styles.actionText, active && styles.actionTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  player: {
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    overflow: 'hidden',
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
  playBadge: {
    alignItems: 'center',
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    height: 64,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -32,
    marginTop: -32,
    position: 'absolute',
    top: '50%',
    width: 64,
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
  titleBlock: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  type: {
    color: colors.accent,
    fontSize: typography.label,
    fontWeight: typography.weightBlack,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: typography.weightBlack,
    lineHeight: 28,
  },
  meta: {
    color: colors.muted,
    fontSize: typography.caption,
    fontWeight: typography.weightMedium,
  },
  creatorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 44,
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
  },
  creatorName: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: typography.weightBold,
  },
  creatorMeta: {
    color: colors.muted,
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionButtonActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  actionText: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
  },
  actionTextActive: {
    color: colors.background,
  },
  description: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: spacing.xl,
    padding: spacing.md,
  },
  descriptionText: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 20,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.section,
  },
  tag: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tagText: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    paddingVertical: spacing.section,
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
});

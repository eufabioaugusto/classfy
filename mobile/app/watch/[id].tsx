import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { WatchCommentsSheet } from '@/components/WatchCommentsSheet';
import { WatchDescriptionSheet } from '@/components/WatchDescriptionSheet';
import { useWatchActions } from '@/features/watch/useWatchActions';
import { useWatchContent } from '@/features/watch/useWatchContent';
import { useWatchProgress } from '@/features/watch/useWatchProgress';
import { useWatchRelated, type WatchRelatedItem } from '@/features/watch/useWatchRelated';
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const { content, access, followersCount, loading, error } = useWatchContent(id);
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
    contentId: content?.id,
    durationSeconds: content?.duration_seconds,
    enabled: Boolean(access.hasAccess && content?.file_url && !content?.isCourse),
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
  const creatorName = content.creator?.creator_channel_name || content.creator?.display_name || 'Creator Classfy';

  return (
    <AppScreen edgeToEdge>
      <View style={styles.playerShell}>
        <View style={styles.player}>
          {showPlayableVideo ? (
            <Video
              source={{ uri: content.file_url! }}
              style={styles.video}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              posterSource={content.thumbnail_url ? { uri: content.thumbnail_url } : undefined}
              posterStyle={styles.video}
              onPlaybackStatusUpdate={(status) => {
                if (status.isLoaded && status.isPlaying) {
                  progress.handlePlaybackPosition(status.positionMillis / 1000);
                }
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
        </View>
      </View>

      <View style={styles.body}>
        {!access.hasAccess ? (
          <View style={styles.accessPanel}>
            <Text style={styles.accessTitle}>Acesso bloqueado</Text>
            <Text style={styles.accessBody}>{blockCopy(access.reason, access.requiredPlan)}</Text>
          </View>
        ) : null}

        <View style={styles.titleBlock}>
          <View style={styles.typeRow}>
            <Text style={styles.type}>{formatType(content.content_type, content.isCourse)}</Text>
            <Text style={styles.dot}>•</Text>
            <Text style={styles.meta}>{formatCount(content.views_count)} views</Text>
            <Text style={styles.dot}>•</Text>
            <Text style={styles.meta}>{content.visibility.toUpperCase()}</Text>
          </View>
          <Text style={styles.title}>{content.title}</Text>
        </View>

        <View style={styles.creatorRow}>
          <View style={styles.creatorLeft}>
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
              <Text style={styles.creatorMeta}>{formatCount(followersCount)} seguidores</Text>
            </View>
          </View>
          <Pressable style={styles.followButton}>
            <Text style={styles.followButtonText}>Seguir</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.actions}
        >
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
          <ActionButton icon="share-social-outline" label="Compartilhar" onPress={() => {}} />
        </ScrollView>

        <Pressable style={styles.descriptionCard} onPress={() => setDescriptionOpen(true)}>
          <Text style={styles.descriptionMeta}>
            {formatCount(content.views_count)} views
            {content.tags?.length ? `  ${content.tags.slice(0, 3).map((tag) => `#${tag}`).join(' ')}` : ''}
          </Text>
          <Text numberOfLines={2} style={styles.descriptionText}>
            {content.description || 'Sem descricao disponivel.'}
          </Text>
          <View style={styles.moreRow}>
            <Text style={styles.moreText}>...mais</Text>
            <Ionicons name="chevron-down" color={colors.muted} size={16} />
          </View>
        </Pressable>

        <WatchStudyTools isCourse={content.isCourse} />

        {showPlayableVideo ? (
          <View style={styles.progressPanel}>
            <View style={styles.progressTop}>
              <Text style={styles.progressLabel}>Progresso real</Text>
              <Text style={styles.progressValue}>{Math.floor(progress.watchPercent)}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(progress.watchPercent, 100)}%` }]} />
            </View>
            <View style={styles.milestones}>
              <Milestone label="Start" active={progress.milestones.start} />
              <Milestone label="15s" active={progress.milestones.view15s} />
              <Milestone label="50%" active={progress.milestones.half} />
              <Milestone label="90%" active={progress.milestones.complete} />
            </View>
          </View>
        ) : null}

        <Pressable style={styles.commentsRow} onPress={() => setCommentsOpen(true)}>
          <View style={styles.rowTitle}>
            <Ionicons name="chatbubble-outline" color={colors.muted} size={23} />
            <Text style={styles.rowTitleText}>Comentarios</Text>
          </View>
          <Ionicons name="chevron-down" color={colors.muted} size={22} />
        </Pressable>

        <WatchRelatedList items={related.items} loading={related.loading} />
      </View>

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
      <WatchCommentsSheet
        visible={commentsOpen}
        contentId={content.id}
        onClose={() => setCommentsOpen(false)}
      />
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
      <Ionicons name={icon} color={active ? colors.background : colors.text} size={20} />
      <Text style={[styles.actionText, active && styles.actionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function WatchStudyTools({ isCourse }: { isCourse: boolean }) {
  const tools: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string }> = [
    { icon: 'document-text-outline', label: 'Transcricao' },
    { icon: 'bulb-outline', label: 'Quiz' },
    { icon: 'reader-outline', label: 'Anotacoes' },
    { icon: 'sparkles-outline', label: 'Sugestoes' },
  ];

  return (
    <View style={styles.toolsBlock}>
      <View style={styles.sectionTitleRow}>
        <Ionicons name={isCourse ? 'list-outline' : 'sparkles-outline'} color={colors.text} size={22} />
        <Text style={styles.sectionTitle}>{isCourse ? 'Conteudo e estudo' : 'Ferramentas de Estudo'}</Text>
      </View>
      <View style={styles.toolsGrid}>
        {tools.map((tool) => (
          <Pressable key={tool.label} style={styles.toolButton}>
            <View style={styles.toolIcon}>
              <Ionicons name={tool.icon} color={colors.text} size={24} />
            </View>
            <Text style={styles.toolText}>{tool.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Milestone({ label, active }: { label: string; active: boolean }) {
  return (
    <View style={[styles.milestone, active && styles.milestoneActive]}>
      <Text style={[styles.milestoneText, active && styles.milestoneTextActive]}>{label}</Text>
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
          <Pressable
            key={item.id}
            style={styles.relatedItem}
            onPress={() => router.push(`/watch/${item.id}`)}
          >
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
  titleBlock: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  typeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  type: {
    color: colors.accent,
    fontSize: typography.label,
    fontWeight: typography.weightBlack,
    textTransform: 'uppercase',
  },
  dot: {
    color: colors.mutedDim,
    fontSize: typography.caption,
  },
  meta: {
    color: colors.muted,
    fontSize: typography.caption,
    fontWeight: typography.weightMedium,
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
    backgroundColor: colors.text,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  followButtonText: {
    color: colors.background,
    fontSize: typography.caption,
    fontWeight: typography.weightBlack,
  },
  actions: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  actionButtonActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  actionText: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBlack,
  },
  actionTextActive: {
    color: colors.background,
  },
  descriptionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    gap: spacing.xs,
    marginBottom: spacing.xl,
    padding: spacing.lg,
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
  toolButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexBasis: '47.8%',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 74,
    padding: spacing.md,
  },
  toolIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  toolText: {
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
  },
  progressPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  progressTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressLabel: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBlack,
  },
  progressValue: {
    color: colors.accent,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBlack,
  },
  progressTrack: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 5,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.accent,
    height: '100%',
  },
  milestones: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  milestone: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  milestoneActive: {
    backgroundColor: colors.accent,
  },
  milestoneText: {
    color: colors.muted,
    fontSize: typography.label,
    fontWeight: typography.weightBold,
  },
  milestoneTextActive: {
    color: colors.text,
  },
  commentsRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
    minHeight: 62,
    paddingHorizontal: spacing.lg,
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

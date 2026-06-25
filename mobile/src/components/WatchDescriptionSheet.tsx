import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type WatchDescriptionSheetProps = {
  visible: boolean;
  title: string;
  description?: string | null;
  viewsCount?: number | null;
  likesCount?: number | null;
  createdAt?: string | null;
  creatorName?: string | null;
  tags?: string[] | null;
  onClose: () => void;
};

function formatCount(value?: number | null) {
  if (!value) return '0';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

function formatDate(value?: string | null) {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem data';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function WatchDescriptionSheet({
  visible,
  title,
  description,
  viewsCount,
  likesCount,
  createdAt,
  creatorName,
  tags,
  onClose,
}: WatchDescriptionSheetProps) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Descricao</Text>
            <Pressable hitSlop={12} onPress={onClose}>
              <Ionicons name="close" color={colors.text} size={28} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{title}</Text>

            <View style={styles.stats}>
              <Stat value={formatCount(likesCount)} label="Gostei" />
              <Stat value={formatCount(viewsCount)} label="Views" />
              <Stat value={formatDate(createdAt)} label="Publicado" />
            </View>

            {creatorName ? (
              <View style={styles.creatorChip}>
                <Text style={styles.creatorChipText}>{creatorName}</Text>
              </View>
            ) : null}

            <View style={styles.descriptionCard}>
              <Text style={styles.descriptionText}>
                {description || 'Sem descricao disponivel para este conteudo.'}
              </Text>
            </View>

            {tags?.length ? (
              <View style={styles.tags}>
                {tags.slice(0, 12).map((tag) => (
                  <View key={tag} style={styles.tag}>
                    <Text style={styles.tagText}>#{tag}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text numberOfLines={1} style={styles.statValue}>
        {value}
      </Text>
      <Text numberOfLines={1} style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.58)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.backgroundElevated,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '78%',
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 5,
    marginBottom: spacing.xl,
    marginTop: spacing.md,
    width: 52,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: -spacing.lg,
    marginBottom: spacing.xl,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  headerTitle: {
    color: colors.text,
    fontSize: typography.titleSmall,
    fontWeight: typography.weightBlack,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: typography.weightBlack,
    lineHeight: 29,
    marginBottom: spacing.lg,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  stat: {
    backgroundColor: '#2A1711',
    borderRadius: radius.md,
    flex: 1,
    minHeight: 68,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  statValue: {
    color: colors.text,
    fontSize: typography.titleSmall,
    fontWeight: typography.weightBlack,
    textAlign: 'center',
  },
  statLabel: {
    color: colors.muted,
    fontSize: typography.caption,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  creatorChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#321D16',
    borderRadius: radius.pill,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  creatorChipText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: typography.weightBold,
  },
  descriptionCard: {
    backgroundColor: '#261711',
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  descriptionText: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 24,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.xl,
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
});

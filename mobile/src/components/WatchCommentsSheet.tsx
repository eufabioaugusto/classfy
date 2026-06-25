import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useWatchComments, WatchComment } from '@/features/watch/useWatchComments';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type WatchCommentsSheetProps = {
  visible: boolean;
  contentId: string;
  onClose: () => void;
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  });
}

function CommentRow({ comment }: { comment: WatchComment }) {
  const name = comment.profiles?.display_name || 'Usuario';

  return (
    <View style={styles.commentRow}>
      <View style={styles.avatar}>
        {comment.profiles?.avatar_url ? (
          <Image source={{ uri: comment.profiles.avatar_url }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarText}>{name[0]?.toUpperCase() || 'U'}</Text>
        )}
      </View>
      <View style={styles.commentCopy}>
        <View style={styles.commentMetaRow}>
          <Text numberOfLines={1} style={styles.commentName}>
            {name}
          </Text>
          <Text style={styles.commentDate}>{formatDate(comment.created_at)}</Text>
        </View>
        <Text style={styles.commentText}>{comment.text}</Text>
      </View>
    </View>
  );
}

export function WatchCommentsSheet({ visible, contentId, onClose }: WatchCommentsSheetProps) {
  const [newComment, setNewComment] = useState('');
  const { comments, loading, submitting, user, profile, submitComment } = useWatchComments({
    contentId,
    enabled: visible,
  });

  async function handleSubmit() {
    const ok = await submitComment(newComment);
    if (ok) setNewComment('');
  }

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Comentarios ({comments.length})</Text>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" color={colors.text} size={20} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <CommentRow comment={item} />}
              contentContainerStyle={styles.commentList}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>Nenhum comentario ainda</Text>
                  <Text style={styles.emptyBody}>Seja o primeiro a comentar.</Text>
                </View>
              }
            />
          )}

          {user ? (
            <View style={styles.inputRow}>
              <View style={styles.inputAvatar}>
                <Text style={styles.avatarText}>
                  {(profile?.display_name || user.email || 'U')[0]?.toUpperCase()}
                </Text>
              </View>
              <TextInput
                value={newComment}
                onChangeText={setNewComment}
                placeholder="Adicione um comentario..."
                placeholderTextColor={colors.muted}
                style={styles.input}
                multiline
              />
              <Pressable
                disabled={submitting || !newComment.trim()}
                onPress={handleSubmit}
                style={[styles.sendButton, (!newComment.trim() || submitting) && styles.sendButtonDisabled]}
              >
                <Ionicons name="send" color={colors.text} size={18} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.loginHint}>
              <Text style={styles.loginHintText}>Entre para comentar.</Text>
            </View>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '82%',
    minHeight: '62%',
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 4,
    marginTop: spacing.sm,
    width: 42,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBlack,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
  },
  commentList: {
    padding: spacing.lg,
  },
  commentRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 36,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarText: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBlack,
  },
  commentCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  commentMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  commentName: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBold,
  },
  commentDate: {
    color: colors.muted,
    fontSize: typography.caption,
  },
  commentText: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 19,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.section,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
  },
  emptyBody: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    marginTop: spacing.xs,
  },
  inputRow: {
    alignItems: 'flex-end',
    borderTopColor: colors.borderSubtle,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  inputAvatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    color: colors.text,
    flex: 1,
    fontSize: typography.bodySmall,
    maxHeight: 96,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  loginHint: {
    borderTopColor: colors.borderSubtle,
    borderTopWidth: 1,
    padding: spacing.lg,
  },
  loginHintText: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    textAlign: 'center',
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useState, useRef, useMemo, useEffect } from 'react';
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
  Animated,
  PanResponder,
  Dimensions,
  useWindowDimensions,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWatchComments, WatchComment } from '@/features/watch/useWatchComments';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { useBottomSheetScroll } from '@/hooks/useBottomSheetScroll';

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

const AnimatedKeyboardAvoidingView = Animated.createAnimatedComponent(KeyboardAvoidingView);

export function WatchCommentsSheet({ visible, contentId, onClose }: WatchCommentsSheetProps) {
  const [newComment, setNewComment] = useState('');
  const { comments, loading, submitting, user, profile, submitComment } = useWatchComments({
    contentId,
    enabled: visible,
  });

  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const playerHeight = isLandscape ? 0 : windowWidth * (9 / 16);
  const playerBottom = isLandscape ? 20 : insets.top + 12 + playerHeight;
  const maxSheetHeight = windowHeight - playerBottom;

  const {
    scrollEnabled,
    handleScroll,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    isScrollAtTop,
    setIsScrollAtTop,
  } = useBottomSheetScroll();

  useEffect(() => {
    if (visible) {
      sheetTranslateY.setValue(0);
      setIsScrollAtTop(true);
    }
  }, [visible, setIsScrollAtTop]);

  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          isScrollAtTop && gestureState.dy > 5 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          isScrollAtTop && gestureState.dy > 5 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            sheetTranslateY.setValue(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 120 || gestureState.vy > 0.5) {
            Animated.timing(sheetTranslateY, {
              toValue: Dimensions.get('window').height,
              duration: 200,
              useNativeDriver: true,
            }).start(() => {
              onClose();
            });
          } else {
            Animated.spring(sheetTranslateY, {
              toValue: 0,
              friction: 8,
              tension: 80,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [onClose, sheetTranslateY, isScrollAtTop]
  );

  async function handleSubmit() {
    const ok = await submitComment(newComment);
    if (ok) setNewComment('');
  }

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <AnimatedKeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[
            styles.sheet,
            {
              maxHeight: maxSheetHeight,
              transform: [{ translateY: sheetTranslateY }]
            }
          ]}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          {...sheetPanResponder.panHandlers}
        >
          <View
            style={[
              { flex: 1, width: '100%' },
              isLandscape && {
                width: Math.min(windowWidth, windowHeight * (16 / 9)),
                alignSelf: 'center',
              }
            ]}
          >
            <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
              <View onStartShouldSetResponder={() => true} style={{ backgroundColor: 'transparent' }}>
                <View style={styles.handle} />
                <View style={styles.header}>
                  <Text style={styles.title}>Comentarios ({comments.length})</Text>
                  <Pressable style={styles.closeButton} onPress={onClose}>
                    <Ionicons name="close" color={colors.text} size={20} />
                  </Pressable>
                </View>
              </View>

              {loading ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : (
                <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                  <FlatList
                    data={comments}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => <CommentRow comment={item} />}
                    contentContainerStyle={styles.commentList}
                    onScroll={handleScroll}
                    scrollEventThrottle={16}
                    bounces={false}
                    disableScrollViewPanResponder={true}
                    scrollEnabled={scrollEnabled}
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    onTouchCancel={onTouchCancel}
                    keyboardDismissMode="interactive"
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={
                      <View style={styles.empty}>
                        <Text style={styles.emptyTitle}>Nenhum comentario ainda</Text>
                        <Text style={styles.emptyBody}>Seja o primeiro a comentar.</Text>
                      </View>
                    }
                  />
                </TouchableWithoutFeedback>
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
        </AnimatedKeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'transparent',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '82%',
    minHeight: '62%',
    flex: 1,
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

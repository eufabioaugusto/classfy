import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  Keyboard,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import {
  ArrowLeft,
  MoreVertical,
  Play,
  Lock,
  Send,
  Trash2,
  Archive,
  Ban,
  ExternalLink,
  Plus,
} from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface Message {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  is_request: boolean;
  request_status: string | null;
}

interface ContentShareData {
  type: 'content_share';
  contentId: string;
  contentTitle: string;
  contentThumbnail?: string;
  creatorName?: string;
}

const isContentShare = (content: string): ContentShareData | null => {
  try {
    const parsed = JSON.parse(content);
    if (parsed.type === 'content_share' && parsed.contentId) {
      return parsed as ContentShareData;
    }
    return null;
  } catch {
    return null;
  }
};

export default function ChatThreadScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<any>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardVisible(true)
    );
    const hideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false)
    );

    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  useEffect(() => {
    if (conversationId && user) {
      loadMessages();
      loadThreadRecipient();
      markMessagesAsRead();

      const threadChannel = supabase
        .channel(`thread-${conversationId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            setMessages((prev) => [...prev, payload.new as Message]);
            markMessagesAsRead();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(threadChannel);
      };
    }
  }, [conversationId, user]);

  const loadMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (e) {
      console.error('Error loading messages thread:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadThreadRecipient = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('conversation_participants')
        .select('profiles!inner (id, display_name, avatar_url)')
        .eq('conversation_id', conversationId)
        .neq('user_id', user.id)
        .single();

      if (error) throw error;
      setOtherUser(data?.profiles);
      checkMessagePrivacy(data?.profiles?.id);
    } catch (e) {
      console.error('Error loading recipient info:', e);
    }
  };

  const markMessagesAsRead = async () => {
    if (!user) return;
    try {
      await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);
    } catch (e) {
      console.log('Error marking conversation read:', e);
    }
  };

  const checkMessagePrivacy = async (recipientId: string) => {
    if (!user || !recipientId) return;
    try {
      const { data: blocked } = await supabase
        .from('blocked_users')
        .select('id')
        .eq('blocked_id', user.id)
        .eq('blocker_id', recipientId)
        .maybeSingle();

      if (blocked) {
        setIsBlocked(true);
        return;
      }

      const { data: settings } = await supabase
        .from('message_settings')
        .select('privacy_mode')
        .eq('user_id', recipientId)
        .maybeSingle();

      const privacy = settings?.privacy_mode || 'open';
      if (privacy === 'closed') {
        setIsBlocked(true);
        return;
      }

      if (privacy === 'followers') {
        const { data: follow } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', user.id)
          .eq('following_id', recipientId)
          .maybeSingle();

        if (!follow) {
          setIsBlocked(true);
          return;
        }
      }

      setIsBlocked(false);
    } catch (e) {
      console.error('Error checking privacy block rules:', e);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !user || !otherUser || sending) return;
    try {
      setSending(true);
      const { error } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: inputText.trim(),
      });

      if (error) throw error;
      setInputText('');
    } catch (e) {
      console.error('Error sending message:', e);
      Alert.alert('Erro', 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  };

  const handleArchiveConversation = async () => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('conversation_participants')
        .update({ is_archived: true })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);

      if (error) throw error;
      Alert.alert('Sucesso', 'Conversa arquivada!');
      router.back();
    } catch (e) {
      console.error('Error archiving conversation:', e);
    }
  };

  const handleDeleteConversation = async () => {
    if (!user) return;
    Alert.alert('Excluir Conversa', 'Esta ação apagará todo o histórico para você. Continuar?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.rpc('delete_conversation_for_user', {
              p_conversation_id: conversationId,
              p_user_id: user.id,
            });

            if (error) throw error;
            router.back();
          } catch (e) {
            console.error('Error deleting conversation:', e);
            Alert.alert('Erro', 'Não foi possível excluir a conversa.');
          }
        },
      },
    ]);
  };

  const handleBlockUser = async () => {
    if (!otherUser || !user) return;
    Alert.alert('Bloquear Usuário', `Deseja bloquear ${otherUser.display_name}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Bloquear',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('blocked_users').insert({
              blocker_id: user.id,
              blocked_id: otherUser.id,
            });

            if (error) throw error;
            Alert.alert('Bloqueado', `${otherUser.display_name} foi bloqueado.`);
            router.back();
          } catch (e) {
            console.error('Error blocking user:', e);
          }
        },
      },
    ]);
  };

  const renderMessageBubble = ({ item }: { item: Message }) => {
    const isOwn = item.sender_id === user?.id;
    const contentShareData = isContentShare(item.content);

    return (
      <View style={[styles.messageBubbleRow, isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
        {contentShareData ? (
          <Pressable
            style={[styles.shareCard, isOwn ? styles.shareCardOwn : styles.shareCardOther]}
            onPress={() => router.push(`/watch/${contentShareData.contentId}` as any)}
          >
            {contentShareData.contentThumbnail ? (
              <Image source={{ uri: contentShareData.contentThumbnail }} style={styles.shareThumb} />
            ) : (
              <View style={styles.shareThumbPlaceholder}>
                <Play size={20} color="#666" />
              </View>
            )}
            <View style={styles.shareInfo}>
              <Text style={styles.shareTitle} numberOfLines={1}>
                {contentShareData.contentTitle}
              </Text>
              <Text style={styles.shareCreator} numberOfLines={1}>
                {contentShareData.creatorName ? `@${contentShareData.creatorName}` : 'Creator Classfy'}
              </Text>
              <View style={styles.shareCtaRow}>
                <ExternalLink size={10} color={colors.accent} />
                <Text style={styles.shareCtaText}>Toque para assistir</Text>
              </View>
            </View>
          </Pressable>
        ) : (
          <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
            <Text style={[styles.messageText, isOwn ? styles.messageTextOwn : styles.messageTextOther]}>
              {item.content}
            </Text>
          </View>
        )}
        <Text style={styles.bubbleTime}>
          {new Date(item.created_at).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    );
  };

  const bottomPadding = isKeyboardVisible ? 6 : Math.max(12, insets.bottom);

  return (
    <AppScreen edgeToEdge={true} scroll={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 62 : 0} // Standard offset to sit beautifully above the keyboard
      >
        {/* Thread Header */}
        <View style={[styles.threadHeader, { paddingTop: insets.top + spacing.xs }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={20} color={colors.text} />
          </Pressable>

          {otherUser && (
            <View style={styles.threadRecipientInfo}>
              <View style={styles.recipientAvatarWrap}>
                {otherUser.avatar_url ? (
                  <Image source={{ uri: otherUser.avatar_url }} style={styles.recipientAvatar} />
                ) : (
                  <View style={styles.fallbackAvatarMini}>
                    <Text style={styles.fallbackAvatarMiniText}>{otherUser.display_name[0]?.toUpperCase()}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.recipientName}>{otherUser.display_name}</Text>
            </View>
          )}

          <View style={{ position: 'relative' }}>
            <Pressable onPress={() => setIsMenuOpen(!isMenuOpen)} style={styles.moreBtn}>
              <MoreVertical size={20} color={colors.text} />
            </Pressable>

            {isMenuOpen && (
              <View style={styles.floatingMenu}>
                <Pressable style={styles.menuOption} onPress={handleArchiveConversation}>
                  <Archive size={14} color={colors.text} style={{ marginRight: 8 }} />
                  <Text style={styles.menuOptionText}>Arquivar Chat</Text>
                </Pressable>
                <Pressable style={styles.menuOption} onPress={handleBlockUser}>
                  <Ban size={14} color="#ef4444" style={{ marginRight: 8 }} />
                  <Text style={[styles.menuOptionText, { color: '#ef4444' }]}>Bloquear</Text>
                </Pressable>
                <Pressable style={[styles.menuOption, { borderBottomWidth: 0 }]} onPress={handleDeleteConversation}>
                  <Trash2 size={14} color="#ef4444" style={{ marginRight: 8 }} />
                  <Text style={[styles.menuOptionText, { color: '#ef4444' }]}>Excluir Chat</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>

        {/* Absolute flow wrapper container */}
        <View style={{ flex: 1, position: 'relative' }}>
          <FlatList
            inverted
            data={[...messages].reverse()}
            keyExtractor={(item) => item.id}
            renderItem={renderMessageBubble}
            contentContainerStyle={[
              styles.threadMessagesList,
              { paddingBottom: isKeyboardVisible ? 64 : insets.bottom + 64 } // Allocate empty space for the floating absolute capsule
            ]}
            style={StyleSheet.absoluteFill}
          />

          {/* Absolute floating input container - No outer wrappers, zero background */}
          {isBlocked ? (
            <View style={[styles.blockedBanner, styles.absoluteInputContainer, { paddingBottom: bottomPadding }]}>
              <Lock size={14} color={colors.muted} style={{ marginRight: 6 }} />
              <Text style={styles.blockedBannerText}>Você não pode enviar mensagens para este usuário.</Text>
            </View>
          ) : (
            <View style={[styles.chatInputContainer, styles.absoluteInputContainer, { paddingBottom: bottomPadding }]}>
              <View style={styles.capsuleContainer}>
                <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} />

                <Pressable style={styles.attachBtn}>
                  <Plus size={18} color="#FFF" />
                </Pressable>
                
                <TextInput
                  style={styles.chatInput}
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder="Mensagem..."
                  placeholderTextColor="rgba(255, 255, 255, 0.45)"
                  multiline
                />

                <Pressable
                  style={({ pressed }) => [
                    styles.chatSendBtn,
                    (!inputText.trim() || sending) && styles.btnDisabled,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={handleSendMessage}
                  disabled={!inputText.trim() || sending}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Send size={13} color="#000" />
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    backgroundColor: '#000',
    zIndex: 10,
  },
  backBtn: {
    padding: 4,
    marginLeft: -4,
  },
  threadRecipientInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  recipientAvatarWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  recipientAvatar: {
    width: '100%',
    height: '100%',
  },
  recipientName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  moreBtn: {
    padding: 4,
    marginRight: -4,
  },
  floatingMenu: {
    position: 'absolute',
    right: 0,
    top: 28,
    width: 140,
    backgroundColor: '#161616',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 2,
    zIndex: 99,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  menuOptionText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: 'bold',
  },
  threadMessagesList: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  messageBubbleRow: {
    alignItems: 'flex-start',
    width: '100%',
    marginVertical: 2,
  },
  bubbleRowOwn: {
    alignItems: 'flex-end',
  },
  bubbleRowOther: {
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    maxWidth: '75%',
  },
  bubbleOwn: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: 3,
  },
  bubbleOther: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderBottomLeftRadius: 3,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 19,
  },
  messageTextOwn: {
    color: '#000',
    fontWeight: '500',
  },
  messageTextOther: {
    color: colors.text,
  },
  bubbleTime: {
    color: colors.mutedDim,
    fontSize: 8,
    marginTop: 4,
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  absoluteInputContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    zIndex: 10,
  },
  capsuleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 44,
    overflow: 'hidden',
    position: 'relative',
  },
  attachBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    zIndex: 2,
  },
  chatInput: {
    flex: 1,
    color: '#FFF',
    fontSize: 14,
    paddingHorizontal: 6,
    paddingVertical: 8,
    maxHeight: 120,
    zIndex: 2,
  },
  chatSendBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
    zIndex: 2,
  },
  blockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.01)',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  blockedBannerText: {
    color: colors.muted,
    fontSize: 11,
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnPressed: {
    opacity: 0.8,
  },
  shareCard: {
    width: 240,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
  },
  shareCardOwn: {
    backgroundColor: 'rgba(226, 29, 72, 0.9)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  shareCardOther: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  shareThumb: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  shareThumbPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareInfo: {
    padding: spacing.md,
  },
  shareTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  shareCreator: {
    color: colors.muted,
    fontSize: 10,
    marginBottom: spacing.xs,
  },
  shareCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  shareCtaText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: 'bold',
  },
  fallbackAvatarMini: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackAvatarMiniText: {
    color: '#000',
    fontSize: 14,
    fontWeight: 'bold',
  },
});

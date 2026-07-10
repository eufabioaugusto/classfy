import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Search,
  MessageSquare,
  Plus,
  Trash2,
  Archive,
} from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Conversation {
  id: string;
  last_message_at: string;
  is_archived: boolean;
  other_user: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
  last_message?: {
    content: string;
    sender_id: string;
    created_at: string;
  };
  unread_count: number;
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

// Swipable Row Wrapper component
function SwipeableConversationRow({
  item,
  onPress,
  onArchive,
  onDelete,
  activeTab,
  currentUserId,
}: {
  item: Conversation;
  onPress: () => void;
  onArchive: () => void;
  onDelete: () => void;
  activeTab: string;
  currentUserId?: string;
}) {
  const rowRef = useRef<ScrollView | null>(null);
  const isUnread = item.unread_count > 0;
  const shareMessage = item.last_message ? isContentShare(item.last_message.content) : null;
  const prefix = item.last_message?.sender_id === currentUserId ? 'Você: ' : '';
  
  let lastMsgPreview = 'Sem mensagens';
  if (shareMessage) {
    lastMsgPreview = `🎥 ${shareMessage.contentTitle}`;
  } else if (item.last_message?.content) {
    lastMsgPreview = item.last_message.content;
  }

  const handleAction = (actionFn: () => void) => {
    actionFn();
    rowRef.current?.scrollTo({ x: 0, animated: true });
  };

  const cardWidth = SCREEN_WIDTH - 32;

  return (
    <ScrollView
      ref={rowRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={120}
      decelerationRate="fast"
      contentContainerStyle={{ width: cardWidth + 120 }}
      style={styles.swipeRow}
    >
      {/* Main Conversation Card */}
      <Pressable style={[styles.convCardMain, { width: cardWidth }]} onPress={onPress}>
        <View style={styles.avatarWrap}>
          {item.other_user.avatar_url ? (
            <Image source={{ uri: item.other_user.avatar_url }} style={styles.convAvatar} />
          ) : (
            <View style={styles.fallbackAvatar}>
              <Text style={styles.fallbackAvatarText}>{item.other_user.display_name[0]?.toUpperCase()}</Text>
            </View>
          )}
        </View>
        <View style={styles.convInfo}>
          <View style={styles.convHeader}>
            <Text style={[styles.convName, isUnread && styles.unreadText]}>
              {item.other_user.display_name}
            </Text>
            {item.last_message && (
              <Text style={styles.convTime}>
                {new Date(item.last_message.created_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                })}
              </Text>
            )}
          </View>
          <View style={styles.convMessageRow}>
            <Text style={[styles.convPreview, isUnread && styles.unreadText]} numberOfLines={1}>
              {prefix}{lastMsgPreview}
            </Text>
            {isUnread && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{item.unread_count}</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>

      {/* Swipe Actions on Right Side */}
      <View style={styles.swipeActions}>
        <Pressable
          style={[styles.swipeActionBtn, styles.archiveAction]}
          onPress={() => handleAction(onArchive)}
        >
          <Archive size={16} color="#FFF" />
          <Text style={styles.swipeActionText}>{activeTab === 'inbox' ? 'Arquivar' : 'Mostrar'}</Text>
        </Pressable>
        <Pressable
          style={[styles.swipeActionBtn, styles.deleteAction]}
          onPress={() => handleAction(onDelete)}
        >
          <Trash2 size={16} color="#FFF" />
          <Text style={styles.swipeActionText}>Excluir</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

export default function MessagesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'inbox' | 'archived'>('inbox');

  // Search/New Conversation state
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [creatorsList, setCreatorsList] = useState<any[]>([]);
  const [searchingCreators, setSearchingCreators] = useState(false);

  // Reload conversations whenever this inbox view receives screen focus (e.g. returning from thread)
  useFocusEffect(
    useCallback(() => {
      if (user) {
        loadConversations();
      }
    }, [user, activeTab])
  );

  useEffect(() => {
    if (user) {
      loadConversations();
      
      const channel = supabase
        .channel(`inbox-global-channel-${user.id}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
          loadConversations();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const loadConversations = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const { data: participants, error: pError } = await supabase
        .from('conversation_participants')
        .select(`
          conversation_id,
          last_read_at,
          is_archived,
          is_muted,
          conversations:conversation_id (
            id,
            last_message_at,
            updated_at,
            conversation_participants (
              user_id,
              profiles:user_id (
                id,
                display_name,
                avatar_url
              )
            ),
            messages (
              content,
              sender_id,
              created_at
            )
          )
        `)
        .eq('user_id', user.id);

      if (pError) throw pError;
      if (!participants || participants.length === 0) {
        setConversations([]);
        return;
      }

      const conversationsData: Conversation[] = participants
        .filter((p) => !p.is_muted && p.conversations)
        .map((p: any) => {
          const conv = p.conversations;
          const otherPart = (conv.conversation_participants || []).find(
            (op: any) => op.user_id !== user.id
          );
          
          const sortedMsgs = [...(conv.messages || [])].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          const lastMsg = sortedMsgs[0];

          const unreadMsgs = sortedMsgs.filter(
            (m) =>
              m.sender_id !== user.id &&
              new Date(m.created_at) > new Date(p.last_read_at || 0)
          );

          return {
            id: p.conversation_id,
            last_message_at: conv.last_message_at || conv.updated_at,
            is_archived: p.is_archived,
            other_user: {
              id: otherPart?.profiles?.id || '',
              display_name: otherPart?.profiles?.display_name || 'Usuário Classfy',
              avatar_url: otherPart?.profiles?.avatar_url || null,
            },
            last_message: lastMsg
              ? {
                  content: lastMsg.content,
                  sender_id: lastMsg.sender_id,
                  created_at: lastMsg.created_at,
                }
              : undefined,
            unread_count: unreadMsgs.length,
          };
        });

      conversationsData.sort(
        (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      );
      setConversations(conversationsData);
    } catch (e) {
      console.error('Error loading conversations:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadCreatorsList = async () => {
    try {
      setSearchingCreators(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, creator_channel_name')
        .eq('creator_status', 'approved')
        .limit(20);

      if (error) throw error;
      setCreatorsList(data || []);
    } catch (e) {
      console.error('Error loading creator profiles list:', e);
    } finally {
      setSearchingCreators(false);
    }
  };

  const handleStartNewConversation = async (recipientId: string) => {
    if (!user) return;
    try {
      const { data: userConvs } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id);

      const { data: otherConvs } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', recipientId);

      const sharedConv = userConvs?.find((uc) =>
        otherConvs?.some((oc) => oc.conversation_id === uc.conversation_id)
      );

      if (sharedConv) {
        setShowNewConversation(false);
        router.push(`/chat/${sharedConv.conversation_id}`);
        return;
      }

      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({ last_message_at: new Date().toISOString() })
        .select('id')
        .single();

      if (convError) throw convError;

      await supabase.from('conversation_participants').insert([
        { conversation_id: newConv.id, user_id: user.id },
        { conversation_id: newConv.id, user_id: recipientId },
      ]);

      setShowNewConversation(false);
      router.push(`/chat/${newConv.id}`);
    } catch (e) {
      console.error('Error starting conversation:', e);
      Alert.alert('Erro', 'Não foi possível iniciar uma conversa.');
    }
  };

  const handleArchiveConversationItem = async (conversationId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('conversation_participants')
        .update({ is_archived: activeTab === 'inbox' })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);

      if (error) throw error;
      loadConversations();
    } catch (e) {
      console.error('Error archiving conversation:', e);
    }
  };

  const handleDeleteConversationItem = async (conversationId: string) => {
    if (!user) return;
    Alert.alert('Excluir Conversa', 'Deseja excluir permanentemente o histórico desta conversa?', [
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
            loadConversations();
          } catch (e) {
            console.error('Error deleting conversation:', e);
            Alert.alert('Erro', 'Não foi possível excluir.');
          }
        },
      },
    ]);
  };

  const filteredConversations = conversations
    .filter((c) => (activeTab === 'inbox' ? !c.is_archived : c.is_archived))
    .filter((c) => c.other_user.display_name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <AppScreen edgeToEdge={true} scroll={false}>
      <View style={{ flex: 1 }}>
        <View style={[styles.pageHeader, { paddingTop: insets.top + spacing.xs }]}>
          <Text style={styles.pageTitle}>Mensagens</Text>
          {user && (
            <Pressable
              style={styles.newConvBtn}
              onPress={() => {
                loadCreatorsList();
                setShowNewConversation(true);
              }}
            >
              <Plus size={20} color={colors.text} />
            </Pressable>
          )}
        </View>

        {!user ? (
          <View style={styles.authNotice}>
            <MessageSquare size={32} color={colors.accent} style={{ marginBottom: spacing.sm }} />
            <Text style={styles.authNoticeTitle}>Acesso Restrito</Text>
            <Text style={styles.authNoticeBody}>
              Faça login para poder enviar mensagens diretas (DMs) para creators e interagir com membros.
            </Text>
            <Pressable style={styles.authBtn} onPress={() => router.push('/auth/sign-in')}>
              <Text style={styles.authBtnText}>Entrar na Conta</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={styles.tabsContainer}>
              <Pressable
                style={[styles.tabBtn, activeTab === 'inbox' && styles.tabBtnActive]}
                onPress={() => setActiveTab('inbox')}
              >
                <Text style={[styles.tabBtnText, activeTab === 'inbox' && styles.tabBtnTextActive]}>
                  Principal
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tabBtn, activeTab === 'archived' && styles.tabBtnActive]}
                onPress={() => setActiveTab('archived')}
              >
                <Text style={[styles.tabBtnText, activeTab === 'archived' && styles.tabBtnTextActive]}>
                  Arquivados
                </Text>
              </Pressable>
            </View>

            <View style={styles.searchBarContainer}>
              <Search size={16} color={colors.muted} style={{ marginRight: spacing.xs }} />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Pesquisar conversas..."
                placeholderTextColor="rgba(255, 255, 255, 0.4)"
                autoCapitalize="none"
              />
            </View>

            {loading ? (
              <View style={styles.centerLoading}>
                <ActivityIndicator color={colors.accent} size="large" />
              </View>
            ) : filteredConversations.length === 0 ? (
              <View style={styles.emptyInbox}>
                <MessageSquare size={36} color={colors.muted} style={{ opacity: 0.5, marginBottom: spacing.md }} />
                <Text style={styles.emptyText}>Nenhuma conversa encontrada</Text>
                <Text style={styles.emptySubtitle}>Inicie um chat clicando no botão "+" acima</Text>
              </View>
            ) : (
              <FlatList
                data={filteredConversations}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <SwipeableConversationRow
                    item={item}
                    currentUserId={user.id}
                    activeTab={activeTab}
                    onPress={() => {
                      router.push(`/chat/${item.id}`);
                    }}
                    onArchive={() => handleArchiveConversationItem(item.id)}
                    onDelete={() => handleDeleteConversationItem(item.id)}
                  />
                )}
                contentContainerStyle={styles.listContainer}
              />
            )}
          </View>
        )}

        {/* New Conversation Selector Modal */}
        {showNewConversation && (
          <View style={[StyleSheet.absoluteFillObject, styles.modalOverlay]}>
            <View style={[styles.modalContent, { marginTop: insets.top + spacing.xl }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Nova Mensagem</Text>
                <Pressable onPress={() => setShowNewConversation(false)} style={styles.modalCloseBtn}>
                  <Text style={{ color: colors.muted, fontWeight: 'bold' }}>Fechar</Text>
                </Pressable>
              </View>

              {searchingCreators ? (
                <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
              ) : (
                <FlatList
                  data={creatorsList}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <Pressable
                      style={styles.creatorRow}
                      onPress={() => handleStartNewConversation(item.id)}
                    >
                      <View style={styles.creatorAvatarWrap}>
                        {item.avatar_url ? (
                          <Image source={{ uri: item.avatar_url }} style={styles.creatorAvatar} />
                        ) : (
                          <View style={styles.fallbackAvatarMini}>
                            <Text style={styles.fallbackAvatarMiniText}>{item.display_name[0]?.toUpperCase()}</Text>
                          </View>
                        )}
                      </View>
                      <View>
                        <Text style={styles.creatorName}>{item.display_name}</Text>
                        <Text style={styles.creatorRole}>Creator</Text>
                      </View>
                    </Pressable>
                  )}
                  contentContainerStyle={{ paddingHorizontal: spacing.lg }}
                />
              )}
            </View>
          </View>
        )}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
  },
  pageTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: typography.weightBold,
  },
  newConvBtn: {
    padding: 6,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: radius.md,
    padding: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  tabBtnActive: {
    backgroundColor: colors.surface,
  },
  tabBtnText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: 'bold',
  },
  tabBtnTextActive: {
    color: colors.text,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 38,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
  },
  listContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.section * 2,
    gap: spacing.sm,
  },
  swipeRow: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  convCardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.01)',
    borderColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderRadius: radius.lg,
    gap: spacing.md,
  },
  swipeActions: {
    width: 120,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  swipeActionBtn: {
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  archiveAction: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  deleteAction: {
    backgroundColor: '#ef4444',
  },
  swipeActionText: {
    color: '#FFF',
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  convAvatar: {
    width: '100%',
    height: '100%',
  },
  fallbackAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackAvatarText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
  },
  convInfo: {
    flex: 1,
  },
  convHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  convName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  convTime: {
    color: colors.mutedDim,
    fontSize: 10,
  },
  convMessageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  convPreview: {
    color: colors.muted,
    fontSize: 12,
    flex: 1,
  },
  unreadText: {
    color: colors.text,
    fontWeight: 'bold',
  },
  unreadBadge: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    marginLeft: spacing.xs,
  },
  unreadBadgeText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '900',
  },
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyInbox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl * 2,
    marginTop: -40,
  },
  emptyText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weightBold,
    marginBottom: 4,
  },
  emptySubtitle: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  authNotice: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  authNoticeTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weightBold,
    marginBottom: spacing.xs,
  },
  authNoticeBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  authBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  authBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  modalOverlay: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    zIndex: 999,
  },
  modalContent: {
    flex: 1,
    backgroundColor: '#050505',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
  },
  modalCloseBtn: {
    padding: 6,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    gap: spacing.md,
  },
  creatorAvatarWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  creatorAvatar: {
    width: '100%',
    height: '100%',
  },
  fallbackAvatarMini: {
    width: 38,
    height: 38,
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
  creatorName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  creatorRole: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 1,
  },
});

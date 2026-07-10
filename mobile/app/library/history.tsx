import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface HistoryItem {
  content_id: string;
  progress_percent: number;
  updated_at: string;
  contents: {
    id: string;
    title: string;
    thumbnail_url: string | null;
    content_type: string;
    profiles: {
      display_name: string | null;
      creator_channel_name: string | null;
    } | null;
  } | null;
}

export default function HistoryScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredItems, setFilteredItems] = useState<HistoryItem[]>([]);

  // Configure navigation options imperatively
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  useEffect(() => {
    if (user) {
      loadHistory();
    }
  }, [user]);

  useEffect(() => {
    filterItems();
  }, [searchQuery, items]);

  const loadHistory = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('user_progress')
        .select(`
          content_id,
          progress_percent,
          updated_at,
          contents:content_id (
            id,
            title,
            thumbnail_url,
            content_type,
            profiles:creator_id (
              display_name,
              creator_channel_name
            )
          )
        `)
        .eq('user_id', user.id)
        .gt('progress_percent', 0)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setItems((data || []).filter((item: any) => item.contents !== null) as any);
    } catch (e) {
      console.error('Error loading watch history:', e);
      Alert.alert('Erro', 'Não foi possível carregar seu histórico.');
    } finally {
      setLoading(false);
    }
  };

  const filterItems = () => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      setFilteredItems(items);
      return;
    }

    const filtered = items.filter((item) => {
      const title = item.contents?.title?.toLowerCase() || '';
      const creatorName = item.contents?.profiles?.display_name?.toLowerCase() || '';
      const channelName = item.contents?.profiles?.creator_channel_name?.toLowerCase() || '';
      return title.includes(query) || creatorName.includes(query) || channelName.includes(query);
    });
    setFilteredItems(filtered);
  };

  const removeFromHistory = async (contentId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('user_progress')
        .delete()
        .eq('user_id', user.id)
        .eq('content_id', contentId);

      if (error) throw error;
      setItems((prev) => prev.filter((item) => item.content_id !== contentId));
    } catch (e) {
      console.error('Error removing history item:', e);
      Alert.alert('Erro', 'Não foi possível remover este item.');
    }
  };

  const confirmRemoveItem = (contentId: string) => {
    Alert.alert(
      'Remover do Histórico',
      'Tem certeza de que deseja remover este item do seu histórico de exibição?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: () => removeFromHistory(contentId) },
      ]
    );
  };

  const clearAllHistory = async () => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('user_progress')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;
      setItems([]);
      Alert.alert('Sucesso', 'Histórico limpo com sucesso.');
    } catch (e) {
      console.error('Error clearing history:', e);
      Alert.alert('Erro', 'Não foi possível limpar seu histórico.');
    }
  };

  const confirmClearAll = () => {
    if (items.length === 0) return;
    Alert.alert(
      'Limpar Histórico',
      'Isso removerá todo o seu histórico de exibição permanentemente. Deseja continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Limpar tudo', style: 'destructive', onPress: clearAllHistory },
      ]
    );
  };

  const getContentTypeLabel = (type: string) => {
    switch (type) {
      case 'podcast': return 'PODCAST';
      case 'short': return 'SHORT';
      case 'curso': return 'CURSO';
      default: return 'AULA';
    }
  };

  const getContentTypeColor = (type: string) => {
    switch (type) {
      case 'podcast': return colors.accent; // Rose/Red
      case 'short': return colors.accent; // Rose/Red
      case 'curso': return colors.amber || '#f59e0b';
      default: return colors.accent; // Rose/Red
    }
  };

  return (
    <AppScreen scroll={false}>
      {/* Custom Navigation Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Histórico de Exibição</Text>
          <Pressable 
            onPress={confirmClearAll} 
            style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}
            disabled={items.length === 0}
          >
            <Ionicons 
              name="trash-outline" 
              size={20} 
              color={items.length > 0 ? '#ef4444' : colors.mutedDim} 
            />
          </Pressable>
        </View>

        {/* Search Bar within Header */}
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={colors.muted} style={{ marginRight: spacing.xs }} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Pesquisar no histórico..."
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Main Content Area */}
      <View style={styles.container}>
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : filteredItems.length > 0 ? (
          <FlatList
            data={filteredItems}
            keyExtractor={(item) => item.content_id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              if (!item.contents) return null;
              const badgeLabel = getContentTypeLabel(item.contents.content_type);
              const badgeColor = getContentTypeColor(item.contents.content_type);
              const creatorName = item.contents.profiles?.display_name || 'Classfy Creator';

              return (
                <View style={styles.card}>
                  <Pressable 
                    style={styles.cardMain} 
                    onPress={() => router.push(`/watch/${item.content_id}`)}
                  >
                    {item.contents.thumbnail_url ? (
                      <Image source={{ uri: item.contents.thumbnail_url }} style={styles.thumbnail} />
                    ) : (
                      <View style={styles.thumbnailPlaceholder}>
                        <Ionicons name="videocam-outline" size={24} color={colors.mutedDim} />
                      </View>
                    )}
                    <View style={styles.meta}>
                      <Text style={styles.title} numberOfLines={2}>{item.contents.title}</Text>
                      <Text style={styles.creator} numberOfLines={1}>@{creatorName}</Text>
                      
                      {/* Type Badge & Percentage */}
                      <View style={styles.row}>
                        <View style={[styles.typeBadge, { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: badgeColor, borderWidth: 1 }]}>
                          <Text style={[styles.typeBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
                        </View>
                        <Text style={styles.percentText}>{item.progress_percent}% assistido</Text>
                      </View>
                      
                      {/* Progress Bar Fill */}
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${item.progress_percent}%`, backgroundColor: badgeColor }]} />
                      </View>
                    </View>
                  </Pressable>

                  {/* Remove specific item button */}
                  <Pressable 
                    onPress={() => confirmRemoveItem(item.content_id)} 
                    style={styles.optionsBtn}
                  >
                    <Ionicons name="close-outline" size={20} color={colors.muted} />
                  </Pressable>
                </View>
              );
            }}
          />
        ) : (
          <View style={styles.centerContainer}>
            <Ionicons name="time-outline" size={48} color={colors.mutedDim} style={{ marginBottom: spacing.md }} />
            <Text style={styles.emptyTitle}>
              {searchQuery ? 'Nenhum resultado encontrado' : 'Histórico Vazio'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery 
                ? 'Tente buscar por termos diferentes ou confira a ortografia.' 
                : 'As aulas e conteúdos que você assistir aparecerão listados aqui.'}
            </Text>
          </View>
        )}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    gap: spacing.md,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    padding: 4,
    marginLeft: -4,
  },
  clearBtn: {
    padding: 6,
    marginRight: -6,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: typography.weightBold,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: 38,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    height: '100%',
  },
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weightBold,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: 40,
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#111',
    borderColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.sm,
    alignItems: 'center',
  },
  cardMain: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  thumbnail: {
    width: 100,
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  thumbnailPlaceholder: {
    width: 100,
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  meta: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
  },
  title: {
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  creator: {
    color: colors.muted,
    fontSize: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  typeBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.xs,
  },
  typeBadgeText: {
    fontSize: 8,
    fontWeight: '800',
  },
  percentText: {
    color: colors.muted,
    fontSize: 10,
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.full,
    overflow: 'hidden',
    marginTop: 4,
    width: '100%',
  },
  progressFill: {
    height: '100%',
  },
  optionsBtn: {
    padding: 8,
    alignSelf: 'flex-start',
    marginRight: -4,
    marginTop: -4,
  },
});

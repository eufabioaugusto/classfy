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

interface FavoriteItem {
  content_id: string;
  created_at: string;
  contents: {
    id: string;
    title: string;
    description: string | null;
    thumbnail_url: string | null;
    content_type: string;
    profiles: {
      display_name: string | null;
      creator_channel_name: string | null;
    } | null;
  } | null;
}

export default function FavoritesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredItems, setFilteredItems] = useState<FavoriteItem[]>([]);

  // Configure navigation options imperatively
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  useEffect(() => {
    if (user) {
      loadFavorites();
    }
  }, [user]);

  useEffect(() => {
    filterItems();
  }, [searchQuery, items]);

  const loadFavorites = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('favorites')
        .select(`
          content_id,
          created_at,
          contents:content_id (
            id,
            title,
            description,
            thumbnail_url,
            content_type,
            profiles:creator_id (
              display_name,
              creator_channel_name
            )
          )
        `)
        .eq('user_id', user.id)
        .eq('contents.status', 'approved')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setItems((data || []).filter((item: any) => item.contents !== null) as any);
    } catch (e) {
      console.error('Error loading favorites:', e);
      Alert.alert('Erro', 'Não foi possível carregar seus favoritos.');
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

  const removeFavorite = async (contentId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('content_id', contentId);

      if (error) throw error;
      setItems((prev) => prev.filter((item) => item.content_id !== contentId));
    } catch (e) {
      console.error('Error removing favorite:', e);
      Alert.alert('Erro', 'Não foi possível desfavoritar.');
    }
  };

  const confirmRemoveFavorite = (contentId: string) => {
    Alert.alert(
      'Remover dos Favoritos',
      'Deseja remover esta aula dos seus favoritos?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: () => removeFavorite(contentId) },
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
          <Text style={styles.headerTitle}>Favoritos</Text>
          {/* Spacer */}
          <View style={{ width: 24 }} />
        </View>

        {/* Search Bar within Header */}
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={colors.muted} style={{ marginRight: spacing.xs }} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Pesquisar nos favoritos..."
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
                      <Text style={styles.description} numberOfLines={1}>
                        {item.contents.description || 'Sem descrição.'}
                      </Text>
                      
                      {/* Type Badge */}
                      <View style={styles.row}>
                        <View style={[styles.typeBadge, { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: badgeColor, borderWidth: 1 }]}>
                          <Text style={[styles.typeBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>

                  {/* Heart / Unfavorite button */}
                  <Pressable 
                    onPress={() => confirmRemoveFavorite(item.content_id)} 
                    style={styles.optionsBtn}
                  >
                    <Ionicons name="heart" size={22} color="#ec4899" />
                  </Pressable>
                </View>
              );
            }}
          />
        ) : (
          <View style={styles.centerContainer}>
            <Ionicons name="heart-outline" size={48} color={colors.mutedDim} style={{ marginBottom: spacing.md }} />
            <Text style={styles.emptyTitle}>
              {searchQuery ? 'Nenhum resultado encontrado' : 'Nenhum Favorito'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery 
                ? 'Tente buscar por termos diferentes ou confira a ortografia.' 
                : 'Aulas e conteúdos favoritados por você aparecerão listados aqui.'}
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
  description: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 1,
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
  optionsBtn: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

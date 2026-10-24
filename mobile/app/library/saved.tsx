import { LoadingPlaceholder } from '@/components/LoadingPlaceholder';
import { NavigationHeader } from '@/components/NavigationHeader';
import React, { useEffect, useState } from 'react';
import {
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
import { Bookmark, Search, Video, X } from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { DataCard } from '@/components/data/DataUI';
import { dataTheme as t } from '@/theme/data';
import { spacing } from '@/theme/spacing';

interface SavedItem {
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

export default function SavedScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredItems, setFilteredItems] = useState<SavedItem[]>([]);

  // Configure navigation options imperatively
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  useEffect(() => {
    if (user) {
      loadSaved();
    }
  }, [user]);

  useEffect(() => {
    filterItems();
  }, [searchQuery, items]);

  const loadSaved = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('saved_contents')
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
      console.error('Error loading saved items:', e);
      Alert.alert('Erro', 'Não foi possível carregar seus itens salvos.');
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

  const removeSaved = async (contentId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('saved_contents')
        .delete()
        .eq('user_id', user.id)
        .eq('content_id', contentId);

      if (error) throw error;
      setItems((prev) => prev.filter((item) => item.content_id !== contentId));
    } catch (e) {
      console.error('Error removing saved item:', e);
      Alert.alert('Erro', 'Não foi possível remover da lista.');
    }
  };

  const confirmRemoveSaved = (contentId: string) => {
    Alert.alert(
      'Remover dos Salvos',
      'Deseja remover esta aula dos itens salvos?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: () => removeSaved(contentId) },
      ]
    );
  };

  const getContentTypeLabel = (type: string) => {
    switch (type) {
      case 'podcast': return 'Podcast';
      case 'short': return 'Short';
      case 'curso': return 'Curso';
      default: return 'Aula';
    }
  };


  return (
    <AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="Salvos" back />}>
      {/* Custom Navigation Header */}
      <View style={styles.header}>

        {/* Search Bar within Header */}
        <View style={styles.searchBar}>
          <Search size={18} strokeWidth={t.stroke} color={t.muted} />
          <TextInput
            accessibilityLabel="Buscar na biblioteca"
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Pesquisar nos salvos..."
            placeholderTextColor={t.subtle}
            style={styles.searchInput}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <Pressable accessibilityRole="button" accessibilityLabel="Limpar busca" hitSlop={8} onPress={() => setSearchQuery('')}>
              <X size={18} strokeWidth={t.stroke} color={t.muted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Main Content Area */}
      <View style={styles.container}>
        {loading ? (
          <LoadingPlaceholder variant="library" />
        ) : filteredItems.length > 0 ? (
          <FlatList
            data={filteredItems}
            keyExtractor={(item) => item.content_id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              if (!item.contents) return null;
              const badgeLabel = getContentTypeLabel(item.contents.content_type);
              const creatorName = item.contents.profiles?.display_name || 'Classfy Creator';

              return (
                <DataCard style={styles.card}>
                  <Pressable 
                    style={styles.cardMain} 
                    onPress={() => router.push(`/watch/${item.content_id}`)}
                  >
                    {item.contents.thumbnail_url ? (
                      <Image source={{ uri: item.contents.thumbnail_url }} style={styles.thumbnail} />
                    ) : (
                      <View style={styles.thumbnailPlaceholder}>
                        <Video size={22} strokeWidth={t.stroke} color={t.subtle} />
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
                        <View style={styles.typeBadge}>
                          <Text style={styles.typeBadgeText}>{badgeLabel}</Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>

                  {/* Bookmark / Saved button */}
                  <Pressable 
                    accessibilityRole="button"
                    accessibilityLabel={`Remover ${item.contents.title} dos salvos`}
                    accessibilityState={{ selected: true }}
                    onPress={() => confirmRemoveSaved(item.content_id)} 
                    style={styles.optionsBtn}
                  >
                    <Bookmark size={20} strokeWidth={t.stroke} color={t.ink} fill={t.ink} />
                  </Pressable>
                </DataCard>
              );
            }}
          />
        ) : (
          <View style={styles.centerContainer}>
            <Bookmark size={32} strokeWidth={t.stroke} color={t.subtle} style={{ marginBottom: spacing.md }} />
            <Text style={styles.emptyTitle}>
              {searchQuery ? 'Nenhum resultado encontrado' : 'Nenhum conteúdo salvo'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery 
                ? 'Tente buscar por termos diferentes ou confira a ortografia.' 
                : 'Aulas e conteúdos salvos por você para assistir mais tarde aparecerão listados aqui.'}
            </Text>
          </View>
        )}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg },
  clearBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: t.controlRadius, paddingHorizontal: spacing.md, minHeight: 44 },
  searchInput: { color: t.ink, flex: 1, fontSize: 15, minHeight: 44, paddingVertical: spacing.sm },
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xxl },
  emptyTitle: { color: t.ink, fontSize: 17, fontWeight: '600', marginBottom: spacing.sm, textAlign: 'center' },
  emptySubtitle: { color: t.muted, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.section * 2, gap: spacing.md },
  card: { flexDirection: 'row', padding: spacing.sm, alignItems: 'center', gap: spacing.xs },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 88 },
  thumbnail: { width: 104, aspectRatio: 16 / 9, borderRadius: t.controlRadius, backgroundColor: t.raised },
  thumbnailPlaceholder: { width: 104, aspectRatio: 16 / 9, borderRadius: t.controlRadius, backgroundColor: t.raised, justifyContent: 'center', alignItems: 'center' },
  meta: { flex: 1, minWidth: 0, justifyContent: 'center', gap: spacing.xs },
  title: { color: t.ink, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  creator: { color: t.muted, fontSize: 12, lineHeight: 17 },
  description: { color: t.subtle, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: t.raised },
  typeBadgeText: { color: t.secondary, fontSize: 11, fontWeight: '500', lineHeight: 15 },
  percentText: { color: t.muted, fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'] },
  progressTrack: { height: 3, backgroundColor: t.strong, borderRadius: 2, overflow: 'hidden', marginTop: spacing.xs, width: '100%' },
  progressFill: { height: '100%' },
  optionsBtn: { width: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
});

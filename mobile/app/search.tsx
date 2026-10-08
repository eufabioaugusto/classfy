import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AppScreen } from '@/components/AppScreen';
import { MobileVideoCard } from '@/components/MobileVideoCard';
import { useHomeSections } from '@/features/home/useHomeSections';
import { buildFeed } from '@/features/home/catalog';
import { colors } from '@/theme/colors';
const clean = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();

export default function SearchScreen() {
  return <SearchExperience />;
}

export function SearchExperience({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const { contents, courses, loading, refreshing, error, refresh } =
    useHomeSections();
  const results = useMemo(() => {
    const term = clean(query);
    return term
      ? buildFeed([...contents, ...courses], 'Todos', []).filter((content) =>
          clean(
            `${content.title} ${content.creator} ${content.description || ''}`,
          ).includes(term),
        )
      : [];
  }, [query, contents, courses]);
  return (
    <AppScreen scroll={false} edgeToEdge>
      <View style={styles.header}>
        {!embedded && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            onPress={() => router.back()}
            style={styles.action}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
        )}
        <View style={styles.inputWrap}>
          <TextInput
            autoFocus={!embedded}
            value={query}
            onChangeText={setQuery}
            placeholder="O que você quer aprender?"
            placeholderTextColor={colors.muted}
            style={styles.input}
            returnKeyType="search"
            accessibilityLabel="Buscar conteúdos"
          />
          {query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Limpar busca"
              onPress={() => setQuery('')}
              style={styles.clear}
            >
              <Ionicons name="close-circle" size={19} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <FlatList
        data={results}
        keyExtractor={(item) => `${item.contentType}:${item.id}`}
        renderItem={({ item }) => <MobileVideoCard content={item} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshing={refreshing}
        onRefresh={refresh}
        ListHeaderComponent={
          query && results.length ? (
            <Text style={styles.resultCount}>
              {results.length}{' '}
              {results.length === 1
                ? 'conteúdo encontrado'
                : 'conteúdos encontrados'}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Ionicons
                name="search-outline"
                size={32}
                color={colors.mutedDim}
              />
            )}
            <Text style={styles.emptyTitle}>
              {error
                ? 'A busca não carregou'
                : query
                  ? 'Tente outro tema'
                  : 'Encontre seu próximo aprendizado'}
            </Text>
            <Text style={styles.emptyText}>
              {error ||
                (query
                  ? 'Busque por título, assunto ou creator.'
                  : 'Aulas, cursos, podcasts e shorts, em um só lugar.')}
            </Text>
            {error ? (
              <Pressable
                accessibilityRole="button"
                onPress={refresh}
                style={styles.retry}
              >
                <Text style={{ color: colors.text }}>Tentar novamente</Text>
              </Pressable>
            ) : null}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </AppScreen>
  );
}
const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
    gap: 4,
  },
  action: {
    width: 44,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  clear: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultCount: { margin: 16, color: colors.muted, fontSize: 12 },
  empty: { alignItems: 'center', gap: 14, padding: 32, paddingTop: 48 },
  emptyTitle: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 18,
    textAlign: 'center',
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  retry: { minHeight: 44, justifyContent: 'center' },
});

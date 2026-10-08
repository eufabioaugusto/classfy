import { NavigationHeader } from '@/components/NavigationHeader';
import { Bookmark, Search, X } from 'lucide-react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, FlatList, Keyboard, KeyboardAvoidingView, Platform,
  Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppScreen } from '@/components/AppScreen';
import { MobileVideoCard } from '@/components/MobileVideoCard';
import { PlanCrown } from '@/components/PlanCrown';
import { useAuth } from '@/features/auth/authContext';
import { useHomeSections } from '@/features/home/useHomeSections';
import { buildFeed } from '@/features/home/catalog';
import { rankHomeContents } from '@/features/home/ranking';
import type { HomeContent } from '@/features/home/homeData';
import { colors } from '@/theme/colors';
import { controls } from '@/theme/controls';
const clean = (value: string) => value.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();

export default function SearchScreen() { return <SearchExperience />; }

export function SearchExperience({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const { contents, courses, loading, refreshing, error, refresh } = useHomeSections();
  const catalog = useMemo(() => buildFeed([...contents, ...courses], 'Todos', []), [contents, courses]);
  const discovery = useMemo(() => {
    const interests = Array.isArray(profile?.interests)
      ? profile.interests.filter((i: unknown): i is string => typeof i === 'string') : [];
    // Same interest weights as Home/web. Popularity breaks ties; visitors get discovery by popularity.
    return rankHomeContents([...catalog].sort((a, b) => (b.viewsCount || 0) - (a.viewsCount || 0)), interests);
  }, [catalog, profile?.interests]);
  const term = clean(query);
  const results = useMemo(() => term ? catalog.filter(content => clean(
    `${content.title} ${content.creator} ${content.description || ''} ${Array.isArray(content.tags) ? content.tags.join(' ') : content.tags || ''}`,
  ).includes(term)) : [], [term, catalog]);
  const cancelSearch = useCallback(() => {
    input.current?.blur();
    Keyboard.dismiss();
    setSearching(false);
    setQuery('');
  }, []);
  useFocusEffect(useCallback(() => {
    const back = searching ? BackHandler.addEventListener('hardwareBackPress', () => {
      cancelSearch();
      return true;
    }) : undefined;
    return () => back?.remove();
  }, [searching, cancelSearch]));
  useFocusEffect(useCallback(() => () => {
    input.current?.blur();
    Keyboard.dismiss();
  }, []));
  const openContent = (content: HomeContent) => {
    Keyboard.dismiss();
    router.push(user ? { pathname: '/watch/[id]', params: { id: content.id } }
      : { pathname: '/auth/sign-in', params: { contentId: content.id } });
  };
  const empty = (isSearch: boolean) => <View style={styles.empty}>
    {loading ? <ActivityIndicator color={colors.accent} /> : <Search size={32} strokeWidth={1.65} color={colors.mutedDim} />}
    <Text style={styles.emptyTitle}>{error ? 'Não foi possível carregar' : isSearch ? 'Nenhum conteúdo encontrado' : 'Novos aprendizados em breve'}</Text>
    <Text style={styles.emptyText}>{error || (isSearch ? 'Tente outro título, assunto ou creator.' : 'Volte para descobrir novas aulas, cursos e shorts.')}</Text>
    {error && <Pressable accessibilityRole="button" onPress={refresh} style={styles.action}><Text style={styles.text}>Tentar novamente</Text></Pressable>}
  </View>;
  return <AppScreen scroll={false} edgeToEdge>
    <NavigationHeader back={!embedded || searching} onBack={searching ? cancelSearch : undefined} right={searching
      ? <Pressable accessibilityRole="button" onPress={cancelSearch} style={styles.cancel}><Text style={styles.text}>Cancelar</Text></Pressable>
      : <Pressable accessibilityRole="button" accessibilityLabel="Abrir conteúdos salvos" style={styles.action}
          onPress={() => router.push(user ? '/library/saved' : '/auth/sign-in')}>
          <Bookmark size={24} strokeWidth={1.65} color={colors.text} />
        </Pressable>}>
      <View style={styles.inputWrap}>
        <Search size={18} strokeWidth={1.65} color={colors.muted} />
        <TextInput ref={input} autoFocus={false} value={query} onChangeText={setQuery}
          onFocus={() => setSearching(true)} placeholder="O que você quer aprender?"
          placeholderTextColor={colors.muted} style={styles.input} returnKeyType="search"
          autoCapitalize="none" autoCorrect={false} accessibilityLabel="Buscar conteúdos"
          onSubmitEditing={() => Keyboard.dismiss()} />
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Limpar busca" onPress={() => { setQuery(''); input.current?.focus(); }} style={styles.clear}>
          <X size={18} strokeWidth={1.65} color={colors.muted} />
        </Pressable>}
      </View>
    </NavigationHeader>
    <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + controls.headerHeight}>
      {/* The discovery list stays mounted, so cancelling restores its scroll position. */}
      <View style={styles.body} pointerEvents={searching ? 'none' : 'auto'}
        accessibilityElementsHidden={searching} importantForAccessibility={searching ? 'no-hide-descendants' : 'auto'}>
        <FlatList data={discovery.slice(1)} numColumns={3} keyExtractor={item => `${item.contentType}:${item.id}`}
          renderItem={({ item }) => <View style={styles.tileColumn}><DiscoveryTile content={item} onPress={() => openContent(item)} /></View>}
          columnWrapperStyle={styles.gridRow} refreshing={refreshing} onRefresh={refresh}
          ListHeaderComponent={discovery[0] ? <DiscoveryTile content={discovery[0]} featured onPress={() => openContent(discovery[0])} /> : null}
          ListEmptyComponent={!discovery.length ? empty(false) : null}
          contentContainerStyle={styles.listContent} />
      </View>
      {searching && <View style={styles.resultsOverlay}>
        {term ? <FlatList data={results} keyExtractor={item => `${item.contentType}:${item.id}`}
          renderItem={({ item }) => <MobileVideoCard content={item} />}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          ListHeaderComponent={<Text style={styles.sectionTitle}>{results.length} {results.length === 1 ? 'resultado' : 'resultados'}</Text>}
          ListEmptyComponent={empty(true)} contentContainerStyle={styles.listContent} />
        : <View style={styles.suggestions}>
          <Text style={styles.sectionTitle}>Explore novos aprendizados</Text>
          <Text style={styles.emptyText}>Busque por assunto, título ou creator.</Text>
          <View style={styles.suggestionsList}>{discovery.slice(0, 5).map(content =>
            <Pressable key={`${content.contentType}:${content.id}`} accessibilityRole="button" style={styles.suggestion}
              onPress={() => setQuery(content.title)}>
              <Search size={18} strokeWidth={1.65} color={colors.muted} />
              <Text numberOfLines={2} style={styles.suggestionTitle}>{content.title}</Text>
            </Pressable>)}</View>
        </View>}
      </View>}
    </KeyboardAvoidingView>
  </AppScreen>;
}
function DiscoveryTile({ content, featured = false, onPress }: { content: HomeContent; featured?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${content.title}, ${content.creator}`}
    onPress={onPress} style={({ pressed }) => [styles.tile, featured && styles.featured, pressed && { opacity: 0.8 }]}>
    {content.thumbnailUrl && <Image source={{ uri: content.thumbnailUrl }} style={StyleSheet.absoluteFillObject}
      contentFit="cover" recyclingKey={`${content.contentType}:${content.id}`} />}
    <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={StyleSheet.absoluteFillObject} />
    <View style={styles.tileTop}>
      {(content.access === 'pro' || content.access === 'premium') && <PlanCrown plan={content.access} />}
      {!!content.duration && <Text style={styles.duration}>{content.duration}</Text>}
    </View>
    <View style={styles.tileCopy}>
      <Text numberOfLines={featured ? 2 : 3} style={[styles.tileTitle, featured && styles.featuredTitle]}>{content.title}</Text>
      {featured && <Text numberOfLines={1} style={styles.creator}>{content.creator}</Text>}
    </View>
  </Pressable>;
}
const styles = StyleSheet.create({
  body: { flex: 1 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: controls.buttonRadius, backgroundColor: colors.surface, paddingLeft: 12 },
  input: { flex: 1, color: colors.text, fontSize: 14, minHeight: controls.actionSize, paddingHorizontal: 8 },
  action: { minWidth: controls.actionSize, minHeight: controls.actionSize, alignItems: 'center', justifyContent: 'center' },
  clear: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  cancel: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  text: { color: colors.text, fontSize: 14 },
  resultsOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.background },
  listContent: { paddingBottom: 24 },
  gridRow: { gap: 2 },
  tileColumn: { width: '33.333333%', flexShrink: 1, paddingBottom: 2 },
  tile: { aspectRatio: 3 / 4, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  featured: { aspectRatio: 16 / 9, marginBottom: 2 },
  tileTop: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  duration: { color: '#fff', fontSize: 11, marginLeft: 'auto', backgroundColor: '#00000066', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
  tileCopy: { position: 'absolute', bottom: 10, left: 10, right: 10, gap: 4 },
  tileTitle: { color: '#fff', fontWeight: '600', fontSize: 12, lineHeight: 16 },
  featuredTitle: { fontSize: 22, lineHeight: 27 },
  creator: { color: '#ddd', fontSize: 13 },
  sectionTitle: { marginVertical: 16, marginHorizontal: 16, color: colors.text, fontSize: 16, fontWeight: '600' },
  suggestions: { paddingHorizontal: 16 },
  suggestionsList: { marginTop: 20 },
  suggestion: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  suggestionTitle: { flex: 1, color: colors.text, fontSize: 14 },
  empty: { alignItems: 'center', gap: 14, padding: 32, paddingTop: 48 },
  emptyTitle: { color: colors.text, fontWeight: '600', fontSize: 18, textAlign: 'center' },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 20 },
});

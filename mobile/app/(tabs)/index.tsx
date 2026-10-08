import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppScreen } from '@/components/AppScreen';
import { CategoryChips } from '@/components/CategoryChips';
import { HomeHeader } from '@/components/HomeHeader';
import { MobileVideoCard } from '@/components/MobileVideoCard';
import { ContinueWatching } from '@/components/ContinueWatching';
import { FeaturedCreatorRail } from '@/components/FeaturedCreatorRail';
import { useHomeSections } from '@/features/home/useHomeSections';
import { buildFeed } from '@/features/home/catalog';
import type { HomeContent } from '@/features/home/homeData';
import { useAuth } from '@/features/auth/authContext';
import { colors } from '@/theme/colors';

const categories = ['Para você', 'Aulas', 'Cursos', 'Podcasts', 'Shorts', 'PRO', 'Premium', 'Pago'];

export default function HomeScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [category, setCategory] = useState(categories[0]);
  const list = useRef<FlatList<HomeContent>>(null);
  const { contents, courses, loading, refreshing, error, refresh } = useHomeSections();
  const interests = useMemo(() => Array.isArray(profile?.interests)
    ? profile.interests.filter((interest: unknown): interest is string => typeof interest === 'string')
    : [], [profile?.interests]);
  const feed = useMemo(() => buildFeed([...contents, ...courses], category, interests), [contents, courses, category, interests]);

  return (
    <AppScreen scroll={false} edgeToEdge>
      <HomeHeader />
      <View style={styles.filters}>
        <CategoryChips categories={categories} activeCategory={category} onSelect={(next) => {
          setCategory(next);
          list.current?.scrollToOffset({ offset: 0, animated: false });
        }} />
      </View>
      <FlatList
        ref={list}
        data={feed}
        keyExtractor={(item) => `${item.contentType === 'curso' ? 'course' : 'content'}:${item.id}`}
        renderItem={({ item }) => <MobileVideoCard content={item} />}
        showsVerticalScrollIndicator={false}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={7}
        refreshing={refreshing}
        onRefresh={refresh}
        contentContainerStyle={styles.feed}
        ListHeaderComponent={
          <View>
            {user && category === 'Para você' ? <View style={styles.resume}><ContinueWatching userId={user.id} /></View> : null}
            {error ? <View style={styles.notice}>
              <Text style={styles.noticeText}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={refresh} style={styles.retry}><Text style={styles.retryText}>Tentar novamente</Text></Pressable>
            </View> : null}
            <View style={styles.feedHeading}>
              <View style={styles.headingCopy}>
                <Text style={styles.eyebrow}>ASSISTA. APRENDA. EVOLUA.</Text>
                <Text style={styles.heading}>{category === 'Para você' ? 'Seu próximo aprendizado' : category}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Criar estudo com a Classy" onPress={() => router.navigate('/study')} style={styles.studyAction}>
                <Ionicons name="sparkles-outline" size={20} color={colors.accent} />
              </Pressable>
            </View>
          </View>
        }
        ListFooterComponent={category === 'Para você' ? <FeaturedCreatorRail /> : null}
        ListEmptyComponent={loading ? <View style={styles.empty}><ActivityIndicator color={colors.accent} /><Text style={styles.emptyBody}>Buscando seus próximos aprendizados…</Text></View> :
          <View style={styles.empty}>
            <Ionicons name={error ? 'cloud-offline-outline' : 'play-circle-outline'} size={36} color={colors.muted} />
            <Text style={styles.emptyTitle}>{error ? 'Vamos tentar de novo?' : 'Ainda não há conteúdo aqui'}</Text>
            <Text style={styles.emptyBody}>{error ? 'Puxe a tela para atualizar o catálogo.' : 'Explore outra categoria ou comece um estudo com a Classy.'}</Text>
            <Pressable accessibilityRole="button" style={styles.emptyAction} onPress={() => error ? refresh() : setCategory('Para você')}><Text style={styles.retryText}>{error ? 'Atualizar' : 'Explorar conteúdos'}</Text></Pressable>
          </View>}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  filters: { paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.borderSubtle },
  feed: { paddingBottom: 24, flexGrow: 1 },
  resume: { paddingHorizontal: 16, paddingTop: 16 },
  feedHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingTop: 20 },
  headingCopy: { flex: 1 },
  eyebrow: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginBottom: 5 },
  heading: { color: colors.text, fontSize: 21, fontWeight: '700', letterSpacing: -0.6 },
  studyAction: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  notice: { margin: 16, padding: 14, borderRadius: 12, backgroundColor: colors.surface },
  noticeText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: 44, justifyContent: 'center' },
  retryText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 48, gap: 12 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  emptyBody: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  emptyAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 22, backgroundColor: colors.surface, marginTop: 8 },
});

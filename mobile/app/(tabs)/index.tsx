import { LoadingPlaceholder } from '@/components/LoadingPlaceholder';
import { PlanCrown } from '@/components/PlanCrown';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { AppScreen } from '@/components/AppScreen';
import { HomeHeader } from '@/components/HomeHeader';
import { HomeHero } from '@/components/HomeHero';
import { MobileVideoCard } from '@/components/MobileVideoCard';
import { ContinueWatching } from '@/components/ContinueWatching';
import { FeaturedCreators } from '@/components/FeaturedCreators';
import { CreatorApprovedBanner } from '@/components/CreatorApprovedBanner';
import { useHomeSections } from '@/features/home/useHomeSections';
import { useHomeEditorial } from '@/features/home/useHomeEditorial';
import { homeSections } from '@/features/home/ranking';
import type { HomeContent } from '@/features/home/homeData';
import { useAuth } from '@/features/auth/authContext';
import { colors } from '@/theme/colors';

type Row = {
  key: string;
  title?: string;
  premium?: boolean;
  plan?: 'pro' | 'premium';
  bridge?: boolean;
  content?: HomeContent;
  pair?: readonly HomeContent[];
  expandKey?: string;
  layout?: 'horizontal' | 'square' | 'vertical';
};
export default function HomeScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const { contents, courses, loading, refreshing, error, refresh } =
    useHomeSections();
  const { creators, settings, lives } = useHomeEditorial(revision);
  const interests = useMemo(
    () =>
      Array.isArray(profile?.interests)
        ? profile.interests.filter(
            (i: unknown): i is string => typeof i === 'string',
          )
        : [],
    [profile?.interests],
  );
  const sections = useMemo(
    () => homeSections(contents, courses, interests, !!user),
    [contents, courses, interests, user?.id],
  );
  const rows = useMemo(() => {
    const result: Row[] = [];
    for (const section of sections) {
      if (section.key === 'trending')
        result.push({ key: 'focus', bridge: true });
      if (!section.contents.length) continue;
      const limit = section.key === 'shorts' ? 4 : 6;
      const display =
        section.key === 'premium' || expanded.includes(section.key)
          ? section.contents
          : section.contents.slice(0, limit);
      result.push({
        key: `${section.key}-heading`,
        title: section.title,
        premium: section.key === 'premium',
        plan:
          section.key === 'pro'
            ? 'pro'
            : section.key === 'premium'
              ? 'premium'
              : undefined,
        expandKey:
          section.key !== 'premium' &&
          section.contents.length > limit &&
          !expanded.includes(section.key)
            ? section.key
            : undefined,
      });
      if (section.layout === 'vertical' || section.layout === 'square')
        for (let index = 0; index < display.length; index += 2)
          result.push({
            key: `${section.key}-${index}`,
            pair: display.slice(index, index + 2),
            layout: section.layout,
          });
      else
        display.forEach((content) =>
          result.push({
            key: `${section.key}-${content.id}`,
            content,
            layout: section.layout,
          }),
        );
    }
    return result;
  }, [sections, expanded]);
  const candidates = [
    sections[0],
    sections[1],
    sections[2],
    sections[7],
    sections[5],
  ].flatMap((section) => section.contents);
  const editorial = settings
    ? contents.find((c) => c.id === settings.content_id && c.publishedAt)
    : undefined;
  const hero =
    editorial ||
    candidates.find((c) =>
      process.env.EXPO_PUBLIC_HOME_HERO_CONTENT_ID
        ? c.id === process.env.EXPO_PUBLIC_HOME_HERO_CONTENT_ID
        : c.title.trim().toLocaleLowerCase('pt-BR') === 'aula mux 1',
    ) ||
    candidates.find(
      (c) =>
        c.thumbnailUrl &&
        (c.access === 'free' ||
          (c.access === 'pro' &&
            ['pro', 'premium'].includes(profile?.plan || '')) ||
          (c.access === 'premium' && profile?.plan === 'premium')),
    );
  const creator = hero ? undefined : creators[0];
  const appliedSettings = editorial ? settings : null;
  const openHref = (href?: string) => {
    if (!href || !/^\/(?!\/)[^\\\r\n]*$/.test(href)) return false;
    if (href === '/c/new') router.push('/study');
    else if (/^\/c\/[\w-]+$/.test(href))
      router.push({ pathname: '/study', params: { studyId: href.slice(3) } });
    else if (href.startsWith('/creators/destaque/'))
      router.push(
        href.replace('/creators/destaque/', '/creator/featured/') as Href,
      );
    else if (href.startsWith('/watch/'))
      router.push(user ? (href as Href) : '/auth/sign-in');
    else void Linking.openURL(`https://classfy.com.br${href}`);
    return true;
  };
  return (
    <AppScreen scroll={false} edgeToEdge>
      <HomeHeader />
      <FlatList
        data={loading && !contents.length && !courses.length ? [] : rows}
        keyExtractor={(row) => row.key}
        showsVerticalScrollIndicator={false}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={7}
        refreshing={refreshing}
        onRefresh={() => {
          void refresh();
          setRevision((r) => r + 1);
        }}
        contentContainerStyle={styles.feed}
        ListHeaderComponent={
          <View>
            {error ? (
              <Pressable onPress={refresh} style={styles.notice}>
                <Text style={styles.body}>
                  {error} Toque para tentar novamente.
                </Text>
              </Pressable>
            ) : null}
            {loading && !contents.length && !courses.length ? (
              <LoadingPlaceholder variant="home" inset={false} />
            ) : <>
            <HomeHero
              content={hero}
              creator={creator}
              settings={appliedSettings}
              onPlay={() => {
                if (
                  appliedSettings?.primary_href &&
                  openHref(appliedSettings.primary_href)
                )
                  return;
                if (hero)
                  router.push(
                    user
                      ? { pathname: '/watch/[id]', params: { id: hero.id } }
                      : {
                          pathname: '/auth/sign-in',
                          params: { contentId: hero.id },
                        },
                  );
                else if (creator)
                  router.push(
                    creator.slug
                      ? (`/creator/featured/${creator.slug}` as Href)
                      : (`/creator/${creator.creator_id}` as Href),
                  );
              }}
              onStudy={() => {
                if (!openHref(appliedSettings?.secondary_href))
                  router.push(user ? '/study' : '/auth/sign-in');
              }}
            />
            {lives.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.heading}>Lives ao vivo</Text>
                {lives.map((live) => (
                  <Pressable
                    key={live.id}
                    style={styles.live}
                    onPress={() =>
                      user
                        ? router.push({ pathname: '/live/[id]', params: { id: live.id } })
                        : router.push({ pathname: '/auth/sign-in', params: { liveId: live.id } })
                    }
                  >
                    <Image
                      source={{ uri: live.thumbnail_url || undefined }}
                      style={{ width: 90, height: 60, borderRadius: 8 }}
                    />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: colors.accent, fontSize: 10 }}>
                        AO VIVO · {live.viewer_count || 0} assistindo
                      </Text>
                      <Text style={styles.body}>{live.title}</Text>
                      <Text style={styles.muted}>{live.creator_name}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
            <FeaturedCreators creators={creators} />
            <CreatorApprovedBanner />
            {user && (
              <View style={styles.section}>
                <ContinueWatching userId={user.id} />
              </View>
            )}
            </>}
          </View>
        }
        renderItem={({ item }) =>
          item.bridge ? (
            <Pressable
              accessibilityRole="button"
              style={styles.bridge}
              onPress={() => router.push(user ? '/study' : '/auth/sign-in')}
            >
              <Text style={styles.heading}>
                {!user
                  ? 'Crie um estudo com a Classy em segundos.'
                  : profile?.plan === 'premium'
                    ? 'Transforme qualquer tema em estudo com direção.'
                    : profile?.plan === 'pro'
                      ? 'Deixe a Classy montar seu foco de estudo.'
                      : 'Achou um tema? A Classy vira isso em estudo na hora.'}
              </Text>
              <Text style={styles.body}>
                {!user
                  ? 'Criar meu estudo'
                  : profile?.plan === 'premium'
                    ? 'Abrir modo foco'
                    : profile?.plan === 'pro'
                      ? 'Começar estudo'
                      : 'Quero estudar'}{' '}
                →
              </Text>
            </Pressable>
          ) : item.title ? (
            <View style={styles.section}>
              {item.premium && (
                <>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <PlanCrown plan="premium" />
                    <Text style={styles.eyebrow}>Classfy Premium</Text>
                  </View>
                </>
              )}
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <View
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {item.plan && <PlanCrown plan={item.plan} size={18} />}
                  <Text style={[styles.heading, { flexShrink: 1 }]}>
                    {item.title}
                  </Text>
                </View>
                {item.expandKey && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      setExpanded((previous) => [...previous, item.expandKey!])
                    }
                  >
                    <Text style={styles.muted}>Ver todos →</Text>
                  </Pressable>
                )}
              </View>
              {item.premium && (
                <Text style={styles.muted}>
                  Uma seleção com mais profundidade, creators e experiências
                  exclusivas.
                </Text>
              )}
            </View>
          ) : item.pair ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {item.pair.map((content) => (
                <View key={content.id} style={{ flex: 1 }}>
                  <MobileVideoCard content={content} layout={item.layout} />
                </View>
              ))}
              {item.pair.length === 1 && <View style={{ flex: 1 }} />}
            </View>
          ) : item.content ? (
            <MobileVideoCard content={item.content} layout={item.layout} />
          ) : null
        }
        ListFooterComponent={
          !loading && !contents.length && !courses.length ? (
            <Text style={styles.body}>
              Ainda não há conteúdos disponíveis. Puxe para atualizar.
            </Text>
          ) : null
        }
      />
    </AppScreen>
  );
}
const styles = StyleSheet.create({
  feed: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 110 },
  section: { marginTop: 28, marginBottom: 20, gap: 10 },
  heading: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.6,
  },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  notice: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  eyebrow: { color: colors.accent, fontSize: 12 },
  bridge: {
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
    marginVertical: 32,
    backgroundColor: colors.surface,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
});

import { Href, Link } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { ContentCard } from '@/components/ContentCard';
import { EmptyState } from '@/components/EmptyState';
import { MetricPill } from '@/components/MetricPill';
import { SectionHeader } from '@/components/SectionHeader';
import { useHomeFeed } from '@/features/home/useHomeFeed';
import { colors, radius, spacing, type } from '@/theme/tokens';

export default function HomeScreen() {
  const { contents, loading, error, usingFallback } = useHomeFeed();

  return (
    <AppScreen scroll={false}>
      <FlatList
        data={contents}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.hero}>
              <View style={styles.heroCopy}>
                <Text style={styles.kicker}>Classfy mobile</Text>
                <Text style={styles.title}>Conteudo, estudo e recompensa no mesmo fluxo.</Text>
                <Text style={styles.subtitle}>
                  Uma base nativa para consumir o mesmo negocio da Classfy com UX de app de video.
                </Text>
              </View>
              <View style={styles.heroStats}>
                <MetricPill label="Watch" value="Feed" tone="cyan" />
                <MetricPill label="Rewards" value="Core" tone="lime" />
              </View>
            </View>

            <View style={styles.quickActions}>
              <Link href={'/watch/demo' as Href} asChild>
                <Pressable style={styles.primaryAction}>
                  <Text style={styles.primaryActionText}>Abrir Watch</Text>
                </Pressable>
              </Link>
              <Link href={'/creator/demo' as Href} asChild>
                <Pressable style={styles.secondaryAction}>
                  <Text style={styles.secondaryActionText}>Creator</Text>
                </Pressable>
              </Link>
            </View>

            <SectionHeader
              eyebrow={usingFallback ? 'Preview local' : 'Supabase'}
              title="Feed inicial"
              actionLabel={loading ? 'Carregando' : undefined}
            />

            {error ? <EmptyState title="Feed em modo preview" body={error} /> : null}
          </View>
        }
        renderItem={({ item }) => <ContentCard content={item} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <EmptyState title="Nenhum conteudo ainda" body="A Home ja esta pronta para listar conteudos aprovados do Supabase." />
          )
        }
        contentContainerStyle={styles.listContent}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: spacing.xl,
  },
  header: {
    gap: spacing.lg,
    paddingBottom: spacing.sm,
  },
  hero: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  heroCopy: {
    gap: spacing.sm,
  },
  kicker: {
    color: colors.accent,
    fontSize: type.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
    lineHeight: 36,
  },
  subtitle: {
    color: colors.muted,
    fontSize: type.md,
    lineHeight: 22,
  },
  heroStats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flex: 1,
    paddingVertical: spacing.md,
  },
  primaryActionText: {
    color: colors.background,
    fontSize: type.md,
    fontWeight: '900',
  },
  secondaryAction: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.md,
  },
  secondaryActionText: {
    color: colors.text,
    fontSize: type.md,
    fontWeight: '800',
  },
  loading: {
    paddingVertical: spacing.xl,
  },
});

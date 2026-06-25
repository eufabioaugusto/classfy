import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { MetricPill } from '@/components/MetricPill';
import { SectionHeader } from '@/components/SectionHeader';
import { colors, radius, spacing, type } from '@/theme/tokens';

export default function CreatorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <AppScreen>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>CR</Text>
        </View>
        <Text style={styles.title}>Creator Classfy</Text>
        <Text style={styles.meta}>Perfil: {id ?? 'sem-id'}</Text>
      </View>

      <View style={styles.metrics}>
        <MetricPill label="Conteudos" value="--" tone="cyan" />
        <MetricPill label="Ganhos" value="--" tone="lime" />
        <MetricPill label="Fas" value="--" tone="amber" />
      </View>

      <SectionHeader eyebrow="Perfil publico" title="Base para canal mobile" />
      <View style={styles.panel}>
        <Text style={styles.panelText}>
          Esta tela vai receber bio, conteudos, cursos, conquistas, follows e estatisticas do creator.
        </Text>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  avatarText: {
    color: colors.accent,
    fontSize: type.xl,
    fontWeight: '900',
  },
  title: {
    color: colors.text,
    fontSize: type.xxl,
    fontWeight: '900',
  },
  meta: {
    color: colors.muted,
    fontSize: type.sm,
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  panel: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.lg,
  },
  panelText: {
    color: colors.muted,
    fontSize: type.md,
    lineHeight: 22,
  },
});

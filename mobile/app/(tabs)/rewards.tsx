import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { MetricPill } from '@/components/MetricPill';
import { SectionHeader } from '@/components/SectionHeader';
import { colors, radius, spacing, type } from '@/theme/tokens';

const rewardTracks = [
  { icon: 'play-circle-outline', title: 'Assistir', body: 'Progresso e milestones de visualizacao.' },
  { icon: 'chatbubble-ellipses-outline', title: 'Interagir', body: 'Likes, comentarios, favoritos e salvos.' },
  { icon: 'cash-outline', title: 'Ganhar', body: 'Carteira, pontos e ciclos economicos.' },
] as const;

export default function RewardsScreen() {
  return (
    <AppScreen>
      <View style={styles.header}>
        <Text style={styles.kicker}>Diferencial Classfy</Text>
        <Text style={styles.title}>Rewards como parte nativa da experiencia.</Text>
        <Text style={styles.subtitle}>
          Esta aba prepara a camada de pontos, carteira, afiliados e participacao economica.
        </Text>
      </View>

      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Preview de carteira</Text>
        <Text style={styles.balanceValue}>R$ 0,00</Text>
        <View style={styles.metrics}>
          <MetricPill label="Pontos" value="0" tone="lime" />
          <MetricPill label="Ciclo" value="Aberto" tone="amber" />
        </View>
      </View>

      <SectionHeader eyebrow="Fluxos previstos" title="Como o usuario evolui" />
      <View style={styles.trackList}>
        {rewardTracks.map((track) => (
          <View key={track.title} style={styles.trackCard}>
            <Ionicons name={track.icon} color={colors.accent} size={24} />
            <View style={styles.trackCopy}>
              <Text style={styles.trackTitle}>{track.title}</Text>
              <Text style={styles.trackBody}>{track.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  kicker: {
    color: colors.lime,
    fontSize: type.xs,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: type.xxxl,
    fontWeight: '900',
    lineHeight: 36,
  },
  subtitle: {
    color: colors.muted,
    fontSize: type.md,
    lineHeight: 22,
  },
  balanceCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  balanceLabel: {
    color: colors.muted,
    fontSize: type.sm,
    fontWeight: '800',
  },
  balanceValue: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '900',
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  trackList: {
    gap: spacing.md,
  },
  trackCard: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  trackCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  trackTitle: {
    color: colors.text,
    fontSize: type.md,
    fontWeight: '900',
  },
  trackBody: {
    color: colors.muted,
    fontSize: type.sm,
    lineHeight: 20,
  },
});

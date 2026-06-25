import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '@/theme/tokens';

type Tone = 'cyan' | 'lime' | 'amber';

const toneMap: Record<Tone, string> = {
  cyan: colors.accent,
  lime: colors.lime,
  amber: colors.amber,
};

type MetricPillProps = {
  label: string;
  value: string;
  tone?: Tone;
};

export function MetricPill({ label, value, tone = 'cyan' }: MetricPillProps) {
  return (
    <View style={styles.container}>
      <Text style={[styles.value, { color: toneMap[tone] }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  value: {
    fontSize: type.lg,
    fontWeight: '900',
  },
  label: {
    color: colors.muted,
    fontSize: type.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
});

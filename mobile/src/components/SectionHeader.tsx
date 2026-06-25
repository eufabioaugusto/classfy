import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, type } from '@/theme/tokens';

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  actionLabel?: string;
};

export function SectionHeader({ eyebrow, title, actionLabel }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.copy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {actionLabel ? <Text style={styles.action}>{actionLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: type.xs,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: type.xl,
    fontWeight: '900',
  },
  action: {
    color: colors.muted,
    fontSize: type.sm,
    fontWeight: '800',
  },
});

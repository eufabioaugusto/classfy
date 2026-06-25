import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '@/theme/tokens';

type EmptyStateProps = {
  title: string;
  body: string;
};

export function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: type.md,
    fontWeight: '900',
  },
  body: {
    color: colors.muted,
    fontSize: type.sm,
    lineHeight: 20,
  },
});
